// owner: RStack developed by Richardson Gunde

function optionalBudgetValue(value) {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function runHasTelemetry(run) {
  const totals = run?.totals ?? {};
  if (Number(totals.cost_usd) > 0 || Number(totals.tokens) > 0) return true;
  const metrics = run?.metrics ?? {};
  if (Number(metrics.cumulative_cost_usd) > 0) return true;
  const tokens = metrics.cumulative_tokens;
  return Number(tokens?.total ?? tokens) > 0;
}

function buildObservedConsumption(runs) {
  const telemetryRuns = (runs ?? []).filter(runHasTelemetry);
  if (!telemetryRuns.length) {
    return {
      availability: 'unavailable',
      runCount: (runs ?? []).length,
      runsWithTelemetry: 0,
      totalCostUsd: null,
      metricsSources: { persisted: 0, events: 0 },
      lastMeasuredAt: null,
    };
  }
  const timestamps = telemetryRuns.flatMap((run) => (run.events ?? [])
    .map((event) => event.ts)
    .filter(Boolean))
    .sort();
  return {
    availability: 'available',
    runCount: (runs ?? []).length,
    runsWithTelemetry: telemetryRuns.length,
    totalCostUsd: telemetryRuns.reduce((sum, run) => (
      sum + (Number(run.totals?.cost_usd ?? run.metrics?.cumulative_cost_usd) || 0)
    ), 0),
    metricsSources: {
      persisted: telemetryRuns.filter((run) => Object.keys(run.metrics ?? {}).length > 0).length,
      events: telemetryRuns.filter((run) => Object.keys(run.metrics ?? {}).length === 0).length,
    },
    lastMeasuredAt: timestamps.at(-1) ?? null,
  };
}

function runPolicySnapshot(run) {
  return {
    profile: {
      id: run.profile?.profile ?? run.manifest?.profile ?? null,
      name: run.profile?.name ?? null,
      workflow: run.workflow ?? run.profile?.workflow ?? run.manifest?.workflow ?? null,
    },
    budget: {
      currency: run.budgetPolicy?.currency ?? 'USD',
      runBudgetUsd: optionalBudgetValue(run.budgetPolicy?.run_budget_usd),
      dailyBudgetUsd: optionalBudgetValue(run.budgetPolicy?.daily_budget_usd),
      monthlyBudgetUsd: optionalBudgetValue(run.budgetPolicy?.monthly_budget_usd),
    },
  };
}

function snapshotDifferences(snapshot, current) {
  const fields = [
    ['profileId', snapshot.profile.id, current.profile.id],
    ['workflow', snapshot.profile.workflow, current.profile.workflow],
    ['runBudgetUsd', snapshot.budget.runBudgetUsd, current.budget.runBudgetUsd],
    ['dailyBudgetUsd', snapshot.budget.dailyBudgetUsd, current.budget.dailyBudgetUsd],
    ['monthlyBudgetUsd', snapshot.budget.monthlyBudgetUsd, current.budget.monthlyBudgetUsd],
  ];
  return fields
    .filter(([, previous, configured]) => previous !== configured)
    .map(([field, previous, configured]) => ({ field, snapshot: previous, current: configured }));
}

function buildRunSnapshots(runs, policyProjects) {
  return (runs ?? []).map((run) => {
    const snapshot = runPolicySnapshot(run);
    const current = (policyProjects ?? []).find((project) => (
      (run.projectId && project.projectId === run.projectId)
      || project.projectRoot === run.projectRoot
    ));
    const comparable = current
      && current.profile?.availability === 'configured'
      && current.budget?.availability === 'configured';
    const differences = comparable ? snapshotDifferences(snapshot, current) : [];
    return {
      runId: run.runId,
      runKey: run.scopeKey ?? null,
      projectId: run.projectId ?? current?.projectId ?? null,
      projectRoot: run.projectRoot ?? null,
      ...snapshot,
      comparison: comparable ? (differences.length ? 'differs' : 'current') : 'unavailable',
      differences,
    };
  });
}

export function buildBusinessFlexState(runs = [], configuredPolicy = { projects: [] }) {
  const profileMap = new Map();
  let runBudgetTotal = 0;
  let estimatedTaskBudget = 0;
  let tasksWithBudget = 0;
  const routingSignals = [];

  for (const run of runs ?? []) {
    const profile = run.profile || {};
    const profileId = profile.profile || run.manifest?.profile || 'unprofiled';
    if (!profileMap.has(profileId)) {
      profileMap.set(profileId, {
        profile: profileId,
        name: profile.name || profileId,
        workflow: run.workflow || profile.workflow || run.manifest?.workflow || 'unknown',
        runs: 0,
        enabledDomains: new Set(),
        enabledAgents: new Set(),
        enabledPlugins: new Set(),
        dashboardPages: new Set(),
      });
    }
    const entry = profileMap.get(profileId);
    entry.runs += 1;
    for (const domain of profile.enabled_domains || []) entry.enabledDomains.add(domain);
    for (const agent of profile.enabled_agents || []) entry.enabledAgents.add(agent);
    for (const plugin of profile.enabled_plugins || []) entry.enabledPlugins.add(plugin);
    for (const page of profile.dashboard_pages || []) entry.dashboardPages.add(page);

    runBudgetTotal += Number(run.budgetPolicy?.run_budget_usd || 0);
    for (const task of run.tasks || []) {
      if (task.budget_envelope) {
        tasksWithBudget += 1;
        estimatedTaskBudget += Number(task.budget_envelope.estimated_ai_cost_usd || 0);
      }
      if (task.routing) {
        routingSignals.push({
          runId: run.runId,
          projectRoot: run.projectRoot,
          taskId: task.id,
          title: task.title,
          profile: task.profile || profileId,
          selectedBy: task.routing.selected_by,
          explanation: (task.routing.explanation || []).slice(0, 8),
          specialists: (task.specialists || []).slice(0, 8),
          budget: task.budget_envelope || null,
        });
      }
    }
  }

  const plannedEnvelopes = {
    runBudgetTotal,
    estimatedTaskBudget,
    tasksWithBudget,
  };
  return {
    configuredPolicy: configuredPolicy ?? { projects: [] },
    observedConsumption: buildObservedConsumption(runs),
    plannedEnvelopes,
    runSnapshots: buildRunSnapshots(runs, configuredPolicy?.projects),
    profiles: [...profileMap.values()].map((entry) => ({
      profile: entry.profile,
      name: entry.name,
      workflow: entry.workflow,
      runs: entry.runs,
      enabledDomains: [...entry.enabledDomains],
      enabledAgents: [...entry.enabledAgents],
      enabledPlugins: [...entry.enabledPlugins],
      dashboardPages: [...entry.dashboardPages],
    })),
    budget: plannedEnvelopes,
    routingSignals: routingSignals.slice(0, 80),
  };
}
