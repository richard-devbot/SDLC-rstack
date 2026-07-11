import { join } from 'node:path';
import { evaluateAlerts } from '../../alerts/engine.js';
import { sourceRoots } from './roots.js';
import { getIndexedRuns } from './rollup-index.js';
import { getAllApprovals, buildBlockedGates, approvalRequestsFromBlockedGates, summarizeApprovals, resolveApprovalAcrossRoots } from './approvals.js';
import { buildActivityFeed } from './feed.js';
import { buildStageMatrix } from './stage-matrix.js';
import { buildAgentGroups, buildAgentWork } from './agent-work.js';
import { buildTraceMap } from './traceability.js';
import { buildProjectSummaries } from './projects.js';
import { buildDiagnostics, buildLayerSummaries } from './layers.js';
import { buildStageTrends, persistedTokenTotals } from '../../metrics/derive.js';
import { buildPeople, buildPresence } from './people.js';
import { buildBusinessFlexState } from './business-flex.js';
import { buildDecisionState } from './decisions.js';
import { buildEnvironmentState } from './environment.js';
import { buildReadinessProjection } from './readiness.js';
import { validateProjectConfigs } from '../../../core/harness/config-validation.js';
// [wave:command] imports — pipeline rollup enrichment (#94 / #156 / #215)
import { readPipelineState, buildPipelineState } from '../../../core/harness/pipeline-state.js';
import { recommendPipelineAction } from '../../../commands/pipeline.js';
import { runDirectory } from '../../../core/harness/runs.js';
import { readJson } from './files.js';
export { toClientState } from './client-state.js';
export { resolveApprovalAcrossRoots } from './approvals.js';

// owner: RStack developed by Richardson Gunde

export async function buildFullState(projectRoot, options = {}) {
  const roots = await sourceRoots(projectRoot, options);
  // Rollup index: completed runs come from .rstack/index.json; only active
  // (or explicitly scoped) runs pay the full directory parse.
  const [{ runs, indexMeta }, queueApprovals] = await Promise.all([
    getIndexedRuns(roots, {
      scopeRunIds: options.scopeRunIds,
      retentionDays: options.retentionDays,
      io: options.indexIo,
      now: options.now,
    }),
    getAllApprovals(roots),
  ]);

  // [wave:command] Compact pipeline-state rollup per run (#94/#156/#215).
  await attachPipelineRollups(runs);

  // run.totals already prefers persisted cumulative metrics (#83) and falls
  // back to event recompute for legacy runs; the metrics.json chain here is
  // the last resort for index entries without totals.
  const totalCost = runs.reduce((sum, run) => sum + (run.totals?.cost_usd || run.metrics?.cumulative_cost_usd || 0), 0);
  const tokenTotal = runs.reduce((sum, run) => sum + (run.totals?.tokens
    || persistedTokenTotals(run.metrics)?.total
    || Number(run.metrics?.cumulative_tokens ?? run.metrics?.total_tokens ?? 0) || 0), 0);
  const activeRuns = runs.filter((run) => run.derivedStatus === 'active');
  const today = new Date().toISOString().slice(0, 10);
  const todayRuns = runs.filter((run) => run.manifest?.created_at?.startsWith(today));

  const blockedGates = buildBlockedGates(runs);
  const actionableGateApprovals = approvalRequestsFromBlockedGates(blockedGates, queueApprovals);
  const approvals = summarizeApprovals([...queueApprovals, ...actionableGateApprovals]);
  const feed = buildActivityFeed(runs);
  const frameworks = buildFrameworks(runs);
  const stageMatrix = buildStageMatrix(runs);
  const agentWork = buildAgentWork(runs);
  const agentGroups = buildAgentGroups(agentWork);
  const projectSummaries = buildProjectSummaries(runs, roots);
  const traceMap = await buildTraceMap(runs, projectRoot);
  const trends = buildStageTrends(runs);
  const people = buildPeople(runs);
  const presence = buildPresence(runs);

  const alertInputs = {
    runs,
    pendingApprovals: approvals.pendingApprovals.length,
  };
  const alerts = [
    ...buildBlockedGateAlerts(blockedGates),
    ...evaluateAlerts(alertInputs),
  ];

  const baseState = {
    kind: 'snapshot',
    product: 'RStack Command Center',
    stateRoot: join(projectRoot, '.rstack'),
    sourceRoots: roots,
    runs,
    activeRuns: activeRuns.map((run) => run.runId),
    todayCount: todayRuns.length,
    totalRuns: runs.length,
    totalCost,
    tokenTotal,
    frameworks,
    feed,
    approvals: approvals.approvals,
    approvalStats: approvals.approvalStats,
    pendingApprovals: approvals.pendingApprovals,
    blockedGates,
    alerts,
    traceMap,
    stageMatrix,
    agentWork,
    agentGroups,
    projectSummaries,
    trends,
    people,
    presence,
    businessFlex: buildBusinessFlexState(runs),
    decisions: await buildDecisionState(runs),
    // Environment & Integrations (#238): defensive by contract — absent
    // report/integrations/.env files are honest empty state, never a crash.
    environment: await buildEnvironmentState(projectRoot, runs, queueApprovals),
    diagnostics: {
      ...buildDiagnostics(runs, roots, indexMeta),
      // Config validation (#151): invalid .rstack config values are surfaced
      // here per root so Diagnostics shows exactly which field is ignored.
      configIssues: (await Promise.all(roots.map(async (root) => (
        (await validateProjectConfigs(root)).map((issue) => ({ root, ...issue }))
      )))).flat(),
    },
    ts: new Date().toISOString(),
  };

  const stateWithReadiness = {
    ...baseState,
    readiness: buildReadinessProjection(baseState, { evaluatedAt: baseState.ts }),
  };

  return {
    ...stateWithReadiness,
    layers: buildLayerSummaries(stateWithReadiness),
  };
}

