#!/usr/bin/env node
/**
 * RStack Observer — standalone live observability server
 * owner: RStack developed by Richardson Gunde
 *
 * Bundles into a zero-dependency .exe / .app / Linux binary via:
 *   npm run build:observer
 *
 * On launch:
 *   1. Finds the active RStack run directory
 *   2. Starts HTTP + WebSocket server on localhost:3007
 *   3. Tails events.jsonl and pushes every new event to all browser clients
 *   4. Opens the browser automatically (macOS / Windows / Linux)
 *   5. Serves a full Kanban observability dashboard with live updates
 */

import { createServer }       from 'node:http';
import { existsSync, statSync, readFileSync, watchFile, unwatchFile } from 'node:fs';
import { readFile, readdir }  from 'node:fs/promises';
import { join, resolve }      from 'node:path';
import { spawn }              from 'node:child_process';

// ── CLI argument parsing ──────────────────────────────────────────────────────
// Supports: --port <n>  --project <path>  --run-id <id>  --no-browser

function parseArgv(argv) {
  const out = { port: null, project: null, runId: null, noBrowser: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if ((a === '--port')    && argv[i + 1]) { out.port    = Number(argv[++i]); }
    if ((a === '--project') && argv[i + 1]) { out.project = argv[++i]; }
    if ((a === '--run-id')  && argv[i + 1]) { out.runId   = argv[++i]; }
    if (a === '--no-browser') out.noBrowser = true;
  }
  return out;
}
const CLI = parseArgv(process.argv.slice(2));

// ── Config ───────────────────────────────────────────────────────────────────

const PORT         = CLI.port    ?? Number(process.env.RSTACK_OBSERVER_PORT ?? 3007);
const PROJECT_ROOT = CLI.project ? resolve(CLI.project)
                                 : resolve(process.env.RSTACK_PROJECT_ROOT ?? process.cwd());
const PINNED_RUN   = CLI.runId   ?? process.env.RSTACK_RUN_ID ?? null;
const NO_BROWSER   = CLI.noBrowser || process.env.RSTACK_NO_BROWSER === '1';
const POLL_MS      = 800; // fallback polling when fs.watch unavailable

// ── Utility ──────────────────────────────────────────────────────────────────

function safeJson(str) {
  try { return JSON.parse(str); } catch { return null; }
}

function readJsonlSync(filePath) {
  if (!existsSync(filePath)) return [];
  try {
    return readFileSync(filePath, 'utf8')
      .split('\n').filter(Boolean)
      .flatMap(l => { const p = safeJson(l); return p ? [p] : []; });
  } catch { return []; }
}

async function readJson(filePath, fallback = null) {
  try { return JSON.parse(await readFile(filePath, 'utf8')); } catch { return fallback; }
}

function openBrowser(url) {
  const cmd = process.platform === 'win32' ? 'start'
    : process.platform === 'darwin' ? 'open' : 'xdg-open';
  try {
    spawn(cmd, [url], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' }).unref();
  } catch { /* best-effort */ }
}

// ── Run discovery ─────────────────────────────────────────────────────────────

async function latestRunId(projectRoot) {
  const runsDir = join(projectRoot, '.rstack', 'runs');
  if (!existsSync(runsDir)) return null;
  try {
    const dirs = await readdir(runsDir);
    const sorted = dirs
      .map(d => ({ id: d, mtime: (() => { try { return statSync(join(runsDir, d, 'manifest.json')).mtimeMs; } catch { return 0; } })() }))
      .sort((a, b) => b.mtime - a.mtime);
    return sorted.length ? sorted[0].id : null;
  } catch { return null; }
}

// ── WebSocket implementation (no external deps) ───────────────────────────────
// Minimal RFC-6455 WebSocket server using raw Node.js TCP upgrade

import { createHash } from 'node:crypto';

const WS_MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function wsHandshake(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return false; }
  const accept = createHash('sha1').update(key + WS_MAGIC).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );
  return true;
}

