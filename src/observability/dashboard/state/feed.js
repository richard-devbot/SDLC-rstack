import { plainLanguageSummary } from '../../alerts/engine.js';

// owner: RStack developed by Richardson Gunde

export function buildActivityFeed(runs) {
  const skipInFeed = new Set(['tool_call', 'tool_result']);
  const activityFeed = [];

  for (const run of (runs ?? []).slice(0, 15)) {
    const toolBursts = {};
    for (const ev of run.events ?? []) {
      if (ev.type !== 'tool_call') continue;
      const min = ev.ts?.slice(0, 16);
      if (!min) continue;
      toolBursts[min] = (toolBursts[min] ?? 0) + 1;
    }
    for (const [min, count] of Object.entries(toolBursts)) {
      if (count >= 3) {
        activityFeed.push({
          ts: `${min}:00.000Z`,
          summary: `${count} tool calls - agent working`,
          type: 'tool_burst',
          runId: run.runId,
          projectRoot: run.projectRoot,
          goal: run.manifest?.goal,
          level: 'tool',
        });
      }
    }

    for (const ev of run.events ?? []) {
      if (skipInFeed.has(ev.type)) continue;
      // July harness vocabulary (#215) gets first-class summaries here;
      // everything else keeps the shared plain-language path. Unknown event
      // types still degrade exactly as before: no summary, no feed line.
      const summary = opsEventSummary(ev) ?? plainLanguageSummary(ev);
      if (!summary) continue;
      const item = {
        ts: ev.ts,
        summary,
        type: ev.type,
        runId: run.runId,
        projectRoot: run.projectRoot,
        goal: run.manifest?.goal,
        level: eventLevel(ev),
      };
      // Structured detail for the client panels (retry state, guardrail
      // depth, audit rejections) — only real fields from the event, never
      // fabricated defaults.
      const data = opsEventData(ev);
      if (data) item.data = data;
      activityFeed.push(item);
    }
  }

  return activityFeed
    .sort((a, b) => (b.ts ?? '').localeCompare(a.ts ?? ''))
    .slice(0, 200);
}

// Plain-English lines for the loop-engineering signals shipped 2026-07
// (#156 remainder + #215): checkpoints, context pressure, approval audit
// rejections, memory write decisions, metrics drift, retry decisions and
// goal-loop evaluations. Returns null for anything it does not own.
function opsEventSummary(ev) {
  switch (ev.type) {
    case 'stage_checkpoint_before_saved':
      return checkpointSummary('before', ev);
    case 'stage_checkpoint_after_saved':
      return checkpointSummary('after', ev);
    case 'context_pressure_warning': {
      const size = fmtCount(ev.size);
      const threshold = fmtCount(ev.threshold);
      const metric = ev.metric ?? 'chars';
      return `Context pressure — ${ev.source ?? 'context'} at ${size} ${metric} (threshold ${threshold}); warning only, nothing was pruned`;
    }
    case 'approval_audit_failed':
      return `Approval record rejected by audit — ${ev.artifact ?? 'unknown artifact'} treated as absent; the gate stayed closed`;
    case 'episode_memory_written':
      return `Episode memory written for ${ev.task_id ?? 'run'}${ev.trusted === true ? ' (trusted)' : ev.trusted === false ? ' (stored untrusted — never injected into prompts)' : ''}`;
    case 'episode_memory_skipped_untrusted':
      return `Episode memory skipped for ${ev.task_id ?? 'task'} — ${ev.reason ?? 'write policy refused the episode'}${ev.write_policy ? ` (policy: ${ev.write_policy})` : ''}`;
    case 'metrics_write_failed':
      return `Metrics write failed${ev.operation ? ` (${ev.operation})` : ''} — persisted totals are behind the events; run totals fall back to event recompute`;
    case 'retry_decision':
      // Pinned #123 emitter contract: { task_id, stage_id, attempt,
      // max_attempts, retry_recommendation, action, next_status, reason,
      // issues[] } with action ∈ complete|retry|exhausted|human_context|block.
      return `Retry decision for ${ev.task_id ?? 'task'}: ${ev.action ?? '?'}${ev.next_status ? ` → ${ev.next_status}` : ''}${ev.reason ? ` — ${ev.reason}` : ''}`;
    // goal_evaluated keeps its shared plain-language summary (goal_id /
    // status / score / reason — the real pipeline-loop.js emitter fields);
    // the ops layer only attaches the structured data below.
    default:
      return null;
  }
}

function checkpointSummary(phase, ev) {
  const verified = ev.verified === true
    ? 'verified restorable'
    : ev.verified === false ? 'NOT verified — restore may fail' : 'verification unknown';
  return `Checkpoint saved ${phase} ${ev.stage_id ?? 'stage'} (${verified})`;
}

