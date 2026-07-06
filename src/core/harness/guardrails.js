import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { trustedApprovedArtifacts } from './approval-audit.js';
import {
  classifyDestructiveAction,
  destructiveApprovalArtifact,
  requireApprovalForDestructiveAction,
} from './destructive-actions.js';

export const DEFAULT_HARNESS_GUARDRAILS = Object.freeze({
  maxTaskAttempts: 2,
  maxDestructiveTaskAttempts: 1,
  maxToolCallsPerTask: 40,
  maxMessagesPerTask: 25,
  requireBuilderContract: true,
  requireValidatorContract: true,
  requireEvidenceForPass: true,
  requireUserApprovalForDestructiveActions: true,
  requireUserApprovalForPublishDeployOrForcePush: true,
});

export const GUARDRAIL_OVERRIDE_PREFIX = 'guardrail-override:';

export function guardrailSummary(guardrails = DEFAULT_HARNESS_GUARDRAILS) {
  return Object.entries(guardrails).map(([key, value]) => `- ${key}: ${value}`).join('\n');
}

export function resolveGuardrails(overrides = {}) {
  const merged = { ...DEFAULT_HARNESS_GUARDRAILS };
  for (const [key, value] of Object.entries(overrides || {})) {
    if (!(key in DEFAULT_HARNESS_GUARDRAILS)) continue;
    const defaultValue = DEFAULT_HARNESS_GUARDRAILS[key];
    if (typeof defaultValue === 'number') {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed >= 0) merged[key] = parsed;
    } else if (typeof defaultValue === 'boolean') {
      // Boolean(value) would turn the string "false" into true — accept only
      // real booleans and explicit "true"/"false" strings, ignore the rest.
      if (typeof value === 'boolean') merged[key] = value;
      else if (value === 'true') merged[key] = true;
      else if (value === 'false') merged[key] = false;
    }
  }
  return merged;
}

export async function loadProjectGuardrails(projectRoot) {
  const configPath = join(projectRoot, '.rstack', 'rstack.config.json');
  if (!existsSync(configPath)) return resolveGuardrails();
  try {
    const parsed = JSON.parse(await readFile(configPath, 'utf8'));
    return resolveGuardrails(parsed?.guardrails || {});
  } catch (error) {
    // A malformed config must not silently weaken enforcement without a
    // signal; unexpected I/O failures (EACCES, EIO) must surface, not
    // masquerade as "no config".
    if (error instanceof SyntaxError) {
      console.error(`[rstack] Ignoring malformed ${configPath}: ${error.message}. Default guardrails apply.`);
      return resolveGuardrails();
    }
    throw error;
  }
}

export function isDestructiveTask(task) {
  return Boolean(task && (task.destructive === true || task.risk_level === 'destructive'));
}

// Content-aware destructive check (#131): a task is destructive if it declares
// itself so (the historical flag check above) OR if the concrete action it
// carries classifies as destructive via the centralized classifier. `action`
// is a command string, a { command } / { toolName, input } tool_call shape, or
// omitted (flag-only, preserving legacy behavior).
export function isDestructiveTaskOrAction(task, action) {
  if (isDestructiveTask(task)) return true;
  if (action === undefined || action === null) return false;
  return classifyDestructiveAction(action).destructive;
}

// Gate a concrete destructive action against the run's audited approvals.
// Reuses the SAME trusted-approval path as the required-approval and
// guardrail-override gates (#133) — one audit, no drift — keyed to a per-task
// `destructive-action:<taskId>` artifact. `approvals` is the raw run
// approvals.json array; `expectedRunId` binds the record to this run.
export function evaluateDestructiveAction({ action, taskId, approvals = [], expectedRunId } = {}) {
  const approved = trustedApprovedArtifacts(approvals, { expectedRunId });
  return requireApprovalForDestructiveAction({ action, taskId, approvedArtifacts: approved });
}

