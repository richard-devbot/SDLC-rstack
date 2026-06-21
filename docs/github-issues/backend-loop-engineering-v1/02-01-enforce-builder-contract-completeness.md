<!-- owner: RStack developed by Richardson Gunde -->

# [BLE-2.1] Enforce builder contract completeness

## Summary

Strengthen builder contract validation so passing work must include evidence, tests, risks, next steps, memory summaries, and stage summaries.

## Motivation

Current builder contract validation checks required fields and some v2 telemetry shape. For loop engineering, a PASS needs enough structure for validators, retries, memory, traceability, and later agents.

## Proposed Implementation

- Extend contract validation or `sdlc_validate` hardening checks.
- For `PASS` and `DONE_WITH_CONCERNS`, require:
  - non-empty `summary`
  - `tests_run` with evidence or explicit "not run" reason
  - `memory_summary.work_done`
  - `memory_summary.evidence[]`
  - `stage_summaries[]` for each canonical stage target in the task packet
  - `stage_summaries[].evidence[]`
- Keep `BLOCKED` and `FAIL` valid, but never passing.
- Add actionable validator issues when fields are missing.

## Acceptance Criteria

- [ ] `sdlc_validate` fails PASS builders missing required evidence summaries.
- [ ] Failure includes `retry_recommendation: "retry_builder"` unless human context is required.
- [ ] Existing minimal contract tests are updated intentionally.
- [ ] Builder status mapping remains backward compatible.

## Test Plan

- [ ] Unit tests for complete PASS contract.
- [ ] Unit tests for missing memory summary.
- [ ] Unit tests for missing stage summaries.
- [ ] Unit tests for BLOCKED contract producing non-pass validation.

## Out Of Scope

- No new validator agents.
- No retry runner.

## Prior Art / Pattern Notes

Use structured task contract patterns as reference. Implement original SDLC-rstack validation code using existing contract and hardening checks.

