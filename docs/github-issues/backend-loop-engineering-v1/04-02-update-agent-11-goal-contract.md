<!-- owner: RStack developed by Richardson Gunde -->

# [BLE-4.2] Update Agent 11 goal contract

## Summary

Update Agent 11 feedback-loop output to include a structured `goal_evaluation` object.

## Motivation

Goal evaluation should not depend on prose parsing. Agent 11 already performs cross-contract consistency checks; it should emit machine-readable goal status for the backend loop.

## Proposed Implementation

- Update `agents/sdlc/11-feedback-loop.md`.
- Require output artifact to include:
  - `goal_evaluation.status`
  - `goal_evaluation.consistency_score`
  - `goal_evaluation.critical_count`
  - `goal_evaluation.failing_stages[]`
  - `goal_evaluation.recommended_rerun_stages[]`
  - `goal_evaluation.requires_human_decision`
  - `goal_evaluation.reason`
- Status values:
  - `PASS`
  - `RETRY`
  - `ASK_USER`
  - `BLOCK`
- Keep existing readable reports.

## Acceptance Criteria

- [ ] Agent 11 prompt requires structured `goal_evaluation`.
- [ ] Goal evaluator can use Agent 11 artifact without prose parsing.
- [ ] `npm run validate` passes.

## Test Plan

- [ ] Agent validation passes.
- [ ] Fixture-based goal evaluator test reads Agent 11 output.

## Out Of Scope

- No dashboard UI.
- No change to all feedback report fields unless required for goal evaluation.

## Prior Art / Pattern Notes

Use structured evaluator output as a pattern reference. Implement original Agent 11 contract updates consistent with SDLC-rstack artifacts.

