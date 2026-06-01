# RStack SDLC

<!-- owner: RStack developed by Richardson Gunde -->

**RStack SDLC** is a governed AI software-delivery harness developed by **Richardson Gunde**.

It gives AI coding agents a repeatable, auditable SDLC with human approval gates, builder/validator contracts, live dashboards, traceability, and memory across runs.

```text
clarify → plan → spec → approve → build → validate → release-readiness → learn
```

## Copy/paste quick start

```bash
pi install npm:rstack-agents
```

```bash
npx rstack-agents@latest business --project . --port 3008
```

```bash
npx rstack-agents@latest validate && npm test
```

## Handy one-line commands

| Task | Command |
|------|---------|
| Install for Pi | `pi install npm:rstack-agents` |
| Install globally with npm | `npm install -g rstack-agents` |
| Upgrade npm global install | `npm update -g rstack-agents` |
| Use latest without installing | `npx rstack-agents@latest validate` |
| Start Command Center | `rstack-business --project . --port 3008` |
| Start Command Center with npx | `npx rstack-agents@latest business --project . --port 3008` |
| Start dashboard compatibility alias | `rstack-observer --project .` |
| List agents | `rstack-agents list agents` |
| List skills | `rstack-agents list skills` |
| Validate packaged agents | `rstack-agents validate` |
| Run tests from checkout | `npm test` |
| Run release checks | `npm run lint && npm test && npm run validate && npm pack --dry-run` |
| Create release issue | `gh issue create --title "Release rstack-agents v1.0.3" --body "README refresh, Command Center docs, upgrade paths, release checklist"` |
| Create PR | `gh pr create --fill --base main --head docs/readme-command-center-release` |
| Dry-run npm package | `npm pack --dry-run` |

---

## Install

<details open>
<summary><strong>Pi, native adapter, recommended</strong></summary>

Pi gets the native RStack adapter, registered `sdlc_*` tools, lifecycle hooks, approval gates, and dashboard auto-launch.

```bash
pi install npm:rstack-agents
```

Install from a local checkout while developing:

```bash
git clone https://github.com/richard-devbot/SDLC-rstack.git
cd SDLC-rstack
npm install
pi install .
```

Start a governed run in Pi:

```text
Use RStack to build a production-ready checkout flow with tests, docs, and release readiness.
```

Or call tools directly:

```text
sdlc_start(goal="Build a checkout flow with Stripe, tests, and release readiness")
sdlc_clarify()
sdlc_plan()
sdlc_approve(artifact="plan.md", status="APPROVED")
sdlc_build_next()
sdlc_validate()
sdlc_status()
```

</details>

<details>
<summary><strong>Operator, native Python adapter through Node bridge</strong></summary>

Prerequisites: Node.js 18+ and npm on PATH.

```bash
npm install -g rstack-agents
pip install operator-use
```

Install package from Python:

```python
from operator_use.package.installer import install_package
install_package("npm:rstack-agents", get_packages_dir())
```

Install from local checkout:

```python
install_package("/path/to/SDLC-rstack", get_packages_dir())
```

Optional Operator settings:

```json
{
  "extension_list": [
    {
      "name": "rstack_sdlc",
      "enabled": true,
      "settings": {
        "worker_command": "pi",
        "allow_destructive": "0"
      }
    }
  ]
}
```

The Operator adapter reuses the TypeScript harness through `bin/rstack-operator-bridge.ts`.

</details>

<details>
<summary><strong>Claude Code, asset mode</strong></summary>

Asset mode gives Claude Code the RStack agent, skill, plugin, and governance files. Native tool-call blocking requires a dedicated adapter and is not automatic in asset mode.

```bash
git clone https://github.com/richard-devbot/SDLC-rstack.git .rstack/vendor/rstack
```

Add this to `CLAUDE.md`:

```markdown
## RStack SDLC

Use RStack SDLC from `.rstack/vendor/rstack`.
Start with `.rstack/vendor/rstack/agents/core/orchestrator.md`.
Use `.rstack/vendor/rstack/agents/core/builder.md` for implementation.
Use `.rstack/vendor/rstack/agents/core/validator.md` for verification.
Use `.rstack/vendor/rstack/agents/sdlc/` for lifecycle stages.
Write run state under `.rstack/runs/<run_id>/`.
Require builder.json, validation.json, traceability, and command evidence.
Never claim DONE without evidence.
```

Then ask Claude:

```text
Use RStack to plan, build, validate, and document: <your goal>
```

</details>

<details>
<summary><strong>Codex, Gemini, Qwen, Cursor, or any coding agent, asset mode</strong></summary>

Clone RStack into your project:

```bash
git clone https://github.com/richard-devbot/SDLC-rstack.git .rstack/vendor/rstack
```

For Codex or Qwen:

```bash
cp .rstack/vendor/rstack/docs/public/AGENTS.md.tmpl AGENTS.md
```

For Gemini CLI:

```bash
cp .rstack/vendor/rstack/docs/public/GEMINI.md.tmpl GEMINI.md
```

Manual bootstrap for any agent:

```bash
cat >> AGENTS.md <<'EOF'
# RStack SDLC

Use RStack SDLC from `.rstack/vendor/rstack`.
Read `agents/core/orchestrator.md` first.
Use `agents/core/builder.md` for implementation tasks.
Use `agents/core/validator.md` for read-only verification.
Use `agents/sdlc/` for lifecycle stages.
Write run state under `.rstack/runs/<run_id>/`.
Require specs, approvals, traceability, builder.json, validation.json, and command evidence.
Never claim DONE without evidence.
EOF
```

</details>

<details>
<summary><strong>Local development checkout</strong></summary>

```bash
git clone https://github.com/richard-devbot/SDLC-rstack.git
cd SDLC-rstack
npm install
npm run lint
npm test
npm run validate
npm run business
```

Type-check the Pi adapter:

```bash
npx tsc --noEmit --allowImportingTsExtensions --module NodeNext \
  --moduleResolution NodeNext --target ES2022 --skipLibCheck \
  extensions/rstack-sdlc.ts
```

</details>

---

## Upgrade existing installs

<details open>
<summary><strong>Already using Pi plus RStack SDLC</strong></summary>

Use this when you already installed RStack with `pi install npm:rstack-agents`.

```bash
pi install npm:rstack-agents@latest
```

If your Pi install supports package update commands, this is also safe:

```bash
pi update rstack-agents || pi install npm:rstack-agents@latest
```

Restart Pi after upgrading so extension tools and hooks reload.

Verify:

```bash
npx rstack-agents@latest validate
npx rstack-agents@latest business --project . --port 3008 --no-browser
```

</details>

<details>
<summary><strong>npm global install</strong></summary>

```bash
npm update -g rstack-agents
```

If update does not find the package:

```bash
npm install -g rstack-agents@latest
```

Check the installed binary:

```bash
rstack-agents validate
rstack-business --project . --port 3008 --no-browser
```

</details>

<details>
<summary><strong>npx users</strong></summary>

No permanent upgrade is needed. Always call the latest package:

```bash
npx rstack-agents@latest validate
npx rstack-agents@latest business --project . --port 3008
```

</details>

<details>
<summary><strong>Local checkout users</strong></summary>

```bash
cd /path/to/SDLC-rstack
git pull --ff-only
npm install
npm run lint
npm test
npm run validate
```

If you installed the local checkout into Pi, reinstall it after pulling:

```bash
pi install .
```

</details>

<details>
<summary><strong>Asset-mode integrations, Claude Code, Codex, Gemini, Qwen, Cursor</strong></summary>

If RStack was cloned into `.rstack/vendor/rstack`:

```bash
cd .rstack/vendor/rstack
git pull --ff-only
npm install
```

From the project root, verify the updated assets and dashboard:

```bash
npx rstack-agents@latest validate
npx rstack-agents@latest business --project . --port 3008 --no-browser
```

Restart your host agent so it reloads `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, or any copied prompts.

</details>

<details>
<summary><strong>Operator users</strong></summary>

```bash
npm install -g rstack-agents@latest
pip install --upgrade operator-use
```

If installed from a local package checkout:

```bash
cd ~/.operator/packages/git/github.com/richard-devbot/SDLC-rstack
git pull --ff-only
npm install
```

Restart Operator after upgrade so the Python extension reloads the Node bridge.

</details>

---

## Dashboard

RStack ships one local zero-dependency dashboard. It reads `.rstack/runs/` and the global `.rstack` project registry directly and does not require a cloud service.

<details open>
<summary><strong>RStack Command Center, primary dashboard, port 3008</strong></summary>

Use this for business/admin visibility across projects, runs, agents, approvals, guardrails, costs, traceability, and the 15-stage pipeline.

```bash
rstack-business --project . --port 3008
```

With npx:

```bash
npx rstack-agents@latest business --project . --port 3008
```

Local development:

```bash
npm run business
npm run business:dev
```

Open:

```text
http://localhost:3008
```

Common options:

```bash
rstack-business --project /path/to/project --port 3008 --no-browser
RSTACK_BUSINESS_PORT=3010 rstack-business --project .
RSTACK_NO_BUSINESS_HUB=1 pi
```

`rstack-observer` is kept as a compatibility alias and now opens the same Business Hub. New scripts should use `rstack-business`.

### Dashboard environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `RSTACK_BUSINESS_PORT` | `3008` | Command Center port |
| `RSTACK_PROJECT_ROOT` | `cwd` | Project root for the dashboard |
| `RSTACK_NO_BUSINESS_HUB` | `0` | Set to `1` to disable Pi auto-launch |
| `RSTACK_NO_BROWSER` | `0` | Set to `1` to suppress browser open |

---

## Runtime support

RStack core stays above host tools. Pi, Operator, Claude Code, Cursor, Codex, Gemini, Qwen, and future tools are integration adapters or asset consumers below the RStack lifecycle.

| Feature | Pi | Operator | Claude Code | Cursor | Codex / Gemini / Qwen |
|---------|:--:|:--------:|:-----------:|:------:|:---------------------:|
| Native `sdlc_*` tools | ✅ | ✅ | — | — | — |
| Tool-call safety gates | ✅ | ✅ | — | — | — |
| Lifecycle hooks | ✅ | ✅ | — | — | — |
| Human approval blocking | ✅ | ✅ | — | — | — |
| Agents, skills, plugins as assets | ✅ | ✅ | ✅ | ✅ | ✅ |
| Builder and validator contracts | ✅ | ✅ | ✅ | ✅ | ✅ |
| Command Center dashboard | ✅ | ✅ | ✅ | ✅ | ✅ |

Asset mode means the host agent reads RStack's Markdown/JSON operating assets and writes `.rstack/runs/` state. Native automatic blocking requires a host adapter.

---

## What RStack includes

```text
196 agents   ·   156 skills   ·   36 prompts   ·   72 plugins
```

| Layer | Purpose |
|-------|---------|
| `agents/core/` | Orchestrator, builder, validator team contracts |
| `agents/sdlc/` | 15-stage pipeline from environment to cost estimation |
| `agents/specialists/` | Backend, frontend, devops, QA, security, data, product, docs |
| `skills/` | Reusable workflow instructions |
| `prompts/` | Prompt templates and slash commands |
| `plugins/` | Domain packs with manifests, agents, skills, and commands |
| `extensions/rstack-sdlc.ts` | Pi native adapter |
| `extensions/rstack_sdlc.py` | Operator native adapter |
| `bin/rstack-operator-bridge.ts` | Operator Python to Node bridge |
| `src/dashboard/` | Unified RStack Business Hub server and UI on `:3008` |
| `src/harness/approval-queue.js` | Human-in-loop persistence |
| `src/harness/alert-engine.js` | Threshold alerts and summaries |
| `src/harness/memory.js` | Episodic memory and retrieval |
| `src/harness/guardrails.js` | Attempt, tool call, and cost limits |
| `src/harness/contracts.js` | Builder and validator contract validation |

---

## Tool reference, Pi and Operator

| Tool | Purpose |
|------|---------|
| `sdlc_orchestrate` | Load orchestrator, builder, and validator instructions |
| `sdlc_start` | Create `.rstack/runs/<run_id>/` state for a new run |
| `sdlc_clarify` | Capture product-owner answers before planning |
| `sdlc_plan` | Create lifecycle tasks, draft specs, routing metadata, traceability |
| `sdlc_spec` | Read or update spec artifacts |
| `sdlc_approve` | Record human approval or rejection gates |
| `sdlc_agents` | List agents, skills, and plugins by domain |
| `sdlc_delegate` | Spawn isolated worker agents |
| `sdlc_build_next` | Prepare the next gated builder task packet |
| `sdlc_validate` | Validate builder output and write `validation.json` |
| `sdlc_status` | Show run status, tasks, approvals, next action |
| `sdlc_memory` | Search or append project learnings |
| `sdlc_dashboard` | Generate a static dashboard for a run |
| `sdlc_trace` | Show a CLI trace for one task or run |
| `sdlc_rollback` | Roll back an SDLC stage checkpoint |

Pi slash commands:

```text
/sdlc          Start a governed SDLC run
/sdlc-agents   Browse available agents, skills, and plugins
```

---

## CLI reference

```bash
rstack-agents list agents
rstack-agents list skills
rstack-agents list plugins
rstack-agents validate
rstack-agents add plugin backend-development
rstack-business [--port 3008] [--project <path>] [--no-browser]
rstack-observer [--project <path>] [--no-browser] # compatibility alias for rstack-business
```

Package scripts from a checkout:

```bash
npm run lint
npm test
npm run validate
npm run business
npm run business:dev
npm run observer
npm run observer:dev
npm run build:all
```

---

## 15-stage SDLC pipeline

```text
00-environment              Scan tools, versions, project structure
01-transcript               Parse meeting notes into structured requirements
02-requirements             Extract functional and non-functional requirements
03-documentation            Generate BRD, FRD, SOW
04-planning                 Sprint plan, timeline, team composition
05-jira                     Epic, Story, Task hierarchy
06-architecture             HLD, API contracts, DB schema
07-code                     Production-ready code scaffolding
08-testing                  Test plan, cases, API tests, security checklist
09-deployment               Dockerfiles, CI/CD pipelines, IaC
10-summary                  Executive dashboard, artifact inventory
11-feedback-loop            Cross-pipeline consistency review
12-security-threat-model    STRIDE and OWASP Top 10
13-compliance-checker       HIPAA, GDPR, PCI-DSS, SOC 2 gap analysis
14-cost-estimation          Cloud cost forecast for AWS, Azure, GCP
```

---

## Governance model

RStack enforces this sequence:

```text
clarify → plan → spec → approve → build → validate → release-readiness → memory
```

Controls:

- No build before plan approval in interactive mode
- Destructive actions require explicit approval
- Validators default to read-only tools
- Every task requires acceptance criteria, `builder.json`, and `validation.json`
- Traceability is written to run artifacts
- No DONE without command evidence

Protected actions blocked unless approved:

```text
rm -rf          git push --force    npm publish
terraform apply/destroy             kubectl apply/delete
helm install/upgrade/uninstall      DROP TABLE / DELETE FROM
```

Protected write paths blocked unless approved:

```text
.env  .env.*  id_rsa  id_ed25519  credentials.*  secrets.*  .npmrc  .pypirc
```

To unblock a destructive action in a governed run:

```text
sdlc_approve(artifact="destructive-action", status="APPROVED")
```

---

## Generated run state

```text
.rstack/
  runs/
    <run_id>/
      manifest.json
      events.jsonl
      metrics.json
      tasks.json
      approvals.jsonl
      traceability.json
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
      tasks/
        <task_id>/
          prompt.md
          builder.json
          validation.json
