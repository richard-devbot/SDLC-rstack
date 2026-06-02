# Changelog

<!-- owner: RStack developed by Richardson Gunde -->

All notable changes to RStack are documented here. Entries are user-focused:
what you can now do that you couldn't before.

## [1.7.1] - 2026-06-02

### Security
- **Approval gates can no longer be spoofed or abused** (closes a pre-release
  audit). Approving from the dashboard now requires a signed token
  (`RSTACK_APPROVAL_TOKEN`) and a same-origin request, and records audit-proof
  actor evidence — a script can't submit an arbitrary manager name anymore.
  Without the token configured, browser approvals are disabled by default;
  `sdlc_approve` continues to enforce the manager allow-list.
- **Approval ids can no longer escape the run directory.** Run ids, task ids,
  and artifact names in approval ids are strictly validated and every write is
  asserted to stay inside `.rstack/runs/<run>` with a real manifest — closing a
  path-traversal write.

## [1.7.0] - 2026-06-02

### Added
- **Read what your agents actually produced.** Open any run and browse its
  real deliverables — requirements, architecture, QA report, security review,
  release readiness, the plan itself — right in the dashboard, grouped by
  stage, with the evidence records beside them. No more digging through
  `.rstack/` folders by hand.
- **The dashboard now comes to you in every framework.** It already popped up
  on Pi session start; now Operator sessions launch it too, Claude Code
  projects get a SessionStart hook from `init`, and any custom harness can
  call one command: `npx rstack-agents hub`.

### Changed
- **README rewritten** — 7× shorter, user-first, and honest: includes a
  "what gets recorded (and what doesn't)" section that states plainly that
  LLM token usage/cost is not captured until host-side instrumentation lands.

## [1.6.0] - 2026-06-02

### Added
- **Studio 3D** at `/studio3d` — the full three.js workspace, live. Fifteen
  robot workstations along a conveyor, each monitor showing its agent's
  persona and live status; work packets flow while agents are building. Walk
  up to any agent and click: **what they worked on, what they shipped, and
  why they're waiting** (approval gate, upstream stages, or a failed
  attempt). Click the Manager for the run briefing — who started it, the
  numbers, the approvals — and jump back into the Business Hub scoped to
  that run. Pick any run session from the selector; share it with `#run=`
  links. Reached from the Studio page via "Enter the 3D Studio →".

## [1.5.0] - 2026-06-02

### Added
- **The Studio.** A Jarvis-style live view of your agent team: all 15 SDLC
  stages as workstations with personas you recognize ("Senior Developer —
  Build the Software"), status as breathing glow — amber means working right
  now, green done, blue queued, red needs review. The Manager narrates the
  latest progress as it happens, and each agent "reports in" with what it
  just did. Click any workstation to get that agent's full report and jump
  into the run.

## [1.4.0] - 2026-06-02

### Added
- **The dashboard now knows your team.** Every run records who started it,
  every approval records the real approver (from git identity or
  `RSTACK_USER`), and every clarification records who guided the agents and
  what they said. Older runs show as "unattributed" — nothing breaks.
- **Team & Presence page.** See who is live and working right now (pulsing
  presence, current task and agent), a people directory (runs started,
  approvals given, guidance contributed), and a manager rollup per project —
  run counts, average duration, pass rate, pending approval gates.
- **Approval gates you can't miss.** The moment work blocks on an approval,
  every configured channel (Slack, Teams, Discord, Telegram, WhatsApp) is
  paged, and the dashboard pops a browser notification.
- **Enforceable approval policy.** `.rstack/policy.json` makes selected stages
  require sign-off in *every* mode — express runs can no longer ship without
  the manager's approval.
- **Switch context anywhere.** A project → run switcher in the top bar scopes
  every page to the run you care about, remembers your choice, and supports
  shareable `#run=…` links for Slack.

## [1.3.0] - 2026-06-02

### Added
- **Notifications on five channels.** Your SDLC events — run started, task
  validated, execution reports, approvals — can now reach **Slack, Microsoft
  Teams, Discord, Telegram, and WhatsApp**, all at once. Configure any mix of
  channels via environment variables or `.rstack/notifications.json`; one
  event fans out to every channel you've set up.
- **`npx rstack-agents notify --test`.** Verify your webhook setup in seconds:
  sends a test message to every configured channel and reports per-channel
  success or failure.
- A failing webhook never fails a run — channel errors are reported, never
  thrown.

## [1.2.0] - 2026-06-02

### Added
- **One-command setup: `npx rstack-agents init`.** You can now drop RStack into
  any project in under two minutes. It auto-detects your host framework
  (Pi, Claude Code, Operator — or custom), creates the `.rstack/` state
  directory, registers the project with the Business Hub, writes
  framework-specific scaffolding, and prints exactly what to do next.
  Running it twice is safe — it never overwrites your files.
- **Per-framework integration guides** under `docs/integrations/` — including
  the full adapter contract for plugging RStack into any agent framework.
- **`RSTACK_REGISTRY_DIR`** environment override for the global project
  registry, so CI and tests never touch your real `~/.rstack`.

## [1.1.0] - 2026-06-02

### Added
- **Run Analytics page in the Business Hub.** You can now see every run as a
  wall-clock Gantt timeline — each task attempt drawn start-to-finish, colored
  by pass/fail/running — plus per-run KPIs for duration, tool calls, pass/fail
  counts, average quality score, and cost.
- **Stage duration insights.** Average time spent in each of the 15 SDLC stages,
  aggregated across every run you've ever recorded — historical runs included,
  no re-instrumentation needed.
- **Run-over-run trends.** Compare your last 30 runs side by side: duration,
  tool calls, pass/fail, quality, and cost — click any row to drill into the run.
- **Richer run drill-down.** The run drawer now shows duration and quality KPIs
  and the task Gantt alongside the per-minute activity feed.
- **Duration column** in the Run Sessions table.

### Fixed
- **Stage metrics are now correct.** Stage-completion events used to be recorded
  against plan task ids instead of canonical SDLC stages, so per-stage timing
  was attributed to stages that don't exist. New runs record correctly, and the
  dashboard transparently remaps old runs so history stays accurate.
- **Stage checkpoints actually save now.** Checkpoints silently failed for every
  plan task, which meant `sdlc_rollback` had nothing to restore. Each canonical
  stage a task produces is now checkpointed on validation pass.
- **`metrics.json` is now populated.** Per-stage elapsed time and status are
  written on every validation pass instead of staying empty.
- **Less wasted work when Slack isn't configured.** Validation no longer builds
  full notification reports (or dumps payloads to the console) when no webhook
  is set.

## [1.0.3] - 2026-06-01

Baseline release: Business Hub multi-run dashboard, SDLC layer folder
structure (`src/core`, `src/observability`, `src/integrations`), Pi and
Operator adapters with compatibility shims, and green CI.
