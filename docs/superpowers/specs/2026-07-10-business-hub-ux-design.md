<!-- owner: RStack developed by Richardson Gunde -->

# Business Hub UX — Evidence-First Delivery Cockpit

**Date:** 2026-07-10  
**Status:** Approved direction; implementation backlog in progress  
**Owner:** RStack product/UI  
**Primary users:** delivery lead, engineering lead, release approver, individual contributor

## Product outcome

Turn the Business Hub from a technically rich 21-page observability console into a trustworthy delivery cockpit that answers, in order:

1. What goal are we trying to deliver?
2. Where is it now?
3. What is blocking progress or shipment?
4. What proof supports the status?
5. What human action is needed next?

The redesign must continue to use real `.rstack` state. It must not invent progress, readiness, cost, or operational data when the underlying source is absent.

## Audit evidence

### E1 — Empty data is reported as shipment confidence

- `src/observability/dashboard/ui/pages/release-readiness.js:10-24` treats zero failed tasks, zero gates, zero alerts, and zero missing validations as passing checks. With no run/evidence coverage, the verdict becomes `READY TO SHIP`.
- `src/observability/dashboard/ui/pages/command-center.js:63-75` begins at a score of 100 and subtracts negative signals. No run or coverage precondition exists, so an empty scope becomes `READY` and `100%`.
- User impact: absence of evidence is translated into confidence. This is the highest-risk UX defect because the primary dashboard can assert a release outcome it cannot establish.

### E2 — Scoped pages can mix project/run facts with global aggregates

- `src/observability/dashboard/ui/client.js:195-234` filters runs, feed, agent work/groups, decisions, presence, and trend rows.
- The same function leaves alerts, pending approvals, blocked gates, project summaries, stage matrix, diagnostics, environment, and top-level totals unchanged.
- `src/observability/dashboard/ui/client.js:140-147` then gives the partially scoped object to most page renderers.
- User impact: a selected project/run can display blockers, diagnostics, totals, or stage health belonging to another project.

### E3 — Project identity follows discovered state roots, not the operator's mental model

- `src/observability/dashboard/state/roots.js:6-10` returns registered roots.
- In the audited checkout, root `.rstack` state was absent while `.claude/worktrees/agent-a585cb4f5d1335021/.rstack` contained the real profile and budget. The UI consequently presented the worktree basename as the project.
- User impact: a delivery lead sees an opaque agent/worktree identifier where they expect the repository/project name.

### E4 — Pre-run configuration exists but is missing from the principal models

- `src/observability/dashboard/state/client-state.js:15-40` reads real run/day/month budget caps for every source root and exposes them as `loopBudgets` at `:169-172`.
- `src/observability/dashboard/state/business-flex.js:3-71` derives Business Flex profiles and planned budgets only from runs.
- `src/observability/dashboard/state/index.js:105` calls that builder with runs only.
- `src/observability/dashboard/ui/pages/cost-budget.js:170-181` renders the cap note from run-attached caps, so an initialized project with no run can say `no cap configured` even when `.rstack/budget.json` contains a cap.
- User impact: the dashboard hides the configured operating profile and can contradict the actual cost brake before the first run.

### E5 — Information architecture overwhelms the end-user journey

- `src/observability/dashboard/ui/pages/index.js:3-25` exposes 21 primary destinations across Deliver, Quality, Govern, and Operate.
- Many pages are alternate projections of the same run, evidence, decision, or operational event data.
- On a 390px viewport, the full navigation precedes useful page content and the global scope selector is hidden by `src/observability/dashboard/ui/styles.js:1080`.
- User impact: operators must understand RStack's internal taxonomy before they can answer basic delivery questions; mobile users lose scope context.

### E6 — Time presentation is ambiguous

- `src/observability/dashboard/ui/lib.js:65-68` slices the incoming timestamp string without timezone conversion or a zone label.
- User impact: page timestamps can look local while actually retaining UTC text, making incident/event ordering hard to trust.

### E7 — Visual density obscures decisions

- The current styles use a large number of 10–11px declarations, compact tables, and equal-weight panels.
- User impact: proof, risk, status, and supporting telemetry compete at the same visual level. The dashboard is data-rich but decision-poor.

## Design principles

1. **Unknown is a first-class state.** Use `Unknown`, `Not evaluated`, `No runs`, or `Insufficient evidence`; never convert absence into pass.
2. **Every conclusion names its source.** Readiness, cost, stage state, and decisions expose provenance and last-evaluated time.
3. **Scope is visible everywhere.** Project/run scope remains available on desktop and mobile and applies to every displayed aggregate.
4. **Translate system state into the user's next action.** Each blocker states owner, reason, due/age, and the safest available action.
5. **Progress and proof travel together.** Stage status is paired with validation/evidence coverage rather than shown as an isolated color.
6. **Advanced telemetry is progressive disclosure.** Default views answer delivery questions; raw events, diagnostics, and internals remain one level deeper.
7. **Real data only.** Sample data is allowed only in explicit fixtures, Storybook-style previews, or Figma annotations—not in the running product.

## Proposed information architecture

Replace the 21 primary destinations with six product destinations. Existing pages can remain as temporary deep links until migration is complete.

