<!-- owner: RStack developed by Richardson Gunde -->

# [BLE-5.3] Add approval audit consistency checks

## Summary

Add consistency checks so malformed approval records cannot unblock stages.

## Motivation

Approvals are security-sensitive. Existing code validates safe run ids and requires signed dashboard approval when enabled. Loop automation should also verify approval records are internally consistent before they unblock work.

## Proposed Implementation

- Add approval audit validation helper.
- Validate:
  - safe run id
  - artifact name is safe
  - status is approved/rejected or APPROVED/REJECTED depending path
  - actor/approver exists
  - timestamp is valid
  - token evidence when dashboard approval is used
  - run directory has manifest
- Use validation before `missingApprovals` or equivalent gate decisions treat approval as valid.
- Append audit event for ignored malformed approvals.

## Acceptance Criteria

- [ ] Malformed approval records do not unblock a task.
- [ ] Invalid approval records are logged without crashing status commands.
- [ ] Existing valid approval flow still works.

## Test Plan

- [ ] Unit tests for valid/invalid approval records.
- [ ] Regression tests for path traversal ids.
- [ ] Integration test for malformed approval ignored by gate.

## Out Of Scope

- No dashboard UI.
- No external identity provider integration.

## Prior Art / Pattern Notes

Use approval audit and human-interrupt patterns as reference. Implement original SDLC-rstack consistency checks with existing approval primitives.

