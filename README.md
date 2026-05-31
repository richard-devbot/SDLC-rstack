# RStack SDLC

<!-- owner: RStack developed by Richardson Gunde -->

**RStack SDLC** is a governed AI software-delivery harness developed by **Richardson Gunde**.

Give any AI coding agent a repeatable, auditable SDLC — with human-in-loop approval gates, live observability, and memory across runs:

```
clarify → plan → spec → approve → build → validate → release-readiness → learn
```

---

## One-line install

| Runtime | Install |
|---------|---------|
| **Pi** *(native, full hooks)* | `pi install npm:rstack-agents` |
| **Operator** *(native, via Node bridge)* | `pip install operator-use && npm install -g rstack-agents` |
| **Claude Code** *(asset mode)* | `npx rstack-agents@latest init` |
| **Any other agent** *(asset mode)* | `git clone https://github.com/richard-devbot/SDLC-rstack.git ~/rstack` |

Then open the live Business Hub in your browser:

```bash
npx rstack-agents@latest business   # or: npm run business
# → http://localhost:3008
```

---

## Runtimes at a glance

RStack has a **native Pi adapter** and a **native Operator adapter** today. Every other runtime runs in asset mode — the same Markdown/JSON knowledge base, read as context by the agent.

| Feature | Pi | Operator | Claude Code | Codex / Gemini / Qwen |
|---------|:--:|:--------:|:-----------:|:---------------------:|
| `sdlc_*` tools registered natively | ✅ | ✅ | — | — |
| `tool_call` safety gates | ✅ | ✅ | — | — |
| Lifecycle hooks (`session_start`, etc.) | ✅ | ✅ | — | — |
| Human-in-loop approval blocking | ✅ | ✅ | — | — |
| Business Hub auto-launch on start | ✅ | — | — | — |
| SDLC agents / skills / plugins (Markdown) | ✅ | ✅ | ✅ | ✅ |
| Governance contracts (builder/validator) | ✅ | ✅ | ✅ | ✅ |
| Live observability dashboard | ✅ | ✅ | ✅ | ✅ |

> **Pi tight-coupling note:** The runtime hooks (`tool_call` blocking, `approval_gate_blocked`, auto-launch) are Pi-specific today. If you run on Claude Code or another agent, you get the full 196-agent knowledge base and governance contracts but not the automatic safety gates — those require a native adapter. An MCP adapter is on the roadmap.

---

## Quick start — Pi (native, recommended)

**1. Install**

```bash
pi install npm:rstack-agents
```

From a local checkout:

```bash
pi install .
```

**2. Ask Pi to start a governed run**

```
Use RStack to build a production-ready <your feature> with auth, tests, docs, and release readiness.
```

Or call tools directly:

```
sdlc_start(goal="Build a checkout flow with Stripe, tests, and release readiness")
sdlc_clarify()
sdlc_plan()
```

**3. Approve gates before build executes**

```
sdlc_approve(artifact="plan.md", status="APPROVED")
sdlc_approve(artifact="requirements.json", status="APPROVED")
sdlc_approve(artifact="architecture.md", status="APPROVED")
```

**4. Run the pipeline**

```
sdlc_build_next()
sdlc_validate()
sdlc_status()
```

The Business Hub opens automatically at **http://localhost:3008** when Pi starts.

---

## Quick start — Operator (native, Python)

**Prerequisites:** Node.js 18+ on PATH, `npm install -g rstack-agents`.

**1. Install from npm**

```python
from operator_use.package.installer import install_package
install_package("npm:rstack-agents", get_packages_dir())
```

Or from a local checkout:

```python
install_package("/path/to/SDLC-rstack", get_packages_dir())
```

**2. Install Node dependencies (once)**

```bash
cd ~/.operator/packages/git/github.com/richard-devbot/SDLC-rstack
npm install
```

**3. Configure (optional)**

Add to `~/.operator/settings.json`:

```json
{
  "extension_list": [
    { "name": "rstack_sdlc", "enabled": true, "settings": {
      "worker_command": "pi",
      "slack_webhook": "https://hooks.slack.com/...",
      "allow_destructive": "0"
    }}
  ]
}
```

The 15 `sdlc_*` tools load automatically via the Node bridge. All TypeScript harness logic is reused — no duplication.

