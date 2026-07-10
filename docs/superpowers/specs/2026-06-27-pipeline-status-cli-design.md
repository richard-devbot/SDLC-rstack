<!-- owner: RStack developed by Richardson Gunde -->

# Pipeline Status CLI Design

## Purpose

Implement GitHub issue #115 as the next isolated Backend Loop Engineering change after the pipeline-state rollup from #113. The command must expose authoritative harness state to terminal users, CI, and automation without requiring Business Hub.

## Delivery Boundaries

- Work is delivered on `codex/ble-1-pipeline-status-115`.
- The branch starts from merged `main` commit `7dd082b0bf5f28a75fb822b7445359aebac7268e`.
- The PR closes only #115.
- Issue #116 and Backend Loop Engineering Epics 2–6 remain separate design, implementation, and PR cycles.
- No dashboard, pipeline execution, retry-policy, or agent-prompt behavior changes are included.

## Architecture

Add a focused command module under `src/commands/pipeline.js`. It owns pipeline-status loading, deterministic next-action selection, and text formatting. `bin/rstack-agents.js` only registers the Commander command group, maps options, prints the selected representation, and handles process exit behavior.

The command reuses:

- `resolveRunId(projectRoot, runId)` for safe explicit or latest-run selection.
- `readPipelineState(projectRoot, runId)` for persisted state access.
- `writePipelineState(projectRoot, runId)` for explicit regeneration.
- The complete pipeline-state object as the JSON contract.

This keeps the run directory and its existing artifacts authoritative. The CLI does not create a second state model.

## Interfaces

`src/commands/pipeline.js` exports:

```js
export async function loadPipelineStatus(projectRoot, options = {})
export function recommendPipelineAction(state)
export function formatPipelineStatus(state)
```

`loadPipelineStatus` returns:

```js
{
  state,
  runId,
}
```

It resolves the run ID first. With `options.regenerate === true`, it always rebuilds and persists the rollup from canonical artifacts. Otherwise, it reads `pipeline-state.json`. If the state file is absent or unusable without regeneration, it throws an actionable error that names `--regenerate`.

## CLI Contract

The public command is:

```text
rstack-agents pipeline status [options]
```

Supported options:

| Option | Behavior |
| --- | --- |
| `-p, --project <path>` | Resolve the target project root; defaults to the current directory. |
| `-r, --run-id <runId>` | Select an explicit validated run ID; defaults to the latest run. |
| `--json` | Print the complete pipeline-state object as JSON with no decorative text. |
| `--regenerate` | Rebuild and persist the rollup from canonical run artifacts, replacing stale or malformed state. |

Text output includes:

- run ID and goal
- manifest and pipeline status
- current stage and task
- passed, failed, and pending stage counts
- failed stage IDs with attempt counts
- retry-event count
- pending approval blockers
- guardrail-event count
- cumulative duration, cost, tool calls, and context usage when available
- one next recommended backend action

## Next-Action Rules

The recommendation is deterministic and uses this priority:

1. Pending approval blockers: resolve the first blocker.
2. Failed stages: inspect or retry the first failed stage.
3. Active stage: continue the current stage/task.
4. Pending stages: start the first pending stage.
5. Complete pipeline: report that no backend action is required.
6. Unknown state: inspect the run artifacts.

The function returns plain text and performs no mutations.

## Error Handling

- Invalid run IDs use the existing traversal-safe validation and exit non-zero.
- A project with no runs reports how to start a run and exits non-zero.
- A missing or malformed rollup without `--regenerate` reports the exact recovery flag and exits non-zero.
- An unreadable rollup reports the underlying filesystem failure and exits non-zero.
- JSON mode never mixes errors or formatted status text into stdout.
- Regeneration writes through the existing file lock and atomic JSON writer from #113.

## Testing

Create `tests/pipeline-cli.test.js` with temporary real run directories and child-process CLI execution.

Coverage includes:

1. Text output contains run metadata, stage counts, current work, blockers, events, totals, and recommendation.
2. JSON output parses as the complete pipeline-state object.
3. Omitting `--run-id` selects the latest run.
4. `--regenerate` creates a missing `pipeline-state.json` and replaces malformed state.
5. Missing or malformed state without `--regenerate` fails with the recovery instruction.
6. Invalid run IDs fail without reading outside `.rstack/runs`.
7. A project with no runs fails with the existing start-run guidance.
8. Recommendation priority is tested directly for approvals, failures, active work, pending work, completion, and unknown state.

The implementation follows red-green-refactor. Each behavior begins with a failing test that is observed before production code changes.

## Verification Gates

Before opening the PR:

```text
node --test tests/pipeline-cli.test.js tests/pipeline-state.test.js
npm test
npm run validate
npm run lint
node scripts/security-audit.mjs
git diff --check
```

When the managed local environment blocks socket-listening tests, the blocked cases are reported explicitly and the unrestricted GitHub CI result is required before merge.

## Acceptance Mapping

| Issue #115 requirement | Design coverage |
| --- | --- |
| Works without Business Hub | Command reads harness files through the pipeline-state module. |
| Targets latest or explicit run | `resolveRunId` handles both paths. |
| Machine-readable output | `--json` emits the complete state object only. |
| Regenerates missing rollup | `--regenerate` calls the atomic pipeline-state writer. |
| Text, JSON, and invalid-ID tests | Dedicated child-process tests cover all three. |
| Shows operational status and next action | Formatter and deterministic recommendation rules cover the required fields. |
