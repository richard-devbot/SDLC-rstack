// owner: RStack developed by Richardson Gunde
//
// Server-owned cockpit projection (#285): the ONLY declaration of which
// state-changing controls the client may render for each run. The client
// renders exactly `state.cockpit.runs[].allowedActions` — it never infers a
// control from the existence of a CLI command. When the feature is disabled the
// projection is `{ enabled: false, runs: [] }`, so a client has nothing to
// render or invoke. Eligibility is derived from the same compact pipeline
// rollup the CLI's `pipeline status` reads (so the UI can't drift from what
// execution would do); the POST /api/action route re-verifies from ground
// truth before doing any work. See docs/security/cockpit-controls-threat-model.md.

import {
  COCKPIT_ACTION_TYPES,
  COCKPIT_RISK,
  COCKPIT_AUDIT_EVENTS,
  RESUME_MAX_STEPS,
  evaluateResumeEligibility,
  evaluateCheckpointEligibility,
} from '../../../core/harness/cockpit-actions.js';

function targetLabel(run) {
  return `${run.project?.id ?? run.projectRoot ?? 'project'} · run ${run.runId}`;
}

function resumeAction(run, rollup) {
  const elig = evaluateResumeEligibility(rollup);
  return {
    id: `cockpit:resume-run:${run.runId}`,
    type: COCKPIT_ACTION_TYPES.RESUME_RUN,
    target: {
      projectRoot: run.projectRoot ?? null,
      projectId: run.project?.id ?? null,
      runId: run.runId,
      stageId: null,
    },
    risk: COCKPIT_RISK.LOW,
    requiresApproval: false,
    enabled: elig.eligible,
    disabledReason: elig.eligible ? null : elig.reason,
    idempotencyRequired: true,
    auditEventType: COCKPIT_AUDIT_EVENTS[COCKPIT_ACTION_TYPES.RESUME_RUN],
    confirm: {
      title: `Resume run ${run.runId}`,
      consequence: `Advances the governed run up to ${RESUME_MAX_STEPS} model-free steps, stopping at every human gate. Non-destructive — it cannot cross an approval or override.`,
      target: targetLabel(run),
    },
  };
}

function restoreAction(run, stage, stale) {
  const elig = evaluateCheckpointEligibility(stage, { stale });
  return {
    id: `cockpit:restore-checkpoint:${run.runId}:${stage.id}`,
    type: COCKPIT_ACTION_TYPES.RESTORE_CHECKPOINT,
    target: {
      projectRoot: run.projectRoot ?? null,
      projectId: run.project?.id ?? null,
      runId: run.runId,
      stageId: stage.id,
    },
    risk: COCKPIT_RISK.HIGH,
    requiresApproval: true,
    enabled: elig.eligible,
    disabledReason: elig.eligible ? null : elig.reason,
    idempotencyRequired: true,
    auditEventType: COCKPIT_AUDIT_EVENTS[COCKPIT_ACTION_TYPES.RESTORE_CHECKPOINT],
    confirm: {
      title: `Restore checkpoint for stage ${stage.id}`,
      consequence: `Overwrites the current ${stage.id} stage artifacts with its last verified checkpoint. Destructive and requires manager approval — the restore runs only after a manager approves the request on the Approvals page.`,
      target: `${targetLabel(run)} · stage ${stage.id}`,
    },
  };
}

// Build the projection. `enabled` is the global env flag; `enabledRoots` is the
// set of project roots whose policy opts in. A run's controls appear only when
// one of those enables its root.
export function buildCockpitProjection(state, { enabled = false, enabledRoots = null } = {}) {
  const roots = enabledRoots instanceof Set ? enabledRoots : new Set(enabledRoots ?? []);
  const runEnabled = (run) => enabled || roots.has(run.projectRoot);
  const anyEnabled = enabled || roots.size > 0;

  const runs = (state.runs ?? []).filter(runEnabled).map((run) => {
    const rollup = run.pipelineRollup ?? null;
    const stale = Boolean(rollup?.stale);
    const allowedActions = [resumeAction(run, rollup)];
    for (const stage of rollup?.checkpoints?.stages ?? []) {
      if (stage?.id) allowedActions.push(restoreAction(run, stage, stale));
    }
    return {
      runId: run.runId,
      projectId: run.project?.id ?? null,
      projectRoot: run.projectRoot ?? null,
      stale,
      allowedActions,
    };
  });

  return {
    enabled: anyEnabled,
    reason: anyEnabled
      ? null
      : 'cockpit controls are OFF — set RSTACK_COCKPIT_CONTROLS=1 or policy cockpit_controls.enabled to enable',
    runs,
  };
}
