// owner: RStack developed by Richardson Gunde

import { readPipelineState, writePipelineState } from '../core/harness/pipeline-state.js';
import { resolveRunId } from '../core/harness/runs.js';

const PASSED_STATUSES = new Set(['PASS', 'PASSED', 'SUCCESS', 'SUCCEEDED', 'DONE', 'COMPLETED']);
const FAILED_STATUSES = new Set(['FAIL', 'FAILED', 'ERROR', 'BLOCKED']);
const RUNNING_STATUSES = new Set(['RUNNING', 'IN_PROGRESS', 'STARTED']);

export async function loadPipelineStatus(projectRoot, options = {}) {
  const runId = await resolveRunId(projectRoot, options.runId);
  if (options.regenerate) {
    const { state } = await writePipelineState(projectRoot, runId);
    return { state, runId };
  }
  const state = await readPipelineState(projectRoot, runId);
  if (!state) {
    throw new Error(`No usable pipeline-state.json for run ${runId}. Re-run with --regenerate to rebuild it from the run artifacts.`);
  }
  return { state, runId };
}

export function recommendPipelineAction(state) {
  if (!state || !Array.isArray(state.stages)) {
    return 'Inspect the run artifacts under .rstack/runs/<run_id>/ — pipeline state is missing or unrecognized.';
  }

  const blockers = state.approval_blockers || [];
  if (blockers.length) {
    const first = blockers[0];
    const where = first.stage_id ? ` (stage ${first.stage_id})` : '';
    return `Resolve the pending approval for ${first.artifact ?? 'the blocked artifact'}${where} via sdlc_approve or the Business Hub.`;
  }

  const failed = state.stages.filter((stage) => FAILED_STATUSES.has(stage.status));
  if (failed.length) {
    const stage = failed[0];
    const attempts = `${stage.attempts ?? 0} attempt(s) recorded`;
    // retry_state refines the failed-stage TEXT only; the deterministic
    // priority order (approvals → failed → active → pending → complete) is unchanged.
    if (stage.retry_state === 'exhausted') {
      return `Stage ${stage.id} exhausted its retry budget (${attempts}) — approve the guardrail-override for its blocked task via sdlc_approve or the Business Hub, or inspect the run artifacts first.`;
    }
    if (stage.retry_state === 'retryable') {
      return `Re-run the builder for failed stage ${stage.id} — a retry is scheduled (${attempts}).`;
    }
    return `Inspect or retry failed stage ${stage.id} (${attempts}).`;
  }

  if (state.current?.stage_id) {
    const task = state.current.task_id ? ` (task ${state.current.task_id})` : '';
    return `Continue the active stage ${state.current.stage_id}${task}.`;
  }

  const pending = state.stages.filter((stage) => stage.status === 'PENDING');
  if (pending.length) {
    return `Start the first pending stage ${pending[0].id}.`;
  }

  if (state.stages.length > 0 && state.stages.every((stage) => PASSED_STATUSES.has(stage.status))) {
    return 'Pipeline complete — no backend action required.';
  }

  return 'Inspect the run artifacts under .rstack/runs/<run_id>/ — state is ambiguous.';
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '0s';
  const seconds = ms / 1000;
  if (seconds < 60) return `${Math.round(seconds * 10) / 10}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${Math.round(seconds % 60)}s`;
}

export function formatPipelineStatus(state) {
  const stages = state.stages || [];
  const passed = stages.filter((stage) => PASSED_STATUSES.has(stage.status));
  const failed = stages.filter((stage) => FAILED_STATUSES.has(stage.status));
  const running = stages.filter((stage) => RUNNING_STATUSES.has(stage.status));
  const pending = stages.filter((stage) => stage.status === 'PENDING');

  const lines = [];
  lines.push(`Run: ${state.run?.run_id ?? 'unknown'}${state.run?.goal ? ` — ${state.run.goal}` : ''}`);
  lines.push(`Status: manifest ${state.run?.status ?? 'UNKNOWN'} | pipeline ${state.pipeline?.status ?? 'UNKNOWN'}`);

  if (state.current?.stage_id) {
    lines.push(`Current: stage ${state.current.stage_id}${state.current.task_id ? ` (task ${state.current.task_id})` : ''}`);
  } else {
    lines.push('Current: none');
  }

  lines.push(`Stages: ${passed.length} passed / ${failed.length} failed / ${running.length} running / ${pending.length} pending of ${stages.length}`);
  if (failed.length) {
    lines.push(`Failed stages: ${failed.map((stage) => `${stage.id} (${stage.attempts ?? 0} attempt(s))`).join(', ')}`);
  }

  const retries = state.retries || {};
  const retryBreakdown = [];
  if (retries.scheduled) retryBreakdown.push(`${retries.scheduled} scheduled`);
  if (retries.exhausted) retryBreakdown.push(`${retries.exhausted} exhausted`);
  if (retries.human_required) retryBreakdown.push(`${retries.human_required} awaiting human context`);
  const retryText = retryBreakdown.length
    ? `${retries.total ?? 0} (${retryBreakdown.join(', ')})`
    : `${retries.total ?? 0}`;
  lines.push(`Retries: ${retryText} | Guardrail events: ${state.guardrails?.total ?? 0}`);

  const loop = state.goal_loop;
  if (loop?.total) {
    const parts = [`iteration ${loop.iterations}`];
    if (loop.last_evaluation?.status) {
      parts.push(`last evaluation ${loop.last_evaluation.status} (score ${loop.last_evaluation.score ?? '?'})`);
    }
    if (loop.stopped_on) parts.push(`stopped on ${loop.stopped_on}`);
    lines.push(`Goal loop: ${parts.join(' | ')}`);
  }

  const blockers = state.approval_blockers || [];
  if (blockers.length) {
    lines.push(`Approval blockers (${blockers.length}):`);
    for (const blocker of blockers) {
      lines.push(`  - ${blocker.artifact ?? 'unknown artifact'}${blocker.stage_id ? ` (stage ${blocker.stage_id})` : ''} [${blocker.status}]`);
    }
  } else {
    lines.push('Approval blockers: none');
  }

  const cost = state.cost_context || {};
  const totals = [
    `duration ${formatDuration(cost.cumulative_duration_ms)}`,
    `cost $${Number(cost.cumulative_cost_usd ?? 0).toFixed(2)}`,
    `tool calls ${cost.cumulative_tool_calls ?? 0}`,
  ];
  if (cost.context_tokens_used != null) {
    totals.push(`context ${cost.context_tokens_used}${cost.context_tokens_available != null ? `/${cost.context_tokens_available}` : ''} tokens`);
  }
  lines.push(`Totals: ${totals.join(' | ')}`);

  lines.push(`Next: ${recommendPipelineAction(state)}`);
  return lines.join('\n');
}