| Destination | User question | Existing sources consolidated |
| --- | --- | --- |
| Overview | What is happening and what needs me? | Command Center, Projects & Runs summary, Release Readiness summary, Alerts summary |
| Runs | What happened in this delivery attempt? | Projects & Runs, Workflow Map, Run Analytics, Studio, Agent Work, Run Report |
| Evidence | Can I prove the requirements, quality, security, and compliance claims? | Traceability, Release Readiness detail, Security, Compliance, artifacts |
| Decisions | What requires approval or a human choice? | Approvals, Decisions/Readiness, relevant guardrails |
| Spend | What is the enforced budget and actual usage? | Cost & Budget, Business Flex budget/routing summaries |
| Operations | Is the system healthy and connected? | Live Feed, Alerts & Guardrails, Team & Presence, Team & Layers, Environment & Integrations, Diagnostics |

Global controls:

- Product/repository identity
- Project selector
- Run selector
- Data freshness and transport state
- Command palette/search
- Compact mobile navigation drawer

## Signature interaction: Proof Rail

The Overview and Run Workspace share one horizontal/vertical rail:

`Goal → Stage → Current condition → Proof coverage → Next action`

Each stage node contains:

- canonical stage name and order
- state: `not_started`, `in_progress`, `passed`, `failed`, `blocked`, `unknown`
- proof coverage: attached/expected, with `not evaluated` when expectation is unavailable
- primary blocker or decision, if present
- owner/agent and elapsed time
- deep link to artifacts/events

The rail is not a decorative progress stepper. A stage cannot show `passed` unless the underlying state declares pass, and proof coverage cannot show complete unless the expected evidence contract is known.

## Screen contracts

### Overview

Above the fold:

1. Scope and freshness bar
2. Outcome banner with one of `Blocked`, `At risk`, `On track`, `Unknown`, `No active run`
3. Plain-language next action
4. Proof Rail
5. Action Inbox preview

Secondary modules:

- active/recent runs
- evidence coverage
- cost against enforced cap
- operational health

No-data state:

- title: `No delivery run has been evaluated`
- explain what is configured (profile, budget, integrations) separately from what has executed
- actions: view setup diagnostics, copy first-run command, open configuration documentation
- readiness remains `Unknown`, never `Ready`

### Run Workspace

One route with tabs or segmented sections:

- Summary: goal, status, Proof Rail, current task, next action
- Work: task/agent activity and validation results
- Timeline: ordered domain events with timezone-aware timestamps
- Artifacts: plans, reports, evidence, files, and safe preview
- Metrics: duration, tokens, cost, provenance, retry/restore information

The URL retains `run=<id>` and every tab preserves the same scope.

### Action Inbox

Normalize approvals, decisions, guardrail blocks, failed validations, retry exhaustion, and configuration errors into one queue contract:

- severity and action type
- plain-language title and consequence
- project/run/stage/task scope
- owner/approver
- created time and age
- source record/artifact
- allowed action(s), with authentication/audit requirements
- resolution state

Filters: `Needs me`, `Blocking`, `Approvals`, `Decisions`, `Failures`, `Resolved`.

### Evidence Center

Default view is a traceability matrix from requirement to implementation/test/security/compliance proof. Every cell is tri-state:

- Verified — source record exists and passed
- Failed/Blocked — source exists and is negative
- Unknown/Not evaluated — source or expected coverage is absent

The readiness verdict is a projection of this evidence model, not a second independent formula in the browser.

### Spend

Separate configured policy from observed consumption:

- configured run/day/month caps, root, and config freshness
- current/selected run spend and token usage
- actual vs planned
- metrics provenance: persisted, events-derived, or unavailable
- stage/task drivers
- warning thresholds and exhausted state

### Operations

Group system health by what the operator can do:

- runtime transport/freshness
- integrations/environment
- guardrails and diagnostics
- checkpoint/retry/context-pressure history
- agent/team presence
- raw live feed as a secondary view

## Real-data mapping

| UI concept | Current real source | Required normalization |
| --- | --- | --- |
| Project identity | `sourceRoots`, registry roots, git/worktree paths | canonical repo root/name plus optional worktree badge |
| Run goal/state | `runs[].manifest`, tasks, timeline, totals | shared run summary/view model |
| Proof Rail | `stageMatrix`, tasks, validation, evidence, blocked gates | stage-level availability/proof contract |
| Action Inbox | `pendingApprovals`, `blockedGates`, `alerts`, decisions, diagnostics | normalized actionable item schema |
| Readiness | tasks, approvals/gates, evidence, alerts | server-owned tri-state verdict with coverage |
| Profile | `.rstack/rstack.config.json`, run profile snapshot | root configuration summary plus run snapshot |
| Budget | `.rstack/budget.json`, `loopBudgets`, run budget policy | project policy separate from run consumption |
| Cost/tokens | metrics or events, `metricsSource` | always show provenance and unavailable state |
| Timeline | run timeline/feed/events | normalized timezone-aware event view |
| Artifacts | artifact index/reports/evidence | source-linked safe preview and type/status metadata |

## Proposed visual system for Figma v1

