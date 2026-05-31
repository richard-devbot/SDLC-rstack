import { createServer }       from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve }      from 'node:path';
import { spawn }              from 'node:child_process';
import { evaluateAlerts, plainLanguageSummary } from './alert-engine.js';
import { readApprovals, resolveApproval, pendingApprovals, approvalSummary } from './approval-queue.js';
import { knownProjectRoots } from './project-registry.js';
import { CANONICAL_SDLC_STAGES } from './stages.js';

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

async function enrichTasks(projectRoot, runId, tasks) {
  const tasksDir = join(projectRoot, '.rstack', 'runs', runId, 'tasks');
  return Promise.all((tasks ?? []).map(async (task) => {
    const taskDir = join(tasksDir, task.id);
    const [builder, validation, promptText] = await Promise.all([
      readJson(join(taskDir, 'builder.json'), null),
      readJson(join(taskDir, 'validation.json'), null),
      readFile(join(taskDir, 'prompt.md'), 'utf8').catch(() => ''),
    ]);
    return {
      ...task,
      builder,
      validation,
      prompt_preview: promptText ? promptText.slice(0, 700) : '',
      agent_name: builder?.agent ?? task.agent ?? task.specialist ?? 'rstack-agent',
      risk_count: Array.isArray(builder?.risks) ? builder.risks.length : 0,
      evidence_count: Array.isArray(validation?.checks) ? validation.checks.length : 0,
    };
  }));
}

function inferHost(manifest) {
  return manifest?.host ?? manifest?.framework ?? manifest?.runtime ?? manifest?.mode ?? 'unknown';
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
  // JSON stringify once, then build the correct RFC-6455 frame
  const payload = Buffer.from(typeof data === 'string' ? data : JSON.stringify(data));
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x81; header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81; header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    // Extended 64-bit length — required for payloads > 65535 bytes
    header = Buffer.alloc(10);
    header[0] = 0x81; header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

function wsSend(socket, data) {
  try { socket.write(wsFrame(data)); } catch { /* closed */ }
}

// Strip raw event arrays before sending over WebSocket — they're 2+ MB and
// the client only needs the pre-computed feed/timeline/agentWork fields.
function toClientState(state) {
  const runs = (state.runs ?? []).map(r => {
    // eslint-disable-next-line no-unused-vars
    const { events, ...rest } = r;
    return rest;
  });
  return {
    ...state,
    runs,
    // Slim tasks — drop large JSON blobs, keep only display fields
    runs: runs.map(r => ({
      ...r,
      tasks: (r.tasks ?? []).map(t => ({
        id:             t.id,
        title:          t.title,
        status:         t.status,
        stage_artifacts:t.stage_artifacts,
        agent_name:     t.agent_name,
        risk_count:     t.risk_count,
        evidence_count: t.evidence_count,
        prompt_preview: t.prompt_preview?.slice(0, 120) ?? '',
      })),
    })),
    // Cap arrays to keep WS payload well under 400 KB
    feed:      (state.feed      ?? []).slice(0, 100),
    agentWork: (state.agentWork ?? []).slice(0, 50).map(w => ({
      agent:         w.agent,
      taskId:        w.taskId,
      status:        w.status,
      goal:          w.goal,
      host:          w.host,
      summary:       (w.summary || w.promptPreview || '').slice(0, 160),
      evidenceCount: w.evidenceCount,
      riskCount:     w.riskCount,
      runId:         w.runId,
    })),
  };
}

// ── State ─────────────────────────────────────────────────────────────────────

const clients = new Set();

function broadcast(msg) {
  for (const s of clients) wsSend(s, msg);
}

// ── Per-minute activity timeline ──────────────────────────────────────────────

function buildActivityTimeline(events) {
  const minutes = {};
  for (const ev of events) {
    const min = ev.ts?.slice(0, 16);
    if (!min) continue;
    if (!minutes[min]) minutes[min] = { toolCalls: 0, stagesDone: [], tasksPassed: 0, tasksFailed: 0, guardrails: 0, approvals: 0, quality: [] };
    const m = minutes[min];
    if (ev.type === 'tool_call')               m.toolCalls++;
    if (ev.type === 'stage_completed')          m.stagesDone.push(ev.stage_id ?? '');
    if (ev.type === 'task_validated' && ev.status === 'PASS') m.tasksPassed++;
    if (ev.type === 'task_validated' && ev.status === 'FAIL') m.tasksFailed++;
    if (ev.type === 'guardrail_triggered')      m.guardrails++;
    if (ev.type === 'approval_gate')            m.approvals++;
    if (ev.type === 'quality_score_recorded')   m.quality.push({ task: ev.task_id, score: ev.score, pass: ev.pass_checks, total: ev.total_checks });
  }
  // Return sorted array for the chart
  return Object.entries(minutes)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([minute, data]) => ({ minute, ...data }));
}

// ── Run status derivation ─────────────────────────────────────────────────────

function deriveRunStatus(manifest, events) {
  if (manifest?.completed_at) return 'done';
  if (!events.length) return 'idle';
  const last = events[events.length - 1];
  if (last?.type === 'session_shutdown') {
    // Stalled if shutdown was more than 30 min ago
    const lastTs = last.ts ? new Date(last.ts).getTime() : 0;
    return Date.now() - lastTs > 30 * 60 * 1000 ? 'stalled' : 'ended';
  }
  const lastTs = last?.ts ? new Date(last.ts).getTime() : 0;
  if (lastTs && Date.now() - lastTs > 30 * 60 * 1000) return 'stalled';
  return 'active';
}

