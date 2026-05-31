import { createServer }       from 'node:http';
import { existsSync, readFileSync, watchFile } from 'node:fs';
import { readFile, readdir, mkdir } from 'node:fs/promises';
import { join, resolve }      from 'node:path';
import { spawn }              from 'node:child_process';
import { evaluateAlerts, plainLanguageSummary, DEFAULT_ALERT_THRESHOLDS } from './alert-engine.js';
import { readApprovals, resolveApproval, pendingApprovals, approvalSummary } from './approval-queue.js';

// owner: RStack developed by Richardson Gunde

// ── CLI ──────────────────────────────────────────────────────────────────────

function parseArgv(argv) {
  const out = { port: null, project: null, noBrowser: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if ((a === '--port')    && argv[i + 1]) out.port    = Number(argv[++i]);
    if ((a === '--project') && argv[i + 1]) out.project = argv[++i];
    if (a === '--no-browser') out.noBrowser = true;
  }
  return out;
}

const CLI          = parseArgv(process.argv.slice(2));
const PORT         = CLI.port    ?? Number(process.env.RSTACK_BUSINESS_PORT ?? 3008);
const PROJECT_ROOT = CLI.project ? resolve(CLI.project)
                                 : resolve(process.env.RSTACK_PROJECT_ROOT ?? process.cwd());
const NO_BROWSER   = CLI.noBrowser || process.env.RSTACK_NO_BROWSER === '1';

// ── Utilities ────────────────────────────────────────────────────────────────

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

// ── WebSocket (zero-dep) ──────────────────────────────────────────────────────

import { createHash } from 'node:crypto';

function wsHandshake(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return false; }
  const accept = createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );
  return true;
}

function wsFrame(data) {
  const payload = Buffer.from(JSON.stringify(data));
  const len = payload.length;
  const frame = len < 126
    ? Buffer.alloc(2 + len)
    : Buffer.alloc(4 + len);
  frame[0] = 0x81;
  if (len < 126) {
    frame[1] = len;
    payload.copy(frame, 2);
  } else {
    frame[1] = 126;
    frame.writeUInt16BE(len, 2);
    payload.copy(frame, 4);
  }
  return frame;
}

function wsSend(socket, data) {
  try { socket.write(wsFrame(data)); } catch { /* closed */ }
}

// ── State ─────────────────────────────────────────────────────────────────────

const clients = new Set();

function broadcast(msg) {
  for (const s of clients) wsSend(s, msg);
}

// ── Multi-run aggregation ─────────────────────────────────────────────────────

async function getAllRuns(projectRoot) {
  const runsDir = join(projectRoot, '.rstack', 'runs');
  if (!existsSync(runsDir)) return [];
  let entries;
  try { entries = await readdir(runsDir); } catch { return []; }

  const runs = await Promise.all(entries.map(async (runId) => {
    const runDir = join(runsDir, runId);
    const [manifest, metrics, tasksRaw] = await Promise.all([
      readJson(join(runDir, 'manifest.json'), {}),
      readJson(join(runDir, 'metrics.json'), {}),
      readJson(join(runDir, 'tasks.json'), null),
    ]);
    const tasks = Array.isArray(tasksRaw)
      ? tasksRaw
      : Array.isArray(tasksRaw?.tasks) ? tasksRaw.tasks : [];

    const events = readJsonlSync(join(runDir, 'events.jsonl'));
    return { runId, manifest, metrics, tasks, events };
  }));

  // Sort newest first (run IDs are typically timestamped)
  return runs.sort((a, b) => b.runId.localeCompare(a.runId));
}