```

Project memory:

```text
.rstack/memory/
  episodes.jsonl
  facts.jsonl
  retractions.jsonl
  retrieval-events.jsonl
```

---

## Notifications

```bash
export RSTACK_SLACK_WEBHOOK="https://hooks.slack.com/services/..."
export RSTACK_DISCORD_WEBHOOK="https://discord.com/api/webhooks/..."
export RSTACK_TEAMS_WEBHOOK="https://outlook.office.com/webhook/..."
```

Alert defaults:

| Threshold | Default |
|-----------|---------|
| Cost per run | `$0.50` |
| Daily total cost | `$5.00` |
| Guardrail hit rate | `20% of tasks` |
| Task failure rate | `30% of tasks` |
| Stalled run | `30 min without events` |
| Pending approvals | `>= 1` |

---

## Maintainer release flow

These commands are for maintainers. Do not publish until tests pass, `npm pack --dry-run` looks right, npm auth is confirmed, and the release version is approved.

<details open>
<summary><strong>Recommended issue and branch</strong></summary>

```bash
gh issue create \
  --title "Release rstack-agents v1.0.3" \
  --body "README install dropdowns, Command Center docs, upgrade commands, and release checklist."
```

```bash
git checkout -b docs/readme-command-center-release
```

</details>

<details>
<summary><strong>Validation before PR</strong></summary>

```bash
npm run lint
npm test
npm run validate
npm pack --dry-run
```

One line:

```bash
npm run lint && npm test && npm run validate && npm pack --dry-run
```

</details>

<details>
<summary><strong>Create PR</strong></summary>

```bash
git status --short
git add README.md eslint.config.js src/harness/business-observer.js src/harness/dashboard.js src/harness/memory-diagnostics.js src/harness/memory.js src/harness/observer.js src/harness/run-state.js
git commit -m "docs: refresh install and release guidance"
git push -u origin docs/readme-command-center-release
gh pr create --fill --base main --head docs/readme-command-center-release
```

Adjust the `git add` list if your working tree has different files.

</details>

<details>
<summary><strong>Version and npm publish, approval required</strong></summary>

Recommended semver for this README plus dashboard polish release: patch bump from `1.0.2` to `1.0.3`.

```bash
npm version patch --no-git-tag-version
npm run lint && npm test && npm run validate && npm pack --dry-run
npm whoami
npm publish --access public
```

If `npm whoami` fails:

```bash
npm login
npm whoami
```

After publish:

```bash
npm view rstack-agents version
pi install npm:rstack-agents@latest
npx rstack-agents@latest validate
```

</details>

---

## Adapter roadmap

| Status | Adapter |
|--------|---------|
| ✅ Shipped | Pi, native TypeScript adapter with full hooks |
| ✅ Shipped | Operator, native Python adapter through Node bridge |
| 🔜 Next | MCP, expose `sdlc_*` tools to any MCP client |
| 🔜 Next | Claude Code, native adapter with tool-call hooks |
| 📋 Planned | SDK, Node/Python library for custom harnesses |
| 📋 Planned | Codex, Gemini, Qwen, generated config packs |

The RStack Command Center works with all runtimes today because it reads `.rstack/runs/` directly.

---

## License

MIT, developed by Richardson Gunde.

Repository: [github.com/richard-devbot/SDLC-rstack](https://github.com/richard-devbot/SDLC-rstack)