// ── Multi-project, multi-run aggregation ──────────────────────────────────────

async function getRunsForRoot(projectRoot) {
  const runsDir = join(projectRoot, '.rstack', 'runs');
  if (!existsSync(runsDir)) return [];
  let entries;
  try { entries = await readdir(runsDir); } catch { return []; }

  return Promise.all(entries.map(async (runId) => {
    const runDir = join(runsDir, runId);
    const [manifest, metrics, tasksRaw] = await Promise.all([
      readJson(join(runDir, 'manifest.json'), {}),
      readJson(join(runDir, 'metrics.json'), {}),
      readJson(join(runDir, 'tasks.json'), null),
    ]);
    const rawTasks = Array.isArray(tasksRaw)
      ? tasksRaw
      : Array.isArray(tasksRaw?.tasks) ? tasksRaw.tasks : [];
    const tasks = await enrichTasks(projectRoot, runId, rawTasks);
    const events = readJsonlSync(join(runDir, 'events.jsonl'));

    // Per-minute activity timeline — used for sparkline + drill-down
    const activityTimeline = buildActivityTimeline(events);

    // Derive status from events when manifest lacks completed_at
    const derivedStatus = deriveRunStatus(manifest, events);
    const host = inferHost(manifest);

    return { runId, projectRoot, manifest, metrics, tasks, events, activityTimeline, derivedStatus, host };
  }));
}

async function getAllRuns(projectRoot) {
  // Aggregate across all known project roots + the one this server was started for
  const roots = await knownProjectRoots(projectRoot);
  const perRoot = await Promise.all(roots.map(r => getRunsForRoot(r)));
  const all = perRoot.flat();

  // Deduplicate by runId (same run can't appear twice, but guard anyway)
  const seen = new Set();
  const deduped = all.filter(r => seen.has(r.runId) ? false : seen.add(r.runId));

  // Sort newest first
  return deduped.sort((a, b) => b.runId.localeCompare(a.runId));
}

async function getAllApprovals(projectRoot) {
  const roots = await knownProjectRoots(projectRoot);
  const perRoot = await Promise.all(roots.map(r => readApprovals(r)));
  return perRoot.flat();
}

function buildStageMatrix(runs) {
  return CANONICAL_SDLC_STAGES.map((stage) => {
    const runStates = runs.map((run) => {
      const task = (run.tasks ?? []).find(t =>
        t.id === stage.id ||
        t.stage_id === stage.id ||
        (t.stage_artifacts ?? []).some(a => a.stage_id === stage.id)
      );
      const status = task?.status ?? 'READY';
      const validationStatus = task?.validation?.status ?? null;
      return {
        runId: run.runId,
        status,
        taskId: task?.id ?? null,
        agent: task?.agent_name ?? stage.agent,
        validationStatus,
        riskCount: task?.risk_count ?? 0,
      };
    });
    return {
      ...stage,
      runs: runStates,
      pass: runStates.filter(r => r.status === 'PASS').length,
      fail: runStates.filter(r => r.status === 'FAIL').length,
      active: runStates.filter(r => r.status === 'IN_PROGRESS').length,
      ready: runStates.filter(r => r.status === 'READY' || !r.status).length,
    };
  });
}

function buildAgentWork(runs) {
  return runs.flatMap((run) => (run.tasks ?? []).map((task) => ({
    runId: run.runId,
    goal: run.manifest?.goal ?? '',
    host: run.host,
    projectRoot: run.projectRoot,
    taskId: task.id,
    title: task.title ?? task.id,
    status: task.status ?? 'READY',
    agent: task.agent_name ?? 'rstack-agent',
    summary: task.builder?.summary ?? task.description ?? '',
    decisions: task.builder?.memory_summary?.decisions ?? [],
    risks: task.builder?.risks ?? [],
    nextSteps: task.builder?.next_steps ?? [],
    validationChecks: task.validation?.checks ?? [],
    promptPreview: task.prompt_preview ?? '',
  }))).sort((a, b) => `${b.runId}:${b.taskId}`.localeCompare(`${a.runId}:${a.taskId}`)).slice(0, 160);
}

