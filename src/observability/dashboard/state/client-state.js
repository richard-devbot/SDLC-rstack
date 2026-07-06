// owner: RStack developed by Richardson Gunde

export function toClientState(state) {
  const runs = (state.runs ?? []).map((run) => {
    // eslint-disable-next-line no-unused-vars
    const { events, evidence, ...rest } = run;
    return {
      ...rest,
      workflow: run.workflow,
      budgetPolicy: run.budgetPolicy,
      profile: run.profile,
      evidenceCount: (evidence ?? []).length,
      evidenceRecent: (evidence ?? []).slice(-30).reverse().map((entry) => ({
        ts: entry.ts, task_id: entry.task_id, kind: entry.kind, status: entry.status, evidence: entry.evidence,
      })),
      artifactIndex: (run.artifactIndex ?? []).slice(0, 80),
      stageReports: run.stageReports ?? [],
      timeline: (run.timeline ?? []).slice(0, 120),
      totals: run.totals ?? null,
      stageElapsed: run.stageElapsed ?? {},
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
    businessFlex: state.businessFlex ?? { profiles: [], budget: {}, routingSignals: [] },
  };
}
