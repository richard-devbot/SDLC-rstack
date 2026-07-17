# Testing RStack in 5 minutes — the cross-harness matrix

<!-- owner: RStack developed by Richardson Gunde -->

One command tells you whether governance actually works on your machine:

```bash
npx rstack-agents doctor
```

`doctor` checks your environment, `.rstack/` config, framework wiring, hub
health — and runs a **live guard self-test** (pipes a destructive `rm -rf`
through `rstack-agents guard` and asserts it blocks, then a safe `ls` and
asserts it allows). A PASS on that line means enforcement is real on this
machine, not just wired in a template. Every FAIL prints the exact fix command;
`--json` is for CI; exit code is 1 if any check FAILs.

This page gives a copy-paste "test in 5 minutes" recipe per framework.

## ⚠️ Always test in a SCRATCH directory — never inside the rstack-agents repo

Running `npm i rstack-agents` inside the rstack-agents repo adds the package to
its OWN dependencies (a self-dependency footgun that happened twice on
2026-07-07). `doctor` has a tripwire that warns if you hit it, but the real fix
is: **start every adopter test in a fresh directory.**

```bash
mkdir ~/rstack-test && cd ~/rstack-test
```

Do all of the recipes below from a scratch dir like this one.

---

## Claude Code

```bash
mkdir ~/rstack-test-cc && cd ~/rstack-test-cc
mkdir .claude                                  # marks this as a Claude Code project
npx rstack-agents init --framework claude-code # writes .claude/settings.json PreToolUse guard hook
npx rstack-agents doctor --framework claude-code
```

Expect all PASS, including **claude-code PreToolUse guard hook** and
**guard self-test (enforcement live)**.

The governed action (the approval moment): in a Claude Code session, ask the
agent to `rm -rf` something. The PreToolUse hook routes it through
`rstack-agents guard`, which **blocks with exit 2** until a
`destructive-action:<taskId>` approval exists on the run — approve it from the
Business Hub or with `sdlc_approve`, and only then does the call go through.

---

## Pi

```bash
mkdir ~/rstack-test-pi && cd ~/rstack-test-pi
npm install rstack-agents                 # Pi auto-loads the SDLC extension from the package
npx rstack-agents init --framework pi
npx rstack-agents doctor --framework pi
```

Expect all PASS, including **pi extension entry** and **guard self-test**.

The governed action: start a run from any Pi session — `sdlc_start { goal: "..." }` —
then trigger a destructive tool call. The Pi `tool_call` hook enforces the same
destructive gate; it blocks until the `destructive-action:<taskId>` approval is
granted.

---

## Operator

```bash
mkdir ~/rstack-test-op && cd ~/rstack-test-op
echo '{}' > operator.json                 # marks this as an Operator project
npm install rstack-agents                 # the Python adapter shells out to the Node bridge
npx rstack-agents init --framework operator
npx rstack-agents doctor --framework operator
```

Expect **operator adapter present**, **operator bootstrap.py**, **operator
adapter uses the real operator_use API**, **bridge reachable**, and **guard
self-test** all PASS; **operator plugin-loading tier** WARNs — that's
expected and informational (see [operator.md](operator.md) for why).

