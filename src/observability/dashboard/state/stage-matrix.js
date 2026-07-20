import { CANONICAL_SDLC_STAGES } from '../../../core/harness/stages.js';

// owner: RStack developed by Richardson Gunde

export function buildStageMatrix(runs) {
  return CANONICAL_SDLC_STAGES.map((stage) => {
    const runStates = (runs ?? []).map((run) => {
      const task = (run.tasks ?? []).find((item) =>
        item.id === stage.id ||
        item.stage_id === stage.id ||
        item.stageId === stage.id ||
        (item.stage_artifacts ?? []).some((artifact) => artifact.stage_id === stage.id)
      );
      // #411: the authoritative per-stage projection from pipeline-state.json
      // (attached to run.pipelineRollup by attachPipelineRollups). Where it
      // exists it is the source of truth — on-disk-verified checkpoint state,
      // retry state, attempts, per-stage cost/tokens, and a validation_status
      // computed from the evidence ledger, not reconstructed from task records.
      const authoritative = (run.pipelineRollup?.stages ?? []).find((entry) => entry.id === stage.id) ?? null;
      const blocker = (run.pipelineRollup?.approval_blocker_items ?? []).find((item) => item.stage_id === stage.id) ?? null;
      const pressure = (run.pipelineRollup?.context_pressure_items ?? []).some((item) => item.stage_id === stage.id);
      // Prefer the harness's stage status; fall back to the task record only
      // when no authoritative projection exists (index-served lite runs).
      const status = authoritative?.status ?? task?.status ?? 'READY';
      const validationStatus = authoritative?.validation_status ?? task?.validation?.status ?? null;
      return {
        runId: run.runId,
        projectRoot: run.projectRoot,
        status,
        taskId: task?.id ?? (authoritative?.task_ids ?? [])[0] ?? null,
        agent: task?.agent_name ?? stage.agent,
        validationStatus,
        riskCount: task?.risk_count ?? 0,
        evidenceCount: task?.evidence_count ?? 0,
        // #411: authoritative per-stage fields (null when no projection).
        retryState: authoritative?.retry_state ?? null,
        attempts: authoritative?.attempts ?? null,
        costUsd: authoritative?.cost_usd ?? null,
        tokens: authoritative?.tokens ?? null,
        checkpointRestorable: authoritative ? authoritative.checkpoint_restorable === true : null,
        checkpointReason: authoritative?.checkpoint_reason ?? null,
        elapsedMs: authoritative?.elapsed_ms ?? null,
        approvalBlocker: blocker ? { artifact: blocker.artifact, status: blocker.status } : null,
        contextPressure: pressure,
        authoritative: Boolean(authoritative),
      };
    });
    const blocked = runStates.filter((run) => run.status === 'BLOCKED').length;
    // #411: stage-level severity for the bottleneck "gradient". Highest concern
    // first: an exhausted retry / BLOCKED stage → 'exhausted'; a build that
    // passed but validation failed → 'validation_fail'; any fail → 'fail'; an
    // approval blocker on the stage → 'blocked_approval'; retryable → 'retry';
    // in-progress → 'active'; all-pass → 'pass'; else 'ready'. The UI maps this
    // to a colour ramp so the operator sees WHERE the pipeline is stuck.
    const severity = runStates.some((run) => run.retryState === 'exhausted' || run.status === 'BLOCKED') ? 'exhausted'
      : runStates.some((run) => run.status === 'PASS' && run.validationStatus === 'FAIL') ? 'validation_fail'
      : runStates.some((run) => run.status === 'FAIL') ? 'fail'
      : runStates.some((run) => run.approvalBlocker) ? 'blocked_approval'
      : runStates.some((run) => run.retryState === 'retryable') ? 'retry'
      : runStates.some((run) => run.status === 'IN_PROGRESS') ? 'active'
      : runStates.length > 0 && runStates.every((run) => run.status === 'PASS') ? 'pass'
      : 'ready';
    return {
      ...stage,
      runs: runStates,
      pass: runStates.filter((run) => run.status === 'PASS').length,
      fail: runStates.filter((run) => run.status === 'FAIL').length,
      active: runStates.filter((run) => run.status === 'IN_PROGRESS').length,
      ready: runStates.filter((run) => run.status === 'READY' || !run.status).length,
      // #411 aggregates for the gradient/inspector.
      blocked,
      retryable: runStates.filter((run) => run.retryState === 'retryable').length,
      exhausted: runStates.filter((run) => run.retryState === 'exhausted').length,
      approvalBlocked: runStates.filter((run) => run.approvalBlocker).length,
      validationFailed: runStates.filter((run) => run.status === 'PASS' && run.validationStatus === 'FAIL').length,
      restorable: runStates.filter((run) => run.checkpointRestorable === true).length,
      severity,
    };
  });
}
