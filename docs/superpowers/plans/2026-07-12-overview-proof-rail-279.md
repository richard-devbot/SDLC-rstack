# Availability-aware Overview and Proof Rail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the KPI-first Overview with a server-truthful outcome, next action, responsive Proof Rail, and ordered secondary telemetry.

**Architecture:** Keep readiness semantics in `state/readiness.js`. Add a focused stage/proof projection that translates existing scoped run data without calculating readiness, serialize only real source/availability fields, and render the Overview from those projections. Preserve existing page routes and secondary modules below the first viewport.

**Tech Stack:** Node.js ES modules, server-rendered HTML template strings, compiled vanilla-JavaScript dashboard bundle, CSS, Node test runner.

## Global Constraints

- Unknown/no-data is never translated into pass/readiness.
- Runtime UI uses real `.rstack` data only.
- Full evidence normalization remains owned by #282.
- Desktop and 390px layouts must be keyboard and screen-reader usable.
- No unauthenticated state-changing controls.

---

### Task 1: Pin the Overview truth-state contract

**Files:**
- Modify: `tests/dashboard-readiness-state.test.js`
- Modify: `tests/dashboard-command-pages.test.js`

**Interfaces:**
- Consumes: `state.readiness`, `run.pipelineRollup`, `state.stageMatrix`.
- Produces: DOM assertions for outcome, next action, proof availability, stale state, and source labels.

- [ ] Write failing tests for no-data, partial, blocked, stale, and ready Overview states.
- [ ] Run `npx tsx --test tests/dashboard-readiness-state.test.js tests/dashboard-command-pages.test.js` and confirm the new Overview/Proof Rail assertions fail because the elements and renderer do not exist.
- [ ] Keep fixtures deterministic: no clock-dependent or network-derived assertions.

### Task 2: Add the normalized stage/proof projection

**Files:**
- Create: `src/observability/dashboard/state/overview.js`
- Modify: `src/observability/dashboard/state/index.js`
- Modify: `src/observability/dashboard/state/client-state.js`
- Test: `tests/dashboard-readiness-state.test.js`

**Interfaces:**
- Consumes: `buildOverviewProjection(state)` receives scoped runs, stage matrix, readiness, approvals, alerts, and snapshot timestamp.
- Produces: `{ focusRunId, goal, stages[], actionCount, stale, evaluatedAt }`, where every stage carries explicit state and proof availability.

- [ ] Write the failing state projection tests before production code.
- [ ] Implement only translations supported by persisted fields; use `null` for unknown expected proof.
- [ ] Run the focused state test and confirm it passes.
- [ ] Refactor duplicate stage/source formatting only after green.

### Task 3: Build the decision surface and Proof Rail

**Files:**
- Modify: `src/observability/dashboard/ui/pages/index.js`
- Modify: `src/observability/dashboard/ui/pages/command-center.js`
- Modify: `src/observability/dashboard/ui/styles.js`
- Test: `tests/dashboard-command-pages.test.js`
- Test: `tests/dashboard-readiness-state.test.js`

**Interfaces:**
- Consumes: `s.readiness`, `s.overview`, and the existing safe page router.
- Produces: outcome banner, freshness/provenance ledger, primary next action, accessible Proof Rail, action preview, and reordered secondary telemetry.

- [ ] Add semantic markup with stable IDs and labels required by the failing DOM tests.
- [ ] Render all five outcome states without a local readiness formula.
- [ ] Render Proof Rail cards with text/icon state, proof wording, owner/elapsed metadata, and only real source routes.
- [ ] Reorder existing telemetry below the decision surface without removing legacy deep links.
- [ ] Add responsive horizontal-to-vertical behavior, visible focus, and reduced-motion handling.
- [ ] Run the focused tests until green, then run `npm run lint` for changed-source hygiene.

### Task 4: Browser evidence and regression verification

**Files:**
- Modify: `docs/superpowers/specs/2026-07-12-overview-proof-rail-279-design.md` only if browser findings require a clarified contract.

**Interfaces:**
- Consumes: deterministic local dashboard fixtures.
- Produces: desktop and 390px screenshots for no-data, blocked, and fully verified states plus console/accessibility observations.

- [ ] Start the dashboard fixture/server and inspect the Overview at desktop size.
- [ ] Inspect keyboard order, focus visibility, copy, overflow, and console output.
- [ ] Repeat at 390px and verify the Proof Rail becomes vertical with no page-level horizontal overflow.
- [ ] Capture the required three truth-state screenshot pairs.
- [ ] Run `npm run lint`, `npm run typecheck`, `npm test`, and `npm run validate`; record exact results in the PR.
- [ ] Commit, push `codex/ui-overview-279`, and open a draft PR stacked on `codex/ui-shell-278` until #278 merges.
