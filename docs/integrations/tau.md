# RStack on Tau

<!-- owner: RStack developed by Richardson Gunde; Tau adapter contributed by Jeomon -->

Tau ([github.com/Jeomon/Tau](https://github.com/Jeomon/Tau)) is a Python agent
framework and terminal coding assistant. It loads `rstack_sdlc.py`
(contributed by Jeomon), which exposes the same `sdlc_*` tools as the Pi
adapter. No SDLC logic is reimplemented in Python — each tool shells out to
the generic Node bridge (`bin/rstack-bridge.ts`), which reuses the TypeScript
adapter verbatim. Conformance: [adapter-contract.md](adapter-contract.md).

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
RSTACK_PROJECT_ROOT=$(pwd) npx tsx node_modules/rstack-agents/bin/rstack-bridge.ts sdlc_status '{}'
```

A JSON run summary on stdout means the bridge, adapter, and harness all work.
Then, inside a Tau session, ask it to run
`rm -rf /tmp/rstack-guard-check` — the guard should block it with a
`destructive-action:<taskId>` approval reason, proving the `tool_call` hook
is live.
