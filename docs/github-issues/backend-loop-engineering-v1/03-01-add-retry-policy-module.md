<!-- owner: RStack developed by Richardson Gunde -->

# [BLE-3.1] Add retry policy module

## Summary

Add `src/core/harness/retry-policy.js` to decide task transitions after validation.

## Motivation

Retry behavior should not be embedded in prompts or shell wrappers. It should be deterministic, testable, and tied to builder/validator contracts.

## Proposed Implementation

- Add `src/core/harness/retry-policy.js`.
- Export functions such as:
  - `attemptCountForTask(events, taskId)`
  - `classifyRetryDecision({ task, validation, events, guardrails })`
  - `nextTaskStatusForRetry(decision)`
- Use `validation.retry_recommendation`:
  - `none` -> pass/complete
  - `retry_builder` -> retry if attempts remain
  - `ask_user` -> needs human context
  - `block` -> blocked
- Respect:
  - `DEFAULT_HARNESS_GUARDRAILS.maxTaskAttempts`
  - `maxDestructiveTaskAttempts` where task/action is destructive
- Return structured decision:
  - `action`
  - `next_status`
  - `attempt`
  - `max_attempts`
  - `reason`
  - `issues`

## Acceptance Criteria

- [ ] Retry policy is unit-tested without invoking Pi.
- [ ] `retry_builder` does not retry after max attempts.
- [ ] `ask_user` returns human-required action.
- [ ] `block` returns blocked action.

## Test Plan

- [ ] Unit tests for all retry recommendations.
- [ ] Unit tests for max attempts.
- [ ] Unit tests for malformed validation fallback.

## Out Of Scope

- No runner implementation.
- No dashboard UI.

## Prior Art / Pattern Notes

Use retry policy semantics as a reference. Implement original SDLC-rstack code using local guardrails and validation contracts.