async function buildFullState(projectRoot) {
  const [runs, allApprovals] = await Promise.all([
    getAllRuns(projectRoot),
    getAllApprovals(projectRoot),
  ]);

  // approvalStats computed later once mergedApprovals is built

  const totalCost = runs.reduce((s, r) => s + (r.metrics?.cumulative_cost_usd ?? 0), 0);
  const activeRuns = runs.filter(r => r.derivedStatus === 'active');
  const todayRuns = runs.filter(r => {
    const d = r.manifest?.created_at;
    if (!d) return false;
    const today = new Date().toISOString().slice(0, 10);
    return d.startsWith(today);
  });

  // Merge approval_gate events from events.jsonl into the approvals list
  const inlineApprovals = [];
  for (const run of runs) {
    for (const ev of run.events) {
      if (ev.type === 'approval_gate' || ev.type === 'approval_gate_blocked') {
        inlineApprovals.push({
          id: `${run.runId}-${ev.ts}`,
          type: ev.type,
          title: ev.type === 'approval_gate'
            ? `Approval gate: ${ev.artifact ?? 'artifact'} — ${ev.status ?? 'APPROVED'}`
            : `Approval required — missing: ${(ev.missing ?? []).join(', ') || 'artifact'}`,
          detail: ev.type === 'approval_gate'
            ? `Artifact "${ev.artifact}" was approved`
            : `Task "${ev.task_id}" could not proceed`,
          status: ev.type === 'approval_gate' ? 'approved' : 'pending',
          runId: run.runId,
          projectRoot: run.projectRoot,
          ts: ev.ts,
          source: 'inline',
        });
      }
    }
  }
  // Merge: inline events first, then queue-based approvals (deduplicated by id)
  const mergedApprovals = [...inlineApprovals];
  for (const a of allApprovals) {
    if (!mergedApprovals.some(x => x.id === a.id)) mergedApprovals.push(a);
  }
  mergedApprovals.sort((a, b) => (b.ts ?? '').localeCompare(a.ts ?? ''));

  const pending = pendingApprovals(mergedApprovals);
  const approvalStats = approvalSummary(mergedApprovals);

  // Build business activity feed — skip raw tool_call/tool_result, surface everything else
  // Also aggregate tool_call bursts per minute
  const SKIP_IN_FEED = new Set(['tool_call', 'tool_result']);
  const activityFeed = [];
  for (const run of runs.slice(0, 15)) {
    // Aggregate tool calls into per-minute burst entries
    const toolBursts = {};
    for (const ev of run.events) {
      if (ev.type !== 'tool_call') continue;
      const min = ev.ts?.slice(0, 16);
      if (!min) continue;
      toolBursts[min] = (toolBursts[min] ?? 0) + 1;
    }
    // Emit a burst entry for any minute with >= 3 tool calls
    for (const [min, count] of Object.entries(toolBursts)) {
      if (count >= 3) {
        activityFeed.push({
          ts: min + ':00.000Z',
          summary: `${count} tool calls — agent working`,
          type: 'tool_burst',
          runId: run.runId,
          projectRoot: run.projectRoot,
          goal: run.manifest?.goal,
          level: 'tool',
        });
      }
    }

    for (const ev of run.events) {
      if (SKIP_IN_FEED.has(ev.type)) continue;
      const summary = plainLanguageSummary(ev);
      if (summary) {
        activityFeed.push({
          ts: ev.ts,
          summary,
          type: ev.type,
          runId: run.runId,
          projectRoot: run.projectRoot,
          goal: run.manifest?.goal,
          level: ev.type === 'task_validated' && ev.status === 'FAIL' ? 'fail'
               : ev.type === 'guardrail_triggered' ? 'warn'
               : ev.type === 'approval_gate_blocked' ? 'blocked'
               : ev.type === 'approval_gate' ? 'pass'
               : ev.type === 'quality_score_recorded' ? 'pass'
               : ev.type === 'session_shutdown' ? 'dim'
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
    const stageArtifactsDir = join(run.projectRoot ?? projectRoot, '.rstack', 'runs', run.runId, 'artifacts', 'stages');
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
  const stageMatrix = buildStageMatrix(runs);
  const agentWork = buildAgentWork(runs);
  const tokenTotal = runs.reduce((sum, run) => sum + Number(run.metrics?.cumulative_tokens ?? run.metrics?.total_tokens ?? 0), 0);

  return {
    kind: 'snapshot',
    product: 'RStack Command Center',
    stateRoot: join(projectRoot, '.rstack'),
    runs,
    activeRuns: activeRuns.map(r => r.runId),
    todayCount: todayRuns.length,
    totalRuns: runs.length,
    totalCost,
    tokenTotal,
    frameworks,
    feed,
    approvals: mergedApprovals,
    approvalStats,
    pendingApprovals: pending,
    alerts,
    traceMap,
    stageMatrix,
    agentWork,
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
      broadcast(toClientState(state));
    } catch (err) {
      // Log but never crash — the next tick will retry
      process.stderr.write(`[rstack-business] poll error: ${err?.message}\n`);
    }
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

  // Health check — used by Pi adapter to verify the hub is truly alive
  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, port: PORT, ts: new Date().toISOString() }));
    return;
  }

  if (url.pathname === '/api/state' && req.method === 'GET') {
    try {
      const state = await buildFullState(PROJECT_ROOT);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(state));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err?.message) }));
    }
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
        broadcast(toClientState(state));
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
        broadcast(toClientState(state));
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
  wsSend(socket, toClientState(state));
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
<title>RStack Command Center</title>
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
.feed-dot.pass{background:var(--pass)}.feed-dot.tool{background:var(--dim2)}
.feed-dot.dim{background:var(--dim2);opacity:.5}
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
.pill.ended{background:var(--panel2);color:var(--dim);border:1px solid var(--border)}
.pill.stalled{background:var(--warn-bg);color:var(--warn);border:1px solid rgba(245,158,11,.25)}

/* ── Sparkline ── */
.sparkline{display:block;overflow:visible}
.spark-bar{fill:var(--info);opacity:.7;transition:opacity .15s}
.spark-bar:hover{opacity:1}
.spark-stage{fill:var(--pass)}
.spark-guardrail{fill:var(--fail)}

