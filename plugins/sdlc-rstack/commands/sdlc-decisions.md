---
description: "List the run's Decision Queue, or add a new pending decision"
argument-hint: "[question] [--stage <canonical-stage-id>]"
allowed-tools: Bash
owner: RStack developed by Richardson Gunde
---

# /sdlc-decisions

Drives the `sdlc_decisions` tool. No SDLC logic lives here — the harness in
`src/core/harness/` owns every decision; this command only shells out to it.

If `$ARGUMENTS` is empty, call with no `question` to just list the queue.
Otherwise, parse `$ARGUMENTS` for `--stage <id>` (→ `required_before_stage`,
must be a canonical stage id or the tool refuses it) and treat the remainder
as the `question` text.

```bash
RSTACK_PROJECT_ROOT="$(pwd)" RSTACK_BRIDGE_CALLER=claude-code-plugin \
  npx rstack-bridge sdlc_decisions '{}'
```

Parse the JSON on stdout and show `content[0].text` to the user verbatim —
pending/resolved/waived counts and the pending list. On a non-zero exit,
show the stderr message instead of retrying blindly.
