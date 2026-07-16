---
description: "Start a governed RStack run under .rstack/runs/<id>/ for a software goal"
argument-hint: "<goal> [--express]"
allowed-tools: Bash
owner: RStack developed by Richardson Gunde
---

# /sdlc-start

Drives the `sdlc_start` tool. No SDLC logic lives here — the harness in
`src/core/harness/` owns every decision; this command only shells out to it.

Do NOT call this if an incomplete run already exists (`npx rstack-agents
pipeline status` shows one) — that orphans the first run. Use `/sdlc-resume`
instead.

Parse `$ARGUMENTS`: everything except a trailing `--express` flag is the
required `goal` string. `--express` maps to `"mode": "express"`; otherwise
omit `mode` (defaults to `"interactive"`).

```bash
RSTACK_PROJECT_ROOT="$(pwd)" RSTACK_BRIDGE_CALLER=claude-code-plugin \
  npx rstack-bridge sdlc_start '{"goal": "<goal>", "mode": "interactive"}'
```

Parse the JSON on stdout and show `content[0].text` to the user verbatim.
Then suggest `/sdlc-clarify` or `/sdlc-plan` as the next step. On a non-zero
exit, show the stderr message instead of retrying blindly.
