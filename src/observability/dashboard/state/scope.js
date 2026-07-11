/**
 * Server-owned dashboard scope catalog and selection.
 *
 * The browser submits only opaque project/run keys emitted by this catalog.
 * Filesystem paths are resolved and filtered here, before any dashboard
 * aggregate or page model is built.
 *
 * owner: RStack developed by Richardson Gunde
 */

export const SCOPE_SENSITIVE_FIELDS = new Set([
  'activeRuns', 'agentGroups', 'agentWork', 'alerts', 'approvalStats',
  'approvals', 'blockedGates', 'businessFlex', 'decisions', 'diagnostics',
  'feed', 'frameworks', 'layers', 'pendingApprovals', 'people', 'presence',
  'projectSummaries', 'readiness', 'runs', 'sourceRoots', 'stageMatrix',
  'todayCount', 'tokenTotal', 'totalCost', 'totalRuns', 'traceMap', 'trends',
]);

export function buildScopeCatalog(projectDescriptors, runs) {
  const grouped = new Map();
  for (const descriptor of projectDescriptors ?? []) {
    let project = grouped.get(descriptor.id);
    if (!project) {
      project = {
        id: descriptor.id,
        name: descriptor.name,
        repositoryRoot: descriptor.repositoryRoot,
        roots: [],
      };
      grouped.set(descriptor.id, project);
    }
    project.roots.push({
      root: descriptor.root,
      worktreeName: descriptor.worktreeName,
      isWorktree: descriptor.isWorktree,
    });
  }

  const descriptorByRoot = new Map((projectDescriptors ?? []).map((entry) => [entry.root, entry]));
  return {
    projects: [...grouped.values()].sort((a, b) => a.name.localeCompare(b.name)),
    runs: (runs ?? []).map((run) => {
      const descriptor = descriptorByRoot.get(run.projectRoot);
      return {
        key: run.scopeKey,
        runId: run.runId,
        projectId: run.projectId,
        projectRoot: run.projectRoot,
        projectName: descriptor?.name ?? run.project?.name ?? 'unknown',
        worktreeName: descriptor?.worktreeName ?? run.project?.worktreeName ?? null,
        goal: run.manifest?.goal ?? run.runId,
        createdAt: run.manifest?.created_at ?? null,
      };
    }).sort((a, b) => (
      (b.createdAt ?? '').localeCompare(a.createdAt ?? '') || b.runId.localeCompare(a.runId)
    )),
  };
}

function globalScope(catalog, reset = false, reason = '') {
  return {
    type: 'global',
    key: 'global',
    projectId: null,
    runKey: null,
    projectIds: catalog.projects.map((project) => project.id),
    roots: catalog.projects.flatMap((project) => project.roots.map((entry) => entry.root)),
    runKeys: catalog.runs.map((run) => run.key),
    reset,
    reason,
  };
}

export function resolveRequestedScope(catalog, request = null) {
  if (!request?.projectId && !request?.runKey) return globalScope(catalog);
  if (request.runKey) {
    const run = catalog.runs.find((entry) => entry.key === request.runKey);
    if (!run) {
      return globalScope(
        catalog,
        true,
        'The selected run is no longer available. Scope reset to All projects.',
      );
    }
    return {
      type: 'run',
      key: `run:${run.key}`,
      projectId: run.projectId,
      runKey: run.key,
      projectIds: [run.projectId],
      roots: [run.projectRoot],
      runKeys: [run.key],
      reset: false,
      reason: '',
    };
  }

  const project = catalog.projects.find((entry) => entry.id === request.projectId);
  if (!project) {
    return globalScope(
      catalog,
      true,
      'The selected project is no longer available. Scope reset to All projects.',
    );
  }
  return {
    type: 'project',
    key: `project:${project.id}`,
    projectId: project.id,
    runKey: null,
    projectIds: [project.id],
    roots: project.roots.map((entry) => entry.root),
    runKeys: catalog.runs.filter((run) => run.projectId === project.id).map((run) => run.key),
    reset: false,
    reason: '',
  };
}

function matchingRun(record, runs) {
  if (record?.runKey) return runs.find((run) => run.scopeKey === record.runKey) ?? null;
  const runId = record?.runId ?? record?.run_id;
  if (!runId) return null;
  if (record.projectRoot) {
    return runs.find((run) => run.runId === runId && run.projectRoot === record.projectRoot) ?? null;
  }
  const matches = runs.filter((run) => run.runId === runId);
  return matches.length === 1 ? matches[0] : null;
}

export function decorateScopedRecord(record, runs, projectDescriptors, fallbackProjectId = null) {
  if (!record || typeof record !== 'object') return record;
  const run = matchingRun(record, runs ?? []);
  const descriptor = run?.project
    ?? (projectDescriptors ?? []).find((entry) => entry.root === record.projectRoot)
    ?? null;
  const projectId = record.projectId ?? run?.projectId ?? descriptor?.id ?? fallbackProjectId;
  return {
    ...record,
    ...(projectId ? { projectId } : { scope: record.scope ?? 'global' }),
    ...(run ? { runKey: run.scopeKey } : {}),
  };
}

export function decorateScopedRecords(records, runs, projectDescriptors, fallbackProjectId = null) {
  return (records ?? []).map((record) => (
    decorateScopedRecord(record, runs, projectDescriptors, fallbackProjectId)
  ));
}

export function filterRecordsForScope(records, scope) {
  return (records ?? []).filter((record) => {
    if (scope.type === 'global') return true;
    if (scope.type === 'run') return record.runKey === scope.runKey;
    return record.projectId === scope.projectId;
  });
}

export function selectedDescriptors(projectDescriptors, scope) {
  const roots = new Set(scope.roots);
  return (projectDescriptors ?? []).filter((descriptor) => roots.has(descriptor.root));
}

export function selectedRuns(runs, scope) {
  const keys = new Set(scope.runKeys);
  return (runs ?? []).filter((run) => keys.has(run.scopeKey));
}