async function buildFullState(projectRoot) {
  const [runs, allApprovals] = await Promise.all([
    getAllRuns(projectRoot),
    readApprovals(projectRoot),
  ]);

  const pending = pendingApprovals(allApprovals);
  const approvalStats = approvalSummary(allApprovals);

  const totalCost = runs.reduce((s, r) => s + (r.metrics?.cumulative_cost_usd ?? 0), 0);
  const activeRuns = runs.filter(r => !r.manifest?.completed_at && r.runId);
  const todayRuns = runs.filter(r => {
    const d = r.manifest?.created_at;
    if (!d) return false;
    const today = new Date().toISOString().slice(0, 10);
    return d.startsWith(today);
  });

  // Build business activity feed: stage completions + task validations + notable events
  const activityFeed = [];
  for (const run of runs.slice(0, 10)) {
    for (const ev of run.events) {
      const summary = plainLanguageSummary(ev);
      if (summary) {
        activityFeed.push({
          ts: ev.ts,
          summary,
          type: ev.type,
          runId: run.runId,
          goal: run.manifest?.goal,
          level: ev.type === 'task_validated' && ev.status === 'FAIL' ? 'fail'
               : ev.type === 'guardrail_triggered' ? 'warn'
               : ev.type === 'approval_gate_blocked' ? 'blocked'
               : 'info',
        });
      }
    }
  }
  activityFeed.sort((a, b) => (b.ts ?? '').localeCompare(a.ts ?? ''));
  const feed = activityFeed.slice(0, 200);

  // Framework/team breakdown
  const frameworks = {};
  for (const run of runs) {
    const fw = run.manifest?.framework ?? run.manifest?.mode ?? 'unknown';
    if (!frameworks[fw]) frameworks[fw] = { runs: 0, cost: 0, pass: 0, fail: 0 };
    frameworks[fw].runs++;
    frameworks[fw].cost += run.metrics?.cumulative_cost_usd ?? 0;
    for (const t of run.tasks) {
      if (t.status === 'PASS') frameworks[fw].pass++;
      if (t.status === 'FAIL') frameworks[fw].fail++;
    }
  }

  // Traceability: map run requirements → artifacts
  const traceMap = [];
  for (const run of runs.slice(0, 5)) {
    const stageArtifactsDir = join(projectRoot, '.rstack', 'runs', run.runId, 'artifacts', 'stages');
    const reqFile = join(stageArtifactsDir, '02-requirements', 'requirements.json');
    const archDir  = join(stageArtifactsDir, '06-architecture');
    const codeFile = join(stageArtifactsDir, '07-code', 'implementation-report.json');
    const testFile = join(stageArtifactsDir, '08-testing', 'qa-report.json');

    const [reqs, hasCode, hasTest] = await Promise.all([
      readJson(reqFile, null),
      readJson(codeFile, null).then(v => v !== null),
      readJson(testFile, null).then(v => v !== null),
    ]);
    const hasArch = existsSync(archDir) && (await readdir(archDir).then(f => f.length > 0).catch(() => false));

    const requirements = Array.isArray(reqs)
      ? reqs
      : Array.isArray(reqs?.functional) ? reqs.functional
      : Array.isArray(reqs?.requirements) ? reqs.requirements : [];

    if (requirements.length > 0 || hasArch || hasCode) {
      traceMap.push({
        runId: run.runId,
        goal: run.manifest?.goal ?? '—',
        requirements: requirements.slice(0, 20),
        stages: {
          requirements: requirements.length > 0,
          architecture: hasArch,
          code: hasCode,
          testing: hasTest,
        },
        passTasks: run.tasks.filter(t => t.status === 'PASS').map(t => ({
          id: t.id,
          title: t.title ?? t.id,
          stageArtifacts: t.stage_artifacts ?? [],
        })),
      });
    }
  }

  const alertsState = { runs, pendingApprovals: pending.length };
  const alerts = evaluateAlerts(alertsState);

  return {
    kind: 'snapshot',
    runs,
    activeRuns: activeRuns.map(r => r.runId),
    todayCount: todayRuns.length,
    totalRuns: runs.length,
    totalCost,
    frameworks,
    feed,
    approvals: allApprovals,
    approvalStats,
    pendingApprovals: pending,
    alerts,
    traceMap,
    ts: new Date().toISOString(),
  };
}

// ── Live polling ──────────────────────────────────────────────────────────────

let pollInterval = null;

function startPolling() {
  if (pollInterval) return;
  pollInterval = setInterval(async () => {
    try {
      const state = await buildFullState(PROJECT_ROOT);
      broadcast(state);
    } catch { /* best-effort */ }
  }, 3000);
}

// ── HTTP + WebSocket server ───────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // CORS for API calls
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (url.pathname === '/api/state' && req.method === 'GET') {
    const state = await buildFullState(PROJECT_ROOT);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(state));
    return;
  }

  if (url.pathname === '/api/approve' && req.method === 'POST') {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', async () => {
      const { id, resolvedBy } = safeJson(body) ?? {};
      const ok = await resolveApproval(PROJECT_ROOT, id, 'approved', resolvedBy ?? 'dashboard');
      res.writeHead(ok ? 200 : 404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok }));
      if (ok) {
        const state = await buildFullState(PROJECT_ROOT);
        broadcast(state);
      }
    });
    return;
  }

  if (url.pathname === '/api/reject' && req.method === 'POST') {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', async () => {
      const { id, resolvedBy } = safeJson(body) ?? {};
      const ok = await resolveApproval(PROJECT_ROOT, id, 'rejected', resolvedBy ?? 'dashboard');
      res.writeHead(ok ? 200 : 404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok }));
      if (ok) {
        const state = await buildFullState(PROJECT_ROOT);
        broadcast(state);
      }
    });
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(dashboardHtml(PORT));
});

server.on('upgrade', async (req, socket) => {
  if (req.headers.upgrade?.toLowerCase() !== 'websocket') { socket.destroy(); return; }
  if (!wsHandshake(req, socket)) return;

  clients.add(socket);
  socket.on('error', () => clients.delete(socket));
  socket.on('close', () => clients.delete(socket));

  const state = await buildFullState(PROJECT_ROOT);
  wsSend(socket, state);
  startPolling();
});

// ── Boot ──────────────────────────────────────────────────────────────────────

server.listen(PORT, '127.0.0.1', async () => {
  const url = `http://localhost:${PORT}`;
  console.log(`\n  RStack Business Hub — live observability for your team`);
  console.log(`  Project : ${PROJECT_ROOT}`);
  console.log(`  Dashboard: ${url}\n`);
  if (!NO_BROWSER) openBrowser(url);
  startPolling();
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`  Port ${PORT} in use. Set RSTACK_BUSINESS_PORT=<other> and retry.`);
  } else {
    console.error(`  Server error:`, err.message);
  }
  process.exit(1);
});

process.on('SIGINT', () => { server.close(); process.exit(0); });

// ── Dashboard HTML ─────────────────────────────────────────────────────────────

