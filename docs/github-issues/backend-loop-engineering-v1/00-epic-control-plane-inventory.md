<!-- owner: RStack developed by Richardson Gunde -->

# [Epic] Backend Loop Engineering 0 - Control Plane Inventory

## Summary

Make every runnable backend surface visible before changing behavior. This covers Pi tools, Pi hooks, CLI commands, slash-command-style prompts, lifecycle agents, specialist agents, skills, plugins, and runtime availability by host.

## Motivation

SDLC-rstack already ships a large backend surface: Pi-native lifecycle tools, hook enforcement, CLI commands, markdown agents, prompt commands, skills, and plugin packs. Loop engineering work must start with a reliable inventory so later state, retry, validation, and sandbox changes do not miss hidden entrypoints.

## Proposed Implementation

- Add a backend inventory command that reads package-local and project-local assets.
- Record each item with kind, id/name, source path, runtime availability, domain tags where available, and whether it is Pi-native, CLI-native, prompt-based, or portable asset-only.
- Generate a registry report under `.rstack/registry/` and print a concise terminal summary.
- Document runtime differences across Pi, Claude Code, and CLI so users know exactly how each agent or command can be invoked.

## Issues

- [ ] BLE-0.1 Inventory Pi tools, CLI commands, hooks, agents, skills, plugins, and prompts.
- [ ] BLE-0.2 Document runtime differences: Pi vs Claude Code vs CLI.

## Acceptance Criteria

- [ ] `rstack-agents inventory` prints counts for tools, commands, hooks, agents, skills, plugins, and prompts.
- [ ] `.rstack/registry/backend-inventory.json` is generated without requiring the dashboard.
- [ ] Documentation explains Pi-native lifecycle tools, Claude Code portable assets, and CLI commands.
- [ ] Existing `rstack-agents list` behavior remains compatible.

## Prior Art / Pattern Notes

Use external systems only as pattern references for runtime cataloging and control-plane clarity. Implement original SDLC-rstack code using existing harness, registry, and package asset primitives.

