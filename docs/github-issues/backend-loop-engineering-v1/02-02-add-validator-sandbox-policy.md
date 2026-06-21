<!-- owner: RStack developed by Richardson Gunde -->

# [BLE-2.2] Add validator sandbox policy

## Summary

Add a backend policy that marks validators as read-only and blocks mutation attempts during validator execution.

## Motivation

Validator agents should check work, not modify it. Prompts currently steer validators toward read-only behavior, but loop engineering needs technical enforcement where the runtime supports it.

## Proposed Implementation

- Add a validator sandbox policy module, for example `src/core/harness/validator-sandbox.js`.
- Define denied actions:
  - write/edit tools
  - destructive shell commands
  - deploy/publish/force-push
  - writes to protected secret paths
- In Pi `tool_call` hook, detect active validator context and block denied actions.
- Add event types:
  - `validator_sandbox_denied`
  - `validator_sandbox_allowed_read`
- Ensure `sdlc_delegate` defaults validator/reviewer/security roles to read-only tools.
- Keep explicit human-approved exceptions out of scope unless a future issue defines them.

## Acceptance Criteria

- [ ] Validator context cannot write/edit files through Pi hooks.
- [ ] Denied validator mutation is logged to `events.jsonl`.
- [ ] Validator role delegated tasks default to read-only tool sets.
- [ ] Non-validator builders are not accidentally blocked by validator policy.

## Test Plan

- [ ] Unit tests for sandbox classifier.
- [ ] Hook-level test for denied write/edit in validator context.
- [ ] Regression test for destructive shell policy.

## Out Of Scope

- No container sandbox.
- No OS-level filesystem jail.
- No dashboard UI.

## Prior Art / Pattern Notes

Use read-only evaluator/sandbox separation as a pattern reference. Implement original SDLC-rstack policy using Pi hooks and existing destructive-action checks.

