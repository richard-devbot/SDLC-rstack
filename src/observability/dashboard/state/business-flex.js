// owner: RStack developed by Richardson Gunde

export function buildBusinessFlexState(runs = []) {
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

  return {
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
    budget: {
      runBudgetTotal,
      estimatedTaskBudget,
      tasksWithBudget,
    },
    routingSignals: routingSignals.slice(0, 80),
  };
}
