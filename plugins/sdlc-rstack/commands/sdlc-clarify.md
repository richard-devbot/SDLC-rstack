---
description: "Capture product-owner answers before planning, or list the recommended clarifying questions"
argument-hint: "[answer-1 | answer-2 | ...]"
allowed-tools: Bash
owner: RStack developed by Richardson Gunde
---

# /sdlc-clarify

Drives the `sdlc_clarify` tool. No SDLC logic lives here — the harness in
`src/core/harness/` owns every decision; this command only shells out to it.

If `$ARGUMENTS` is empty, call with no `answers` to get the recommended
question list back. Otherwise split `$ARGUMENTS` on `|` into an `answers`
array (one clarification per segment, trimmed).

```bash
RSTACK_PROJECT_ROOT="$(pwd)" RSTACK_BRIDGE_CALLER=claude-code-plugin \
  npx rstack-bridge sdlc_clarify '{"answers": ["<answer-1>", "<answer-2>"]}'
```

Parse the JSON on stdout and show `content[0].text` to the user verbatim —
either the question list or the confirmation that answers were recorded. On
a non-zero exit, show the stderr message instead of retrying blindly.
