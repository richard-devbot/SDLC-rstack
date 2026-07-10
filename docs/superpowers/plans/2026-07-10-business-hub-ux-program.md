<!-- owner: RStack developed by Richardson Gunde -->

# Business Hub UX Program — Parallel Delivery Plan

> **For coding agents:** Treat each workstream below as an independently assignable GitHub issue. Preserve real `.rstack` data contracts, add tests before changing conclusions, and do not use demo values in the running dashboard.

**Goal:** Deliver an evidence-first, scope-correct, responsive Business Hub with six user-oriented destinations and trustworthy no-data/readiness semantics.

**Architecture:** Normalize project/run identity, scope, availability, readiness, actions, and configured policy in the dashboard state layer. Keep page rendering modular, but make pages consume shared server-owned view models instead of independently recomputing product conclusions. Migrate the shell and screens incrementally behind a feature flag; retain existing deep links until parity is verified.

**Tech stack:** Node.js ES modules, server-rendered HTML/CSS plus plain browser JavaScript, dashboard REST/WebSocket state, Node test runner and browser-level dashboard tests.

---

## Priority model

| Priority | Definition | Workstreams |
| --- | --- | --- |
| P0 | Can mislead a release/cost/operator decision; ship before redesign | Readiness truth, scope/identity/time, pre-run profile/budget truth |
| P1 | Core end-user journey and regression safety | Responsive shell, Overview/Proof Rail, Run Workspace, Action Inbox, browser/a11y suite |
| P2 | Consolidation and operational comprehension | Evidence Center, Spend & Operations |
| P3 | Valuable state-changing capability requiring additional security contract | Authenticated cockpit controls |

## Dependency graph

```text
P0 readiness truth ──────────────┐
P0 scope/identity/time ──────────┼──> P1 Overview + Proof Rail ──> P2 Evidence Center
P0 config/budget truth ──────────┘              │
                                                ├──> P1 Run Workspace
P1 responsive shell ────────────────────────────┤
P1 normalized Action Inbox ─────────────────────┤
P1 browser/a11y suite validates every wave ─────┘

P0 config/budget truth ─────────────────────────────> P2 Spend & Operations
P1 Action Inbox + security contract ─────────────────> P3 cockpit controls
```

## Workstream 1 — Availability-aware readiness (P0, GitHub #93)

**Existing issue to expand:** #93  
**Primary files:**

- Modify `src/observability/dashboard/state/index.js`
- Add `src/observability/dashboard/state/readiness.js`
- Modify `src/observability/dashboard/state/client-state.js`
- Modify `src/observability/dashboard/ui/pages/release-readiness.js`
- Modify `src/observability/dashboard/ui/pages/command-center.js`
- Test in `test/observability/dashboard-state.test.js` and dashboard UI tests

**Contract:** Create one server-owned readiness result with `status: unknown|blocked|at_risk|ready`, `coverage`, `checks`, `blockers`, `evaluatedAt`, and source references. An empty run/evidence scope must be `unknown`.

**Implementation sequence:**

1. Write failing state tests for no runs, incomplete coverage, failures, unresolved gates, and full pass.
2. Build the readiness projection once in the state layer.
3. Serialize the projection without dropping availability/source fields.
4. Make both Overview and Release Readiness render the projection; remove their independent formulas.
5. Add DOM assertions that no-run content contains `Unknown`/`Not evaluated` and never `Ready`/`100%`.

**Verify:** `npm test -- --runInBand` plus the repository's dashboard E2E command.

## Workstream 2 — Scope, identity, and time correctness (P0, GitHub #276)

**Primary files:**

- Modify `src/observability/dashboard/state/roots.js`
- Modify `src/observability/dashboard/state/index.js`
- Modify `src/observability/dashboard/state/client-state.js`
- Modify `src/observability/dashboard/ui/client.js`
- Modify `src/observability/dashboard/ui/lib.js`
- Add state and UI tests for two projects/two runs

**Contract:** Every scoped aggregate declares `scopeKey`; worktrees retain a canonical project identity and separate worktree label; timestamps use `Intl.DateTimeFormat` with visible timezone/relative context.

**Implementation sequence:**