**Verified against real `operator-use` source (#391)** — cloning
`pip install operator-use` and reading it directly, not inferring from its
own docs, found the adapter this replaced imported two modules
(`operator_use.extension.types`, `operator_use.tool.types`) that don't
exist at all; every import would have raised `ModuleNotFoundError`. The real
contract is `operator_use.plugins.Plugin` + `operator_use.tools.Tool`, and
`HookEvent.BEFORE_TOOL_CALL` genuinely blocks (`ctx.skip = True` +
`ctx.result` short-circuits the real tool call —
`agent/service.py::_execute_tool`). `operator-use` has no third-party
plugin discovery at all (no entry_points, no config field, no directory
scan) — `bootstrap.py` monkeypatches the CLI's hardcoded plugin list, which
is the honest maximum available, not a supported extension point.

**Reproducing the live verification** (no LLM API key needed — the bug
surface is entirely in tool/hook registration and dispatch):

```bash
# once: uv/pip install operator-use in a scratch venv
uv venv /tmp/operator-venv --python 3.12
uv pip install --python /tmp/operator-venv/bin/python operator-use

# then, from the rstack-agents repo root, run a small harness that:
#  1. constructs a real RStackPlugin() from src/integrations/operator/rstack_sdlc.py
#  2. calls get_tools() and asserts all 18 sdlc_* tools are returned as real
#     operator_use.tools.Tool instances
#  3. constructs a real operator_use.agent.hooks.Hooks(), calls
#     register_hooks(hooks), asserts both BEFORE_TOOL_CALL and
#     AFTER_TOOL_CALL handlers are registered
#  4. builds a real operator_use.providers.events.ToolCall(name="terminal",
#     params={"cmd": "rm -rf ..."}) and a real BeforeToolCallContext, calls
#     the registered hook directly, and asserts ctx.skip is True with a
#     block reason (not just that the hook ran)
#  5. calls it again with a safe command and asserts ctx.skip stays False
```

The governed action in an interactive session: run
`python .../bootstrap.py start` instead of `operator start`, then attempt a
destructive tool call — it routes through the real `BEFORE_TOOL_CALL` hook
and blocks until approval, no manual host wiring needed.

---

## Tau

```bash
mkdir ~/rstack-test-tau && cd ~/rstack-test-tau
npm install rstack-agents
npx rstack-agents init --framework tau
npx rstack-agents doctor --framework tau
```

**Enforcement mechanism, and why it's not the documented `tool_call` hook**
(#389 audit, upstream Tau commit `4763f38`, 2026-07): Tau's `tool_call` hook
is defined in its type system and documented in `docs/extensions.md`, but the
real engine (`AgentService._before_tool_call`) never fires it — a hard-coded
pass-through, confirmed via `grep -rn "ToolCallEvent(" tau/` returning zero
matches anywhere in Tau's own codebase. `src/integrations/tau/rstack_sdlc.py`
therefore enforces by **shadowing** the built-in `write`/`terminal`/`edit`
tools (a real, documented Tau capability — same-named extension tools
override built-ins while loaded) and running `rstack-agents guard` inside
each shadow's `execute()`, before delegating to the real tool. Same fix
applies to context injection: `before_agent_start` is equally dead (the
system prompt is fixed at Agent construction, never re-read per turn), so
context injection instead uses Tau's real `input` hook, verified live to
transform the prompt text for `interactive`/`rpc` sources.

**Reproducing the live verification** (no Tau project needed — this
exercises the real `tau-coding-agent` package directly against the adapter
module, the same way its own factories document for delegation):

```bash
# once: pip/uv install tau-coding-agent in a scratch venv
uv venv /tmp/tau-venv --python 3.13
uv pip install --python /tmp/tau-venv/bin/python tau-coding-agent

# then, from the rstack-agents repo root, run a small harness that:
#  1. builds a fake ExtensionAPI (register_tool/register_command/on/config)
#  2. calls register(fake_tau) from src/integrations/tau/rstack_sdlc.py
#  3. asserts "tool_call" is NOT among the registered hook events
#  4. calls the registered "terminal" tool's real .execute() with a
#     destructive command and asserts is_error is True (guard blocked it)
#  5. calls it again with a safe command and asserts the real TerminalTool
#     actually ran (delegation works, not just the block path)
```

The governed action in an interactive session: same as Operator — start a
run, attempt a destructive tool call (it will visibly go through the
shadowed `terminal`/`write`/`edit` tool, not a hook), watch the guard block
it until approval.

---

## Hermes

```bash
mkdir ~/rstack-test-hermes && cd ~/rstack-test-hermes
npm install rstack-agents
npx rstack-agents init --framework hermes
npx rstack-agents doctor --framework hermes
```

**Four corrections verified against real Hermes source** (#390 audit —
cloning `NousResearch/hermes-agent`, constructing a real `PluginManager`,
loading the plugin for real, and calling the actual dispatch functions
directly): the block-guard's return shape (`{"action":"block","message":...}`,
not the Claude-Code-style `{"decision":"block","reason":...}` a *different*
Hermes subsystem uses), the tool-name translation (Hermes' real `terminal`
tool name maps to nothing in the guard's classifier until translated to
`Bash`), the `pre_tool_call` kwargs shape, and the `post_tool_call`
(observability) kwargs shape. Full detail:
[hermes.md](hermes.md#four-corrections-verified-against-real-hermes-source-390).

**Reproducing the live verification** (no LLM API key needed — the bug
surface is entirely in tool/hook registration and dispatch, not model
inference):

```bash
# once: uv/pip install hermes-agent in a scratch venv
uv venv /tmp/hermes-venv --python 3.11
uv pip install --python /tmp/hermes-venv/bin/python hermes-agent

# then, from the rstack-agents repo root, run a small harness that:
#  1. installs src/integrations/hermes/{plugin.yaml,rstack_sdlc.py} as a
#     real plugin directory under a scratch ~/.hermes/plugins/
#  2. constructs a real PluginManager, calls discover_and_load()
#  3. asserts all 18 sdlc_* tools are registered
#  4. calls get_pre_tool_call_directive(tool_name="terminal",
#     args={"command": "rm -rf /"}) directly and asserts the returned
#     directive actually blocks (action == "block"), not just that the
#     hook ran
#  5. calls it again with a safe command and asserts it allows
```

The governed action in an interactive session: enable the plugin
(`hermes plugins enable rstack-sdlc`), start a run, attempt a destructive
tool call, watch the guard block it until approval.

---

## Custom / any harness

```bash
mkdir ~/rstack-test-custom && cd ~/rstack-test-custom
npm install rstack-agents
npx rstack-agents init --framework custom
npx rstack-agents doctor --framework custom
```

Expect **guard binary reachable** and **guard self-test** to PASS — that proves
enforcement is available to any harness that pipes its pending tool call through
`rstack-agents guard` (stdin Claude Code PreToolUse JSON → exit 0 allow / exit 2
block). See `docs/integrations/wire-your-own-harness.md` for the paste-in hook.

The governed action: from your harness's tool-call hook, pipe a destructive
command through the guard and observe exit 2 — then grant the
`destructive-action:<taskId>` approval and observe exit 0.

---

## Reading the result

- **All PASS** → governance is set up and enforcement is live. Ship.
- **A FAIL** → read the `fix:` line under it. Run that command, re-run `doctor`.
- **A WARN** → advisory (e.g. the hub isn't running, or `rstack-agents` isn't
  installed in this scratch dir). WARNs never fail the check; act on them if the
  hint matters to you.

For CI, `npx rstack-agents doctor --json` emits the full structured report and
exits 1 on any FAIL.
