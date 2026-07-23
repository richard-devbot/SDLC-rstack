# Changelog

<!-- owner: RStack developed by Richardson Gunde -->

All notable changes to RStack are documented here. Entries are user-focused:
what you can now do that you couldn't before.

## [Unreleased]

> Nothing yet. Next work is tracked on the GitHub issue board.

---

## [2.2.0] - 2026-07-23

The "execute-and-observe" release. The governed loop stops trusting self-reports:
it now **runs your code in a sandbox and grades the result from the real exit code**,
feeds real failure logs back to the next attempt, and reports **risk and complexity**,
not just cost. Plus a hardened integrity core and the packaging fix so `npm install`
ships a lean tree.

### The loop now runs and observes your code (epic #450)
- **Transient Sandbox execution — "The Scientist."** `sdlc_validate` runs your
  authoritative test command inside a locked-down, disposable container (no network,
  dropped capabilities, non-root, read-only mount, resource caps) and folds the **real
  exit code** into the verdict — replacing the builder's self-reported `tests_run`.
  A failing run fails validation; a passing run is container-verified; no runtime (or
  no configured command) degrades honestly to "unverified", never a false green. The
  executed command is trusted (project/plan config), never the untrusted builder's.
- **The Scientist feeds the Critic.** On a retry, the previous attempt's **real
  stderr/stdout** is surfaced at the top of the builder's prompt, so it fixes exactly
  what broke instead of guessing (structured critique loop-back).
- **`doctor` reports the sandbox tier.** `rstack-agents doctor` now tells you whether
  execution is *container-verified* or *unverified*, and `doctor --start-runtime` opts
  into a bounded auto-start of Docker/Podman (never a hidden launch otherwise).
- **Quality & Risk Index.** The Business Hub Overview gains a dedicated card: an
  **Aggregated Risk Score** (severity-weighted, discounted when mitigated) and a
  **Complexity Index** (files touched, task breadth, executed commands), plus
  cost-to-value — so the Hub can say "green, but complexity spiked and two high-severity
  risks were accepted", not just "green, cost $X". Honest nulls when a source is absent;
  BI only, never blocks a gate.

### The Agent Force Studio comes alive (epic #431)
- The 3D Studio is now a **living digital twin**: glass rooms you can click into, a
  cinema camera that follows real activity, walking agents driven only by observed
  events, governance/evidence rooms that fill from real records, a manager mission
  wall, and a WebGPU rendering tier (with automatic WebGL fallback).

### Hardened integrity core (epic #442)
- **Approvals bind to artifact bytes, not just names** — editing an approved artifact
  re-blocks the gate (closes a UI approve-then-edit TOCTOU).
- **Concurrency-safe event + lock handling** — the run event log is written under a
  single lock (no torn/lost records undercounting attempts or cost); the file lock now
  fences a stalled owner's late write after a takeover; a mid-claim crash is recovered
  by an orphaned-claim reaper.
- **History can't be retro-rewritten** — each run renders through the stage taxonomy
  snapshotted at its start, so renaming/adding stages later can't rewrite past runs.

