// owner: RStack developed by Richardson Gunde
//
// Compact pipeline rollup (#94 / #156 / #215 / #221) — shared so BOTH the live
// snapshot builder (state/index.js) and the rollup index (state/rollup-index.js)
// can produce the identical summary from a pipeline-state.json.
//
// It was private to state/index.js, but #221 persists the rollup into the index
// entry (so completed/index-served runs stop re-reading pipeline-state.json on
// every 3s poll). rollup-index.js cannot import state/index.js — index.js
// already imports rollup-index.js, so that would be a cycle — hence this
// dependency-free-of-both module. `recommendPipelineAction` (the CLI's
// next-action sentence) is reused verbatim so the Hub and CLI never disagree.

import { recommendPipelineAction } from '../../../commands/pipeline.js';

const ROLLUP_FAILED_STATUSES = new Set(['FAIL', 'FAILED', 'ERROR', 'BLOCKED']);
const ROLLUP_PASSED_STATUSES = new Set(['PASS', 'PASSED', 'SUCCESS', 'SUCCEEDED', 'DONE', 'COMPLETED']);

// Mirrors recommendPipelineAction's deterministic priority order
// (approvals → failed → active → pending → complete) to CLASSIFY the action
// for chip routing; the sentence itself always comes from
// recommendPipelineAction so the two can never disagree on substance.
export function classifyNextAction(state) {
  const none = { kind: 'unknown', stage_id: null, task_id: null, artifact: null };
  if (!state || !Array.isArray(state.stages)) return none;
  const blocker = (state.approval_blockers ?? [])[0];
  if (blocker) return { kind: 'approval', stage_id: blocker.stage_id ?? null, task_id: null, artifact: blocker.artifact ?? null };
  const failed = state.stages.find((stage) => ROLLUP_FAILED_STATUSES.has(stage.status));
  if (failed) {
    const kind = failed.retry_state === 'exhausted' ? 'guardrail_blocked'
      : failed.retry_state === 'retryable' ? 'retry' : 'failed';
    return { kind, stage_id: failed.id, task_id: (failed.task_ids ?? [])[0] ?? null, artifact: null };
  }
  if (state.current?.stage_id) {
    return { kind: 'active', stage_id: state.current.stage_id, task_id: state.current.task_id ?? null, artifact: null };
  }
  const pending = state.stages.find((stage) => stage.status === 'PENDING');
  if (pending) return { kind: 'pending', stage_id: pending.id, task_id: null, artifact: null };
  if (state.stages.length > 0 && state.stages.every((stage) => ROLLUP_PASSED_STATUSES.has(stage.status))) {
    return { kind: 'complete', stage_id: null, task_id: null, artifact: null };
  }
  return none;
}

// #218/#449: how many observed events are newer than the persisted state was
// computed. >0 means the state (and its next-action) lags the live stream.
// Shared so the rollup's `stale` flag and the observer's reactive-refresh
// decision (state/index.js) use ONE definition and can never disagree.
export function pipelineStateEventsBehind(state, events) {
  const generatedAt = state?.generated_at ?? null;
  if (!generatedAt) return 0;
  return (events ?? []).filter((event) => String(event?.ts ?? event?.timestamp ?? '') > String(generatedAt)).length;
}