/* ── Run detail panel ── */
#run-detail-panel{
  position:fixed;right:0;top:52px;bottom:0;width:520px;background:var(--surface);
  border-left:1px solid var(--border2);z-index:50;transform:translateX(100%);
  transition:transform .25s cubic-bezier(.4,0,.2,1);display:flex;flex-direction:column;overflow:hidden;
}
#run-detail-panel.open{transform:translateX(0)}
.rdp-hdr{padding:14px 18px;border-bottom:1px solid var(--border2);display:flex;align-items:center;gap:10px;flex-shrink:0}
.rdp-hdr h2{font-size:13px;font-weight:700;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rdp-close{background:none;border:none;color:var(--dim);font-size:20px;cursor:pointer;line-height:1;flex-shrink:0}
.rdp-close:hover{color:var(--text)}
.rdp-body{flex:1;overflow-y:auto;padding:16px 18px;display:flex;flex-direction:column;gap:16px}
.rdp-section{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--dim);margin-bottom:8px}
.rdp-timeline{width:100%;height:64px}
.rdp-minute-row{display:flex;gap:4px;align-items:center;padding:5px 0;border-bottom:1px solid var(--border);font-size:11px}
.rdp-minute-row:last-child{border-bottom:none}
.rdp-min-time{font-family:var(--m);font-size:10px;color:var(--dim);width:50px;flex-shrink:0}
.rdp-min-bar{height:16px;border-radius:3px;background:var(--info);min-width:2px;transition:width .3s}
.rdp-min-count{font-family:var(--m);font-size:10px;color:var(--dim);margin-left:6px;white-space:nowrap}
.rdp-quality-row{display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px}
.rdp-quality-row:last-child{border-bottom:none}
.quality-bar{height:4px;border-radius:2px;background:var(--pass);margin-top:3px}

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

