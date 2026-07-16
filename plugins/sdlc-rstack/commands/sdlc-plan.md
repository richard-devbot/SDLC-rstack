---
description: "Build the stage/task graph for the active RStack run"
argument-hint: "[--domains d1,d2] [--constraints c1;c2]"
allowed-tools: Bash
owner: RStack developed by Richardson Gunde
---

# /sdlc-plan

Drives the `sdlc_plan` tool. No SDLC logic lives here — the harness in
`src/core/harness/` owns every decision; this command only shells out to it.

Parse `$ARGUMENTS` for `--domains a,b,c` (comma-separated → `domains` array)
and `--constraints x;y;z` (semicolon-separated → `constraints` array). Both
are optional — omit either field entirely if not given; omitting `domains`
lets the harness fall back to the project's configured `enabled_domains`.

```bash
RSTACK_PROJECT_ROOT="$(pwd)" RSTACK_BRIDGE_CALLER=claude-code-plugin \
  npx rstack-bridge sdlc_plan '{"domains": ["backend", "qa"], "constraints": []}'
```

Parse the JSON on stdout and show `content[0].text` to the user verbatim.
Then suggest `/sdlc-dor-check` before the first `/sdlc-build-next`. On a
non-zero exit, show the stderr message instead of retrying blindly.
