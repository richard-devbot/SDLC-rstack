# RStack on Claude Code

<!-- owner: RStack developed by Richardson Gunde -->

Claude Code runs RStack through portable project assets — agents, skills,
plugins, prompts, and bootstrap instructions — **plus runtime enforcement**:
a PreToolUse hook routes every Bash/Write/Edit call through
`rstack-agents guard`, the same harness policy the Pi extension enforces.

## Setup

```bash
cd your-project
npx rstack-agents init --framework claude-code
```

This creates `.claude/rstack-sdlc.md` (project-local usage guide) and
registers the project with the Business Hub. It also scaffolds `CLAUDE.md`,
`SOUL.md`, and `HEARTBEAT.md` from the package templates when they do not
already exist, and installs the enforcement hook below (only when
`.claude/settings.json` does not exist yet — RStack never edits yours; the
snippet lands at `.claude/rstack-hooks.json` instead, with merge guidance).

## Enforcement (the guard hook)

`init` writes this into `.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [{ "hooks": [{ "type": "command", "command": "npx -y rstack-agents hub" }] }],
    "PreToolUse": [{
      "matcher": "Bash|Write|Edit",
      "hooks": [{ "type": "command", "command": "npx --yes rstack-agents guard --context builder" }]
    }]
  }
}
```

Every matched tool call is piped (as PreToolUse JSON) into
`rstack-agents guard`, which exits `0` to allow or `2` to block — Claude Code
blocks the call on exit 2 and shows the guard's stderr reason to the model.

**What it enforces at tool-call time:**

- **Destructive gate** (builder context) — recursive/forced deletes, git
  force-pushes and hard resets, package/release publishes, infrastructure
  deploys, secret/credential writes, protected-config writes, and database
  drops are classified by the harness's single source of truth
  (`classifyDestructiveAction`, #131) and **block until the run carries an
  audited `destructive-action:<taskId>` approval** (#133 — malformed and
  cross-run replayed records are rejected). Set `RSTACK_TASK_ID` to the
  active task so the approval resolves; approve via `sdlc_approve` or the
  Business Hub. `RSTACK_ALLOW_DESTRUCTIVE=1` skips this gate, exactly like
  the Pi hook.
- **Validator sandbox** (validator/reviewer/security contexts) — any write
  tool, destructive/mutating shell command, publish/deploy, or secret-path
  write is **denied outright, with no approval or env override** (#119).
  The context comes from `--context`, `RSTACK_AGENT_CONTEXT`, or the
  delegate-stamped `RSTACK_VALIDATOR_CONTEXT=1` (which always wins, so a
  sandboxed subprocess cannot escape via flags).

**Failure semantics (honest edges):**

- A destructive action that cannot resolve a task id, a run, or its
  approvals **fails closed** — blocked with guidance.
- Input the guard cannot classify at all (empty/garbage payloads) **fails
  open with a stderr warning** — raw non-JSON text is first sniffed as a
  shell command, so destructive-looking raw input still blocks; a guard that
  hard-errors on every hook call would just get uninstalled.

**What remains Pi-only:** automatic run-event logging of every
`tool_call`/`tool_result` into `events.jsonl`, automatic
`RSTACK_VALIDATOR_CONTEXT` stamping on delegated validator subprocesses
(in Claude Code, set the env or `--context` yourself when spawning validator
work), and session-start orchestrator packet injection. The enforcement
policy itself — destructive gate + validator sandbox — is identical.

## Verify

```bash
npx rstack-agents doctor --framework claude-code
```

This checks the PreToolUse hook is wired and runs a live guard self-test
(blocks `rm -rf`, allows `ls`); a missing hook prints the exact snippet to add.
Try the guard by hand too:

```bash
npx rstack-agents guard --explain --command "rm -rf /tmp/x"   # classify only, exit 0
echo '{"tool_name":"Bash","tool_input":{"command":"ls"}}' | npx rstack-agents guard   # allow, exit 0
```

Optional local asset copies can place package agents under
`.claude/agents/rstack/` and prompt files under `.claude/commands/rstack/`.
Claude Code then exposes them through its normal subagent and slash-command
file conventions.

## Runtime surfaces

| Surface | Purpose |
|---|---|
| `CLAUDE.md` | Project bootstrap and RStack routing guidance |
| `.claude/rstack-sdlc.md` | Local usage guide for SDLC runs |
| `.claude/agents/rstack/*.md` | Optional Claude Code subagent copies for RStack agents |
| `.claude/commands/rstack/*.md` | Optional slash-command prompt copies |
| `skills/**/SKILL.md` | Portable skills used when their trigger matches the task |
| `plugins/*/plugin.json` | Portable plugin metadata and bundled plugin assets |
| `.claude/settings.json` hooks | PreToolUse enforcement guard + SessionStart hub auto-launch |
| `rstack-agents` | CLI setup, validation, decisions, readiness, hub, guard, and notifications |

## Observability

```bash
npx rstack-business
```

Run timelines, stage durations, approvals, alerts, and traceability on :3008 —
aggregated across every project on this machine.