> **Note:** `sdlc_delegate` spawns Pi-style sub-workers. Set `worker_command` to a Pi-compatible CLI, or `pi` must be on PATH.

---

## Quick start — Claude Code (asset mode)

**1. Clone into your project**

```bash
git clone https://github.com/richard-devbot/SDLC-rstack.git .rstack/vendor/rstack
```

Or with npm (after `npm install -g rstack-agents`, then):

```bash
npx rstack-agents@latest init
```

**2. Add to `CLAUDE.md`**

```markdown
## RStack SDLC

Use RStack SDLC from `.rstack/vendor/rstack`.
Start with `.rstack/vendor/rstack/agents/core/orchestrator.md`.
Use `.rstack/vendor/rstack/agents/core/builder.md` for implementation.
Use `.rstack/vendor/rstack/agents/core/validator.md` for verification.
Write all run state under `.rstack/runs/<run_id>/`.
Require builder.json, validation.json, and traceability.json.
Never claim DONE without evidence.
```

**3. Ask Claude**

```
Use RStack to plan, build, validate, and document: <your goal>
```

**What you get in asset mode:** Full 196-agent knowledge base, governance contracts, 15-stage pipeline, traceability. What you don't get: automatic `tool_call` gating and approval blocking (those need a native adapter).

**4. Start the Business Hub separately**

```bash
npx rstack-agents@latest business --project .
# → http://localhost:3008
```

---

## Quick start — Codex, Gemini, Qwen (asset mode)

```bash
# Clone RStack assets into your project
git clone https://github.com/richard-devbot/SDLC-rstack.git .rstack/vendor/rstack

# Pick your config file name
cp .rstack/vendor/rstack/docs/public/AGENTS.md.tmpl AGENTS.md   # Codex / Qwen
# or
cp .rstack/vendor/rstack/docs/public/GEMINI.md.tmpl GEMINI.md   # Gemini CLI
```

Or bootstrap manually:

```bash
cat >> AGENTS.md <<'EOF'
# RStack SDLC

Use RStack SDLC from `.rstack/vendor/rstack`.
Read `agents/core/orchestrator.md` first.
Use `agents/core/builder.md` for implementation tasks.
Use `agents/core/validator.md` for read-only verification.
Use `agents/sdlc/` for lifecycle stages.
Write run state under `.rstack/runs/<run_id>/`.
Require specs, approvals, traceability, builder.json, and validation.json.
Never claim DONE without evidence.
EOF
```

---

## Live Observability

RStack ships two observability servers. Both are zero-dependency — no external services required.

### Developer Observer — `:3007`

Single-run Kanban board with live WebSocket event stream. Opens automatically during a Pi run.

```bash
npm run observer           # or: rstack-observer
rstack-observer --port 3007 --project /path/to/project
```

### Business Hub — `:3008`

Multi-run, team-facing dashboard. Auto-launches when a Pi session starts. Works with any runtime.

```bash
npm run business           # or: rstack-business
rstack-business --port 3008 --project /path/to/project
```

**Dashboard tabs:**

| Tab | What it shows |
|-----|--------------|
| **Overview** | KPI cards: active runs, cost, pass/fail, pending approvals; guardrail health bars |
| **Live Feed** | Plain-language activity log across all runs — no raw event names |
| **Approvals** | Human-in-loop queue — one-click Approve / Reject for blocked actions |
| **Alerts** | Cost threshold, failure rate, guardrail hit rate, stalled run detection |
| **Run History** | All runs with cost, duration, pass/fail, active/done status |
| **Traceability** | Requirements → architecture → code tasks → test evidence, per run |
| **Team** | Framework breakdown (Pi / Operator / Claude Code) with pass rates and cost |

**Auto-launch:** When Pi or Operator starts a session, the Business Hub launches in the background and prints its URL. Set `RSTACK_NO_BUSINESS_HUB=1` to disable.

**Notifications** — configure any channel:

```bash
export RSTACK_SLACK_WEBHOOK="https://hooks.slack.com/services/..."
export RSTACK_DISCORD_WEBHOOK="https://discord.com/api/webhooks/..."
export RSTACK_TEAMS_WEBHOOK="https://outlook.office.com/webhook/..."
```

**Alert thresholds (defaults):**

