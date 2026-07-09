# RStack SDLC

<!-- owner: RStack developed by Richardson Gunde -->

<p align="center">
  <img src="https://raw.githubusercontent.com/richard-devbot/SDLC-rstack/main/assets/sdlc-rstack-logo.png" alt="SDLC RSTACK" width="280" />
</p>

<p align="center">
  <strong>A governed AI-SDLC operating layer for AI coding harnesses.</strong><br/>
  Since 2026 &nbsp;·&nbsp; MIT &nbsp;·&nbsp; <a href="https://github.com/richard-devbot/SDLC-rstack">richard-devbot/SDLC-rstack</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-2.0.0-brightgreen" alt="v2.0.0"/>
  <img src="https://img.shields.io/badge/agents-196%20validated-brightgreen" alt="196 agents"/>
  <img src="https://img.shields.io/badge/tests-756%20pass-brightgreen" alt="756 tests"/>
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT"/>
</p>

---

RStack sits on top of Pi, Claude Code, Operator, Codex-style CLIs, Gemini-style CLIs, or a custom harness and gives agent teams a repeatable lifecycle with approvals, builder/validator contracts, evidence, memory, budget envelopes, and a live Business Hub.

**Enforcement tiers:** full runtime enforcement on Pi and Operator (live tool-call gating), and on Claude Code via the `rstack-agents guard` PreToolUse hook (installed by `init`). Every other harness gets the governed contracts, state, and Business Hub, plus a guided recipe to wire the guard into its own hook system ([wire-your-own-harness](docs/integrations/wire-your-own-harness.md)).

```text
clarify → plan → spec → approve → build → validate → release-readiness → learn
```

## Meet the studio

