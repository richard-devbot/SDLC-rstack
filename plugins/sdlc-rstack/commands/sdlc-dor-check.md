---
description: "Evaluate unresolved decisions and write the Definition-of-Ready report for the active run"
argument-hint: "[target-stage]"
allowed-tools: Bash
owner: RStack developed by Richardson Gunde
---

# /sdlc-dor-check

Drives the `sdlc_dor_check` tool. No SDLC logic lives here — the harness in
`src/core/harness/` owns every decision; this command only shells out to it.

`$ARGUMENTS`, if present, is the canonical `target_stage` id (e.g.
`07-code`); omit the field to default to `07-code`.

```bash
RSTACK_PROJECT_ROOT="$(pwd)" RSTACK_BRIDGE_CALLER=claude-code-plugin \
  npx rstack-bridge sdlc_dor_check '{"target_stage": "07-code"}'
```

Parse the JSON on stdout and show `content[0].text` to the user verbatim —
the readiness status, score, and message. On a non-zero exit, show the
stderr message instead of retrying blindly.
