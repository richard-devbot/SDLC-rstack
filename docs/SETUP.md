<!-- owner: RStack developed by Richardson Gunde -->

# RStack — Setup & Usage (every harness, one page)

Everything an end user needs to install, wire, and run RStack, organized by AI
coding harness. RStack is a governed AI-SDLC layer that sits **on top of** your
coding agent (Pi, Claude Code, Tau, Operator, Hermes, or a custom harness) and
gives it a repeatable 15-stage lifecycle with approvals, builder/validator
contracts, evidence, budgets, enforcement guardrails, and a live dashboard.

> **The 30-second version:** `npm install rstack-agents` → `npx rstack-agents init --framework <your-harness>` → follow the printed steps → `npx rstack-agents doctor` to confirm enforcement is live → drive a run through the `sdlc_*` tools.

---

## Contents

1. [Prerequisites](#1-prerequisites)
2. [Install (universal)](#2-install-universal)
3. [Initialize a project (universal)](#3-initialize-a-project-universal)
4. [Set up your harness](#4-set-up-your-harness) — Pi · Claude Code · Tau · Operator · Hermes · Custom
5. [Verify enforcement (`doctor`)](#5-verify-enforcement-doctor)
6. [Run a governed pipeline](#6-run-a-governed-pipeline)
7. [Approvals & the human gate](#7-approvals--the-human-gate)
8. [Business Hub dashboard](#8-business-hub-dashboard)
9. [CLI reference](#9-cli-reference)
10. [Environment variables](#10-environment-variables)
11. [Troubleshooting](#11-troubleshooting)

---

## 1. Prerequisites

- **Node.js ≥ 18** with `npm` and `npx` on `PATH` (RStack's core + bridge are Node; `npx` ships with Node).
- Your coding harness installed (Pi, Claude Code, Tau, Operator, Hermes, …).
- Run `npm install` once in the package directory so the bridge's dependencies (`tsx`, the harness modules) are present.

Check Node:

```bash
node --version   # v18+  →  npx is available
```

---

## 2. Install (universal)

```bash
npm install rstack-agents
```

That's the only package. It ships the harness core, the 18 `sdlc_*` tools, every
adapter, the enforcement guard, the agent/skill/plugin library, and the Business
Hub.

---

## 3. Initialize a project (universal)

From your project root:

```bash
npx rstack-agents init --framework <pi|claude-code|operator|tau|hermes|custom>
```

`init` is **idempotent and non-destructive** — it creates new files, never
rewrites yours, and prints exactly what it made and what you still need to do.

**Common flags**

| Flag | Effect |
|---|---|
| `--framework <name>` | Target harness. Omit to auto-detect. |
| `--profile <name>` | Governance profile: `business-flex` (default), `lean-mvp`, `enterprise`, … |
| `--fresh` | Archive any prior `.rstack/` state aside and start clean (nothing deleted). |
| `--gates plan,tdd,scope` | Opt-in quality-gate presets (Claude Code / Tau). Off by default. |

**What it creates** (per project): `.rstack/` run state, `rstack.config.json`
(profile + enabled domains/plugins), `budget.json`, `integrations.json`
(endpoints only — secrets stay in `.env`), and the governance files
`SOUL.md` / `HEARTBEAT.md` (+ `CLAUDE.md` on Claude Code, `AGENTS.md` on custom).

Then verify:

```bash
npx rstack-agents doctor            # env + config + wiring + a LIVE guard self-test
```

---

## 4. Set up your harness

The enforcement depth depends on what your host exposes. Everyone gets the
governed state, contracts, approvals, budgets, evidence, and dashboard (via the
shared `sdlc_*` tools); the **live tool-call gate** (destructive-action gate +
read-only validator sandbox) needs a pre-tool hook.

| Harness | Setup | Live tool-call gate | Notes |
|---|---|:--:|---|
| **Pi** | native extension (auto-loaded) | ✅ | reference implementation |
| **Claude Code** | `PreToolUse` hook + plugin | ✅ | installed by `init` |
| **Tau** | extension + `tool_call` hook | ✅ | via the Node bridge |
| **Hermes** | plugin (`register(ctx)`) | ✅ | `pre_tool_call` gate |
| **Operator** | bridge tools | ⚠️ manual | host has no blocking hook — wire the guard yourself |
| **Custom** | bridge + your hook | ⚠️ DIY | [wire-your-own-harness](integrations/wire-your-own-harness.md) |

### Pi

```bash
npm install rstack-agents
npx rstack-agents init --framework pi
```

Pi auto-loads the SDLC extension from the package (`pi.extensions` in its
`package.json`) — no wiring needed. Start a run from any Pi session:
`sdlc_start { goal: "…" }`.

### Claude Code

```bash
npx rstack-agents init --framework claude-code
```

`init` writes `.claude/settings.json` (or drops `.claude/rstack-hooks.json` next
to an existing one to merge). That wires:

- **`PreToolUse` → `rstack-agents guard`** — the enforcement gate (exit 2 blocks).
- `SessionStart` / `UserPromptSubmit` → context injection; `PostToolUse`/etc → observability; `Notification` → your channels; a `statusLine` for live run state.

Then install the plugin and drive it:

```text
/plugin marketplace add richard-devbot/SDLC-rstack   # or your marketplace
/plugin install sdlc-automation
/sdlc-start
```

Optional quality gates: `init --framework claude-code --gates plan,tdd,scope`.

### Tau

```bash
npm install rstack-agents
npx rstack-agents init --framework tau
```

Merge `rstack-tau.example.json` into your Tau `settings.json` extensions list.
Loading the extension **is** the wiring — it routes Tau's terminal/write/edit
tools through `rstack-agents guard` on the `tool_call` hook. Optional gates via
the `quality_gates` setting or `RSTACK_TAU_GATES`.

### Operator

```bash
npm install rstack-agents
npx rstack-agents init --framework operator
```

Merge `rstack-operator.example.json` into your Operator settings. Operator
exposes **no blocking tool-call hook**, so it gets the full bridge-tool
governance (state, approvals, budgets, checkpoints) but the destructive gate must
be wired into your host's own pre-exec — see
[wire-your-own-harness](integrations/wire-your-own-harness.md):

```bash
echo '{"tool_name":"Bash","tool_input":{"command":"rm -rf /tmp/x"}}' \
  | npx rstack-agents guard --context builder   # exit 2 = blocked
```

### Hermes

Hermes loads plugins from `~/.hermes/plugins/`. Install the shipped plugin:

```bash
npm install rstack-agents
npx rstack-agents init --framework hermes
mkdir -p ~/.hermes/plugins/rstack-sdlc
ln -s "$(pwd)/node_modules/rstack-agents/src/integrations/hermes/rstack_sdlc.py" \
      ~/.hermes/plugins/rstack-sdlc/__init__.py
```

Loading the plugin **is** the wiring — `register(ctx)` registers the `sdlc_*`
tools and routes Hermes' terminal/write/edit tools through `rstack-agents guard`
on the `pre_tool_call` hook (returns a `{"decision":"block"}` Hermes honors).

### Custom (any other harness)

Any framework that can (a) run a shell command per tool call and (b) call a Node
binary can plug in. Reuse the generic bridge for tool calls and the guard for
enforcement:

```bash
# one tool call:
RSTACK_PROJECT_ROOT="$(pwd)" \
  npx tsx node_modules/rstack-agents/bin/rstack-bridge.ts sdlc_status '{}'

# enforcement on your pre-tool hook:
echo '<PreToolUse-JSON>' | npx rstack-agents guard --context builder
```

Full contract + a paste-in wiring prompt:
[adapter-contract](integrations/adapter-contract.md) ·
[wire-your-own-harness](integrations/wire-your-own-harness.md).

---

## 5. Verify enforcement (`doctor`)

```bash
npx rstack-agents doctor --framework <name>     # add --json for machine output
```

`doctor` checks env, `.rstack` config, per-framework wiring, hub health, and runs
a **live guard self-test** — it spawns the real guard and asserts a destructive
call blocks (exit 2) and a safe call passes (exit 0), so you know enforcement is
actually live on this machine, not just configured. Every FAIL prints its fix.

---

## 6. Run a governed pipeline

The lifecycle is the same on every harness — the orchestrator drives these tools
(names identical across harnesses; on Claude Code use the `/sdlc-*` commands):

```text
sdlc_start → sdlc_clarify → sdlc_plan → sdlc_build_next → sdlc_validate → sdlc_approve → … → release
```

| Tool / command | Does |
|---|---|
| `sdlc_start { goal }` | Begin a governed run under `.rstack/runs/<id>/` |
| `sdlc_clarify` | Capture product-owner answers before planning |
| `sdlc_plan` | Build the stage/task graph |
| `sdlc_build_next` | Claim + prepare the next builder task (enforces attempt budgets) |
| `sdlc_validate` | Read-only validation report (enforces telemetry budgets) |
| `sdlc_approve { artifact, status }` | Record a human approval/rejection at a gate |
| `sdlc_status` | Run status, task progress, next recommended action |

**Resume / drive from the CLI** (any harness, via the bridge or the pipeline runner):

```bash
npx rstack-agents pipeline status [--json]                 # where the run stands
npx rstack-agents pipeline run --run-id <id> --max-steps 5 # advance, stopping at every gate
npx rstack-agents pipeline loop --run-id <id>              # bounded goal loop (budget-capped)
```

Adopt an existing codebase (brownfield) instead of starting fresh:

```bash
npx rstack-agents adopt            # read-only scan → proposes a governed run; --dry-run writes nothing
```

---

## 7. Approvals & the human gate

Gated work (destructive actions, stage sign-offs, budget overrides) waits for a
human. Resolve from the CLI or the dashboard:

```bash
# from a session:
sdlc_approve { run_id, artifact: "destructive-action:007-impl", status: "APPROVED" }
```

- A destructive action needs an audited `destructive-action:<taskId>` approval.
- A task that exhausts its attempt budget hard-blocks; grant one more attempt by approving `guardrail-override:<taskId>`.
- Approvals are a trust boundary: forged/edited records are rejected by the audit, and (with `RSTACK_APPROVAL_SIGNING_KEY` set) must carry a valid signature.

Manager allowlist: set `RSTACK_MANAGERS="alice,bob"` (or `policy.json` `managers`)
to restrict who may approve.

---

## 8. Business Hub dashboard

```bash
npx rstack-business            # or: npx rstack-agents hub   (port 3008)
```

Live run timelines, stage durations, approvals (approve/reject from the UI, token-gated),
alerts, evidence, traceability, and budget visibility. Controls:

```bash
export RSTACK_BUSINESS_PORT=3008        # change the port
export RSTACK_NO_BUSINESS_HUB=1         # never auto-launch
export RSTACK_DASHBOARD_READ_TOKEN=…    # gate read access
export RSTACK_APPROVAL_TOKEN=…          # gate approve/reject actions
```

---

## 9. CLI reference

```bash
npx rstack-agents <command>
```

| Command | Purpose |
|---|---|
| `init [--framework] [--profile] [--fresh] [--gates]` | Set up RStack in a project |
| `doctor [--framework] [--json]` | Verify setup + live enforcement self-test |
| `adopt [--dry-run]` | Reverse-populate a governed run from an existing codebase |
| `guard [--context builder\|validator] [--task] [--command\|--path]` | Framework-neutral enforcement gate (exit 0 allow / 2 block) |
| `gate <plan\|tdd\|scope>` | Opt-in quality-gate preset (host hook) |
| `pipeline status [--json] [--regenerate]` | Show run state |
| `pipeline run --run-id <id> [--max-steps N]` | Advance the run, stopping at gates |
| `pipeline loop --run-id <id>` | Bounded, budget-capped goal loop |
| `context` / `observe` / `notify-hook` / `statusline` | Host hooks: context injection, observability, notifications, status bar |
| `env scan [--json]` | Detect environment + propose run mode |
| `validate [--schemas]` | Validate agents / state against the spec |
| `list agents\|skills\|plugins` | Browse the catalog |
| `hub` / `rstack-business` | Launch the Business Hub |

Two bins ship for adapters: `rstack-bridge` (framework-neutral tool bridge) and
`rstack-business` (dashboard).

---

## 10. Environment variables

| Variable | Purpose |
|---|---|
| `RSTACK_PROJECT_ROOT` | Project root for bridge/guard calls |
| `RSTACK_WORKER_COMMAND` | CLI used for delegated worker subprocesses (default `pi`) |
| `RSTACK_DEFAULT_MODEL` / `RSTACK_ESCALATED_MODEL` | Model for builders / for retried tasks |
| `RSTACK_ALLOW_DESTRUCTIVE=1` | Skip the destructive gate (builder only) — use sparingly |
| `RSTACK_GUARD_FAIL_OPEN=1` | Allow tool calls when the guard **can't run** (default: fail closed) |
| `RSTACK_APPROVAL_SIGNING_KEY` | HMAC-sign approval records (defense in depth; CI/remote/multi-user) |
| `RSTACK_TASK_ID` | Active task id — keys destructive approvals + the budget block |
| `RSTACK_AGENT_CONTEXT` / `RSTACK_VALIDATOR_CONTEXT=1` | Declare builder vs read-only validator context to the guard |
| `RSTACK_MANAGERS` / `RSTACK_MANAGER_USERS` | Approval allowlist |
| `RSTACK_SLACK_WEBHOOK` | Slack/Teams/Discord notifications |
| `RSTACK_STATE_DIR` | Override `.rstack/` location |
| `RSTACK_BUSINESS_PORT` / `RSTACK_NO_BUSINESS_HUB` / `RSTACK_NO_BROWSER` | Dashboard controls |
| `RSTACK_DASHBOARD_READ_TOKEN` / `RSTACK_APPROVAL_TOKEN` | Dashboard read / action auth |

Secrets belong in `.env`, never in `.rstack/*.json` (config validation rejects
credential-shaped keys there).

---

## 11. Troubleshooting

| Symptom | Fix |
|---|---|
| `npx: command not found` | Install Node ≥ 18 (ships `npx`): https://nodejs.org |
| `doctor` reports a wiring FAIL | Run the exact fix it prints; re-run `doctor`. |
| Guard "unavailable" blocks everything | The guard couldn't load (partial install / offline `npx`). Fix the install, or set `RSTACK_GUARD_FAIL_OPEN=1` to allow without enforcement. |
| Hub won't start / wrong port | `RSTACK_BUSINESS_PORT=<free-port>`; or `RSTACK_NO_BUSINESS_HUB=1` to disable auto-launch. |
| Approval "not allowed by manager policy" | Add the approver to `RSTACK_MANAGERS` or `policy.json` `managers`. |
| A validator can't write files | That's the sandbox working — validators are read-only. Run mutations as a builder. |
| Self-dependency error | Don't `npm install rstack-agents` **inside** the rstack-agents repo; use a separate project dir. |

More depth: [HARNESS.md](HARNESS.md) (run state, contracts, guardrails) ·
[quick-start-guide](quick-start-guide.md) ·
[brownfield-adoption](brownfield-adoption.md) ·
[integrations/](integrations/) (per-harness detail).