export async function resolveDashboardApproval(projectRoot, id, decision, resolvedBy, options = {}) {
  const roots = await sourceRoots(projectRoot, options);
  return resolveApprovalAcrossRoots(roots, id, decision, resolvedBy, { actor: options.actor });
}

function buildFrameworks(runs) {
  const frameworks = {};
  for (const run of runs ?? []) {
    const framework = run.manifest?.framework ?? run.manifest?.mode ?? 'unknown';
    if (!frameworks[framework]) frameworks[framework] = { runs: 0, cost: 0, pass: 0, fail: 0 };
    frameworks[framework].runs++;
    frameworks[framework].cost += run.metrics?.cumulative_cost_usd ?? 0;
    for (const task of run.tasks ?? []) {
      if (task.status === 'PASS') frameworks[framework].pass++;
      if (task.status === 'FAIL') frameworks[framework].fail++;
    }
  }
  return frameworks;
}

function buildBlockedGateAlerts(blockedGates) {
  return (blockedGates ?? []).slice(0, 20).map((gate) => ({
    id: `blocked-${gate.id}`,
    level: 'warn',
    type: 'approval_gate_blocked',
    title: 'Workflow blocked by approval gate',
    detail: `${gate.detail}${gate.missing?.length ? ` - missing ${gate.missing.join(', ')}` : ''}`,
    runId: gate.runId,
    ts: gate.ts,
  }));
}

// ── [wave:command] Pipeline rollup enrichment (#94 / #156 / #215) ───────────
// Attaches `run.pipelineRollup` — a compact summary of the run's
// pipeline-state.json — so the Command Center shows the SAME next-action the
// `rstack-agents pipeline status` CLI computes: recommendPipelineAction is
// reused verbatim, never re-implemented client-side (no second brain).
//
// Read path only: a persisted pipeline-state.json is preferred (one small
// read); fully-parsed runs without one are summarized in memory via
// buildPipelineState — the dashboard never writes run state. Index-served
// lite runs without a persisted rollup stay null, and the UI shows an honest
// "no pipeline state recorded" instead of a guess. Best-effort by contract:
// any per-run failure yields null, never a broken snapshot.

const ROLLUP_FAILED_STATUSES = new Set(['FAIL', 'FAILED', 'ERROR', 'BLOCKED']);
const ROLLUP_PASSED_STATUSES = new Set(['PASS', 'PASSED', 'SUCCESS', 'SUCCEEDED', 'DONE', 'COMPLETED']);

async function attachPipelineRollups(runs) {
  await Promise.all((runs ?? []).map(async (run) => {
    try {
      let state = await readPipelineState(run.projectRoot, run.runId);
      if (!state && !run.fromIndex) state = await buildPipelineState(run.projectRoot, run.runId);
      run.pipelineRollup = state ? compactPipelineRollup(state, run.events ?? []) : null;
    } catch {
      run.pipelineRollup = null;
    }
    // Index-served lite runs rebuild a synthetic manifest that drops
    // schema_version (#82 stamps it, #156 renders it) — restore it with one
    // tiny manifest read so migration state stays observable for every run.
    if (run.fromIndex && run.manifest && run.manifest.schema_version === undefined) {
      const manifest = await readJson(join(runDirectory(run.projectRoot, run.runId), 'manifest.json'), null);
      if (manifest?.schema_version !== undefined) run.manifest.schema_version = manifest.schema_version;
    }
  }));
}

