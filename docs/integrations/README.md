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
| Claude Code | [claude-code.md](claude-code.md) | `sdlc-automation` plugin + PreToolUse `rstack-agents guard` hook |
| Operator | [operator.md](operator.md) | `src/integrations/operator/rstack_sdlc.py` (Python, bridges to Node) |
| Tau | [tau.md](tau.md) | `src/integrations/tau/rstack_sdlc.py` (Python, bridges to Node + `tool_call` guard hook) |
| Anything else | [custom.md](custom.md) | The `.rstack/` state contract + Node bridge |

Runtime enforcement (destructive gate + validator sandbox) is framework-neutral:
any harness with a tool-call hook wires it via `rstack-agents guard` — see
[wire-your-own-harness.md](wire-your-own-harness.md) for a paste-in guided
prompt that makes your coding agent do the wiring.

Notifications for all of them: **Slack, Teams, Discord, Telegram, WhatsApp** —
see [webhooks.md](webhooks.md).

Every integration shares the same core: governed stages, builder/validator
contracts, evidence, approvals — and the same Business Hub dashboard:

```bash
npx rstack-business   # multi-project observability on :3008
```

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
