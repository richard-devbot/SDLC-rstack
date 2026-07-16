---
description: "Generate the static HTML run dashboard and open it in the browser"
argument-hint: "[run-id]"
allowed-tools: Bash
owner: RStack developed by Richardson Gunde
---

# /sdlc-dashboard

Drives the `sdlc_dashboard` tool. No SDLC logic lives here — the harness in
`src/core/harness/` owns every decision; this command only shells out to it.
For the live multi-run dashboard instead of a static snapshot, tell the user
to run `npx rstack-agents hub`.

`$ARGUMENTS`, if present, is the `run_id`; omit the field to use the newest
run.

```bash
RSTACK_PROJECT_ROOT="$(pwd)" RSTACK_BRIDGE_CALLER=claude-code-plugin \
  npx rstack-bridge sdlc_dashboard '{}'
```

Parse the JSON on stdout and show `content[0].text` to the user verbatim
(the generated file path). On a non-zero exit (including "no RStack run
found"), say so plainly instead of retrying blindly.