// Re-export so callers wiring the guardrail path have one import surface.
export { classifyDestructiveAction, destructiveApprovalArtifact, requireApprovalForDestructiveAction };

export function countTaskAttempts(events = [], taskId) {
  return events.filter((event) => event?.task_id === taskId && String(event.type || '') === 'task_started').length;
}

export function guardrailOverrideArtifact(taskId) {
  return `${GUARDRAIL_OVERRIDE_PREFIX}${taskId}`;
}

// Run approvals are latest-record-wins per artifact (same semantics as the
// approval gate), so consuming an override is just appending a non-APPROVED
// record for the same artifact.
//
// Trust boundary (#133): this routes through the SAME audit path as the
// required-approval gate (trustedApprovedArtifacts) — one code path, no drift.
// That means the override gate gets the full history audit, not just a
// latest-record check: a malformed latest record poisons the artifact (a
// tampered CONSUMED marker cannot resurrect the earlier APPROVED record), AND
// a verbatim replay of a spent APPROVED record (re-appended after its CONSUMED
// marker) is rejected by the replay/ordering history check. `expectedRunId`
// binds the override to this run so a foreign-run record can't unblock it.
export function hasGuardrailOverride(approvals = [], taskId, { expectedRunId } = {}) {
  const artifact = guardrailOverrideArtifact(taskId);
  return trustedApprovedArtifacts(approvals, { expectedRunId }).has(artifact);
}

export function evaluateTaskClaim({ task, events = [], approvals = [], guardrails, expectedRunId } = {}) {
  const rules = resolveGuardrails(guardrails);
  const destructive = isDestructiveTask(task);
  const limit = destructive ? rules.maxDestructiveTaskAttempts : rules.maxTaskAttempts;
  const attempts = countTaskAttempts(events, task?.id);

  const violations = [];
  if (attempts >= limit) {
    violations.push({
      rule: destructive ? 'maxDestructiveTaskAttempts' : 'maxTaskAttempts',
      limit,
      observed: attempts,
      reason: `task ${task?.id} already has ${attempts} attempt(s); limit is ${limit}`,
    });
  }

  const overrideArtifact = guardrailOverrideArtifact(task?.id);
  if (violations.length && hasGuardrailOverride(approvals, task?.id, { expectedRunId })) {
    return { allowed: true, overridden: true, violations, override_artifact: overrideArtifact };
  }
  return { allowed: violations.length === 0, overridden: false, violations, override_artifact: overrideArtifact };
}

export function evaluateBuilderTelemetry({ builder, guardrails } = {}) {
  const rules = resolveGuardrails(guardrails);
  const violations = [];

  const toolCalls = Number(builder?.execution?.tool_calls);
  if (Number.isFinite(toolCalls) && toolCalls > rules.maxToolCallsPerTask) {
    violations.push({
      rule: 'maxToolCallsPerTask',
      limit: rules.maxToolCallsPerTask,
      observed: toolCalls,
      reason: `builder reported ${toolCalls} tool call(s); limit is ${rules.maxToolCallsPerTask}`,
    });
  }

  const messages = Number(builder?.execution?.messages);
  if (Number.isFinite(messages) && messages > rules.maxMessagesPerTask) {
    violations.push({
      rule: 'maxMessagesPerTask',
      limit: rules.maxMessagesPerTask,
      observed: messages,
      reason: `builder reported ${messages} message(s); limit is ${rules.maxMessagesPerTask}`,
    });
  }

  return { ok: violations.length === 0, violations };
}

export function guardrailEvent(taskId, violation, extra = {}) {
  return {
    type: 'guardrail_triggered',
    task_id: taskId ?? null,
    limit_name: violation.rule,
    current_value: violation.observed,
    limit_value: violation.limit,
    reason: violation.reason,
    // Legacy aliases for backward compat with the sdlc_trace CLI renderer
    limit: violation.rule,
    value: violation.observed,
    ...extra,
  };
}
