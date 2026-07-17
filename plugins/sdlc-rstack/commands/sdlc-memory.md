---
description: "Search, append, or summarize RStack project learnings used by future SDLC runs"
argument-hint: "<search|append|summarize> [query-or-learning]"
allowed-tools: Bash
owner: RStack developed by Richardson Gunde
---

# /sdlc-memory

Drives the `sdlc_memory` tool. No SDLC logic lives here — the harness in
`src/core/harness/` owns every decision (including the write policy that
decides what gets trusted); this command only shells out to it.

Parse `$ARGUMENTS` positionally: `<action>` (required — `search`, `append`,
or `summarize`), then the rest of `$ARGUMENTS` is `query` (for `search`) or
`learning` (for `append`).

```bash
RSTACK_PROJECT_ROOT="$(pwd)" RSTACK_BRIDGE_CALLER=claude-code-plugin \
  npx rstack-bridge sdlc_memory '{"action": "search", "query": "<query>"}'
```

Parse the JSON on stdout and show `content[0].text` to the user verbatim. On
a non-zero exit, show the stderr message instead of retrying blindly.
