# RStack SDLC

<!-- owner: RStack developed by Richardson Gunde -->

**RStack SDLC** is a framework-independent, governed AI software-delivery harness developed by **Richardson Gunde**.

It gives AI coding agents a repeatable SDLC instead of ad-hoc prompting:

```text
clarify → plan → spec → approve → build → validate → release-readiness → learn
```

RStack ships with a native **Pi adapter today**, but the framework itself is portable. The core assets are Markdown/JSON-compatible and can be used from Claude Code, Codex CLI, Gemini CLI, Qwen Code, MCP-capable clients, or any custom agent harness.

---

## What RStack includes

| Layer | Purpose |
| --- | --- |
| `agents/core/` | Orchestrator, builder, and validator team contracts. |
| `agents/sdlc/` | Full lifecycle pipeline agents from environment discovery to release readiness. |
| `agents/specialists/` | Backend, frontend, devops, QA, security, data, product, docs, and other specialists. |
| `skills/` | Reusable workflow instructions. |
| `prompts/` | Prompt templates and command-style workflows. |
| `plugins/` | Domain packs with manifests, agents, skills, and commands. |
| `extensions/rstack-sdlc.ts` | Native Pi runtime adapter. |
| `src/harness/` | Canonical 15-stage metadata, run-folder preparation, contracts, evidence, and guardrails. |
| `.rstack/runs/` | Generated run state, specs, approvals, traceability, tasks, and validation evidence. |

Current package assets:

```text
196 agents
156 skills
36 prompts
72 plugins
```

---

## Why RStack is not Pi-only

Pi is the first native runtime because it gives RStack the hooks needed for a real governed harness:

| RStack need | Pi support |
| --- | --- |
| Custom SDLC tools | `pi.registerTool()` |
| Slash commands | `pi.registerCommand()` |
| Lifecycle hooks | `pi.on(...)` |
| Safety gates | `tool_call` hook |
| Tool evidence logging | `tool_result` hook |
| Skill/prompt discovery | `resources_discover` hook |
| Installable package | `pi install` |
| Isolated worker delegation | `pi --mode json` subprocesses |

But the reusable RStack knowledge lives in portable files:

```text
agents/
skills/
prompts/
plugins/
docs/public/
```

So the correct framing is:

> RStack SDLC is a portable AI-SDLC framework with a first-class Pi adapter today.

---

## Harness guarantees

RStack includes a package-local Harness layer in `src/harness/`. The Harness makes the SDLC runtime machine-checkable:

- Preserves the canonical 15-stage pipeline from `00-environment` through `14-cost-estimation`.
- Prepares clean `artifacts/stages/<stage-id>/` folders for every run.
- Validates builder and validator contracts before a task can pass.
- Records task evidence events in `events.jsonl` with `task_id`, `kind`, `status`, and `evidence`.
- Carries guardrail defaults for attempts, message/tool limits, evidence, contracts, and destructive-action approval.

See [`docs/HARNESS.md`](docs/HARNESS.md) for the full runtime contract.

---

## Installation

<details open>
<summary><strong>Install in Pi, full native adapter</strong></summary>

From npm after publishing:

```bash
pi install npm:rstack-agents
```

From this local checkout:

```bash
cd /Users/richardsongunde/projects/SDLC-rstack
pi install .
```

One-off local test without installing:

```bash
pi -e /Users/richardsongunde/projects/SDLC-rstack/extensions/rstack-sdlc.ts
```

Then ask Pi:

```text
Use RStack to plan, build, validate, test, document, and prepare this feature for release: <your goal>
```

</details>

<details>
<summary><strong>Install universally, asset-only mode</strong></summary>

Use this when your framework can read files but does not have a native RStack adapter yet.

```bash
git clone https://github.com/richard-devbot/SDLC-rstack.git ~/rstack-agents
export RSTACK_HOME=~/rstack-agents
```

Or use this local checkout:

```bash
export RSTACK_HOME=/Users/richardsongunde/projects/SDLC-rstack
```

