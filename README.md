# RStack SDLC

<!-- owner: RStack developed by Richardson Gunde -->

**A governed AI-SDLC operating layer for any coding framework.**
RStack sits on top of Pi, Claude Code, Operator, Codex-style CLIs, Gemini-style CLIs, or a custom harness and gives agent teams a repeatable lifecycle with approvals, builder/validator contracts, evidence, memory, budget envelopes, and a live Business Hub.

```text
clarify → plan → spec → approve → build → validate → release-readiness → learn
```

## Install — one npm package, any framework

```bash
cd your-project
npm install rstack-agents
npx rstack-agents init --profile business-flex
```

`init` auto-detects `pi | claude-code | operator | custom`, creates `.rstack/`, registers the project with the Business Hub, writes framework glue, and never overwrites existing files.

Use a smaller or larger business profile when needed:

```bash
npx rstack-agents init --profile lean-mvp
npx rstack-agents init --profile enterprise-webapp
```

| Profile | Best for | Result |
|---|---|---|
| `business-flex` | Most business/product teams | Product, backend, frontend, QA, security, devops, docs, budget policy, Business Flex dashboard |
| `lean-mvp` | Fast prototypes | Smaller full-stack team and lower budget defaults |
| `enterprise-webapp` | Heavier governance | Enterprise web app team with security/compliance/devops emphasis |

## Start your first governed run

From the host AI framework session:

```text
sdlc_start(goal="Upgrade this app, add required tests, improve docs, and run a security review")
sdlc_clarify()
sdlc_plan()
```

Approve gates, then build and validate:

```text
sdlc_approve(artifact="plan.md", status="APPROVED")
sdlc_approve(artifact="requirements.json", status="APPROVED")
sdlc_approve(artifact="architecture.md", status="APPROVED")
sdlc_build_next()
sdlc_validate()
```

## What `init` creates

```text
your-project/
├── .rstack/
│   ├── rstack.config.json   # active profile, enabled domains/plugins, dashboard pages
│   ├── budget.json          # run/daily/monthly budget, warnings, approval thresholds
│   ├── runs/                # every governed run lands here
│   ├── registry/            # agents, skills, plugins, routing metadata
│   └── policy.json          # optional approval policy you control
└── framework glue           # e.g. .claude/rstack-sdlc.md or Operator template
```

Every run records its manifest, plan, tasks, approvals, evidence, events, stage artifacts, builder contracts, validator contracts, and metrics under `.rstack/runs/<run-id>/`.

## Business Flex: install only the teams you need

RStack ships a large catalog, but business users should not have to use all of it. Profiles narrow the active teams before planning:

```json
{
  "profile": "business-flex",
  "enabled_domains": ["product", "backend", "qa", "security", "docs"],
  "enabled_plugins": [
    "business-analytics",
    "backend-development",
    "unit-testing",
    "security-scanning",
    "documentation-generation"
  ],
  "dashboard_pages": ["command", "business-flex", "workflow", "agent-work", "live-feed", "approvals"]
}
```

When `sdlc_plan` runs, each task gets:

- active `profile` and `workflow`
- selected domains and specialists
- `routing.explanation` showing why the agent/team was selected
- `budget_envelope` for requirements-stage business control

<details>
<summary>Current package limitation</summary>

Profiles guide routing, budget, dashboard visibility, and project-local configuration. The npm package still ships the full catalog so offline/project-local routing works. The next product step is a pack installer that physically copies only selected packs into `.rstack/` for stricter enterprise footprints.

</details>

## Builder and validator sandbox model

RStack uses scoped task packets instead of giving every worker the whole project and whole catalog.

| Role | Tools | Must write | Rule |
|---|---|---|---|
| Orchestrator | planning/status tools | `plan.md`, `tasks.json`, specs | Routes work; does not directly implement |
| Builder | read, bash, edit, write, grep, find, ls | `builder.json` | Changes only task-scoped files; runs checks before claiming done |
| Validator | read, grep, find, ls | `validation.json` | Read-only review; no mutation |

Builder contract:

```json
{
  "task_id": "003-architecture",
  "agent": "builder",
  "status": "PASS|FAIL|BLOCKED|DONE_WITH_CONCERNS",
  "summary": "",
  "files_modified": [],
  "tests_run": [],
  "risks": [],
  "next_steps": []
}
```

Contract v2 can also capture backend visibility:

```json
{
  "execution": { "tools_used": [], "events": [], "artifacts_written": [] },
  "cost": { "currency": "USD", "estimated_usd": 1.5, "actual_usd": 1.2 },
  "context": { "profile": "business-flex", "workflow": "production-business-sdlc" },
  "routing": { "selected_by": "profile-domain-stage-affinity", "explanation": [] }
}
```

