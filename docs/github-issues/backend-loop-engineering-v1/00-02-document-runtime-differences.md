<!-- owner: RStack developed by Richardson Gunde -->

# [BLE-0.2] Document runtime differences: Pi vs Claude Code vs CLI

## Summary

Document exactly how SDLC-rstack agents and commands run across Pi, Claude Code, and CLI runtimes.

## Motivation

Pi has native lifecycle tools and hooks. Claude Code gets portable assets and prompt commands, but not Pi hook enforcement. CLI commands expose package management, validation, readiness, and hub startup. The backend roadmap depends on these differences being explicit.

## Proposed Implementation

- Add or update backend runtime documentation in `docs/public/` and `docs/mintlify/adapters/`.
- Include a runtime matrix:
  - Pi native tools
  - Pi hooks
  - Pi registered commands
  - Claude Code portable agents
  - Claude Code prompt/slash command files
  - CLI commands
  - Business Hub local server
- Document how to invoke:
  - 15 SDLC stage agents
  - core orchestrator/builder/validator agents
  - specialist agents
  - skills
  - plugin packs
  - prompt commands
  - `rstack-agents` CLI commands
- Document which runtime can enforce destructive-action gates.

## Acceptance Criteria

- [ ] Docs clearly say Pi is the only current runtime with lifecycle hooks.
- [ ] Docs clearly say Claude Code can use assets but does not get Pi `tool_call` gating.
- [ ] Docs list available CLI command groups and their backend purpose.
- [ ] Docs map the 15-stage agent roadmap to actual file paths.

## Test Plan

- [ ] `npm run validate` passes.
- [ ] Link/reference validation passes for new docs.

## Out Of Scope

- No UI changes.
- No new runtime adapter implementation.

## Prior Art / Pattern Notes

Use runtime documentation patterns from agent frameworks only as inspiration. Implement original SDLC-rstack documentation grounded in actual local files and commands.

