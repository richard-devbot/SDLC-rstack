---
description: "Record a human approval or rejection at a gate — a human decision, never make this call yourself"
argument-hint: "<artifact> <APPROVED|REJECTED> [comments]"
allowed-tools: Bash
owner: RStack developed by Richardson Gunde
---

# /sdlc-approve

Drives the `sdlc_approve` tool. No SDLC logic lives here — the harness in
`src/core/harness/` owns every decision; this command only shells out to it.

This is a human gate. Only run it when the user themselves is issuing the
approval or rejection — never approve/reject on the model's own judgment.

Parse `$ARGUMENTS` positionally: `<artifact>` (required — the artifact or
stage id being approved, e.g. `architecture.md` or `002-requirements`),
`<APPROVED|REJECTED>` (required `status`), then the rest of `$ARGUMENTS` as
the optional `comments`.

```bash
RSTACK_PROJECT_ROOT="$(pwd)" RSTACK_BRIDGE_CALLER=claude-code-plugin \
  npx rstack-bridge sdlc_approve '{"artifact": "<artifact>", "status": "APPROVED"}'
```

Parse the JSON on stdout and show `content[0].text` to the user verbatim. On
a non-zero exit (including run-id ambiguity — more than one run and no
session pin), show the stderr message and ask which run before retrying.