function dashboardHtml(port) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>RStack Business Hub</title>
<style>
:root{
  --bg:#090e18;--surface:#0f1623;--panel:#141d2e;--panel2:#1a2438;
  --border:#1e2d45;--border2:#263550;
  --text:#e8edf5;--dim:#6b7fa3;--dim2:#4a5f85;
  --accent:#ea580c;--accent2:#f97316;--accent3:rgba(234,88,12,.12);
  --pass:#22c55e;--pass-bg:rgba(34,197,94,.1);
  --fail:#ef4444;--fail-bg:rgba(239,68,68,.1);
  --warn:#f59e0b;--warn-bg:rgba(245,158,11,.1);
  --info:#3b82f6;--info-bg:rgba(59,130,246,.1);
  --blocked:#8b5cf6;--blocked-bg:rgba(139,92,246,.1);
  --f:'Inter',system-ui,sans-serif;--m:'JetBrains Mono','Fira Code',monospace;
}
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%}
body{font-family:var(--f);background:var(--bg);color:var(--text);font-size:13.5px;line-height:1.55;overflow:hidden;
  background-image:radial-gradient(ellipse at 10% 0%,rgba(234,88,12,.06) 0,transparent 55%),
                   radial-gradient(ellipse at 90% 100%,rgba(139,92,246,.05) 0,transparent 55%)}

/* ── Layout ── */
#app{display:flex;flex-direction:column;height:100vh}
nav{flex-shrink:0;background:var(--surface);border-bottom:1px solid var(--border2);
    padding:0 20px;display:flex;align-items:center;gap:0;height:52px}
.nav-brand{font-size:15px;font-weight:800;color:var(--accent);letter-spacing:-.03em;margin-right:24px;white-space:nowrap}
.nav-brand span{color:var(--text);font-weight:600}
.nav-tabs{display:flex;gap:2px;flex:1}
.nav-tab{padding:8px 14px;border-radius:6px;font-size:12px;font-weight:600;color:var(--dim);cursor:pointer;
  transition:all .15s;white-space:nowrap;border:none;background:none;letter-spacing:.01em}
.nav-tab:hover{color:var(--text);background:var(--panel)}
.nav-tab.active{color:var(--accent2);background:var(--accent3)}
.nav-status{display:flex;align-items:center;gap:12px;margin-left:auto;flex-shrink:0}
.ws-chip{display:flex;align-items:center;gap:5px;font-size:11px;font-weight:600;
  padding:4px 10px;border-radius:20px;background:var(--panel);border:1px solid var(--border2)}
.ws-dot{width:6px;height:6px;border-radius:50%;background:#444;transition:background .4s}
.ws-dot.live{background:var(--pass);box-shadow:0 0 8px var(--pass);animation:pulse-dot 2s infinite}
.ws-dot.offline{background:var(--fail)}
@keyframes pulse-dot{0%,100%{opacity:1;box-shadow:0 0 8px var(--pass)}50%{opacity:.6;box-shadow:0 0 4px var(--pass)}}
.alert-badge{min-width:20px;height:20px;border-radius:10px;padding:0 6px;font-size:10px;font-weight:800;
  display:flex;align-items:center;justify-content:center;background:var(--warn);color:#000}
.alert-badge.none{background:var(--border2);color:var(--dim)}

.tab-content{flex:1;overflow:hidden;display:none}
.tab-content.active{display:flex;flex-direction:column;overflow:hidden}

/* ── Scrollable pane ── */
.scroll{overflow-y:auto;flex:1;padding:20px}

/* ── KPI row ── */
.kpi-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:20px}
.kpi{background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:16px 18px;
  position:relative;overflow:hidden;transition:border-color .2s}
.kpi:hover{border-color:var(--border2)}
.kpi::before{content:'';position:absolute;inset:0;border-radius:12px;opacity:0;transition:opacity .2s;
  background:radial-gradient(ellipse at top left,var(--accent3),transparent 70%)}
.kpi:hover::before{opacity:1}
.kpi-val{font-size:26px;font-weight:800;font-family:var(--m);line-height:1;margin-bottom:4px}
.kpi-label{font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--dim)}
.kpi-sub{font-size:11px;color:var(--dim2);margin-top:4px}
.kpi-val.orange{color:var(--accent2)}.kpi-val.green{color:var(--pass)}.kpi-val.red{color:var(--fail)}
.kpi-val.yellow{color:var(--warn)}.kpi-val.blue{color:var(--info)}.kpi-val.violet{color:var(--blocked)}

/* ── Two-column grid ── */
.two-col{display:grid;grid-template-columns:1fr 380px;gap:16px;flex:1;min-height:0}
@media(max-width:1100px){.two-col{grid-template-columns:1fr}}

/* ── Card ── */
.card{background:var(--panel);border:1px solid var(--border);border-radius:12px;overflow:hidden;display:flex;flex-direction:column}
.card-hdr{padding:11px 16px;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;
  color:var(--dim);border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px;flex-shrink:0}
.card-hdr .live-dot{width:5px;height:5px;border-radius:50%;background:var(--pass);animation:blink 1.4s infinite;flex-shrink:0}
@keyframes blink{0%,100%{opacity:1}50%{opacity:.25}}
.card-body{padding:14px 16px;flex:1;overflow-y:auto}

/* ── Feed ── */
.feed-item{padding:9px 0;border-bottom:1px solid var(--border);display:flex;gap:10px;align-items:flex-start}
.feed-item:last-child{border-bottom:none}
.feed-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;margin-top:4px}
.feed-dot.info{background:var(--info)}.feed-dot.warn{background:var(--warn)}
.feed-dot.fail{background:var(--fail)}.feed-dot.blocked{background:var(--blocked)}
.feed-dot.pass{background:var(--pass)}
.feed-summary{font-size:12.5px;color:var(--text);flex:1}
.feed-run{font-size:10px;color:var(--dim);font-family:var(--m);margin-top:2px}
.feed-ts{font-size:10px;color:var(--dim2);white-space:nowrap;flex-shrink:0}
.feed-empty{color:var(--dim);font-size:12px;padding:20px 0;text-align:center;font-style:italic}

