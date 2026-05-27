import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// owner: RStack developed by Richardson Gunde

// ── Known event types ────────────────────────────────────────────────────────
const KNOWN_EVENT_TYPES = [
  'run_started', 'task_started', 'builder_task_prepared', 'task_validated',
  'stage_completed', 'approval_gate', 'approval_gate_blocked', 'guardrail_triggered',
  'tool_call', 'tool_result', 'cost_recorded', 'quality_score_recorded',
  'memory_recalled', 'episode_memory_written', 'episode_memory_write_failed',
  'session_shutdown', 'clarification_requested', 'clarification_answers_added', 'plan_created',
];

// ── Low-level readers ────────────────────────────────────────────────────────

/** Read a JSONL file, skipping malformed lines. Returns [] on missing file. */
async function readJsonl(filePath) {
  const raw = await readFile(filePath, 'utf8').catch((err) => {
    if (err?.code === 'ENOENT') return '';
    throw err;
  });
  return raw.split('\n').filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

/** Read a JSON file, return fallback on missing/malformed. */
async function readJson(filePath, fallback = null) {
  try { return JSON.parse(await readFile(filePath, 'utf8')); } catch { return fallback; }
}

// ── RunReport builder ────────────────────────────────────────────────────────

/**
 * Build a RunReport from a run directory.
 * Reads events.jsonl, evidence.jsonl, tasks.json, manifest.json, and per-task validation.json.
 *
 * @param {string} runDir  Absolute path to .rstack/runs/<run_id>
 * @returns {Promise<object>} RunReport
 */
export async function buildRunReport(runDir) {
  const manifest   = await readJson(join(runDir, 'manifest.json'), {});
  const events     = await readJsonl(join(runDir, 'events.jsonl'));
  const evidenceAll = await readJsonl(join(runDir, 'evidence.jsonl'));
  const taskState  = await readJson(join(runDir, 'tasks.json'), { tasks: [] });
  const approvals  = await readJson(join(runDir, 'approvals.json'), []);

  // Evidence grouped by task_id
  const evidenceByTask = {};
  for (const entry of evidenceAll) {
    if (!entry.task_id) continue;
    (evidenceByTask[entry.task_id] ??= []).push(entry);
  }

  // Seed task traces from tasks.json
  const taskTraces = {};
  for (const t of (taskState.tasks ?? [])) {
    taskTraces[t.id] = {
      task_id: t.id, status: t.status ?? null,
      tool_calls: [], tool_results: [],
      guardrail_events: [], memory_events: [],
      evidence: evidenceByTask[t.id] ?? [],
      validation: null,
      tool_call_count: 0, guardrail_hit_count: 0,
    };
  }

  // Walk event stream, attributing events to tasks
  let activeTaskId = null;
  for (const ev of events) {
    if (ev.type === 'task_started' || ev.type === 'builder_task_prepared') activeTaskId = ev.task_id ?? null;
    if (ev.type === 'task_validated') activeTaskId = ev.task_id ?? null;
    if (!activeTaskId) continue;

    const trace = (taskTraces[activeTaskId] ??= {
      task_id: activeTaskId, status: null,
      tool_calls: [], tool_results: [],
      guardrail_events: [], memory_events: [],
      evidence: evidenceByTask[activeTaskId] ?? [],
      validation: null,
      tool_call_count: 0, guardrail_hit_count: 0,
    });

    switch (ev.type) {
      case 'tool_call':             trace.tool_calls.push(ev); trace.tool_call_count++; break;
      case 'tool_result':           trace.tool_results.push(ev); break;
      case 'guardrail_triggered':   trace.guardrail_events.push(ev); trace.guardrail_hit_count++; break;
      case 'memory_recalled':
      case 'episode_memory_written':
      case 'episode_memory_write_failed': trace.memory_events.push(ev); break;
      case 'task_validated':        trace.status = ev.status ?? trace.status; break;
    }
  }

  // Load per-task validation.json and builder.json
  for (const [taskId, trace] of Object.entries(taskTraces)) {
    const taskDir = join(runDir, 'tasks', taskId);
    if (existsSync(taskDir)) {
      trace.validation = await readJson(join(taskDir, 'validation.json'), null);
      trace.builder = await readJson(join(taskDir, 'builder.json'), null);
    }
  }

  // Aggregate guardrail hits by limit name
  const guardrailSummary = {};
  for (const ev of events) {
    if (ev.type !== 'guardrail_triggered') continue;
    const k = ev.limit_name ?? ev.limit ?? 'unknown';
    guardrailSummary[k] = (guardrailSummary[k] ?? 0) + 1;
  }

  // Cost summary
  const costEvents = events.filter((ev) => ev.type === 'cost_recorded');
  const costSummary = {
    total_usd: costEvents.reduce((s, ev) => s + (Number(ev.usd ?? ev.cost ?? 0) || 0), 0),
    total_tokens: costEvents.reduce((s, ev) => s + (Number(ev.tokens) || 0), 0),
    entries: costEvents,
  };

  // Duration from first/last event timestamps
  let durationMs = 0;
  if (events.length > 1) {
    const t0 = Date.parse(events[0].ts), t1 = Date.parse(events[events.length - 1].ts);
    if (Number.isFinite(t0) && Number.isFinite(t1)) durationMs = Math.max(0, t1 - t0);
  }

  // Load requirements spec
  const requirements = await readJson(join(runDir, 'specs', 'requirements.json'), null);
  const memoryAuthentic = !events.some((ev) => ev.type === 'episode_memory_write_failed');

  return {
    run_id:   manifest.run_id ?? 'unknown',
    goal:     manifest.goal ?? '',
    status:   manifest.status ?? 'UNKNOWN',
    mode:     manifest.mode ?? 'interactive',
    created_at: manifest.created_at ?? '',
    duration_ms: durationMs,
    events,
    tasks: taskTraces,
    approvals,
    requirements,
    memory_authentic: memoryAuthentic,
    guardrail_summary: guardrailSummary,
    cost_summary: costSummary,
    quality_scores: events.filter((ev) => ev.type === 'quality_score_recorded'),
    stage_ids_completed: events.filter((ev) => ev.type === 'stage_completed' && ev.stage_id).map((ev) => ev.stage_id),
    missing_event_types: KNOWN_EVENT_TYPES.filter((t) => !new Set(events.map((ev) => ev.type)).has(t)),
  };
}

/**
 * Backward-compatible report builder used by existing tests and dashboard.js.
 * Returns the original flat shape: cost_usd, tool_calls, stages[], guardrails_triggered[].
 * Fields read from events use the original names (cost, limit, value).
 *
 * For the richer RunReport shape use buildRunReport() directly.
 */
export async function generateRunReport(projectRoot, runId) {
  const runDir = join(projectRoot, '.rstack', 'runs', runId);
  const manifest   = await readJson(join(runDir, 'manifest.json'), {});
  const events     = await readJsonl(join(runDir, 'events.jsonl'));
  const evidenceAll = await readJsonl(join(runDir, 'evidence.jsonl'));
  const taskState  = await readJson(join(runDir, 'tasks.json'), { tasks: [] });

  let durationMs = 0;
  if (events.length > 1) {
    const t0 = Date.parse(events[0].ts), t1 = Date.parse(events[events.length - 1].ts);
    if (Number.isFinite(t0) && Number.isFinite(t1)) durationMs = Math.max(0, t1 - t0);
  }

  let costUsd = 0;
  let toolCallsCount = 0;
  const stageElapsed = {};
  const guardrailsTriggeredList = [];

  for (const ev of events) {
    if (ev.type === 'tool_call') toolCallsCount++;
    if (ev.type === 'cost_recorded' && ev.cost) costUsd += Number(ev.cost);
    if (ev.type === 'stage_completed' && ev.stage_id && ev.elapsed_ms) {
      stageElapsed[ev.stage_id] = (stageElapsed[ev.stage_id] || 0) + Number(ev.elapsed_ms);
    }
    if (ev.type === 'guardrail_triggered') {
      guardrailsTriggeredList.push({ limit: ev.limit ?? ev.limit_name, value: ev.value ?? ev.current_value, timestamp: ev.ts });
    }
  }

  const evidenceByTask = {};
  for (const entry of evidenceAll) {
    if (!entry.task_id) continue;
    (evidenceByTask[entry.task_id] ??= []).push(entry.evidence ?? entry);
  }

  const stages = (taskState.tasks ?? []).map((task) => ({
    stage_id: task.id,
    status: task.status || 'READY',
    elapsed_ms: stageElapsed[task.id] || 0,
    artifacts: (task.stage_artifacts ?? []).map((a) => a.artifact_path).filter(Boolean),
    evidence: evidenceByTask[task.id] ?? [],
  }));

  return { run_id: runId, goal: manifest.goal || '', status: manifest.status || 'STARTED', duration_ms: durationMs, cost_usd: costUsd, tool_calls: toolCallsCount, stages, guardrails_triggered: guardrailsTriggeredList, events };
}

// ── HTML renderers ────────────────────────────────────────────────────────────

/**
 * Render a RunReport as a self-contained HTML observability dashboard.
 * Zero external deps — pure inline CSS + vanilla JS, tabbed layout.
 *
 * @param {object} report  Result of buildRunReport()
 * @returns {string}  Full HTML document
 */
export function renderDashboardHtml(report) {
  const tasks = Object.values(report.tasks);
  const passCount      = tasks.filter((t) => t.status === 'PASS').length;
  const failCount      = tasks.filter((t) => t.status === 'FAIL').length;
  const activeCount    = tasks.filter((t) => !t.status || t.status === 'PENDING' || t.status === 'READY' || t.status === 'IN_PROGRESS').length;
  const totalTools     = tasks.reduce((s, t) => s + t.tool_call_count, 0);
  const totalGuardrail = tasks.reduce((s, t) => s + t.guardrail_hit_count, 0);

  const ledgerStatus = report.memory_authentic ? '🟢 SECURED' : '⚠️ COMPROMISED';

  const taskRows = tasks.map((t) => {
    const memRecall = t.memory_events.filter((e) => e.type === 'memory_recalled').reduce((s, e) => s + (e.count ?? e.episode_count ?? 0), 0);
    const memWrite  = t.memory_events.filter((e) => e.type === 'episode_memory_written').length;
    const memFail   = t.memory_events.filter((e) => e.type === 'episode_memory_write_failed').length;
    const memStatus = `${memRecall}&nbsp;recalled&nbsp;/&nbsp;${memWrite}&nbsp;written${memFail > 0 ? `&nbsp;(<span class="warn">${memFail}&nbsp;failed</span>)` : ''}`;
    
    const agentName = t.builder ? (t.builder.agent ?? 'orchestrator') : 'orchestrator';
    const attemptVal = t.builder ? (t.builder.attempt ?? '1') : '1';
    const filesMod = t.builder && t.builder.files_modified ? t.builder.files_modified : [];
    const filesText = filesMod.length > 0
      ? `<details style="cursor:pointer;"><summary style="color:var(--blue)">${filesMod.length} file(s)</summary><div class="mono" style="font-size:9.5px;margin-top:2.5px;color:var(--dim);line-height:1.2;">${filesMod.map(f => esc(f.split('/').pop())).join('<br/>')}</div></details>`
      : '<span class="dim">—</span>';

    return `<tr>
      <td class="mono">${esc(t.task_id)}</td>
      <td class="mono" style="color:var(--violet)">${esc(agentName)}</td>
      <td class="num">${attemptVal}</td>
      <td>${filesText}</td>
      <td>${pill(t.status)}</td>
      <td class="num">${t.tool_call_count}</td>
      <td class="num">${t.guardrail_hit_count > 0 ? `<span class="warn">${t.guardrail_hit_count}</span>` : '0'}</td>
      <td class="num">${memStatus}</td>
      <td class="num">${t.evidence.length}</td>
      <td>${t.validation ? pill(t.validation.status) : '<span class="pill pill-none">—</span>'}</td>
    </tr>`;
  }).join('');

  const eventRows = report.events.slice(-150).map((ev) => {
    const detail = Object.entries(ev).filter(([k]) => k !== 'ts' && k !== 'type')
      .map(([k, v]) => `<b>${esc(k)}</b>:&nbsp;${esc(trunc(String(v), 90))}`).join('&ensp;');
    return `<tr><td class="ts">${esc(ev.ts ?? '')}</td><td><span class="eb eb-${safeC(ev.type)}">${esc(ev.type)}</span></td><td>${detail}</td></tr>`;
  }).join('');

  const grRows = Object.entries(report.guardrail_summary)
    .map(([k, v]) => `<tr><td class="mono">${esc(k)}</td><td class="num warn">${v}</td></tr>`).join('')
    || '<tr><td colspan="2" class="dim">No guardrails triggered</td></tr>';

  const apRows = report.approvals
    .map((a) => `<tr><td class="mono">${esc(a.artifact)}</td><td>${pill(a.status)}</td><td class="ts">${esc(a.timestamp ?? '')}</td><td>${esc(a.comments ?? '')}</td></tr>`).join('')
    || '<tr><td colspan="4" class="dim">No approvals recorded</td></tr>';

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>RStack Dashboard — ${esc(report.run_id)}</title>
<style>
:root{--bg:#0d1117;--panel:#161b22;--border:#30363d;--text:#e6edf3;--dim:#8b949e;
--accent:#ea580c;--pass:#3fb950;--fail:#f85149;--warn:#d29922;--violet:#8b5cf6;--blue:#58a6ff;
--f:'Segoe UI',system-ui,sans-serif;--m:'Cascadia Code','Fira Code',Consolas,monospace}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:var(--f);background:var(--bg);color:var(--text);font-size:13px;line-height:1.5}
header{background:var(--panel);border-bottom:1px solid var(--border);padding:14px 24px;
  display:flex;align-items:center;gap:14px;position:sticky;top:0;z-index:10}
header h1{font-size:14px;font-weight:700}.accent{color:var(--accent);font-weight:700}
.rid{font-family:var(--m);font-size:11px;color:var(--dim);background:#0d1117;
  border:1px solid var(--border);padding:3px 8px;border-radius:6px}
.rbtn{margin-left:auto;background:var(--accent);color:#fff;border:none;padding:5px 14px;
  border-radius:6px;font-size:12px;font-weight:600;cursor:pointer}
.rbtn:hover{opacity:.85}
.main{padding:20px 24px;max-width:1400px;margin:0 auto}
.kpis{display:grid;grid-template-columns:repeat(6,1fr);gap:12px;margin-bottom:20px}
.kpi{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:14px 16px}
.kv{font-size:26px;font-weight:700;line-height:1.1}.kl{font-size:10.5px;font-weight:600;
  color:var(--dim);text-transform:uppercase;letter-spacing:.05em;margin-top:4px}
.kpi.pass .kv{color:var(--pass)}.kpi.fail .kv{color:var(--fail)}.kpi.active .kv{color:var(--violet)}
.kpi.warn .kv{color:var(--warn)}.kpi.info .kv{color:var(--blue)}.kpi.cost .kv{color:var(--accent)}
.card{background:var(--panel);border:1px solid var(--border);border-radius:10px;margin-bottom:16px;overflow:hidden}
.chdr{padding:11px 16px;font-size:11.5px;font-weight:700;color:var(--dim);text-transform:uppercase;
  letter-spacing:.06em;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center}
.badge{background:var(--border);padding:2px 8px;border-radius:4px;font-size:10px;color:var(--text)}
table{width:100%;border-collapse:collapse}
th{font-size:10.5px;font-weight:600;color:var(--dim);text-transform:uppercase;letter-spacing:.04em;
  padding:8px 12px;border-bottom:1px solid var(--border);text-align:left}
td{padding:8px 12px;border-bottom:1px solid #21262d;vertical-align:top}
tr:last-child td{border-bottom:none}tr:hover td{background:rgba(255,255,255,.025)}
.mono{font-family:var(--m);font-size:11.5px}.num{text-align:right;font-family:var(--m)}
.ts{font-family:var(--m);font-size:10.5px;color:var(--dim);white-space:nowrap}
.dim{color:var(--dim);font-style:italic}.warn{color:var(--warn);font-weight:600}
.pill{display:inline-block;font-size:10px;font-weight:700;padding:2px 8px;border-radius:4px;
  text-transform:uppercase;letter-spacing:.04em}
.pill-pass,.pill-approved{background:rgba(63,185,80,.15);color:var(--pass);border:1px solid rgba(63,185,80,.3)}
.pill-fail,.pill-rejected{background:rgba(248,81,73,.15);color:var(--fail);border:1px solid rgba(248,81,73,.3)}
.pill-pending,.pill-ready{background:rgba(139,92,246,.15);color:var(--violet);border:1px solid rgba(139,92,246,.3)}
.pill-in_progress{background:rgba(88,166,255,.15);color:var(--blue);border:1px solid rgba(88,166,255,.3)}
.pill-none{background:var(--border);color:var(--dim)}
.eb{display:inline-block;font-size:10px;font-weight:600;padding:1px 6px;border-radius:3px;
  font-family:var(--m);white-space:nowrap;background:var(--border);color:var(--text)}
.eb-tool_call{background:rgba(88,166,255,.15);color:var(--blue)}
.eb-tool_result{background:rgba(63,185,80,.12);color:var(--pass)}
.eb-guardrail_triggered{background:rgba(210,153,34,.2);color:var(--warn)}
.eb-task_validated{background:rgba(63,185,80,.15);color:var(--pass)}
.eb-task_started,.eb-builder_task_prepared{background:rgba(234,88,12,.15);color:var(--accent)}
.eb-memory_recalled{background:rgba(139,92,246,.15);color:var(--violet)}
.tabs{display:flex;gap:2px;padding:4px 16px 0;border-bottom:1px solid var(--border)}
.tab{padding:8px 14px;font-size:11.5px;font-weight:600;color:var(--dim);cursor:pointer;border-bottom:2px solid transparent}
.tab.active{color:var(--text);border-bottom-color:var(--accent)}
.tp{display:none}.tp.active{display:block}
.gat{font-size:10px;color:var(--dim);text-align:right;padding:8px 0 0}
@media(max-width:900px){.kpis{grid-template-columns:repeat(3,1fr)}}
</style></head>
<body>
<header>
  <span class="accent">RStack</span>
  <h1>RStack Run Observability Hub</h1>
  <span class="rid">${esc(report.run_id)}</span>
  <button class="rbtn" onclick="location.reload()">&#x21BA; Refresh</button>
</header>
<div class="main">
  <div class="kpis">
    <div class="kpi pass"><div class="kv">${passCount}</div><div class="kl">Tasks Pass</div></div>
    <div class="kpi fail"><div class="kv">${failCount}</div><div class="kl">Tasks Fail</div></div>
    <div class="kpi active"><div class="kv" style="font-size:16px;line-height:30px;">${ledgerStatus}</div><div class="kl">Memory Ledger</div></div>
    <div class="kpi warn"><div class="kv">${totalGuardrail}</div><div class="kl">Guardrail Hits</div></div>
    <div class="kpi info"><div class="kv">${totalTools}</div><div class="kl">Tool Calls</div></div>
    <div class="kpi cost"><div class="kv">$${report.cost_summary.total_usd.toFixed(4)}</div><div class="kl">Recorded Cost</div></div>
  </div>
  <div class="card">
    <div class="chdr">Run Metadata <span class="badge">${esc(report.status)}</span></div>
    <table>
      <tr><td class="dim" style="width:140px">Goal</td><td>${esc(report.goal)}</td></tr>
      <tr><td class="dim">Mode</td><td>${esc(report.mode)}</td></tr>
      <tr><td class="dim">Created</td><td class="ts">${esc(report.created_at)}</td></tr>
      <tr><td class="dim">Duration</td><td>${(report.duration_ms / 1000).toFixed(1)}s</td></tr>
      <tr><td class="dim">Events</td><td>${report.events.length}</td></tr>
      <tr><td class="dim">Stages completed</td><td class="mono">${report.stage_ids_completed.join(', ') || '—'}</td></tr>
    </table>
  </div>
  <div class="card">
    <div class="tabs">
      <div class="tab active" onclick="st(this,'tasks')">Tasks</div>
      <div class="tab" onclick="st(this,'events')">Event Stream</div>
      <div class="tab" onclick="st(this,'guardrails')">Guardrails</div>
      <div class="tab" onclick="st(this,'approvals')">Approvals</div>
      <div class="tab" onclick="st(this,'traceability')">Traceability Explorer</div>
    </div>
    <div id="tp-tasks" class="tp active"><table>
      <thead><tr><th>Task ID</th><th>Specialist</th><th>Attempt</th><th>Files Modified</th><th>Status</th><th style="text-align:right">Tool Calls</th>
        <th style="text-align:right">Guardrail Hits</th><th>Memory</th>
        <th style="text-align:right">Evidence</th><th>Validation</th></tr></thead>
      <tbody>${taskRows || '<tr><td colspan="10" class="dim">No tasks yet.</td></tr>'}</tbody>
    </table></div>
    <div id="tp-events" class="tp"><table>
      <thead><tr><th>Timestamp</th><th>Type</th><th>Details</th></tr></thead>
      <tbody>${eventRows || '<tr><td colspan="3" class="dim">No events.</td></tr>'}</tbody>
    </table></div>
    <div id="tp-guardrails" class="tp"><table>
      <thead><tr><th>Limit Name</th><th style="text-align:right">Hits</th></tr></thead>
      <tbody>${grRows}</tbody>
    </table></div>
    <div id="tp-approvals" class="tp"><table>
      <thead><tr><th>Artifact</th><th>Status</th><th>Timestamp</th><th>Comments</th></tr></thead>
      <tbody>${apRows}</tbody>
    </table></div>
    <div id="tp-traceability" class="tp" style="padding:16px 20px;">
      <h3 style="margin-bottom:12px;color:var(--accent);">Enterprise Traceability Explorer</h3>
      <p class="dim" style="margin-bottom:20px;">Maps active product requirements to architecture elements, validation tasks, modified source code files, and final verify evidence.</p>
      <div style="background:#0d1117;border:1px solid var(--border);border-radius:8px;padding:16px 20px;">
        ${renderTraceabilityTree(report)}
      </div>
    </div>
  </div>
  <div class="gat">Generated ${new Date().toISOString()} · RStack developed by Richardson Gunde</div>
</div>
<script>
function st(el,name){
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.tp').forEach(p=>p.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('tp-'+name).classList.add('active');
}
</script>
</body></html>`;
}

/**
 * Render a single-task trace as a self-contained HTML page.
 * LangSmith-style: tool I/O pairs, guardrails, memory, evidence, validation checks.
 *
 * @param {object} trace  TaskTrace from buildRunReport().tasks[taskId]
 * @param {string} runId
 * @returns {string}  Full HTML document
 */
export function renderTraceHtml(trace, runId) {
  const pairs = pairToolEvents(trace.tool_calls, trace.tool_results);

  const toolHtml = pairs.map(({ call, result }) => {
    const inp = call.input ? JSON.stringify(call.input, null, 2) : '';
    const out = result?.summary ?? result?.output ?? '';
    const errBadge = result?.isError ? '<span class="pill pill-fail">ERROR</span>' : '';
    return `<div class="tp-pair">
      <div class="tp-hdr"><span class="tn">${esc(call.tool ?? 'unknown')}</span>${errBadge}<span class="ts">${esc(call.ts ?? '')}</span></div>
      ${inp ? `<div class="slbl">Input</div><pre class="cb">${esc(trunc(inp, 900))}</pre>` : ''}
      ${out ? `<div class="slbl">Output</div><pre class="cb out">${esc(trunc(String(out), 1100))}</pre>` : ''}
    </div>`;
  }).join('') || '<p class="dmp">No tool calls recorded.</p>';

  const grRows = trace.guardrail_events.map((ev) =>
    `<tr><td class="mono">${esc(ev.limit_name ?? ev.limit ?? '?')}</td>
     <td class="num">${esc(String(ev.current_value ?? ev.value ?? '?'))}</td>
     <td class="num">${esc(String(ev.limit_value ?? '?'))}</td>
     <td class="ts">${esc(ev.ts ?? '')}</td></tr>`
  ).join('') || '<tr><td colspan="4" class="dim">No guardrails triggered.</td></tr>';

  const memRows = trace.memory_events.map((ev) => {
    let kind = 'PASS';
    let detail = '';
    if (ev.type === 'memory_recalled') {
      kind = 'IN_PROGRESS';
      detail = `${ev.episode_count ?? ev.count ?? '?'} episodes recalled`;
    } else if (ev.type === 'episode_memory_write_failed') {
      kind = 'FAIL';
      detail = `episode write failed — error: ${esc(ev.error ?? 'unknown')}`;
    } else {
      detail = `episode written — id: ${esc(ev.episode_id ?? '?')}, trusted: ${esc(String(ev.trusted ?? '?'))}`;
    }
    return `<tr><td>${pill(kind)}</td><td>${detail}</td><td class="ts">${esc(ev.ts ?? '')}</td></tr>`;
  }).join('') || '<tr><td colspan="3" class="dim">No memory events.</td></tr>';

  const evRows = trace.evidence.map((ev) =>
    `<tr><td>${pill(ev.status)}</td><td class="mono">${esc(ev.kind ?? '?')}</td>
     <td class="mono">${esc(ev.evidence ?? '')}</td><td class="ts">${esc(ev.ts ?? '')}</td></tr>`
  ).join('') || '<tr><td colspan="4" class="dim">No evidence.</td></tr>';

  const valHtml = trace.validation
    ? `<table><thead><tr><th>Check</th><th>Status</th><th>Evidence</th></tr></thead><tbody>
        ${(trace.validation.checks ?? []).map((c) =>
          `<tr><td class="mono">${esc(c.name)}</td><td>${pill(c.status)}</td><td class="mono">${esc(String(c.evidence ?? ''))}</td></tr>`
        ).join('')}</tbody></table>`
    : '<p class="dmp">No validation.json found.</p>';

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<title>RStack Trace — ${esc(trace.task_id)}</title>
<style>
:root{--bg:#0d1117;--panel:#161b22;--border:#30363d;--text:#e6edf3;--dim:#8b949e;
--accent:#ea580c;--pass:#3fb950;--fail:#f85149;--warn:#d29922;--violet:#8b5cf6;--blue:#58a6ff;
--f:'Segoe UI',system-ui,sans-serif;--m:'Cascadia Code','Fira Code',Consolas,monospace}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:var(--f);background:var(--bg);color:var(--text);font-size:13px;line-height:1.6}
header{background:var(--panel);border-bottom:1px solid var(--border);padding:13px 24px;
  position:sticky;top:0;z-index:10;display:flex;align-items:center;gap:12px}
header h1{font-size:14px;font-weight:700}.accent{color:var(--accent);font-weight:700}
.rid{font-family:var(--m);font-size:11px;color:var(--dim);background:#0d1117;
  border:1px solid var(--border);padding:3px 8px;border-radius:6px}
.main{max-width:1100px;margin:0 auto;padding:20px 24px;display:flex;flex-direction:column;gap:16px}
.card{background:var(--panel);border:1px solid var(--border);border-radius:10px;overflow:hidden}
.chdr{padding:10px 16px;font-size:11.5px;font-weight:700;color:var(--dim);text-transform:uppercase;
  letter-spacing:.06em;border-bottom:1px solid var(--border)}
table{width:100%;border-collapse:collapse}
th{font-size:10.5px;color:var(--dim);text-transform:uppercase;letter-spacing:.04em;
  padding:8px 14px;border-bottom:1px solid var(--border);text-align:left}
td{padding:8px 14px;border-bottom:1px solid #21262d;vertical-align:top}
tr:last-child td{border-bottom:none}
.mono{font-family:var(--m);font-size:11.5px}.num{text-align:right;font-family:var(--m)}
.ts{font-family:var(--m);font-size:10.5px;color:var(--dim);white-space:nowrap}
.dim{color:var(--dim)}.dmp{padding:14px 16px;color:var(--dim);font-style:italic;font-size:12px}
.pill{display:inline-block;font-size:10px;font-weight:700;padding:2px 8px;border-radius:4px;
  text-transform:uppercase;letter-spacing:.04em}
.pill-pass{background:rgba(63,185,80,.15);color:var(--pass);border:1px solid rgba(63,185,80,.3)}
.pill-fail{background:rgba(248,81,73,.15);color:var(--fail);border:1px solid rgba(248,81,73,.3)}
.pill-pending,.pill-ready{background:rgba(139,92,246,.15);color:var(--violet);border:1px solid rgba(139,92,246,.3)}
.pill-in_progress{background:rgba(88,166,255,.15);color:var(--blue);border:1px solid rgba(88,166,255,.3)}
.pill-none{background:var(--border);color:var(--dim)}
.stat-row{display:flex;gap:24px;padding:12px 16px}
.stat .sv{font-size:22px;font-weight:700}.stat .sl{font-size:10px;color:var(--dim);text-transform:uppercase;letter-spacing:.05em}
.tp-pair{border-bottom:1px solid var(--border);padding:14px 16px}
.tp-pair:last-child{border-bottom:none}
.tp-hdr{display:flex;align-items:center;gap:10px;margin-bottom:8px}
.tn{font-family:var(--m);font-size:13px;font-weight:700;color:var(--blue)}
.slbl{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;
  color:var(--dim);margin-top:8px;margin-bottom:4px}
.cb{background:#0d1117;border:1px solid var(--border);border-radius:6px;padding:10px 14px;
  font-family:var(--m);font-size:11.5px;white-space:pre-wrap;word-break:break-word;color:#cdd9e5}
.cb.out{color:#aff5b4}
</style></head>
<body>
<header>
  <span class="accent">RStack</span>
  <h1>Task Trace:&nbsp;<span class="mono">${esc(trace.task_id)}</span></h1>
  <span class="rid">${esc(runId)}</span>
  ${pill(trace.status ?? 'PENDING')}
</header>
<div class="main">
  <div class="card">
    <div class="chdr">Summary</div>
    <div class="stat-row">
      <div class="stat"><div class="sv" style="color:var(--blue)">${trace.tool_call_count}</div><div class="sl">Tool Calls</div></div>
      <div class="stat"><div class="sv" style="color:var(--warn)">${trace.guardrail_hit_count}</div><div class="sl">Guardrail Hits</div></div>
      <div class="stat"><div class="sv" style="color:var(--violet)">${trace.memory_events.filter(e=>e.type==='memory_recalled').length}</div><div class="sl">Memory Recalls</div></div>
      <div class="stat"><div class="sv" style="color:var(--pass)">${trace.evidence.length}</div><div class="sl">Evidence Events</div></div>
    </div>
  </div>
  <div class="card"><div class="chdr">Tool Calls &amp; Results</div>${toolHtml}</div>
  <div class="card"><div class="chdr">Guardrail Events</div>
    <table><thead><tr><th>Limit</th><th style="text-align:right">Current</th><th style="text-align:right">Max</th><th>Timestamp</th></tr></thead>
    <tbody>${grRows}</tbody></table></div>
  <div class="card"><div class="chdr">Memory Events</div>
    <table><thead><tr><th>Kind</th><th>Detail</th><th>Timestamp</th></tr></thead>
    <tbody>${memRows}</tbody></table></div>
  <div class="card"><div class="chdr">Evidence Ledger</div>
    <table><thead><tr><th>Status</th><th>Kind</th><th>Evidence Path</th><th>Timestamp</th></tr></thead>
    <tbody>${evRows}</tbody></table></div>
  <div class="card"><div class="chdr">Validation Checks</div>${valHtml}</div>
</div>
</body></html>`;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function trunc(s, max) {
  return s.length <= max ? s : s.slice(0, max) + `… [+${s.length - max} chars]`;
}
function safeC(s) { return String(s ?? '').replace(/[^a-z0-9_]/g,'_'); }
function pill(status) {
  const s = (status ?? 'NONE').toLowerCase();
  return `<span class="pill pill-${s}">${esc(status ?? '—')}</span>`;
}
function pairToolEvents(calls, results) {
  const map = {};
  for (const r of results) (map[r.tool ?? '__'] ??= []).push(r);
  return calls.map((call) => ({ call, result: (map[call.tool ?? '__'] ?? []).shift() ?? null }));
}

function renderTraceabilityTree(report) {
  const reqs = report.requirements;
  const tasks = Object.values(report.tasks);
  
  if (reqs && reqs.requirements && reqs.requirements.length > 0) {
    return reqs.requirements.map(req => {
      const associatedTasks = tasks.filter(t => t.task_id.includes(req.id) || (req.stages && req.stages.some(s => t.task_id.includes(s))));
      const taskNodes = associatedTasks.map(t => {
        const files = t.builder && t.builder.files_modified ? t.builder.files_modified : [];
        const filesHtml = files.map(f => `<div style="padding-left:24px;color:var(--blue);">📝 File: ${esc(f.split('/').pop())}</div>`).join('');
        const statusIcon = t.status === 'PASS' ? '🟢' : '🔴';
        return `<div style="padding-left:24px;margin-bottom:4px;">
          ${statusIcon} <b>Task:</b> ${esc(t.task_id)} (${t.status ?? 'READY'})
          ${filesHtml}
        </div>`;
      }).join('') || '<div style="padding-left:24px;color:var(--dim);">No executing tasks yet.</div>';

      return `<div style="margin-bottom:16px;border-bottom:1px solid var(--border);padding-bottom:12px;">
        <div style="font-weight:700;color:var(--accent);margin-bottom:6px;">📋 ${esc(req.id)}: ${esc(req.title)}</div>
        <div class="dim" style="font-size:11.5px;padding-left:14px;margin-bottom:8px;">${esc(req.description)}</div>
        ${taskNodes}
      </div>`;
    }).join('');
  }

  // Fallback beautiful traceability pipeline map for runs without explicit specs loaded yet
  const pipelineNodes = tasks.map(t => {
    const statusIcon = t.status === 'PASS' ? '🟢' : '🔴';
    const files = t.builder && t.builder.files_modified ? t.builder.files_modified : [];
    const filesHtml = files.map(f => `<div style="padding-left:24px;color:var(--blue);font-family:var(--m);font-size:11px;">➔ file: ${esc(f.split('/').pop())}</div>`).join('');
    const evHtml = t.validation && t.validation.checks
      ? t.validation.checks.map(c => `<div style="padding-left:24px;color:var(--pass);font-size:11px;">✔ evidence: ${esc(c.name)}</div>`).join('')
      : '';
    return `<div style="margin-bottom:10px;padding-left:14px;border-left:2px solid var(--border);">
      <div style="font-weight:600;color:var(--text);">${statusIcon} Pipeline Stage: ${esc(t.task_id)} (${t.status ?? 'READY'})</div>
      ${filesHtml}
      ${evHtml}
    </div>`;
  }).join('');

  return `<div style="margin-bottom:12px;font-weight:700;color:var(--blue);">Active Pipeline Trace Ledger</div>
          ${pipelineNodes || '<p class="dim">No active execution trace ledger found.</p>'}`;
}
