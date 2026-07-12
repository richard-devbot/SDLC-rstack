# Availability-aware Overview and Proof Rail (#279)

RStack developed by Richardson Gunde

## Outcome

The Overview becomes the decision surface for the selected project/run scope. Its first viewport answers five questions in order: what outcome is supported, how fresh and complete the evaluation is, what the user should do next, how the delivery moved through canonical stages, and how many actionable items require review.

This design consumes server-owned state. It does not calculate a second readiness verdict, infer expected proof, or turn absent data into success.

## Selected approach

Use a progressive evidence cockpit rather than a KPI dashboard or a run-detail clone.

- The outcome banner renders `state.readiness` verbatim: Unknown, Blocked, At risk, or Ready. No numeric score appears when coverage is unavailable.
- The primary action comes from the scoped run's `pipelineRollup.next_action`; readiness blockers are the fallback. If neither exists, the page gives an honest diagnostic/setup route instead of inventing work.
- A normalized client-side stage/proof adapter combines `stageMatrix`, the focused run, `stageReports`, task validation/proof counts, pipeline checkpoint metadata, and source references already present in the snapshot. It only translates shapes; it does not decide release readiness.
- Existing operational KPIs, project activity, agents, layers, and feed remain reachable below the decision surface.

Alternatives rejected:

1. Keep the current KPI-first layout and add a Proof Rail below it. This preserves visual noise and still forces users to translate metrics before seeing the decision.
2. Build a new backend evidence schema inside #279. This overlaps #282 and would delay the end-user improvement behind a contract that is not required for an honest v1.

## Information hierarchy

1. Persistent shell scope and freshness/provenance.
2. Outcome banner with state label, plain-language rationale, evaluated time, coverage, and provenance.
3. One next-action sentence with a safe route/source label.
4. Proof Rail for the canonical stages relevant to the focused run.
5. Action Inbox preview using existing scoped attention signals; no fabricated count.
6. Active/recent runs.
7. Evidence coverage and spend.
8. Operational health and activity.

## Proof Rail contract

Each stage view model has:

- `id`, `label`, `state`: `not_started | in_progress | passed | failed | blocked | unknown`.
- `proof.attached`, `proof.expected`, and `proof.availability`: `available | partial | unavailable | unknown`.
- `primaryBlocker`, `owner`, `elapsed`, `lastEvent`, and `source`.

Rules:

- `passed` is shown only when persisted task/stage state explicitly says pass.
- Proof is “Complete” only when an expected count exists and the attached count satisfies it.
- A proof count without an expected denominator is labeled “N attached; expected coverage unknown.”
- A produced stage report is named as a real source. Missing source detail is labeled unavailable, never linked to a guessed artifact.
- `stale` is a freshness layer and never replaces Blocked/Failed/Ready.
- Every state uses text and an icon in addition to color.

## Visual direction

The existing dark RStack shell remains the brand foundation. The Overview uses a quiet control-room composition: a broad outcome field, a narrow provenance ledger, and the Proof Rail as the signature element. The rail resembles a delivery trace rather than generic stepper dots: connected checkpoint cards carry state, proof, owner, and source in one scan line. Motion is limited to one short state-reveal sequence and focus/hover feedback, and is disabled under `prefers-reduced-motion`.

Desktop uses a horizontal rail with controlled overflow and visible keyboard focus. At 390px it becomes a vertical trace; content remains in reading order without horizontal page scrolling.

## Truth states

- No run: “No delivery run has been evaluated.” Outcome Unknown. Configured policy remains separate from execution state.
- Active/partial: outcome follows readiness; stage states come only from real run/task data; unknown proof stays unknown.
- Blocked/failed: banner and next action name the first source-backed blocker; rail identifies the affected stage.
- Fully verified: Ready appears only when the shared readiness projection reports Ready and coverage is complete.
- Stale/offline: last-known outcome stays visible with an explicit stale/offline banner and regenerate/reconnect guidance.

## Scope boundaries

In scope: Overview markup, renderer/view-model adapter, responsive styling, deterministic DOM fixtures, accessibility labels, and preservation of existing deep links.

Out of scope: modifying readiness rules, inventing expected proof counts, normalizing full evidence lists (#282), building the full Action Inbox (#281), or adding state-changing controls (#285).

## Verification

- DOM fixtures: no data, active/partial, blocked, failed validation, stale snapshot, and fully verified.
- Assertions prove the Overview and Release Readiness receive the same `readiness` projection.
- Keyboard/source-link labels and non-color state text are asserted.
- Browser screenshots at desktop and 390px for no data, blocked, and fully verified.
- Focused tests, lint, typecheck, complete test suite, and repository validation must pass.