function wsFrame(data) {
  const payload = Buffer.from(typeof data === 'string' ? data : JSON.stringify(data));
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x81; // FIN + text opcode
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

function wsSend(socket, data) {
  try { socket.write(wsFrame(data)); } catch { /* client gone */ }
}

// ── State ─────────────────────────────────────────────────────────────────────

const clients = new Set();          // active WebSocket sockets
let currentRunId   = null;
let currentRunDir  = null;
let lastEventCount = 0;
let pollInterval   = null;
let watchedPath    = null;

function broadcast(msg) {
  const frame = wsFrame(typeof msg === 'string' ? msg : JSON.stringify(msg));
  for (const socket of clients) {
    try { socket.write(frame); } catch { clients.delete(socket); }
  }
}

// ── Live tailing ──────────────────────────────────────────────────────────────

function startTailing(eventsPath) {
  if (watchedPath && watchedPath !== eventsPath) {
    try { unwatchFile(watchedPath); } catch { /* watcher may already be detached */ }
    if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
  }
  watchedPath = eventsPath;

  function checkForNewEvents() {
    const events = readJsonlSync(eventsPath);
    if (events.length > lastEventCount) {
      const newEvents = events.slice(lastEventCount);
      lastEventCount = events.length;
      for (const ev of newEvents) {
        broadcast({ kind: 'event', event: ev });
      }
      broadcast({ kind: 'event_count', count: events.length });
    }
  }

  // fs.watchFile works on all platforms including Windows/NFS
  watchFile(eventsPath, { interval: POLL_MS, persistent: false }, checkForNewEvents);
  // Also poll as belt-and-suspenders
  pollInterval = setInterval(checkForNewEvents, POLL_MS * 2);
}

// ── Full state snapshot (sent to each new client) ─────────────────────────────

async function buildSnapshot(projectRoot, runId) {
  if (!runId) return { kind: 'snapshot', runId: null, manifest: {}, tasks: [], events: [], metrics: {} };
  const runDir = join(projectRoot, '.rstack', 'runs', runId);
  const manifest  = await readJson(join(runDir, 'manifest.json'), {});
  const taskState = await readJson(join(runDir, 'tasks.json'), { tasks: [] });
  const events    = readJsonlSync(join(runDir, 'events.jsonl'));
  const approvals = await readJson(join(runDir, 'approvals.json'), []);

  // Cost / guardrail summary from events
  let totalCost = 0, toolCalls = 0, guardrailHits = 0;
  for (const ev of events) {
    if (ev.type === 'cost_recorded') totalCost += Number(ev.usd ?? ev.cost ?? 0) || 0;
    if (ev.type === 'tool_call') toolCalls++;
    if (ev.type === 'guardrail_triggered') guardrailHits++;
  }

  // Per-task tool call counts
  // Pi extension emits tool_call without task_id — fall back to most-recently-started task
  const taskToolCalls = {};
  let activeTask = null;
  for (const ev of events) {
    if (ev.type === 'task_started' || ev.type === 'builder_task_prepared') activeTask = ev.task_id;
    if (ev.type === 'task_validated') activeTask = null;
    if (ev.type === 'tool_call') {
      const tid = ev.task_id ?? activeTask;
      if (tid) taskToolCalls[tid] = (taskToolCalls[tid] ?? 0) + 1;
    }
  }

  return {
    kind: 'snapshot',
    runId,
    manifest,
    tasks: (taskState.tasks ?? []).map(t => ({ ...t, tool_calls: taskToolCalls[t.id] ?? 0 })),
    events: events.slice(-200),
    approvals,
    metrics: { totalCost, toolCalls, guardrailHits, eventCount: events.length },
  };
}

// ── HTML dashboard ────────────────────────────────────────────────────────────

function dashboardHtml(port) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>RStack Observer — Live</title>
<style>
:root{
  --bg:#0d1117;--panel:#161b22;--border:#21262d;--border2:#30363d;
  --text:#e6edf3;--dim:#8b949e;--accent:#ea580c;--accent2:#f97316;
  --pass:#3fb950;--fail:#f85149;--warn:#d29922;--violet:#8b5cf6;--blue:#58a6ff;
  --cyan:#39d353;--f:'Segoe UI',system-ui,sans-serif;
  --m:'Cascadia Code','Fira Code',Consolas,monospace;
}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:var(--f);background:var(--bg);color:var(--text);font-size:13px;line-height:1.5;min-height:100vh;display:flex;flex-direction:column}

/* ── Header ── */
header{
  background:var(--panel);border-bottom:1px solid var(--border2);
  padding:10px 20px;display:flex;align-items:center;gap:12px;position:sticky;top:0;z-index:20;
  box-shadow:0 2px 8px rgba(0,0,0,.4);
}
.logo{font-size:15px;font-weight:800;color:var(--accent);letter-spacing:-.02em}
.logo span{color:var(--text)}
.run-badge{font-family:var(--m);font-size:11px;color:var(--dim);background:var(--bg);
  border:1px solid var(--border2);padding:3px 10px;border-radius:20px}
