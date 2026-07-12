# RStack Spec v1alpha1 — Conformance levels

<!-- owner: RStack developed by Richardson Gunde -->

Conformance is claimed per level. Each level includes every requirement of the
levels below it. Section references (§) point into
[`rstack-spec.md`](rstack-spec.md); every requirement is checkable with
`npx rstack-agents validate --schemas` plus the named runtime behaviors.

## Level 1 — `basic`

The minimum to call state "an RStack run". A `basic` implementation:

1. MUST store all run state under `.rstack/runs/<run_id>/` with a `run_id` matching
   `^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$` and no `..` (§2).
2. MUST write `manifest.json` before any other run file, conforming to
   `rstack-run.schema.json#definitions.manifest`, with `status` in
   `STARTED | CLARIFYING | PLANNED | IN_PROGRESS | BLOCKED | DONE` and
   `schema_version: 2` (§4).
3. MUST write `tasks.json` conforming to `rstack-task.schema.json#definitions.file`,
   every task carrying `id`, `title`, `status`, `stage_artifacts`, `output_dir` (§5).
4. MUST use only the canonical 15 stage ids of §3 in `stage_artifacts[].stage_id`,
   and MUST NOT treat plan task ids as stage ids.
5. MUST have builders write `builder.json` conforming to
   `builder-contract.schema.json` and validators write `validation.json` conforming
   to `validator-contract.schema.json`, into the task's `output_dir` (§7).
6. MUST write state files atomically and tolerate corrupt JSONL lines by skipping
   them (§2).
7. MUST keep unknown fields: a `basic` reader MUST NOT reject a file for carrying
   fields it does not understand (§1).

## Level 2 — `business-flex`

Adds the governed loop: approvals, gates, evidence, and policy. A `business-flex`
implementation MUST satisfy `basic`, and:

1. MUST maintain `approvals.json` conforming to `approval.schema.json`: exact-case
   statuses, writer-minted ids, safe artifact names, run_id stamps on new records
   (§6).
2. MUST gate on **latest-record-wins per artifact** computed only over audit-passing
   records; a malformed latest record or an inconsistent history (replay, rewritten
   ordering) MUST poison its artifact — fail closed (§6).
3. MUST enforce `required_approvals`, `required_stage_approvals`, and
   `approvals.every_stage` from a `policy.json` conforming to
   `rstack-gate.schema.json#definitions.file` — in every mode, express included
   (§6).
4. MUST implement one-shot `guardrail-override:<task_id>` semantics: hard-block at
   the attempt budget, resume only via an audited APPROVED record, append the
   CONSUMED marker before granting the attempt (§5, §6, §9).
5. MUST claim in FAIL → BLOCKED → PENDING/READY order inside a lock, evaluating
   audit, budgets, approvals, and readiness before stamping IN_PROGRESS (§5).
6. MUST decide post-validation transitions by the retry-policy table of §10 and
   record the pinned `retry_decision` + action events.
7. MUST append evidence to `evidence.jsonl` conforming to `evidence.schema.json`,
   and MUST NOT report a run DONE without evidence (§8).
8. MUST enforce the guardrail defaults of §9 (overridable via config, never
   silently).
9. MUST maintain a Decision Queue conforming to
   `rstack-decision.schema.json#definitions.file`, refuse non-canonical
   `required_before_stage` values at intake, and block gated stages on pending
   required decisions (§12).
10. MUST resolve profile and project config per `rstack-profile.schema.json` /
    `rstack-project.schema.json#definitions.file`, warning on invalid values (never
    silently defaulting) (§1).

## Level 3 — `enterprise`

Adds tamper-evidence and independence. An `enterprise` implementation MUST satisfy
`business-flex`, and:

1. MUST produce attestation envelopes conforming to
   `rstack-attestation.schema.json` for every builder and validator contract on
   disk, and verification MUST reject mismatched subjects, stale checksums, and
   invalid predicates (§13).
2. MUST enforce a `review_policy` (§6 of `rstack-gate.schema.json#definitions.file`):
   with `require_cross_harness_review` / `forbid_same_harness_builder_and_validator`
   enabled, a confirmed violation MUST escalate per `fallback_behavior`
   (`warn | ask_user | block`); missing identity MUST degrade to WARN with the gap
   named — never silently pass, never brick legacy contracts.
3. MUST enforce blanket per-stage human gates when configured
   (`approvals.every_stage: true`), including the fail-closed
   `stage-approval:<taskId>` artifact for tasks mapping to no canonical stage (§6).
4. MUST declare its governance posture through packs (`enabled_packs`,
   `rstack-gate.schema.json`), with enforcement levels
   `advisory | warning | blocking`; the enterprise default set includes
   `dor-enterprise`, `cross-harness-review`, `attestations`, `drift-detection`,
   `untrusted-pr-gate`, and the compliance mapping packs.
5. MUST keep validators read-only with no override path (validator sandbox, §7),
   and stage-validator registry overrides MUST NOT be able to clear `read_only`.

## Claiming conformance

State the level and the spec version, e.g. *"conforms to RStack Spec
`rstack.dev/v1alpha1`, level `business-flex`"*. Adapters additionally conform to
`rstack-adapter.schema.json`: the exact 18-tool surface, the bridge protocol, and a
wired enforcement guard (see `docs/integrations/adapter-contract.md`).
