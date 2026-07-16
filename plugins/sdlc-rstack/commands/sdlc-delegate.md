---
description: "Spawn one or more RStack agents as isolated workers (validators default to read-only tools)"
argument-hint: "<agent> <task>"
allowed-tools: Bash
owner: RStack developed by Richardson Gunde
---

# /sdlc-delegate

Drives the `sdlc_delegate` tool. No SDLC logic lives here — the harness in
`src/core/harness/` owns every decision (validator sandbox, read-only
defaults); this command only shells out to it.

Parse `$ARGUMENTS` positionally for single-agent mode: `<agent>` (name or id,
e.g. `validator` or a path under `agents/`), then the rest of `$ARGUMENTS` is
the `task` description. For parallel delegation across several agents, ask
the user for each `{agent, task}` pair and build the `tasks` array instead.

```bash
RSTACK_PROJECT_ROOT="$(pwd)" RSTACK_BRIDGE_CALLER=claude-code-plugin \
  npx rstack-bridge sdlc_delegate '{"agent": "<agent>", "task": "<task>"}'
```

Parse the JSON on stdout and show `content[0].text` to the user verbatim. On
a non-zero exit, show the stderr message instead of retrying blindly.
