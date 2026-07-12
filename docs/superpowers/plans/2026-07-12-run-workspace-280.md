# Unified Run Workspace Implementation Plan

RStack developed by Richardson Gunde

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate all run-level information into one scoped, five-section Run Workspace while preserving legacy routes and protected artifact access.

**Architecture:** Add a server-owned `runWorkspace` projection from existing run/readiness/proof data, extend the hash router with section state, and render one new page module. Legacy page modules remain compatibility surfaces while the Runs navigation points to the workspace.

**Tech Stack:** Node.js ES modules, vanilla JavaScript dashboard bundle, server-rendered template strings, CSS, Node test runner.

## Global Constraints

- Runtime UI uses real `.rstack` data only.
- Readiness and proof semantics remain server-owned.
- Artifact access continues through existing safe endpoints.
- No state-changing controls are added.
- Desktop and 390px behavior are acceptance criteria.

---

### Task 1: Pin route and parity contracts

**Files:** `tests/dashboard-navigation.test.js`, `tests/dashboard-command-pages.test.js`, new `tests/dashboard-run-workspace.test.js`.

- [ ] Add failing route tests for `page`, opaque `run`, and `section` round trips plus invalid-section fallback.
- [ ] Add a parity matrix asserting Summary/Work/Timeline/Artifacts/Metrics retain data from all six legacy pages.
- [ ] Run focused tests and confirm failures are caused by the absent workspace route/projection.

### Task 2: Build the shared run workspace projection

**Files:** new `src/observability/dashboard/state/run-workspace.js`, `src/observability/dashboard/state/index.js`, `src/observability/dashboard/state/client-state.js`, `tests/dashboard-run-workspace.test.js`.

- [ ] Add active, blocked, stale, legacy, and unavailable projection fixtures.
- [ ] Normalize identity, outcome/proof, work, timeline, artifacts, metrics/provenance, recovery, and per-section availability.
- [ ] Preserve recorded source paths and use `null` for unknown expectations/telemetry.
- [ ] Run projection tests to green.

### Task 3: Implement route-preserving workspace navigation

**Files:** `src/observability/dashboard/ui/navigation.js`, `src/observability/dashboard/ui/client.js`, `tests/dashboard-navigation.test.js`.

- [ ] Add `section` parsing/formatting and popstate synchronization.
- [ ] Make Run Workspace the Runs destination and retain legacy page mappings without showing six primary children.
- [ ] Verify refresh/back/forward preserve run and active section.

### Task 4: Render the five workspace sections

**Files:** new `src/observability/dashboard/ui/pages/run-workspace.js`, `src/observability/dashboard/ui/pages/index.js`, `src/observability/dashboard/ui/client.js`, `src/observability/dashboard/ui/styles.js`, `tests/dashboard-run-workspace.test.js`.

- [ ] Render the run passport and accessible section controls.
- [ ] Render Summary, Work, Timeline, Artifacts, and Metrics from `runWorkspace` only.
- [ ] Delegate artifact preview to the existing protected preview flow.
- [ ] Add explicit unavailable/stale/legacy states and responsive 390px styling.
- [ ] Run focused tests, lint, and browser QA.

### Task 5: Verify and publish

- [ ] Run artifact security/server-hardening regressions.
- [ ] Run lint, typecheck, full test suite, and repository validation.
- [ ] Capture desktop/390px active and legacy evidence.
- [ ] Commit, push, and open the stacked draft PR; retarget after #335 merges.
