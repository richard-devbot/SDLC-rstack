# RStack Harness

<!-- owner: RStack developed by Richardson Gunde -->

The RStack Harness is the reliability layer around the agents, skills, prompts, and plugins in this package. It does not replace agents. It gives them deterministic run state, contract checks, evidence, and guardrails so a task cannot be treated as complete based on prose alone.

## Canonical SDLC stages

The canonical 15-stage SDLC pipeline lives in `src/core/harness/stages.js`:

```text
00-environment
01-transcript
02-requirements
03-documentation
04-planning
05-jira
06-architecture
07-code
08-testing
09-deployment
10-summary
11-feedback-loop
12-security-threat-model
13-compliance-checker
14-cost-estimation
```

Tests fail if the list is not exactly 15 stages or if the order changes.

## Run folder shape

New runs prepare clean stage folders under:

```text
.rstack/runs/<run_id>/
  artifacts/
    stages/
      00-environment/
      01-transcript/
      ...
      14-cost-estimation/
  tasks/<task_id>/
    prompt.md
    builder.json
    validation.json
  events.jsonl
```

Root artifacts such as `artifacts/requirements.json` remain compatibility outputs. Canonical stage output should go under `artifacts/stages/<stage-id>/` when a stage target is listed in the task prompt.

## Contract checks

Builder contracts are validated by `src/core/harness/contracts.js` and require:

```text
task_id, agent, status, summary, files_modified, tests_run, risks, next_steps
```

Validator contracts require:

```text
task_id, validator, status, checks, issues, retry_recommendation
```

The Pi extension uses these shared checks in `sdlc_validate`. For PASS and DONE_WITH_CONCERNS builders, `sdlc_validate` also requires meaningful `summary`, non-empty `tests_run`, `memory_summary.work_done`, `memory_summary.evidence`, and one evidence-backed `stage_summaries` entry for each canonical stage target listed in the task prompt.

### Validator registry

`src/core/harness/validator-registry.js` maps the critical SDLC stages (`06-architecture`, `07-code`, `08-testing`, `12-security-threat-model`, `13-compliance-checker`) to stage-specific validator profiles: `validator` id, advisory `model_hint`, `read_only: true`, `required_checks`, and `output_contract_fields`. Stages without a registered entry get the generic profile (`validator.generic`). When a task targets several canonical stages, `resolveValidatorProfile` picks the highest-priority registered one (security > compliance > code > testing > architecture).

Projects can override entries per stage in `.rstack/validators/registry.json`:

```json
{
  "07-code": { "model_hint": "sonnet" },
  "09-deployment": { "validator": "validator.09-deployment", "required_checks": ["deployment_report_exists"] }
}
```

Partial entries deep-merge over the defaults per stage; overrides for canonical stages not in the default registry are layered over the generic profile. A malformed file warns loudly and the defaults apply, and `read_only` can never be flipped to `false`.

`sdlc_validate` resolves the profile from the task's canonical stage targets and records it in `validation.json` as `validator_profile` (`stage_id`, `validator`, `model_hint`, `required_checks`) alongside the existing `validator` field, plus an informational `validator_profile_selected` check. Executing `required_checks` per profile is future work — the recorded profile is the routing contract.

## Evidence ledger

Raw runtime events are appended to `events.jsonl`. Validator-grounded task evidence is appended to `evidence.jsonl` with:

```json
{"task_id":"004-implementation","kind":"validation","status":"PASS","evidence":"tasks/004-implementation/validation.json"}
```

`src/core/harness/evidence.js` rejects missing `task_id`, `kind`, `status`, or `evidence` fields.

## Agent episodic memory

Validator-approved tasks are written to an agent/stage scoped episodic memory store by `src/memory/index.js`.

Default storage is configurable and resolves to:

```text
${RSTACK_HOME:-~/.rstack}/projects/<project-slug>/memory/
  episodes.jsonl
  facts.jsonl
  retractions.jsonl
  retrieval-events.jsonl
```

Override storage without changing code by setting `RSTACK_MEMORY_DIR` or by adding `.rstack/memory-config.json`:

```json
{
  "memory": {
    "backend": "jsonl",
    "retrieval": "lexical",
    "topK": 3,
    "maxInjectedChars": 1800,
    "writePolicy": "validator-approved-only",
    "embeddingProvider": "none"
  }
}
```

Memory is injected into builder prompts only as bounded historical context. It is explicitly non-authoritative and cannot override the current task, user approvals, tool safety, or validator gates.

Every builder prompt asks agents to add compact summary fields to `builder.json`:

```json
{
  "memory_summary": {
    "work_done": "",
    "decisions": [],
    "evidence": [],
    "context_to_keep": [],
    "context_to_drop": [],
    "next_agent_hints": []
  },
  "stage_summaries": [
    {
      "stage_id": "07-code",
      "agent_id": "agent.07-code",
      "work_done": "",
      "evidence": [],
      "context_to_keep": [],
      "context_to_drop": []
    }
  ]
}
```

This is the context-reduction path. Later agents receive durable decisions, evidence, and handoff hints instead of full transcripts or raw logs.

## Guardrails

Guardrail defaults live in `src/core/harness/guardrails.js`:

- `maxTaskAttempts: 2`
- `maxDestructiveTaskAttempts: 1`
- `maxToolCallsPerTask: 40`
- `maxMessagesPerTask: 25`
- `requireBuilderContract: true`
- `requireValidatorContract: true`
- `requireEvidenceForPass: true`
- `requireUserApprovalForDestructiveActions: true`
- `requireUserApprovalForPublishDeployOrForcePush: true`

Budgets can be overridden per project in `.rstack/rstack.config.json`:

```json
{
  "guardrails": { "maxTaskAttempts": 3 }
}
```

Invalid override values (negative numbers, non-numeric strings, unknown keys) are ignored and the defaults apply.

### Enforcement

Attempt budgets are enforced at the task claim gate, not just described in prompts. When `sdlc_build_next` selects a task whose recorded `task_started` events already meet the budget (`maxDestructiveTaskAttempts` for tasks marked `destructive: true` or `risk_level: "destructive"`), the task is hard-blocked — stamped `BLOCKED` in `tasks.json` instead of `IN_PROGRESS` — and on that transition:

- a `guardrail_triggered` event is appended to `events.jsonl` with `limit_name`, `current_value`, and `limit_value`,
- a pending `guardrail-override:<task_id>` approval request is queued for the Business Hub,
- configured notification channels are paged.

Repeated claims while the task is already `BLOCKED` return the same guidance without appending duplicate events or re-paging. `BLOCKED` tasks remain claim candidates so an approved override can resume them; the gate re-evaluates on every claim.

Approving the `guardrail-override:<task_id>` artifact (via `sdlc_approve` or the dashboard) permits **exactly one** more attempt: the harness stamps the override `CONSUMED` as soon as the claim succeeds and appends a `guardrail_overridden` audit event, so the next over-budget claim blocks again.

Tool-call and message budgets are checked at validation time from builder contract telemetry (`execution.tool_calls`, `execution.messages`). Overages fail validation with a `guardrail_<rule>` check and emit `guardrail_triggered` events.

The extension also includes the guardrail summary in generated builder prompts so agents see the budgets they are held to.

### Retry policy