/* ── Command Center ── */
.command-hero{display:grid;grid-template-columns:1.3fr .7fr;gap:16px;margin-bottom:16px}
.command-title{font-size:34px;font-weight:900;letter-spacing:-.055em;line-height:1.02;margin-bottom:10px}
.command-title span{color:var(--accent2)}
.command-sub{color:var(--dim);font-size:14px;max-width:760px}
.command-shell{display:grid;grid-template-columns:290px 1fr 360px;gap:14px;min-height:660px}
@media(max-width:1250px){.command-shell{grid-template-columns:1fr}.command-hero{grid-template-columns:1fr}}
.command-panel{background:linear-gradient(180deg,rgba(26,36,56,.96),rgba(15,22,35,.96));border:1px solid var(--border);border-radius:18px;overflow:hidden;box-shadow:0 24px 90px rgba(0,0,0,.24)}
.command-panel-h{padding:13px 15px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;font-size:10.5px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--dim)}
.project-tile{padding:12px 14px;border-bottom:1px solid var(--border);cursor:pointer;transition:background .15s,border-color .15s}
.project-tile:hover{background:rgba(255,255,255,.035)}
.project-name{font-weight:800;color:var(--text);font-size:13px;margin-bottom:4px}
.project-meta{font-size:10.5px;color:var(--dim);font-family:var(--m)}
.stage-board{display:grid;grid-template-columns:repeat(5,minmax(140px,1fr));gap:10px;padding:14px}
@media(max-width:1500px){.stage-board{grid-template-columns:repeat(3,minmax(140px,1fr))}}
.stage-card{background:rgba(9,14,24,.74);border:1px solid var(--border);border-radius:14px;padding:12px;min-height:118px;position:relative;overflow:hidden}
.stage-card::after{content:'';position:absolute;inset:auto 0 0 0;height:3px;background:linear-gradient(90deg,var(--accent),var(--info));opacity:.65}
.stage-code{font-family:var(--m);font-size:10px;color:var(--accent2);font-weight:800;margin-bottom:5px}
.stage-title{font-size:13px;font-weight:800;margin-bottom:9px}
.stage-stats{display:flex;gap:5px;flex-wrap:wrap;margin-bottom:10px}
.stage-runs{display:flex;gap:3px;align-items:center;flex-wrap:wrap}
.run-dot{width:9px;height:9px;border-radius:50%;background:var(--dim2);box-shadow:0 0 0 1px rgba(255,255,255,.08)}
.run-dot.pass{background:var(--pass)}.run-dot.fail{background:var(--fail)}.run-dot.active{background:var(--accent2)}.run-dot.ready{background:var(--dim2)}
.agent-stack{padding:12px;display:flex;flex-direction:column;gap:10px;max-height:620px;overflow:auto}
.agent-card{background:rgba(9,14,24,.7);border:1px solid var(--border);border-radius:14px;padding:12px;cursor:pointer;transition:border-color .15s,transform .15s}
.agent-card:hover{border-color:var(--accent);transform:translateY(-1px)}
.agent-head{display:flex;justify-content:space-between;gap:8px;margin-bottom:7px}.agent-name{font-weight:900;color:var(--text);font-size:12px}.agent-task{font-size:11px;color:var(--dim);font-family:var(--m)}
.agent-summary{font-size:11.5px;color:var(--dim);line-height:1.45;max-height:48px;overflow:hidden}
.agent-detail{position:fixed;right:0;top:52px;bottom:0;width:520px;background:var(--surface);border-left:1px solid var(--border2);z-index:40;transform:translateX(100%);transition:transform .22s ease;box-shadow:-20px 0 60px rgba(0,0,0,.45);display:flex;flex-direction:column}
.agent-detail.open{transform:translateX(0)}
.agent-detail-body{padding:18px;overflow:auto;display:flex;flex-direction:column;gap:14px}
.json-chip{font-family:var(--m);font-size:10.5px;color:var(--info);background:var(--info-bg);border:1px solid rgba(59,130,246,.25);padding:4px 7px;border-radius:6px}
.thinking-list{display:flex;flex-direction:column;gap:6px}.thinking-item{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:9px 10px;font-size:12px;color:var(--text)}

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
    <div class="nav-brand">RStack <span>Command Center</span></div>
    <div class="nav-tabs">
      <button class="nav-tab active" data-tab="command">Command Center</button>
      <button class="nav-tab" data-tab="overview">Overview</button>
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

  <!-- COMMAND CENTER -->
  <div class="tab-content active scroll" id="tab-command">
    <div class="command-hero">
      <div class="command-panel" style="padding:22px 24px">
        <div class="command-title">AI software team <span>mission control</span></div>
        <div class="command-sub">A host-agnostic SDLC board over <code id="cc-state-root">.rstack</code>. Track every project, run, agent, hook, guardrail, token, cost signal, and 15-stage pipeline from one place.</div>
      </div>
      <div class="kpi-row" style="margin:0;grid-template-columns:repeat(2,1fr)">
        <div class="kpi"><div class="kpi-val violet" id="cc-agents">—</div><div class="kpi-label">Agent Work Items</div></div>
        <div class="kpi"><div class="kpi-val blue" id="cc-tokens">—</div><div class="kpi-label">Tokens Recorded</div></div>
      </div>
    </div>
    <div class="command-shell">
      <section class="command-panel">
        <div class="command-panel-h"><span>Projects and sessions</span><span id="cc-project-count">0</span></div>
        <div id="cc-projects"></div>
      </section>
      <section class="command-panel">
        <div class="command-panel-h"><span>15-stage SDLC pipeline</span><span>live board</span></div>
        <div class="stage-board" id="cc-stage-board"></div>
      </section>
      <section class="command-panel">
        <div class="command-panel-h"><span>Agent work stream</span><span>builder.json</span></div>
        <div class="agent-stack" id="cc-agent-stack"></div>
      </section>
    </div>
  </div>

  <!-- OVERVIEW -->
  <div class="tab-content scroll" id="tab-overview">
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

  <!-- AGENT DETAIL SLIDE-OUT PANEL -->
  <div id="agent-detail-panel" class="agent-detail">
    <div class="rdp-hdr">
      <div style="flex:1">
        <div style="font-size:10px;color:var(--dim);font-family:var(--m)" id="adp-task-id">—</div>
        <h2 id="adp-agent">Agent Work</h2>
      </div>
      <button class="rdp-close" onclick="closeAgentDetail()">&times;</button>
    </div>
    <div class="agent-detail-body" id="adp-body"></div>
  </div>

  <!-- RUN DETAIL SLIDE-OUT PANEL -->
  <div id="run-detail-panel">
    <div class="rdp-hdr">
      <div style="flex:1">
        <div style="font-size:10px;color:var(--dim);font-family:var(--m)" id="rdp-run-id">—</div>
        <h2 id="rdp-goal">Run Detail</h2>
      </div>
      <button class="rdp-close" onclick="closeRunDetail()">&times;</button>
    </div>
    <div class="rdp-body">
      <!-- KPIs -->
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px" id="rdp-kpis"></div>
      <!-- Timeline -->
      <div>
        <div class="rdp-section">Activity timeline — tool calls per minute</div>
        <svg class="rdp-timeline" id="rdp-timeline-svg"></svg>
      </div>
      <!-- Per-minute table -->
      <div>
        <div class="rdp-section">Minute-by-minute breakdown</div>
        <div id="rdp-minutes"></div>
      </div>
      <!-- Quality scores -->
      <div id="rdp-quality-section" style="display:none">
        <div class="rdp-section">Quality scores</div>
        <div id="rdp-quality"></div>
      </div>
      <!-- Stages -->
      <div>
        <div class="rdp-section">Stage completions</div>
        <div id="rdp-stages"></div>
      </div>
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
  renderCommandCenter();
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

// ── Command Center ───────────────────────────────────────────────────────────
function renderCommandCenter() {
  if (!STATE) return;
  setText('cc-state-root', STATE.stateRoot ?? '.rstack');
  setText('cc-agents', (STATE.agentWork ?? []).length);
  setText('cc-tokens', compactNumber(STATE.tokenTotal ?? 0));
  renderCommandProjects();
  renderCommandStages();
  renderCommandAgents();
}

function renderCommandProjects() {
  const el = document.getElementById('cc-projects');
  if (!el) return;
  const projects = {};
  for (const run of STATE.runs ?? []) {
    const key = run.projectRoot ?? 'unknown';
    const name = key.split('/').filter(Boolean).pop() || key;
    const bucket = projects[key] ??= { name, path: key, runs: 0, active: 0, cost: 0, pass: 0, fail: 0, last: '' };
    bucket.runs++;
    if ((STATE.activeRuns ?? []).includes(run.runId)) bucket.active++;
    bucket.cost += Number(run.metrics?.cumulative_cost_usd ?? 0) || 0;
    bucket.last = bucket.last > run.runId ? bucket.last : run.runId;
    for (const task of run.tasks ?? []) {
      if (task.status === 'PASS') bucket.pass++;
      if (task.status === 'FAIL') bucket.fail++;
    }
  }
  const rows = Object.values(projects).sort((a, b) => b.last.localeCompare(a.last));
  setText('cc-project-count', rows.length);
  el.innerHTML = rows.length ? rows.map(p => '<div class="project-tile">' +
    '<div class="project-name">' + esc(p.name) + '</div>' +
    '<div class="project-meta">' + p.runs + ' runs · ' + p.active + ' active · $' + p.cost.toFixed(4) + '</div>' +
    '<div style="margin-top:7px;display:flex;gap:5px"><span class="pill pass">' + p.pass + ' pass</span><span class="pill fail">' + p.fail + ' fail</span></div>' +
    '</div>').join('') : '<div class="feed-empty">No projects found in .rstack yet</div>';
}

