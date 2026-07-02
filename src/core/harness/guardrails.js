import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

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
      merged[key] = Boolean(value);
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
  } catch {
    return resolveGuardrails();
  }
}

export function isDestructiveTask(task) {
  return Boolean(task && (task.destructive === true || task.risk_level === 'destructive'));
}

export function countTaskAttempts(events = [], taskId) {
  return events.filter((event) => event?.task_id === taskId && String(event.type || '') === 'task_started').length;
}

export function guardrailOverrideArtifact(taskId) {
  return `${GUARDRAIL_OVERRIDE_PREFIX}${taskId}`;
}

// Run approvals are latest-record-wins per artifact (same semantics as the
// approval gate), so consuming an override is just appending a non-APPROVED
// record for the same artifact.
export function hasGuardrailOverride(approvals = [], taskId) {
  const artifact = guardrailOverrideArtifact(taskId);
  let latest = null;
  for (const approval of approvals) {
    if (approval?.artifact === artifact) latest = approval;
  }
  return latest?.status === 'APPROVED';
}

export function evaluateTaskClaim({ task, events = [], approvals = [], guardrails } = {}) {
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
  if (violations.length && hasGuardrailOverride(approvals, task?.id)) {
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
