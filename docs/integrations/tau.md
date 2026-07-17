# RStack on Tau

<!-- owner: RStack developed by Richardson Gunde; Tau adapter contributed by Jeomon -->

Tau ([github.com/Jeomon/Tau](https://github.com/Jeomon/Tau)) is a Python agent
framework and terminal coding assistant. It loads `rstack_sdlc.py`
(contributed by Jeomon), which exposes the same `sdlc_*` tools as the Pi
adapter. No SDLC logic is reimplemented in Python — each tool shells out to
the generic Node bridge (`bin/rstack-bridge.ts`), which reuses the TypeScript
adapter verbatim. Conformance: [adapter-contract.md](adapter-contract.md).

The adapter also registers a human-facing `/sdlc` slash command (mirroring
Tau's own `peer` extension pattern) so you don't have to wait on the model to
call a tool. Type `/sdlc ` and press Tab for subcommand autocomplete (`start`,
`plan`, `status`, `approve`, ...); `/sdlc <subcommand> <text>` fills the one
obvious free-text field for that subcommand (e.g. `/sdlc start "add auth"`),
and `/sdlc <subcommand> {"...": "..."}` accepts full JSON params for anything
more complex (e.g. `/sdlc delegate {"agent": "...", "task": "..."}`).

**Enforcement comes wired — via built-in shadowing, not the documented
`tool_call` hook.** A source audit for issue #389 (upstream Tau commit
`4763f38`, 2026-07) found that Tau's `tool_call` event is defined and
documented (`docs/extensions.md`) but never actually fired by the real
engine (`AgentService._before_tool_call` is a hardcoded pass-through) — so
no adapter relying on it, on any framework, is really enforcing anything.
This adapter instead **shadows** the built-in `terminal` / `write` / `edit`
tools — a genuine, documented Tau capability (same-named extension tools
override built-ins while loaded, restored on unload/reload) — and runs
`rstack-agents guard` inside each shadow's `execute()` before delegating to
the real tool. Loading the extension is still the only wiring step; a guard
exit 2 blocks the call with the guard's reason before the real tool ever
runs.

If the guard cannot run at all — a crash, a timeout, or a cold `npx --yes`
that can't reach the registry — it **fails closed** (blocks) by default so
an install hiccup never silently disables enforcement (#371); set
`RSTACK_GUARD_FAIL_OPEN=1` to allow-on-unavailable instead. The adapter
prefers a locally-resolved `rstack-agents` binary (checked in the calling
project's own `node_modules/.bin`) over `npx --yes`, so enforcement doesn't
depend on the network; `rstack-agents doctor` reports which path resolves.

**Opt-in quality gates.** Set the `quality_gates` extension setting (a comma
string or list of `plan-gate`/`tdd-gate`/`scope-guard`) — or the
`RSTACK_TAU_GATES` env — to run the [quality gates](quality-gates.md) on
`write`/`edit` tools after guard. Off by default. `tdd-gate` blocks
production-code edits with no test (override: `RSTACK_ALLOW_NO_TESTS=1`); the
others warn only.

## Host requirements

- `node` + `npx` on PATH
- `npm install` run once in the rstack-agents package directory
- Python with `pydantic` (Tau's own dependency)

## Setup

```bash
cd your-project
npm install rstack-agents
npx rstack-agents init --framework tau   # auto-detected from tau.json / tau_settings.json / .tau/
```

`init` writes `rstack-tau.example.json` — merge its `extensions.list` entry
into your Tau `settings.json`:

```json
{
  "extensions": {
    "list": [{
      "path": "node_modules/rstack-agents/src/integrations/tau/rstack_sdlc.py",
      "settings": {
        "worker_command": "",
        "default_model": "",
        "escalated_model": "",
        "slack_webhook": ""
      }
    }]
  }
}
```

Each `settings` key maps to the matching `RSTACK_*` environment variable and
is forwarded to the bridge per tool call.

### Alternative: `tau install` (packaged, one command — currently blocked upstream)

The adapter is also packaged as a real pip-installable distribution at
`packaging/tau-adapter/` (`rstack-tau-adapter`, generated from
`src/integrations/tau/rstack_sdlc.py` via `node scripts/generate-tau-package.mjs`
— regenerate after changing the adapter):

```bash
tau install ./node_modules/rstack-agents/packaging/tau-adapter
```

**Tested against a real `tau install` run (#389) — the packaging itself is
correct, but this currently fails on Tau's side.** `pip install` succeeds
(verified: `rstack_tau_adapter` lands correctly in Tau's managed venv with
its `manifest.json` in the right place), but `tau install`'s own
book-keeping step crashes: `tau/console/commands/packages.py`'s `install()`
is a synchronous function that calls `SettingsManager.add_package()`, which
internally calls `asyncio.create_task()` — but no event loop is running yet
at that point (one only starts on the *next* line, `asyncio.run(settings.flush())`,
too late). This reproduces with any package, not just this one — it's an
upstream Tau bug, not something fixable from this repo. Until it's fixed,
use the manual `extensions.list` wiring above (fully working, this is what
every verification in this doc and in `testing-matrix.md` actually exercises).

## Verify

```bash
npx rstack-agents doctor --framework tau
```

All-PASS confirms the adapter, the Node bridge, the guard self-test, and the
hub — every failure prints its fix. To exercise the bridge directly:

```bash
RSTACK_PROJECT_ROOT=$(pwd) npx tsx node_modules/rstack-agents/bin/rstack-bridge.ts sdlc_status '{}'
```

A JSON run summary means the bridge, adapter, and harness all work. Then,
inside a Tau session, ask it to run `rm -rf /tmp/rstack-guard-check` — the
guard blocks it with a `destructive-action:<taskId>` reason, proving the
shadowed `terminal` tool's pre-execution gate is live (see
[testing-matrix.md](testing-matrix.md#tau) for a live-verification recipe
that exercises this against the real `tau-coding-agent` package directly).

## Everyday commands

Inside Tau: the `/sdlc` slash command (above) and the `sdlc_*` tools. From your
terminal: the harness-agnostic CLI — `pipeline status`, `pipeline run`,
`pipeline loop`, `adopt`, `decisions`, `dor`, `doctor`, `npx rstack-business`.
Full table: [README.md → Everyday commands](README.md#everyday-commands-any-framework).

## Observability, context & notifications (#251/#255)

Loading the extension IS the wiring — the adapter registers Tau's hooks itself
(no host config). Coverage:

- The shadowed `write`/`terminal`/`edit` tools emit a pre-execution INTENT
  event even when a call is later blocked; `tool_result` (real, verified) →
  a `tool_result` observe event; `tool_execution_failure` (real, verified) →
  an error `tool_result` — all fire-and-forget to `rstack-agents observe`
  (source `tau`), so terminal activity and failures reach the Business Hub.
- `before_compaction` (real, verified) → a `context_preserved` event
  (records when context is trimmed).
- `input` → RStack **context injection**: the same #389 audit found
  `before_agent_start` is equally dead (the system prompt is fixed once at
  Agent construction, never re-read per turn), so this adapter uses Tau's
  real `input` hook instead — fired for every submitted prompt, verified to
  genuinely replace the text the agent receives. The RStack packet (run +
  stage + blockers + orchestrator pointer) is prepended to the prompt text
  for `interactive`/`rpc` sources only (not delegated subagents or
  cron/goal/queue turns, to avoid duplicate injection). Best-effort and
  timeout-bounded — it can never block or corrupt a turn.

Everything except the guard is additive and can never disrupt a session. Two
Claude Code events have **no Tau equivalent** and are deliberately not wired:
Tau has no delegated-subagent lifecycle event (its `agent_start`/`agent_end` are
the per-prompt loop, not spawned specialists) and no notification event.
