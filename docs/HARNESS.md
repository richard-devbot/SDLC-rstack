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