This is a proposal to be validated, not the current code token set.

- Canvas: `#F7F9FC`
- Surface: `#FFFFFF`
- Ink: `#142033`
- Muted text: `#637083`
- Signal/interaction: `#2F6BFF`
- Verified: `#187A50`
- Review/warning: `#B76700`
- Blocked/failure: `#B93832`
- Border: `#DCE3ED`
- Type: Inter for UI; Roboto Mono for identifiers/telemetry in the concept file
- Base spacing: 4px; primary rhythm 8/12/16/24/32
- Radii: 8px controls, 12px panels, pill only for compact state labels
- Minimum body text: 13px desktop and 14px mobile

Current code colors (`styles.js:5-16`) and system font (`styles.js:22`) remain implementation truth until the visual-system issue is accepted.

## Figma Phase 0 gap analysis and v1 scope

### Discovery result

- No Figma URL or existing product design file was supplied.
- No Code Connect files or `figma.connect` mappings were found in the repository.
- No reusable Figma component/variable library can be inspected until a new editable file exists.
- The authenticated Figma account is `gunderichardson` on a Starter team with a View seat. File creation/edit capability must be confirmed by the first approved mutation.
- Current code tokens are documented above; the proposed Figma palette/type choices are deliberately marked as a future implementation change.

### Approved design intent represented in v1

After the required mutation checkpoint, the first concept file should contain:

1. Foundations — proposed colors, type, spacing, radii, elevation, and semantic states
2. Components — app rail, context/scope bar, status badge, outcome banner, Proof Rail node, action item, evidence cell, run card, metric/provenance card, buttons, tabs, empty/stale states
3. Overview / desktop — active/blocked concept using the new information hierarchy
4. Overview state matrix — no-run/unknown, blocked, stale, and ready-with-complete-evidence variants
5. Action Inbox / desktop — normalized blocking and approval queue
6. Mobile shell — 390px Overview and navigation/scope treatment
7. Issue map — annotations that connect screen regions to the GitHub backlog

Repeated patterns must be real Figma components/variants bound to variables before the composed screens are assembled.

### Issue-to-screen map

| Issue | Design coverage in v1 |
| --- | --- |
| #93 | Outcome banner and no-data/blocked/ready state rules |
| #276 | Canonical project/worktree scope bar and timezone display |
| #277 | Configured policy/no-telemetry summary card |
| #278 | Six-destination desktop shell and mobile drawer/scope treatment |
| #279 | Overview hierarchy and Proof Rail |
| #280 | Component foundations only; full Run Workspace follows after the shared run schema |
| #281 | Action Inbox desktop concept and Overview preview |
| #282 | Evidence cell/coverage component foundations only |
| #283 | Policy/consumption/provenance component foundations only |
| #284 | Freshness/operational-health component foundations only |
| #285 | Security annotations only; no enabled state-changing control in v1 |

### Phase 0 gaps that implementation must resolve

- Readiness, scope, configured policy, and normalized action schemas are not yet stable shared contracts.
- The current 21-page shell has no compatibility map to the six destinations.
- Mobile scope is hidden rather than transformed into an accessible compact control.
- Existing UI tokens are implementation-local CSS values, not a documented/bound design-token system.
- No Code Connect mapping exists to keep later Figma components synchronized with dashboard code.

## Accessibility and responsive contract

- WCAG 2.2 AA contrast for text, borders that convey state, and all interactive states
- 44×44px minimum pointer target on mobile
- keyboard navigation and visible focus for every interactive element
- state is never conveyed by color alone
- `aria-current`, live freshness messaging, meaningful headings, labeled tables, and dialog focus management
- desktop: persistent side rail at ≥1200px; compact rail/tablet treatment at 768–1199px
- mobile: top app bar + drawer, sticky scope strip, one-column modules, cards instead of horizontally scrolling critical tables
- scope selectors must never disappear; they may collapse into an accessible sheet/drawer

## Analytics and success measures

Instrument without collecting sensitive prompt/artifact contents:

- time from landing to first blocker/next-action open
- action-inbox item opened/resolved
- run-to-artifact and readiness-to-source transitions
- scope changes and scope mismatch errors
- no-data setup action completion
- mobile navigation completion

Success targets after baseline measurement:

- reduce median clicks to reach the primary blocker by 50%
- zero cases where no-run/no-evidence state renders Ready/100%
- 100% of visible scoped aggregates covered by scope-contract tests
- all six destinations usable at 390px without hidden scope or critical horizontal overflow

## Rollout strategy

1. Fix truth defects and establish shared view models before visual restructuring.
2. Add the six-destination shell behind a feature flag while existing deep links remain available.
3. Move Overview, Run Workspace, and Action Inbox first.
4. Consolidate Evidence, Spend, and Operations after their normalized state contracts land.
5. Remove legacy navigation entries only after parity checks, browser tests, and documentation updates.

## Non-goals for v1

- Replacing `.rstack` as the source of truth
- Adding unauthenticated state-changing controls
- Hiding raw diagnostics or artifacts from advanced operators
- Treating Figma sample values as runtime fixtures
- Rewriting the dashboard framework solely for visual reasons
