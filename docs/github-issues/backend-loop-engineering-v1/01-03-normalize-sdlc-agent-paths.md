<!-- owner: RStack developed by Richardson Gunde -->

# [BLE-1.3] Normalize SDLC markdown agents to harness paths

## Summary

Update reference SDLC markdown agents to prefer canonical harness paths and contracts while retaining legacy artifact compatibility.

## Motivation

The operating standard already says agents should use `.rstack/runs/<run_id>/` and write `builder.json`/`validation.json`. Many individual SDLC stage prompts still point to legacy `$RSTACK_RUN_DIR/artifacts/...` paths. This causes drift between the Pi harness and markdown-agent workflow.

## Proposed Implementation

- Update agents 00, 06, 07, 08, and 11 as reference implementations.
- Prefer canonical stage outputs:
  - `.rstack/runs/<run_id>/artifacts/stages/<stage-id>/<artifact>`
- Keep root artifacts as compatibility outputs only.
- Explicitly require task contracts:
  - `.rstack/runs/<run_id>/tasks/<task_id>/builder.json`
  - `.rstack/runs/<run_id>/tasks/<task_id>/validation.json` when validating
- Add compact examples for `builder.json` with `memory_summary` and `stage_summaries`.

## Acceptance Criteria

- [ ] Agents 00, 06, 07, 08, and 11 prefer canonical stage paths.
- [ ] Legacy paths are described as compatibility reads/writes only.
- [ ] Each updated agent points to builder contract output.
- [ ] `npm run validate` passes.

## Test Plan

- [ ] Agent frontmatter validation passes.
- [ ] Reference docs validation passes.
- [ ] Manual grep confirms no updated reference agent instructs canonical output only to legacy roots.

## Out Of Scope

- No full rewrite of all 15 agents in this issue.
- No runner implementation.

## Prior Art / Pattern Notes

Use artifact normalization as a workflow hygiene pattern. Implement original prompt updates based on SDLC-rstack's own `docs/HARNESS.md` and operating standard.

