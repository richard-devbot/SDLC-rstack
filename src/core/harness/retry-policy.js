// owner: RStack developed by Richardson Gunde
//
// Deterministic retry policy (#123, BLE-3.1): validator verdicts drive task
// transitions through one pure decision function instead of prompt text or
// inline attempt math scattered across integrations. The decision is driven by
// the validator contract's `retry_recommendation` and bounded by the same
// attempt budgets the claim gate enforces (guardrails.js), so a task can never
// retry its way past a budget the claim gate would block.
import { countTaskAttempts, isDestructiveTask, resolveGuardrails } from './guardrails.js';
import { RETRY_RECOMMENDATIONS } from './contracts.js';

export const RETRY_ACTIONS = Object.freeze(['complete', 'retry', 'exhausted', 'human_context', 'block']);

// action → task status. FAIL tasks are re-claimable by sdlc_build_next;
// BLOCKED tasks need a guardrail-override approval to resume (see
// evaluateTaskClaim in guardrails.js); NEEDS_CONTEXT waits on a human answer.
export const RETRY_ACTION_STATUSES = Object.freeze({
  complete: 'PASS',
  retry: 'FAIL',
  exhausted: 'BLOCKED',
  human_context: 'NEEDS_CONTEXT',
  block: 'BLOCKED',
});

const MAX_ISSUE_ITEMS = 5;
const MAX_ISSUE_LENGTH = 120;

// Attempts are counted from `task_started` events — the same signal the
// guardrail claim gate uses. Thin wrapper over guardrails.countTaskAttempts so
// the two never drift; tolerates a non-array events argument.
export function attemptCountForTask(events, taskId) {
  return countTaskAttempts(Array.isArray(events) ? events : [], taskId);
}

function truncate(text) {
  return text.length > MAX_ISSUE_LENGTH ? `${text.slice(0, MAX_ISSUE_LENGTH)}…` : text;
}

function compactIssue(issue) {
  if (typeof issue === 'string') {
    const trimmed = issue.trim();
    return trimmed ? truncate(trimmed) : null;
  }
  if (issue && typeof issue === 'object' && !Array.isArray(issue)) {
    const parts = [issue.name, issue.evidence]
      .filter((part) => typeof part === 'string' && part.trim().length > 0)
      .map((part) => part.trim());
    return parts.length ? truncate(parts.join(': ')) : null;
  }
  return null;
}

// Compact validator issues into a small string array safe to embed in events:
// objects map to "name: evidence", entries truncate at ~120 chars, and the
// list caps at 5 items. Junk shapes (non-arrays, empty objects) yield [].
export function compactValidationIssues(issues) {
  if (!Array.isArray(issues)) return [];
  const compacted = [];
  for (const issue of issues) {
    const text = compactIssue(issue);
    if (text) compacted.push(text);
    if (compacted.length >= MAX_ISSUE_ITEMS) break;
  }
  return compacted;
}

// Missing or unknown recommendations degrade conservatively instead of
// throwing: a FAIL validation behaves like `retry_builder`, a PASS like
// `none`. An explicit `none` on a non-PASS validation is treated the same way
// — a failed task must never silently complete. This is a shared harness API,
// so junk shapes are tolerated, mirroring validateBuilderCompleteness.
function normalizeRecommendation(validation) {
  const passed = validation?.status === 'PASS';
  const recommendation = validation?.retry_recommendation;
  if (recommendation === 'none') return passed ? 'none' : 'retry_builder';
  if (RETRY_RECOMMENDATIONS.includes(recommendation)) return recommendation;
  return passed ? 'none' : 'retry_builder';
}

// Pure decision function: validator verdict + attempt history + budgets in,
// structured decision out. Never throws on malformed input. The `reason` is
// operator-facing — someone reading events.jsonl must understand the decision
// without source access.
export function classifyRetryDecision({ task, validation, events, guardrails } = {}) {
  const rules = resolveGuardrails(guardrails);
  const destructive = isDestructiveTask(task);
  const maxAttempts = destructive ? rules.maxDestructiveTaskAttempts : rules.maxTaskAttempts;
  const attempt = attemptCountForTask(events, task?.id);
  const taskId = task?.id ?? 'unknown-task';
  const recommendation = normalizeRecommendation(validation);
  const issues = compactValidationIssues(validation?.issues);

  const decision = {
    retry_recommendation: recommendation,
    attempt,
    max_attempts: maxAttempts,
    issues,
  };

  if (recommendation === 'none') {
    return {
      ...decision,
      action: 'complete',
      next_status: RETRY_ACTION_STATUSES.complete,
      reason: `Validation passed for task ${taskId}; no retry needed.`,
    };
  }
  if (recommendation === 'ask_user') {
    return {
      ...decision,
      action: 'human_context',
      next_status: RETRY_ACTION_STATUSES.human_context,
      reason: `Validator needs human input for task ${taskId}; task is paused as NEEDS_CONTEXT until an operator answers.`,
    };
  }
  if (recommendation === 'block') {
    return {
      ...decision,
      action: 'block',
      next_status: RETRY_ACTION_STATUSES.block,
      reason: `Validator blocked task ${taskId}; a human decision is required before any further attempt.`,
    };
  }
  // retry_builder: bounded by the same attempt budget the claim gate enforces.
  if (attempt >= maxAttempts) {
    return {
      ...decision,
      action: 'exhausted',
      next_status: RETRY_ACTION_STATUSES.exhausted,
      reason: `Validation failed for task ${taskId} and the ${destructive ? 'destructive-task ' : ''}attempt budget is exhausted (${attempt} of ${maxAttempts} attempts used); task is BLOCKED until a guardrail-override:${taskId} approval grants one more attempt.`,
    };
  }
  return {
    ...decision,
    action: 'retry',
    next_status: RETRY_ACTION_STATUSES.retry,
    reason: `Validation failed for task ${taskId}; builder may retry (${attempt} of ${maxAttempts} attempts used).`,
  };
}

// Map a decision to the task status string stamped in tasks.json. Unknown or
// malformed decisions fall back to FAIL — re-claimable, still bounded by the
// claim-gate attempt budget, never a silent PASS.
export function nextTaskStatusForRetry(decision) {
  return RETRY_ACTION_STATUSES[decision?.action] ?? 'FAIL';
}
