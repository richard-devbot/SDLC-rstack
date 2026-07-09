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

`init` writes this into `.claude/settings.json` (the full governance hook set, #255):

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "npx -y rstack-agents hub" }] },
      { "hooks": [{ "type": "command", "command": "npx --yes rstack-agents context --source claude-code" }] }
    ],
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "npx --yes rstack-agents context --source claude-code" }] }],
    "PreToolUse": [{
      "matcher": "Bash|Write|Edit",
      "hooks": [{ "type": "command", "command": "npx --yes rstack-agents guard --context builder" }]
    }],
    "PostToolUse": [{
      "matcher": "Bash|Write|Edit",
      "hooks": [{ "type": "command", "command": "npx --yes rstack-agents observe --source claude-code" }]
    }],
    "PostToolUseFailure": [{
      "matcher": "Bash|Write|Edit",
      "hooks": [{ "type": "command", "command": "npx --yes rstack-agents observe --source claude-code" }]
    }],
    "SubagentStart": [{ "hooks": [{ "type": "command", "command": "npx --yes rstack-agents observe --source claude-code" }] }],
    "SubagentStop": [{ "hooks": [{ "type": "command", "command": "npx --yes rstack-agents observe --source claude-code" }] }],
    "PreCompact": [{ "hooks": [{ "type": "command", "command": "npx --yes rstack-agents observe --source claude-code" }] }],
    "Notification": [{ "hooks": [{ "type": "command", "command": "npx --yes rstack-agents notify-hook --source claude-code" }] }],
    "Stop": [{ "hooks": [{ "type": "command", "command": "npx --yes rstack-agents observe --source claude-code" }] }],
    "SessionEnd": [{ "hooks": [{ "type": "command", "command": "npx --yes rstack-agents observe --source claude-code" }] }]
  }
}
```

### Full hook map — every event, what it does, what it never does

`PreToolUse` (the guard) is the **only** hook that can block a call. Every other
hook is strictly additive: it **always exits 0**, **never throws**, **no-ops**
when there is no active run (or, for notifications, no configured channel), and
**redacts secrets** — none can ever deny a tool call or disrupt a session.

| Hook event | Command | What it does | What it never does |
|---|---|---|---|
| `SessionStart` | `hub` + `context` | Launches the Business Hub; injects the RStack packet (run + stage + blockers + orchestrator pointer) | Never blocks; injects nothing when no run |
| `UserPromptSubmit` | `context` | Injects the RStack packet as `additionalContext` before each prompt | Never blocks/denies (context hooks can't); never echoes prompt text or secrets |
| `PreToolUse` | `guard` | Classifies Bash/Write/Edit; **exit 2 blocks** destructive/sandbox violations | The only blocker — everything else exits 0 |
| `PostToolUse` | `observe` | Records a `tool_result` event | Never blocks; redacts secrets/file content |
| `PostToolUseFailure` | `observe` | Records an error `tool_result` (`isError:true`) so failures show in the feed | Never blocks |
| `SubagentStart` | `observe` | Records `subagent_started {agent_type}` — delegated builders/validators appear working | Never blocks |
| `SubagentStop` | `observe` | Records `subagent_stopped {agent_type}` | Never blocks; not a session shutdown |
| `PreCompact` | `observe` | Records `context_preserved {trigger}` before context is trimmed | Never blocks; never cancels compaction |
| `Notification` | `notify-hook` | Routes the host notification to configured channels (Slack/Teams/Discord/...) | Never blocks; no-op when no channel configured; redacts the message |
| `Stop` / `SessionEnd` | `observe` | Records `session_shutdown` | Never blocks |

Every matched tool call is piped (as PreToolUse JSON) into
`rstack-agents guard`, which exits `0` to allow or `2` to block — Claude Code
blocks the call on exit 2 and shows the guard's stderr reason to the model.
After the call runs, the PostToolUse hook pipes the same payload into
`rstack-agents observe`, which records it to the run's `events.jsonl` for the
dashboard (see [Observability](#observability) below).

### Quality gates (opt-in)

On top of the always-on guard, you can wire the **opt-in** quality-gate presets
(`plan-gate`, `tdd-gate`, `scope-guard`) to enforce spec-first / test-first /
in-scope discipline:

```bash
rstack-agents init --framework claude-code --gates plan,tdd,scope
```

This appends the chosen gate hooks to `PreToolUse` **after** the guard (guard
stays first). Off by default. `tdd-gate` blocks production-code edits with no
matching test (overridable via `RSTACK_ALLOW_NO_TESTS=1` or an audited approval);
`plan-gate`/`scope-guard` only warn. Full guide: [quality-gates.md](quality-gates.md).

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

**What remains Pi-only:** automatic `RSTACK_VALIDATOR_CONTEXT` stamping on
delegated validator subprocesses (in Claude Code, set the env or `--context`
yourself when spawning validator work). Orchestrator/context packet injection is
**no longer Pi-only** — the `context` hook (#255) injects it on SessionStart and
UserPromptSubmit. Run-event logging of `tool_call`/`tool_result` plus subagent,
compaction, and failure events into `events.jsonl` is wired via the observe hooks
(#251/#255). The enforcement policy itself — destructive gate + validator
sandbox — is identical.

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
| `.claude/settings.json` hooks | PreToolUse guard + observe (PostToolUse/PostToolUseFailure/Subagent*/PreCompact/Stop/SessionEnd) + context (SessionStart/UserPromptSubmit) + notify-hook (Notification) + SessionStart hub |
| `rstack-agents` | CLI setup, validation, decisions, readiness, hub, guard, observe, context, notify-hook, and notifications |

## Context injection

The `SessionStart` and `UserPromptSubmit` hooks pipe their payload into
`rstack-agents context`, which emits a small structural packet in Claude Code's
`{"hookSpecificOutput":{"hookEventName":"...","additionalContext":"..."}}` shape:

- the active run id + current stage,
- the count of pending approvals + open decisions (the Decision Queue), and
- a one-line orchestrator pointer.

So a Claude Code agent starts each prompt RStack-aware — the analog of Pi's
session-start orchestrator packet, now on every harness. `context` is strictly
additive: it **can't block or deny** (context hooks never can), it **injects
nothing** (no stdout) when there is no active run, and it **never injects
secrets** — the packet is built only from ids/stage/integer counts RStack
generates, never from prompt text, tool inputs, or decision question text, so
there is no channel for a credential to reach the model. The injected string is
capped at ~1KB.

```bash
# no active run = silent no-op, exit 0, no stdout:
echo '{"hook_event_name":"UserPromptSubmit","prompt":"hi"}' \
  | npx rstack-agents context --source claude-code --verbose
