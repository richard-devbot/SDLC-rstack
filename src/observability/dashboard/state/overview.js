import { CANONICAL_SDLC_STAGES, stageArtifactRelativePath } from '../../../core/harness/stages.js';

// owner: RStack developed by Richardson Gunde

const STATUS = {
  PASS: 'passed',
  FAIL: 'failed',
  FAILED: 'failed',
  BLOCKED: 'blocked',
  IN_PROGRESS: 'in_progress',
  RUNNING: 'in_progress',
  READY: 'not_started',
  PENDING: 'not_started',
  QUEUED: 'not_started',
};

function focusRun(runs) {
  const candidates = runs ?? [];
  return candidates.find((run) => run.derivedStatus === 'active')
    ?? candidates.find((run) => run.pipelineRollup)
    ?? candidates[0]
    ?? null;
}

function stageTask(run, stageId) {
  return (run?.tasks ?? []).find((task) =>
    task.id === stageId
    || task.stage_id === stageId
    || task.stageId === stageId
    || (task.stage_artifacts ?? []).some((artifact) => artifact.stage_id === stageId)
  ) ?? null;
}

function stageSource(run, stage, produced) {
  if (!run || !produced) return null;
  return {
    kind: 'stage_report',
    path: stageArtifactRelativePath(run.runId, stage.id, stage.artifact),
    runId: run.runId,
    projectRoot: run.projectRoot ?? null,
  };
}

function proofAvailability(attached, produced, state) {
  if (attached > 0 && (produced || state === 'passed')) return 'available';
  if (attached > 0 || produced) return 'partial';
  if (state === 'unknown') return 'unknown';
  return 'unavailable';
}

function stageView(run, stage) {
  const task = stageTask(run, stage.id);
  const produced = (run?.stageReports ?? []).includes(stage.id);
  const rawStatus = String(task?.status ?? '').toUpperCase();
  const state = task ? (STATUS[rawStatus] ?? 'unknown') : produced ? 'unknown' : 'not_started';
  const attached = Number(task?.evidence_count ?? task?.evidenceCount ?? 0);
  const validation = task?.validation ?? null;

  return {
    id: stage.id,
    label: stage.title ?? stage.id,
    state,
    proof: {
      attached,
      expected: null,
      availability: proofAvailability(attached, produced, state),
      validation: validation?.status ?? null,
    },
    primaryBlocker: state === 'blocked' || state === 'failed' ? (task?.title ?? task?.id ?? null) : null,
    owner: task?.agent_name ?? stage.agent ?? null,
    elapsed: run?.stageElapsed?.[stage.id] ?? null,
    lastEvent: null,
    source: stageSource(run, stage, produced),
  };
}

function pipelineAction(run, readiness) {
  const next = run?.pipelineRollup?.next_action;
  if (next?.text) {
    return {
      kind: next.kind ?? 'unknown',
      text: next.text,
      stageId: next.stage_id ?? null,
      taskId: next.task_id ?? null,
      source: {
        kind: 'pipeline',
        path: `.rstack/runs/${run.runId}/pipeline-state.json`,
        runId: run.runId,
        projectRoot: run.projectRoot ?? null,
      },
    };
  }
  const blocker = readiness?.blockers?.[0];
  if (blocker) {
    return {
      kind: blocker.type ?? 'blocked',
      text: `${blocker.label}: ${blocker.detail}`,
      stageId: null,
      taskId: null,
      source: blocker.sourceRef ?? null,
    };
  }
  if (!run) {
    return { kind: 'setup', text: 'Start an RStack run to evaluate delivery readiness.', stageId: null, taskId: null, source: null };
  }
  return { kind: 'diagnostics', text: 'Attach task validation and pipeline proof before making a release decision.', stageId: null, taskId: null, source: null };
}

function actionCount(state) {
  const identities = [
    ...(state.pendingApprovals ?? []).map((item) => `approval:${item.id ?? item.artifact}`),
    ...(state.blockedGates ?? []).map((item) => `gate:${item.id ?? item.runId ?? item.taskId}`),
    ...(state.alerts ?? []).filter((item) => ['critical', 'error'].includes(String(item.level ?? item.severity ?? '').toLowerCase()))
      .map((item) => `alert:${item.id ?? item.runId ?? item.title}`),
  ];
  return new Set(identities.filter(Boolean)).size;
}

/**
 * Translate the scoped dashboard snapshot into Overview display data.
 * Readiness remains server-owned; this projection never derives a verdict.
 */
export function buildOverviewProjection(state) {
  const run = focusRun(state.runs);
  const readiness = state.readiness ?? { status: 'unknown', coverage: {}, blockers: [] };
  const stale = Boolean(run?.pipelineRollup?.stale);

  return {
    focusRunId: run?.runId ?? null,
    goal: run?.manifest?.goal ?? run?.goal ?? null,
    outcome: readiness.status ?? 'unknown',
    title: run ? (readiness.summary ?? 'Delivery outcome is not available.') : 'No delivery run has been evaluated.',
    nextAction: pipelineAction(run, readiness),
    stages: run ? CANONICAL_SDLC_STAGES.map((stage) => stageView(run, stage)) : [],
    actionCount: actionCount(state),
    stale,
    eventsBehind: stale ? Number(run.pipelineRollup?.events_behind ?? 0) : 0,
    evaluatedAt: readiness.evaluatedAt ?? state.ts ?? null,
    coverage: readiness.coverage ?? {},
  };
}