Universal bootstrap prompt:

```text
Use RStack SDLC from $RSTACK_HOME.
Read agents/core/orchestrator.md first.
Use agents/core/builder.md for implementation tasks.
Use agents/core/validator.md for read-only verification.
Use agents/sdlc/ for lifecycle routing.
Use skills/ and plugins/ only when relevant.
Write run state under .rstack/runs/<run_id>/.
Require specs, approvals, traceability, builder.json, validation.json, and command evidence.
Never claim DONE without evidence.
```

</details>

<details>
<summary><strong>Install in Claude Code, asset adapter</strong></summary>

Claude Code can use project/user subagents and slash commands. RStack can run there today as portable agent assets.

From your target project:

```bash
export RSTACK_HOME=/Users/richardsongunde/projects/SDLC-rstack
mkdir -p .claude/agents/rstack .claude/commands/rstack .rstack/vendor/rstack
cp -R "$RSTACK_HOME/agents" .rstack/vendor/rstack/
cp -R "$RSTACK_HOME/skills" .rstack/vendor/rstack/
cp -R "$RSTACK_HOME/plugins" .rstack/vendor/rstack/
cp -R "$RSTACK_HOME/prompts" .rstack/vendor/rstack/
cp -R "$RSTACK_HOME/agents"/* .claude/agents/rstack/
cp "$RSTACK_HOME/prompts"/*.md .claude/commands/rstack/ 2>/dev/null || true
```

Add to `CLAUDE.md`:

```markdown
# RStack SDLC

Use RStack SDLC from `.rstack/vendor/rstack`.
Start with `.rstack/vendor/rstack/agents/core/orchestrator.md`.
Use `.rstack/vendor/rstack/agents/core/builder.md` for implementation tasks.
Use `.rstack/vendor/rstack/agents/core/validator.md` for read-only verification.
Write all run state under `.rstack/runs/<run_id>/`.
Require specs, approvals, traceability, `builder.json`, and `validation.json`.
Never claim DONE without evidence.
```

This gives Claude Code the RStack operating model. It does not yet provide Pi-native hooks like `tool_call` gating unless a Claude Code adapter is added later.

</details>

<details>
<summary><strong>Install in Codex CLI, AGENTS.md adapter</strong></summary>

From your target project:

```bash
export RSTACK_HOME=/Users/richardsongunde/projects/SDLC-rstack
mkdir -p .rstack/vendor/rstack
cp -R "$RSTACK_HOME/agents" .rstack/vendor/rstack/
cp -R "$RSTACK_HOME/skills" .rstack/vendor/rstack/
cp -R "$RSTACK_HOME/plugins" .rstack/vendor/rstack/
cp -R "$RSTACK_HOME/prompts" .rstack/vendor/rstack/
cat > AGENTS.md <<'EOF'
# RStack SDLC

Use RStack SDLC from `.rstack/vendor/rstack`.
Read `.rstack/vendor/rstack/agents/core/orchestrator.md` first.
For implementation, follow `.rstack/vendor/rstack/agents/core/builder.md`.
For verification, follow `.rstack/vendor/rstack/agents/core/validator.md`.
Use SDLC pipeline agents from `.rstack/vendor/rstack/agents/sdlc/`.
Use skills from `.rstack/vendor/rstack/skills/` and plugin packs from `.rstack/vendor/rstack/plugins/`.
Write run state under `.rstack/runs/<run_id>/`.
Require specs, approval gates, traceability, builder contracts, validation contracts, and command evidence.
EOF
```

Then run Codex CLI from that project.

</details>

<details>
<summary><strong>Install in Gemini CLI, GEMINI.md adapter</strong></summary>

From your target project:

```bash
export RSTACK_HOME=/Users/richardsongunde/projects/SDLC-rstack
mkdir -p .rstack/vendor/rstack
cp -R "$RSTACK_HOME/agents" .rstack/vendor/rstack/
cp -R "$RSTACK_HOME/skills" .rstack/vendor/rstack/
cp -R "$RSTACK_HOME/plugins" .rstack/vendor/rstack/
cp -R "$RSTACK_HOME/prompts" .rstack/vendor/rstack/
cat > GEMINI.md <<'EOF'
# RStack SDLC

Use RStack SDLC from `.rstack/vendor/rstack`.
Start with `.rstack/vendor/rstack/agents/core/orchestrator.md`.
Use the SDLC pipeline in `.rstack/vendor/rstack/agents/sdlc/`.
Use plugin packs from `.rstack/vendor/rstack/plugins/` only when relevant to the task domain.
Maintain `.rstack/runs/<run_id>/` with specs, approvals, traceability, tasks, builder.json, and validation.json.
Do not perform destructive actions without explicit human approval.
Do not claim DONE without command evidence.
EOF
```

Then run Gemini CLI from that project.

</details>

<details>
<summary><strong>Install in Qwen Code, AGENTS.md adapter</strong></summary>

From your target project:

```bash
export RSTACK_HOME=/Users/richardsongunde/projects/SDLC-rstack
mkdir -p .rstack/vendor/rstack
cp -R "$RSTACK_HOME/agents" .rstack/vendor/rstack/
cp -R "$RSTACK_HOME/skills" .rstack/vendor/rstack/
cp -R "$RSTACK_HOME/plugins" .rstack/vendor/rstack/
cp -R "$RSTACK_HOME/prompts" .rstack/vendor/rstack/
cat > AGENTS.md <<'EOF'
# RStack SDLC

Use RStack SDLC from `.rstack/vendor/rstack`.
Act as the RStack orchestrator first, not as a direct coder.
Read `.rstack/vendor/rstack/agents/core/orchestrator.md`, then route to builder and validator contracts.
Use `.rstack/vendor/rstack/agents/sdlc/` for lifecycle stages.
Use `.rstack/vendor/rstack/plugins/` as domain packs.
Write `.rstack/runs/<run_id>/` state and preserve traceability.
Require human approval gates before implementation and release decisions.
EOF
```

Then run Qwen Code from that project.

</details>

<details>
<summary><strong>Install in Claude Desktop or Perplexity Desktop</strong></summary>

RStack does not yet ship a native Desktop/MCP adapter.

Today:

1. Use RStack docs and portable assets as manual context.
2. Use the native Pi adapter for the full governed runtime.
3. Use a future MCP adapter when available.

Planned MCP tool surface:

```text
sdlc_start
sdlc_clarify
sdlc_plan
sdlc_spec
sdlc_approve
sdlc_agents
sdlc_build_next
sdlc_validate
sdlc_status
sdlc_memory
```

</details>

---

## Native Pi quickstart

```text
sdlc_orchestrate
sdlc_start
sdlc_clarify
sdlc_plan
sdlc_spec
sdlc_approve
sdlc_build_next
sdlc_validate
sdlc_status
sdlc_memory
```

Example:

```text
Use RStack to build a production-ready todo app with auth, tests, docs, and release readiness.
```

Recommended first calls:

```text
sdlc_orchestrate(goal="Build a production-ready todo app with auth, tests, docs, and release readiness")
sdlc_start(goal="Build a production-ready todo app with auth, tests, docs, and release readiness")
sdlc_clarify()
sdlc_plan()
```

Approve gates before build execution:

```text
sdlc_approve(artifact="plan.md", status="APPROVED")
sdlc_approve(artifact="requirements.json", status="APPROVED")
sdlc_approve(artifact="architecture.md", status="APPROVED")
```

Then continue:

```text
sdlc_build_next()
sdlc_validate()
sdlc_status()
```

---

## Native Pi tool reference

