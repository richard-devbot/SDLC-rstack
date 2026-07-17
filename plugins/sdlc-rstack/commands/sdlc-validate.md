---
description: "Produce a read-only validation report for the in-progress (or named) task"
argument-hint: "[task-id]"
allowed-tools: Bash
owner: RStack developed by Richardson Gunde
---

# /sdlc-validate

Drives the `sdlc_validate` tool. No SDLC logic lives here — the harness in
`src/core/harness/` owns every decision (required-checks evaluation, retry
policy, telemetry budgets); this command only shells out to it.

`$ARGUMENTS`, if present, is the `task_id`; omit the field to validate
whichever task is currently `IN_PROGRESS`.

```bash
RSTACK_PROJECT_ROOT="$(pwd)" RSTACK_BRIDGE_CALLER=claude-code-plugin \
  npx rstack-bridge sdlc_validate '{}'
```

Parse the JSON on stdout and show `content[0].text` to the user verbatim —
PASS/FAIL plus every check. On FAIL, do not re-attempt the task yourself;
run `/sdlc-build-next` again to re-claim it under the retry policy. On a
non-zero exit, show the stderr message instead of retrying blindly.
