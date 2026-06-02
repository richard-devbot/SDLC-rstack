# RStack SDLC

<!-- owner: RStack developed by Richardson Gunde -->

**A governed SDLC for AI coding agents — in any framework.**
RStack gives agent teams a repeatable, auditable 15-stage pipeline with human
approval gates, builder/validator contracts, evidence, episodic memory, and a
live company dashboard. Developed by **Richardson Gunde**.

```text
clarify → plan → spec → approve → build → validate → release-readiness → learn
```

## Install — 2 minutes, any framework

```bash
cd your-project
npm install rstack-agents
npx rstack-agents init        # auto-detects: pi | claude-code | operator | custom
```

| Your framework | What init does | Guide |
|---|---|---|
| **Pi** | Nothing else needed — Pi auto-loads the native extension; `sdlc_*` tools appear in the next session | [docs/integrations/pi.md](docs/integrations/pi.md) |
| **Claude Code** | Writes a usage guide + a SessionStart hook so the dashboard pops up every session; install `/plugin install sdlc-automation` | [docs/integrations/claude-code.md](docs/integrations/claude-code.md) |
| **Operator** | Writes a settings template for the Python adapter (bridges to the same harness) | [docs/integrations/operator.md](docs/integrations/operator.md) |
| **Anything else** | The `.rstack/` state contract + a Node bridge any harness can shell out to | [docs/integrations/custom.md](docs/integrations/custom.md) |

Start a governed run from your agent session:

```text
sdlc_start(goal="Build a checkout flow with Stripe, tests, and release readiness")
```

## The Business Hub — live observability on :3008

The dashboard **launches automatically when a session starts** (Pi, Claude
Code hook, Operator) — or bring it up from any harness:

```bash
npx rstack-agents hub
```

What it shows, across **every project on the machine**:

| Page | What you get |
|---|---|
| **Studio / Studio 3D** | Jarvis-style live agent workspace — who's working right now, status as glow; the 3D scene (`/studio3d`) lets you click any agent: *what they worked on, what they shipped, why they're waiting* |
| **Run Analytics** | Wall-clock Gantt per run, stage duration averages, run-over-run trends |
| **Team & Presence** | Who is live now, people directory (runs / approvals / guidance per person), manager rollup per project |
| **Projects & Runs** | Every session; open a run to **read its actual deliverables** — requirements, architecture, QA report, security review — plus evidence records |
| **Approvals / Alerts** | Approve or reject gates from the browser; popups when new gates block |
| **Workflow / Traceability** | 15-stage map with live states; requirement → stage → task → evidence chains |

Switch project/run scope from the top bar; share `#run=<id>` links in Slack.

## Approvals — no change ships without sign-off

- Interactive runs gate planning, requirements, and architecture by default
- `.rstack/policy.json` makes chosen stages require approval **in every mode**
  (express included):

```json
{ "required_approvals": { "008-release-readiness": ["release-readiness.json"] } }
```

- The moment a gate blocks, **every configured channel is paged** and the
  dashboard pops a notification
- Every approval records the real approver (git identity or `RSTACK_USER`)
- Approving from the dashboard requires a signed token (`RSTACK_APPROVAL_TOKEN`)
  so a manager's identity can't be spoofed from the browser; `sdlc_approve`
  enforces the `policy.json` manager allow-list. Without the token set,
  browser approvals are disabled (secure default) — approve via `sdlc_approve`.

## Notifications — Slack, Teams, Discord, Telegram, WhatsApp

One event fans out to every channel you configure (env vars or
`.rstack/notifications.json`). Verify in seconds:

```bash
npx rstack-agents notify --test
```

Full setup: [docs/integrations/webhooks.md](docs/integrations/webhooks.md).

## What gets recorded (and what doesn't)

Every run stores its full audit trail under `.rstack/runs/<run-id>/`:
manifest (incl. **who started it**), tasks with builder/validator contracts,
an append-only event stream, evidence records, stage artifacts, approvals,
human guidance (who answered what), stage timings, and checkpoints for
`sdlc_rollback`. The dashboard derives everything from these files — no
database, no telemetry leaves your machine.

**Honest limitation:** LLM token usage and real cost are not captured —
the host framework executes the model calls, so the harness never sees usage.
Cost shows $0 unless a builder reports it in its contract. Host-side usage
instrumentation is on the roadmap.

## CLI reference

| Command | Purpose |
|---|---|
| `rstack-agents init [-f framework]` | Set up RStack in a project (idempotent) |
| `rstack-agents hub` | Ensure the dashboard is running and open it |
| `rstack-agents notify [--test]` | Inspect / test notification channels |
| `rstack-agents list agents\|skills\|plugins` | Browse the packaged catalog (196 agents) |
| `rstack-agents add plugin <name>` | Copy a packaged plugin into the project |
| `rstack-agents validate` | Validate packaged agent definitions |
| `rstack-business [--port N] [--project path]` | Run the dashboard directly |

### Environment

| Variable | Purpose |
|---|---|
| `RSTACK_USER` / `RSTACK_USER_EMAIL` | Identity for runs/approvals (defaults to git config) |
| `RSTACK_BUSINESS_PORT` | Dashboard port (default 3008) |
| `RSTACK_NO_BUSINESS_HUB=1` | Disable dashboard auto-launch |
| `RSTACK_APPROVAL_TOKEN` | Required to approve from the dashboard (prevents identity spoofing) |
| `RSTACK_MANAGER_USERS` | Comma-separated manager allow-list (also in `policy.json`) |
| `RSTACK_SLACK_WEBHOOK` etc. | Notification channels — see webhooks guide |
| `RSTACK_DEFAULT_MODEL` / `RSTACK_ESCALATED_MODEL` | Models for delegated builders (escalation at attempt ≥ 2) |

## Architecture

```
src/
├── core/             harness (stages, contracts, evidence, guardrails,
│                     run-state, identity) + tracker (registry, approvals)
├── observability/    collectors · Business Hub dashboard · alerts · metrics
├── integrations/     pi/ · operator/ · init (claude-code + custom)
├── notifications/    channels (slack, teams, discord, telegram, whatsapp) + router
└── memory/           episodic memory, retrieval, diagnostics
```

Layer rules and the full map: [src/README.md](src/README.md).
Adapter contract for new frameworks: [docs/integrations/custom.md](docs/integrations/custom.md).
Harness internals: [docs/HARNESS.md](docs/HARNESS.md).

## Development

```bash
git clone https://github.com/richard-devbot/SDLC-rstack.git
cd SDLC-rstack && npm install
npm test          # 100+ tests
npm run lint
npm run validate  # 196 packaged agents
```

Changes follow issues-first: every PR closes a GitHub issue. See
[CHANGELOG.md](CHANGELOG.md) for what each release lets you do.

## License

MIT © Richardson Gunde
