---
description: "Read or update a specific SDLC artifact (vision, requirements, architecture, ...) in the run's specs directory"
argument-hint: "<artifact> [read|update] [content...]"
allowed-tools: Bash
owner: RStack developed by Richardson Gunde
---

# /sdlc-spec

Drives the `sdlc_spec` tool. No SDLC logic lives here — the harness in
`src/core/harness/` owns every decision; this command only shells out to it.

Parse `$ARGUMENTS` positionally: `<artifact>` (required — one of
`product-brief.md`, `requirements.json`, `architecture.md`,
`implementation-report.json`, `qa-report.json`, `security-review.md`,
`handoff.md`, `release-readiness.json`), then an optional `read`/`update`
keyword (default `read`), then — only when the action is `update` — the rest
of `$ARGUMENTS` becomes the `content` field.

```bash
RSTACK_PROJECT_ROOT="$(pwd)" RSTACK_BRIDGE_CALLER=claude-code-plugin \
  npx rstack-bridge sdlc_spec '{"artifact": "<artifact>", "action": "read"}'
```

Parse the JSON on stdout and show `content[0].text` to the user verbatim. On
a non-zero exit, show the stderr message instead of retrying blindly.
