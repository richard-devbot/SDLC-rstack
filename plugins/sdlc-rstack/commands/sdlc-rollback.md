---
description: "Restore a stage to its last verified checkpoint, reverting directory state — confirm with the user first, this is destructive"
argument-hint: "<stage-id> [run-id]"
allowed-tools: Bash
owner: RStack developed by Richardson Gunde
---

# /sdlc-rollback

Drives the `sdlc_rollback` tool. No SDLC logic lives here — the harness in
`src/core/harness/` owns every decision (checkpoint integrity verification,
corrupt-checkpoint refusal); this command only shells out to it.

This reverts real files on disk. Confirm with the user which stage and run
before running it — never call it speculatively.

Parse `$ARGUMENTS` positionally: `<stage-id>` (required, e.g. `06-architecture`
or `07-code`), then an optional `run_id`.

```bash
RSTACK_PROJECT_ROOT="$(pwd)" RSTACK_BRIDGE_CALLER=claude-code-plugin \
  npx rstack-bridge sdlc_rollback '{"stage_id": "<stage-id>"}'
```

Parse the JSON on stdout and show `content[0].text` to the user verbatim —
including a `CORRUPT` checkpoint refusal, which is not an error to retry
around. On a non-zero exit, show the stderr message instead of retrying
blindly.
