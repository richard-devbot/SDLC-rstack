import { createServer }       from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve }      from 'node:path';
import { spawn }              from 'node:child_process';
import { createHash }         from 'node:crypto';
import { evaluateAlerts, plainLanguageSummary } from '../alerts/engine.js';
import { readApprovals, resolveApproval, pendingApprovals, approvalSummary } from '../tracker/approvals.js';
import { knownProjectRoots } from '../tracker/registry.js';
import { CANONICAL_SDLC_STAGES } from '../harness/stages.js';
import { dashboardHtml } from './ui.js';

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
    const { events, evidence, ...rest } = r;
    return {
      ...rest,
      evidenceCount: (r.evidence ?? []).length,
      // Requirements from stage artifacts (the real agent-extracted list)
      requirements: (r.requirements ?? []).slice(0, 15).map(req => ({
        id:          req.id ?? req.req_id ?? '',
        area:        req.area ?? req.category ?? '',
        priority:    req.priority ?? 'must',
        description: (req.description ?? req.text ?? req.title ?? '').slice(0, 200),
        acceptance:  (req.acceptance ?? req.acceptance_criteria ?? []).slice(0, 2),
      })),
      brief:   r.brief ?? '',
      hasPlan: r.hasPlan ?? false,
      // Keep rich task data — builder.json decisions/risks/evidence are the core value
      tasks: (r.tasks ?? []).map(t => ({
        id:               t.id,
        title:            t.title,
        status:           t.status,
        description:      t.description?.slice(0, 300) ?? '',
        stage_artifacts:  t.stage_artifacts,
        agent_name:       t.agent_name,
        risk_count:       t.risk_count,
        evidence_count:   t.evidence_count,
        specialists:      (t.specialists ?? []).slice(0, 6),
        // Builder contract — what the agent actually did
        builder: t.builder ? {
          summary:       t.builder.summary?.slice(0, 400) ?? '',
          status:        t.builder.status,
          decisions:     (t.builder.memory_summary?.decisions ?? []).slice(0, 4),
          risks:         (t.builder.risks ?? []).slice(0, 3),
          next_steps:    (t.builder.next_steps ?? []).slice(0, 3),
          tests_run:     (t.builder.tests_run ?? []).slice(0, 5),
          files_modified:(t.builder.files_modified ?? []).slice(0, 5).map(f =>
            f.replace(/^.*\.rstack\/runs\/[^/]+\//, '')
          ),
          work_done:     t.builder.memory_summary?.work_done?.slice(0, 200) ?? '',
        } : null,
        // Validation — pass/fail counts + any failures
        validation: t.validation ? {
          status:       t.validation.status,
          total_checks: (t.validation.checks ?? []).length,
          pass_checks:  (t.validation.checks ?? []).filter(c => c.status === 'PASS').length,
          failed_checks:(t.validation.checks ?? []).filter(c => c.status !== 'PASS').map(c => c.name),
          issues:       (t.validation.issues ?? []).slice(0, 3),
        } : null,
      })),
    };
  });
  return {
    ...state,
    runs,
    // Cap arrays to keep WS payload under 500 KB
    feed:      (state.feed      ?? []).slice(0, 100),
    agentWork: (state.agentWork ?? []).slice(0, 60).map(w => ({
      agent:         w.agent,
      taskId:        w.taskId,
      title:         w.title,
      status:        w.status,
      goal:          w.goal?.slice(0, 80),
      host:          w.host,
      summary:       (w.summary || w.promptPreview || '').slice(0, 300),
      decisions:     (w.decisions ?? []).slice(0, 4),
      risks:         (w.risks ?? []).slice(0, 3),
      testsRun:      (w.testsRun ?? []).slice(0, 5),
      filesModified: (w.filesModified ?? []).slice(0, 5),
      totalChecks:   w.totalChecks ?? 0,
      passChecks:    w.passChecks ?? 0,
      failedChecks:  (w.failedChecks ?? []).slice(0, 3),
      evidenceCount: w.evidenceCount ?? 0,
      riskCount:     w.riskCount ?? 0,
      specialists:   (w.specialists ?? []).slice(0, 4),
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
    const stagesDir = join(runDir, 'artifacts', 'stages');

    const [manifest, metrics, tasksRaw, contextText, planText, requirements] = await Promise.all([
      readJson(join(runDir, 'manifest.json'), {}),
      readJson(join(runDir, 'metrics.json'), {}),
      readJson(join(runDir, 'tasks.json'), null),
      readFile(join(runDir, 'context.md'), 'utf8').catch(() => ''),
      readFile(join(runDir, 'plan.md'), 'utf8').catch(() => ''),
      // Requirements from stage artifacts (the real agent output)
      readJson(join(stagesDir, '02-requirements', 'requirements.json'), null),
    ]);

    const rawTasks = Array.isArray(tasksRaw)
      ? tasksRaw
      : Array.isArray(tasksRaw?.tasks) ? tasksRaw.tasks : [];
    const tasks = await enrichTasks(projectRoot, runId, rawTasks);
    const events = readJsonlSync(join(runDir, 'events.jsonl'));
    const evidence = readJsonlSync(join(runDir, 'evidence.jsonl'));

    // Parse requirements from functional/non_functional arrays
    const reqList = Array.isArray(requirements)
      ? requirements
      : Array.isArray(requirements?.functional) ? requirements.functional
      : Array.isArray(requirements?.requirements) ? requirements.requirements : [];

    // Per-minute activity timeline — used for sparkline + drill-down
    const activityTimeline = buildActivityTimeline(events);

    // Derive status from events when manifest lacks completed_at
    const derivedStatus = deriveRunStatus(manifest, events);
    const host = inferHost(manifest);

    // Brief from context.md — extract goal section
    const brief = contextText
      ? contextText.split('\n').filter(l => l.trim() && !l.startsWith('#')).slice(0, 3).join(' ').slice(0, 300)
      : '';

    return {
      runId, projectRoot, manifest, metrics, tasks, events, evidence,
      activityTimeline, derivedStatus, host, brief,
      requirements: reqList.slice(0, 20),
      hasPlan: planText.length > 50,
    };
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
  return runs.flatMap((run) => (run.tasks ?? []).map((task) => {
    const checks = task.validation?.checks ?? [];
    const passChecks = checks.filter(c => c.status === 'PASS').length;
    return {
      runId:         run.runId,
      goal:          run.manifest?.goal ?? '',
      host:          run.host,
      projectRoot:   run.projectRoot,
      taskId:        task.id,
      title:         task.title ?? task.id,
      status:        task.status ?? 'READY',
      agent:         task.agent_name ?? 'rstack-agent',
      summary:       task.builder?.summary ?? task.description ?? '',
      decisions:     task.builder?.memory_summary?.decisions ?? [],
      risks:         task.builder?.risks ?? [],
      nextSteps:     task.builder?.next_steps ?? [],
      testsRun:      task.builder?.tests_run ?? [],
      filesModified: (task.builder?.files_modified ?? []).slice(0, 5).map(f =>
        f.replace(/^.*\.rstack\/runs\/[^/]+\//, '')
      ),
      totalChecks:   checks.length,
      passChecks,
      failedChecks:  checks.filter(c => c.status !== 'PASS').map(c => c.name),
      evidenceCount: passChecks,
      riskCount:     (task.builder?.risks ?? []).length,
      promptPreview: task.prompt_preview ?? '',
      specialists:   (task.specialists ?? []).slice(0, 5),
    };
  })).sort((a, b) => `${b.runId}:${b.taskId}`.localeCompare(`${a.runId}:${a.taskId}`)).slice(0, 160);
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

  // Traceability: use requirements already loaded in getRunsForRoot, check stage dirs
  const traceMap = [];
  for (const run of runs.slice(0, 8)) {
    const stageArtifactsDir = join(run.projectRoot ?? projectRoot, '.rstack', 'runs', run.runId, 'artifacts', 'stages');
    const archDir  = join(stageArtifactsDir, '06-architecture');
    const codeFile = join(stageArtifactsDir, '07-code', 'implementation-report.json');
    const testFile = join(stageArtifactsDir, '08-testing', 'qa-report.json');

    // Use requirements already loaded from getRunsForRoot
    const requirements = run.requirements ?? [];

    const [hasCode, hasTest] = await Promise.all([
      readJson(codeFile, null).then(v => v !== null),
      readJson(testFile, null).then(v => v !== null),
    ]);
    const hasArch = existsSync(archDir) && (await readdir(archDir).then(f => f.length > 0).catch(() => false));
    const passTasks = run.tasks.filter(t => t.status === 'PASS');

    if (requirements.length > 0 || hasArch || hasCode || passTasks.length > 0) {
      traceMap.push({
        runId:  run.runId,
        goal:   run.manifest?.goal ?? '—',
        brief:  run.brief ?? '',
        requirements: requirements.slice(0, 20),
        stages: {
          requirements: requirements.length > 0,
          architecture: hasArch,
          code:         hasCode,
          testing:      hasTest,
        },
        passTasks: passTasks.map(t => ({
          id:    t.id,
          title: t.title ?? t.id,
          stageArtifacts: t.stage_artifacts ?? [],
          evidenceCount:  (t.validation?.checks ?? []).filter(c => c.status === 'PASS').length,
        })),
        evidenceTotal: run.tasks.reduce((n, t) =>
          n + ((t.validation?.checks ?? []).filter(c => c.status === 'PASS').length), 0),
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