Post-validation task transitions are decided by `src/core/harness/retry-policy.js` (#123), not by prompts or inline attempt math. `classifyRetryDecision({ task, validation, events, guardrails })` is a pure function driven by the validator contract's `retry_recommendation`, bounded by the same attempt budgets as the claim gate (`maxTaskAttempts`, or `maxDestructiveTaskAttempts` for destructive tasks; attempts = recorded `task_started` events):

| `retry_recommendation` | Condition | `action` | `next_status` |
|---|---|---|---|
| `none` | validation PASS | `complete` | `PASS` |
| `retry_builder` | attempts < budget | `retry` | `FAIL` (re-claimable by `sdlc_build_next`) |
| `retry_builder` | attempts >= budget | `exhausted` | `BLOCKED` (needs `guardrail-override:<task_id>` approval) |
| `ask_user` | — | `human_context` | `NEEDS_CONTEXT` |
| `block` | — | `block` | `BLOCKED` |
| missing / unknown | conservative fallback | FAIL behaves as `retry_builder`, PASS as `none` | per row above |

The function never throws on malformed input, and returns `{ action, next_status, attempt, max_attempts, reason, issues }` where `reason` is an operator-readable sentence and `issues` is a compact string array (validator issues mapped to `name: evidence`, ~120 chars each, max 5).

On every FAIL validation `sdlc_validate` stamps `task.status = next_status` inside the locked write and appends a `retry_decision` event (task_id, stage_id, attempt, max_attempts, retry_recommendation, action, next_status, reason, issues — a pinned contract for downstream consumers), plus one action-specific event: `task_retry_scheduled` (with the legacy `validation_failed` kept for dashboards), `task_retry_exhausted` (with the legacy `guardrail_triggered` kept for the claim gate and dashboards), `task_human_context_required`, or `task_blocked_by_validator`.

### Validator sandbox

Validators check work — they never modify it. `src/core/harness/validator-sandbox.js` enforces this in code, not just prompts (#119):

- **Context signal**: when `sdlc_delegate` spawns a validator/reviewer/security-role agent (name or id matching `validator|review|qa|security|audit|tester`), it sets `RSTACK_VALIDATOR_CONTEXT=1` (plus `RSTACK_VALIDATOR_RUN_ID` for event routing) on the child Pi subprocess and scrubs both vars from builder-role children. The extension's `tool_call` hook reads the flag inside the child.
- **Denied action classes**: write/edit-style tools; destructive shell commands (`rm`, `mv`, `chmod`, in-place `sed`, `tee`, ...); git mutations (`push`, `commit`, `reset`, `checkout`, ...); publish/deploy/force-push commands (`npm publish`, `terraform apply`, `kubectl delete`, `gh pr merge`, ...); destructive SQL; and shell redirects into protected secret paths (`.env`, key files, credentials).
- **Read-only default tools**: validator-role delegations default to `read, grep, find, ls, bash` when the caller passes no explicit `tools` — bash stays available so validators can run tests, with mutating commands denied at command level.
- **Events**: each blocked mutation appends a `validator_sandbox_denied` event (tool name + reason) to `events.jsonl`. Allowed reads are not logged unless `RSTACK_VALIDATOR_SANDBOX_DEBUG=1` opts in (`validator_sandbox_allowed_read`), so events.jsonl never floods.
- **No escape hatch**: the sandbox is checked before the builder-oriented gates and is not bypassable via `RSTACK_ALLOW_DESTRUCTIVE` or destructive-action approvals. Builder contexts (env var unset) are completely unaffected. Human-approved exceptions are out of scope by design.

### Retry visibility

Every retry decision is observable without reading source (#125):

- **Events**: `sdlc_validate` appends `retry_decision` plus the action-specific event — `task_retry_scheduled`, `task_retry_exhausted`, `task_human_context_required`, or `task_blocked_by_validator` — each carrying `task_id`, `stage_id`, `attempt`, `max_attempts`, `retry_recommendation`, an operator-readable `reason`, and compact `issues[]`.
- **Trace**: `sdlc_trace` renders retry lines with attempt counters, e.g. `↻ retry scheduled 1/2 — 004-implementation: validator found missing evidence` and `⛔ retries exhausted (2/2) — blocked pending guardrail-override`.
- **Pipeline state**: the rollup's `retries` summary carries `{ total, scheduled, exhausted, human_required }`, and each failed stage carries `retry_state: "retryable" | "exhausted"` so `rstack-agents pipeline status` can distinguish "re-run the builder" from "approve the override".
- **Feed**: the Business Hub live feed renders the four `task_retry_*` events with distinct levels (warn / fail / blocked).

### Resume-aware runner

`rstack-agents pipeline run` advances a run from its current harness state without invoking any model (#124): completed tasks are skipped, an active task with a builder contract is validated (which drives the retry policy), retryable failures are re-claimed through `sdlc_build_next`, and the loop stops the moment a human is needed — pending approval, `ask_user`, an exhausted retry budget awaiting a `guardrail-override`, a prepared builder packet awaiting agent execution, or `--max-steps`. `--dry-run` prints the exact next action and persists nothing (not even the rollup); `--json` emits the structured step report. Human-gate stops exit non-zero so CI can tell "needs a human" from "complete".

### Goal loop (bounded)

BLE-4 (#127/#129) adds the goal-conditioned loop: "keep working until a structured success
condition passes" — bounded, budget-capped, and model-free.

**Goal contract.** A goal definition (per-run `goal.json`, or a recipe file passed via
`pipeline loop --goal <path>`; see `docs/loop-recipes.md`) declares `goal_id`, `min_score`
(0–100, default 100), and `criteria[]`. Criterion kinds, all evaluated by
`src/core/harness/goal-check.js`:

- `file_exists` — path relative to the project root (`run_relative: true` for the run dir).
- `command` — runs in the project root; passes when the exit code matches `expect_exit_code`
  (default 0). Bounded by `timeout_ms` (default 120s, cap 600s). Must be a read-only check —
  the evaluator runs it in `--dry-run` too.
- `metric_threshold` — numeric dot-path (`metric`) compared (`operator`: `>= > <= < == !=`)
  against `value`, read from `source`: `"feedback"` (the agent-11 artifact), `"pipeline_state"`
  (the in-memory rollup), or `{"file": "relative/to/run"}`. A missing feedback artifact is a
  clear non-pass that recommends rerunning `11-feedback-loop` — never a silent skip.
- `judge` — **the harness never calls a model.** Judge criteria close through the verdict
  protocol: `<run_dir>/goal-verdict.json`, written by a host framework or a human (or the
  evidence-gated agent-11 `goal_evaluation` path described below):
  `{ "criterion_id", "verdict": "PASS"|"FAIL", "judge", "reasoning", "iteration",
  "recommendation": "retry"|"block", "recommended_rerun_stages": [] }` (single object, array, or
  `{"verdicts": []}`). The harness validates and consumes it; without a fresh verdict the
  evaluation stops at `ASK_USER`. Freshness: inside a loop iteration a verdict must carry
  `iteration >= current` — an older or **missing** iteration stamp is stale, so a write-once
  verdict can never auto-pass later re-evaluations (one-shot evaluations outside the loop accept
  unstamped verdicts). A FAIL verdict retries the named stages; `"recommendation": "block"` stops
  for a human.

Any criterion may carry `rerun_stages` — the canonical stages a RETRY should reset.

**Agent-11 writer path (#128).** Stage 11 (`11-feedback-loop`) is a legitimate writer of the same
verdict protocol — not a second one. Its feedback.json may embed a structured `goal_evaluation`
section (`goal_id`, `iteration`, `status`, `consistency_score`, `critical_count`,
`failing_stages`, `recommended_rerun_stages`, `requires_human_decision`, `reason`, and
per-criterion `criteria[]`: `{ criterion_id, result: "met"|"not_met"|"unknown", evidence[],
reasoning, recommended_rerun_stages, maintenance_category, recommendation }`). The evaluator
converts each per-criterion result into a judge verdict **only when every listed evidence path
resolves to a real file inside the run dir or the project root** (relative paths resolve against
the run dir, then the project root; `..` traversal, `.`, directories, and absolute paths outside
those roots are rejected) — an `unknown` result or an unevidenced claim is rejected with a
recorded reason and the criterion stays at the `ASK_USER` path. Be honest about what this gate
buys: it checks evidence **existence**, not **relevance** — whether the named artifact actually
proves the claim remains the validator's and the human's job. The same freshness rules apply: inside a loop iteration an
evaluation stamped with an older or missing `iteration` is stale and ignored — and because this
writer is model-driven (unlike the trusted `goal-verdict.json` writer), a stamp **ahead of** the
current iteration is rejected as malformed rather than staying fresh forever. An explicit
`goal-verdict.json` entry outranks the agent-11 evaluation for the same criterion — including the
id-less single-judge shorthand — so a human or host verdict always wins.
`recommended_rerun_stages` on a `not_met` criterion feed stage resets, routed through the agent's
maintenance taxonomy (corrective defects → the fixing stage, preventive gaps → docs, and so on).
Reset semantics differ by writer: an explicit `goal-verdict.json` **replaces** the criterion's
`rerun_stages` (the human names exactly what to reset), while an agent-11 verdict **unions** with
them — the agent can add stages but can never drop the recipe's wiring (e.g. `11-feedback-loop`
kept in `rerun_stages` so each iteration re-runs the reviewer and refreshes the stamp). The top-level `goal_evaluation` fields are the agent's
recommendation for hosts and dashboards; the evaluator recomputes its own decision from raw
evidence and never copies them. Section shape is checked by `validateGoalEvaluation` (same
`{ok, checks, issues}` contract style as builder/validator checks), consumption/rejection is
surfaced on the evaluation as `agent_goal_evaluation: { present, consumed, rejected, issues }`,
and the harness still never calls a model — agent 11 recommends with evidence; `goal-check.js`
decides.

**Stage-11 validation gate (#196).** The same shape check is enforced at validation time, not just
at loop time: `validateStageGoalEvaluation` (goal-check.js) runs inside `sdlc_validate` — which the
model-free `pipeline run`/`pipeline loop` bridge also drives. When a goal is active for the run — a
`goal.json` in the run dir, or pinned loop events (`loop_iteration_started`/`goal_evaluated`)
proving a `pipeline loop --goal <recipe>` context — a task targeting `11-feedback-loop` FAILs
validation when feedback.json is missing or its `goal_evaluation` section is malformed, with the
named checks recorded in validation.json instead of a silent ASK_USER later. Runs with no active
goal keep the section optional (a single informational `goal_evaluation_not_required` PASS), and
tasks that never target stage 11 see no goal checks at all.

**Evaluator.** `evaluateGoal(projectRoot, runId, options)` builds the rollup in memory (persists
nothing), reads only structured JSON (never prose), always layers harness checks over the criteria
(pending approvals, pending decisions, NEEDS_CONTEXT tasks, guardrail-BLOCKED tasks, unfinished
tasks, critical feedback issues), and returns `{ status: PASS | RETRY | ASK_USER | BLOCK, score,
min_score, critical_count, failing_stages, recommended_rerun_stages, reason, criteria,
harness_checks }`. Precedence is deterministic: humans first (`ASK_USER` — approvals, decisions,
context, missing judge verdicts), then blocking issues (`BLOCK` — blocked tasks, unremediable
criticals, judge blocks), then retryable work (`RETRY`), then `PASS` (everything green and
`score >= min_score`). Critical feedback issues whose `remediation.agent_to_rerun` maps to a
canonical stage become RETRY targets; criticals with no remediation path are BLOCK.
`summarizeGoalDecision(evaluation)` renders the one-line operator view.

**Loop runner.** `rstack-agents pipeline loop` runs: one resume-aware pipeline pass (the same
model-free engine as `pipeline run`) → goal evaluation → decision. On RETRY it resets **only** the
recommended stages' tasks to PENDING (in-lock, atomic, original file shape preserved; IN_PROGRESS,
NEEDS_CONTEXT, and BLOCKED tasks are never reset, and attempt budgets still count historical
`task_started` events, so a reset can never launder attempts past the claim gate) and goes again.
Three independent brakes, enforced in `src/core/harness/goal-loop.js`, not in prompts:

1. **Iteration bound** — default 3 (`--max-iterations` or `.rstack/rstack.config.json`
   `loop.maxIterations`), hard cap 20 that no config or flag can exceed.
2. **No-progress stop** — an iteration that leaves task statuses and the goal evaluation
   identical (or a RETRY naming no stages) stops as `no_progress` instead of repeating itself.
3. **Budget cap** — `.rstack/budget.json` `run_budget_usd` against the run's
   `cumulative_cost_usd`, checked before every iteration.

Human gates from the pipeline pass (`pending_approval`, `ask_user`, `blocked_retry_policy`,
`missing_contract`) propagate and stop the loop. `--dry-run` reports iteration 1's evaluation and
decision and persists nothing — no events, no resets, not even the rollup. Only `complete` and
`dry_run` exit zero, so CI can tell "goal met" from everything else.

**Events (pinned contract, one per loop decision):** `loop_iteration_started` and `goal_evaluated`
each iteration (the latter carrying `status`, `score`, `critical_count`, `failing_stages`,
`recommended_rerun_stages`, `reason`), `loop_iteration_retrying_stages` (`stages`, `task_ids`) on
every reset, and exactly one terminal `loop_completed` (goal met) or `loop_blocked` (`stopped_on`:
`ask_user | blocked | max_iterations | no_progress | budget_exhausted` or a propagated human gate).
All appended to `events.jsonl` under the same file lock as the evidence ledger, and rendered by the
Business Hub feed.

### Critical-stage checkpoints (#132, BLE-5.2)

Loop retries mutate stage artifacts, so the stages where a bad rewrite is expensive get restore
points enforced by `src/core/harness/checkpoints.js` — in code, never prompt text. The critical set
defaults to `06-architecture`, `07-code`, `08-testing`, `09-deployment`,
`12-security-threat-model` and is configurable via `.rstack/rstack.config.json`
`checkpoints.critical_stages` (canonical stage ids only — plan task ids like `007-code` are
rejected, the exact conflation that silently broke checkpoints before; entries are validated
field-by-field on load like every other config, and an explicitly empty list disables
critical-stage checkpoints).

**Lifecycle.** When `sdlc_build_next` claims a task targeting a critical stage, the harness saves a
checkpoint of `artifacts/stages/<stage-id>/` to `checkpoints/<stage-id>/` **before** the builder
mutates anything — this is the state a failed retry rolls back to. After `sdlc_validate` passes,
the slot is overwritten with the validated artifacts. One slot per stage, last save wins;
save/restore of the same stage serialize on a per-stage lock (same `withFileLock` discipline as
tasks.json).

**No best-effort claims.** Restorability is always verified against the checkpoint directory on
disk (`verifyStageCheckpoint`), never inferred from events or memory: checkpoint events are only
emitted after the directory is verified to exist, the per-stage `checkpoint_restorable` flag in
`pipeline-state.json` is re-checked at rollup time, and `sdlc_rollback` returns a pinned status —
`SUCCESS` (restored), `NO_CHECKPOINT` (nothing on disk, nothing modified), `INVALID_STAGE`
(non-canonical stage id, rejected before touching disk), or `CORRUPT` (a checkpoint exists but
fails its integrity manifest — a deep sha-256 content check — so nothing is restored and the live
stage is left untouched). Note the `pipeline-state.json` `checkpoint_restorable` rollup flag is a
lighter (size-only) check for status display; `sdlc_rollback` always runs the full deep-hash
verification before restoring, so a same-size-tampered slot can read restorable in `status` yet
correctly return `CORRUPT` on an actual rollback — the action fails closed.

**Events (pinned contract):** `stage_checkpoint_before_saved` (`stage_id`, `task_id`, `verified`)
at claim, `stage_checkpoint_after_saved` (same fields) after a PASS validation, and
`stage_checkpoint_reverted` (`stage_id`) on a successful rollback. Unknown types throw
(`checkpointEvent`), same discipline as `LOOP_EVENT_TYPES` and `retry_decision`. The legacy
`stage_checkpoint_saved` event still fires for every canonical stage a PASS task produced
(existing consumers key on it); the three pinned events are the critical-stage contract and the
only ones the `checkpoints` rollup in `pipeline-state.json` (and `rstack-agents pipeline status`)
counts.

## Validation commands

Run these after Harness changes:

```bash
cd /Users/richardsongunde/projects/SDLC-rstack
npm test
npm run validate
```

Also run lint for code-level checks:

```bash
npm run lint
```

## Safety notes

The Harness foundation does not add auth, payment processing, PII storage, public APIs, deploy automation, or npm publishing. Publishing, deployment, force-push, and destructive cleanup still require explicit user approval.
