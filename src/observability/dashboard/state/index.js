import { join, resolve } from 'node:path';
import { evaluateAlerts } from '../../alerts/engine.js';
import { sourceRoots } from './roots.js';
import { getIndexedRuns } from './rollup-index.js';
import { getAllApprovals, buildBlockedGates, approvalRequestsFromBlockedGates, summarizeApprovals, annotateApprovalLifecycle, resolveApprovalAcrossRoots } from './approvals.js';
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
import { buildOverviewProjection } from './overview.js';
import { buildRunWorkspaces } from './run-workspace.js';
import { buildActions } from './actions.js';
import { readConfiguredPolicies } from './configured-policy.js';
import { decorateRunIdentity, resolveProjectDescriptors } from './identity.js';
import {
  buildScopeCatalog,
  decorateScopedRecords,
  filterRecordsForScope,
  resolveRequestedScope,
  selectedDescriptors,
  selectedRuns,
} from './scope.js';
import { validateProjectConfigs } from '../../../core/harness/config-validation.js';
// [wave:command] imports — pipeline rollup enrichment (#94 / #156 / #215)
import { readPipelineState, buildPipelineState } from '../../../core/harness/pipeline-state.js';
import { compactPipelineRollup } from './pipeline-rollup.js';
import { runDirectory } from '../../../core/harness/runs.js';
import { readJson } from './files.js';
export { toClientState } from './client-state.js';
export { resolveApprovalAcrossRoots } from './approvals.js';

// owner: RStack developed by Richardson Gunde

