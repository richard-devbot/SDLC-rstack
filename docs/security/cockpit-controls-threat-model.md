# Threat model — authenticated, audited cockpit controls (#285)

State-changing controls in the Business Hub materially expand the dashboard's
authority: until #285, every POST endpoint either resolved a governed approval
(`/api/approve`, `/api/decide`) or dogfooded the destructive gate for a single
`.env` key (`/api/env-write`). Cockpit controls let an authorized operator
**advance a run** or **restore a checkpoint** from the browser. This document is
the security contract those endpoints implement; it MUST be approved before any
mutation code ships, and every mitigation below is backed by a test in
`tests/dashboard-cockpit-285.test.js` and `tests/cockpit-actions-285.test.js`.

The guiding rule (from the harness): **approvals are a trust boundary** (#133).
Cockpit actions route through the *same* audited approval artifacts and the
*same* fail-closed run-id/artifact validators as the CLI — never a parallel
permission store, never a browser shelling out.

## Design invariants

1. **OFF by default, fails closed.** The whole feature is gated by
   `RSTACK_COCKPIT_CONTROLS=1` **or** policy `cockpit_controls.enabled: true`.
   With neither set, `POST /api/action` returns **403** and the server-owned
   `cockpit` projection declares `enabled: false` with an empty action list — so
   a client literally has nothing to render or invoke.
2. **Server declares, client renders.** The client renders *only*
   `state.cockpit.runs[].allowedActions` as computed by the server. It never
   infers a control from "the CLI has this command." Disabled actions carry a
   server-declared `disabledReason`.
3. **The server is authoritative; the projection is a hint.** Eligibility shown
   in the UI is derived from the same `pipelineRollup.next_action` /
   `checkpoints.stages` the CLI reads, so it cannot drift from what execution
   would do. But the route **re-computes** eligibility from ground truth
   (`planNextAction`, deep `verifyStageCheckpoint`) before doing any work — a
   stale or forged client claim can never cause an action the server wouldn't
   independently authorize.
4. **No optimistic success.** The route reports `accepted` + the *real* outcome
   of the harness call, then reconciles the UI from the next real snapshot. It
   never invents success.

## Assets

- Run state (`tasks.json`, `pipeline-state.json`, checkpoints) — integrity.
- The approval queue and per-run `approvals.json` — the trust boundary.
- The approval/read tokens — confidentiality.
- The audit ledger (`.rstack/cockpit-actions.jsonl`) — integrity, append-only.

## Threats and mitigations

| # | Threat | Mitigation | Test |
|---|--------|-----------|------|
| T1 | **CSRF** — a site the operator visits POSTs to `localhost:3008` | Requires the `x-rstack-approval-token` custom header (a cross-site form cannot set it) **and** a localhost/absent `Origin`; `application/json` enforced. Reuses `approvalAuthError`. | `cross-origin ... rejected` |
| T2 | **Token leakage** — token in logs, URLs, or rendered HTML | Token is read from env/file, compared with `timingSafeEqual`, **never logged** and never echoed. Actions carry no token in their id/URL — it travels only in the request header. Audit records actor + outcome, never the token. | `no token in logs / state` |
| T3 | **Replay** — resubmitting a captured successful request to run the action twice | Every invocation carries a client `idempotencyKey`; the append-only ledger records `started`/`completed`. A key seen `completed` returns the stored result (no re-execution); a key seen `started` returns **409 `in_progress`**. Repeated clicks never create duplicate work. | `replayed key returns stored result`, `concurrent duplicate ... 409` |
| T4 | **Confused-deputy scope** — an id/scope that points at another project or a path outside the run | `runId` validated by the canonical `isSafeRunId`; the run is *located* across the known roots (never trusted from the body as a path); `stageId` must be a canonical SDLC stage; artifact names pass `isSafeArtifactName` (no `/`, `\`, `..`). | `malformed scope rejected`, `path traversal rejected` |
| T5 | **Stale state** — acting on a snapshot that no longer reflects reality | The projection marks a stale run's actions disabled (`snapshot is stale`); the route re-derives eligibility from fresh disk state and **409 `not_eligible`** if the precondition no longer holds. | `stale precondition 409` |
| T6 | **Privilege escalation** — an unauthorized user approving a destructive restore | Destructive `restore-checkpoint` routes through the #238 two-step: request → PENDING queue approval → a manager (per `assertManagerAllowed`) approves on the Approvals page → one-shot `consumeApprovedQueueArtifact`. The requester cannot self-approve; approval is a separate, manager-gated action. | `restore requires approval`, `requester cannot self-approve` |
| T7 | **Expired / rotated token** | Token file is re-read per request (rotation without restart); an old token fails `timingSafeEqual` → 401. | `wrong/expired token 401` |
| T8 | **Rate / brute force** | The existing per-IP token bucket (10/min) runs before routing on every POST, including `/api/action`. | `rate limit 429` |
| T9 | **Partial failure** — the harness call errors mid-flight | The action is recorded `failed` in the ledger with the reason; the response is an honest non-2xx; no `completed` entry is written, so the key can be retried. | `partial failure recorded` |
| T10 | **Feature smuggling** — invoking a route that "exists" while the flag is off | Flag checked first, per the *target run's* project root, before any parsing or work; 403 with an explanatory error. | `disabled feature 403` |

## Action catalogue (v1)

### `resume-run` — risk: **low**, approval: **not required**

Advances the run via the model-free runner (`runPipeline`, `#124`), bounded to a
small `maxSteps`, which **stops at every human gate by construction** (pending
approval, missing contract, exhausted retry, ask-user). It only invokes
model-free tools (`sdlc_build_next`, `sdlc_validate`) through the existing
bridge — it never calls an external model and never bypasses a gate. Because it
cannot cross a gate, it is non-destructive and needs no approval; it is still
authenticated, idempotent, and audited.

Eligible when `pipelineRollup.next_action.kind ∈ {active, pending, retry,
failed}` and the run is not stale. Disabled otherwise, with the reason
(`approval pending`, `complete`, `no actionable work`, `stale`).

### `restore-checkpoint` — risk: **high**, approval: **required**

Restores a stage directory from its last verified checkpoint via
`rollbackToCheckpoint` (`#132`/`#203`), which deep-verifies sha-256 integrity and
**refuses a CORRUPT checkpoint** (fails closed — the live artifacts are never
touched by an unprovable snapshot). Two-step, mirroring `/api/env-write`:

1. No trusted approval for `destructive-action:checkpoint-restore:<runId>:<stageId>`
   → ensure a PENDING queue approval, return **409 `approval_required`**. Nothing
   is restored.
2. A manager approves on the Approvals page; resubmit → the approval is
   **consumed one-shot** → `rollbackToCheckpoint` runs → audit + run event.

Eligible only for stages the rollup marks `restorable: true`. A stage with a
`corrupt_*` / `legacy_unverified` reason is shown as a **disabled** restore
action carrying that reason (so the operator learns why it cannot be restored),
never as an enabled one.

## Audit event schema

Every attempt appends one immutable line to `.rstack/cockpit-actions.jsonl`
(this file is BOTH the idempotency ledger and the audit trail) and, when a run
is targeted, one `events.jsonl` entry for the run timeline. No secret, token, or
`.env` value ever appears.

```jsonc
{
  "ts": "2026-07-13T...Z",
  "phase": "started" | "completed" | "failed" | "denied",
  "idempotencyKey": "<client key>",
  "action": "resume-run" | "restore-checkpoint",
  "runId": "<run>",
  "stageId": "<stage or null>",
  "actor": "<resolvedBy>",
  "remote": "<ip>",
  "origin": "<origin or null>",
  "outcome": "accepted" | "approval_required" | "not_eligible" | "error" | "forbidden",
  "detail": "<human-readable, no secrets>"
}
```

## Out of scope (v1)

- `start-run` and `start-loop` (declared candidates) — split into follow-up
  issues after this shared contract ships, exactly as #285 allows.
- Any browser-side shelling, client-only role checks, optimistic success, or a
  permission store parallel to the governed approval artifacts.

<!-- owner: RStack developed by Richardson Gunde -->

