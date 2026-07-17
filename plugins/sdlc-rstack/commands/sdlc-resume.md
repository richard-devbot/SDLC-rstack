---
description: "Resume an interrupted RStack run — identify the pinned run and advance everything the harness can do without a fresh builder"
argument-hint: "[run-id]"
allowed-tools: Bash, Read
owner: RStack developed by Richardson Gunde
---

# /sdlc-resume

Use this when a governed run exists but the session driving it is gone:
"please continue", "resume the pipeline", or a fresh session picking up
mid-run. This drives the `rstack-agents` CLI directly rather than a single
`sdlc_*` tool, because resuming is a multi-step recipe, not one call.

## 1. Identify the run (never guess)

```bash
npx rstack-agents pipeline status --json
```

The session pin (`.rstack/session.json`) resolves the run. If `$ARGUMENTS`
names a different run id, pass `--run-id <id>`. Read from the output: the
current stage and task, failed stages and their `retry_state`, pending
approval blockers, and the recommended next action.

If this errors with "No RStack run found", there is nothing to resume — say
so and stop. Do not start a new run with `/sdlc-start` unless the user asks
for one; that would orphan the interrupted run.

## 2. Advance everything the harness can do without a model

```bash
npx rstack-agents pipeline run --run-id <run_id> --max-steps 5
```

This skips DONE work, re-claims retryable failures, validates finished
contracts, and STOPS at every human gate. Report each stop verbatim:

1. `pending_approval` — surface the artifact name; wait for `/sdlc-approve`
   or a Business Hub approval. Never approve it yourself.
2. `ask_user` — a validator needs human context. Ask the question, wait.
3. `blocked_retry_policy` — the retry budget is exhausted; a
   `guardrail-override:<task_id>` approval card is already queued. Surface
   it and wait.
4. `missing_contract` — a task is `IN_PROGRESS` with a prepared packet and
   no `builder.json` yet: that is your work. Continue to step 3 below.

## 3. Re-enter the interrupted task

Recover context from the run's own state, never from memory of the dead
session:

```bash
cat .rstack/runs/<run_id>/tasks/<task_id>/prompt.md        # the prepared packet
cat .rstack/runs/<run_id>/tasks/<task_id>/validation.json  # why the last attempt failed, if present
```

Execute the packet, then run `/sdlc-validate`. Repeat step 2 until the
pipeline completes or stops on a human gate.

## Hard rules

- Do NOT call `/sdlc-start` while an incomplete run exists.
- Do NOT regenerate stages whose tasks are `PASSED` — refine existing
  artifacts only when a validation failure demands it.
- Approvals and decisions are human gates. Surface them; never work around
  them.
