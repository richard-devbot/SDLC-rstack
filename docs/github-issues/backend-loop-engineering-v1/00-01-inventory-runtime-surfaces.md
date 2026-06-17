<!-- owner: RStack developed by Richardson Gunde -->

# [BLE-0.1] Inventory Pi tools, CLI commands, hooks, agents, skills, plugins, and prompts

## Summary

Add a backend inventory command that lists every runnable or reusable SDLC-rstack surface and writes a machine-readable report.

## Motivation

The package has Pi tools, Pi hooks, registered commands, CLI commands, SDLC agents, specialist agents, skills, plugins, and prompt command files. Before adding a loop runner or validator sandbox, the backend needs a complete inventory so enforcement and routing are not partial.

## Proposed Implementation

- Add `rstack-agents inventory` in `bin/rstack-agents.js`.
- Add a Node module such as `src/core/inventory/backend-inventory.js`.
- Scan package-local assets:
  - Pi tools and commands registered in `src/integrations/pi/rstack-sdlc.ts`.
  - Pi hooks registered with `pi.on(...)`.
  - CLI commands registered in `bin/rstack-agents.js`.
  - Agents under `agents/`.
  - Skills under `skills/**/SKILL.md`.
  - Plugins under `plugins/*/plugin.json`.
  - Prompt commands under `prompts/*.md`.
- Include project-local override roots:
  - `.rstack/agents`, `.pi/rstack/agents`
  - `.rstack/skills`, `.pi/rstack/skills`
  - `.rstack/plugins`, `.pi/rstack/plugins`
  - `.rstack/prompts`, `.pi/rstack/prompts`
- Write `.rstack/registry/backend-inventory.json` with:
  - `generated_at`
  - `package_root`
  - `project_root`
  - `counts`
  - `items[]` with `id`, `name`, `kind`, `source_path`, `runtime`, `domain`, `description`
- Preserve existing `rstack-agents list agents|skills|plugins`.

## Acceptance Criteria

- [ ] `rstack-agents inventory` prints a concise summary.
- [ ] `rstack-agents inventory --json` prints JSON.
- [ ] `.rstack/registry/backend-inventory.json` is created by default.
- [ ] The inventory includes Pi tools, Pi hooks, CLI commands, agents, skills, plugins, and prompts.
- [ ] The command works without starting Business Hub.

## Test Plan

- [ ] Unit test inventory scanners with fixture directories.
- [ ] CLI test verifies command output includes all expected top-level kinds.
- [ ] Regression test confirms `rstack-agents list` commands still work.

## Out Of Scope

- No dashboard UI.
- No runtime behavior changes.
- No GitHub issue creation from this command.

## Prior Art / Pattern Notes

Use control-plane cataloging as a pattern reference only. Implement original SDLC-rstack code using local registry and filesystem primitives.