// Mirrors recommendPipelineAction's deterministic priority order
// (approvals → failed → active → pending → complete) to CLASSIFY the action
// for chip routing; the sentence itself always comes from
// recommendPipelineAction so the two can never disagree on substance.
function classifyNextAction(state) {
  const none = { kind: 'unknown', stage_id: null, task_id: null, artifact: null };
  if (!state || !Array.isArray(state.stages)) return none;
  const blocker = (state.approval_blockers ?? [])[0];
  if (blocker) return { kind: 'approval', stage_id: blocker.stage_id ?? null, task_id: null, artifact: blocker.artifact ?? null };
  const failed = state.stages.find((stage) => ROLLUP_FAILED_STATUSES.has(stage.status));
  if (failed) {
    const kind = failed.retry_state === 'exhausted' ? 'guardrail_blocked'
      : failed.retry_state === 'retryable' ? 'retry' : 'failed';
    return { kind, stage_id: failed.id, task_id: (failed.task_ids ?? [])[0] ?? null, artifact: null };
  }
  if (state.current?.stage_id) {
    return { kind: 'active', stage_id: state.current.stage_id, task_id: state.current.task_id ?? null, artifact: null };
  }
  const pending = state.stages.find((stage) => stage.status === 'PENDING');
  if (pending) return { kind: 'pending', stage_id: pending.id, task_id: null, artifact: null };
  if (state.stages.length > 0 && state.stages.every((stage) => ROLLUP_PASSED_STATUSES.has(stage.status))) {
    return { kind: 'complete', stage_id: null, task_id: null, artifact: null };
  }
  return none;
}

function compactPipelineRollup(state, events) {
  const next = classifyNextAction(state);
  const loop = state.goal_loop ?? {};
  // Last goal verdict: prefer the rollup's last_evaluation.status; the BLE-4
  // goal evaluator emits `recommendation` on the pinned goal_evaluated event,
  // so fall back to that before giving up.
  const lastGoalEvent = [...(events ?? [])].reverse()
    .find((event) => String(event?.type ?? event?.kind ?? '') === 'goal_evaluated') ?? null;
  const lastVerdict = loop.last_evaluation?.status ?? lastGoalEvent?.status ?? lastGoalEvent?.recommendation ?? null;
  // Freshness (#218 review): a persisted pipeline-state.json can lag the live
  // event stream on an active run. `generated_at` stamps when the state was
  // computed; any event newer than it means the next-action below is behind
  // live data. Detected from data already in the snapshot — no extra read —
  // so the hero card can say so rather than present a stale recommendation as
  // live ("never let stale data look live").
  const generatedAt = state.generated_at ?? null;
  const eventsBehind = generatedAt
    ? (events ?? []).filter((event) => String(event?.ts ?? event?.timestamp ?? '') > String(generatedAt)).length
    : 0;
  return {
    schema_version: state.schema_version ?? null,
    status: state.pipeline?.status ?? 'UNKNOWN',
    stages_total: state.pipeline?.stages_total ?? 0,
    stages_passed: state.pipeline?.stages_passed ?? 0,
    stages_failed: state.pipeline?.stages_failed ?? 0,
    generated_at: generatedAt,
    stale: eventsBehind > 0,
    events_behind: eventsBehind,
    next_action: { ...next, text: recommendPipelineAction(state) },
    approval_blockers: (state.approval_blockers ?? []).length,
    retries: {
      total: state.retries?.total ?? 0,
      scheduled: state.retries?.scheduled ?? 0,
      exhausted: state.retries?.exhausted ?? 0,
      human_required: state.retries?.human_required ?? 0,
    },
    context_pressure: {
      total: state.context_pressure?.total ?? 0,
      by_source: state.context_pressure?.by_source ?? {},
    },
    checkpoints: {
      total: state.checkpoints?.total ?? 0,
      before_saved: state.checkpoints?.before_saved ?? 0,
      after_saved: state.checkpoints?.after_saved ?? 0,
      reverted: state.checkpoints?.reverted ?? 0,
    },
    goal_loop: {
      total: loop.total ?? 0,
      iterations: loop.iterations ?? 0,
      active: (loop.total ?? 0) > 0 && !loop.stopped_on,
      stopped_on: loop.stopped_on ?? null,
      last_verdict: lastVerdict,
      criteria_met: lastGoalEvent?.criteria_met ?? null,
      criteria_total: lastGoalEvent?.criteria_total ?? null,
    },
  };
}
// ── end [wave:command] ──────────────────────────────────────────────────────
