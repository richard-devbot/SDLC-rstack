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

**Enforcement comes wired.** Unlike Operator (no blocking hook) or Claude
Code (hook installed into settings), Tau's `tool_call` event hook can cancel
a tool call before it executes — and the adapter registers that hook itself.
Loading the extension IS the wiring: Tau's built-in `terminal` / `write` /
`edit` tools are routed through `rstack-agents guard` (destructive-action
gate + validator sandbox), and a guard exit 2 blocks the call with the
guard's reason. It fails open only when `npx` itself is missing on the host.

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
`tool_call` hook is live.

## Everyday commands

Inside Tau: the `/sdlc` slash command (above) and the `sdlc_*` tools. From your
terminal: the harness-agnostic CLI — `pipeline status`, `pipeline run`,
`pipeline loop`, `adopt`, `decisions`, `dor`, `doctor`, `npx rstack-business`.
Full table: [README.md → Everyday commands](README.md#everyday-commands-any-framework).

## Observability, context & notifications (#251/#255)

Loading the extension IS the wiring — the adapter registers Tau's hooks itself
(no host config). Coverage:

- `tool_call` → `tool_call` intent event + the guard verdict; `tool_result` →
  `tool_result`; `tool_execution_failure` → an error `tool_result` — all
  fire-and-forget to `rstack-agents observe` (source `tau`), so terminal
  activity and failures reach the Business Hub.
- `before_compaction` → a `context_preserved` event (records when context is
  trimmed).
- `before_agent_start` → RStack **context injection**: the packet from
  `rstack-agents context` (run + stage + blockers + orchestrator pointer) is
  prepended to the turn's system prompt. Best-effort and timeout-bounded — it
  can never block or delay a turn.

Everything except the guard is additive and can never disrupt a session. Two
Claude Code events have **no Tau equivalent** and are deliberately not wired:
Tau has no delegated-subagent lifecycle event (its `agent_start`/`agent_end` are
the per-prompt loop, not spawned specialists) and no notification event.
