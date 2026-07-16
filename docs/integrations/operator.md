# RStack on Operator

<!-- owner: RStack developed by Richardson Gunde -->

[Operator](https://pypi.org/project/operator-use/) (`operator-use` on PyPI)
is a Python agent harness. This adapter was rewritten for #391 after a live
audit against the real installed package (0.2.9) found the previous version
entirely non-functional — see "What was wrong" below. It now exposes the
same `sdlc_*` tools as every other adapter; no SDLC logic is reimplemented
in Python, every tool shells out to the generic Node bridge
(`bin/rstack-bridge.ts`, which reuses the TypeScript adapter verbatim).
Conformance: [adapter-contract.md](adapter-contract.md).

## What was wrong, and what's real (#391)

The previous adapter imported `operator_use.extension.types.ToolDefinition`
and `operator_use.tool.types.{ToolKind,ToolResult}` — **neither module
exists** in the real package (verified: both imports raise
`ModuleNotFoundError` against a real `pip install operator-use`). It also
called `ToolResult.ok(...)`/`ToolResult.error(...)`, methods that don't
exist either (the real ones are `success_result`/`error_result`). The
adapter had never actually been imported by a real Operator process — the
whole "loads `rstack_sdlc.py` as an extension via `settings.json`" story in
the old version of this doc was fiction copied from the Tau integration
shape, not verified against Operator itself.

The real contract, read directly from the installed source:

- **`operator_use.plugins.Plugin`** is the base class third-party code
  extends: override `get_tools()` (returns `list[Tool]`) and
  `register_hooks(hooks)`.
- **`operator_use.tools.Tool`** wraps a function as a decorator:
  `Tool(name=..., description=..., model=SomeBaseModel)(handler)`. The
  wrapped handler is called as `handler(**coerced_params)` — the Pydantic
  model's field names become keyword arguments.
- **`HookEvent.BEFORE_TOOL_CALL` is a real, genuinely blocking hook** —
  verified in `agent/service.py::_execute_tool`: a handler that sets
  `ctx.skip = True` and `ctx.result = <ToolResult>` on the
  `BeforeToolCallContext` short-circuits the real tool call entirely. This
  is a stronger guarantee than Tau needed to work around (no built-in
  shadowing required) — Operator's own hook system was simply never wired
  up, not dead code.
- The real built-in shell tool is named `terminal` with a `cmd` field
  (`agent/tools/builtin/terminal.py`) — **not `command`**. A live smoke test
  caught the field-name-translation bug this implies: the guard's own Bash
  classifier reads `tool_input.command` specifically
  (`src/core/harness/destructive-actions.js`), so passing Operator's real
  `cmd` value straight through under a `cmd` key silently classified every
  shell command as non-destructive
  (`{"tool_name":"Bash","tool_input":{"cmd":"rm -rf ..."}}` returned
  `{"decision":"allow", ...}`). The adapter now translates `cmd` → the
  guard's `command` key. File tools (`write_file`/`edit_file`) use `path`
  on both sides — no translation needed there.

## The one genuine host-design limitation

`operator-use` 0.2.9 has **no third-party plugin discovery mechanism at
all** — no `entry_points` group, no config field, no directory scan.
`cli/start.py::_build_agents()` hardcodes
`plugins = [ComputerPlugin(...), BrowserPlugin(...)]` directly in Python
source and passes it straight to each `Agent(...)` constructor. There is no
supported way to add a plugin to a real `operator start` session without
either forking the installed package or patching that call site before it
runs.

`src/integrations/operator/bootstrap.py` does the latter: it's a drop-in
replacement for the `operator` console script that monkeypatches
`_build_agents` to append `RStackPlugin()` — wiring its tools, hooks, and
tool registry exactly the way `_build_agents` already wires its own
hardcoded plugins — then hands off to the real Typer app
(`operator_use.cli.commands.app`, the same object the `operator`/
`operator-use` console scripts invoke), so every other command behaves
identically to a stock install. This is a monkeypatch of an
underscore-prefixed, non-public function — the honest maximum available
today, not a supported extension point, and it will break if a future
`operator-use` release restructures `_build_agents`.
`rstack-agents doctor --framework operator` states this tier plainly (a
WARN, not a silent parity claim) rather than implying config-driven loading
like Tau/Hermes/Pi.

## Host requirements

- `node` + `npx` on PATH
- `npm install` run once in the rstack-agents package directory
- Python with `pydantic` (Operator's own dependency)
- `operator-use` installed (`pip install operator-use`)

## Setup

```bash
cd your-project
npm install rstack-agents
npx rstack-agents init --framework operator
```

Run RStack-wrapped Operator in place of the `operator` command:

```bash
python node_modules/rstack-agents/src/integrations/operator/bootstrap.py start
# or any other operator subcommand, e.g.:
python node_modules/rstack-agents/src/integrations/operator/bootstrap.py repl
```

Optional configuration is read from environment variables (there is no
settings.json wiring — see the limitation above):
`RSTACK_WORKER_COMMAND`, `RSTACK_DEFAULT_MODEL`, `RSTACK_ESCALATED_MODEL`,
`RSTACK_SLACK_WEBHOOK`, `RSTACK_STATE_DIR`, `RSTACK_ALLOW_DESTRUCTIVE`.

## Verify

```bash
npx rstack-agents doctor --framework operator
```

Confirms the adapter file uses the real `operator_use` API (not the old
fictional modules), the bootstrap script is present, the Node bridge, the
guard self-test, and the hub — every failure prints its fix. The plugin
loading tier WARN is expected and informational. To exercise the bridge
directly:

```bash
RSTACK_PROJECT_ROOT=$(pwd) npx tsx node_modules/rstack-agents/bin/rstack-bridge.ts sdlc_status '{}'
```

A JSON run summary on stdout means the bridge, adapter, and harness all
work. See [testing-matrix.md](testing-matrix.md#operator) for a
live-verification recipe against a real `operator-use` install (no LLM API
key required).

## Enforcement

Enforcement is wired directly via the real `BEFORE_TOOL_CALL` hook when
running through `bootstrap.py` — no manual host wiring needed, unlike a
harness with no blocking hook at all. If you're running Operator WITHOUT
the bootstrap (a stock `operator start`), the plugin — and therefore the
guard — never loads; there is no fallback path in that case, since Operator
gives third-party code no other place to intercept a tool call.

## Everyday commands

The harness-agnostic CLI applies — `pipeline status`, `pipeline run`,
`pipeline loop`, `adopt`, `decisions`, `dor`, `doctor`, `npx rstack-business`.
Full table: [README.md → Everyday commands](README.md#everyday-commands-any-framework).
