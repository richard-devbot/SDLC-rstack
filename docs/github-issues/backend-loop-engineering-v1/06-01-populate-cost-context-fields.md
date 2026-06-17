<!-- owner: RStack developed by Richardson Gunde -->

# [BLE-6.1] Populate cost/context fields from builder contracts

## Summary

Persist cost and context telemetry from builder contracts into `metrics.json`, pipeline-state rollup, and events.

## Motivation

The builder contract already supports structured `cost`, `context`, `execution`, and `routing` fields. Loop engineering needs these fields to become operational data rather than optional decoration.

## Proposed Implementation

- In `sdlc_validate` or a shared metrics helper, extract:
  - `cost.estimated_usd`
  - `cost.actual_usd`
  - `execution.tools_used`
  - context profile/workflow/source counts
  - optional token/context pressure fields if present
- Update `metrics.json` via `updateRunMetrics`.
- Append `cost_recorded` and `context_recorded` events.
- Include totals in pipeline-state rollup.

## Acceptance Criteria

- [ ] Valid builder cost fields update run metrics.
- [ ] Tool count can be derived from `execution.tools_used`.
- [ ] Pipeline status shows cost/context totals in JSON output.
- [ ] Invalid cost fields fail validation or are ignored with a validation issue.

## Test Plan

- [ ] Unit test metrics extraction from builder contract.
- [ ] Integration test validation updates metrics.
- [ ] Pipeline-state test includes cost/context totals.

## Out Of Scope

- No vendor billing API integration.
- No dashboard UI.

## Prior Art / Pattern Notes

Use cost/context telemetry patterns as reference. Implement original SDLC-rstack metrics extraction from existing builder contracts.

