<!-- owner: RStack developed by Richardson Gunde -->

# Backend Loop Engineering Epic 0: Control Plane Inventory

Epic 0 makes every runnable backend surface visible before changing harness behavior. It is intentionally backend-first and keeps dashboard UI work out of scope.

## Goal

Create a reliable control-plane inventory for SDLC-rstack so future harness, validator, retry, memory, and checkpoint work starts from known runtime surfaces instead of assumptions.

## Scope

Epic 0 covers:

- Package agents under `agents/**/*.md`.
- Package skills under `skills/**/SKILL.md`.
- Package plugins under `plugins/*/plugin.json`.
- Plugin-provided agents and command prompts.
- Package prompts under `prompts/*.md`.
- Pi extension tools, hooks, and commands from `src/integrations/pi/rstack-sdlc.ts`.
- CLI commands from `bin/rstack-agents.js`.
- Project-local RStack assets under `.rstack/` when present.

Epic 0 does not change pipeline execution semantics, retry policy, validator behavior, approval rules, memory trust, checkpoints, or the dashboard.

## Issue Map

| Issue | Purpose | Expected output |
| --- | --- | --- |
| #109 | Epic tracker for Backend Control Plane Inventory | This coordination doc and PR tracking |
| #110 | Inventory Pi tools, CLI commands, hooks, agents, skills, plugins, prompts | `rstack-agents inventory` and `.rstack/registry/backend-inventory.json` |
| #111 | Document runtime differences: Pi vs Claude Code vs CLI | Runtime invocation docs for agents, skills, plugins, hooks, tools, and commands |

## Acceptance Checklist

- The package can generate a registry report without running the dashboard.
- The registry report includes counts, kind, source path, domain, command name, and runtime availability.
- Backend docs explain the invocation difference between Pi native tools, Claude Code portable assets, and framework-neutral CLI commands.
- The docs clearly state that Pi has hook-based tool-call gating while Claude Code portable assets do not.
- External projects are used only as implementation references. SDLC-rstack code remains original and uses existing MIT-licensed harness primitives.

## Next Epics

After Epic 0, backend loop engineering should proceed in this order:

1. Harness State Spine: regenerate pipeline state from existing run artifacts.
2. Builder/Validator Contracts: make every unit of work machine-checkable.
3. Retry and Recovery Loop: deterministic bounded retry from validation results.
4. Goal Loop: stop only when declared success criteria pass or human input is required.
5. Guardrails, Approvals, Checkpoints: make safety enforceable in backend state.
6. Cost, Context, Memory: keep loop runs bounded and auditable.
