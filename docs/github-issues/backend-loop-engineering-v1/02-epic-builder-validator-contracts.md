<!-- owner: RStack developed by Richardson Gunde -->

# [Epic] Backend Loop Engineering 2 - Builder / Validator Contracts

## Summary

Make every unit of work machine-checkable and make validator behavior enforceable.

## Motivation

The harness already validates basic builder and validator contracts. Loop engineering requires stricter completeness checks, a validator sandbox policy, and stage-specific validator routing so retry decisions are grounded in structured evidence.

## Issues

- [ ] BLE-2.1 Enforce builder contract completeness.
- [ ] BLE-2.2 Add validator sandbox policy.
- [ ] BLE-2.3 Add validator registry.

## Acceptance Criteria

- [ ] Builders cannot pass without evidence-backed summaries and verification.
- [ ] Validator attempts to mutate state are denied and logged.
- [ ] Critical stages can select appropriate validators.

## Prior Art / Pattern Notes

Use maker/checker validation as a pattern reference. Implement original SDLC-rstack code using existing contract validators, Pi hooks, and registry primitives.

