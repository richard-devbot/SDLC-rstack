# RStack on Pi

<!-- owner: RStack developed by Richardson Gunde -->

Pi is RStack's native host: the adapter is a first-class Pi extension,
declared in the package's `pi.extensions`, so Pi loads it automatically.

## Setup (under 2 minutes)

```bash
cd your-project
npm install rstack-agents
npx rstack-agents init --framework pi
```

That's it. The next Pi session in this project has every `sdlc_*` tool.

## Verify

```bash
npx rstack-agents doctor --framework pi
```

All-PASS means the extension is discoverable, the guard self-test blocked a
destructive command, and the hub is reachable. Every failure prints its fix.

## What you get

| Tool | Purpose |
|---|---|
| `sdlc_orchestrate` | Load orchestrator, builder, and validator operating instructions |
| `sdlc_start` | Create a governed run (15 canonical stages, approval gates) |
| `sdlc_clarify` | Capture product-owner answers before planning |
| `sdlc_decisions` / `sdlc_decide` | Track and resolve human decisions that block later stages |
| `sdlc_dor_check` | Run the Definition-of-Ready gate for a target stage |
| `sdlc_plan` | Bootstrap specs, tasks, and the agent registry |
| `sdlc_agents` / `sdlc_delegate` | Inspect available specialists and spawn bounded workers |
| `sdlc_build_next` | Prepare the next task for a builder agent |
| `sdlc_validate` | Validate the builder contract, emit evidence + stage events |
| `sdlc_approve` | Record human approval gates |
| `sdlc_memory` | Search or append validator-approved learnings |
| `sdlc_status` / `sdlc_trace` | Run state and traceability |
| `sdlc_rollback` | Restore a stage from its checkpoint |
| `sdlc_dashboard` | Open the Business Hub |

Slash commands: `/sdlc`, `/sdlc-agents`, `/sdlc-dashboard`, `/sdlc-trace`,
`/sdlc-rollback`, plus underscore aliases for dashboard, trace, and rollback.

## Worker delegation

`sdlc_delegate` spawns builder agents with a Pi-compatible CLI. Configure via
`RSTACK_WORKER_COMMAND`, `RSTACK_DEFAULT_MODEL`, `RSTACK_ESCALATED_MODEL`.

## Everyday commands

Inside a Pi session you drive RStack with the `sdlc_*` tools and `/sdlc*`
slash commands above. From your terminal, the harness-agnostic CLI works too —
`pipeline status`, `pipeline run`, `pipeline loop`, `adopt`, `decisions`,
`dor`, `doctor`, and `npx rstack-business`. See the full table in
[README.md → Everyday commands](README.md#everyday-commands-any-framework).
