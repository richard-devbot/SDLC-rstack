---
name: sdlc-resume
description: Resume an interrupted RStack governed run — the session died or the user said "please continue". Identifies the pinned run, advances model-free work with pipeline run, and re-enters the prepared builder packet at the exact stage it stopped. Never restarts the pipeline, never regenerates completed stages.
license: Complete terms in LICENSE.txt
owner: RStack developed by Richardson Gunde
---

# Resume an interrupted RStack run

Use this when a governed run exists but the session driving it is gone:
"please continue", "resume the pipeline", "pick up where we left off", or a
fresh session in a project whose injected RStack context says INCOMPLETE.

This skill is invokable by humans (as `/sdlc-resume`) and by agents — every
step is a plain CLI command; nothing here needs the original session's memory.

## 1. Identify the run (never guess)

```bash
npx rstack-agents pipeline status --json
```

The session pin (`.rstack/session.json`, written by `sdlc_start`/`adopt`)
resolves the run. If the user names a different run, pass `--run-id <id>`.
Read from the output: the current stage and task, the failed stages and their
`retry_state`, pending approval blockers, and the recommended next action.

If this errors with "No RStack run found", there is nothing to resume — say
so and stop. Do not start a new run unless the user asks for one.

## 2. Advance everything the harness can do without a model

```bash
npx rstack-agents pipeline run --run-id <run_id> --max-steps 5
```

This skips DONE work, re-claims retryable failures (the FAIL-first claim
order), validates finished contracts, and STOPS at every human gate. Report
each stop verbatim:

1. `pending_approval` — a human must approve via `sdlc_approve` or the
   Business Hub. Surface the artifact name and wait. Never approve it yourself.
2. `ask_user` — a validator needs human context. Ask the question, wait.
3. `blocked_retry_policy` — the retry budget is exhausted; a
   `guardrail-override:<task_id>` approval card is already in the queue.
   Surface it and wait.
4. `missing_contract` — a task is IN_PROGRESS with a prepared packet and no
   builder.json yet: that is YOUR work. Continue to step 3.

## 3. Re-enter the interrupted task

Recover context from the run's own state, never from memory of the dead
session:

```bash
cat .rstack/runs/<run_id>/tasks/<task_id>/prompt.md        # the prepared packet
cat .rstack/runs/<run_id>/tasks/<task_id>/validation.json  # why the last attempt failed (if present)
```

Execute the packet, write the required `builder.json` contract, then validate
(`sdlc_validate` via your host's RStack tools, or another
`pipeline run` step). Repeat step 2 until the pipeline completes or stops on
a human gate.

## Hard rules

- Do NOT call `sdlc_start` while an incomplete run exists — it creates a
  second run and orphans the first.
- Do NOT regenerate stages whose tasks are PASSED. Refine existing artifacts
  only when a validation failure demands it.
- Approvals and decisions are human gates. Surface them; never work around
  them.
