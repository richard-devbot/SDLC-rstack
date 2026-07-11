// owner: RStack developed by Richardson Gunde

export function projectName(projectRoot) {
  return (projectRoot ?? '').split('/').filter(Boolean).pop() || projectRoot || 'unknown';
}

export function buildProjectSummaries(runs, roots, projectDescriptors = []) {
  const projects = {};
  const descriptors = new Map(projectDescriptors.map((entry) => [entry.root, entry]));
  for (const root of roots ?? []) {
    const descriptor = descriptors.get(root);
    projects[root] = {
      projectRoot: root,
      projectId: descriptor?.id ?? null,
      name: descriptor?.name ?? projectName(root),
      repositoryRoot: descriptor?.repositoryRoot ?? root,
      worktreeName: descriptor?.worktreeName ?? null,
      isWorktree: descriptor?.isWorktree ?? false,
      runs: 0,
      active: 0,
      stalled: 0,
      passed: 0,
      failed: 0,
      tasks: 0,
      agents: 0,
      cost: 0,
      lastActivity: '',
    };
  }

  for (const run of runs ?? []) {
    const key = run.projectRoot ?? 'unknown';
    if (!projects[key]) {
      const descriptor = descriptors.get(key) ?? run.project;
      projects[key] = {
        projectRoot: key,
        projectId: run.projectId ?? descriptor?.id ?? null,
        name: descriptor?.name ?? projectName(key),
        repositoryRoot: descriptor?.repositoryRoot ?? key,
        worktreeName: descriptor?.worktreeName ?? null,
        isWorktree: descriptor?.isWorktree ?? false,
        runs: 0,
        active: 0,
        stalled: 0,
        passed: 0,
        failed: 0,
        tasks: 0,
        agents: 0,
        cost: 0,
        lastActivity: '',
      };
    }
    const project = projects[key];
    project.runs++;
    if (run.derivedStatus === 'active') project.active++;
    if (run.derivedStatus === 'stalled') project.stalled++;
    project.cost += run.metrics?.cumulative_cost_usd ?? 0;
    project.lastActivity = [project.lastActivity, lastRunActivity(run), run.manifest?.created_at ?? ''].sort().pop() ?? '';
    for (const task of run.tasks ?? []) {
      project.tasks++;
      project.agents++;
      if (task.status === 'PASS') project.passed++;
      if (task.status === 'FAIL') project.failed++;
    }
  }

  return Object.values(projects).sort((a, b) => (b.lastActivity ?? '').localeCompare(a.lastActivity ?? ''));
}

function lastRunActivity(run) {
  const events = run.events ?? [];
  // Index-served runs keep their exact last event timestamp in the rollup
  // entry (their inline events are a filtered subset).
  if (run.lastEventTs) return run.lastEventTs;
  return events.length ? events[events.length - 1]?.ts ?? '' : '';
}
