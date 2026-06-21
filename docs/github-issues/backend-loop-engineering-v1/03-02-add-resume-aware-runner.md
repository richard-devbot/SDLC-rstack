<!-- owner: RStack developed by Richardson Gunde -->

# [BLE-3.2] Add resume-aware runner command

## Summary

Add `rstack-agents pipeline run` to advance a run from current harness state.

## Motivation

Manual command sequences work, but loop engineering needs a backend runner that can skip completed work, re-enter retryable work, and stop when human input is required.

## Proposed Implementation

- Add `rstack-agents pipeline run`.
- Options:
  - `--project <path>`
  - `--run-id <runId>`
  - `--max-steps <n>`
  - `--dry-run`
  - `--json`
- Use `pipeline-state` rollup to identify next work.
- Use retry policy to decide whether failed tasks are retryable.
- Do not invoke model-specific external agents in this first version unless supported by existing Pi bridge.
- Initial runner can prepare next backend action and update statuses; deeper automation can be added after safe adapters exist.
- Stop on:
  - pending approval
  - `ask_user`
  - blocked retry policy
  - missing contract
  - max steps

## Acceptance Criteria

- [ ] Runner skips tasks/stages that are already PASS/DONE.
- [ ] Runner re-enters retryable failed tasks.
- [ ] Runner stops and reports pending human gates.
- [ ] `--dry-run` shows what would happen without writing state.

## Test Plan

- [ ] Integration test with synthetic interrupted run.
- [ ] Integration test with failed validation and retryable state.
- [ ] CLI test for dry-run output.

## Out Of Scope

- No dashboard UI.
- No hidden model invocation.
- No shell-first runner.

## Prior Art / Pattern Notes

Use resume-aware workflow runners as a pattern reference. Implement original SDLC-rstack code using harness state, safe writes, and existing Pi/CLI bridges.

