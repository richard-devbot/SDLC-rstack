---
description: "List RStack package-local and project-local agents/skills/plugins by domain, for routing and team assembly"
argument-hint: "[agent|skill|plugin] [domain]"
allowed-tools: Bash
owner: RStack developed by Richardson Gunde
---

# /sdlc-agents

Drives the `sdlc_agents` tool. No SDLC logic lives here — the harness in
`src/core/harness/` owns every decision; this command only shells out to it.

Parse `$ARGUMENTS` positionally: an optional `kind` (`agent`, `skill`, or
`plugin`), then an optional `domain` filter. Omit either field entirely if
not given.

```bash
RSTACK_PROJECT_ROOT="$(pwd)" RSTACK_BRIDGE_CALLER=claude-code-plugin \
  npx rstack-bridge sdlc_agents '{}'
```

Parse the JSON on stdout and show `content[0].text` to the user verbatim. On
a non-zero exit, show the stderr message instead of retrying blindly.
