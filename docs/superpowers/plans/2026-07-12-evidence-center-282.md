<!-- owner: RStack developed by Richardson Gunde -->
# Evidence Center #282 implementation plan

1. Add failing state tests for verified/failed/unknown cells, audited approvals, malformed/index availability, cross-project isolation, and readiness reuse.
2. Build a normalized server projection from scoped runs, validations, evidence ledger, stage artifacts, approvals, and integrity records.
3. Feed the projection into readiness before Overview and client-state serialization.
4. Replace the visible Evidence navigation with a responsive Evidence Center while preserving legacy routes.
5. Add Summary, Matrix, Rationale, and exact-projection export UI with accessible filters and source detail.
6. Add UI, keyboard, responsive, safe-source, and compatibility tests.
7. Run focused tests, full tests, lint, typecheck, validation, and desktop/mobile browser QA.
8. Publish a stacked draft PR on #281 and post backend-alignment evidence to issue #282.