/* ── Pill ── */
.pill{display:inline-flex;align-items:center;font-size:9.5px;font-weight:700;padding:2px 7px;
  border-radius:4px;text-transform:uppercase;letter-spacing:.05em;white-space:nowrap}
.pill.pass{background:var(--pass-bg);color:var(--pass);border:1px solid rgba(34,197,94,.25)}
.pill.fail{background:var(--fail-bg);color:var(--fail);border:1px solid rgba(239,68,68,.25)}
.pill.warn{background:var(--warn-bg);color:var(--warn);border:1px solid rgba(245,158,11,.25)}
.pill.info{background:var(--info-bg);color:var(--info);border:1px solid rgba(59,130,246,.25)}
.pill.blocked{background:var(--blocked-bg);color:var(--blocked);border:1px solid rgba(139,92,246,.25)}
.pill.active{background:rgba(234,88,12,.15);color:var(--accent2);border:1px solid rgba(234,88,12,.3)}
.pill.idle{background:var(--panel2);color:var(--dim);border:1px solid var(--border)}

/* ── Run list ── */
.run-row{padding:10px 0;border-bottom:1px solid var(--border);display:flex;gap:12px;align-items:center;cursor:pointer;transition:background .15s}
.run-row:last-child{border-bottom:none}
.run-row:hover{background:rgba(255,255,255,.02);border-radius:6px;margin:0 -8px;padding:10px 8px}
.run-id{font-family:var(--m);font-size:10px;color:var(--dim2);flex-shrink:0;width:120px;overflow:hidden;text-overflow:ellipsis}
.run-goal{font-size:12.5px;color:var(--text);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.run-meta{display:flex;gap:8px;align-items:center;flex-shrink:0}
.run-cost{font-family:var(--m);font-size:11px;color:var(--accent2)}

/* ── Approval queue ── */
.approval-card{background:var(--panel2);border:1px solid var(--border2);border-radius:10px;
  padding:14px 16px;margin-bottom:12px;transition:border-color .2s}
.approval-card.pending{border-left:3px solid var(--warn)}
.approval-card.approved{border-left:3px solid var(--pass);opacity:.6}
.approval-card.rejected{border-left:3px solid var(--fail);opacity:.6}
.approval-title{font-size:13px;font-weight:700;margin-bottom:4px}
.approval-detail{font-size:11.5px;color:var(--dim);margin-bottom:10px;line-height:1.5}
.approval-meta{font-size:10.5px;color:var(--dim2);margin-bottom:12px;font-family:var(--m)}
.approval-actions{display:flex;gap:8px}
.btn{padding:6px 14px;border-radius:6px;border:none;font-size:12px;font-weight:700;cursor:pointer;
  transition:all .15s;letter-spacing:.01em}
.btn-approve{background:var(--pass);color:#000}.btn-approve:hover{filter:brightness(1.1)}
.btn-reject{background:var(--fail-bg);color:var(--fail);border:1px solid rgba(239,68,68,.3)}
.btn-reject:hover{background:var(--fail);color:#fff}
.approval-empty{color:var(--dim);text-align:center;padding:40px 0;font-style:italic}

/* ── Alert list ── */
.alert-row{padding:12px 14px;border-radius:8px;margin-bottom:8px;display:flex;gap:12px;align-items:flex-start;
  border:1px solid transparent}
.alert-row.warn{background:var(--warn-bg);border-color:rgba(245,158,11,.2)}
.alert-row.critical{background:var(--fail-bg);border-color:rgba(239,68,68,.2)}
.alert-row.info{background:var(--info-bg);border-color:rgba(59,130,246,.2)}
.alert-icon{font-size:18px;flex-shrink:0;line-height:1}
.alert-title{font-size:12.5px;font-weight:700;margin-bottom:3px}
.alert-detail{font-size:11.5px;color:var(--dim)}
.alert-empty{color:var(--dim);text-align:center;padding:40px 0;font-style:italic}

/* ── Progress bar ── */
.pbar-row{margin-bottom:12px}
.pbar-label{display:flex;justify-content:space-between;font-size:11.5px;margin-bottom:5px}
.pbar-label .val{font-family:var(--m);font-size:11px}
.pbar{height:5px;background:var(--border2);border-radius:3px;overflow:hidden}
.pbar-fill{height:100%;border-radius:3px;transition:width .5s ease}
.pbar-fill.safe{background:var(--pass)}.pbar-fill.warn{background:var(--warn)}.pbar-fill.danger{background:var(--fail)}

/* ── Trace tree ── */
.trace-run{margin-bottom:20px}
.trace-goal{font-size:14px;font-weight:700;margin-bottom:10px;color:var(--text)}
.trace-stages{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}
.trace-stage{padding:5px 10px;border-radius:6px;font-size:11px;font-weight:700;
  display:flex;align-items:center;gap:5px}
.trace-stage.done{background:var(--pass-bg);color:var(--pass);border:1px solid rgba(34,197,94,.25)}
.trace-stage.pending{background:var(--panel2);color:var(--dim);border:1px solid var(--border)}
.trace-reqs{margin-bottom:10px}
.trace-req{padding:5px 10px;background:var(--panel2);border-radius:6px;font-size:11.5px;
  margin-bottom:4px;border-left:2px solid var(--info);color:var(--text)}
.trace-req-id{font-family:var(--m);font-size:9.5px;color:var(--dim);margin-bottom:2px}
.trace-tasks{margin-top:10px}
.trace-task-row{display:flex;align-items:center;gap:8px;padding:5px 0;font-size:11.5px;
  border-bottom:1px solid var(--border)}
.trace-task-row:last-child{border-bottom:none}

/* ── Framework table ── */
.fw-table{width:100%;border-collapse:collapse}
.fw-table th{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;
  color:var(--dim);padding:6px 10px;text-align:left;border-bottom:1px solid var(--border)}
.fw-table td{padding:9px 10px;border-bottom:1px solid var(--border);font-size:12px}
.fw-table tr:last-child td{border-bottom:none}
.fw-table td:not(:first-child){font-family:var(--m);font-size:11px}

/* ── Empty state ── */
.empty-state{display:flex;flex-direction:column;align-items:center;justify-content:center;
  padding:60px 20px;gap:12px;color:var(--dim);text-align:center}
.empty-icon{font-size:40px;opacity:.4}
.empty-title{font-size:15px;font-weight:700;color:var(--text)}
.empty-sub{font-size:12.5px;max-width:340px}

/* ── Scrollbar ── */
::-webkit-scrollbar{width:5px;height:5px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:var(--border2);border-radius:3px}
</style>
</head>
<body>
<div id="app">
  <nav>
    <div class="nav-brand">RStack <span>Business Hub</span></div>
    <div class="nav-tabs">
      <button class="nav-tab active" data-tab="overview">Overview</button>
      <button class="nav-tab" data-tab="feed">Live Feed</button>
      <button class="nav-tab" data-tab="approvals">Approvals <span id="tab-approval-count"></span></button>
      <button class="nav-tab" data-tab="alerts">Alerts <span id="tab-alert-count"></span></button>
      <button class="nav-tab" data-tab="history">Run History</button>
      <button class="nav-tab" data-tab="traceability">Traceability</button>
      <button class="nav-tab" data-tab="team">Team</button>
    </div>
    <div class="nav-status">
      <div id="alert-badge" class="alert-badge none">0</div>
      <div class="ws-chip">
        <div class="ws-dot offline" id="ws-dot"></div>
        <span id="ws-label">connecting</span>
      </div>
    </div>
  </nav>

  <!-- OVERVIEW -->
  <div class="tab-content active scroll" id="tab-overview">
    <div class="kpi-row" id="kpi-row">
      <div class="kpi"><div class="kpi-val orange" id="kpi-active">—</div><div class="kpi-label">Active Runs</div></div>
      <div class="kpi"><div class="kpi-val blue" id="kpi-today">—</div><div class="kpi-label">Runs Today</div></div>
      <div class="kpi"><div class="kpi-val orange" id="kpi-cost">—</div><div class="kpi-label">Total Cost</div></div>
      <div class="kpi"><div class="kpi-val green" id="kpi-pass">—</div><div class="kpi-label">Tasks Passed</div></div>
      <div class="kpi"><div class="kpi-val red" id="kpi-fail">—</div><div class="kpi-label">Tasks Failed</div></div>
      <div class="kpi"><div class="kpi-val yellow" id="kpi-pending">—</div><div class="kpi-label">Pending Approvals</div></div>
    </div>
    <div class="two-col">
      <div style="display:flex;flex-direction:column;gap:16px;min-height:0;overflow-y:auto">
        <div class="card">
          <div class="card-hdr"><div class="live-dot"></div>Business Activity</div>
          <div class="card-body" id="overview-feed" style="max-height:300px"></div>
        </div>
        <div class="card">
          <div class="card-hdr">Active Runs</div>
          <div class="card-body" id="active-runs-list"></div>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:16px">
        <div class="card">
          <div class="card-hdr">Guardrail Health</div>
          <div class="card-body" id="guardrail-summary"></div>
        </div>
        <div class="card">
          <div class="card-hdr">Alerts</div>
          <div class="card-body" id="overview-alerts" style="max-height:280px;overflow-y:auto"></div>
        </div>
      </div>
    </div>
  </div>

  <!-- LIVE FEED -->
  <div class="tab-content scroll" id="tab-feed">
    <div class="card" style="height:100%">
      <div class="card-hdr"><div class="live-dot"></div>Live Activity Feed — all runs, plain language</div>
      <div class="card-body" id="feed-list" style="max-height:none;height:100%"></div>
    </div>
  </div>

  <!-- APPROVALS -->
  <div class="tab-content scroll" id="tab-approvals">
    <div style="max-width:780px;margin:0 auto">
      <div id="approvals-list"></div>
    </div>
  </div>

  <!-- ALERTS -->
  <div class="tab-content scroll" id="tab-alerts">
    <div style="max-width:780px;margin:0 auto">
      <div id="alerts-list"></div>
    </div>
  </div>

  <!-- HISTORY -->
  <div class="tab-content scroll" id="tab-history">
    <div class="card">
      <div class="card-hdr">All Runs</div>
      <div class="card-body" id="history-list"></div>
    </div>
  </div>

  <!-- TRACEABILITY -->
  <div class="tab-content scroll" id="tab-traceability">
    <div id="trace-list"></div>
  </div>

  <!-- TEAM -->
  <div class="tab-content scroll" id="tab-team">
    <div class="card">
      <div class="card-hdr">Framework / Team Breakdown</div>
      <div class="card-body" id="team-table"></div>
    </div>
  </div>
</div>

<script>
// ── State ────────────────────────────────────────────────────────────────────
let STATE = null;
const PORT = ${port};

// ── Tab switching ─────────────────────────────────────────────────────────────
document.querySelectorAll('.nav-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    document.querySelectorAll('.nav-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.getElementById('tab-' + tab).classList.add('active');
  });
});

