import { buildOverviewProjection } from './overview.js';

// owner: RStack developed by Richardson Gunde

function readableTimeline(run) {
  return [...(run.timeline ?? []), ...(run.activityTimeline ?? [])]
    .filter((item) => item && item.ts)
    .sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
}

function workItems(run) {
  return (run.tasks ?? []).map((task) => ({
    id: task.id,
    title: task.title ?? task.id,
    stageId: task.stageId ?? task.stage_id ?? null,
    status: task.status ?? 'UNKNOWN',
    agent: task.agent_name ?? null,
    validation: task.validation ?? null,
    evidenceCount: task.evidence_count ?? task.evidenceCount ?? 0,
    riskCount: task.risk_count ?? task.riskCount ?? 0,
    routing: task.routing ?? null,
    specialists: (task.specialists ?? []).slice(0, 6),
    builder: task.builder ? {
      summary: task.builder.summary?.slice(0, 400) ?? '',
      workDone: task.builder.memory_summary?.work_done?.slice(0, 220) ?? '',
      decisions: (task.builder.memory_summary?.decisions ?? []).slice(0, 4),
      risks: (task.builder.risks ?? []).slice(0, 3),
      testsRun: (task.builder.tests_run ?? []).slice(0, 5),
    } : null,
  }));
}

function artifactItems(run) {
  const indexed = (run.artifactIndex ?? []).map((item) => ({
    kind: item.kind ?? 'artifact',
    path: item.path,
    available: Boolean(item.path),
    source: 'artifact-index',
  }));
  const evidence = (run.evidenceRecent ?? []).map((item, index) => ({
    kind: item.kind ?? 'evidence',
    path: typeof item.evidence === 'string' ? item.evidence : null,
    available: typeof item.evidence === 'string' && item.evidence.length > 0,
    source: 'evidence',
    recordId: `${item.task_id ?? 'run'}:${item.ts ?? index}`,
    status: item.status ?? null,
    ts: item.ts ?? null,
  }));
  return [...indexed, ...evidence];
}

function stageDrivers(run) {
  const cost = run.stageCost ?? {};
  const tokens = run.stageTokens ?? {};
  return [...new Set([...Object.keys(cost), ...Object.keys(tokens)])].sort().map((stageId) => ({
    stageId,
    costUsd: cost[stageId] ?? null,
    tokens: tokens[stageId] ?? null,
  }));
}

function recoveryItems(run) {
  const stages = run.pipelineRollup?.stages ?? {};
  if (Array.isArray(stages)) {
    return stages.filter((stage) => stage?.checkpoint_restorable !== undefined).map((stage) => ({
      stageId: stage.stage_id ?? stage.id ?? null,
      restorable: stage.checkpoint_restorable === true,
      source: 'pipeline-state.json',
    }));
  }
  return Object.entries(stages).filter(([, stage]) => stage?.checkpoint_restorable !== undefined)
    .map(([stageId, stage]) => ({ stageId, restorable: stage.checkpoint_restorable === true, source: 'pipeline-state.json' }));
}

export function buildRunWorkspace(run, context = {}) {
  if (!run) return null;
  const work = workItems(run);
  const timeline = readableTimeline(run);
  const artifacts = artifactItems(run);
  const drivers = stageDrivers(run);
  const recovery = recoveryItems(run);
  const metricsProvenance = run.metricsSource === 'persisted'
    ? 'persisted'
    : run.metricsSource === 'events' ? 'events-derived' : 'unavailable';
  const next = run.pipelineRollup?.next_action ?? null;

  return {
    identity: {
      runId: run.runId,
      runKey: run.scopeKey ?? run.runKey ?? run.runId,
      projectId: run.canonicalProjectId ?? run.projectId ?? run.project?.id ?? null,
      projectRoot: run.projectRoot ?? null,
      worktree: run.worktree ?? (run.project?.worktreeName ? { name: run.project.worktreeName, path: run.projectRoot } : null),
    },
    goal: run.manifest?.goal ?? run.goal ?? run.runId,
    state: run.derivedStatus ?? run.manifest?.status ?? 'unknown',
    stale: Boolean(run.pipelineRollup?.stale),
    outcome: {
      status: context.readiness?.status ?? 'unknown',
      summary: context.readiness?.summary ?? 'Run readiness is not available.',
      evaluatedAt: context.readiness?.evaluatedAt ?? null,
    },
    stageProof: context.stageProof ?? [],
    nextAction: next ? {
      kind: next.kind ?? 'unknown',
      text: next.text ?? 'No next action was recorded.',
      stageId: next.stage_id ?? null,
      taskId: next.task_id ?? null,
      source: `.rstack/runs/${run.runId}/pipeline-state.json`,
    } : null,
    sections: {
      summary: { available: true },
      work: { available: work.length > 0, items: work },
      timeline: { available: timeline.length > 0, items: timeline },
      artifacts: { available: artifacts.length > 0, items: artifacts, stageReports: run.stageReports ?? [] },
      metrics: {
        available: metricsProvenance !== 'unavailable',
        provenance: metricsProvenance,
        totals: run.totals ?? null,
        tokenTotals: run.tokenTotals ?? null,
        stageDrivers: drivers,
        recovery,
      },
    },
  };
}

export function buildRunWorkspaces(runs, readiness, state = {}) {
  const runScopes = readiness?.scopes?.runs ?? [];
  return (runs ?? []).map((run) => {
    const scopedReadiness = runScopes.find((entry) => entry.runId === run.runId) ?? readiness;
    const scopedOverview = buildOverviewProjection({ ...state, runs: [run], readiness: scopedReadiness });
    return buildRunWorkspace(run, { readiness: scopedReadiness, stageProof: scopedOverview.stages });
  });
}