export function compactPipelineRollup(state, events) {
  const next = classifyNextAction(state);
  const loop = state.goal_loop ?? {};
  // Last goal verdict: prefer the rollup's last_evaluation.status; the BLE-4
  // goal evaluator emits `recommendation` on the pinned goal_evaluated event,
  // so fall back to that before giving up.
  const lastGoalEvent = [...(events ?? [])].reverse()
    .find((event) => String(event?.type ?? event?.kind ?? '') === 'goal_evaluated') ?? null;
  const lastVerdict = loop.last_evaluation?.status ?? lastGoalEvent?.status ?? lastGoalEvent?.recommendation ?? null;
  // Freshness (#218 review): a persisted pipeline-state.json can lag the live
  // event stream on an active run. `generated_at` stamps when the state was
  // computed; any event newer than it means the next-action below is behind
  // live data. Detected from data already in the snapshot — no extra read —
  // so the hero card can say so rather than present a stale recommendation as
  // live ("never let stale data look live").
  const generatedAt = state.generated_at ?? null;
  const eventsBehind = pipelineStateEventsBehind(state, events);
  return {
    schema_version: state.schema_version ?? null,
    status: state.pipeline?.status ?? 'UNKNOWN',
    stages_total: state.pipeline?.stages_total ?? 0,
    stages_passed: state.pipeline?.stages_passed ?? 0,
    stages_failed: state.pipeline?.stages_failed ?? 0,
    generated_at: generatedAt,
    stale: eventsBehind > 0,
    events_behind: eventsBehind,
    // #411: the authoritative per-stage projection. buildPipelineState computes
    // these on-disk-verified fields for every canonical stage, but the rollup
    // used to drop the whole stages[] array (keeping only a checkpoint subset),
    // so the UI rebuilt its stage view from bundled task records and never saw
    // the harness's truth — retry_state, validation_status separate from build
    // status, attempts, per-stage cost/tokens, and checkpoint restorability.
    // Emitted here (bounded: 15 canonical stages, scalar fields only) so the
    // Business Hub renders verified state instead of a reconstruction.
    stages: (state.stages ?? []).map((stage) => ({
      id: stage.id,
      title: stage.title ?? null,
      status: stage.status ?? 'PENDING',
      validation_status: stage.validation_status ?? null,
      attempts: stage.attempts ?? 0,
      retry_state: stage.retry_state ?? null,
      elapsed_ms: stage.elapsed_ms ?? null,
      cost_usd: stage.cost_usd ?? null,
      tokens: stage.tokens ?? null,
      checkpoint_restorable: stage.checkpoint_restorable === true,
      checkpoint_reason: stage.checkpoint_reason ?? null,
      task_ids: Array.isArray(stage.task_ids) ? stage.task_ids : [],
    })),
    // #411: per-stage approval blockers keep their {artifact, stage_id, status}
    // detail (not just the count below) so the UI can pin an "awaiting: X" chip
    // on the exact stage that is blocked.
    approval_blocker_items: (state.approval_blockers ?? []).map((blocker) => ({
      artifact: blocker.artifact ?? null,
      stage_id: blocker.stage_id ?? null,
      status: blocker.status ?? null,
    })),
    // #411: per-stage context-pressure warnings, attributed to their stage_id
    // (the aggregate total/by_source stays below for the global signal).
    context_pressure_items: (state.context_pressure?.warnings ?? []).map((warning) => ({
      stage_id: warning.stage_id ?? null,
      task_id: warning.task_id ?? null,
      source: warning.source ?? null,
      metric: warning.metric ?? null,
    })),
    next_action: { ...next, text: recommendPipelineAction(state) },
    approval_blockers: (state.approval_blockers ?? []).length,
    retries: {
      total: state.retries?.total ?? 0,
      scheduled: state.retries?.scheduled ?? 0,
      exhausted: state.retries?.exhausted ?? 0,
      human_required: state.retries?.human_required ?? 0,
    },
    context_pressure: {
      total: state.context_pressure?.total ?? 0,
      by_source: state.context_pressure?.by_source ?? {},
    },
    checkpoints: {
      total: state.checkpoints?.total ?? 0,
      before_saved: state.checkpoints?.before_saved ?? 0,
      after_saved: state.checkpoints?.after_saved ?? 0,
      reverted: state.checkpoints?.reverted ?? 0,
      // Per-stage restore-point status (#215): only stages with a signal —
      // a restorable checkpoint, or a reason worth surfacing (corrupt_*,
      // legacy_unverified). "no_checkpoint" stages are omitted so the strip
      // stays compact. restorable/reason come from the harness's on-disk
      // deep verification (#132/#203), never inferred here.
      stages: (state.stages ?? [])
        .filter((stage) => stage.checkpoint_restorable === true
          || (stage.checkpoint_reason && stage.checkpoint_reason !== 'no_checkpoint' && stage.checkpoint_reason !== 'invalid_stage'))
        .map((stage) => ({
          id: stage.id,
          restorable: stage.checkpoint_restorable === true,
          reason: stage.checkpoint_reason ?? null,
        })),
    },
    goal_loop: {
      total: loop.total ?? 0,
      iterations: loop.iterations ?? 0,
      active: (loop.total ?? 0) > 0 && !loop.stopped_on,
      stopped_on: loop.stopped_on ?? null,
      last_verdict: lastVerdict,
      criteria_met: lastGoalEvent?.criteria_met ?? null,
      criteria_total: lastGoalEvent?.criteria_total ?? null,
    },
  };
}
