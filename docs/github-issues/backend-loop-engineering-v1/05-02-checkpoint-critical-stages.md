<!-- owner: RStack developed by Richardson Gunde -->

# [BLE-5.2] Checkpoint before and after critical stages

## Summary

Ensure critical stages create reliable checkpoints that can be restored by `sdlc_rollback`.

## Motivation

Loop retries can mutate stage artifacts. Critical stages need restore points before and after meaningful changes so rollback is not best-effort only.

## Proposed Implementation

- Define critical stages:
  - `06-architecture`
  - `07-code`
  - `08-testing`
  - `09-deployment`
  - `12-security-threat-model`
- Add pre-stage checkpoint event when a critical stage starts.
- Keep post-stage checkpoint after successful validation.
- Verify checkpoint directory exists before claiming rollback support.
- Add trace events:
  - `stage_checkpoint_before_saved`
  - `stage_checkpoint_after_saved`
  - `stage_checkpoint_reverted`

## Acceptance Criteria

- [ ] Critical stages have checkpoint events before and after successful execution.
- [ ] `sdlc_rollback` returns clear `NO_CHECKPOINT` or `SUCCESS`.
- [ ] Rollback never accepts non-canonical stage ids.

## Test Plan

- [ ] Unit tests for checkpoint naming and stage validation.
- [ ] Existing rollback tests still pass.
- [ ] Fixture test for critical-stage checkpoint lifecycle.

## Out Of Scope

- No git worktree isolation.
- No dashboard UI.

## Prior Art / Pattern Notes

Use checkpoint/resume patterns as reference. Implement original SDLC-rstack logic using existing `createStageCheckpoint` and `rollbackStage`.