1. Add a two-root fixture containing cross-project alerts, gates, diagnostics, summaries, stages, and approvals.
2. Introduce a canonical project descriptor `{id,name,root,repositoryRoot,worktreeName,isWorktree}`.
3. Normalize run-linked and project-linked records with project/run keys.
4. Replace partial `applyScope` copying with a complete, testable selector/view model.
5. Keep project/run selectors visible on mobile.
6. Replace string slicing in `fmtTime` with locale/timezone-aware formatting.

**Verify:** focused state/client tests, then E2E assertions for scope isolation at 1440px and 390px.

## Workstream 3 — Pre-run profile and budget truth (P0, GitHub #277)

**Primary files:**

- Modify `src/observability/dashboard/state/business-flex.js`
- Modify `src/observability/dashboard/state/index.js`
- Modify `src/observability/dashboard/state/client-state.js`
- Modify `src/observability/dashboard/ui/pages/business-flex.js`
- Modify `src/observability/dashboard/ui/pages/cost-budget.js`
- Add initialized-project/no-run fixtures

**Contract:** Root configuration and run snapshots are distinct. An initialized project shows its selected profile and run/day/month caps before any run; consumption remains unavailable until telemetry exists.

**Implementation sequence:**

1. Add failing tests for config/budget present with zero runs.
2. Read validated profile/budget summaries per root in the state layer.
3. Expose `configuredPolicy` separately from `observedConsumption`.
4. Render enforced caps with source path and freshness even when run list is empty.
5. Change copy from `no cap configured` to the correct configured/invalid/unavailable state.

**Verify:** state unit tests plus rendered no-run Cost/Business Flex assertions.

## Workstream 4 — Six-destination responsive shell (P1, GitHub #278)

**Primary files:**

- Modify `src/observability/dashboard/ui/pages/index.js`
- Modify `src/observability/dashboard/ui/styles.js`
- Modify `src/observability/dashboard/ui/client.js`
- Update keyboard/navigation tests

**Contract:** Primary nav is Overview, Runs, Evidence, Decisions, Spend, Operations. Legacy page IDs remain addressable during migration. Scope is always visible; mobile uses a top bar and accessible drawer.

**Implementation sequence:**

1. Add navigation model tests and deep-link compatibility tests.
2. Introduce destination groups and feature flag.
3. Build desktop side rail, compact tablet rail, and mobile app-bar/drawer states.
4. Add focus trap/return, Escape close, `aria-expanded`, and `aria-current` behavior.
5. Move low-level pages behind destination-local secondary navigation.

**Verify:** keyboard-only walkthrough and screenshots at 1440, 1024, 768, and 390px.

## Workstream 5 — Overview and Proof Rail (P1, GitHub #279)

**Primary files:**

- Modify `src/observability/dashboard/ui/pages/command-center.js`
- Modify `src/observability/dashboard/ui/pages/index.js`
- Modify `src/observability/dashboard/ui/styles.js`
- Add shared Proof Rail renderer/module

**Contract:** The first viewport shows outcome, source/coverage, next action, stage/proof rail, and Action Inbox preview. No-data and stale-data are explicit visual states.

**Implementation sequence:**

1. Add DOM fixtures for no data, active, blocked, stale, and fully verified states.
2. Render the server-owned readiness result and normalized stage model.
3. Build Proof Rail with non-color state labels and evidence coverage.
4. Add plain-language next-action translation with source deep links.
5. Push secondary telemetry below the primary decision surface.

**Verify:** state matrix DOM tests, contrast audit, responsive screenshots.

## Workstream 6 — Unified Run Workspace (P1, GitHub #280)

**Primary files:**

- Consolidate rendering from `projects-runs.js`, `workflow-map.js`, `run-analytics.js`, `studio.js`, `agent-work.js`, and `run-report.js`
- Add `src/observability/dashboard/ui/pages/run-workspace.js`
- Update route/page registration and styles

**Contract:** One run route exposes Summary, Work, Timeline, Artifacts, and Metrics while preserving `run=<id>` and source links.

**Implementation sequence:**

1. Freeze current run-page parity in tests.
2. Add a shared run view model and explicit unavailable states.
3. Implement tab/section routing with preserved scope.
4. Reuse artifact preview/security behavior; do not duplicate file access.
5. Keep legacy pages as redirects/deep links until parity is signed off.

**Verify:** deep-link, browser back/forward, keyboard tab, artifact safety, and mobile card-layout tests.

## Workstream 7 — Normalized Action Inbox (P1, GitHub #281)

**Related existing issues:** #156, #213  
**Primary files:**

