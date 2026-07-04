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
import { buildStageTrends } from '../../metrics/derive.js';
import { buildPeople, buildPresence } from './people.js';
import { buildBusinessFlexState } from './business-flex.js';
import { buildDecisionState } from './decisions.js';
import { validateProjectConfigs } from '../../../core/harness/config-validation.js';
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

  // Prefer event-derived totals (single source of truth); fall back to metrics.json.
  const totalCost = runs.reduce((sum, run) => sum + (run.totals?.cost_usd || run.metrics?.cumulative_cost_usd || 0), 0);
  const tokenTotal = runs.reduce((sum, run) => sum + (run.totals?.tokens || Number(run.metrics?.cumulative_tokens ?? run.metrics?.total_tokens ?? 0)), 0);
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

  return {
    ...baseState,
    layers: buildLayerSummaries(baseState),
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
