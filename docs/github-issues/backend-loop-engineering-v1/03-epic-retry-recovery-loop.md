<!-- owner: RStack developed by Richardson Gunde -->

# [Epic] Backend Loop Engineering 3 - Retry + Recovery Loop

## Summary

Turn failed validation into deterministic retry or escalation behavior.

## Motivation

The contract already has `retry_recommendation`, and guardrails define `maxTaskAttempts`. The missing piece is runtime logic that translates validation results into task transitions, event traces, and resume-aware execution.

## Issues

- [ ] BLE-3.1 Add retry policy module.
- [ ] BLE-3.2 Add resume-aware runner command.
- [ ] BLE-3.3 Add retry event trace.

## Acceptance Criteria

- [ ] Failed validation moves tasks into retryable, human-needed, or blocked states.
- [ ] Runner resumes from harness state.
- [ ] Trace shows retry history and reason.

## Prior Art / Pattern Notes

Use bounded retry and durable execution semantics as pattern references. Implement original SDLC-rstack code using existing contracts, guardrails, events, and safe writes.

