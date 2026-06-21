<!-- owner: RStack developed by Richardson Gunde -->

# [BLE-4.1] Add goal evaluator

## Summary

Add `src/core/harness/goal-check.js` to evaluate whether a run has met its declared success condition.

## Motivation

A pipeline should not claim completion based only on finishing tasks. It should check validation status, feedback-loop consistency, critical issues, pending approvals, and human blockers.

## Proposed Implementation

- Add `src/core/harness/goal-check.js`.
- Export:
  - `evaluateGoal(projectRoot, runId, options)`
  - `readGoalEvidence(runDir)`
  - `summarizeGoalDecision(evaluation)`
- Inputs:
  - pipeline-state rollup
  - Agent 11 feedback artifact
  - validation contracts
  - pending approvals
  - guardrail events
- Return:
  - `status`: `PASS`, `RETRY`, `ASK_USER`, `BLOCK`
  - `score`
  - `critical_count`
  - `failing_stages`
  - `recommended_rerun_stages`
  - `reason`
- Use deterministic JSON fields first; do not parse prose unless no structured data exists.

## Acceptance Criteria

- [ ] Goal evaluator works on synthetic run artifacts.
- [ ] Pending human decision returns `ASK_USER`.
- [ ] Critical issue returns `BLOCK` or `RETRY` based on Agent 11 recommendation.
- [ ] All validations passing and goal threshold met returns `PASS`.

## Test Plan

- [ ] Unit tests for PASS, RETRY, ASK_USER, BLOCK.
- [ ] Test missing Agent 11 artifact produces clear non-pass result.
- [ ] Test evaluator does not require dashboard.

## Out Of Scope

- No loop runner in this issue.
- No model-based evaluator.

## Prior Art / Pattern Notes

Use goal-check/evaluator patterns as reference. Implement original deterministic SDLC-rstack evaluation code.

