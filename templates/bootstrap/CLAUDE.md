# RStack SDLC — Claude Code

<!-- owner: RStack developed by Richardson Gunde -->

This project uses **RStack** for governed software delivery. State lives in `.rstack/`.

## Governance

Follow **SOUL.md** for team roles, contracts, and evidence rules. Use **HEARTBEAT.md** only if you run periodic standby checks.

## Asset paths

RStack agents, skills, and plugins resolve from:

- **Package install (default):** `node_modules/rstack-agents/`
- **Local vendor copy (optional):** `.rstack/vendor/rstack/`

| Role | Path |
|---|---|
| Orchestrator | `agents/core/orchestrator.md` |
| Builder | `agents/core/builder.md` |
| Validator | `agents/core/validator.md` |
| SDLC pipeline | `agents/sdlc/` |
| Skills | `skills/` |
| Plugin packs | `plugins/` |

Read `.rstack/rstack.config.json` for the active profile, `enabled_domains`, and `enabled_plugins` before routing work.

## Commands

With the **sdlc-automation** plugin installed:

- `/sdlc-start` — start the full pipeline (interactive)
- `/sdlc-status` — completed vs pending agents
- `/sdlc-resume` — resume from a specific agent
- `/sdlc-agent <name>` — run one SDLC agent in isolation

Without the plugin, read `agents/core/orchestrator.md` and drive the lifecycle manually.

Additional usage notes: `.claude/rstack-sdlc.md`.

## Run state

Write all governed run artifacts under `.rstack/runs/<run_id>/`:

- `manifest.json`, `plan.md`, `tasks.json`, `approvals.json`
- `tasks/<task_id>/builder.json` and `validation.json`
- `events.jsonl`, `evidence.jsonl`

Require specs, approval gates, traceability, and command evidence. Never claim DONE without proof.

## Dashboard

```bash
npx rstack-agents hub
```

Opens the Business Hub on port 3008 — run timelines, approvals, routing proof, and budget visibility.

## Hooks (optional)

`init` may have written a SessionStart hook snippet at `.claude/rstack-hub-hook.json`. Merge it into `.claude/settings.json` **only if** you want the hub to open each session. RStack never overwrites your existing settings.

Disable auto-launch:

```bash
export RSTACK_NO_BUSINESS_HUB=1   # skip hub spawn entirely
export RSTACK_NO_BROWSER=1        # hub may start but no browser tab
export RSTACK_BUSINESS_PORT=3008  # change port if needed
```

## Selective teams

Narrow routing in `.rstack/rstack.config.json`:

```json
{
  "profile": "business-flex",
  "enabled_domains": ["product", "backend", "qa", "security", "docs"],
  "enabled_plugins": ["backend-development", "unit-testing", "security-scanning"]
}
```

Add a plugin locally: `npx rstack-agents add plugin <name>`

Browse the catalog: `npx rstack-agents list agents|skills|plugins`
