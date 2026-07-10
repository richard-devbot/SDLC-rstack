# RStack SDLC — Claude Code integration

<!-- owner: RStack developed by Richardson Gunde -->

This project uses RStack for governed SDLC runs. State lives in `.rstack/`.

## Commands (via the sdlc-automation plugin)

- `/sdlc-start` — start the full pipeline (interactive)
- `/sdlc-status` — which agents completed, which are pending
- `/sdlc-resume` — resume from a specific agent
- `/sdlc-agent <name>` — run one SDLC agent in isolation

## Enforcement

The PreToolUse hook in `.claude/settings.json` routes Bash/Write/Edit calls
through `rstack-agents guard`: destructive actions (recursive deletes, force
pushes, publishes, deploys, secret writes, db drops) block until a
`destructive-action:<taskId>` approval exists on the run, and
validator/reviewer/security contexts are read-only. Details:
`docs/integrations/claude-code.md` in the rstack-agents package.

## Dashboard

`npx rstack-business` opens the Business Hub on :3008 — run timelines,
stage durations, approvals, alerts, and traceability for every run.
