# RStack SDLC — Hermes integration

<!-- owner: RStack developed by Richardson Gunde -->

[Hermes](https://github.com/NousResearch/hermes-agent) (Nous Research) is a
self-improving agent harness extended through **plugins**: a directory
containing a `plugin.yaml` manifest and an `__init__.py` exposing
`register(ctx)`, installed into `~/.hermes/plugins/<name>/` and enabled via
that project's `plugins.enabled` allow-list. RStack ships a Hermes plugin
that exposes the same `sdlc_*` tool surface as every other harness and wires
the enforcement guard — the **same bridge pattern** as the Pi, Tau, and
Operator adapters. No SDLC logic is reimplemented in Python; every tool
shells out to the Node bridge (`bin/rstack-bridge.ts`).

## Required manifest

Hermes' plugin loader (`hermes_cli/plugins.py`) **silently skips** any
plugin directory with no `plugin.yaml` — there is no error, the plugin just
never loads. RStack ships one at
`src/integrations/hermes/plugin.yaml` naming the plugin, its 18
`provides_tools`, and its 3 `provides_hooks` (`pre_tool_call`,
`post_tool_call`, `on_session_start`); `npx rstack-agents doctor --framework
hermes` fails loudly if it's missing from an install.

## Four corrections verified against real Hermes source (#390)

A live audit — cloning `hermes-agent`, constructing a real `PluginManager`,
loading this plugin for real, and calling the actual dispatch functions
directly — found the adapter's original assumptions about Hermes' hook
contract were wrong in four ways. All four are fixed in the shipped adapter,
and `doctor --framework hermes` pins the one that would otherwise fail
silently:

1. **The block-guard's return shape.** `ctx.register_hook("pre_tool_call",
   fn)` *is* a real blocking gate, but not via the Claude-Code-style
   `{"decision": "block", "reason": ...}` shape the adapter originally
   returned. That shape is real, but belongs to a *different* Hermes
   subsystem (the external shell-hooks bridge, `agent/shell_hooks.py`) —
   not the Python-plugin `pre_tool_call` path this adapter uses. The real
   dispatcher (`hermes_cli/plugins.py
   _get_pre_tool_call_directive_details`) reads `result.get("action")` and
   requires it to be `"block"`/`"approve"` plus a non-empty `"message"`; a
   `{"decision", "reason"}` dict has `action == None` and is **silently
   ignored**. This means the guard subprocess ran on every call but never
   actually blocked anything — worse than a loud failure, since nothing
   about the terminal output would suggest the block was discarded.
   Verified live (both before and after the fix) by calling
   `get_pre_tool_call_directive` directly against a destructive command.
2. **The tool-name translation.** Hermes' real built-in tool name for shell
   execution is `terminal` (confirmed via the live plugin load), which
   matches neither `rstack-agents guard`'s classifier
   (`bash`/`shell`/`powershell`/`pwsh`/`cmd`) nor its `WRITE_TOOLS` set — so
   every call classified as non-destructive regardless of the (still
   broken) block shape above. Verified live: a raw guard invocation with
   `tool_name: "terminal"` returned `{"decision":"allow", ...}` even for
   `rm -rf`. The adapter now translates Hermes' real tool names (`terminal`,
   `write`, `edit`, `write_file`, `edit_file`, `str_replace`,
   `apply_patch`, ...) to the guard's canonical `Bash`/`Write`/`Edit` names
   before calling it (mirrors the Tau adapter's `_GUARDED_BUILTINS`
   pattern).
3. **The `pre_tool_call` kwargs shape.** The real hook receives
   `tool_name`/`args`/`task_id`/`session_id`/`tool_call_id`/`turn_id`/
   `api_request_id`/`middleware_trace` (verified against
   `hermes_cli/plugins.py`) — there is no `tool_input` or `cwd` key. The
   adapter reads `args` directly and falls back to the plugin process's own
   `os.getcwd()` (Hermes does not pass a per-call working directory to this
   hook).
4. **The `post_tool_call` (observability) kwargs shape.** The real hook
   passes `tool_name`/`args`/`result`/`status`/`error_type`/`error_message`
   (verified against `model_tools.py _emit_post_tool_call_hook`) — the
   previous adapter used real Hermes kwarg *names* but in the wrong slots
   for what `rstack-agents observe` expects (a Claude-Code-style
   `hook_event_name`/`tool_name`/`content`/`is_error` payload, see
   `src/commands/observe.js`), so nothing reached the Business Hub. Fixed
   to build the payload observe.js actually parses.

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
ln -s "$(pwd)/node_modules/rstack-agents/src/integrations/hermes/plugin.yaml" \
      ~/.hermes/plugins/rstack-sdlc/plugin.yaml

# 4. Enable it — Hermes plugins are opt-in
hermes plugins enable rstack-sdlc   # or add "rstack-sdlc" to plugins.enabled in config.yaml
```

Requirements on the host: `node` + `npx` on PATH, `npm install` run once in
the package directory.

## What loading the plugin gives you

| Capability | How | Blocks? |
|---|---|---|
| `sdlc_*` tools (all 18) | `register_tool` → Node bridge | n/a |
| Destructive-action gate + validator sandbox | `pre_tool_call` → `rstack-agents guard`, real `{"action":"block",...}` shape | **yes** |
| Observability (Business Hub) | `post_tool_call` → `rstack-agents observe` | never |
| Hub auto-launch | `on_session_start` → `rstack-agents hub` | never |

Enforcement is uniform with the other harnesses: the guard reuses the harness
classifier + validator sandbox + audited approvals. It **fails closed** on a
guard that cannot run (partial install, cold-`npx` miss, crash, timeout)
unless `RSTACK_GUARD_FAIL_OPEN=1` is set (#371).

## Settings

Hermes plugin config (`ctx.config`) maps to the same `RSTACK_*` variables as
the other adapters: `worker_command`, `default_model`, `escalated_model`,
`slack_webhook`, `state_dir`, `allow_destructive`. Honors
`RSTACK_NO_BUSINESS_HUB=1` and `CI`.

## Verify

```bash
npx rstack-agents doctor --framework hermes
```

All-PASS confirms the adapter, the `plugin.yaml` manifest, the guard payload
shape, the Node bridge, the guard self-test, and the hub — every failure
prints its fix. See [testing-matrix.md](testing-matrix.md#hermes) for a
live-verification recipe that loads the plugin against a real
`hermes-agent` install and calls the dispatch functions directly (no LLM
API key required — the bug surface is entirely in tool/hook registration
and dispatch, not model inference).

## Everyday commands

From your terminal, the harness-agnostic CLI works the same as with any
other adapter — `pipeline status`, `pipeline run`, `pipeline loop`, `adopt`,
`decisions`, `dor`, `doctor`, `npx rstack-business`. Full table:
[README.md → Everyday commands](README.md#everyday-commands-any-framework).

## Conformance

`tests/bridge-conformance.test.js` pins the Hermes adapter's tool table to
the Pi registry, so it can never silently diverge. See
[adapter-contract.md](adapter-contract.md).