### Fixed
- **`npm install` is lean again.** The published package no longer ships ~125MB of
  unreferenced 3D-asset files — the tarball drops from ~164MB to ~33MB unpacked (#402).
- **Destructive-action guard false positives + a traversal bypass.** A benign heredoc
  no longer trips the git-force rule, and a path-traversal hole in the `.rstack/` config
  carve-out that could bypass write-protection is closed (#400/#401).

---

## [2.1.0] - 2026-07-17

The "governed on every harness, and you can trust it" release. RStack now runs the
same enforced loop on **Pi, Tau, Claude Code, Operator, and Hermes**, the guardrails
survive an adversarial agent, and the Business Hub can drive the loop, not just watch it.

### Works on every major harness
- **Claude Code gets a real plugin, not just a usage guide.** `/plugin marketplace add
  richard-devbot/SDLC-rstack` then `/plugin install sdlc-rstack` gives you 19 slash commands
  (`/sdlc-start`, `/sdlc-plan`, `/sdlc-approve`, `/sdlc-resume`, ...) — no manual hook wiring.
  The plugin catalog is also now organized by domain (`plugins/backend/`, `plugins/security/`, ...)
  for easier browsing.
- **Tau's enforcement gate genuinely blocks destructive actions.** Tool calls now route through
  the guard by way of Tau's real tool-loading mechanism, closing a gap where the previously-wired
  hook never actually fired on a live Tau session.
- **Hermes' enforcement gate genuinely blocks destructive actions.** A drop-in Hermes plugin
  registers the SDLC tools and routes tool calls through the same enforcement guard as everywhere
  else — install it into `~/.hermes/plugins/`, enable it, and destructive actions are blocked until
  approved, not just logged.
- **Operator now works, via a small wrapper.** `operator-use` has no plugin-loading mechanism of
  its own, so run `python node_modules/rstack-agents/src/integrations/operator/bootstrap.py start`
  in place of `operator start` to get RStack's tools and its real, blocking enforcement hook — every
  other Operator command behaves exactly like a stock install.
- **Validators are truly read-only on Claude Code now — including their shell.** A validator
  subagent can no longer write files via bash; the guard recognizes the validator from the
  subagent identity and applies the read-only sandbox, even for plugin-provided agents.
- **One-page setup for all of it.** New [`docs/SETUP.md`](docs/SETUP.md): install → per-harness
  wiring → running a governed pipeline → approvals → dashboard → CLI reference, in one place.

### Enforcement you can trust
- **An agent can no longer approve itself.** Writing to the files that govern the gates
  (`.rstack/…`, and the host's own guard-hook config) is now blocked on the shell path too,
  not just the write-tool path — closing a self-approval bypass. Optional HMAC provenance on
  approval records adds a second layer for CI/remote/multi-user setups.
- **The guard fails closed.** If the enforcement guard can't run (a partial install, an offline
  cold `npx`, a crash), tool calls are blocked with a clear reason instead of silently
  proceeding. Opt back into the old behavior with `RSTACK_GUARD_FAIL_OPEN=1`.
- **The destructive classifier caught up with real threats.** `git checkout -- .` / `git restore`
  / `git clean -f` (working-tree destruction), `curl … | bash` (download-and-execute), and
  `chmod -R` (recursive permission changes) are now gated. Ordinary work (`git checkout -b`,
  `chmod 644 file`, `curl -o file`) stays untouched.
- **A budget-exhausted task can't keep changing your code.** Once a task hard-blocks at its
  attempt budget, the guard refuses its further edits until a human approves one more attempt.

### Drive the loop from the cockpit
- **The Business Hub can now run the governed loop, not just observe it** — authenticated,
  audited controls (resume a run, restore a checkpoint) behind the same approval-token
  discipline, with per-desk approval gates and honest, real-browser-tested readiness.

### More control over the pipeline
- **Blanket per-stage human gates** (`required_stage_approvals`, `approvals.every_stage`) — require
  sign-off on any stage without naming individual tasks (#228).
- **New CLI verbs** for config validation, checkpoint status/rollback, approval audit, and memory
  inspection (#229).
- **Parallel execution** of data-independent stage groups when the evidence gate confirms a real
  speedup (#208).
- **Validator required-checks are enforced, not advisory** — mechanically-decidable checks produce
  real PASS/FAIL that feeds the retry policy (#222).

### A published, machine-validatable spec
- **RStack Spec v1alpha1** with code-derived JSON schemas and `rstack-agents validate --schemas`,
  so an external team can conformance-test an RStack adoption (#71).

### Breaking / governance
- **Release sign-off is release-only.** `release-readiness.json` no longer grants a run-wide
  destructive bypass. A destructive action requires a per-task `destructive-action:<taskId>`
  approval (or the explicit coarse `destructive-action`) — a release approval can never unblock
  `rm -rf`. If you relied on a release approval to wave through destructive work, approve the
  specific task instead (#293).

---

## [2.0.0] - 2026-07-07

The "governed loop, enforced in code" release. Everything RStack promised in prompt text is
now backed by runtime enforcement — and it works beyond Pi.

### Enforcement on your harness, not just ours
- **You can now enforce RStack governance from any coding framework.** The new
  `rstack-agents guard` command is a universal gate: pipe it a tool call, get allow/block
  (exit 0/2) with a reason. It reuses the exact same classifier and audited approval path as
  the Pi extension — one source of truth, no drift.
- **Claude Code is now enforced, not advisory.** `rstack-agents init --framework claude-code`
  installs a PreToolUse hook that blocks destructive actions (recursive deletes, force-pushes,
  publishes, deploys, secret writes, DB drops — obfuscation-tested) unless a per-task,
  tamper-audited approval exists.
- **Any other harness gets a guided recipe.** [`docs/integrations/wire-your-own-harness.md`](docs/integrations/wire-your-own-harness.md)
  contains a paste-in prompt your coding agent can follow to wire the guard into Codex-style,
  Gemini-style, or custom hook systems — with verification steps.

### The governed loop, enforced
- **Destructive actions require a human.** Classified destructive tool calls are blocked at
  the moment of the call (Pi, Operator, Claude Code) unless an audited `destructive-action`
  approval exists for that specific task; blocked attempts are recorded to the run ledger.
- **Approvals are a trust boundary.** Approval records are audited before being trusted —
  forged, replayed, cross-run, or malformed records are rejected, on one unified audit path.
- **Attempt budgets hard-block.** A task that exhausts its retries goes BLOCKED and stays
  blocked until a one-shot, crash-safe `guardrail-override` approval unblocks it.
- **Validators are sandboxed.** Validator, reviewer, and security contexts are hard-blocked
  from writes, destructive shell, publish, and secret paths — with no override path — and
  stage-specific validator profiles (architecture/code/testing/security/compliance) are
  selected and recorded per run.
- **Runs resume and loop safely.** `rstack-agents pipeline run` skips finished work, retries
  what's retryable, and stops at every human gate; `pipeline loop` runs goal-conditioned
  iterations with a hard cap, a no-progress stop, and a budget brake enforced on real,
  double-count-proof spend telemetry (`metrics.json`).
- **Critical stages get restore points.** Stages 06–09 and 12 checkpoint before and after
  execution with sha-256 integrity manifests; corrupt checkpoints fail closed.
- **Memory can't be poisoned.** Episodic memory enforces its write policy in code: untrusted
  or non-PASS episodes never reach an agent's prompt.
- **Context pressure is visible before it costs you.** Oversized prompts are flagged at
  prompt-assembly time (and at validate), as advisory warnings — never silent pruning.

### Adopt, observe, learn
- **Brownfield is first-class.** `rstack-agents adopt` reverse-populates pipeline stages from
  an existing codebase with evidence-or-skip harvesting; `--dry-run` writes nothing.
- **The Business Hub is production-real.** 20 dashboard tabs render live run state (approvals,
  traceability, security, compliance, cost, diagnostics) with read-path auth, optional TLS,
  and honest empty states — no stubs.
- **The docs tell the truth.** Counts are measured (196 agents, 68 skills, 756 tests), every
  CLI command is documented, the full Mintlify reference and loop recipes ship in the npm
  package, and the README now includes the interactive 3D studio workspace so you can meet
  the agent team before you install.

### Upgrade notes
- Upgrading from 1.8.0: no breaking CLI changes; `init` is idempotent and will add the new
  Claude Code hook template without overwriting your existing settings.
- `specs/` moved to `docs/internal-specs/`; the repo-root logo moved to `assets/`.

---

## [1.9.0-rc] - 2026-06-17

Features merged to `main` after the 1.8.0 release, included in the next version.

### Added
- **Bootstrap templates as first-class project assets** (PR #122). `SOUL.md`, `HEARTBEAT.md`,
  `CLAUDE.md`, `AGENTS.md`, and `GEMINI.md` now ship as canonical copies in
  `templates/bootstrap/` — `init` reads from there, and you can inspect or fork the exact
  templates your project uses.
- **Artifact viewer in the dashboard** (PR #107). Every run artifact now renders richly inside
  the drawer — Markdown headings and code blocks, JSON as a collapsible tree, JSONL as a
  paginated list. No more staring at raw `<pre>` output. XSS-safe, keyboard-accessible, zero
  extra dependencies.
- **Executive mission brief + governance pages** (PR #105). Four new dashboard pages:
  Security threat heat-map (CRITICAL/HIGH/MEDIUM/LOW counts), Compliance score gauge,
  Cost flash-card, and Release readiness gate. The Command Center now opens with an
  executive mission brief.
- **Run rollup index + retention** (PR #104). The dashboard builds an incremental rollup index
  over all runs and enforces configurable retention — older run data rolls off automatically
  without manual cleanup.
- **Atomic run-state writes** (PR #103). Every write to `metrics.json`, `tasks.json`, and
  `approvals.json` now goes through `withFileLock` (advisory O_EXCL lockfile) and atomic
  rename — no torn writes even when parallel agents race.
- **Dashboard server hardening** (PR #102). POST endpoints are rate-limited; approval writes
  are serialized and append an audit record; GET responses carry ETags for conditional
  fetching; body size is capped at a real 413.
- **Decision readiness gate** (#101). The orchestrator now blocks stage advancement until
  pending architectural decisions are resolved — surfaced as an approval-style gate in the
  Business Hub.
- **Business-flex profiles, budgets, and routing visibility** (#68). Three named profiles
  (`lean-mvp`, `business-flex`, `enterprise-webapp`) with per-profile budget envelopes and
  routing explanation shown in the dashboard so you can see _why_ each agent was selected.
- **RFC / ADR process** (#85). `rfcs/` directory with ADR template and process documentation
  so architectural decisions are captured alongside the code.

### Fixed
- **esbuild high-severity advisory cleared** (PR #106). Pinned `esbuild >= 0.28.1`.
- **`init --fresh`** now correctly scopes destructive operations to the current session run
  and archives prior state to `.rstack/archive/<timestamp>/` (#98, #99).
- **Windows dynamic import path fix** (#63). Dashboard server-side import now uses a file URL
  so it works on Windows paths with spaces.
- **Approval audit no longer leaks snapshot failures** — broadcast errors are caught separately
  from the audit log write.

### Security
- SDLC RSTACK logo added to project (since 2026).

---

## [1.8.0] - 2026-06-02

### Added
- **See what your agents actually produced — as infographics.** A new **Run
  Report** page turns every run's 15 stage deliverables into eye-catching
  cards: a security threat-severity donut with the release gate, a compliance
  score gauge, test pass/fail bars, a cost flashcard, requirement and
  architecture counts, planning milestones, and the open-risk / release-gate
  summary. Numbers count up, charts fill in, blocked gates pulse.
- **The Studio 3D agents now report their real work.** Click any agent in the
  3D studio and its panel shows that stage's infographic — threat counts,
  compliance score, test results, cost — pulled live from the run.
- New `GET /api/run-report` endpoint serves a run's parsed stage reports in one
  sandboxed call.

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
