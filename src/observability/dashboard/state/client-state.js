// owner: RStack developed by Richardson Gunde

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hasMetricsWriteDrift, persistedTokenTotals } from '../../metrics/derive.js';

// [wave:money] Loop budget caps (#92/#215): .rstack/budget.json is the SAME
// file the goal loop's cost brake reads (evaluateLoopBudget in
// core/harness/goal-loop.js), so the dashboard shows the cap that is actually
// enforced — never a number invented for display. Sync read of one tiny file
// per root, memoized briefly because toClientState runs on every snapshot.
const BUDGET_MEMO = { at: 0, key: '', caps: [] };
const BUDGET_MEMO_TTL_MS = 5000;

export function readLoopBudgetCaps(sourceRoots, now = Date.now()) {
  const roots = (sourceRoots ?? []).filter((root) => typeof root === 'string' && root);
  const key = roots.join('|');
  if (BUDGET_MEMO.key === key && now - BUDGET_MEMO.at < BUDGET_MEMO_TTL_MS) return BUDGET_MEMO.caps;
  const caps = [];
  for (const root of roots) {
    const budgetPath = join(root, '.rstack', 'budget.json');
    try {
      if (!existsSync(budgetPath)) continue;
      const budget = JSON.parse(readFileSync(budgetPath, 'utf8'));
      const limit = Number(budget?.run_budget_usd);
      // Mirror evaluateLoopBudget exactly: finite and >= 0 arms the brake.
      if (Number.isFinite(limit) && limit >= 0) {
        caps.push({
          root,
          run_budget_usd: limit,
          daily_budget_usd: Number.isFinite(Number(budget?.daily_budget_usd)) ? Number(budget.daily_budget_usd) : null,
          monthly_budget_usd: Number.isFinite(Number(budget?.monthly_budget_usd)) ? Number(budget.monthly_budget_usd) : null,
        });
      }
    } catch { /* unreadable budget.json = no cap; config-validation (#151) reports it */ }
  }
  BUDGET_MEMO.key = key;
  BUDGET_MEMO.at = now;
  BUDGET_MEMO.caps = caps;
  return caps;
}

