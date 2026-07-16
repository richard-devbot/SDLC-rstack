---
description: "Deep-dive trace view of tool calls and results for a single task"
argument-hint: "[task-id] [run-id]"
allowed-tools: Bash
owner: RStack developed by Richardson Gunde
---

# /sdlc-trace

Drives the `sdlc_trace` tool. No SDLC logic lives here — the harness in
`src/core/harness/` owns every decision; this command only shells out to it.

Parse `$ARGUMENTS` positionally: an optional `task_id`, then an optional
`run_id`. Omit either field entirely if not given (defaults to the newest
run and its whole event/evidence trail).

```bash
RSTACK_PROJECT_ROOT="$(pwd)" RSTACK_BRIDGE_CALLER=claude-code-plugin \
  npx rstack-bridge sdlc_trace '{}'
```

Parse the JSON on stdout and show `content[0].text` to the user verbatim. On
a non-zero exit (including "no RStack run found"), say so plainly. On a
non-zero exit, show the stderr message instead of retrying blindly.
