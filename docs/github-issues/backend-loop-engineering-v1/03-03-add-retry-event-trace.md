<!-- owner: RStack developed by Richardson Gunde -->

# [BLE-3.3] Add retry event trace

## Summary

Record structured retry events in `events.jsonl` and expose them in `sdlc_trace`.

## Motivation

Retries are only useful if operators can see why they happened, what validator issue caused them, and what the next action was.

## Proposed Implementation

- Add event types:
  - `retry_decision`
  - `task_retry_scheduled`
  - `task_retry_exhausted`
  - `task_human_context_required`
  - `task_blocked_by_validator`
- Include:
  - `task_id`
  - `stage_id`
  - `attempt`
  - `max_attempts`
  - `retry_recommendation`
  - `reason`
  - compact `issues[]`
  - `next_status`
- Update `sdlc_trace` rendering to show retry events.
- Ensure pipeline-state rollup includes retry summary.

## Acceptance Criteria

- [ ] Retry decisions append structured events.
- [ ] `sdlc_trace` shows retry history for a task.
- [ ] Pipeline status shows retryable vs exhausted failures.

## Test Plan

- [ ] Unit test retry event builder.
- [ ] Trace test verifies retry lines appear.
- [ ] Pipeline-state test verifies retry summary from events.

## Out Of Scope

- No dashboard UI.
- No retry scheduling delay in this issue.

## Prior Art / Pattern Notes

Use trace/event logging patterns as reference. Implement original SDLC-rstack events and renderers.