export function toClientState(state) {
  const businessFlex = state.businessFlex ?? { profiles: [], budget: {}, routingSignals: [] };
  const policyProjects = businessFlex.configuredPolicy?.projects ?? [];
  const configuredBudgets = policyProjects.filter((project) => (
    project.budget?.availability === 'configured'
    && project.budget.runBudgetUsd !== null
    && project.budget.runBudgetUsd !== undefined
  ));
  const capByRoot = Object.fromEntries(configuredBudgets.map((project) => [
    project.projectRoot,
    project.budget.runBudgetUsd,
  ]));
  const loopBudgetCaps = configuredBudgets.map((project) => ({
    root: project.projectRoot,
    run_budget_usd: project.budget.runBudgetUsd,
    daily_budget_usd: project.budget.dailyBudgetUsd ?? null,
    monthly_budget_usd: project.budget.monthlyBudgetUsd ?? null,
  }));
  const runs = (state.runs ?? []).map((run) => {
    const { events, evidence, ...rest } = run;
    // [wave:money] Cost/token provenance (#83/#215): mirrors resolveRunTotals —
    // persisted cumulative metrics are authoritative UNLESS a
    // metrics_write_failed event marks them stale, in which case the totals the
    // client sees were recomputed from events. 'none' = the run has neither
    // persisted telemetry nor any events, so no cost/token number is real.
    const persistedTokens = persistedTokenTotals(run.metrics);
    const metricsSource = persistedTokens && !hasMetricsWriteDrift(events)
      ? 'persisted'
      : (events ?? []).length > 0 ? 'events' : 'none';
    return {
      ...rest,
      // [wave:money] Token breakdown + provenance + the loop-enforced budget
      // cap for this run's project (null = no cap configured, loop cost brake
      // is unarmed). Additive fields — nothing existing changes shape.
      tokenTotals: persistedTokens,
      metricsSource,
      loopBudgetUsd: Object.hasOwn(capByRoot, run.projectRoot) ? capByRoot[run.projectRoot] : null,
      workflow: run.workflow,
      budgetPolicy: run.budgetPolicy,
      profile: run.profile,
      // Prefer the true persisted total (#299 item 8): index-served runs carry
      // a capped evidence LIST, so .length silently undercounted 100+ runs.
      evidenceCount: run.evidenceCount ?? (evidence ?? []).length,
      evidenceRecent: (evidence ?? []).slice(-30).reverse().map((entry) => ({
        ts: entry.ts, task_id: entry.task_id, kind: entry.kind, status: entry.status, evidence: entry.evidence,
      })),
      artifactIndex: (run.artifactIndex ?? []).slice(0, 80),
      stageReports: run.stageReports ?? [],
      timeline: (run.timeline ?? []).slice(0, 120),
      totals: run.totals ?? null,
      stageElapsed: run.stageElapsed ?? {},
      // Migration state (#82, surfaced per #156): v1 legacy vs v2 manifests.
      schemaVersion: run.manifest?.schema_version ?? null,
      // Per-stage restore points (#132/#215) from the server-owned rollup —
      // pages render this, they never re-derive restorability client-side.
      checkpoints: run.pipelineRollup?.checkpoints ?? null,
      // Per-stage cost/token telemetry (#83/#135): the data flows to Run
      // Analytics now; dedicated UI rendering is follow-up work.
      stageCost: run.metrics?.stage_cost_usd ?? {},
      stageTokens: run.metrics?.stage_tokens ?? {},
      approvals: (run.approvals ?? []).slice(0, 40).map((approval) => ({
        artifact: approval.artifact,
        status: approval.status,
        approver: approval.approver,
        timestamp: approval.timestamp,
      })),
      startedBy: run.manifest?.started_by?.name ?? null,
      requirements: (run.requirements ?? []).slice(0, 15).map((req) => ({
        id: req.id ?? req.req_id ?? '',
        area: req.area ?? req.category ?? '',
        priority: req.priority ?? 'must',
        description: (req.description ?? req.text ?? req.title ?? '').slice(0, 200),
        acceptance: (req.acceptance ?? req.acceptance_criteria ?? []).slice(0, 2),
      })),
      brief: run.brief ?? '',
      hasPlan: run.hasPlan ?? false,
      tasks: (run.tasks ?? []).map((task) => ({
        id: task.id,
        title: task.title,
        status: task.status,
        description: task.description?.slice(0, 300) ?? '',
        stageId: task.stageId ?? task.stage_id ?? null,
        stage_artifacts: task.stage_artifacts,
        routing: task.routing,
        budget_envelope: task.budget_envelope,
        agent_name: task.agent_name,
        risk_count: task.risk_count,
        evidence_count: task.evidence_count,
        specialists: (task.specialists ?? []).slice(0, 6),
        builder: task.builder ? {
          summary: task.builder.summary?.slice(0, 400) ?? '',
          status: task.builder.status,
          decisions: (task.builder.memory_summary?.decisions ?? []).slice(0, 4),
          risks: (task.builder.risks ?? []).slice(0, 3),
          next_steps: (task.builder.next_steps ?? []).slice(0, 3),
          tests_run: (task.builder.tests_run ?? []).slice(0, 5),
          files_modified: (task.builder.files_modified ?? []).slice(0, 5).map((file) =>
            file.replace(/^.*\.rstack\/runs\/[^/]+\//, '')
          ),
          work_done: task.builder.memory_summary?.work_done?.slice(0, 200) ?? '',
        } : null,
        validation: task.validation ? {
          status: task.validation.status,
          total_checks: (task.validation.checks ?? []).length,
          pass_checks: (task.validation.checks ?? []).filter((check) => check.status === 'PASS').length,
          failed_checks: (task.validation.checks ?? []).filter((check) => check.status !== 'PASS').map((check) => check.name),
          issues: (task.validation.issues ?? []).slice(0, 3),
        } : null,
      })),
    };
  });

  return {
    ...state,
    runs,
    feed: (state.feed ?? []).slice(0, 100),
    approvals: (state.approvals ?? []).slice(0, 100),
    pendingApprovals: (state.pendingApprovals ?? []).slice(0, 50),
    blockedGates: (state.blockedGates ?? []).slice(0, 50),
    actions: (state.actions ?? []).slice(0, 250),
    agentWork: (state.agentWork ?? []).slice(0, 80).map((work) => ({
      agent: work.agent,
      taskId: work.taskId,
      stageId: work.stageId,
      title: work.title,
      status: work.status,
      goal: work.goal?.slice(0, 120),
      host: work.host,
      projectRoot: work.projectRoot,
      summary: (work.summary || work.promptPreview || '').slice(0, 300),
      workDone: (work.workDone ?? '').slice(0, 220),
      decisions: (work.decisions ?? []).slice(0, 4),
      risks: (work.risks ?? []).slice(0, 3),
      testsRun: (work.testsRun ?? []).slice(0, 5),
      filesModified: (work.filesModified ?? []).slice(0, 5),
      totalChecks: work.totalChecks ?? 0,
      passChecks: work.passChecks ?? 0,
      failedChecks: (work.failedChecks ?? []).slice(0, 3),
      evidenceCount: work.evidenceCount ?? 0,
      riskCount: work.riskCount ?? 0,
      specialists: (work.specialists ?? []).slice(0, 4),
      runId: work.runId,
    })),
    agentGroups: (state.agentGroups ?? []).slice(0, 40),
    trends: state.trends
      ? { stages: state.trends.stages ?? {}, runs: (state.trends.runs ?? []).slice(0, 30) }
      : { stages: {}, runs: [] },
    people: (state.people ?? []).slice(0, 60),
    presence: (state.presence ?? []).slice(0, 40),
    // Agent Force Studio consumes one compact, server-owned semantic
    // projection. Raw run events remain stripped above.
    studio: state.studio ?? null,
    businessFlex,
    // [wave:money] The armed loop budget caps per source root (from
    // .rstack/budget.json — the file the goal loop enforces).
    loopBudgets: loopBudgetCaps,
  };
}
