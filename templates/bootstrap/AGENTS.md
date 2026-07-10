# RStack SDLC

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
| Orchestrator | `agents/core/orchestrator.md` — read this first |
| Builder | `agents/core/builder.md` — implementation tasks |
| Validator | `agents/core/validator.md` — read-only verification |
| SDLC pipeline | `agents/sdlc/` — lifecycle stage routing |
| Skills | `skills/` — workflow helpers |
| Plugin packs | `plugins/` — domain specialist packs |

Read `.rstack/rstack.config.json` for the active profile, `enabled_domains`, and `enabled_plugins` before routing work.

## Run state

Write all governed run artifacts under `.rstack/runs/<run_id>/`:

- `manifest.json`, `plan.md`, `tasks.json`, `approvals.json`
- `tasks/<task_id>/builder.json` and `validation.json`
- `events.jsonl`, `evidence.jsonl`

Require specs, approval gates, traceability, builder contracts, validation contracts, and command evidence. Never claim DONE without proof.

## Node bridge (custom harness)

Any tool can call the governed harness via shell:

```bash
RSTACK_PROJECT_ROOT="$(pwd)" \
  npx tsx node_modules/rstack-agents/bin/rstack-bridge.ts <tool_name> '<json-params>'
```

Tools include: `sdlc_start`, `sdlc_clarify`, `sdlc_plan`, `sdlc_approve`, `sdlc_build_next`, `sdlc_validate`, `sdlc_status`, `sdlc_trace`, `sdlc_rollback`. Run with no arguments to list all.

## Dashboard

```bash
npx rstack-agents hub
```

Opens the Business Hub on port 3008.

Disable auto-launch: `RSTACK_NO_BUSINESS_HUB=1`

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

## Skill routing

Route skills and plugin packs based on `.rstack/rstack.config.json`:

| Config key | Use for |
|---|---|
| `enabled_domains` | Which specialist domains the orchestrator may assign |
| `enabled_plugins` | Which plugin packs to prefer for domain tasks |
| `enabled_agents` | Named agents prioritized during planning |
| `business_stage_order` | Stage sequence for this project's workflow |

Only invoke skills from enabled plugins or the top-level `skills/` catalog when the task domain matches. Do not load the entire catalog into context — pick the smallest relevant set.

Project-local overrides in `.rstack/skills/` and `.rstack/plugins/` take precedence over package defaults.
