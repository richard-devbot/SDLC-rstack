# RStack on Tau

<!-- owner: RStack developed by Richardson Gunde -->

[Tau](https://github.com/Jeomon/Tau) is a Python agent framework and terminal
coding assistant. It loads `rstack_sdlc.py`, which exposes the same `sdlc_*`
tools as the Pi adapter. No SDLC logic is reimplemented in Python — each tool
shells out to the shared Node bridge (`bin/rstack-bridge.ts`), which reuses the
TypeScript adapter verbatim.

> The Tau adapter is based on the Tau adapter contributed by **Jeomon George**
> ([@Jeomon](https://github.com/Jeomon)).

## What makes Tau different: enforcement is automatic

Tau's `tool_call` event hook can cancel a pending tool call before it runs. The
adapter uses that to route Tau's built-in `terminal` / `write` / `edit` tools
through `rstack-agents guard` (the same framework-neutral destructive-action
gate + validator sandbox Claude Code wires via PreToolUse). Because the hook is
registered when the extension loads, **loading the extension IS the enforcement
wiring** — no separate host hook config is needed. A blocked call returns
`ToolCallEventResult(block=True, reason)`; the adapter fails open only when
`npx` itself is missing.

## Host requirements

- `node` + `npx` on PATH
- `npm install` run once in the rstack-agents package directory
- Python with `pydantic` and `tau` (Tau's own dependencies)

## Setup

```bash
cd your-project
npm install rstack-agents
npx rstack-agents init --framework tau
```

`init` writes `rstack-tau.example.json` — merge its `extensions.list` entry into
your Tau `settings.json`:

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

Each `settings` key maps to the matching `RSTACK_*` environment variable and is
forwarded to the bridge per tool call.

## Verify

```bash
RSTACK_BRIDGE_CALLER=tau RSTACK_PROJECT_ROOT=$(pwd) \
  npx tsx node_modules/rstack-agents/bin/rstack-bridge.ts sdlc_status '{}'
```

A JSON run summary on stdout means the bridge, adapter, and harness all work.

## Contract

This adapter conforms to the RStack
[adapter conformance contract](adapter-contract.md); the conformance test pins
that its tool surface matches the Pi adapter exactly.
