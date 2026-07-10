<!-- owner: RStack developed by Richardson Gunde -->

# [Epic] Backend Loop Engineering 1 - Harness State Spine

## Summary

Create one durable backend state model for loop execution. `pipeline-state.json` should be a regenerable rollup over the harness run directory, not a competing source of truth.

## Motivation

The existing harness already has `manifest.json`, `tasks.json`, `events.jsonl`, `metrics.json`, `evidence.jsonl`, approvals, checkpoints, and canonical stage artifacts. Loop engineering should unify these into a readable status spine without inventing a parallel shell-first ledger.

## Proposed Implementation

- Add a Node-native pipeline-state module under `src/core/harness/`.
- Add CLI status commands under `rstack-agents pipeline`.
- Normalize reference SDLC markdown agents to canonical stage artifact paths and harness task contracts.

## Issues

- [ ] BLE-1.1 Add Node-native `pipeline-state` rollup.
- [ ] BLE-1.2 Add `rstack-agents pipeline status`.
- [ ] BLE-1.3 Normalize SDLC markdown agents to harness paths.

## Acceptance Criteria

- [ ] Missing `pipeline-state.json` can be regenerated from harness files.
- [ ] Pipeline status works without Business Hub.
- [ ] Reference SDLC agents prefer `.rstack/runs/<run_id>/artifacts/stages/<stage>/`.

## Prior Art / Pattern Notes

Use durable execution ledgers and workflow status rollups as pattern references. Implement original SDLC-rstack code on top of existing run-state, safe-write, evidence, and stage primitives.