function fmtCount(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num.toLocaleString('en-US') : '?';
}

// Structured per-type detail carried on feed items so the Alerts &
// Guardrails / Approvals panels can render depth (limit vs value, attempt
// counts, audit issues) without a second data path. Only fields that exist
// on the event are copied — absent fields stay absent.
const OPS_EVENT_DATA_FIELDS = {
  guardrail_triggered: ['task_id', 'limit_name', 'current_value', 'limit_value', 'reason'],
  guardrail_overridden: ['task_id', 'artifact'],
  task_retry_scheduled: ['task_id', 'stage_id', 'attempt', 'max_attempts', 'retry_recommendation', 'reason'],
  task_retry_exhausted: ['task_id', 'stage_id', 'attempt', 'max_attempts', 'retry_recommendation', 'reason'],
  task_human_context_required: ['task_id', 'stage_id', 'attempt', 'max_attempts', 'retry_recommendation', 'reason'],
  retry_decision: ['task_id', 'stage_id', 'attempt', 'max_attempts', 'retry_recommendation', 'action', 'next_status', 'reason'],
  context_pressure_warning: ['task_id', 'source', 'metric', 'size', 'threshold', 'blocking', 'stage_id'],
  approval_audit_failed: ['record_id', 'artifact', 'status', 'issues', 'reason'],
  stage_checkpoint_before_saved: ['stage_id', 'task_id', 'verified'],
  stage_checkpoint_after_saved: ['stage_id', 'task_id', 'verified'],
  episode_memory_written: ['task_id', 'trusted'],
  episode_memory_skipped_untrusted: ['task_id', 'reason', 'write_policy'],
  metrics_write_failed: ['task_id', 'operation', 'error'],
  goal_evaluated: ['iteration', 'max_iterations', 'goal_id', 'status', 'score', 'critical_count', 'failing_stages', 'recommended_rerun_stages'],
};

function opsEventData(ev) {
  const fields = OPS_EVENT_DATA_FIELDS[ev.type];
  if (!fields) return null;
  const data = {};
  for (const field of fields) {
    if (ev[field] !== undefined) data[field] = ev[field];
  }
  return Object.keys(data).length ? data : null;
}

function eventLevel(ev) {
  if (ev.type === 'task_validated' && ev.status === 'FAIL') return 'fail';
  if (ev.type === 'validation_failed') return 'fail';
  if (ev.type === 'guardrail_triggered') return 'warn';
  if (ev.type === 'guardrail_overridden') return 'pass';
  if (ev.type === 'dor_gate_blocked') return 'blocked';
  if (ev.type === 'task_retry_scheduled') return 'warn';
  if (ev.type === 'task_retry_exhausted') return 'fail';
  if (ev.type === 'task_human_context_required') return 'blocked';
  if (ev.type === 'task_blocked_by_validator') return 'blocked';
  if (ev.type === 'retry_decision') {
    // next_status is the task transition the harness actually made (#123):
    // PASS | FAIL (re-claimable) | BLOCKED | NEEDS_CONTEXT.
    const nextStatus = String(ev.next_status ?? '').toUpperCase();
    if (nextStatus === 'BLOCKED' || nextStatus === 'NEEDS_CONTEXT') return 'blocked';
    if (nextStatus === 'PASS') return 'pass';
    return 'warn';
  }
  if (/^retry_/.test(String(ev.type ?? ''))) return 'warn';
  if (ev.type === 'stage_checkpoint_before_saved' || ev.type === 'stage_checkpoint_after_saved') {
    return ev.verified === false ? 'warn' : 'info';
  }
  if (ev.type === 'context_pressure_warning') return 'warn';
  if (ev.type === 'approval_audit_failed') return 'fail';
  if (ev.type === 'episode_memory_written') return 'info';
  if (ev.type === 'episode_memory_skipped_untrusted') return 'warn';
  if (ev.type === 'metrics_write_failed') return 'warn';
  if (ev.type === 'goal_evaluated') return ev.status === 'PASS' ? 'pass' : 'warn';
  if (ev.type === 'loop_iteration_retrying_stages') return 'warn';
  if (ev.type === 'loop_completed') return 'pass';
  if (ev.type === 'loop_blocked') return 'blocked';
  if (ev.type === 'approval_gate_blocked') return 'blocked';
  if (ev.type === 'approval_gate') return 'pass';
  if (ev.type === 'quality_score_recorded') return 'pass';
  if (ev.type === 'session_shutdown') return 'dim';
  return 'info';
}
