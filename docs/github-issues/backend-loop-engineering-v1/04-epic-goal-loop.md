<!-- owner: RStack developed by Richardson Gunde -->

# [Epic] Backend Loop Engineering 4 - Goal Loop

## Summary

Add a bounded goal loop so the pipeline stops only when a structured success condition passes or a human/blocking condition is reached.

## Motivation

The SDLC pipeline currently completes when tasks finish. Loop engineering needs a deterministic goal evaluator, structured Agent 11 output, and bounded rerun behavior.

## Issues

- [ ] BLE-4.1 Add goal evaluator.
- [ ] BLE-4.2 Update Agent 11 goal contract.
- [ ] BLE-4.3 Add bounded loop runner.

## Acceptance Criteria

- [ ] Goal evaluator returns `PASS`, `RETRY`, `ASK_USER`, or `BLOCK`.
- [ ] Agent 11 writes structured `goal_evaluation`.
- [ ] Loop runner cannot run indefinitely.

## Prior Art / Pattern Notes

Use bounded goal-loop and evaluator patterns as references. Implement original SDLC-rstack code using Agent 11 artifacts, validation state, and harness events.

