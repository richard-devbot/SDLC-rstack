<!-- owner: RStack developed by Richardson Gunde -->

# [BLE-6.3] Tighten memory write policy

## Summary

Ensure trusted memory is validator-approved by default and cannot override current task rules, approvals, or validator gates.

## Motivation

Memory is useful only if it is trustworthy and bounded. Loop runs should not reinforce failed or unsafe behavior unless explicitly configured to store validation attempts as untrusted memory.

## Proposed Implementation

- Keep default `writePolicy: "validator-approved-only"`.
- Ensure `appendEpisode` marks only PASS validations as trusted by default.
- If config allows validation attempts, failed episodes must be `trusted: false`.
- Add validation checks for:
  - signature verification
  - evidence paths present
  - quality score range
  - retraction filtering
- Add events for memory write decisions:
  - `episode_memory_written`
  - `episode_memory_skipped_untrusted`
  - `episode_memory_write_failed`
- Update docs to state memory is historical context only.

## Acceptance Criteria

- [ ] Failed validations are not trusted by default.
- [ ] Untrusted memories are not injected unless explicitly requested.
- [ ] Memory formatting continues to state that current task rules override memory.
- [ ] Tampered signed episodes are ignored.

## Test Plan

- [ ] Unit tests for trusted/untrusted memory writes.
- [ ] Existing memory signature tests pass.
- [ ] Recall tests confirm untrusted memories are skipped by default.

## Out Of Scope

- No vector database integration.
- No dashboard UI.

## Prior Art / Pattern Notes

Use memory trust and evidence-gated learning patterns as reference. Implement original SDLC-rstack policy with existing memory signatures, validation status, and pruning logic.

