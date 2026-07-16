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

Expect all PASS, including **operator adapter present**, **bridge reachable**,
and **guard self-test**.

The governed action: merge `rstack-operator.example.json` into your Operator
settings, start a run, and attempt a destructive tool call — the adapter routes
it through the same guard, which blocks until approval.

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
