# RStack SDLC — Hermes integration

<!-- owner: RStack developed by Richardson Gunde -->

[Hermes](https://github.com/NousResearch/hermes-agent) (Nous Research) is a
self-improving agent harness extended through **plugins** installed into
`~/.hermes/plugins/`. RStack ships a Hermes plugin that exposes the same
`sdlc_*` tool surface as every other harness and wires the enforcement guard —
the **same bridge pattern** as the Pi, Tau, and Operator adapters. No SDLC logic
is reimplemented in Python; every tool shells out to the Node bridge
(`bin/rstack-bridge.ts`).

## Why the bridge pattern fits Hermes

Hermes' plugin `ctx` gives a third party exactly the two hooks the pattern needs:

- **`ctx.register_tool(name, toolset, schema, handler)`** — registers each
  `sdlc_*` tool; the handler shells to the bridge.
- **`ctx.register_hook("pre_tool_call", fn)`** — a real **blocking** gate.
  Hermes normalises a Claude-Code-style `{"decision": "block", "reason": ...}`
  return into a blocked tool call (see `agent/shell_hooks.py`) — the exact shape
  `rstack-agents guard` already emits, so the destructive gate + validator
  sandbox drop in with almost no glue.

## Install

```bash
# 1. Install the package (the plugin shells out to its Node bridge)
npm install rstack-agents

# 2. Scaffold state + governance files
npx rstack-agents init --framework hermes

# 3. Install the plugin into Hermes (its own convention for third-party plugins)
mkdir -p ~/.hermes/plugins/rstack-sdlc
ln -s "$(pwd)/node_modules/rstack-agents/src/integrations/hermes/rstack_sdlc.py" \
      ~/.hermes/plugins/rstack-sdlc/__init__.py
```

Requirements on the host: `node` + `npx` on PATH, `npm install` run once in the
package directory.

## What loading the plugin gives you

| Capability | How | Blocks? |
|---|---|---|
| `sdlc_*` tools (all 18) | `register_tool` → Node bridge | n/a |
| Destructive-action gate + validator sandbox | `pre_tool_call` → `rstack-agents guard` | **yes** (exit 2 / `{"decision":"block"}`) |
| Observability (Business Hub) | `post_tool_call` → `rstack-agents observe` | never |
| Hub auto-launch | `on_session_start` → `rstack-agents hub` | never |

Enforcement is uniform with the other harnesses: the guard reuses the harness
classifier + validator sandbox + audited approvals. It **fails closed** on a
guard that cannot run (partial install, cold-`npx` miss, crash, timeout) unless
`RSTACK_GUARD_FAIL_OPEN=1` is set (#371). A validator-role subagent's tool calls
are sandboxed read-only automatically via the guard's `agent_type` handling
(#372).

## Settings

Hermes plugin config (or environment) maps to the same `RSTACK_*` variables as
the other adapters: `worker_command`, `default_model`, `escalated_model`,
`slack_webhook`, `state_dir`, `allow_destructive`. Honors
`RSTACK_NO_BUSINESS_HUB=1` and `CI`.

## Conformance

`tests/bridge-conformance.test.js` pins the Hermes adapter's tool table to the
Pi registry, so it can never silently diverge. See
[adapter-contract.md](adapter-contract.md).