// ── WebSocket ─────────────────────────────────────────────────────────────────
const wsDot   = document.getElementById('ws-dot');
const wsLabel = document.getElementById('ws-label');
let ws, reconnectTimer;

function connect() {
  ws = new WebSocket('ws://localhost:' + PORT);
  ws.onopen = () => {
    wsDot.className = 'ws-dot live';
    wsLabel.textContent = 'live';
    clearTimeout(reconnectTimer);
  };
  ws.onmessage = e => {
    try { applyState(JSON.parse(e.data)); } catch {}
  };
  ws.onclose = ws.onerror = () => {
    wsDot.className = 'ws-dot offline';
    wsLabel.textContent = 'offline';
    reconnectTimer = setTimeout(connect, 2500);
  };
}

// ── Apply state ───────────────────────────────────────────────────────────────
function applyState(s) {
  STATE = s;
  renderKPIs();
  renderOverviewFeed();
  renderActiveRuns();
  renderGuardrails();
  renderOverviewAlerts();
  renderFeed();
  renderApprovals();
  renderAlerts();
  renderHistory();
  renderTraceability();
  renderTeam();
}

// ── KPIs ──────────────────────────────────────────────────────────────────────
function renderKPIs() {
  const s = STATE;
  const allTasks = (s.runs ?? []).flatMap(r => r.tasks ?? []);
  setText('kpi-active', s.activeRuns?.length ?? 0);
  setText('kpi-today', s.todayCount ?? 0);
  setText('kpi-cost', '$' + (s.totalCost ?? 0).toFixed(3));
  setText('kpi-pass', allTasks.filter(t => t.status === 'PASS').length);
  setText('kpi-fail', allTasks.filter(t => t.status === 'FAIL').length);
  setText('kpi-pending', s.approvalStats?.pending ?? 0);

  // Alert badge
  const alertCount = (s.alerts ?? []).length;
  const badge = document.getElementById('alert-badge');
  badge.textContent = alertCount;
  badge.className = 'alert-badge' + (alertCount > 0 ? '' : ' none');

  // Approval tab count
  const pendingCount = s.approvalStats?.pending ?? 0;
  const approvalSpan = document.getElementById('tab-approval-count');
  approvalSpan.textContent = pendingCount > 0 ? ' (' + pendingCount + ')' : '';
  approvalSpan.style.color = pendingCount > 0 ? 'var(--warn)' : '';

  // Alerts tab count
  const alertSpan = document.getElementById('tab-alert-count');
  alertSpan.textContent = alertCount > 0 ? ' (' + alertCount + ')' : '';
  alertSpan.style.color = alertCount > 0 ? 'var(--warn)' : '';
}