| Threshold | Default |
|-----------|---------|
| Cost per run | $0.50 |
| Daily total cost | $5.00 |
| Guardrail hit rate | 20% of tasks |
| Task failure rate | 30% of tasks |
| Stalled run (no events) | 30 min |
| Pending approvals | ≥ 1 |

---

## What RStack includes

```
196 agents   ·   156 skills   ·   36 prompts   ·   72 plugins
```

| Layer | Purpose |
|-------|---------|
| `agents/core/` | Orchestrator, builder, validator team contracts |
| `agents/sdlc/` | 15-stage pipeline: environment → cost estimation |
| `agents/specialists/` | Backend, frontend, devops, QA, security, data, product, docs |
| `skills/` | Reusable workflow instructions |
| `prompts/` | Prompt templates and slash commands |
| `plugins/` | Domain packs (manifests, agents, skills, commands) |
| `extensions/rstack-sdlc.ts` | Pi native adapter |
| `extensions/rstack_sdlc.py` + `bin/rstack-operator-bridge.ts` | Operator native adapter (Python → Node bridge) |
| `src/harness/observer.js` | Developer Kanban server (`:3007`) |
| `src/harness/business-observer.js` | Business Hub server (`:3008`) |
| `src/harness/approval-queue.js` | Human-in-loop persistence (`.rstack/approvals.jsonl`) |
| `src/harness/alert-engine.js` | Threshold alerts + plain-language summaries |
| `src/harness/memory.js` | Episodic memory, decay scoring, entity retrieval fusion |
| `src/harness/guardrails.js` | Attempt / tool call / cost limits |
| `src/harness/contracts.js` | Builder + validator contract validation |

---

## Tool reference (Pi + Operator)

| Tool | Purpose |
|------|---------|
| `sdlc_orchestrate` | Load orchestrator / builder / validator operating instructions |
| `sdlc_start` | Create `.rstack/runs/<run_id>/` state for a new run |
| `sdlc_clarify` | Capture product-owner answers before planning |
| `sdlc_plan` | Create lifecycle tasks, draft specs, routing metadata, traceability |
| `sdlc_spec` | Read or update spec artifacts (requirements, architecture, etc.) |
| `sdlc_approve` | Record human approval/rejection gates |
| `sdlc_agents` | List available agents, skills, and plugins by domain |
| `sdlc_delegate` | Spawn isolated worker agents for parallel tasks |
| `sdlc_build_next` | Prepare the next gated builder task packet |
| `sdlc_validate` | Validate builder output, write `validation.json` |
| `sdlc_status` | Show run status, tasks, approvals, next action |
| `sdlc_memory` | Search or append project learnings |

**Pi slash commands:**

```
/sdlc          Start a governed SDLC run
/sdlc-agents   Browse available agents, skills, and plugins
```

---

## CLI reference

```bash
# List assets
rstack-agents list agents
rstack-agents list skills
rstack-agents list plugins

# Validate all agent/skill/plugin manifests
rstack-agents validate

# Add a domain plugin
rstack-agents add plugin backend-development

# Start the developer observer
rstack-observer [--port 3007] [--project <path>] [--run-id <id>] [--no-browser]

# Start the business hub
rstack-business [--port 3008] [--project <path>] [--no-browser]
```

---

## 15-stage SDLC pipeline

```
00-environment        Scan tools, versions, project structure
01-transcript         Parse meeting notes → structured requirements
02-requirements       Extract functional + non-functional requirements
03-documentation      Generate BRD, FRD, SOW
04-planning           Sprint plan, timeline, team composition
05-jira               Epic → Story → Task hierarchy
06-architecture       HLD, API contracts, DB schema
07-code               Production-ready code scaffolding
08-testing            Test plan, cases, API tests, security checklist
09-deployment         Dockerfiles, CI/CD pipelines, IaC
10-summary            Executive dashboard, artifact inventory
11-feedback-loop      Cross-pipeline consistency review
12-security-threat-model  STRIDE + OWASP Top 10
13-compliance-checker HIPAA / GDPR / PCI-DSS / SOC 2 gap analysis
14-cost-estimation    Cloud cost forecast (AWS / Azure / GCP)
```

---

## Governance model

RStack enforces this sequence:

```
clarify → plan → spec → approve → build → validate → release-readiness → memory
```

Controls:

- No build before plan approval in interactive mode
- Destructive actions require explicit `sdlc_approve(artifact="destructive-action")`
- Validators default to read-only tools
- Every task requires acceptance criteria, `builder.json`, and `validation.json`
- Traceability written to `traceability.json`
- No DONE without command evidence

**Protected actions** (blocked unless approved):

```
rm -rf          git push --force    npm publish
terraform apply/destroy             kubectl apply/delete
helm install/upgrade/uninstall      DROP TABLE / DELETE FROM
```

**Protected write paths** (blocked unless approved):

```
.env  .env.*  id_rsa  id_ed25519  credentials.*  secrets.*  .npmrc  .pypirc
```

To unblock:

```bash
sdlc_approve(artifact="destructive-action", status="APPROVED")
# or
RSTACK_ALLOW_DESTRUCTIVE=1
```

---

## Generated run state

```
.rstack/
  runs/
    <run_id>/
      manifest.json         goal, framework, created_at, status
      events.jsonl          live event stream (tool calls, validations, cost)
      metrics.json          cost, tool calls, guardrail hits per stage
      tasks.json            task list with status
      approvals.jsonl       human-in-loop approval queue
      traceability.json     requirements → tasks → files → evidence
      specs/
        product-brief.md
        requirements.json
        architecture.md
        implementation-report.json
        qa-report.json
        security-review.md
        handoff.md
        release-readiness.json
      artifacts/
        stages/
          02-requirements/
          06-architecture/
          07-code/
          08-testing/
          ...
      tasks/
        <task_id>/
          prompt.md
          builder.json
          validation.json
```

Project memory (persists across runs):

```
.rstack/memory/
  episodes.jsonl          stage-scoped task outcomes
  facts.jsonl             manually appended learnings
  retractions.jsonl       superseded lessons
  retrieval-events.jsonl  what memory was injected into prompts
```

---

## Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `RSTACK_BUSINESS_PORT` | `3008` | Business Hub port |
| `RSTACK_OBSERVER_PORT` | `3007` | Developer observer port |
| `RSTACK_PROJECT_ROOT` | `cwd` | Project root for both servers |
| `RSTACK_NO_BUSINESS_HUB` | `0` | Set to `1` to disable auto-launch |
| `RSTACK_NO_BROWSER` | `0` | Set to `1` to suppress browser open |
| `RSTACK_ALLOW_DESTRUCTIVE` | `0` | Set to `1` to skip destructive gates |
| `RSTACK_SLACK_WEBHOOK` | — | Slack notification endpoint |
| `RSTACK_DISCORD_WEBHOOK` | — | Discord notification endpoint |
| `RSTACK_TEAMS_WEBHOOK` | — | Microsoft Teams notification endpoint |
| `RSTACK_MEMORY_DIR` | `~/.rstack/projects/` | Memory store location |

---

## Development

```bash
git clone https://github.com/richard-devbot/SDLC-rstack.git
cd SDLC-rstack
npm install
npm test           # 62 tests
npm run validate   # 196 agents
npm run business   # start Business Hub at :3008
npm run observer   # start Developer Observer at :3007
```

Type-check the Pi adapter:

```bash
npx tsc --noEmit --allowImportingTsExtensions --module NodeNext \
  --moduleResolution NodeNext --target ES2022 --skipLibCheck \
  extensions/rstack-sdlc.ts
```

---

## Project-local overrides

```
.rstack/agents/       local agent overrides
.rstack/skills/       local skill overrides
.pi/rstack/agents/    Pi-specific agent overrides
.pi/rstack/skills/    Pi-specific skill overrides
```

---

## Adapter roadmap

| Status | Adapter |
|--------|---------|
| ✅ Shipped | Pi — native TypeScript adapter, full hooks |
| ✅ Shipped | Operator — native Python adapter via Node bridge |
| 🔜 Next | MCP — expose `sdlc_*` tools to any MCP client |
| 🔜 Next | Claude Code — native adapter with `tool_call` hooks |
| 📋 Planned | SDK — Node/Python library for custom harnesses |
| 📋 Planned | Codex / Gemini / Qwen — generated config packs |

The Business Hub (`rstack-business`) works with all runtimes today — it reads `.rstack/runs/` directly and requires no adapter.

---

## License

MIT — developed by Richardson Gunde.

Repository: [github.com/richard-devbot/SDLC-rstack](https://github.com/richard-devbot/SDLC-rstack)