```

## Notifications

The `Notification` hook pipes into `rstack-agents notify-hook`, which forwards the
host's notification (e.g. "Claude needs your input", "task finished") to every
configured channel via the notifications router (Slack/Teams/Discord/Telegram/
WhatsApp). Configure a channel with `RSTACK_SLACK_WEBHOOK` (or Teams/Discord/…
env vars, or `.rstack/notifications.json`). Best-effort: it **never blocks**,
**no-ops** when no channel is configured (no parse, no network), redacts secrets
from the message, and is timeout-bounded per channel — a slow webhook can never
stall your session.

## Observability

```bash
npx rstack-business
```

Run timelines, stage durations, approvals, alerts, and traceability on :3008 —
aggregated across every project on this machine.

The dashboard derives everything from each run's `events.jsonl`. The observe
hooks feed `rstack-agents observe`, which appends a normalized event — the SAME
shape the Pi extension writes (`{ ts, source, type, ... }`) plus a
`source: "claude-code"` label. Coverage (#251/#255):

- `PostToolUse` → `tool_result`, `PostToolUseFailure` → error `tool_result`
- `SubagentStart` / `SubagentStop` → `subagent_started` / `subagent_stopped`
  (with `agent_type`) so delegated builders/validators appear in the timeline
- `PreCompact` → `context_preserved` (with `trigger`) when context is trimmed
- `Stop` / `SessionEnd` → `session_shutdown`

So terminal work, delegated subagents, tool failures, and compaction all show up
in the Business Hub within one poll cycle, exactly like a Pi run. `observe` is
strictly additive: it **never blocks** a tool call (always exits 0), **redacts
secrets** (secret paths, inline credentials, and file-content fields), and
**no-ops silently** when there is no active RStack run — it can only add
visibility, never disrupt your session.

Verify observe is wired:

```bash
npx rstack-agents doctor --framework claude-code   # includes an "observability wired" check
# or exercise it directly (no active run = silent no-op, exit 0):
echo '{"tool_name":"Bash","tool_input":{"command":"ls"},"hook_event_name":"PostToolUse"}' \
  | npx rstack-agents observe --source claude-code --verbose
```
