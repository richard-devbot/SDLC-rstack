// owner: RStack developed by Richardson Gunde

import { hasMetricsWriteDrift, persistedTokenTotals } from '../../metrics/derive.js';

function optionalBudgetValue(value) {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function latestMeasurementTime(run) {
  const eventTime = (run?.events ?? [])
    .filter((event) => event?.type === 'cost_recorded' && event.ts)
    .map((event) => event.ts)
    .sort()
    .at(-1) ?? null;
  return eventTime ?? run?.metricsMeasuredAt ?? null;
}

function currentPolicyForRun(run, policyProjects) {
  return (policyProjects ?? []).find((project) => (
    (run.projectId && project.projectId === run.projectId)
    || project.projectRoot === run.projectRoot
  )) ?? null;
}

function capPosition(run, measurement, policyProjects) {
  const policy = currentPolicyForRun(run, policyProjects);
  const budget = policy?.budget;
  if (!budget || budget.availability !== 'configured') {
    return { status: budget?.availability ?? 'unavailable', runBudgetUsd: null, usedPercent: null, remainingUsd: null };
  }
  const cap = optionalBudgetValue(budget.runBudgetUsd);
  if (cap === null) return { status: 'no_cap', runBudgetUsd: null, usedPercent: null, remainingUsd: null };
  if (measurement.availability !== 'available') {
    return { status: 'unavailable', runBudgetUsd: cap, usedPercent: null, remainingUsd: null };
  }
  // The loop reads metrics.json directly. Event-derived consumption is the
  // honest observed total after drift, but it is not a compatible numerator
  // for claiming what the persisted-file brake will do next.
  if (measurement.metricsSource !== 'persisted') {
    return { status: 'enforcement_stale', runBudgetUsd: cap, usedPercent: null, remainingUsd: null };
  }
  const spent = measurement.costUsd;
  const exhausted = spent >= cap;
  return {
    status: exhausted ? 'exhausted' : 'within_cap',
    runBudgetUsd: cap,
    usedPercent: cap > 0 ? Math.round((spent / cap) * 1000) / 10 : 100,
    remainingUsd: Math.max(0, Math.round((cap - spent) * 10000) / 10000),
  };
}

function runMeasurement(run, policyProjects) {
  const persisted = persistedTokenTotals(run?.metrics);
  const drifted = hasMetricsWriteDrift(run?.events);
  const costEvents = (run?.events ?? []).filter((event) => event?.type === 'cost_recorded');
  const metricsSource = persisted && !drifted ? 'persisted' : costEvents.length ? 'events' : null;
  const available = metricsSource !== null;
  const measurement = {
    runId: run.runId,
    projectRoot: run.projectRoot ?? null,
    projectId: run.projectId ?? null,
    availability: available ? 'available' : 'unavailable',
    costUsd: available ? Number(run.totals?.cost_usd ?? run.metrics?.cumulative_cost_usd) || 0 : null,
    tokens: available ? Number(run.totals?.tokens ?? persisted?.total) || 0 : null,
    metricsSource: metricsSource ?? 'none',
    measuredAt: available ? latestMeasurementTime(run) : null,
    sourcePath: available
      ? metricsSource === 'persisted' ? `.rstack/runs/${run.runId}/metrics.json` : `.rstack/runs/${run.runId}/events.jsonl`
      : null,
  };
  measurement.cap = capPosition(run, measurement, policyProjects);
  return measurement;
}

function projectObservations(runs, measurements, policyProjects) {
  const keys = new Map();
  for (const project of policyProjects ?? []) {
    keys.set(project.projectId ?? project.projectRoot, { projectId: project.projectId ?? null, projectRoot: project.projectRoot ?? null });
  }
  for (const run of runs ?? []) {
    const key = run.projectId ?? run.projectRoot;
    if (!keys.has(key)) keys.set(key, { projectId: run.projectId ?? null, projectRoot: run.projectRoot ?? null });
  }
  return [...keys.entries()].map(([key, identity]) => {
    const projectRuns = (runs ?? []).filter((run) => (run.projectId ?? run.projectRoot) === key);
    const observed = measurements.filter((measurement) => (measurement.projectId ?? measurement.projectRoot) === key && measurement.availability === 'available');
    const stamps = observed.map((measurement) => measurement.measuredAt).filter(Boolean).sort();
    return {
      ...identity,
      availability: observed.length ? 'available' : 'unavailable',
      runCount: projectRuns.length,
      runsWithTelemetry: observed.length,
      totalCostUsd: observed.length ? observed.reduce((sum, measurement) => sum + measurement.costUsd, 0) : null,
      totalTokens: observed.length ? observed.reduce((sum, measurement) => sum + measurement.tokens, 0) : null,
      metricsSources: {
        persisted: observed.filter((measurement) => measurement.metricsSource === 'persisted').length,
        events: observed.filter((measurement) => measurement.metricsSource === 'events').length,
      },
      lastMeasuredAt: stamps.at(-1) ?? null,
    };
  });
}

function buildObservedConsumption(runs, policyProjects) {
  const measurements = (runs ?? []).map((run) => runMeasurement(run, policyProjects));
  const observed = measurements.filter((measurement) => measurement.availability === 'available');
  const timestamps = observed.map((measurement) => measurement.measuredAt).filter(Boolean).sort();
  return {
    availability: observed.length ? 'available' : 'unavailable',
    runCount: (runs ?? []).length,
    runsWithTelemetry: observed.length,
    totalCostUsd: observed.length ? observed.reduce((sum, measurement) => sum + measurement.costUsd, 0) : null,
    metricsSources: {
      persisted: observed.filter((measurement) => measurement.metricsSource === 'persisted').length,
      events: observed.filter((measurement) => measurement.metricsSource === 'events').length,
    },
    lastMeasuredAt: timestamps.at(-1) ?? null,
    runs: measurements,
    projects: projectObservations(runs, measurements, policyProjects),
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

function snapshotDifferences(snapshot, current, comparability) {
  const fields = [
    ...(comparability.profile ? [
      ['profileId', snapshot.profile.id, current.profile.id],
      ['workflow', snapshot.profile.workflow, current.profile.workflow],
    ] : []),
    ...(comparability.budget ? [
      ['runBudgetUsd', snapshot.budget.runBudgetUsd, current.budget.runBudgetUsd],
      ['dailyBudgetUsd', snapshot.budget.dailyBudgetUsd, current.budget.dailyBudgetUsd],
      ['monthlyBudgetUsd', snapshot.budget.monthlyBudgetUsd, current.budget.monthlyBudgetUsd],
    ] : []),
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
    const comparability = {
      profile: Boolean(current && current.profile?.availability === 'configured'),
      budget: Boolean(current && current.budget?.availability === 'configured'),
    };
    const comparable = comparability.profile || comparability.budget;
    const differences = comparable ? snapshotDifferences(snapshot, current, comparability) : [];
    return {
      runId: run.runId,
      runKey: run.scopeKey ?? null,
      projectId: run.projectId ?? current?.projectId ?? null,
      projectRoot: run.projectRoot ?? null,
      ...snapshot,
      comparison: comparable ? (differences.length ? 'differs' : comparability.profile && comparability.budget ? 'current' : 'partial') : 'unavailable',
      comparability,
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
    observedConsumption: buildObservedConsumption(runs, configuredPolicy?.projects),
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