.ws-dot{width:8px;height:8px;border-radius:50%;background:#555;transition:background .4s;flex-shrink:0}
.ws-dot.live{background:var(--pass);box-shadow:0 0 6px var(--pass)}
.ws-dot.offline{background:var(--fail)}
.header-right{margin-left:auto;display:flex;align-items:center;gap:14px}
.meter-row{display:flex;gap:18px;align-items:center}
.meter{text-align:center}
.meter .mv{font-size:16px;font-weight:700;font-family:var(--m);line-height:1}
.meter .ml{font-size:9.5px;font-weight:600;color:var(--dim);text-transform:uppercase;letter-spacing:.06em;margin-top:2px}
.meter .mv.pass{color:var(--pass)}.meter .mv.fail{color:var(--fail)}
.meter .mv.warn{color:var(--warn)}.meter .mv.info{color:var(--blue)}.meter .mv.cost{color:var(--accent)}
.sep{width:1px;height:28px;background:var(--border2)}

/* ── Layout ── */
.layout{display:grid;grid-template-columns:1fr 340px;flex:1;min-height:0;overflow:hidden}
@media(max-width:900px){.layout{grid-template-columns:1fr}}

/* ── Main ── */
.main{overflow-y:auto;padding:16px 20px;display:flex;flex-direction:column;gap:16px}

/* ── Kanban board ── */
.kanban-wrap{overflow-x:auto;padding-bottom:4px}
.kanban{display:flex;gap:12px;min-width:max-content;padding:2px 0}
.kb-col{
  background:var(--panel);border:1px solid var(--border);border-radius:10px;
  width:190px;flex-shrink:0;display:flex;flex-direction:column;gap:0;overflow:hidden;
}
.kb-col-hdr{
  padding:8px 12px;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;
  border-bottom:1px solid var(--border);color:var(--dim);display:flex;justify-content:space-between;align-items:center;
}
.kb-card{
  padding:10px 12px;border-bottom:1px solid var(--border);cursor:pointer;
  transition:background .15s;
}
.kb-card:last-child{border-bottom:none}
.kb-card:hover{background:rgba(255,255,255,.04)}
.kb-card.active{background:rgba(234,88,12,.08);border-left:2px solid var(--accent)}
.kb-card.pass{border-left:2px solid var(--pass)}
.kb-card.fail{border-left:2px solid var(--fail)}
.kb-id{font-family:var(--m);font-size:10px;color:var(--dim);margin-bottom:3px}
.kb-title{font-size:11.5px;font-weight:600;color:var(--text);line-height:1.3}
.kb-meta{display:flex;gap:6px;margin-top:6px;align-items:center;flex-wrap:wrap}
.pill{display:inline-block;font-size:9px;font-weight:700;padding:1.5px 6px;border-radius:4px;
  text-transform:uppercase;letter-spacing:.04em;white-space:nowrap}
.pill-pass,.pill-approved{background:rgba(63,185,80,.15);color:var(--pass);border:1px solid rgba(63,185,80,.3)}
.pill-fail,.pill-rejected{background:rgba(248,81,73,.15);color:var(--fail);border:1px solid rgba(248,81,73,.3)}
.pill-in_progress{background:rgba(234,88,12,.15);color:var(--accent2);border:1px solid rgba(234,88,12,.3)}
.pill-pending,.pill-ready{background:rgba(139,92,246,.15);color:var(--violet);border:1px solid rgba(139,92,246,.3)}
.pill-none{background:var(--border);color:var(--dim)}
.tc-badge{font-size:9.5px;color:var(--blue);font-family:var(--m)}

/* ── Live event stream ── */
.stream-panel{
  border-left:1px solid var(--border2);background:var(--panel);display:flex;flex-direction:column;overflow:hidden;
}
.stream-hdr{
  padding:10px 14px;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;
  color:var(--dim);border-bottom:1px solid var(--border2);display:flex;align-items:center;gap:8px;flex-shrink:0;
}
.stream-hdr .pulse{width:6px;height:6px;border-radius:50%;background:var(--pass);animation:blink 1.4s infinite}
@keyframes blink{0%,100%{opacity:1}50%{opacity:.3}}
#event-log{flex:1;overflow-y:auto;font-family:var(--m);font-size:11px;padding:8px 0;display:flex;flex-direction:column-reverse}
.ev-row{padding:3px 14px;border-bottom:1px solid rgba(255,255,255,.03);display:flex;gap:8px;align-items:baseline}
.ev-row:hover{background:rgba(255,255,255,.03)}
.ev-ts{color:var(--dim);font-size:9.5px;white-space:nowrap;flex-shrink:0}
.ev-type{font-size:10px;font-weight:700;padding:1px 5px;border-radius:3px;white-space:nowrap;flex-shrink:0}
.ev-detail{color:var(--dim);font-size:10.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* event type colours */
.ev-tool_call{background:rgba(88,166,255,.15);color:var(--blue)}
.ev-tool_result{background:rgba(63,185,80,.12);color:var(--pass)}
.ev-task_started,.ev-builder_task_prepared{background:rgba(234,88,12,.15);color:var(--accent2)}
.ev-task_validated{background:rgba(63,185,80,.15);color:var(--pass)}
.ev-guardrail_triggered{background:rgba(210,153,34,.2);color:var(--warn)}
.ev-memory_recalled,.ev-episode_memory_written{background:rgba(139,92,246,.15);color:var(--violet)}
.ev-stage_completed{background:rgba(57,211,83,.15);color:var(--cyan)}
.ev-cost_recorded{background:rgba(234,88,12,.1);color:var(--accent)}
.ev-approval_gate_blocked{background:rgba(248,81,73,.15);color:var(--fail)}

/* ── Card UI ── */
.card{background:var(--panel);border:1px solid var(--border);border-radius:10px;overflow:hidden}
.card-hdr{padding:10px 14px;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;
  color:var(--dim);border-bottom:1px solid var(--border)}
.card-body{padding:12px 14px}

/* ── Guardrail bar ── */
.gb-row{margin-bottom:10px}
.gb-label{display:flex;justify-content:space-between;font-size:11px;margin-bottom:4px}
.gb-bar{height:6px;background:var(--border2);border-radius:3px;overflow:hidden}
.gb-fill{height:100%;border-radius:3px;transition:width .4s ease}
.gb-fill.safe{background:var(--pass)}.gb-fill.warn{background:var(--warn)}.gb-fill.danger{background:var(--fail)}

/* ── Run info ── */
.ri-row{display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border);font-size:12px}
.ri-row:last-child{border-bottom:none}
.ri-key{color:var(--dim)}.ri-val{font-family:var(--m);font-size:11px;text-align:right;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* ── Trace modal ── */
#trace-modal{
  display:none;position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:100;
  align-items:center;justify-content:center;padding:20px;
}
#trace-modal.open{display:flex}
.modal-box{
  background:var(--panel);border:1px solid var(--border2);border-radius:12px;
  max-width:780px;width:100%;max-height:80vh;display:flex;flex-direction:column;overflow:hidden;
}
.modal-hdr{padding:12px 18px;display:flex;align-items:center;gap:12px;border-bottom:1px solid var(--border2)}
.modal-hdr h2{font-size:14px;font-weight:700;flex:1}
.modal-close{background:none;border:none;color:var(--dim);font-size:20px;cursor:pointer;line-height:1}
.modal-close:hover{color:var(--text)}
.modal-body{flex:1;overflow-y:auto;padding:16px 18px;display:flex;flex-direction:column;gap:12px}
.trace-pair{border:1px solid var(--border);border-radius:8px;overflow:hidden}
.trace-call{padding:10px 14px;background:rgba(88,166,255,.06);display:flex;align-items:center;gap:10px}
.trace-tool{font-family:var(--m);font-weight:700;color:var(--blue);font-size:13px}
.trace-ts{font-size:10px;color:var(--dim);margin-left:auto}
.trace-io{padding:10px 14px;font-family:var(--m);font-size:11px}
.trace-lbl{font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--dim);margin-bottom:4px}
.trace-pre{background:var(--bg);border-radius:6px;padding:8px 12px;white-space:pre-wrap;word-break:break-word;
  color:#cdd9e5;font-size:11px;max-height:160px;overflow-y:auto}
.trace-pre.out{color:#aff5b4}

/* ── Scrollbar ── */
::-webkit-scrollbar{width:5px;height:5px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:var(--border2);border-radius:3px}
</style>
</head>
<body>

<header>
  <div class="logo">RStack<span> Observer</span></div>
  <div id="run-badge" class="run-badge">connecting…</div>
  <div class="sep"></div>
  <div class="meter-row">
    <div class="meter"><div id="m-pass" class="mv pass">—</div><div class="ml">Pass</div></div>
    <div class="meter"><div id="m-fail" class="mv fail">—</div><div class="ml">Fail</div></div>
    <div class="meter"><div id="m-tools" class="mv info">—</div><div class="ml">Tool Calls</div></div>
    <div class="meter"><div id="m-guardrails" class="mv warn">—</div><div class="ml">Guardrails</div></div>
    <div class="meter"><div id="m-cost" class="mv cost">—</div><div class="ml">Cost</div></div>
  </div>
  <div class="header-right">
    <div class="ws-dot offline" id="ws-dot"></div>
  </div>
</header>

<div class="layout">
  <div class="main">

    <!-- Kanban board -->
    <div class="card">
      <div class="card-hdr">Pipeline Board — click any task to trace</div>
      <div class="card-body" style="padding:12px">
        <div class="kanban-wrap">
          <div class="kanban" id="kanban-board">
            <div class="kb-col"><div class="kb-col-hdr">Loading…</div></div>
          </div>
        </div>
      </div>
    </div>

    <!-- Guardrail meters -->
    <div class="card">
      <div class="card-hdr">Guardrail Health</div>
      <div class="card-body" id="guardrail-panel">
        <div class="gb-row">
          <div class="gb-label"><span>maxTaskAttempts</span><span id="gr-attempts">0 / 2</span></div>
          <div class="gb-bar"><div class="gb-fill safe" id="gr-attempts-bar" style="width:0%"></div></div>
        </div>
        <div class="gb-row">
          <div class="gb-label"><span>maxToolCallsPerTask</span><span id="gr-tools">0 / 40</span></div>
          <div class="gb-bar"><div class="gb-fill safe" id="gr-tools-bar" style="width:0%"></div></div>
        </div>
        <div class="gb-row" style="margin-bottom:0">
          <div class="gb-label"><span>Cumulative Cost Budget</span><span id="gr-cost">$0.0000</span></div>
          <div class="gb-bar"><div class="gb-fill safe" id="gr-cost-bar" style="width:0%"></div></div>
        </div>
      </div>
    </div>

    <!-- Run metadata -->
    <div class="card">
      <div class="card-hdr">Run Details</div>
      <div class="card-body" id="run-details">
        <div class="ri-row"><div class="ri-key">Goal</div><div class="ri-val" id="rd-goal">—</div></div>
        <div class="ri-row"><div class="ri-key">Mode</div><div class="ri-val" id="rd-mode">—</div></div>
        <div class="ri-row"><div class="ri-key">Status</div><div class="ri-val" id="rd-status">—</div></div>
        <div class="ri-row"><div class="ri-key">Created</div><div class="ri-val" id="rd-created">—</div></div>
        <div class="ri-row"><div class="ri-key">Run ID</div><div class="ri-val" id="rd-runid">—</div></div>
      </div>
    </div>

  </div>

  <!-- Live event stream -->
  <div class="stream-panel">
    <div class="stream-hdr">
      <div class="pulse"></div>
      Live Event Stream
      <span style="margin-left:auto;color:var(--text);font-size:11px" id="ev-count">0 events</span>
    </div>
    <div id="event-log"></div>
  </div>
</div>

<!-- Trace modal -->
<div id="trace-modal">
  <div class="modal-box">
    <div class="modal-hdr">
      <h2 id="modal-title">Task Trace</h2>
      <button class="modal-close" onclick="closeModal()">&times;</button>
    </div>
    <div class="modal-body" id="modal-body"></div>
  </div>
</div>

<script>
// ── State ──────────────────────────────────────────────────────────────────
const STAGE_META = [
  {id:'00-environment',label:'Environment'},
  {id:'01-transcript',label:'Transcript'},
  {id:'02-requirements',label:'Requirements'},
  {id:'03-documentation',label:'Documentation'},
  {id:'04-planning',label:'Planning'},
  {id:'05-jira',label:'Jira Tickets'},
  {id:'06-architecture',label:'Architecture'},
  {id:'07-code',label:'Code'},
  {id:'08-testing',label:'Testing'},
  {id:'09-deployment',label:'Deployment'},
  {id:'10-summary',label:'Summary'},
  {id:'11-feedback-loop',label:'Feedback'},
  {id:'12-security-threat-model',label:'Security'},
  {id:'13-compliance-checker',label:'Compliance'},
  {id:'14-cost-estimation',label:'Cost Estimate'},
];

let state = { tasks: [], events: [], metrics: {}, manifest: {}, runId: null };
let taskToolCalls = {};
let activeTaskId  = null;
let allTaskEvents = {}; // task_id → events[]

// ── WebSocket ───────────────────────────────────────────────────────────────
const dot = document.getElementById('ws-dot');
let ws, reconnectTimer;

function connect() {
  ws = new WebSocket('ws://localhost:${port}');
  ws.onopen = () => {
    dot.className = 'ws-dot live';
    clearTimeout(reconnectTimer);
  };
  ws.onmessage = e => {
    try { handleMsg(JSON.parse(e.data)); } catch {}
  };
  ws.onclose = ws.onerror = () => {
    dot.className = 'ws-dot offline';
    reconnectTimer = setTimeout(connect, 2000);
  };
}

function handleMsg(msg) {
  if (msg.kind === 'snapshot') applySnapshot(msg);
  else if (msg.kind === 'event') appendLiveEvent(msg.event);
  else if (msg.kind === 'event_count') document.getElementById('ev-count').textContent = msg.count + ' events';
}

// ── Snapshot ────────────────────────────────────────────────────────────────
function applySnapshot(snap) {
  state = snap;
  // Rebuild task tool call index and active task from events
  taskToolCalls = {};
  activeTaskId = null;
  allTaskEvents = {};
  for (const ev of snap.events) {
    if (!allTaskEvents[ev.task_id]) allTaskEvents[ev.task_id] = [];
    if (ev.task_id) allTaskEvents[ev.task_id].push(ev);
    if (ev.type === 'task_started' || ev.type === 'builder_task_prepared') activeTaskId = ev.task_id;
    if (ev.type === 'task_validated') activeTaskId = null;
    if (ev.type === 'tool_call') {
      const tid = ev.task_id ?? activeTaskId;
      if (tid) taskToolCalls[tid] = (taskToolCalls[tid] ?? 0) + 1;
    }
  }
  renderAll();
  // Render historical events
  const log = document.getElementById('event-log');
  log.innerHTML = '';
  for (const ev of [...snap.events].reverse()) log.appendChild(makeEvRow(ev));
  document.getElementById('ev-count').textContent = snap.metrics.eventCount + ' events';
}

// ── Render ──────────────────────────────────────────────────────────────────
function renderAll() {
  renderHeader();
  renderKanban();
  renderGuardrails();
  renderRunDetails();
}

function renderHeader() {
  const m = state.metrics || {};
  const tasks = state.tasks || [];
  document.getElementById('run-badge').textContent = state.runId ? 'Run: ' + state.runId.slice(-24) : 'No active run';
  document.getElementById('m-pass').textContent     = tasks.filter(t => t.status === 'PASS').length;
  document.getElementById('m-fail').textContent     = tasks.filter(t => t.status === 'FAIL').length;
  document.getElementById('m-tools').textContent    = m.toolCalls ?? 0;
  document.getElementById('m-guardrails').textContent = m.guardrailHits ?? 0;
  document.getElementById('m-cost').textContent     = '$' + (m.totalCost ?? 0).toFixed(4);
}

function renderKanban() {
  const board = document.getElementById('kanban-board');
  const tasks  = state.tasks || [];

  // Group tasks by their closest stage affinity
  const stageTaskMap = {};
  for (const t of tasks) {
    const stageAffinity = (t.stage_artifacts ?? []).map(a => a.stage_id).filter(Boolean);
    const key = stageAffinity[0] ?? t.id;
    if (!stageTaskMap[key]) stageTaskMap[key] = [];
    stageTaskMap[key].push(t);
  }

  // Build columns for each pipeline stage
  board.innerHTML = '';
  for (const stage of STAGE_META) {
    const col = document.createElement('div');
    col.className = 'kb-col';
    const stageTasks = tasks.filter(t =>
      (t.stage_artifacts ?? []).some(a => a.stage_id === stage.id) ||
      t.id.includes(stage.id)
    );
    const stageStatus = stageTasks.length
      ? (stageTasks.every(t => t.status === 'PASS') ? 'pass' : stageTasks.some(t => t.status === 'FAIL') ? 'fail' : stageTasks.some(t => t.status === 'IN_PROGRESS') ? 'active' : 'pending')
      : 'pending';

    const statusDot = stageStatus === 'pass' ? '🟢' : stageStatus === 'fail' ? '🔴' : stageStatus === 'active' ? '🟠' : '⚪';
    col.innerHTML = \`<div class="kb-col-hdr"><span>\${stage.label}</span><span>\${statusDot}</span></div>\`;

    // Task cards in this stage column
    if (stageTasks.length) {
      for (const t of stageTasks) {
        const card = document.createElement('div');
        const cardCls = t.id === activeTaskId ? 'active' : (t.status ?? '').toLowerCase();
        card.className = \`kb-card \${cardCls}\`;
        const tc = taskToolCalls[t.id] ?? 0;
        card.innerHTML = \`
          <div class="kb-id">\${esc(t.id)}</div>
          <div class="kb-title">\${esc(t.title ?? t.id)}</div>
          <div class="kb-meta">
            <span class="pill pill-\${(t.status??'none').toLowerCase()}">\${t.status ?? 'READY'}</span>
            \${tc ? \`<span class="tc-badge">🛠 \${tc}</span>\` : ''}
            \${t.id === activeTaskId ? '<span class="pill pill-in_progress">⚡ ACTIVE</span>' : ''}
          </div>\`;
        card.onclick = () => showTrace(t.id);
        col.appendChild(card);
      }
    } else {
      // Empty placeholder card
      const empty = document.createElement('div');
      empty.className = 'kb-card';
      empty.innerHTML = \`<div class="kb-id">\${stage.id}</div><div class="kb-title" style="color:var(--dim);font-weight:400">Not started</div>\`;
      col.appendChild(empty);
    }
    board.appendChild(col);
  }
}

function renderGuardrails() {
  const m = state.metrics || {};
  const toolCalls = m.toolCalls ?? 0;
  const guardrailHits = m.guardrailHits ?? 0;
  const cost = m.totalCost ?? 0;

  const setBar = (id, barId, val, max) => {
    const pct = Math.min(100, Math.round((val / max) * 100));
    const cls = pct < 60 ? 'safe' : pct < 85 ? 'warn' : 'danger';
    document.getElementById(id).textContent = val + ' / ' + max;
    const bar = document.getElementById(barId);
    bar.style.width = pct + '%';
    bar.className = 'gb-fill ' + cls;
  };
  setBar('gr-attempts', 'gr-attempts-bar', guardrailHits, 2);
  setBar('gr-tools', 'gr-tools-bar', toolCalls, 40);
  document.getElementById('gr-cost').textContent = '$' + cost.toFixed(4);
  const costPct = Math.min(100, (cost / 5) * 100);
  const costBar = document.getElementById('gr-cost-bar');
  costBar.style.width = costPct + '%';
  costBar.className = 'gb-fill ' + (costPct < 60 ? 'safe' : costPct < 85 ? 'warn' : 'danger');
}

function renderRunDetails() {
  const m = state.manifest || {};
  document.getElementById('rd-goal').textContent    = m.goal ?? '—';
  document.getElementById('rd-mode').textContent    = m.mode ?? '—';
  document.getElementById('rd-status').textContent  = m.status ?? '—';
  document.getElementById('rd-created').textContent = m.created_at ? new Date(m.created_at).toLocaleString() : '—';
  document.getElementById('rd-runid').textContent   = state.runId ?? '—';
}

// ── Live event append ────────────────────────────────────────────────────────
function appendLiveEvent(ev) {
  // Update per-task counters
  if (ev.type === 'task_started' || ev.type === 'builder_task_prepared') activeTaskId = ev.task_id;
  if (ev.type === 'task_validated') activeTaskId = null;
  if (ev.type === 'tool_call') {
    const tid = ev.task_id ?? activeTaskId;
    if (tid) taskToolCalls[tid] = (taskToolCalls[tid] ?? 0) + 1;
  }
  const evTid = ev.task_id ?? (ev.type === 'tool_call' || ev.type === 'tool_result' ? activeTaskId : null);
  if (evTid) { if (!allTaskEvents[evTid]) allTaskEvents[evTid] = []; allTaskEvents[evTid].push({...ev, task_id: evTid}); }

  // Update task status in state
  if (ev.type === 'task_validated' && ev.task_id) {
    const t = (state.tasks || []).find(t => t.id === ev.task_id);
    if (t) t.status = ev.status;
  }

  // Update metrics
  if (!state.metrics) state.metrics = {};
  if (ev.type === 'tool_call') state.metrics.toolCalls = (state.metrics.toolCalls ?? 0) + 1;
  if (ev.type === 'guardrail_triggered') state.metrics.guardrailHits = (state.metrics.guardrailHits ?? 0) + 1;
  if (ev.type === 'cost_recorded') state.metrics.totalCost = (state.metrics.totalCost ?? 0) + Number(ev.usd ?? ev.cost ?? 0);

  // Prepend to log (column-reverse)
  const log = document.getElementById('event-log');
  log.insertBefore(makeEvRow(ev), log.firstChild);

  // Throttled re-render
  clearTimeout(renderTimer);
  renderTimer = setTimeout(renderAll, 200);
}
let renderTimer;

// ── Event row ────────────────────────────────────────────────────────────────
const EV_ICONS = {
  task_started:'🚀', builder_task_prepared:'📋', task_validated:'✅',
  tool_call:'🛠', tool_result:'📤', guardrail_triggered:'⚠️',
  memory_recalled:'🧠', episode_memory_written:'💾', stage_completed:'🏁',
  cost_recorded:'💵', quality_score_recorded:'📊', approval_gate_blocked:'🔒',
  run_started:'🎬', plan_created:'📌',
};

function makeEvRow(ev) {
  const row = document.createElement('div');
  row.className = 'ev-row';
  const ts = ev.ts ? ev.ts.replace('T',' ').replace('Z','').slice(0,19) : '';
  const detail = evDetail(ev);
  const icon = EV_ICONS[ev.type] ?? '·';
  const typeCls = 'ev-type ev-' + (ev.type ?? '').replace(/[^a-z0-9_]/g,'_');
  row.innerHTML = \`
    <span class="ev-ts">\${ts}</span>
    <span class="\${typeCls}">\${icon} \${esc(ev.type)}</span>
    <span class="ev-detail">\${esc(detail)}</span>\`;
  return row;
}

function evDetail(ev) {
  if (ev.type === 'tool_call') return (ev.tool ?? '') + (ev.input ? '  ' + JSON.stringify(ev.input).slice(0,60) : '');
  if (ev.type === 'tool_result') return (ev.tool ?? '') + (ev.isError ? ' ❌' : ' ✓') + (ev.summary ? '  ' + String(ev.summary).slice(0,60) : '');
  if (ev.type === 'task_started' || ev.type === 'builder_task_prepared') return 'task: ' + (ev.task_id ?? '');
  if (ev.type === 'task_validated') return 'task: ' + (ev.task_id ?? '') + '  status: ' + (ev.status ?? '');
  if (ev.type === 'guardrail_triggered') return (ev.limit_name ?? ev.limit ?? '?') + ' = ' + (ev.current_value ?? ev.value ?? '?') + ' / ' + (ev.limit_value ?? '?');
  if (ev.type === 'cost_recorded') return '$' + Number(ev.usd ?? ev.cost ?? 0).toFixed(4) + (ev.task_id ? '  task: ' + ev.task_id : '');
  if (ev.type === 'quality_score_recorded') return 'score: ' + (ev.score ?? '?') + (ev.task_id ? '  task: ' + ev.task_id : '');
  if (ev.type === 'memory_recalled') return (ev.count ?? ev.episode_count ?? 0) + ' episodes injected';
  if (ev.type === 'stage_completed') return 'stage: ' + (ev.stage_id ?? '') + '  elapsed: ' + (ev.elapsed_ms ?? 0) + 'ms';
  return Object.entries(ev).filter(([k]) => k !== 'type' && k !== 'ts').map(([k,v]) => k + ': ' + String(v).slice(0,40)).join('  ');
}

// ── Trace modal ──────────────────────────────────────────────────────────────
function showTrace(taskId) {
  const events = allTaskEvents[taskId] || [];
  const task = (state.tasks || []).find(t => t.id === taskId);

  document.getElementById('modal-title').textContent = 'Task Trace: ' + taskId + (task ? '  [' + (task.status ?? 'READY') + ']' : '');
  const body = document.getElementById('modal-body');
  body.innerHTML = '';

  // Stats row
  const toolEvs = events.filter(e => e.type === 'tool_call');
  const guardrailEvs = events.filter(e => e.type === 'guardrail_triggered');
  const memEvs = events.filter(e => e.type === 'memory_recalled');
  const statsDiv = document.createElement('div');
  statsDiv.style.cssText = 'display:flex;gap:20px;padding:10px 0;border-bottom:1px solid var(--border)';
  statsDiv.innerHTML = [
    ['Tool Calls', toolEvs.length, 'var(--blue)'],
    ['Guardrail Hits', guardrailEvs.length, 'var(--warn)'],
    ['Memory Recalls', memEvs.length, 'var(--violet)'],
  ].map(([l,v,c]) => \`<div style="text-align:center"><div style="font-size:22px;font-weight:700;color:\${c};\${v>0?'':'color:var(--dim)'}">\${v}</div><div style="font-size:9.5px;color:var(--dim);text-transform:uppercase;letter-spacing:.06em">\${l}</div></div>\`).join('');
  body.appendChild(statsDiv);

  // Tool call / result pairs
  const calls = events.filter(e => e.type === 'tool_call');
  const results = events.filter(e => e.type === 'tool_result');
  const resMap = {};
  for (const r of results) { if (!resMap[r.tool]) resMap[r.tool] = []; resMap[r.tool].push(r); }

  for (const call of calls) {
    const result = (resMap[call.tool ?? '__'] ?? []).shift() ?? null;
    const pair = document.createElement('div');
    pair.className = 'trace-pair';
    const inp = call.input ? JSON.stringify(call.input, null, 2) : '';
    const out = result?.summary ?? result?.output ?? '';
    const errBadge = result?.isError ? '<span class="pill pill-fail" style="font-size:9px">ERROR</span>' : '';
    pair.innerHTML = \`
      <div class="trace-call">
        <span class="trace-tool">🛠 \${esc(call.tool ?? 'unknown')}</span>
        \${errBadge}
        <span class="trace-ts">\${call.ts ?? ''}</span>
      </div>
      <div class="trace-io">
        \${inp ? \`<div class="trace-lbl">Input</div><pre class="trace-pre">\${esc(inp.slice(0,1000))}</pre>\` : ''}
        \${out ? \`<div class="trace-lbl" style="margin-top:8px">Output</div><pre class="trace-pre out">\${esc(String(out).slice(0,1200))}</pre>\` : ''}
      </div>\`;
    body.appendChild(pair);
  }

  if (calls.length === 0) {
    const empty = document.createElement('p');
    empty.style.cssText = 'color:var(--dim);font-style:italic;padding:12px 0';
    empty.textContent = 'No tool calls recorded yet for this task.';
    body.appendChild(empty);
  }

  document.getElementById('trace-modal').classList.add('open');
}

function closeModal() {
  document.getElementById('trace-modal').classList.remove('open');
}
document.getElementById('trace-modal').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeModal();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

// ── Utils ────────────────────────────────────────────────────────────────────
function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Boot ─────────────────────────────────────────────────────────────────────
connect();
</script>
</body>
</html>`;
}

// ── HTTP + WebSocket server ───────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/api/snapshot') {
    const runId  = await latestRunId(PROJECT_ROOT);
    const snap   = await buildSnapshot(PROJECT_ROOT, runId);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(snap));
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(dashboardHtml(PORT));
});

