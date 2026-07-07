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

## Environment intake (#237)

Stage 00 runs an interactive intake instead of guessing project context. Detection is `rstack-agents env scan [--json]` — a read-only wrap of the adopt scanner that adds:

- `proposed_run_mode`: `greenfield` | `brownfield` | `feature`, with `run_mode_evidence[]` naming the exact markers (adoption markers in the latest run → brownfield; an adoption run alongside later runs → feature; git history + manifests with no `.rstack` runs → brownfield; else greenfield).
- `setup_needs[]`: `{ kind, platform, required_vars[], satisfied }` derived from `.rstack/integrations.json` platform choices vs env-var presence (names only — values are never read into any report).

**environment_report.json v2 (additive)** — the report may carry `run_mode`, `run_mode_evidence[]`, `user_preferences` (string map, e.g. `ticketing_platform`), and `setup_needs[]`. `src/core/harness/environment-report.js` validates the shape: legacy fields warn-only (pre-#237 reports never start failing), intake fields strictly typed when present, credential-shaped `user_preferences` keys rejected. `sdlc_validate` runs it best-effort for stage-00 tasks as the `environment_report_shape` check — PASS or WARN by construction, never a verdict flip, and a throw can never fail validation (context-pressure precedent).

**`.rstack/integrations.json`** — endpoints and identifiers ONLY (registered in the config-validation registry): `ticketing {provider: jira|github|azure_devops|linear|file-based, base_url?, project_key?}`, `docs {provider?: confluence|none, space_key?}`, `notifications {channel?: slack|teams|discord|none}`. Any key shaped like a credential (token/secret/password/api key) is a validation error — secrets live in `.env`. `init` writes a self-documenting template when the file is missing (`_comment` keys are ignored by the validator).

**Decision-driven setup** — stage 00 confirms the run mode via ONE Decision Queue item (required before `01-transcript`), and each unsatisfied setup_need becomes a decision gated on the stage that consumes it (ticketing → `05-jira`, deployment → `09-deployment`, notifications → `10-summary`), so the DOR gate blocks exactly the work that needs the answer and nothing earlier. NEEDS_CONTEXT stays reserved for true blockers.

## Evidence ledger

Raw runtime events are appended to `events.jsonl`. Validator-grounded task evidence is appended to `evidence.jsonl` with:

```json
{"task_id":"004-implementation","kind":"validation","status":"PASS","evidence":"tasks/004-implementation/validation.json"}
```

`src/core/harness/evidence.js` rejects missing `task_id`, `kind`, `status`, or `evidence` fields.

## Run metrics (metrics.json)

`<run_dir>/metrics.json` is the persisted cost/duration/token rollup for a run (#83, #135). It is written by `updateRunMetrics` (`src/core/harness/run-state.js`) under a file lock with atomic tmp+rename, so concurrent writers both land. Full schema:

```json
{
  "cumulative_duration_ms": 0,
  "cumulative_cost_usd": 0,
  "cumulative_tool_calls": 0,
  "cumulative_tokens": { "input": 0, "output": 0, "total": 0 },
  "stage_elapsed_ms": { "07-code": 900 },
  "stage_status": { "07-code": "PASS" },
  "stage_cost_usd": { "07-code": 0.42 },
  "stage_tokens": { "07-code": { "input": 12000, "output": 3000, "total": 15000 } },
  "context_tokens_used": null,
  "context_tokens_available": null,
  "applied_telemetry_keys": ["<sha256 of the builder contract that was counted>"]
}
```

All fields are additive-tolerant — readers default anything missing, so legacy files need no migration and the file carries no `schema_version`. `cumulative_tokens` doubles as the marker that the run was written by the incremental telemetry path: readers (`resolveRunTotals` in `src/observability/metrics/derive.js`, the reporter's cost summary) treat persisted totals as authoritative when the object is present and recompute from `cost_recorded` events otherwise, so legacy runs still render. Unrelated metrics updates never materialize the marker on legacy files.

Write semantics:

- Top-level `cumulative_*` values and the stage maps passed directly to `updateRunMetrics` **overwrite/merge-per-key** (pre-#83 behavior, unchanged).
- An `increment` block **adds** deltas atomically in-lock: `cost_usd`, `tool_calls`, `tokens {input, output, total}`, and per-stage `stage_cost_usd` / `stage_tokens` maps. This is how `cost_recorded` telemetry updates totals incrementally instead of being re-derived O(events) per dashboard poll.
- `context_tokens_used` / `context_tokens_available` are point-in-time gauges (the context-pressure hook for BLE-6.2), so they overwrite.

Idempotency (double-count guard): an `increment` may carry an `idempotency_key` (a SHA-256 of the canonical builder-contract content, from `builderContractKey`). The whole increment is applied **at most once** per key — consumed keys are recorded in `applied_telemetry_keys` and checked/appended inside the same lock as the totals. This is what stops one real builder execution being persisted 2–3× through the automated retry path (#123) and the goal loop's stage resets (#129): re-validating the *same* `builder.json` (identical content → identical key) is a no-op, while a genuine retry that actually re-runs the builder writes a *new* contract (different content → new key) and correctly counts again. The guard is content-based, not timestamp-based, precisely so a real re-run is never mistaken for a replay; two attempts with byte-identical contracts represent the same spend and are collapsed on purpose. Belt-and-braces, the stale `builder.json` is also removed at re-claim (`sdlc_build_next`) and at goal-loop reset (`resetStagesForRetry`), so a reset stage cannot replay the prior attempt's contract at all — it must produce a fresh one to be validated.

Mid-run upgrade seeding: the first increment to materialize the `cumulative_tokens` marker on a run that already has pre-upgrade `cost_recorded` history seeds the persisted totals from an event recompute (passed as `seed` to `updateRunMetrics`, applied once and only when the marker is being created). Without this, an in-flight run upgrading to the persisted-metrics format mid-run would drop all prior history (e.g. `$5.00` of legacy events + one `$0.10` new validation would report `$0.10`).

`cumulative_tool_calls`: fed by `increment.tool_calls`, sourced from the builder contract's `execution.tool_calls` (total tool **invocations** in the attempt — the guardrail-budget signal). This is distinct from `tools_used_count` (`execution.tools_used.length`, the count of distinct tool **names**); a contract with no `execution.tool_calls` contributes nothing to the counter.

Telemetry source: at validate time `sdlc_validate` extracts the builder contract's structured `cost` / `context` / `execution` fields via `extractBuilderTelemetry` (`src/core/harness/telemetry.js`), on **every** validation — retries cost money too, and the idempotency key (above) is what prevents re-validation of the same contract from double-counting. Non-numeric cost values are ignored by extraction; the contract gate's `builder_v2_cost_values_are_numeric` check is what fails validation on them. Cost and tokens are split evenly across the task's canonical stages (the same normalization as stage elapsed), so multi-stage tasks are never double-counted.

Events (pinned contract, same rules as `retry_decision` — downstream consumers key on these exact shapes):

- `cost_recorded` — `task_id`, `usd` (effective spend: `actual_usd` wins over `estimated_usd`; `cost` kept as a legacy alias), `estimated_usd`, `actual_usd`, `currency`, `tokens`, `input_tokens`, `output_tokens`, `source: "builder_contract"`.
- `context_recorded` — `task_id`, `profile`, `workflow`, `injected_sources` (count), `tokens_used`, `tokens_available`, `source: "builder_contract"`.
- `metrics_write_failed` — `task_id`, `operation` (e.g. `"telemetry_increment"`), `error`. Emitted when a `cost_recorded` event landed but its matching persisted increment failed to write. It marks the persisted totals as behind the events; `resolveRunTotals` detects the event (via `hasMetricsWriteDrift`) and falls back to event recompute rather than reporting a total it knows is stale.

Rollups: the pipeline-state `cost_context` block carries `cumulative_tokens` alongside the existing cost/duration/tool-call totals, and each stage entry carries its `cost_usd` / `tokens` share (`null` when never recorded). `rstack-agents pipeline status` prints the token total; `--json` exposes the full structure.

### Context pressure warnings (#136, BLE-6.2)

`src/core/harness/context-pressure.js` classifies oversized context into **non-blocking** `context_pressure_warning` events. It builds on the #83/#135 telemetry: at validate time `sdlc_validate` measures the builder contract's `memory_summary` / `stage_summaries[]` sizes and its reported `context.tokens_used` / `context.tokens_available` gauges against configurable thresholds. Sizes are approximate character/token signals already in the harness — **no model tokenization dependency** (the issue's explicit constraint). `classifyContextPressure` is pure; the classifier and validators do no I/O (the sole impure export, `loadProjectContextPressureThresholds`, reads `.rstack/rstack.config.json`, mirroring `loadProjectGuardrails`).

Thresholds live under `context_pressure` in `rstack.config.json` (optionally nested under `thresholds`) and are validated field-by-field on load (`validateContextPressureConfig`, wired through `validateProjectConfigs` — #151 pattern), so a bad threshold produces a named warning and the default applies rather than silently disabling a check. Defaults: `builder_prompt_chars` 120000, `injected_memory_chars` 24000, `artifact_summary_chars` 12000, `stage_summary_chars` 8000, `context_tokens_used` 160000, `context_tokens_ratio` 0.85.

**Emit-vs-detect (transparency, #136 rule):** this path is **detect-only** — it warns, it does not prune memory or truncate artifacts. It therefore emits **only** `context_pressure_warning` and **never** `memory_pruned` or `artifact_summary_truncated`, which would name actions this code does not take. (`memory_pruned` is emitted separately by the memory-injection path when it actually prunes; this module does not.)

Event (pinned contract, same rules as `retry_decision`):

- `context_pressure_warning` — `task_id`, `source` (`builder_prompt` | `injected_memory` | `memory_summary` | `stage_summary` | `artifact_summary` | `context_tokens`), `metric` (`chars` | `tokens` | `ratio`), `size` (the measured value), `threshold` (the breached limit), `blocking: false`. Optional `stage_id` (stage-summary source), `artifact` (artifact-summary source), and `tokens_used` / `tokens_available` (ratio metric). Under-threshold context produces **no** event (silence, never a zero-size event).

Rollup: the pipeline-state `context_pressure` block carries `{ total, by_source, warnings[] }`; `summarizePipelineState` exposes the count; `rstack-agents pipeline status` prints a `Context pressure warnings:` line (with the per-source breakdown) only when warnings are present.

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

### Write policy (enforced in code, #137)

Memory is only useful if it is trustworthy and bounded, so the trust level of every episode is decided by `appendEpisode` in `src/memory/index.js` (via `evaluateWritePolicy`) — never by trusting the caller's `trusted` flag and never by prompt text. A caller cannot launder a failed or unsafe episode into trusted memory: `appendEpisode` overwrites `trusted` with the policy decision before writing.

Two policies (`writePolicy` in `memory-config.json`, default `validator-approved-only`):

- **`validator-approved-only`** — only `validator_status: "PASS"` episodes are stored, and only as `trusted: true`. A non-PASS episode is **skipped** (nothing is persisted, so it can never be recalled and cannot resurrect the behavior it records).
- **`validation-attempts`** — non-PASS episodes **are** stored, but always `trusted: false`. They surface only when a recall explicitly opts into untrusted memory (`recallEpisodes(..., { includeUntrusted: true })`); default recalls skip them.

Before an episode may be trusted, three integrity checks must also hold (a PASS that fails any of them is demoted to `trusted: false` under `validation-attempts`, or skipped under `validator-approved-only`):

1. **signature** — `verifyEpisodeSignature` matches (tampered records are never trusted; `readEpisodes` also drops them on read),
2. **evidence_paths** — a non-empty array of non-blank strings,
3. **quality_score** — a finite value in `[0, 1]`.

`appendEpisode` returns `{ path, written, trusted, decision }` so the call site can emit the matching ledger event. Retracted episodes (`retractEpisode`) are filtered by `readEpisodes`/`recallEpisodes` and are never served.

**Events (pinned contract — `sdlc_validate` appends one per write decision to `events.jsonl`):**

- `episode_memory_written` — `task_id`, `episode_id`, `trusted`, `write_policy`. The episode was stored at the stated trust level.
- `episode_memory_skipped_untrusted` — `task_id`, `episode_id`, `reason` (e.g. `not-validator-approved`, `integrity-failed:signature`), `write_policy`. The write policy refused to store the episode; nothing was persisted.
- `episode_memory_write_failed` — `task_id`, `error`. An unexpected error (I/O, schema-invalid episode) prevented the write.

Memory is **historical context only**: it is injected into builder prompts as bounded, non-authoritative observations and cannot override the current task, user approvals, tool safety, or validator gates. The injected block says so explicitly (`formatEpisodesForPrompt`), and trusted recall cannot reach a failed or unsafe episode unless the run is explicitly configured to store validation attempts as untrusted memory and the recall explicitly asks for untrusted memory.

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
tasks that never target stage 11 see no goal checks at all. Goal-activity is **permanent** — any
historical `loop_iteration_started`/`goal_evaluated` event marks the run goal-driven for the rest
of its life, so a later unrelated stage-11 revalidation still demands `goal_evaluation`
(conservative by design). And it is **fail-closed on unreadable state (#200)**: if `events.jsonl`
exists but yields zero parseable events, or can't be read at all, the gate returns a
`goal_activity_indeterminate` FAIL rather than assuming "no goal" — a corrupt event log at stage 11
stops for human eyes instead of silently passing.

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

## Parallel-execution benchmark (#159)

Builder/validator round-trips dominate wall clock. Some stages are
*data-independent* — none reads another's output artifact — so they can run in
a parallel group. Parallel groups are enabled **from evidence, not vibes**: a
benchmark measures sequential vs parallel wall clock, and the config gate only
flips them on when the measured improvement clears a target (default **≥ 40%**).

**Decision logic** lives in `src/core/harness/parallel-benchmark.js` (pure, no
clock reads — timings are inputs, so the gate is deterministic and tested):

- `checkDataIndependence(members)` — a group is parallel-safe only if every
  member is a canonical stage id, ids are unique, no member reads an artifact
  produced by another member, and the group is within `PARALLEL_GROUP_HARD_CAP`
  (6). An oversized group is **rejected, not silently truncated**.
- `aggregateSequentialTime` / `aggregateParallelTime` — sequential = sum of
  durations; parallel = the slowest member per group (groups run in series),
  plus any solo stages.
- `evaluateParallelGate({ seqTimeMs, parTimeMs, target })` — improvement =
  `(seq − par) / seq`; `enable` is true iff `improvement ≥ target` (inclusive).
- `buildBenchmarkArtifact(...)` — the run-artifact shape.

**Runner:** `node scripts/bench-parallel.mjs [--target 0.4] [--out <path>]
[--run-id <id>] [--timings '{"12-...":900}']`. By default it benchmarks the
data-independent group **12 (security) / 13 (compliance) / 14 (cost)** — each
reads upstream artifacts (requirements, architecture, code) and writes its own
distinct output, so none reads another's artifact.

**Honesty — mock vs real:** the runner defaults to `mode: "mock"`. It does
**not** launch live builder/validator agents; it runs a synthetic sleep
workload per stage (durations modelling round-trip wall clock) timed with the
real clock, and gates on the modelled sum-vs-slowest numbers so CI is not flaky
on scheduler jitter. The artifact is stamped `"mode": "mock"` with a
`measurement` note. Feed real per-stage durations via `--timings` to gate
against measured numbers; live-agent capture (`mode: "real"`) is future work.

**Artifact → Business Hub:** the result is written to
`.rstack/runs/<run_id>/artifacts/parallel-benchmark.json`. The dashboard run
indexer (`state/runs.js → indexArtifacts`) picks up any top-level file under a
run's `artifacts/` as a run-scoped deliverable, so the data reaches the Hub
artifact index with no extra wiring. A dedicated Hub panel is a later,
presentational step — the data flows now.

**Config gate** (`.rstack/rstack.config.json`, validated on load by
`config-validation.js`):

```json
"parallel_groups": {
  "enabled": false,
  "target": 0.40,
  "require_benchmark": true,
  "groups": [["12-security-threat-model", "13-compliance-checker", "14-cost-estimation"]]
}
```

`enabled` should only be set `true` once a benchmark artifact shows the group
clears `target`. Config validation flags non-data-independent groups, an
out-of-range `target`, unknown keys, and `enabled: true` with no groups.
`require_benchmark` is **declared intent, not yet enforced** — its type is
validated, but nothing today blocks `enabled: true` without a benchmark artifact
because the runner is still sequential (the gate is a recommendation). Enforcing
it belongs with the parallel-execution wiring (#208).

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

## Destructive-action classification (#131, BLE-5.1)

`src/core/harness/destructive-actions.js` is the centralized, I/O-free source of truth for
what makes a command or write destructive. It replaces scattered, context-private checks with
one classifier both builder-side and validator-context callers can consume.

`classifyDestructiveAction(command | { command } | { toolName, input } | string)` returns a
stable frozen verdict `{ destructive, category, reason, matched }`. Categories
(`DESTRUCTIVE_CATEGORIES`):

- `broad-delete` — recursive/forced `rm`, `rmdir`, `shred`, `mkfs`, `dd of=`, `find -delete`
  (a single-target `rm file.txt` is NOT flagged — recursion/force is what escalates)
- `git-force` — `git push --force`/`-f`/`--force-with-lease`/`+ref`, `git reset --hard`
- `publish` — `npm/yarn/pnpm publish`, `npm unpublish`, `cargo publish`, `gem push`,
  `twine upload`, `gh release create/delete`
- `deploy` — `terraform apply/destroy`, `pulumi up/destroy`, `kubectl apply/delete/...`,
  `helm ...`, `docker push`, CloudFormation stack ops, `firebase/vercel/netlify/fly/serverless
  deploy`, `ansible-playbook`
- `secret-write` — shell redirect/`tee` into `.env`/keys/credentials; write-tool targets on
  secret/credential/key paths
- `protected-config-write` — write-tool targets on `.git`, CI workflows, Dockerfiles,
  lockfiles, `.tf`/`.tfvars`, `.rstack`
- `db-destroy` — `DROP TABLE/DATABASE/SCHEMA`, `DELETE FROM`, `TRUNCATE`

Destructive actions are **gateable, not denied outright**: they require an explicit approval
artifact. `requireApprovalForDestructiveAction({ action, taskId, approvedArtifacts })` (pure) and
`guardrails.evaluateDestructiveAction({ action, taskId, approvals, expectedRunId })` (wired to the
audited approval path, #133) resolve a per-task `destructive-action:<taskId>` artifact through the
same `trustedApprovedArtifacts` audit used by the required-approval and guardrail-override gates —
one audit, no drift; a foreign-run or malformed record cannot unblock. `guardrails.isDestructiveTaskOrAction(task, action)`
combines the declared task flag with content classification.

This is distinct from and does not replace the validator sandbox (`validator-sandbox.js`, #119),
which stays the stricter authority for validator/reviewer/security contexts (any mutation denied,
no approval path). Refactoring the sandbox to consume this classifier is a deliberate follow-up —
the two encode different policies (gate-with-approval vs deny-outright).
