import { join } from 'node:path';
import { evaluateAlerts } from '../../alerts/engine.js';
import { sourceRoots } from './roots.js';
import { getAllRuns } from './runs.js';
import { getAllApprovals, buildBlockedGates, summarizeApprovals, resolveApprovalAcrossRoots } from './approvals.js';
import { buildActivityFeed } from './feed.js';
import { buildStageMatrix } from './stage-matrix.js';
import { buildAgentGroups, buildAgentWork } from './agent-work.js';
import { buildTraceMap } from './traceability.js';
import { buildProjectSummaries } from './projects.js';
import { buildDiagnostics, buildLayerSummaries } from './layers.js';
export { toClientState } from './client-state.js';
export { resolveApprovalAcrossRoots } from './approvals.js';

// owner: RStack developed by Richardson Gunde

export async function buildFullState(projectRoot, options = {}) {
  const roots = await sourceRoots(projectRoot, options);
  const [runs, queueApprovals] = await Promise.all([
    getAllRuns(roots),
    getAllApprovals(roots),
  ]);

  const totalCost = runs.reduce((sum, run) => sum + (run.metrics?.cumulative_cost_usd ?? 0), 0);
  const tokenTotal = runs.reduce((sum, run) => sum + Number(run.metrics?.cumulative_tokens ?? run.metrics?.total_tokens ?? 0), 0);
  const activeRuns = runs.filter((run) => run.derivedStatus === 'active');
  const today = new Date().toISOString().slice(0, 10);
  const todayRuns = runs.filter((run) => run.manifest?.created_at?.startsWith(today));

  const approvals = summarizeApprovals(queueApprovals);
  const blockedGates = buildBlockedGates(runs);
  const feed = buildActivityFeed(runs);
  const frameworks = buildFrameworks(runs);
  const stageMatrix = buildStageMatrix(runs);
  const agentWork = buildAgentWork(runs);
  const agentGroups = buildAgentGroups(agentWork);
  const projectSummaries = buildProjectSummaries(runs, roots);
  const traceMap = await buildTraceMap(runs, projectRoot);

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
    diagnostics: buildDiagnostics(runs, roots),
    ts: new Date().toISOString(),
  };

  return {
    ...baseState,
    layers: buildLayerSummaries(baseState),
  };
}

export async function resolveDashboardApproval(projectRoot, id, decision, resolvedBy, options = {}) {
  const roots = await sourceRoots(projectRoot, options);
  return resolveApprovalAcrossRoots(roots, id, decision, resolvedBy);
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
