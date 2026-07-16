---
description: "Load the RStack orchestrator/builder/validator instructions into the active task — call this before coding with RStack"
argument-hint: "[goal]"
allowed-tools: Bash
owner: RStack developed by Richardson Gunde
---

# /sdlc-orchestrate

Drives the `sdlc_orchestrate` tool. No SDLC logic lives here — the harness in
`src/core/harness/` owns every decision; this command only shells out to it.

Build the JSON params from `$ARGUMENTS` (everything the user typed after the
command is the optional `goal` string; omit the field entirely if empty):

```bash
RSTACK_PROJECT_ROOT="$(pwd)" RSTACK_BRIDGE_CALLER=claude-code-plugin \
  npx rstack-bridge sdlc_orchestrate '{"goal": "<goal-or-omit>"}'
```

Parse the JSON printed on stdout and show `content[0].text` to the user
verbatim — it is the orchestrator/builder/validator packet, already formatted
for the model to follow. On a non-zero exit, show the stderr message instead
of retrying blindly.
