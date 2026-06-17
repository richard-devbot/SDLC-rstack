# RStack SDLC — Heartbeat (standby automation)

<!-- owner: RStack developed by Richardson Gunde -->

**Optional.** Run these checks only when your harness supports periodic or idle triggers (cron, heartbeat hook, scheduled agent). Skip entirely if the user has not enabled automation.

## Before you start

- Respect `RSTACK_NO_BUSINESS_HUB=1` — do not launch or nag about the dashboard.
- **Never** auto-approve, auto-merge, force-push, or mutate code without explicit user instruction.
- Report findings; let the user decide next action.

## Checks (in order)

### 1. Pending approvals

- Read the latest run under `.rstack/runs/` (most recent directory by name or `manifest.json` timestamp).
- Check `approvals.json` in that run and `.rstack/approvals.jsonl` at project root.
- If any gate is `PENDING`, summarize: artifact name, stage, and what the user must approve.

### 2. Budget burn

- Read `.rstack/budget.json`.
- Compare cumulative spend in the latest run's `events.jsonl` (look for `cost_recorded` events) against `run_budget_usd`, `daily_budget_usd`, and `warn_at_percent`.
- If above warning threshold, report remaining budget and `require_approval_above_usd`.

### 3. Stalled tasks

- In the latest run, scan `events.jsonl` for the most recent `task_started` without a matching `task_validated` or `task_completed`.
- If no new events for **30+ minutes**, report task id, assigned agent, and last known status.

### 4. Validation retries

- Scan `tasks/*/validation.json` in the latest run for `retry_recommendation` not equal to `none`.
- Surface: task id, issue summary, recommended action (`retry_builder`, `ask_user`, `block`).

### 5. Business Hub health

- If hub is expected (no `RSTACK_NO_BUSINESS_HUB`), note the URL: `http://localhost:${RSTACK_BUSINESS_PORT:-3008}`.
- Do not open a browser unless the user asked for it.

## Output format

Keep heartbeat reports short:

```text
RStack heartbeat — <timestamp>
Approvals pending: <count or none>
Budget: <spent>/<limit> USD (<percent>%)
Stalled tasks: <ids or none>
Retries needed: <ids or none>
Hub: http://localhost:3008 (or disabled)
```

## Related hooks

- **Claude Code SessionStart** — optional Business Hub auto-launch via `.claude/rstack-hub-hook.json` (merge into your settings; never required).
- **Pi lifecycle hooks** — native `sdlc_*` tool gating when using the Pi extension.
- Disable hub auto-launch: `RSTACK_NO_BUSINESS_HUB=1` or `RSTACK_NO_BROWSER=1`.
