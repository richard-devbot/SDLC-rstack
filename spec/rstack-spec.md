# RStack Spec v1alpha1

<!-- owner: RStack developed by Richardson Gunde -->

**Version:** `rstack.dev/v1alpha1` (alpha — field additions are expected; removals or
renames require a version bump)

This document is the normative specification for the files RStack writes and the
lifecycle semantics RStack enforces. It is **derived from the shipped code, not from
intent**: every schema, enum, and gate below is backed by a runtime producer or
validator in this repository, and the source module is named next to each section.
If this document and the code ever disagree, the code is the bug or this document is
— file an issue; never "interpret" the spec loosely.

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** are to
be interpreted as described in RFC 2119.

Machine-readable schemas live in [`spec/schemas/`](schemas/) (JSON Schema draft-07).
A complete validating example run lives in
[`examples/spec/business-flex-run/`](../examples/spec/business-flex-run/). Validate
any project with:

```bash
npx rstack-agents validate --schemas [--project <path>]
```

---

## 1. Two kinds of schema: resources vs raw files

The spec ships two projections, and conformance tools MUST NOT confuse them:

- **Raw on-disk file schemas** describe exactly what RStack writes today:
  `builder-contract.schema.json`, `validator-contract.schema.json`,
  `approval.schema.json`, `evidence.schema.json`, and
  `rstack-attestation.schema.json` (the attestation defines its **own** envelope via
  its `schema` field, so it is exempt from the resource envelope below). The
  `definitions` blocks inside `rstack-run.schema.json` (manifest),
  `rstack-task.schema.json` (tasks.json), `rstack-decision.schema.json`
  (decisions.json), `rstack-gate.schema.json` (policy.json), and
  `rstack-project.schema.json` (rstack.config.json) are also raw-file schemas.
- **Resource envelope schemas** (`rstack-run`, `rstack-task`, `rstack-decision`,
  `rstack-gate`, `rstack-profile`, `rstack-project`, `rstack-agent-role`,
  `rstack-adapter`) are Kubernetes-style **projections** of that state for tools that
  exchange RStack resources:

  ```json
  {
    "apiVersion": "rstack.dev/v1alpha1",
    "kind": "Run",
    "metadata": { "name": "<run_id>" },
    "spec": { ... },
    "status": { ... }
  }
  ```

  A resource MUST carry `apiVersion: "rstack.dev/v1alpha1"`, its exact `kind`,
  `metadata.name`, and `spec`. `status` is OPTIONAL. RStack itself stores raw files;
  it does not (today) persist envelope resources — the envelope is the interchange
  format for conformant tooling.

**Tolerant reader rule:** the harness never rejects unknown fields — every schema
sets `additionalProperties: true`. Conformance validators MUST NOT fail a file for
carrying extra fields. Where the code closes a value set (status enums, impact enums,
predicate types), the schema closes it too; everywhere else the schema stays open.

## 2. Run directory layout

Source: `src/core/harness/runs.js`, `src/integrations/pi/rstack-sdlc.ts`.

All governed state for one run lives under `.rstack/runs/<run_id>/`
(`RSTACK_STATE_DIR` MAY relocate `.rstack`). A `run_id` MUST match
`^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$` and MUST NOT contain `..` (`isSafeRunId`).

```
.rstack/
  rstack.config.json          # project profile/config   → rstack-project.schema.json (definitions.file)
  budget.json                 # budget policy overrides  → rstack-profile.schema.json (spec.budget_policy)
  policy.json                 # approval/review gates    → rstack-gate.schema.json (definitions.file)
  session.json                # session→run pin (#289)
  runs/<run_id>/
    manifest.json             # run identity + status    → rstack-run.schema.json (definitions.manifest)
    plan.md                   # human-readable plan
    tasks.json                # task graph               → rstack-task.schema.json (definitions.file)
    approvals.json            # approval ledger          → approval.schema.json
    decisions.json            # decision queue           → rstack-decision.schema.json (definitions.file)
    events.jsonl              # event stream (append-only)
    evidence.jsonl            # evidence ledger          → evidence.schema.json (per line)
    context.md                # goal + clarifications
    specs/                    # per-artifact specs
    artifacts/stages/<stage-id>/<artifact>
    tasks/<task_id>/
      builder.json            # builder contract         → builder-contract.schema.json
      validation.json         # validator contract       → validator-contract.schema.json
    checkpoints/              # pre/post restore points for critical stages
    attestations/             # *.attestation.json       → rstack-attestation.schema.json
```

