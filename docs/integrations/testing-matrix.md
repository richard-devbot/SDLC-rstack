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
npx rstack-agents init --framework custom  # tau shares the generic wiring path today
npx rstack-agents doctor --framework tau
```

The **tau adapter** ships as a separate change. Until it lands, `doctor
--framework tau` reports the adapter check as FAIL with the expected path (it
never crashes) while the shared **bridge reachable** and **guard self-test**
checks still PASS — so you can confirm enforcement works and see exactly what
the tau wiring still needs. Once the adapter is installed, the same recipe goes
all-green.

The governed action: same as Operator — start a run, attempt a destructive tool
call, watch the guard block it until approval.

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
