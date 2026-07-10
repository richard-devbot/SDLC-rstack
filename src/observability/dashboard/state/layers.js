// owner: RStack developed by Richardson Gunde

export function buildLayerSummaries(state) {
  const runs = state.runs ?? [];
  const tasks = runs.flatMap((run) => run.tasks ?? []);
  const events = runs.flatMap((run) => run.events ?? []);

  return [
    {
      id: 'dashboard',
      name: 'Dashboard',
      detail: 'Business Hub screens, live socket, HTTP snapshot',
      count: state.totalRuns ?? 0,
      health: 'active',
    },
    {
      id: 'harness',
      name: 'Harness',
      detail: 'Contracts, evidence, stages, run state, guardrails',
      count: tasks.length,
      health: tasks.some((task) => task.status === 'FAIL') ? 'warn' : 'ok',
    },
    {
      id: 'tracker',
      name: 'Tracker',
      detail: 'Project registry and human-in-loop approval queue',
      count: (state.projectSummaries ?? []).length,
      health: (state.pendingApprovals ?? []).length ? 'warn' : 'ok',
    },
    {
      id: 'alerts',
      name: 'Alerts',
      detail: 'Cost, failure, stalled run, guardrail thresholds',
      count: (state.alerts ?? []).length,
      health: (state.alerts ?? []).some((alert) => alert.level === 'critical') ? 'danger' : 'ok',
    },
    {
      id: 'notifications',
      name: 'Notifications',
      detail: 'Slack, Discord, Teams notification adapters',
      count: events.filter((event) => event.type?.includes('notification')).length,
      health: 'ready',
    },
    {
      id: 'hooks',
      name: 'Hooks',
      detail: 'Auto-launch and session startup helpers',
      count: events.filter((event) => event.type === 'session_start' || event.type === 'observer_new_run').length,
      health: 'ready',
    },
    {
      id: 'guardrails',
      name: 'Guardrails',
      detail: 'Safety limits, blocked gates, policy stops',
      count: events.filter((event) => event.type === 'guardrail_triggered' || event.type === 'approval_gate_blocked').length,
      health: (state.blockedGates ?? []).length ? 'warn' : 'ok',
    },
    {
      id: 'memory',
      name: 'Memory',
      detail: 'Episode recall, learning capture, diagnostics',
      count: events.filter((event) => event.type === 'memory_recalled' || event.type === 'episode_memory_written').length,
      health: 'ready',
    },
    {
      id: 'observers',
      name: 'Observers',
      detail: 'Developer Kanban, reporter, business hub aggregation',
      count: state.agentWork?.length ?? 0,
      health: 'active',
    },
  ];
}

export function buildDiagnostics(runs, roots, indexMeta = null) {
  const tasks = (runs ?? []).flatMap((run) => run.tasks ?? []);
  const fullyParsed = (runs ?? []).filter((run) => !run.fromIndex);
  const fullyParsedTasks = fullyParsed.flatMap((run) => run.tasks ?? []);
  return {
    sourceRoots: roots ?? [],
    runCount: runs?.length ?? 0,
    taskCount: tasks.length,
    eventCount: (runs ?? []).reduce((total, run) => total + (run.events?.length ?? 0), 0),
    evidenceCount: (runs ?? []).reduce((total, run) => total + (run.evidence?.length ?? 0), 0),
    // builder/validation payloads are only hydrated on fully-parsed runs, so
    // index-served runs must not be counted as "missing" artifacts.
    missingBuilderCount: fullyParsedTasks.filter((task) => !task.builder).length,
    missingValidationCount: fullyParsedTasks.filter((task) => !task.validation).length,
    // Data integrity (#82): damaged run files recorded during the state build,
    // one entry per corrupt file so operators see WHAT is broken, not zeros.
    integrity: fullyParsed.flatMap((run) => (run.integrity ?? []).map((issue) => ({ runId: run.runId, ...issue }))),
    integrityErrorCount: fullyParsed.reduce((total, run) => total + (run.integrity?.length ?? 0), 0),
    // Rollup index freshness + retention visibility for the Diagnostics page.
    index: indexMeta,
  };
}