A conformant producer MUST write `manifest.json` before any other run file — a run
directory without a manifest is not a run, and the approval audit rejects every
record attributed to it (`approval_run_has_manifest`).

State writes MUST be atomic (temp + fsync + rename) and serialized under a per-file
lock; readers of the JSONL ledgers MUST tolerate a corrupt line by skipping it
(#294), never by failing the read.

## 3. The 15 canonical stages

Source: `src/core/harness/stages.js` (`CANONICAL_SDLC_STAGES`, quoted exactly).

| id | title | artifact |
|---|---|---|
| `00-environment` | Environment | `environment_report.json` |
| `01-transcript` | Transcript | `transcript.json` |
| `02-requirements` | Requirements | `requirements.json` |
| `03-documentation` | Documentation | `documentation.json` |
| `04-planning` | Planning | `plan.json` |
| `05-jira` | Jira | `jira_tickets.json` |
| `06-architecture` | Architecture | `system_design.json` |
| `07-code` | Code | `code_report.json` |
| `08-testing` | Testing | `test_report.json` |
| `09-deployment` | Deployment | `deployment_report.json` |
| `10-summary` | Summary | `summary.json` |
| `11-feedback-loop` | Feedback loop | `feedback.json` |
| `12-security-threat-model` | Security threat model | `threat_model.json` |
| `13-compliance-checker` | Compliance checker | `compliance_report.json` |
| `14-cost-estimation` | Cost estimation | `cost_estimate.json` |

Each stage's agent id is `agent.<stage-id>`. Stage artifacts land at
`.rstack/runs/<run_id>/artifacts/stages/<stage-id>/<artifact>`.

**Plan task ids are NOT stage ids.** A plan task (e.g. `004-implementation`) targets
canonical stages through its `stage_artifacts[].stage_id` list; consumers MUST use
that list (the shared `taskStageIds` recipe) — conflating the two taxonomies broke
metrics, checkpoints, and rollback once and MUST NOT recur.

## 4. Run manifest

Source: `sdlc_start` in `src/integrations/pi/rstack-sdlc.ts`;
`src/core/harness/migrations.js`.

`manifest.json` MUST carry `run_id`, `created_at`, `updated_at`, `goal`, `mode`
(`interactive | express`), `status`, and `project_root`. Current writers also stamp
`schema_version: 2`, `rstack_version`, `started_by`, `profile`, and `workflow`.
`status` MUST be one of `STARTED | CLARIFYING | PLANNED | IN_PROGRESS | BLOCKED |
DONE`. Readers MUST treat a missing `schema_version` as version 1 and migrate
forward on read (`migrateManifest`); a producer at v1alpha1 MUST stamp version 2.

## 5. Tasks and the claim gate

Source: `sdlc_plan` / `sdlc_build_next` in `src/integrations/pi/rstack-sdlc.ts`.

`tasks.json` is `{ run_id, profile?, workflow?, budget_policy?, tasks: [...] }`. Each
task MUST carry `id`, `title`, `status`, `stage_artifacts`, and `output_dir`; task
`status` MUST be one of `PENDING | READY | IN_PROGRESS | PASS | FAIL | BLOCKED |
NEEDS_CONTEXT`.

Claiming the next task MUST happen inside a file-lock critical section on
`tasks.json`, and the claim order MUST be (#265):

1. **FAIL** first — so the retry policy and attempt budgets engage at the point of
   failure;
2. then **BLOCKED** — still a claim candidate so an approved guardrail override can
   resume it (the gate re-evaluates on every claim);
3. then fresh **PENDING / READY** work.

Before stamping `IN_PROGRESS`, the claim MUST evaluate, in order: the approval
consistency audit (§6), the attempt-budget guardrail (#149), required approvals
(policy `required_approvals` + stage approvals #228), and Definition-of-Ready
(pending required decisions). A blocked task MUST NOT be marked started. When a
one-shot override is spent, the CONSUMED marker MUST be appended **before** the
attempt is granted, inside the claim critical section — a crash in between fails
closed (override burned, no extra attempt).

## 6. Approval semantics

Source: `src/core/harness/approval-audit.js`, `src/core/harness/stage-approvals.js`,
`sdlc_approve` in `src/integrations/pi/rstack-sdlc.ts`.

`approvals.json` is an append-only array of records (see `approval.schema.json`).
Statuses are exact-case `APPROVED | REJECTED | PENDING | CONSUMED` — a record
claiming `approved` is malformed, not a synonym.

Gate decisions MUST use **latest-record-wins per artifact**, computed only over
records that pass the #133 consistency audit:

- Every record MUST carry a writer-minted `id`, a safe `artifact` name (file/stage
  name, never a path), an allowed `status`, an `approver`, and a parseable
  `timestamp`. Current writers also stamp `run_id` (#298).
- A record stamped for another run MUST NOT unblock this one (cross-run replay
  rejection). Records without a `run_id` stamp predate #298 and are grandfathered.
- A duplicated record id in an artifact's history is replay; a record timestamped
  materially before an earlier record (>60s skew) means the history was rewritten.
  Either finding MUST poison the artifact — fail closed, nothing in an inconsistent
  history may unblock work.
- A malformed **latest** record poisons its artifact; consumers MUST NOT fall back
  to an earlier valid record (otherwise tampering a CONSUMED marker would resurrect
  the spent APPROVED override).
- Records claiming a dashboard source (`dashboard` / `business-hub`) MUST carry
  token-verified actor evidence.
- Rejected records MUST be reported as `approval_audit_failed` events, and the gated
  work MUST stay gated.

**One-shot overrides:** `guardrail-override:<task_id>` approvals grant exactly one
extra attempt. The harness MUST append a `CONSUMED` record (approver
`rstack-harness`) when the attempt is granted; latest-record-wins then shadows the
APPROVED record permanently.

**Stage approvals (#228):** `required_stage_approvals` (stage-id-keyed artifact
lists) and `approvals.every_stage: true` (blanket `stage-approval:<stage-id>`
artifacts) are explicit team policy and MUST be enforced in every mode, express
included. With `every_stage` on, a task mapping to no canonical stage MUST still
gate — on `stage-approval:<taskId>` (fail closed).

**Run binding for sign-offs:** with no explicit `run_id` and no resolvable session
pin, an approval writer MUST refuse when more than one run exists rather than
guessing (#289).

## 7. Builder and validator contracts

Source: `src/core/harness/contracts.js`.

- A builder MUST write `builder.json` conforming to `builder-contract.schema.json`.
  Status MUST be one of `PASS | FAIL | BLOCKED | DONE_WITH_CONCERNS`. A passing
  contract (PASS / DONE_WITH_CONCERNS) MUST additionally satisfy the completeness
  gate (#118): meaningful `summary` (≥10 chars), non-empty meaningful `tests_run`,
  a `memory_summary` with `work_done` and `evidence`, and a `stage_summaries` entry
  for every canonical stage the task targets. Junk evidence (e.g. `[{}]`) MUST NOT
  satisfy the gate.
- A validator MUST write `validation.json` conforming to
  `validator-contract.schema.json`. Status MUST be `PASS | FAIL`;
  `retry_recommendation` MUST be one of `none | retry_builder | ask_user | block`.
- Producer/reviewer identity (`harness`, `model`, `validator_type`) is OPTIONAL —
  legacy contracts stay valid — but review independence (#72) can only verify what
  the contract records, and validators MUST say so when identity is absent.
- Validators MUST be read-only: the validator sandbox denies writes, destructive
  shell, git mutations, publish/deploy, and secret-path redirects, with no override
  path.

## 8. Evidence ledger

Source: `src/core/harness/evidence.js`.

Every line of `evidence.jsonl` MUST carry `task_id`, `kind`, `status`
(`PASS | FAIL | BLOCKED | INFO`), and `evidence`; writers stamp `ts`. Appends MUST
hold the shared file lock. A run MUST NOT be claimed DONE without command evidence —
"never claim DONE without proof" is the contract, and `requireEvidenceForPass`
enforces it at validation.

## 9. Guardrails

Source: `src/core/harness/guardrails.js` (`DEFAULT_HARNESS_GUARDRAILS`).

| Guardrail | Default |
|---|---|
| `maxTaskAttempts` | 2 |
| `maxDestructiveTaskAttempts` | 1 |
| `maxToolCallsPerTask` | 40 |
| `maxMessagesPerTask` | 25 |
| `requireBuilderContract` | true |
| `requireValidatorContract` | true |
| `requireEvidenceForPass` | true |
| `requireUserApprovalForDestructiveActions` | true |
| `requireUserApprovalForPublishDeployOrForcePush` | true |

Attempt budgets MUST hard-block at claim time (task → BLOCKED) and MUST only be
resumable via an audited one-shot `guardrail-override:<task_id>` approval.
Destructive actions (broad deletes, git force, publish, deploy, secret writes, db
destroys) MUST require an audited `destructive-action:<taskId>` approval; a release
sign-off (`release-readiness.json`) MUST NOT grant a run-wide destructive bypass.

## 10. Retry policy

Source: `src/core/harness/retry-policy.js` (#123); table as documented in
`docs/HARNESS.md`. Post-validation transitions MUST be decided by this pure
function, not by prompts or inline attempt math:

| `retry_recommendation` | Condition | `action` | `next_status` |
|---|---|---|---|
| `none` | validation PASS | `complete` | `PASS` |
| `retry_builder` | attempts < budget | `retry` | `FAIL` (re-claimable by `sdlc_build_next`) |
| `retry_builder` | attempts >= budget | `exhausted` | `BLOCKED` (needs `guardrail-override:<task_id>` approval) |
| `ask_user` | — | `human_context` | `NEEDS_CONTEXT` |
| `block` | — | `block` | `BLOCKED` |
| missing / unknown | conservative fallback | FAIL behaves as `retry_builder`, PASS as `none` | per row above |

Every decision MUST be recorded as a pinned `retry_decision` event plus one
action-specific event (`task_retry_scheduled`, `task_retry_exhausted`,
`task_human_context_required`, `task_blocked_by_validator`). Exhaustion at validate
time MUST enqueue the same override approval card the claim path produces (#274).

## 11. Goal loop bounds

Source: `src/core/harness/goal-loop.js`.

The goal loop (`rstack-agents pipeline loop`) MUST be bounded: default
`maxIterations: 3`, `maxStepsPerIteration: 10`, with a hard cap of **20** iterations
that no configuration can exceed. The loop MUST stop on: goal met, iteration budget,
no progress, or budget exhaustion (checked before each iteration). Stage resets MUST
happen in-lock and MUST NOT launder attempt budgets.

## 12. Decisions

Source: `src/core/harness/decisions.js`.

Decision statuses are `pending | resolved | waived`; impacts are
`architecture | security | budget | scope | delivery`. `required_before_stage` MUST
be a canonical stage id — intake MUST refuse non-canonical values (#290) because the
Definition-of-Ready gate fails closed on unknown stages. A pending required decision
MUST block the claim of any task entering its gated stage.

## 13. Attestations

Source: `src/core/harness/attestations.js` (#73).

Attestation envelopes (`rstack-attestation.schema.json`) wrap builder, validator,
and release-readiness contracts with subject checksums, producer identity, and an
optional signature (`unsigned` or `local-dev-signature`; `signature.type` is an open
extension point — verifiers MUST report unknown types honestly instead of pretending
to verify). Verification MUST reject mismatched subjects, stale checksums, unknown
predicate types, and invalid predicates (builder predicate status outside
`BUILDER_STATUSES`, task_id mismatch).

## 14. Schema index

| Schema | Describes | Envelope? |
|---|---|---|
| `builder-contract.schema.json` | `tasks/<id>/builder.json` | raw file |
| `validator-contract.schema.json` | `tasks/<id>/validation.json` | raw file |
| `approval.schema.json` | `approvals.json` | raw file |
| `evidence.schema.json` | one `evidence.jsonl` line | raw file |
| `rstack-attestation.schema.json` | `attestations/*.attestation.json` | own envelope (`schema` field) |
| `rstack-run.schema.json` | Run resource; `definitions.manifest` = raw `manifest.json` | resource |
| `rstack-task.schema.json` | Task resource; `definitions.file`/`.task` = raw `tasks.json` | resource |
| `rstack-decision.schema.json` | Decision resource; `definitions.file`/`.decision` = raw `decisions.json` | resource |
| `rstack-gate.schema.json` | Gate resource; `definitions.file` = raw `policy.json` | resource |
| `rstack-profile.schema.json` | Profile resource (profiles + budget policy) | resource |
| `rstack-project.schema.json` | Project resource; `definitions.file` = raw `rstack.config.json` | resource |
| `rstack-agent-role.schema.json` | AgentRole resource (core roles + validator registry) | resource |
| `rstack-adapter.schema.json` | Adapter resource (18-tool surface, bridge, guard) | resource |

## 15. Conformance

See [`conformance.md`](conformance.md) for the `basic`, `business-flex`, and
`enterprise` conformance levels and the exact MUST list per level. A friendly
walkthrough of one governed run lives in [`primer.md`](primer.md).
