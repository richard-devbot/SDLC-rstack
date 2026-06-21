<!-- owner: RStack developed by Richardson Gunde -->

# [BLE-1.1] Add Node-native `pipeline-state` rollup

## Summary

Add `src/core/harness/pipeline-state.js` to generate and persist a pipeline status rollup from existing harness run files.

## Motivation

The run directory already contains the authoritative data. A loop runner needs a compact stage/task status view, but that view must be derived from the harness rather than becoming a second ledger.

## Proposed Implementation

- Add `src/core/harness/pipeline-state.js`.
- Export functions such as:
  - `buildPipelineState(projectRoot, runId)`
  - `writePipelineState(projectRoot, runId)`
  - `readPipelineState(projectRoot, runId, { regenerateIfMissing })`
  - `summarizePipelineState(state)`
- Read:
  - `.rstack/runs/<run_id>/manifest.json`
  - `tasks.json`
  - `events.jsonl`
  - `metrics.json`
  - `evidence.jsonl`
  - `approvals.json`
  - canonical stage artifact directories
- Include:
  - run metadata
  - pipeline status
  - current task/stage
  - stages with status, attempts, task ids, validation status, evidence paths
  - retries and guardrail events
  - approval blockers
  - cost/context totals where available
- Write with `withFileLock` and `writeJsonAtomic`.

## Acceptance Criteria

- [ ] `pipeline-state.json` lives under `.rstack/runs/<run_id>/`.
- [ ] Deleting `pipeline-state.json` and regenerating produces equivalent status from harness files.
- [ ] Stage IDs come from `CANONICAL_SDLC_STAGES`.
- [ ] The module does not require shell scripts.

## Test Plan

- [ ] Unit test from synthetic run directory.
- [ ] Test missing files gracefully produce pending/unknown fields.
- [ ] Test events drive attempts and retry summary.
- [ ] Test atomic write path.

## Out Of Scope

- No dashboard UI.
- No actual runner behavior.
- No shell helper as the primary implementation.

## Prior Art / Pattern Notes

Use durable state rollup concepts from workflow engines as a reference. Implement original SDLC-rstack code using existing harness state files.