server.on('upgrade', async (req, socket, _head) => {
  if (req.headers.upgrade?.toLowerCase() !== 'websocket') { socket.destroy(); return; }
  if (!wsHandshake(req, socket)) return;

  clients.add(socket);
  socket.on('error', () => clients.delete(socket));
  socket.on('close', () => clients.delete(socket));

  // Send full snapshot to this new client
  const runId = await latestRunId(PROJECT_ROOT);
  if (runId !== currentRunId) {
    currentRunId  = runId;
    currentRunDir = runId ? join(PROJECT_ROOT, '.rstack', 'runs', runId) : null;
    const evPath  = currentRunDir ? join(currentRunDir, 'events.jsonl') : null;
    if (evPath) {
      lastEventCount = readJsonlSync(evPath).length;
      startTailing(evPath);
    }
  }
  const snap = await buildSnapshot(PROJECT_ROOT, runId);
  wsSend(socket, snap);
});

// ── Watch for new runs appearing ──────────────────────────────────────────────

setInterval(async () => {
  const runId = await latestRunId(PROJECT_ROOT);
  if (runId && runId !== currentRunId) {
    currentRunId  = runId;
    currentRunDir = join(PROJECT_ROOT, '.rstack', 'runs', runId);
    lastEventCount = 0;
    startTailing(join(currentRunDir, 'events.jsonl'));
    const snap = await buildSnapshot(PROJECT_ROOT, runId);
    broadcast(snap);
    broadcast({ kind: 'event', event: { type: 'observer_new_run', run_id: runId, ts: new Date().toISOString() } });
  }
}, 5000);

