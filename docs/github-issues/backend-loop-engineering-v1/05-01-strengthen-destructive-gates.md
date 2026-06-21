<!-- owner: RStack developed by Richardson Gunde -->

# [BLE-5.1] Strengthen destructive-action gate coverage

## Summary

Expand backend destructive-action gate coverage across shell commands, file writes, publish/deploy operations, force-push, and secret paths.

## Motivation

The Pi `tool_call` hook already blocks some destructive operations. Loop automation increases the chance of accidental risky actions, so coverage should be explicit, tested, and traceable.

## Proposed Implementation

- Centralize destructive-action classification in a harness safety module.
- Cover:
  - `rm -rf`, broad deletes, destructive cleanup
  - `git push --force`
  - package publishing
  - deploy/apply/destroy commands
  - writes to `.env`, secrets, credential paths, key files
  - protected config paths if applicable
- Require approval artifact:
  - `destructive-action`
  - or release-specific approval where appropriate
- Append `guardrail_triggered` event with reason and blocked action summary.

## Acceptance Criteria

- [ ] Denied destructive shell commands require approval.
- [ ] Denied protected writes require approval.
- [ ] Gate logic is unit-tested.
- [ ] Existing `RSTACK_ALLOW_DESTRUCTIVE=1` behavior is preserved and logged clearly.

## Test Plan

- [ ] Unit tests for destructive command classifier.
- [ ] Hook tests for blocked shell/write.
- [ ] Regression tests for safe commands.

## Out Of Scope

- No OS-level sandbox.
- No dashboard UI.

## Prior Art / Pattern Notes

Use guardrail tripwire concepts as reference. Implement original SDLC-rstack safety checks using existing approval and hook paths.