| Tool | Purpose |
| --- | --- |
| `sdlc_orchestrate` | Load RStack orchestrator, builder, and validator operating instructions for a goal. |
| `sdlc_start` | Create `.rstack/runs/<run_id>/` state for a new SDLC run. |
| `sdlc_clarify` | Ask or capture product-owner answers before planning. |
| `sdlc_plan` | Create lifecycle tasks, draft specs, registry files, routing metadata, and traceability. |
| `sdlc_spec` | Read or update governed spec artifacts under `.rstack/runs/<run_id>/specs/`. |
| `sdlc_approve` | Record human approval/rejection gates for plans, requirements, architecture, release readiness, or destructive actions. |
| `sdlc_agents` | List available packaged/project-local agents, skills, and plugins by kind/domain. |
| `sdlc_delegate` | Spawn isolated Pi worker agents for single or bounded parallel tasks. Validators default to read-only tools. |
| `sdlc_build_next` | Prepare the next gated builder task packet with core, SDLC, specialist, skill, and plugin context. |
| `sdlc_validate` | Validate builder output and write `validation.json`. |
| `sdlc_status` | Show run status, task progress, missing approvals, registry counts, and next recommended action. |
| `sdlc_memory` | Search or append project learnings for future runs. |

Native Pi slash commands:

```text
/sdlc
/sdlc-agents
```

---

## CLI reference

The package CLI is framework-neutral and useful for inspection:

```bash
rstack-agents list agents
rstack-agents list skills
rstack-agents list plugins
rstack-agents validate
rstack-agents add plugin <name>
```

Local development equivalent:

```bash
node bin/rstack-agents.js list agents
node bin/rstack-agents.js list skills
node bin/rstack-agents.js list plugins
node bin/rstack-agents.js validate
node bin/rstack-agents.js add plugin backend-development
```

---

## Governance model

RStack enforces this operating model:

```text
clarify → plan → spec → approve → build → validate → release-readiness → memory
```

Required controls:

- No implementation before plan approval in interactive mode.
- No implementation after requirements/architecture gates without approval.
- Destructive actions require explicit approval.
- Validators default to read-only tools.
- Every task has acceptance criteria.
- Every builder writes `builder.json`.
- Every validator writes `validation.json`.
- Traceability is written to `traceability.json`.
- No DONE without evidence.

Generated run state:

```text
.rstack/
  registry/
    registry.json
    agents.json
    skills.json
    plugins.json
    routing.json
  runs/
    <run_id>/
      manifest.json
      context.md
      plan.md
      tasks.json
      approvals.json
      traceability.json
      events.jsonl
      evidence.jsonl
      specs/
        product-brief.md
        requirements.json
        architecture.md
        implementation-report.json
        qa-report.json
        security-review.md
        handoff.md
        release-readiness.json
      tasks/
        <task_id>/
          prompt.md
          builder.json
          validation.json
```

Project memory is stored outside the run so future runs can learn from prior validator-approved work:

```text
${RSTACK_HOME:-~/.rstack}/projects/<project-slug>/memory/
  episodes.jsonl          # agent/stage scoped SDLC task outcomes
  facts.jsonl             # manually appended project learnings
  retractions.jsonl       # memory removals or superseded lessons
  retrieval-events.jsonl  # what memory was injected into prompts
```

The default memory backend is JSONL plus lexical retrieval. Configure it with `RSTACK_MEMORY_DIR` or `.rstack/memory-config.json`; future vector or SAGE backends should plug in through that config rather than hardcoded paths.

Each builder must return compact `memory_summary` and per-stage `stage_summaries` in `builder.json`. `sdlc_validate` now fails PASS builders that omit meaningful summaries, test evidence, or required per-stage evidence. After validation, summaries are stored in episodic memory so later agents can retrieve decisions, evidence, and handoff hints without carrying full transcripts or raw logs.

---

## Team model

```text
Orchestrator / team lead
├── SDLC pipeline agents
│   ├── environment
│   ├── transcript
│   ├── requirements
│   ├── documentation
│   ├── planning
│   ├── jira
│   ├── architecture
│   ├── code
│   ├── testing
│   ├── deployment
│   ├── summary
│   ├── feedback loop
│   ├── security threat model
│   ├── compliance checker
│   └── cost estimation
├── Builder team
│   ├── backend specialists
│   ├── frontend specialists
│   ├── devops specialists
│   ├── data specialists
│   └── docs specialists
└── Validator team
    ├── QA specialists
    ├── security specialists
    ├── architecture reviewers
    ├── code reviewers
    └── performance/accessibility reviewers
```

