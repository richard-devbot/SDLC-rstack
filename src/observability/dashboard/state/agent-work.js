// owner: RStack developed by Richardson Gunde

// #72: compact review-independence view for a task card — builder harness vs
// validator harnesses, verdict, and what is missing. Null when the run
// predates independence evaluation (no block in validation.json).
function independenceView(task) {
  const independence = task.validation?.independence;
  if (!independence || typeof independence !== 'object') return null;
  return {
    status: independence.status ?? 'PASS',
    enforced: Boolean(independence.enforced),
    waived: Boolean(independence.waived),
    builderHarness: independence.builder?.harness ?? null,
    validatorHarnesses: [...new Set((independence.validators ?? []).map((v) => v?.harness).filter(Boolean))],
    sameHarnessFindings: independence.same_harness_findings ?? [],
    missingValidatorTypes: independence.missing_validator_types ?? [],
    explanation: independence.explanation ?? '',
  };
}

export function buildAgentWork(runs) {
  return (runs ?? []).flatMap((run) => (run.tasks ?? []).map((task) => {
    const checks = task.validation?.checks ?? [];
    const passChecks = checks.filter((check) => check.status === 'PASS').length;
    return {
      independence: independenceView(task),
      runId: run.runId,
      goal: run.manifest?.goal ?? '',
      host: run.host,
      projectRoot: run.projectRoot,
      taskId: task.id,
      stageId: task.stageId ?? task.stage_id ?? null,
      title: task.title ?? task.id,
      status: task.status ?? 'READY',
      agent: task.agent_name ?? 'rstack-agent',
      summary: task.builder?.summary ?? task.description ?? '',
      decisions: task.builder?.memory_summary?.decisions ?? [],
      workDone: task.builder?.memory_summary?.work_done ?? '',
      risks: task.builder?.risks ?? [],
      nextSteps: task.builder?.next_steps ?? [],
      testsRun: task.builder?.tests_run ?? [],
      filesModified: (task.builder?.files_modified ?? []).slice(0, 5).map((file) =>
        file.replace(/^.*\.rstack\/runs\/[^/]+\//, '')
      ),
      totalChecks: checks.length,
      passChecks,
      failedChecks: checks.filter((check) => check.status !== 'PASS').map((check) => check.name),
      evidenceCount: passChecks,
      riskCount: (task.builder?.risks ?? []).length,
      promptPreview: task.prompt_preview ?? '',
      specialists: (task.specialists ?? []).slice(0, 5),
    };
  }))
    .sort((a, b) => `${b.runId}:${b.taskId}`.localeCompare(`${a.runId}:${a.taskId}`))
    .slice(0, 160);
}

export function buildAgentGroups(agentWork) {
  const groups = {};
  for (const work of agentWork ?? []) {
    const key = `${work.projectRoot ?? 'unknown'}::${work.runId}`;
    if (!groups[key]) {
      groups[key] = {
        key,
        projectRoot: work.projectRoot,
        runId: work.runId,
        goal: work.goal,
        total: 0,
        passed: 0,
        failed: 0,
        evidence: 0,
        risks: 0,
        agents: {},
        items: [],
      };
    }
    const group = groups[key];
    group.total++;
    if (work.status === 'PASS') group.passed++;
    if (work.status === 'FAIL') group.failed++;
    group.evidence += work.evidenceCount ?? 0;
    group.risks += work.riskCount ?? 0;
    group.agents[work.agent] = (group.agents[work.agent] ?? 0) + 1;
    group.items.push(work);
  }
  return Object.values(groups).sort((a, b) => b.runId.localeCompare(a.runId));
}