function renderCommandStages() {
  const el = document.getElementById('cc-stage-board');
  if (!el) return;
  const stages = STATE.stageMatrix ?? [];
  el.innerHTML = stages.map(stage => {
    const dots = (stage.runs ?? []).slice(0, 28).map(r => '<span title="' + esc(r.runId) + ' · ' + esc(r.status) + '" class="run-dot ' + statusDot(r.status) + '"></span>').join('');
    return '<div class="stage-card">' +
      '<div class="stage-code">' + esc(stage.id) + '</div>' +
      '<div class="stage-title">' + esc(stage.title) + '</div>' +
      '<div class="stage-stats"><span class="pill pass">' + stage.pass + ' pass</span><span class="pill fail">' + stage.fail + ' fail</span><span class="pill active">' + stage.active + ' active</span></div>' +
      '<div class="stage-runs">' + (dots || '<span style="color:var(--dim);font-size:11px">No runs</span>') + '</div>' +
      '</div>';
  }).join('');
}

function renderCommandAgents() {
  const el = document.getElementById('cc-agent-stack');
  if (!el) return;
  const work = (STATE.agentWork ?? []).slice(0, 40);
  el.innerHTML = work.length ? work.map((item, idx) => '<div class="agent-card" onclick="openAgentDetail(' + idx + ')">' +
    '<div class="agent-head"><div><div class="agent-name">' + esc(item.agent) + '</div><div class="agent-task">' + esc(item.taskId) + '</div></div><span class="pill ' + pillClass(item.status) + '">' + esc(item.status) + '</span></div>' +
    '<div class="agent-summary">' + esc(item.summary || item.promptPreview || item.goal || 'No summary yet') + '</div>' +
    '<div style="margin-top:8px;display:flex;gap:5px;flex-wrap:wrap"><span class="json-chip">builder.json</span><span class="json-chip">validation.json</span>' + (item.host ? '<span class="json-chip">' + esc(item.host) + '</span>' : '') + '</div>' +
    '</div>').join('') : '<div class="feed-empty">No agent contracts found yet</div>';
}

function openAgentDetail(index) {
  const item = (STATE.agentWork ?? [])[index];
  if (!item) return;
  document.getElementById('adp-task-id').textContent = item.runId.slice(-18) + ' · ' + item.taskId;
  document.getElementById('adp-agent').textContent = item.agent;
  const decisions = item.decisions?.length ? item.decisions : ['No decisions recorded yet'];
  const risks = item.risks?.length ? item.risks : ['No risks recorded'];
  const checks = item.validationChecks?.slice(0, 14) ?? [];
  document.getElementById('adp-body').innerHTML =
    '<div class="card"><div class="card-hdr">Work summary</div><div class="card-body">' + esc(item.summary || item.promptPreview || 'No summary recorded') + '</div></div>' +
    '<div class="card"><div class="card-hdr">Structured agent thinking</div><div class="card-body thinking-list">' + decisions.map(d => '<div class="thinking-item">' + esc(d) + '</div>').join('') + '</div></div>' +
    '<div class="card"><div class="card-hdr">Risks</div><div class="card-body thinking-list">' + risks.map(r => '<div class="thinking-item">' + esc(r) + '</div>').join('') + '</div></div>' +
    '<div class="card"><div class="card-hdr">Validation checks</div><div class="card-body thinking-list">' + (checks.length ? checks.map(c => '<div class="thinking-item"><span class="pill ' + pillClass(c.status) + '">' + esc(c.status) + '</span> ' + esc(c.name) + '<div style="color:var(--dim);font-size:11px;margin-top:4px">' + esc(c.evidence ?? '') + '</div></div>').join('') : '<div class="thinking-item">No validation checks found</div>') + '</div></div>';
  document.getElementById('agent-detail-panel').classList.add('open');
}

function closeAgentDetail() {
  document.getElementById('agent-detail-panel').classList.remove('open');
}

function statusDot(status) {
  if (status === 'PASS') return 'pass';
  if (status === 'FAIL') return 'fail';
  if (status === 'IN_PROGRESS') return 'active';
  return 'ready';
}

function pillClass(status) {
  const s = String(status ?? '').toLowerCase();
  if (s.includes('pass') || s.includes('done') || s.includes('approved')) return 'pass';
  if (s.includes('fail') || s.includes('reject')) return 'fail';
  if (s.includes('progress') || s.includes('active')) return 'active';
  return 'warn';
}

