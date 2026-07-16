# RStack Integrations

<!-- owner: RStack developed by Richardson Gunde -->

RStack is a plugin, not a platform: it plugs into the agent framework you
already use. One command sets up any project:

```bash
npx rstack-agents init                      # auto-detects your framework
npx rstack-agents init --framework pi       # or be explicit
```

| Framework | Guide | Adapter |
|---|---|---|
| Pi | [pi.md](pi.md) | `src/integrations/pi/rstack-sdlc.ts` (native TypeScript extension) |
| Claude Code | [claude-code.md](claude-code.md) | `sdlc-rstack` plugin (`/sdlc-*` commands) + PreToolUse `rstack-agents guard` hook |
| Operator | [operator.md](operator.md) | `src/integrations/operator/rstack_sdlc.py` (Python, bridges to Node) |
| Tau | [tau.md](tau.md) | `src/integrations/tau/rstack_sdlc.py` (Python, bridges to Node + self-wiring guard hook) |
| Anything else | [custom.md](custom.md) | The `.rstack/` state contract + Node bridge |

Writing a new adapter? The conformance checklist every adapter must satisfy —
tool surface, bridge protocol, guard wiring, hub launch, env passthrough —
lives in [adapter-contract.md](adapter-contract.md), enforced by
`tests/bridge-conformance.test.js`.

Runtime enforcement (destructive gate + validator sandbox) is framework-neutral:
any harness with a tool-call hook wires it via `rstack-agents guard` — see
[wire-your-own-harness.md](wire-your-own-harness.md) for a paste-in guided
prompt that makes your coding agent do the wiring.

Want spec-first / test-first / in-scope discipline on top of that? The **opt-in
quality gates** (`plan-gate`, `tdd-gate`, `scope-guard`) wire alongside guard —
off by default, opinionated on purpose. See [quality-gates.md](quality-gates.md).

Notifications for all of them: **Slack, Teams, Discord, Telegram, WhatsApp** —
see [webhooks.md](webhooks.md).

Every integration shares the same core: governed stages, builder/validator
contracts, evidence, approvals — and the same Business Hub dashboard:

```bash
npx rstack-business   # multi-project observability on :3008
```

## Everyday commands (any framework)

These CLI commands work the same on every harness — they operate on `.rstack/`
state directly, so they behave identically whether you run Pi, Claude Code,
Operator, Tau, or a custom host. Run them from your project root.

| Command | What it does |
|---|---|
| `npx rstack-agents init [--framework <x>]` | Set up RStack in this project (auto-detects the host) |
| `npx rstack-agents doctor [--framework <x>]` | Verify setup + prove enforcement is live; every failure prints its fix. Run this first |
| `npx rstack-agents pipeline status` | Authoritative run state in the terminal (`--json` for machines, `--regenerate` to rebuild) |
| `npx rstack-agents pipeline run [--dry-run]` | Advance the run: skip DONE work, re-claim retryable failures, stop at every human gate |
| `npx rstack-agents pipeline loop --goal <file>` | Bounded goal loop (default 3 iterations, hard cap 20, budget brake, no-progress stop) |
| `npx rstack-agents adopt [--dry-run]` | Brownfield: harvest an existing codebase into stages 00–06 (`--dry-run` writes nothing) |
| `npx rstack-agents decisions [--add\|--resolve\|--waive]` | Manage the Decision Queue that gates later stages |
| `npx rstack-agents dor --stage <id>` | Run the Definition-of-Ready gate for a stage |
| `npx rstack-agents env scan [--json]` | Detect run mode + tools + setup needs for stage 00 |
| `npx rstack-agents guard` | The enforcement gate any tool-call hook calls (stdin PreToolUse JSON → exit 0 allow / exit 2 block) |
| `npx rstack-agents gate <name>` | Opt-in quality-gate preset (plan-gate/tdd-gate/scope-guard) — spec-first / test-first / in-scope discipline. Off by default; see [quality-gates.md](quality-gates.md) |
| `npx rstack-agents notify --test` | Send a test message to every configured notification channel |
| `npx rstack-agents list agents\|skills\|plugins` | Browse the packaged catalog |
| `npx rstack-agents validate` | Validate all packaged agent definitions |
| `npx rstack-business` | Launch the Business Hub dashboard on :3008 |

**First five minutes on any harness** — copy-paste, run outside this repo:

```bash
mkdir ~/rstack-test && cd ~/rstack-test          # a scratch project, NOT the rstack-agents repo
npm install rstack-agents
npx rstack-agents init --framework <pi|claude-code|operator|tau|custom>
npx rstack-agents doctor --framework <same>       # all PASS = you are ready
npx rstack-business                                # watch runs live on :3008
```

Per-framework "test in 5 minutes" walkthroughs (with a real governed action)
live in [testing-matrix.md](testing-matrix.md).

## Detection rules

`init` without `--framework` picks:
1. `.claude/` directory exists → **claude-code**
2. `operator.json` or `operator_settings.json` exists → **operator**
3. `tau.json`, `tau_settings.json`, or `.tau/` exists → **tau**
4. `package.json` references Pi (`@earendil-works/*` or a `pi` key) → **pi**
5. otherwise → **custom**

## Environment configuration (all frameworks)

| Variable | Purpose |
|---|---|
| `RSTACK_SLACK_WEBHOOK` | Notification webhook (Slack, Teams, Discord auto-detected by URL) |
| `RSTACK_BUSINESS_PORT` | Business Hub port (default 3008) |
| `RSTACK_DEFAULT_MODEL` | Model for delegated builder agents |
| `RSTACK_ESCALATED_MODEL` | Model used when a task reaches attempt ≥ 2 |
| `RSTACK_STATE_DIR` | Override `.rstack/` location |
| `RSTACK_REGISTRY_DIR` | Override the global project registry (`~/.rstack`) |