---

## Pipeline routing

The native Pi adapter maps lifecycle tasks to packaged SDLC agents:

```text
001-product-clarification -> 00-environment, 01-transcript
002-requirements          -> 02-requirements, 04-planning, 05-jira
003-architecture          -> 06-architecture, 12-security-threat-model, 14-cost-estimation
004-implementation        -> 07-code
005-testing               -> 08-testing
006-security-review       -> 12-security-threat-model, 13-compliance-checker
007-documentation         -> 03-documentation, 10-summary
008-release-readiness     -> 09-deployment, 10-summary, 11-feedback-loop
```

Each generated task includes:

```json
{
  "pipeline_agents": ["agent.02-requirements", "agent.04-planning"],
  "specialists": ["agent.02-requirements", "plugin.backend-development"]
}
```

Other adapters should preserve this routing contract.

---

## Plugin routing

Plugin packs under `plugins/` are domain bundles. Each pack can include:

```text
plugin.json
agents/*.md
skills/**/SKILL.md
commands/*.md
```

RStack uses them this way:

1. Build a registry of agents, skills, prompts, and plugins.
2. Select plugin IDs matching task domain, for example `plugin.backend-development`.
3. Include the selected plugin manifest plus bounded previews/lists of nested plugin assets in the task packet.
4. Let builders read only the nested plugin agent/skill needed for the task.
5. Let validators treat plugin output as guidance while still enforcing RStack contracts and evidence rules.

---

## Protected actions

RStack blocks these during governed native runs unless approved:

```text
rm -rf
git push
npm publish
terraform apply/destroy
kubectl apply/delete
helm install/upgrade/uninstall
DROP TABLE
DELETE FROM
```

RStack also protects secret-like write paths:

```text
.env
.env.*
id_rsa
id_ed25519
credentials.*
secrets.*
.npmrc
.pypirc
```

To allow a destructive action:

```text
sdlc_approve(artifact="destructive-action", status="APPROVED")
```

or set:

```bash
RSTACK_ALLOW_DESTRUCTIVE=1
```

---

## Project-local overrides

Package assets are the default source of truth. Target projects can add local overrides:

```text
.rstack/agents/
.rstack/skills/
.rstack/prompts/
.rstack/plugins/
.pi/rstack/agents/
.pi/rstack/skills/
.pi/rstack/prompts/
.pi/rstack/plugins/
```

---

## Development

```bash
cd /Users/richardsongunde/projects/SDLC-rstack
npm install
npm test
npm run validate
npm audit --audit-level=high
npm pack --dry-run
```

Type-check the Pi adapter:

```bash
npx -y -p typescript tsc --noEmit --allowImportingTsExtensions --module NodeNext --moduleResolution NodeNext --target ES2022 --skipLibCheck extensions/rstack-sdlc.ts
```

---

## Publish

```bash
npm test
npm run validate
npm audit --audit-level=high
npm pack --dry-run
npm login
npm publish --access public
```

The package is configured to include:

```text
extensions/
agents/
skills/
prompts/
plugins/
bin/
src/
docs/public/
README.md
```

And exclude private runtime/workspace folders such as:

```text
.claude/
.agents/
.codex/
node_modules/
logs/
outputs/
```

---

## Adapter roadmap

Recommended next adapters:

```text
1. adapters/mcp          expose RStack tools to MCP clients
2. adapters/claude-code  export agents/commands/skills into Claude Code layout
3. adapters/codex        generate AGENTS.md + task runner
4. adapters/gemini       generate GEMINI.md + command pack
5. adapters/qwen         generate AGENTS.md + command pack
6. adapters/sdk          Node/Python library for custom harnesses
```

---

## More docs

```text
docs/public/pi-extension.md
docs/public/productivity-roadmap.md
docs/public/product-overview.md
```

---

## License

MIT
