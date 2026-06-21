<!-- owner: RStack developed by Richardson Gunde -->

# [BLE-6.2] Add context pressure warnings

## Summary

Warn when run artifacts, memory injection, or task packets exceed configured context pressure thresholds.

## Motivation

Long loop runs can degrade quality if they keep injecting large context. SDLC-rstack already has memory pruning and context hygiene instructions; backend events should expose pressure signals.

## Proposed Implementation

- Add configurable thresholds for:
  - builder prompt size
  - injected memory block size
  - artifact summary size
  - stage summary size
- When thresholds are exceeded, append:
  - `context_pressure_warning`
  - `memory_pruned`
  - `artifact_summary_truncated`
- Include warning counts in pipeline-state rollup.
- Keep warning behavior non-blocking unless a future policy makes it blocking.

## Acceptance Criteria

- [ ] Oversized memory injection emits `context_pressure_warning`.
- [ ] Oversized task packet emits warning before builder execution.
- [ ] Warnings are visible in trace and pipeline status JSON.

## Test Plan

- [ ] Unit tests for threshold classifier.
- [ ] Builder prompt fixture test for warning event.
- [ ] Pipeline-state test includes warning count.

## Out Of Scope

- No model tokenization dependency.
- No dashboard UI.

## Prior Art / Pattern Notes

Use context-window observability patterns as reference. Implement original SDLC-rstack warnings using approximate character/token signals already available in the harness.

