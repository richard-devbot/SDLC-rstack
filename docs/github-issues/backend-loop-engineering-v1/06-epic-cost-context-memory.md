<!-- owner: RStack developed by Richardson Gunde -->

# [Epic] Backend Loop Engineering 6 - Cost, Context, Memory

## Summary

Keep loop runs bounded and auditable by recording cost/context data and tightening memory trust rules.

## Motivation

Looping can amplify cost, context pressure, and stale-memory risk. The harness already has v2 cost/context fields and validator-approved episodic memory. These need to feed metrics and loop decisions consistently.

## Issues

- [ ] BLE-6.1 Populate cost/context fields from builder contracts.
- [ ] BLE-6.2 Add context pressure warnings.
- [ ] BLE-6.3 Tighten memory write policy.

## Acceptance Criteria

- [ ] Metrics and pipeline rollup include cost/context totals.
- [ ] Context pressure emits traceable warnings.
- [ ] Trusted memory remains validator-approved by default.

## Prior Art / Pattern Notes

Use cost/context observability and memory trust patterns as references. Implement original SDLC-rstack code using existing metrics and memory modules.

