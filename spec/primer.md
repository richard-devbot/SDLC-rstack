# RStack Spec primer — one governed run, start to finish

<!-- owner: RStack developed by Richardson Gunde -->

The [normative spec](rstack-spec.md) tells you what MUST be true. This primer shows
you what it *feels* like: one governed run, told through the files it leaves behind.
It follows the same journey as the
["RStack in 5 Minutes" quick-start](../docs/quick-start-guide.md) — the documented
golden path that runs as a real subprocess test in CI (`tests/golden-path.e2e.test.js`).
A complete example of every file below lives in
[`examples/spec/business-flex-run/`](../examples/spec/business-flex-run/).

## 1. The run starts — `manifest.json`

You call `sdlc_start` with a goal. RStack creates `.rstack/runs/<run_id>/` and writes
the manifest: who started it, which profile and workflow apply, `schema_version: 2`,
status `STARTED`. It also pins the run to your session (`.rstack/session.json`) so
later calls — and later *processes* — know which run you mean.

From this moment, the manifest is the run's identity. Approvals for a run directory
with no manifest are rejected wholesale: no manifest, no run, no unblocking.

## 2. The plan — `plan.md` + `tasks.json`

`sdlc_plan` writes a human-readable plan and the task graph. Each task carries its
canonical stage targets (`stage_artifacts`), the agents routed to it, and a budget
envelope. Task ids like `004-implementation` are plan ids — the canonical stages
(`07-code`, `08-testing`, ...) live inside the task, and every consumer uses that
same list.

## 3. Decisions before architecture — `decisions.json`

The product owner records the choices that must not be guessed ("which payment
provider first?") as Decision Queue items, each gated on a canonical stage. The
Definition-of-Ready gate blocks any task entering that stage while a required
decision is pending. In the example run, `DEC-001` is resolved before
`06-architecture` work claims.

## 4. Building — the claim gate and `builder.json`

`sdlc_build_next` claims work inside a lock, in a fixed order: failed tasks first
(so retries engage at the point of failure), then blocked tasks (an approved
override can resume them), then fresh work. Before stamping `IN_PROGRESS` it checks
the approval audit, attempt budgets, required approvals, and readiness.

The builder does the work and writes `builder.json`: what changed, what ran, risks,
next steps — plus a memory summary and per-stage summaries. A passing contract needs
real evidence; `[{}]` doesn't count.

## 5. The hero moment — approvals

Our example run hits two human gates:

- **`stage-approval:07-code`** — the project's policy requires a human sign-off
  before code work. Approving the stage once unblocks every task entering it for the
  rest of the run.
- **`guardrail-override:004-implementation`** — the builder failed twice (the
  default `maxTaskAttempts`), so the task hard-blocked. A human reviewed and
  approved exactly one more attempt. When the harness granted it, it appended a
  `CONSUMED` marker — the override is spent, and because gates read
  *latest-record-wins*, the old APPROVED record can never unblock again. Tampering
  the CONSUMED marker doesn't resurrect it either: a malformed latest record poisons
  the artifact. Fail closed.

## 6. Validation — `validation.json` and the retry policy

`sdlc_validate` checks the contract mechanically (required fields, files exist,
tests evidenced, no placeholder stubs, review independence) and writes
`validation.json` with PASS/FAIL, every check, and a `retry_recommendation`. That
recommendation drives a deterministic retry policy — retry, exhaust to BLOCKED, ask
a human, or block — never inline attempt math.

## 7. The paper trail — `evidence.jsonl` and attestations

Every validation appends evidence lines: task, kind, status, proof. `rstack-agents
attest` can then wrap each contract in a tamper-evident envelope — subject
checksums, producer identity, optional HMAC signature — so six months later you can
verify the evidence a report points at is still the evidence that was produced.

## 8. Done — and provable

The manifest flips to `DONE` only after validations pass. The Business Hub, the
`pipeline status` CLI, and the raw JSON all read the same state. Now validate the
whole story against the spec:

```bash
npx rstack-agents validate --schemas
```

Every file in the example run passes every schema. That's the point: the spec
documents what the code actually writes — nothing aspirational, nothing decorative.
