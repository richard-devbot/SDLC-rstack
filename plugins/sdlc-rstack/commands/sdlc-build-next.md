---
description: "Claim and prepare the next pending builder task (enforces attempt budgets and approval gates)"
argument-hint: "[run-id]"
allowed-tools: Bash
owner: RStack developed by Richardson Gunde
---

# /sdlc-build-next

Drives the `sdlc_build_next` tool. No SDLC logic lives here — the harness in
`src/core/harness/` owns every decision (claim order, attempt budgets, DoR
gate); this command only shells out to it.

`$ARGUMENTS`, if present, is the `run_id`; omit the field to use the pinned
session run.

```bash
RSTACK_PROJECT_ROOT="$(pwd)" RSTACK_BRIDGE_CALLER=claude-code-plugin \
  npx rstack-bridge sdlc_build_next '{}'
```

Parse the JSON on stdout and show `content[0].text` to the user verbatim —
the prepared task packet, or the reason nothing could be claimed (blocked on
approval, retry budget exhausted, or the run is complete). Execute the
prepared task exactly as instructed, then run `/sdlc-validate`. On a
non-zero exit, show the stderr message instead of retrying blindly.
