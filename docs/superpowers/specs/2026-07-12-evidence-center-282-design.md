<!-- owner: RStack developed by Richardson Gunde -->
# Source-linked tri-state Evidence Center (#282)

## Decision

Replace the browser-calculated requirements table with one server-owned evidence projection. Every requirement/evidence cell is `verified`, `failed`, or `unknown`; absence never becomes pass.

## Projection

`evidenceCenter` contains a scope-correct summary, requirement rows, normalized sources, readiness rationale, filters, and an export-safe model. Each cell carries `expected`, `observed`, `status`, `availability`, `sourceRefs`, evaluator, and evaluated timestamp.

The five evidence kinds are implementation, test, security, compliance, and approval. A verified cell must contain at least one real, safe source. Negative validation or ledger evidence yields failed. Missing, malformed, untrusted, or unavailable evidence yields unknown unless a real negative result exists.

## Source trust

- Requirements and stage availability come from the selected dashboard run state.
- Test evidence comes from task validation checks and the evidence ledger.
- Implementation, security, and compliance evidence come from stage artifacts and ledger records.
- Approval evidence is verified only when approval history passes the existing approval audit.
- Run integrity errors make affected evidence unavailable and prevent a verified result.
- Index-served runs use the #296 persisted evidence/artifact fields; projection availability identifies legacy/incomplete index entries honestly.

## UX

Evidence becomes one destination with Summary, Matrix, Rationale, and Export views. Summary exposes denominator, blockers, unknowns, scope, and evaluation time. Matrix uses explicit text labels and source buttons. At 390px rows become stacked cards rather than a horizontally scrolling certification table. Source details include project/run/task/stage/evaluator/time and route only through the existing protected artifact viewer.

## Readiness

Release readiness consumes the same evidence summary and sources. Evidence failures block; unknowns keep readiness unknown/at-risk; only complete verified evidence passes. The UI does not independently recalculate a verdict.

## Compatibility

The legacy Release Readiness, Security, and Compliance pages remain routable. Existing traceability state stays available during the stacked rollout, while the visible Evidence destination points to Evidence Center.