// ── Overview feed ─────────────────────────────────────────────────────────────
function renderOverviewFeed() {
  const el = document.getElementById('overview-feed');
  const feed = (STATE.feed ?? []).slice(0, 20);
  if (!feed.length) { el.innerHTML = '<div class="feed-empty">No activity yet — start a run to see live updates</div>'; return; }
  el.innerHTML = feed.map(f => feedItemHtml(f)).join('');
}

function feedItemHtml(f) {
  const ts = f.ts ? f.ts.replace('T',' ').slice(0,16) : '';
  const goalStr = f.goal ? ' · ' + esc(f.goal).slice(0,40) : '';
  const runStr  = f.runId ? esc(f.runId.slice(-10)) + goalStr : '';
  return \`<div class="feed-item">
    <div class="feed-dot \${f.level ?? 'info'}"></div>
    <div style="flex:1">
      <div class="feed-summary">\${esc(f.summary)}</div>
      \${runStr ? \`<div class="feed-run">\${runStr}</div>\` : ''}
    </div>
    <div class="feed-ts">\${ts}</div>
  </div>\`;
}

// ── Active runs ───────────────────────────────────────────────────────────────
function renderActiveRuns() {
  const el = document.getElementById('active-runs-list');
  const active = (STATE.runs ?? []).filter(r => (STATE.activeRuns ?? []).includes(r.runId));
  if (!active.length) {
    el.innerHTML = '<div class="feed-empty">No active runs right now</div>';
    return;
  }
  el.innerHTML = active.map(r => {
    const tasks = r.tasks ?? [];
    const done = tasks.filter(t => t.status === 'PASS' || t.status === 'FAIL').length;
    const pct = tasks.length ? Math.round(done / tasks.length * 100) : 0;
    const cost = (r.metrics?.cumulative_cost_usd ?? 0).toFixed(4);
    return \`<div class="run-row">
      <div class="run-id">\${esc(r.runId.slice(-14))}</div>
      <div style="flex:1">
        <div class="run-goal">\${esc(r.manifest?.goal ?? 'No goal set')}</div>
        <div style="margin-top:6px">
          <div class="pbar"><div class="pbar-fill safe" style="width:\${pct}%"></div></div>
        </div>
        <div style="font-size:10.5px;color:var(--dim);margin-top:3px">\${done}/\${tasks.length} tasks · \${pct}% complete</div>
      </div>
      <div style="text-align:right;flex-shrink:0">
        <span class="pill active">ACTIVE</span>
        <div class="run-cost" style="margin-top:4px">$\${cost}</div>
      </div>
    </div>\`;
  }).join('');
}

// ── Guardrail summary ─────────────────────────────────────────────────────────
function renderGuardrails() {
  const el = document.getElementById('guardrail-summary');
  const allTasks = (STATE.runs ?? []).flatMap(r => r.tasks ?? []);
  const allEvents = (STATE.runs ?? []).flatMap(r => r.events ?? []);
  const toolCalls = allEvents.filter(e => e.type === 'tool_call').length;
  const guardrailHits = allEvents.filter(e => e.type === 'guardrail_triggered').length;
  const totalCost = STATE.totalCost ?? 0;

  el.innerHTML = [
    bar('Tool Calls (all runs)', toolCalls, 200),
    bar('Guardrail Hits (all runs)', guardrailHits, 10),
    bar('Total Cost ($)', totalCost, 10, '$', 4),
  ].join('');
}

function bar(label, val, max, prefix = '', decimals = 0) {
  const pct = Math.min(100, (val / max) * 100);
  const cls = pct < 60 ? 'safe' : pct < 85 ? 'warn' : 'danger';
  const valStr = prefix + (decimals ? Number(val).toFixed(decimals) : val);
  return \`<div class="pbar-row">
    <div class="pbar-label"><span>\${label}</span><span class="val">\${valStr} / \${prefix}\${decimals ? Number(max).toFixed(decimals) : max}</span></div>
    <div class="pbar"><div class="pbar-fill \${cls}" style="width:\${pct.toFixed(1)}%"></div></div>
  </div>\`;
}

// ── Alerts (overview compact) ─────────────────────────────────────────────────
function renderOverviewAlerts() {
  const el = document.getElementById('overview-alerts');
  const alerts = (STATE.alerts ?? []).slice(0, 5);
  if (!alerts.length) { el.innerHTML = '<div class="alert-empty">All clear</div>'; return; }
  el.innerHTML = alerts.map(alertHtml).join('');
}

function alertHtml(a) {
  const icons = { warn:'⚠️', critical:'🔴', info:'ℹ️' };
  return \`<div class="alert-row \${a.level ?? 'info'}">
    <div class="alert-icon">\${icons[a.level] ?? 'ℹ️'}</div>
    <div>
      <div class="alert-title">\${esc(a.title)}</div>
      <div class="alert-detail">\${esc(a.detail)}</div>
    </div>
  </div>\`;
}

// ── Full feed ─────────────────────────────────────────────────────────────────
function renderFeed() {
  const el = document.getElementById('feed-list');
  const feed = STATE.feed ?? [];
  if (!feed.length) { el.innerHTML = '<div class="feed-empty">No events yet</div>'; return; }
  el.innerHTML = feed.map(f => feedItemHtml(f)).join('');
}

// ── Approvals ─────────────────────────────────────────────────────────────────
function renderApprovals() {
  const el = document.getElementById('approvals-list');
  const approvals = STATE.approvals ?? [];
  const pending = approvals.filter(a => !a.status || a.status === 'pending');
  const resolved = approvals.filter(a => a.status && a.status !== 'pending');

  if (!approvals.length) {
    el.innerHTML = '<div class="approval-empty">No approval requests yet.<br>Blocked actions will appear here for your review.</div>';
    return;
  }

  const pendingHtml = pending.map(a => approvalCardHtml(a, true)).join('');
  const resolvedHtml = resolved.map(a => approvalCardHtml(a, false)).join('');

  el.innerHTML = (pending.length ? '<div class="card-hdr" style="margin-bottom:12px">Pending Approvals (' + pending.length + ')</div>' + pendingHtml : '') +
    (resolved.length ? '<div class="card-hdr" style="margin:20px 0 12px">Resolved</div>' + resolvedHtml : '');
}

function approvalCardHtml(a, canAct) {
  const statusPill = a.status
    ? \`<span class="pill \${a.status === 'approved' ? 'pass' : a.status === 'rejected' ? 'fail' : 'warn'}">\${a.status.toUpperCase()}</span>\`
    : '<span class="pill warn">PENDING</span>';

  return \`<div class="approval-card \${a.status ?? 'pending'}">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
      <div class="approval-title">\${esc(a.title ?? a.type ?? 'Action requires approval')}</div>
      \${statusPill}
    </div>
    <div class="approval-detail">\${esc(a.detail ?? a.reason ?? '')}</div>
    <div class="approval-meta">Run: \${esc(a.runId?.slice(-14) ?? '—')} · \${esc(a.ts?.replace('T',' ').slice(0,16) ?? '')}</div>
    \${canAct ? \`<div class="approval-actions">
      <button class="btn btn-approve" onclick="doApprove('\${esc(a.id)}')">Approve</button>
      <button class="btn btn-reject" onclick="doReject('\${esc(a.id)}')">Reject</button>
    </div>\` : ''}
  </div>\`;
}

async function doApprove(id) {
  await fetch('/api/approve', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id}) });
}
async function doReject(id) {
  await fetch('/api/reject', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id}) });
}

// ── Alerts (full) ─────────────────────────────────────────────────────────────
function renderAlerts() {
  const el = document.getElementById('alerts-list');
  const alerts = STATE.alerts ?? [];
  if (!alerts.length) {
    el.innerHTML = '<div class="alert-empty">No alerts — all thresholds within limits</div>';
    return;
  }
  el.innerHTML = alerts.map(alertHtml).join('');
}

// ── Run History ───────────────────────────────────────────────────────────────
function renderHistory() {
  const el = document.getElementById('history-list');
  const runs = STATE.runs ?? [];
  if (!runs.length) { el.innerHTML = '<div class="feed-empty">No runs recorded yet</div>'; return; }
  el.innerHTML = runs.map(r => {
    const tasks = r.tasks ?? [];
    const passed = tasks.filter(t => t.status === 'PASS').length;
    const failed = tasks.filter(t => t.status === 'FAIL').length;
    const cost = (r.metrics?.cumulative_cost_usd ?? 0).toFixed(4);
    const status = r.manifest?.completed_at ? 'done'
      : (STATE.activeRuns ?? []).includes(r.runId) ? 'active' : 'idle';
    const statusPill = status === 'active' ? '<span class="pill active">ACTIVE</span>'
      : status === 'done' ? '<span class="pill pass">DONE</span>'
      : '<span class="pill idle">IDLE</span>';
    const created = r.manifest?.created_at ? r.manifest.created_at.replace('T',' ').slice(0,16) : '—';
    return \`<div class="run-row">
      <div class="run-id">\${esc(r.runId.slice(-14))}</div>
      <div style="flex:1">
        <div class="run-goal">\${esc(r.manifest?.goal ?? '—')}</div>
        <div style="font-size:10px;color:var(--dim);margin-top:2px">\${created} · \${tasks.length} tasks · \${passed} pass / \${failed} fail</div>
      </div>
      <div class="run-meta">
        \${statusPill}
        <span class="run-cost">$\${cost}</span>
      </div>
    </div>\`;
  }).join('');
}

// ── Traceability ──────────────────────────────────────────────────────────────
function renderTraceability() {
  const el = document.getElementById('trace-list');
  const traceMap = STATE.traceMap ?? [];
  if (!traceMap.length) {
    el.innerHTML = \`<div class="empty-state">
      <div class="empty-icon">🔍</div>
      <div class="empty-title">No traceability data yet</div>
      <div class="empty-sub">Complete runs with requirements (stage 02) and architecture (stage 06) to see requirements → files → evidence maps here.</div>
    </div>\`;
    return;
  }

  el.innerHTML = traceMap.map(t => {
    const stagesHtml = [
      ['Requirements', t.stages.requirements],
      ['Architecture', t.stages.architecture],
      ['Code', t.stages.code],
      ['Testing', t.stages.testing],
    ].map(([label, done]) =>
      \`<div class="trace-stage \${done ? 'done' : 'pending'}">\${done ? '✅' : '⬜'} \${label}</div>\`
    ).join('');

    const reqsHtml = t.requirements.slice(0, 10).map(r => {
      const id = r.id ?? r.req_id ?? '';
      const text = r.description ?? r.text ?? r.title ?? JSON.stringify(r).slice(0,80);
      return \`<div class="trace-req"><div class="trace-req-id">\${esc(id)}</div>\${esc(text)}</div>\`;
    }).join('');

    const tasksHtml = t.passTasks.slice(0, 8).map(task =>
      \`<div class="trace-task-row">
        <span class="pill pass">PASS</span>
        <span style="flex:1">\${esc(task.title)}</span>
        <span style="font-family:var(--m);font-size:10px;color:var(--dim)">\${esc(task.id)}</span>
      </div>\`
    ).join('');

    return \`<div class="trace-run card" style="margin-bottom:16px">
      <div class="card-hdr">Run: \${esc(t.runId.slice(-14))}</div>
      <div class="card-body">
        <div class="trace-goal">\${esc(t.goal)}</div>
        <div style="font-size:10.5px;color:var(--dim);font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin:10px 0 6px">Pipeline stages</div>
        <div class="trace-stages">\${stagesHtml}</div>
        \${reqsHtml ? \`<div style="font-size:10.5px;color:var(--dim);font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin:10px 0 6px">Requirements (\${t.requirements.length})</div><div class="trace-reqs">\${reqsHtml}</div>\` : ''}
        \${tasksHtml ? \`<div style="font-size:10.5px;color:var(--dim);font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin:10px 0 6px">Verified tasks</div><div class="trace-tasks">\${tasksHtml}</div>\` : ''}
      </div>
    </div>\`;
  }).join('');
}

// ── Team ──────────────────────────────────────────────────────────────────────
function renderTeam() {
  const el = document.getElementById('team-table');
  const fw = STATE.frameworks ?? {};
  const entries = Object.entries(fw);
  if (!entries.length) { el.innerHTML = '<div class="feed-empty">No framework data yet</div>'; return; }

  el.innerHTML = \`<table class="fw-table">
    <thead><tr>
      <th>Framework</th><th>Runs</th><th>Tasks Pass</th><th>Tasks Fail</th>
      <th>Total Cost</th><th>Pass Rate</th>
    </tr></thead>
    <tbody>\${entries.map(([name, d]) => {
      const total = d.pass + d.fail;
      const rate = total ? Math.round(d.pass / total * 100) : 0;
      return \`<tr>
        <td style="font-weight:700">\${esc(name)}</td>
        <td>\${d.runs}</td>
        <td style="color:var(--pass)">\${d.pass}</td>
        <td style="color:var(--fail)">\${d.fail}</td>
        <td style="color:var(--accent2)">$\${d.cost.toFixed(4)}</td>
        <td><span class="pill \${rate >= 80 ? 'pass' : rate >= 50 ? 'warn' : 'fail'}">\${rate}%</span></td>
      </tr>\`;
    }).join('')}</tbody>
  </table>\`;
}

// ── Util ──────────────────────────────────────────────────────────────────────
function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Boot ──────────────────────────────────────────────────────────────────────
connect();
</script>
</body>
</html>`;
}
