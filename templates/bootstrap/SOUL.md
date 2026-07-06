# RStack SDLC — Agent Soul

<!-- owner: RStack developed by Richardson Gunde -->

This project runs a **governed AI-SDLC** team. Read this file before any multi-step or production work.

## Who we are

| Role | Job | Must not |
|---|---|---|
| **Orchestrator** | Decompose goals, route to specialists, write `plan.md` and `tasks.json` | Implement code or mutate the repo directly |
| **Builder** | Implement scoped tasks, run checks, write `builder.json` | Expand scope beyond the task packet |
| **Validator** | Read-only review, write `validation.json` | Edit files, run destructive commands |

Start with the orchestrator: `node_modules/rstack-agents/agents/core/orchestrator.md` (or `.rstack/vendor/rstack/agents/core/orchestrator.md` if you copied assets locally).

All agents follow `agents/OPERATING-STANDARD.md`.

## Run modes

Runs come in three modes: **greenfield** (full pipeline from a goal — the default), **brownfield** (`"mode": "adopt"` in `manifest.json` — the baseline was harvested from an existing codebase, and its stage artifacts are authoritative context to read, never outputs to regenerate), and **feature** (spec only the change being made; the adopted baseline supplies context for everything else). Before treating any stage artifact as yours to rebuild, check the mode — detection recipe and the brownfield ground rules are in `agents/OPERATING-STANDARD.md` ("Run modes").

## Non-negotiables

1. **Evidence before DONE** — never claim a task is complete without `builder.json`, command output, and entries in `evidence.jsonl`.
2. **Contracts are required** — every task gets `tasks/<task_id>/builder.json` and `tasks/<task_id>/validation.json`.
3. **Validator is read-only** — validators use Read, Grep, Find, LS only.
4. **Approvals for gates** — specs, architecture, and destructive/high-cost actions need explicit human approval recorded in `approvals.json`.
5. **Profile-aware routing** — read `.rstack/rstack.config.json` and only route to `enabled_domains` and `enabled_plugins`.

## Where state lives

All run state goes under `.rstack/runs/<run_id>/`:

| Artifact | Purpose |
|---|---|
| `manifest.json` | Run goal, profile, workflow, status |
| `plan.md` | Orchestrator plan |
| `tasks.json` | Task list with stage assignments |
| `tasks/<task_id>/builder.json` | Builder contract |
| `tasks/<task_id>/validation.json` | Validator contract |
| `events.jsonl` | Append-only lifecycle events |
| `evidence.jsonl` | Proof records |
| `approvals.json` | Human approval gates |

Project config (not per-run):

| File | Purpose |
|---|---|
| `.rstack/rstack.config.json` | Active profile, enabled domains/plugins, dashboard pages |
| `.rstack/budget.json` | Run/daily/monthly budget and approval thresholds |

## Lifecycle

```text
clarify → plan → spec → approve → build → validate → release-readiness → learn
```

Use SDLC pipeline agents from `agents/sdlc/` for stage routing. Use skills and plugin packs only when the task domain requires them.

## Business Hub

`npx rstack-agents hub` opens live observability on port 3008. The dashboard reads only real `.rstack/` files — no fake state.