// ── Boot ──────────────────────────────────────────────────────────────────────

server.listen(PORT, '127.0.0.1', async () => {
  const url = `http://localhost:${PORT}`;
  console.log(`\n  RStack Observer — live SDLC observability`);
  console.log(`  Project: ${PROJECT_ROOT}`);
  console.log(`  Dashboard: ${url}\n`);
  if (PINNED_RUN) console.log(`  Pinned run: ${PINNED_RUN}`);

  // Find active run and start tailing
  const runId = PINNED_RUN ?? await latestRunId(PROJECT_ROOT);
  if (runId) {
    currentRunId  = runId;
    currentRunDir = join(PROJECT_ROOT, '.rstack', 'runs', runId);
    const evPath  = join(currentRunDir, 'events.jsonl');
    lastEventCount = readJsonlSync(evPath).length;
    startTailing(evPath);
    console.log(`  Active run: ${runId}`);
  } else {
    console.log(`  No active run yet — will detect automatically.`);
  }

  if (!NO_BROWSER) openBrowser(url);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`  Port ${PORT} is already in use. Set RSTACK_OBSERVER_PORT=<other> and retry.`);
  } else {
    console.error(`  Server error:`, err.message);
  }
  process.exit(1);
});

process.on('SIGINT',  () => { server.close(); process.exit(0); });
process.on('SIGTERM', () => { server.close(); process.exit(0); });