export async function buildFullState(projectRoot, options = {}) {
  const allRoots = options.sourceRoots?.length
    ? [...new Set(options.sourceRoots.map((root) => resolve(root)))]
    : await sourceRoots(projectRoot, options);
  // Rollup index: completed runs come from .rstack/index.json; only active
  // (or explicitly scoped) runs pay the full directory parse.
  const [{ runs: indexedRuns, indexMeta }, allQueueApprovals] = await Promise.all([
    getIndexedRuns(allRoots, {
      scopeRunIds: options.scopeRunIds,
      retentionDays: options.retentionDays,
      io: options.indexIo,
      now: options.now,
    }),
    getAllApprovals(allRoots),
  ]);
  const projectDescriptors = resolveProjectDescriptors(allRoots);
  const allRuns = decorateRunIdentity(indexedRuns, projectDescriptors);
  const scopeCatalog = buildScopeCatalog(projectDescriptors, allRuns);
  const scope = resolveRequestedScope(scopeCatalog, options.scope);
  const roots = scope.roots;
  const runs = selectedRuns(allRuns, scope);
  const scopedDescriptors = selectedDescriptors(projectDescriptors, scope);
  const queueApprovals = filterRecordsForScope(
    decorateScopedRecords(allQueueApprovals, allRuns, projectDescriptors),
    scope,
  );
  const scopeProjectId = scope.type === 'global' ? null : scope.projectId;

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

  const blockedGates = decorateScopedRecords(
    buildBlockedGates(runs), runs, scopedDescriptors, scopeProjectId,
  );
  const actionableGateApprovals = decorateScopedRecords(
    approvalRequestsFromBlockedGates(blockedGates, queueApprovals),
    runs,
    scopedDescriptors,
    scopeProjectId,
  );
  // #156: cross-reference run-level records so one-shot overrides show their
  // CONSUMED lifecycle instead of freezing at 'approved'.
  const approvals = summarizeApprovals(
    annotateApprovalLifecycle([...queueApprovals, ...actionableGateApprovals], runs),
  );
  const feed = decorateScopedRecords(
    buildActivityFeed(runs), runs, scopedDescriptors, scopeProjectId,
  );
  const frameworks = buildFrameworks(runs);
  const stageMatrix = buildStageMatrix(runs).map((stage) => ({
    ...stage,
    runs: decorateScopedRecords(stage.runs, runs, scopedDescriptors, scopeProjectId),
  }));
  const agentWork = decorateScopedRecords(
    buildAgentWork(runs), runs, scopedDescriptors, scopeProjectId,
  );
  const agentGroups = decorateScopedRecords(
    buildAgentGroups(agentWork), runs, scopedDescriptors, scopeProjectId,
  );
  const projectSummaries = buildProjectSummaries(runs, roots, scopedDescriptors);
  const traceMap = await buildTraceMap(runs, roots[0] ?? projectRoot);
  const rawTrends = buildStageTrends(runs);
  const trends = {
    ...rawTrends,
    runs: decorateScopedRecords(rawTrends.runs, runs, scopedDescriptors, scopeProjectId),
  };
  const people = decorateScopedRecords(
    buildPeople(runs), runs, scopedDescriptors, scopeProjectId,
  );
  const presence = decorateScopedRecords(
    buildPresence(runs), runs, scopedDescriptors, scopeProjectId,
  );

  const alertInputs = {
    runs,
    pendingApprovals: approvals.pendingApprovals.length,
  };
  const alerts = decorateScopedRecords([
    ...buildBlockedGateAlerts(blockedGates),
    ...evaluateAlerts(alertInputs),
  ], runs, scopedDescriptors, scopeProjectId);
  const decisions = await buildDecisionState(runs);
  decisions.runs = decorateScopedRecords(
    decisions.runs, runs, scopedDescriptors, scopeProjectId,
  );
  const environmentRoot = roots[0] ?? resolve(projectRoot);
  const environment = {
    ...(await buildEnvironmentState(environmentRoot, runs, queueApprovals)),
    projectRoot: environmentRoot,
    ...(scopeProjectId ? { projectId: scopeProjectId } : { scope: 'global' }),
  };
  const configIssues = (await Promise.all(roots.map(async (root) => {
    const descriptor = scopedDescriptors.find((entry) => entry.root === root);
    return (await validateProjectConfigs(root)).map((issue) => ({
      root,
      projectId: descriptor?.id ?? scopeProjectId,
      ...issue,
    }));
  }))).flat();
  const configuredPolicy = await readConfiguredPolicies(roots, scopedDescriptors, {
    now: options.now,
  });

  const baseState = {
    kind: 'snapshot',
    product: 'RStack Command Center',
    stateRoot: join(environmentRoot, '.rstack'),
    scope,
    scopeCatalog,
    projectDescriptors: scopedDescriptors,
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
    businessFlex: buildBusinessFlexState(runs, configuredPolicy),
    decisions,
    // Environment & Integrations (#238): defensive by contract — absent
    // report/integrations/.env files are honest empty state, never a crash.
    environment,
    diagnostics: {
      ...buildDiagnostics(runs, roots, indexMeta),
      // Config validation (#151): invalid .rstack config values are surfaced
      // here per root so Diagnostics shows exactly which field is ignored.
      configIssues,
    },
    ts: new Date().toISOString(),
  };

  const stateWithReadiness = {
    ...baseState,
    readiness: buildReadinessProjection(baseState, { evaluatedAt: baseState.ts }),
  };

  const stateWithActions = {
    ...stateWithReadiness,
    actions: buildActions(stateWithReadiness),
  };

  const stateWithOverview = {
    ...stateWithActions,
    overview: buildOverviewProjection(stateWithActions),
  };

  const stateWithRunWorkspaces = {
    ...stateWithOverview,
    runWorkspaces: buildRunWorkspaces(stateWithOverview.runs, stateWithOverview.readiness, stateWithOverview),
  };

  return {
    ...stateWithRunWorkspaces,
    layers: buildLayerSummaries(stateWithRunWorkspaces),
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
    runKey: gate.runKey,
    projectRoot: gate.projectRoot,
    projectId: gate.projectId,
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

async function attachPipelineRollups(runs) {
  await Promise.all((runs ?? []).map(async (run) => {
    // #221: index-served runs carry a persisted pipeline rollup (from the index
    // entry) and freshly-parsed runs get one at parse time, so it is usually
    // already attached — only read/build when it is genuinely missing. This
    // drops the per-run pipeline-state.json read on every 3s poll for the
    // (many) completed/index-served runs, restoring the rollup index's
    // "zero-fs-per-poll for completed runs" invariant.
    if (run.pipelineRollup === undefined) {
      try {
        let state = await readPipelineState(run.projectRoot, run.runId);
        if (!state && !run.fromIndex) state = await buildPipelineState(run.projectRoot, run.runId);
        run.pipelineRollup = state ? compactPipelineRollup(state, run.events ?? []) : null;
      } catch {
        run.pipelineRollup = null;
      }
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