function compactNumber(value) {
  const n = Number(value) || 0;
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
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
  const proj = f.projectRoot ? f.projectRoot.split('/').filter(Boolean).pop() : '';
  const goalStr = f.goal ? ' · ' + esc(f.goal).slice(0,40) : '';
  const runStr  = f.runId ? esc(f.runId.slice(-10)) + (proj ? ' [' + esc(proj) + ']' : '') + goalStr : '';
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
function statusPillHtml(r) {
  const s = r.derivedStatus ?? (r.manifest?.completed_at ? 'done' : 'idle');
  const map = { active:'active', done:'pass', ended:'ended', stalled:'stalled', idle:'idle' };
  const cls = map[s] ?? 'idle';
  return \`<span class="pill \${cls}">\${s.toUpperCase()}</span>\`;
}

function miniSparkline(timeline, width = 120, height = 24) {
  if (!timeline?.length) return '';
  const maxTc = Math.max(1, ...timeline.map(m => m.toolCalls));
  const W = width, H = height, bw = Math.max(2, Math.floor(W / timeline.length) - 1);
  const bars = timeline.map((m, i) => {
    const bh = Math.max(2, Math.round((m.toolCalls / maxTc) * H));
    const x  = i * (bw + 1);
    const y  = H - bh;
    const color = m.stagesDone.length ? 'var(--pass)' : m.guardrails ? 'var(--fail)' : 'var(--info)';
    return \`<rect x="\${x}" y="\${y}" width="\${bw}" height="\${bh}" fill="\${color}" opacity=".7" rx="1"/>\`;
  }).join('');
  return \`<svg width="\${W}" height="\${H}" style="display:block">\${bars}</svg>\`;
}

function renderHistory() {
  const el = document.getElementById('history-list');
  const runs = STATE.runs ?? [];
  if (!runs.length) { el.innerHTML = '<div class="feed-empty">No runs recorded yet</div>'; return; }
  el.innerHTML = runs.map(r => {
    const tasks    = r.tasks ?? [];
    const passed   = tasks.filter(t => t.status === 'PASS').length;
    const failed   = tasks.filter(t => t.status === 'FAIL').length;
    const cost     = (r.metrics?.cumulative_cost_usd ?? 0).toFixed(4);
    const created  = r.manifest?.created_at ? r.manifest.created_at.replace('T',' ').slice(0,16) : '—';
    const projLabel = r.projectRoot ? r.projectRoot.split('/').filter(Boolean).pop() : '';
    const fw        = r.manifest?.framework ?? r.manifest?.mode ?? '';
    const totalTc   = (r.activityTimeline ?? []).reduce((s, m) => s + m.toolCalls, 0);
    const spark     = miniSparkline(r.activityTimeline ?? []);
    return \`<div class="run-row" onclick="openRunDetail('\${esc(r.runId)}')" style="cursor:pointer">
      <div style="flex:1">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
          \${statusPillHtml(r)}
          <span class="run-goal">\${esc(r.manifest?.goal ?? '—')}</span>
        </div>
        <div style="font-size:10px;color:var(--dim)">
          \${created}
          \${projLabel ? ' · <span style="color:var(--info)">'+esc(projLabel)+'</span>' : ''}
          \${fw ? ' · '+esc(fw) : ''}
          · \${tasks.length} tasks · \${passed}✅ \${failed > 0 ? failed+'❌' : ''}
          \${totalTc ? ' · '+totalTc+' tool calls' : ''}
        </div>
        \${spark ? \`<div style="margin-top:6px">\${spark}</div>\` : ''}
      </div>
      <div class="run-meta" style="align-items:flex-start;padding-top:2px">
        <span class="run-cost">$\${cost}</span>
        <span style="font-size:10px;color:var(--dim);margin-top:2px">▸ detail</span>
      </div>
    </div>\`;
  }).join('');
}

// ── Run detail slide-out panel ────────────────────────────────────────────────
function openRunDetail(runId) {
  const r = (STATE.runs ?? []).find(x => x.runId === runId);
  if (!r) return;

  document.getElementById('rdp-run-id').textContent = runId.slice(0, 50);
  document.getElementById('rdp-goal').textContent   = r.manifest?.goal ?? '—';

  const tasks     = r.tasks ?? [];
  const passed    = tasks.filter(t => t.status === 'PASS').length;
  const failed    = tasks.filter(t => t.status === 'FAIL').length;
  const totalTc   = (r.activityTimeline ?? []).reduce((s, m) => s + m.toolCalls, 0);
  const minutes   = (r.activityTimeline ?? []).length;
  const cost      = (r.metrics?.cumulative_cost_usd ?? 0).toFixed(4);

  // KPIs
  document.getElementById('rdp-kpis').innerHTML = [
    ['Tool Calls', totalTc, 'var(--info)'],
    ['Minutes Active', minutes, 'var(--accent2)'],
    ['Tasks Passed', passed, 'var(--pass)'],
    ['Tasks Failed', failed, failed > 0 ? 'var(--fail)' : 'var(--dim)'],
  ].map(([l,v,c]) => \`<div style="background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:10px 12px">
    <div style="font-size:20px;font-weight:800;color:\${c};font-family:var(--m)">\${v}</div>
    <div style="font-size:9.5px;color:var(--dim);text-transform:uppercase;letter-spacing:.06em;margin-top:2px">\${l}</div>
  </div>\`).join('');

  // Timeline SVG (larger version)
  const tl = r.activityTimeline ?? [];
  const svg = document.getElementById('rdp-timeline-svg');
  if (tl.length) {
    const W = 480, H = 56;
    const maxTc = Math.max(1, ...tl.map(m => m.toolCalls));
    const bw = Math.max(3, Math.floor(W / tl.length) - 1);
    const bars = tl.map((m, i) => {
      const bh   = Math.max(2, Math.round((m.toolCalls / maxTc) * H));
      const x    = i * (bw + 1);
      const y    = H - bh;
      const color = m.stagesDone.length ? '#22c55e' : m.guardrails ? '#ef4444' : '#3b82f6';
      const tip  = \`\${m.minute} · \${m.toolCalls} tool calls\${m.stagesDone.length ? ' · stage done: '+m.stagesDone.join(',') : ''}\`;
      return \`<rect x="\${x}" y="\${y}" width="\${bw}" height="\${bh}" fill="\${color}" opacity=".8" rx="1"><title>\${esc(tip)}</title></rect>\`;
    }).join('');
    const legend = \`<text x="0" y="\${H+12}" font-size="9" fill="#6b7fa3">Blue = tool calls · Green = stage completed · Red = guardrail hit</text>\`;
    svg.setAttribute('viewBox', \`0 0 \${W} \${H+16}\`);
    svg.setAttribute('style', 'width:100%;height:72px');
    svg.innerHTML = bars + legend;
  } else {
    svg.innerHTML = '<text x="0" y="20" font-size="11" fill="#6b7fa3">No activity data recorded</text>';
  }

  // Per-minute table
  const minsEl = document.getElementById('rdp-minutes');
  if (tl.length) {
    const maxTc2 = Math.max(1, ...tl.map(m => m.toolCalls));
    minsEl.innerHTML = tl.map(m => {
      const pct = Math.round((m.toolCalls / maxTc2) * 100);
      const tags = [];
      if (m.tasksPassed)  tags.push(\`<span class="pill pass">\${m.tasksPassed} PASS</span>\`);
      if (m.tasksFailed)  tags.push(\`<span class="pill fail">\${m.tasksFailed} FAIL</span>\`);
      if (m.stagesDone.length) tags.push(\`<span class="pill info">stage: \${m.stagesDone[0]}</span>\`);
      if (m.guardrails)  tags.push(\`<span class="pill warn">guardrail</span>\`);
      if (m.approvals)   tags.push(\`<span class="pill pass">approved</span>\`);
      return \`<div class="rdp-minute-row">
        <span class="rdp-min-time">\${m.minute.slice(11)}</span>
        <div class="rdp-min-bar" style="width:\${pct}%"></div>
        <span class="rdp-min-count">\${m.toolCalls} calls</span>
        \${tags.length ? '<span style="margin-left:8px;display:flex;gap:4px">'+tags.join('')+'</span>' : ''}
      </div>\`;
    }).join('');
  } else {
    minsEl.innerHTML = '<div style="color:var(--dim);font-size:12px">No minute data</div>';
  }

  // Quality scores
  const allQuality = tl.flatMap(m => m.quality ?? []);
  const qSection = document.getElementById('rdp-quality-section');
  if (allQuality.length) {
    qSection.style.display = '';
    document.getElementById('rdp-quality').innerHTML = allQuality.map(q => {
      const pct = q.total > 0 ? Math.round((q.pass / q.total) * 100) : 0;
      return \`<div class="rdp-quality-row">
        <div>
          <div style="font-size:12px;font-weight:600">\${esc(q.task ?? '—')}</div>
          <div class="quality-bar" style="width:\${pct}%"></div>
        </div>
        <span class="pill \${pct === 100 ? 'pass' : pct >= 80 ? 'info' : 'warn'}">\${pct}% · \${q.pass}/\${q.total}</span>
      </div>\`;
    }).join('');
  } else {
    qSection.style.display = 'none';
  }

  // Stages
  const stages = tl.flatMap(m => m.stagesDone.map(s => ({ stage: s, minute: m.minute })));
  document.getElementById('rdp-stages').innerHTML = stages.length
    ? stages.map(s => \`<div style="padding:5px 0;border-bottom:1px solid var(--border);font-size:12px;display:flex;justify-content:space-between">
        <span style="color:var(--text)">\${esc(stageLabel(s.stage))}</span>
        <span style="font-family:var(--m);font-size:10px;color:var(--dim)">\${s.minute.slice(11)}</span>
      </div>\`).join('')
    : '<div style="color:var(--dim);font-size:12px">No stage completions recorded</div>';

  document.getElementById('run-detail-panel').classList.add('open');
}

function closeRunDetail() {
  document.getElementById('run-detail-panel').classList.remove('open');
}

function stageLabel(id) {
  const MAP = {
    '00-environment':'Environment','01-transcript':'Transcript','02-requirements':'Requirements',
    '03-documentation':'Documentation','04-planning':'Planning','05-jira':'Jira Tickets',
    '06-architecture':'Architecture','07-code':'Code','08-testing':'Testing',
    '09-deployment':'Deployment','10-summary':'Summary','11-feedback-loop':'Feedback',
    '12-security-threat-model':'Security','13-compliance-checker':'Compliance',
    '14-cost-estimation':'Cost Estimate',
    // Also handle Pi-style IDs like 001-product-clarification
    '001-product-clarification':'Clarification','002-requirements':'Requirements',
    '003-architecture':'Architecture','004-implementation':'Code','005-testing':'Testing',
  };
  return MAP[id] ?? id ?? 'Stage';
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
