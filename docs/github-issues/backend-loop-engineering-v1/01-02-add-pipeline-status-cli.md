<!-- owner: RStack developed by Richardson Gunde -->

# [BLE-1.2] Add `rstack-agents pipeline status`

## Summary

Add a backend CLI command that shows the current pipeline state without opening the dashboard.

## Motivation

Loop engineering must be usable from terminal, CI, and automation. Status cannot be hidden behind Business Hub UI.

## Proposed Implementation

- Add a `pipeline` command group in `bin/rstack-agents.js`.
- Add `rstack-agents pipeline status`.
- Options:
  - `--project <path>`
  - `--run-id <runId>`
  - `--json`
  - `--regenerate`
- Use the pipeline-state module from BLE-1.1.
- Show:
  - run id, goal, manifest status
  - pipeline status
  - current stage/task
  - completed/failed/pending stage counts
  - retryable failures
  - pending approvals
  - guardrail hits
  - next recommended backend action

## Acceptance Criteria

- [ ] Command works without Business Hub.
- [ ] Command can target latest run or a specific run id.
- [ ] `--json` returns machine-readable state.
- [ ] Missing rollup is regenerated when `--regenerate` is passed.

## Test Plan

- [ ] CLI test for text output.
- [ ] CLI test for JSON output.
- [ ] Regression test for invalid run id handling.

## Out Of Scope

- No `pipeline run` behavior in this issue.
- No dashboard display.

## Prior Art / Pattern Notes

Use status commands from workflow engines as a pattern reference. Implement original CLI code using SDLC-rstack harness modules.

