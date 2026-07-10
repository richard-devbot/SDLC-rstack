# RStack on any framework (custom integration)

<!-- owner: RStack developed by Richardson Gunde -->

RStack's host coupling is intentionally thin. Any agent framework can
integrate at one of two levels.

## Level 1 — reuse the Node bridge (recommended)

Shell out to the bridge once per tool call, exactly like the Operator and Tau
adapters do:

```bash
RSTACK_PROJECT_ROOT=/path/to/project \
  npx tsx node_modules/rstack-agents/bin/rstack-bridge.ts <tool_name> '<json-params>'
```

- stdout: the tool's result object as JSON
- stderr + exit 1: errors
- Tools: `sdlc_start`, `sdlc_plan`, `sdlc_build_next`, `sdlc_validate`,
  `sdlc_approve`, `sdlc_status`, `sdlc_trace`, `sdlc_rollback`, and more —
  run with `--list` for the full listing.
- Set `RSTACK_BRIDGE_CALLER=<your-framework>` so tool invocations carry your
  framework's id.

This gives you the full governed harness (stages, contracts, evidence,
checkpoints, approvals, memory) with zero reimplementation. Before you ship
an adapter, walk the conformance checklist in
[adapter-contract.md](adapter-contract.md).

**Wire enforcement** into your host's tool-call hook so destructive actions are
gated (the same guard Pi/Claude Code/Tau use):

```bash
echo '{"tool_name":"Bash","tool_input":{"command":"rm -rf /tmp/x"}}' | npx rstack-agents guard --context builder   # exit 2 = block
```

[wire-your-own-harness.md](wire-your-own-harness.md) has a paste-in prompt your
coding agent can follow to do the wiring for you.

## Verify

```bash
npx rstack-agents init --framework custom
npx rstack-agents doctor --framework custom
```

`doctor` checks the environment, `.rstack/` config, that the bridge and guard
are reachable, and runs a live guard self-test — every failure prints its fix.
The harness-agnostic CLI (`pipeline status/run/loop`, `adopt`, `decisions`,
`dor`, `npx rstack-business`) works regardless of host:
[README.md → Everyday commands](README.md#everyday-commands-any-framework).

## Level 2 — speak the state contract directly

All state lives under `.rstack/runs/<run_id>/`:

| Artifact | Contract |
|---|---|
| `manifest.json` | `run_id`, `goal`, `mode`, `status`, timestamps |
| `tasks.json` | Task list with `stage_artifacts[].stage_id` (canonical stages) |
| `tasks/<task_id>/builder.json` | Builder contract: `task_id`, `status`, `summary`, `files_modified`, `tests_run`, `risks`, `next_steps`, `memory_summary`, `stage_summaries` |
| `tasks/<task_id>/validation.json` | Validator report: `checks[]`, `status`, `issues[]` |
| `events.jsonl` | Append-only events (`task_started`, `task_validated`, `stage_completed`, `cost_recorded`, …) with ISO `ts` |
| `evidence.jsonl` | Evidence records: `task_id`, `kind`, `status`, `evidence` |
| `approvals.json` | Human approval gates |
| `metrics.json` | `stage_elapsed_ms`, `stage_status`, cumulative totals |

Anything that writes these contracts shows up in the Business Hub with full
timelines, stage durations, and traceability — the dashboard derives
everything from this data.

## The 15 canonical stages

`00-environment` → `01-transcript` → `02-requirements` → `03-documentation` →
`04-planning` → `05-jira` → `06-architecture` → `07-code` → `08-testing` →
`09-deployment` → `10-summary` (+ optional `11-feedback-loop`,
`12-security-threat-model`, `13-compliance-checker`, `14-cost-estimation`).

Stage ids in events and artifacts must be canonical — validate against
`src/core/harness/stages.js`.