Validator contract:

```json
{
  "task_id": "003-architecture",
  "validator": "rstack-validator",
  "status": "PASS|FAIL",
  "checks": [],
  "issues": [],
  "retry_recommendation": "none|retry_builder|ask_user|block"
}
```

## Business Hub — live observability on :3008

```bash
npx rstack-agents hub
```

The dashboard derives everything from real `.rstack` files — no fake demo state and no telemetry leaving your machine.

| Page | What you get |
|---|---|
| **Command Center** | Portfolio status, attention signals, stage health, live activity |
| **Business Flex** | Active profiles, enabled domains, budget guardrails, routing proof |
| **Studio / Studio 3D** | Agent workspace with live stage status and clickable agent panels |
| **Projects & Runs** | Every run and its actual deliverables |
| **Run Analytics** | Stage timing, Gantt, trend rows |
| **Agent Work** | Builder/validator contracts and evidence |
| **Approvals / Alerts** | Human gates, guardrails, spend/stall signals |
| **Traceability** | Requirement → stage → task → evidence chains |

## CLI reference

| Command | Purpose |
|---|---|
| `rstack-agents init --profile business-flex` | Set up project profile, budget policy, framework glue, and Business Hub registry |
| `rstack-agents hub` | Start/open the dashboard |
| `rstack-agents list agents\|skills\|plugins` | Browse packaged catalog |
| `rstack-agents add plugin <name>` | Copy a packaged plugin into the project |
| `rstack-agents notify --test` | Test Slack/Teams/Discord/Telegram/WhatsApp notifications |
| `rstack-agents validate` | Validate packaged and local agent definitions |
| `rstack-business --port 3008 --project .` | Run the dashboard directly |

## Framework support

| Framework | Status | Notes |
|---|---|---|
| Pi | Native adapter | Full `sdlc_*` tool surface through `extensions/rstack-sdlc.ts` |
| Claude Code | Asset/session bootstrap | `init` writes Claude usage guide/session hook assets |
| Operator | Bridge adapter | Python adapter shells out to the same Node harness |
| Codex/Gemini/custom | Universal mode | Use `.rstack` state contract, prompts, agents, and CLI bridge |

## Known loopholes / roadmap

- **Actual token/cost capture:** host frameworks execute model calls, so real usage needs host-side reporting or provider adapters.
- **Physical pack pruning:** profiles narrow routing today; a future pack installer should reduce project-local agent/plugin footprint.
- **Validator enforcement:** validator tool policy is encoded in RStack packets, but strict enforcement depends on the host sandbox.
- **Open-source adaptation:** learn from OSS agent frameworks, but preserve licenses and validate contracts before importing anything.
- **MCP/A2A:** `.rstack` is adapter-friendly, but a native MCP/A2A server is still a future slice.

## Documentation

Mintlify docs live in [`docs/mintlify`](docs/mintlify):

- [Quickstart](docs/mintlify/quickstart.mdx)
- [Business Flex Profiles](docs/mintlify/getting-started/business-flex-profiles.mdx)
- [Builder & Validator Sandbox](docs/mintlify/getting-started/builder-validator-sandbox.mdx)
- [AI SDLC Trends & Loopholes](docs/mintlify/reference/loopholes-roadmap.mdx)
- [Business Hub](docs/mintlify/reference/business-hub.mdx)
- [Research Program](docs/mintlify/reference/research-program.mdx)
- [RFC / ADR Process](docs/mintlify/reference/rfc-process.mdx)
- [Research-Backed Design Decisions](docs/mintlify/reference/research-backed-design.mdx)

Research-paper source material lives in [`research/`](research/): bibliography, methodology, prior-art comparison, productivity claims discipline, design history, paper outline, and the current-state audit. Architecture decisions live in [`rfcs/`](rfcs/), with CI-backed validation for filename/status/section discipline.

The original presentation is kept as a backup at:

```text
docs/mintlify/assets/backups/RStack-The-Future-of-Software-Development.backup.pptx
```

## Development

```bash
git clone https://github.com/richard-devbot/SDLC-rstack.git
cd SDLC-rstack
npm install
npm test
npm run lint
npm run validate
```

Latest verified branch state for this business-flex slice:

```text
npm test -- --runInBand   # 111 pass, 0 fail
npm run lint              # pass
npm run validate          # All 196 agents passed validation
npm pack --dry-run        # package includes new profile/dashboard files
```

## License

MIT © Richardson Gunde
