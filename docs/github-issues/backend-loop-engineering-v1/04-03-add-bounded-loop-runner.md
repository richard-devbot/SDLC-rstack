<!-- owner: RStack developed by Richardson Gunde -->

# [BLE-4.3] Add bounded loop runner

## Summary

Add a backend loop runner that evaluates the goal after each pass and reruns only selected stages within a bounded iteration count.

## Motivation

Looping must be safe. The backend should not blindly rerun the full pipeline or continue indefinitely. It should use structured goal output and retry policy to decide the next pass.

## Proposed Implementation

- Extend `rstack-agents pipeline run` or add `rstack-agents pipeline loop`.
- Default `max_iterations` to 3.
- Evaluate goal using `goal-check.js`.
- If `PASS`, mark loop complete.
- If `RETRY`, reset only `recommended_rerun_stages` or failing stages.
- If `ASK_USER`, stop and report required decision.
- If `BLOCK`, stop and report blocking issues.
- Append events:
  - `loop_iteration_started`
  - `goal_evaluated`
  - `loop_iteration_retrying_stages`
  - `loop_completed`
  - `loop_blocked`

## Acceptance Criteria

- [ ] Loop runner never exceeds configured max iterations.
- [ ] Loop reruns only failing/recommended stages.
- [ ] Loop stops on human decision requirement.
- [ ] Loop events are visible in trace/status.

## Test Plan

- [ ] Unit tests for loop decision planning.
- [ ] Integration fixture for retry then pass.
- [ ] Integration fixture for max-iteration exhaustion.

## Out Of Scope

- No dashboard UI.
- No unbounded autonomous execution.

## Prior Art / Pattern Notes

Use bounded autonomous loop concepts as reference. Implement original SDLC-rstack loop logic using goal-check, retry-policy, and harness events.