Your AI software team in one place — builders, validators, the skills rack, and live delivery status. **[Open the interactive 3D workspace →](https://raw.githack.com/richard-devbot/SDLC-rstack/main/assets/rstack-workspace-v8.html)** — drag to look around, scroll to zoom, click any room to explore, or take the guided tour where each specialist introduces itself.

<p align="center">
  <a href="https://raw.githack.com/richard-devbot/SDLC-rstack/main/assets/rstack-workspace-v8.html">
    <img src="https://raw.githubusercontent.com/richard-devbot/SDLC-rstack/main/assets/rstack-workspace-preview.png" alt="RStack interactive agent workspace — builders and validators studio" width="800"/>
  </a>
</p>

## Table of contents

- [Quick start](#quick-start)
- [Govern an existing codebase](#govern-an-existing-codebase)
- [Choose your framework](#choose-your-framework)
- [Configure your team](#configure-your-team)
- [Agent identity and standby automation](#agent-identity-and-standby-automation)
- [Upgrade path](#upgrade-path)
- [Start your first governed run](#start-your-first-governed-run)
- [What init creates](#what-init-creates)
- [Builder and validator sandbox model](#builder-and-validator-sandbox-model)
- [Business Hub](#business-hub--live-observability-on-3008)
- [CLI reference](#cli-reference)
- [Known limitations and roadmap](#known-limitations--roadmap)
- [Documentation](#documentation)
- [Development](#development)

---

## Quick start

> **New here? [RStack in 5 Minutes](docs/quick-start-guide.md)** — install to a
> validated, human-approved pipeline task from a bare terminal, no framework required.

```bash
cd your-project
npm install rstack-agents
npx rstack-agents init --profile business-flex
```

`init` auto-detects `pi | claude-code | operator | custom`, creates `.rstack/`, scaffolds bootstrap files (`SOUL.md`, `HEARTBEAT.md`, and framework-specific `CLAUDE.md` or `AGENTS.md`), registers the project with the Business Hub, writes framework glue, and **never overwrites existing files**.

**Verify your setup:** run `npx rstack-agents doctor` — it checks your environment, config, and framework wiring, and runs a live guard self-test to prove enforcement is working. Every problem prints its fix. Per-framework "test in 5 minutes" recipes: [docs/integrations/testing-matrix.md](docs/integrations/testing-matrix.md).

If `.rstack/` already exists, `init` adopts it and preserves all prior runs. To start clean instead (nothing is deleted):

```bash
npx rstack-agents init --fresh   # archives prior state to .rstack/archive/<timestamp>/
```

Pick a profile size:

```bash
npx rstack-agents init --profile lean-mvp
npx rstack-agents init --profile enterprise-webapp
```

| Profile | Best for | Result |
|---|---|---|
| `business-flex` | Most business/product teams | Product, backend, frontend, QA, security, devops, docs, budget policy, Business Flex dashboard |
| `lean-mvp` | Fast prototypes | Smaller full-stack team and lower budget defaults |
| `enterprise-webapp` | Heavier governance | Enterprise web app team with security/compliance/devops emphasis |

---

## Govern an existing codebase

Brownfield is first-class. `adopt` scans your repo read-only and harvests real artifacts (README, tests, CI config, deploy manifests) into a resumable pipeline run — stages with evidence are marked DONE, gaps are left open, and nothing is invented. Work then resumes from reality, not from scratch.

```bash
npx rstack-agents adopt --dry-run   # print the stage-population plan, write nothing
npx rstack-agents adopt             # harvest evidence into an adoption run
npx rstack-agents pipeline run      # advance from the gaps, stopping at human gates
```

Full guide: [docs/brownfield-adoption.md](docs/brownfield-adoption.md). To keep iterating toward a goal after adoption, see the loop recipes in [docs/loop-recipes.md](docs/loop-recipes.md).

---

## Choose your framework

RStack is a plugin layer — install your AI coding framework first, then run `init`.

| Framework | Integration | Bootstrap files | Harness entry |
|---|---|---|---|
| **Pi** | Native adapter | `SOUL.md`, `HEARTBEAT.md` | `sdlc_start(goal="...")` |
| **Claude Code** | First-class | `CLAUDE.md`, `SOUL.md`, `HEARTBEAT.md` | `/sdlc-start` or orchestrator |
| **Operator** | Python bridge | `SOUL.md`, `HEARTBEAT.md` | Operator extension + Node bridge |
| **Codex / custom** | Asset + bridge | `AGENTS.md`, `SOUL.md`, `HEARTBEAT.md` | Node bridge or prompt-driven |

| Framework | What you get |
|---|---|
| Pi | All 15 `sdlc_*` tools, lifecycle hooks, tool gating, auto-launch dashboard |
| Claude Code | Usage guide, optional SessionStart hook, slash commands via plugin |
| Operator | Python adapter shells out to the same Node harness |
| Codex / Gemini / custom | `.rstack/` state contract, agents/skills as context, CLI bridge |

Per-framework setup: [docs/mintlify/getting-started/install-your-framework.mdx](docs/mintlify/getting-started/install-your-framework.mdx)

Custom harness bridge:

```bash
RSTACK_PROJECT_ROOT="$(pwd)" \
  npx tsx node_modules/rstack-agents/bin/rstack-operator-bridge.ts sdlc_start '{"goal":"..."}'
```

Full contract: [docs/integrations/custom.md](docs/integrations/custom.md)

---

## Configure your team

RStack ships a large catalog (196 agents, 68 skills, 72 plugins), but you configure only what your project needs.

### 1. Pick a profile

Profiles write `.rstack/rstack.config.json` and `.rstack/budget.json`:

```bash
npx rstack-agents init --profile business-flex   # default for most teams
npx rstack-agents init --profile lean-mvp        # prototypes
npx rstack-agents init --profile enterprise-webapp # compliance-heavy delivery
```

### 2. Narrow domains and plugins

Edit `.rstack/rstack.config.json` any time:

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

When `sdlc_plan` runs, each task gets active profile, routing explanation, and budget envelope.

### 3. Add plugins locally

Copy one plugin pack into your project:

```bash
npx rstack-agents add plugin unit-testing
npx rstack-agents add plugin security-scanning
```

Plugins land in `.rstack/plugins/<name>/`.

### 4. Browse the catalog

```bash
npx rstack-agents list agents
npx rstack-agents list skills
npx rstack-agents list plugins
```

### 5. Project-local overrides

Drop custom assets in `.rstack/` — they take precedence over package defaults:

```text
.rstack/agents/     custom agent definitions
.rstack/skills/     custom skills
.rstack/plugins/    custom or copied plugin packs
.rstack/prompts/    custom prompts
```

Then validate: `npx rstack-agents validate`

<details>
<summary>Current package limitation</summary>

Profiles guide routing, budget, dashboard visibility, and project-local configuration. The npm package still ships the full catalog so offline/project-local routing works. The next product step is a pack installer that physically copies only selected packs into `.rstack/` for stricter enterprise footprints.

</details>

---

## Agent identity and standby automation

| File | Purpose |
|---|---|
| **SOUL.md** | Governance identity — orchestrator/builder/validator roles, evidence rules, profile awareness |
| **HEARTBEAT.md** | Optional periodic checks — pending approvals, budget burn, stalled tasks, validation retries |
| **CLAUDE.md** | Claude Code bootstrap — asset paths, slash commands, optional hooks |
| **AGENTS.md** | Codex/universal bootstrap — same rules plus skill routing and Node bridge |

`init` scaffolds these from `templates/bootstrap/` when missing. Canonical templates live in the package at `node_modules/rstack-agents/templates/bootstrap/`.

### Hooks (optional, on standby)

RStack does not require hooks. Enable only what you want:

| Hook | What it does | How to enable |
|---|---|---|
| Claude SessionStart | Auto-launch Business Hub + inject RStack context | Merge `.claude/rstack-hooks.json` into `.claude/settings.json` |
| Claude UserPromptSubmit | Inject RStack context packet (`rstack-agents context`) — run + stage + blockers + orchestrator pointer | Written by `init --framework claude-code` |
| Claude PreToolUse | Enforcement guard — destructive gate + validator sandbox at tool-call time | Written by `init --framework claude-code`; snippet in `docs/integrations/claude-code.md` |
| Claude PostToolUse / PostToolUseFailure / SubagentStart / SubagentStop / PreCompact / Stop / SessionEnd | Observability writer (`rstack-agents observe`) — tool results, delegated subagents, failures, compaction, session end into the run ledger | Written by `init --framework claude-code` |
| Claude Notification | Route host notifications to your channels (`rstack-agents notify-hook`) | Written by `init --framework claude-code` |
| Pi lifecycle | Tool gating, stage events, contract enforcement | Automatic when using Pi extension |
| HEARTBEAT.md | Periodic approval/budget/stall checks | Wire into your harness cron or idle trigger |

Disable hub auto-launch:

```bash
export RSTACK_NO_BUSINESS_HUB=1   # skip hub spawn
export RSTACK_NO_BROWSER=1        # hub may start but no browser tab
export RSTACK_BUSINESS_PORT=3008  # change port
```

---

## Upgrade path

Start small and expand as requirements grow:

```text
lean-mvp  →  business-flex  →  enterprise-webapp
```

| Stage | When | Action |
|---|---|---|
| **lean-mvp** | Prototypes, internal tools | `init --profile lean-mvp` — lower budgets, fewer domains |
| **business-flex** | Client/product delivery | Add domains/plugins in `rstack.config.json`, raise budget in `budget.json` |
| **enterprise-webapp** | Compliance-heavy web apps | `init --profile enterprise-webapp` or enable security/compliance plugins |

Upgrade steps (no reinstall required):

1. Edit `.rstack/rstack.config.json` — add `enabled_domains`, `enabled_plugins`, `dashboard_pages`
2. `npx rstack-agents add plugin <name>` — copy needed plugin packs locally
3. Adjust `.rstack/budget.json` — raise thresholds as team size and scope grow
4. `npx rstack-agents validate` — refresh registry after changes

---

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

---

## What init creates

```text
your-project/
├── CLAUDE.md or AGENTS.md   # framework bootstrap (if missing)
├── SOUL.md                  # governance identity (if missing)
├── HEARTBEAT.md             # standby automation guide (if missing)
├── .rstack/
│   ├── rstack.config.json   # active profile, enabled domains/plugins, dashboard pages
│   ├── budget.json          # run/daily/monthly budget, warnings, approval thresholds
│   ├── runs/                # every governed run lands here
│   ├── registry/            # agents, skills, plugins, routing metadata
│   └── policy.json          # optional approval policy you control
└── framework glue           # e.g. .claude/rstack-sdlc.md or Operator template
```

Every run records its manifest, plan, tasks, approvals, evidence, events, stage artifacts, builder contracts, validator contracts, and metrics under `.rstack/runs/<run-id>/`.

---

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

---

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

---

## CLI reference

| Command | Purpose |
|---|---|
| `rstack-agents init --profile business-flex` | Set up profile, budget, bootstrap files, framework glue, and Business Hub registry (`--fresh` archives prior `.rstack/` state and starts clean) |
| `rstack-agents doctor [--framework <x>]` | Verify setup and prove enforcement is live (env, config, framework wiring, guard self-test, hub health); prints a fix per FAIL, `--json` for CI |
| `rstack-agents list agents\|skills\|plugins` | Browse the packaged catalog |
| `rstack-agents add plugin <name>` | Copy a packaged plugin into `.rstack/plugins/` |
| `rstack-agents validate` | Validate packaged agent definitions — frontmatter, duplicate names, hook paths |
| `rstack-agents hub` | Ensure the Business Hub is running on :3008 and open it |
| `rstack-agents guard` | Enforcement hook: classify one pending tool call, exit 0 allow / exit 2 block (destructive gate + validator sandbox) |
| `rstack-agents observe` | Observability hook: append a normalized event (tool result, subagent, compaction, session) to the run ledger — never blocks, exit 0 |
| `rstack-agents context` | Context hook: emit the RStack packet (run + stage + blockers + orchestrator pointer) for UserPromptSubmit/SessionStart — never blocks, exit 0 |
| `rstack-agents notify-hook` | Notification hook: route a host notification to configured channels — never blocks, exit 0 |
| `rstack-agents notify --test` | Test Slack/Teams/Discord/Telegram/WhatsApp notifications |
| `rstack-agents inventory` | Generate a backend control-plane registry report |
| `rstack-agents adopt` | Adopt an existing codebase — harvest evidence into a resumable pipeline run (`--dry-run` plans without writing) |
| `rstack-agents decisions` | List, add, resolve, or waive run-level Decision Queue items |
| `rstack-agents dor` | Run the Definition-of-Ready gate for a run and target stage |
| `rstack-agents pipeline status` | Show pipeline status for the latest or selected run, with one recommended next action |
| `rstack-agents pipeline run` | Advance the run from current state: skip DONE work, re-enter retryable tasks, stop at human gates |
| `rstack-agents pipeline loop` | Bounded goal loop: advance, evaluate the goal, rerun recommended stages until PASS, a human gate, or a spent bound |
| `rstack-business --port 3008 --project .` | Run the dashboard server directly |
| `rstack-observer` | Deprecated alias — opens the same Business Hub |

Pipeline command flags and exit codes: [docs/mintlify/reference/pipeline.mdx](docs/mintlify/reference/pipeline.mdx).

---

## Known limitations and roadmap

### Shipped in 1.9 / 2.0

The loop-engineering program that earlier READMEs listed as planned has shipped: the harness ↔ loop-runner bridge, resume-aware pipeline state and `pipeline run`, deterministic retry plus the stage-specific validator registry, the bounded goal loop (`pipeline loop`), and persisted per-stage cost/token observability. The authoritative reference for all of it — run state, contracts, guardrails, checkpoints, metrics — is [`docs/HARNESS.md`](docs/HARNESS.md).

### Current limitations

- **Actual token/cost capture:** per-stage cost and token totals persist from builder contracts at validate time; provider-level usage still needs host-side reporting or provider adapters.
- **Physical pack pruning:** profiles narrow routing today; a future pack installer should reduce project-local agent/plugin footprint.
- **Runtime enforcement tiers:** live tool-call gating runs on Pi and Operator; Claude Code and other harnesses get contracts, state, and validate-time checks until the `rstack-agents guard` hook ships ([#227](https://github.com/richard-devbot/SDLC-rstack/issues/227)).
- **MCP/A2A:** `.rstack` is adapter-friendly, but a native MCP/A2A server is still a future slice.

### Roadmap (contributions welcome)

| Feature | Ref |
|---------|-----|
| **Parallel execution enforcement** — wire benchmarked data-independent stage groups into the pipeline runner | [#208](https://github.com/richard-devbot/SDLC-rstack/issues/208) |
| **Pack installer** — physically copy only selected packs into `.rstack/` | future |
| **RStack Spec v1alpha1** — JSON schemas + conformance examples | [#71](https://github.com/richard-devbot/SDLC-rstack/issues/71) |
| **Stage-blanket approvals** — `required_stage_approvals` + `approvals.every_stage` per-stage human gates | [#228](https://github.com/richard-devbot/SDLC-rstack/issues/228) |
| **Exposure CLI verbs** — `pipeline rollback`, checkpoint status, config validate, approvals audit, memory inspect | [#229](https://github.com/richard-devbot/SDLC-rstack/issues/229) |

**Contributions are welcome.** Read [`CONTRIBUTING.md`](CONTRIBUTING.md) for branching rules, CI requirements, IP policy, and CodeRabbit guidelines before opening a PR.

---

## Documentation

### Bootstrap templates

Canonical copies in [`templates/bootstrap/`](templates/bootstrap/):

- [`SOUL.md`](templates/bootstrap/SOUL.md) — governance identity
- [`HEARTBEAT.md`](templates/bootstrap/HEARTBEAT.md) — standby automation
- [`CLAUDE.md`](templates/bootstrap/CLAUDE.md) — Claude Code bootstrap
- [`AGENTS.md`](templates/bootstrap/AGENTS.md) — Codex/universal bootstrap
- [`GEMINI.md`](templates/bootstrap/GEMINI.md) — Gemini CLI pointer

### Mintlify docs

Full docs in [`docs/mintlify`](docs/mintlify):

- [Quickstart](docs/mintlify/quickstart.mdx)
- [Install your framework](docs/mintlify/getting-started/install-your-framework.mdx)
- [Business Flex Profiles](docs/mintlify/getting-started/business-flex-profiles.mdx)
- [Builder & Validator Sandbox](docs/mintlify/getting-started/builder-validator-sandbox.mdx)
- [Configuration reference](docs/mintlify/reference/configuration.mdx)
- [Business Hub](docs/mintlify/reference/business-hub.mdx)
- [AI SDLC Trends & Loopholes](docs/mintlify/reference/loopholes-roadmap.mdx)

### Harness and integrations

- [Harness contract](docs/HARNESS.md) — stages, contracts, evidence, guardrails
- [Custom integration](docs/integrations/custom.md) — Node bridge and state contract

Research material: [`research/`](research/). Architecture decisions: [`rfcs/`](rfcs/).

---

## Development

```bash
git clone https://github.com/richard-devbot/SDLC-rstack.git
cd SDLC-rstack
npm install
npm test
npm run lint
npm run validate
```

Latest verified branch state:

```text
npm test          # 756 pass, 0 fail
npm run lint      # pass
npm run validate  # All 196 agents passed validation
npm pack --dry-run  # package includes templates/bootstrap/
```

## License

MIT © Richardson Gunde
