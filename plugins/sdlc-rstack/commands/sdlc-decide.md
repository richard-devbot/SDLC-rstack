---
description: "Resolve or waive a pending Decision Queue item — a human decision, confirm before waiving"
argument-hint: "<decision-id> <resolution> [--waive]"
allowed-tools: Bash
owner: RStack developed by Richardson Gunde
---

# /sdlc-decide

Drives the `sdlc_decide` tool. No SDLC logic lives here — the harness in
`src/core/harness/` owns every decision; this command only shells out to it.

Parse `$ARGUMENTS` positionally: `<decision-id>` (required), then the
remaining text minus a trailing `--waive` flag is the required `resolution`.
`--waive` maps to `"status": "waived"`; otherwise omit `status` (defaults to
`"resolved"`).

```bash
RSTACK_PROJECT_ROOT="$(pwd)" RSTACK_BRIDGE_CALLER=claude-code-plugin \
  npx rstack-bridge sdlc_decide '{"decision_id": "<decision-id>", "resolution": "<resolution>"}'
```

Parse the JSON on stdout and show `content[0].text` to the user verbatim. On
a non-zero exit, show the stderr message instead of retrying blindly.
