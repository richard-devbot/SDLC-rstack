---
description: "Show the active RStack run's status, task progress, and next recommended action"
argument-hint: "[run-id]"
allowed-tools: Bash
owner: RStack developed by Richardson Gunde
---

# /sdlc-status

Drives the `sdlc_status` tool. No SDLC logic lives here — the harness in
`src/core/harness/` owns every decision; this command only shells out to it.

`$ARGUMENTS`, if present, is the `run_id`; omit the field to use the pinned
session run (or the newest run if none is pinned).

```bash
RSTACK_PROJECT_ROOT="$(pwd)" RSTACK_BRIDGE_CALLER=claude-code-plugin \
  npx rstack-bridge sdlc_status '{}'
```

Parse the JSON on stdout and show `content[0].text` to the user verbatim. On
a non-zero exit (including "no RStack run found"), say so plainly — do not
start a new run unless the user asks for one.
