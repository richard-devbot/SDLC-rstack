# Wire RStack Enforcement into Any Harness

<!-- owner: RStack developed by Richardson Gunde -->

RStack's runtime enforcement — the destructive-action gate and the validator
sandbox — lives behind ONE framework-neutral command:

```bash
rstack-agents guard
```

Pipe a pending tool call in (JSON on stdin, or `--tool/--command/--path`
flags) and read the verdict:

| Signal | Meaning |
|---|---|
| exit `0` | allow — verdict JSON on stdout |
| exit `2` | block — verdict JSON on stdout, human-readable reason on stderr |

That is the whole adapter contract. Claude Code is wired automatically by
`init --framework claude-code` (see [claude-code.md](claude-code.md)); Pi has
a native extension. For **codex, gemini-cli, or your own agent loop**, you
don't have to figure out the wiring yourself — paste the guided prompt below
into your coding agent and let it wire its own harness.

## The paste-in prompt

Copy everything in the block below into your coding agent (the one running in
the project where you ran `npx rstack-agents init`):

````text
Wire RStack's enforcement guard into this harness. RStack is installed in
this project (the `rstack-agents` npm package; governed state lives in
`.rstack/`). The guard is a CLI that classifies one pending tool call and
returns a verdict via exit code. Your job: route this harness's shell and
file-write tool calls through it BEFORE they execute, and honor the verdict.

THE GUARD CONTRACT

- Command: `npx --yes rstack-agents guard --context builder`
  (add `--project <repo-root>` if the hook does not run with the project as
  its working directory).
- Input, either form:
  a) JSON on stdin: {"tool_name": "Bash", "tool_input": {"command": "..."}}
     or {"tool_name": "Write", "tool_input": {"file_path": "..."}}
     ("Edit" works like "Write"; tool names are case-insensitive), or
  b) flags: `--command "<shell command>"` or `--path "<write target>"`.
- Output: one line of JSON on stdout:
  {"decision":"allow"|"block","category":...,"reason":...,"context":...,"tool":...}
- Exit code 0 = allow the tool call. Exit code 2 = BLOCK the tool call and
  feed the guard's stderr text back to the model as the reason, so it can
  request an approval instead of retrying blindly. Treat any other exit code
  as allow (the guard itself never exits non-0/2 by design).

WHAT TO WIRE

1. Find this harness's tool-call interception mechanism — the hook, callback,
   middleware, or wrapper that runs BEFORE a tool executes (examples: a
   "pre tool use" hook, a tool-call event handler, a wrapper around the
   shell-exec and file-write functions). If the harness has no such
   mechanism, wrap the tool implementations themselves.
2. For every shell-execution tool call, invoke the guard with the command
   (stdin JSON or `--command`). For every file write/edit tool call, invoke
   it with the target path (`--path`). Read-only tools do not need the guard.
3. Environment to pass through to the guard process:
   - `RSTACK_TASK_ID=<active task id>` when the harness knows which RStack
     task is being executed — destructive actions are approved per task
     (`destructive-action:<taskId>` on the run's approvals). Alternatively
     pass `--task <taskId>`.
   - `--context validator` (or `RSTACK_AGENT_CONTEXT=validator`) on any
     subprocess that reviews/validates/audits rather than builds — that
     context is read-only: ALL writes and mutating shell commands are denied
     outright, with no approval path.
   - Never set `RSTACK_ALLOW_DESTRUCTIVE` in normal operation; it is the
     human emergency override for the builder gate.
4. On block (exit 2): cancel the tool call, surface the stderr reason to the
   model/user verbatim. Do NOT auto-retry the same command.

VERIFY YOUR WIRING (run these through the wired hook path, not manually)

1. A safe command: `ls -la`
   → guard exits 0, the tool call proceeds.
2. A destructive command in builder context: `rm -rf /tmp/rstack-guard-check`
   → guard exits 2 (no `destructive-action:<taskId>` approval exists), the
   tool call is blocked, and the reason names the approval artifact.
3. A file write in validator context (set `--context validator` or
   `RSTACK_AGENT_CONTEXT=validator` for this one call): write any file, e.g.
   tool_name "Write" with file_path "src/anything.js"
   → guard exits 2 with a "validator context is read-only" reason.

If all three behave as described, the wiring is correct. Show me the hook
code you added and the three verdict JSON lines as evidence.
````

## Notes for adapter authors

- **One source of truth.** The guard reuses the harness classifiers
  (`src/core/harness/destructive-actions.js`, `validator-sandbox.js`) and the
  audited approval path (#133) — do not re-implement classification in your
  hook; just route the call and honor the exit code.
- **Context precedence.** `RSTACK_VALIDATOR_CONTEXT=1` (stamped on delegated
  validator subprocesses) always wins over `--context`, so a sandboxed
  subprocess cannot escape by passing `--context builder`.
- **`--explain`** classifies without the approval lookup and always exits 0 —
  useful for dry-runs and debugging your wiring.
- **Fail semantics.** Destructive actions with unresolvable task/run/approval
  state fail closed (blocked). Payloads the guard cannot classify at all fail
  open with a stderr warning — but raw non-JSON text is sniffed as a shell
  command first, so `rm -rf /` piped as plain text still blocks.
- **Approvals.** Unblock a legitimately destructive task by approving the
  `destructive-action:<taskId>` artifact on the active run via `sdlc_approve`
  or the Business Hub (`npx rstack-agents hub`).