- Add `src/observability/dashboard/state/actions.js`
- Modify approvals, decisions, guardrail/alert, diagnostics state builders
- Consolidate UI from `approvals.js`, `decisions.js`, and `alerts-guardrails.js`

**Contract:** One actionable schema covers approvals, decisions, guardrail blocks, failed validation, retry exhaustion, and configuration problems without weakening existing audit/security checks.

**Implementation sequence:**

1. Define normalized action type and add producer tests.
2. Map every existing producer with source record and scope.
3. Add queue filters, blocking order, owner/age, and resolved history.
4. Route current safe actions through existing authenticated/audited endpoints only.
5. Emit resolution events and preserve original record links.

**Verify:** schema unit tests; approval/guardrail security regressions; queue ordering and filter E2E.

## Workstream 8 — Browser, responsive, and accessibility regression suite (P1, GitHub #96)

**Existing issue to expand:** #96  
**Primary files:** existing dashboard fixtures/test harness plus accessibility tooling configuration

**Contract:** Automated coverage for all six destinations, truth-state matrix, scope isolation, WebSocket reconnect/fallback, keyboard navigation, critical ARIA, and 390px layouts.

**Implementation sequence:**

1. Add deterministic fixtures for no-data, active, blocked, stale, and multi-project states.
2. Add semantic/DOM assertions before screenshot comparisons.
3. Add desktop/mobile journeys and keyboard-only navigation.
4. Run an automated accessibility scan on each destination.
5. Make scope leakage, hidden mobile scope, false readiness, and critical overflow release-blocking failures.

**Verify:** suite passes twice from a clean fixture to detect flakiness.

## Workstream 9 — Evidence Center (P2, GitHub #282)

**Primary files:** traceability, readiness, security, compliance, and artifact UI/state modules

**Contract:** A source-linked tri-state matrix connects requirements to implementation, tests, security, compliance, approvals, and final readiness.

**Implementation sequence:** add shared evidence projection tests; normalize expected vs observed evidence; build summary/matrix/detail views; link readiness checks to exact rows/artifacts; support export without changing the source records.

**Verify:** missing evidence remains Unknown, failed evidence remains Failed, and every Verified cell opens a real source.

## Workstream 10A — Spend consolidation (P2, GitHub #283)

**Primary files:** Cost & Budget and Business Flex state/UI modules

**Contract:** Spend separates policy from consumption and always shows provenance.

**Implementation sequence:** reuse P0 policy/identity contracts; consolidate policy, consumption, planned-vs-actual, drivers, and provenance; preserve raw metrics detail.

**Verify:** configured/no-telemetry, events-derived, persisted, stale, exhausted, and invalid-config fixtures.

## Workstream 10B — Operations consolidation (P2, GitHub #284)

**Primary files:** Environment, Diagnostics, Live Feed, Team, alert, retry, checkpoint, and context/memory state/UI modules

**Contract:** Operations groups telemetry by operator action, makes global vs scoped health explicit, and keeps raw feed available as secondary detail.

**Implementation sequence:** reuse P0 identity/scope and P1 Action Inbox contracts; consolidate freshness, integrations, actionable health, retry/checkpoint/context-pressure history, and agent/team presence; preserve raw event access.

**Verify:** healthy, stale/fallback, disconnected, integration-failure, retry-exhausted, checkpoint/restore, context-pressure, and multi-project fixtures.

## Workstream 11 — Authenticated cockpit controls (P3, GitHub #285)

**Blocked by:** security design, Action Inbox contract, and audit event contract.  
**Candidate controls:** start, resume, bounded loop, checkpoint restore, rollback request.

**Contract:** No state-changing control is visible as enabled unless the server declares authorization, preconditions, audit behavior, and idempotency. Destructive or rollback actions require explicit confirmation and existing governance gates.

**Verify:** unauthorized/expired/replayed requests fail closed; successful actions emit auditable events and immediately reconcile UI state.

## Cross-workstream definition of done

- Evidence in the issue is reproducible from a named fixture or source line.
- Unit/state tests cover positive, negative, unknown, and malformed inputs.
- Browser test covers desktop and 390px where the change is visible.
- Scope and source/provenance are visible for every conclusion.
- No new unauthenticated mutation endpoint.
- Accessibility checks pass and keyboard behavior is documented.
- Existing deep links remain functional until their migration issue explicitly removes them.
- Documentation and the Figma issue-to-screen map are updated with the final implementation.
