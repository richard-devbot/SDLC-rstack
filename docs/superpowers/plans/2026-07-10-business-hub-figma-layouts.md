<!-- owner: RStack developed by Richardson Gunde -->

# Business Hub Figma Layouts Implementation Plan

> **For Codex:** REQUIRED SKILLS: use `figma-create-new-file`, `figma-use`, `figma-generate-library`, and `figma-generate-design` sequentially. Do not mutate backend or runtime dashboard files while executing this plan.

**Goal:** Build a validated Figma v1 concept that compares the current Business Hub with an evidence-first six-destination delivery cockpit and maps every design region to the UI backlog.

**Architecture:** Create a fresh Figma design file with variable-bound foundations first, then reusable components, then composed desktop/mobile views. Current UI screenshots and merged backend contracts are visual/data references only; unimplemented UI contracts are annotated and never presented as shipped.

**Tech Stack:** Figma Design, Figma variables/styles/components, Auto Layout, current server-rendered HTML/CSS/JavaScript dashboard as the implementation reference.

## Global Constraints

- UI/UX scope only; do not edit backend, harness, state, API, or active Cloud Code branch files.
- Current main is the implementation truth; PR #267–#272 and #300–#301 merged during discovery and their contracts are treated as shipped.
- No-data and incomplete evidence never render Ready or 100%.
- Primary navigation has exactly six destinations: Overview, Runs, Evidence, Decisions, Spend, Operations.
- Scope remains visible at 390px.
- All repeated visual patterns are Figma components/variants bound to scoped variables.
- Product font follows the current system UI stack; the Figma proxy is Inter only where the native system family cannot be used consistently.
- State-changing cockpit controls remain disabled/annotated in v1.

---

### Task 1: Current-state reference and issue map

**Inputs:**

- Current desktop screenshot: `business-hub-current-desktop.png`
- Current mobile screenshot: `business-hub-current-mobile.png`
- UX epic #273 and child issues #93, #96, #276–#285
- Merged UI PRs #216–#220, #240, #252, #258, #260

**Produces:** Figma pages `00 Cover & Map` and `01 Current UI`.

- [ ] Create the design file and inspect its blank structure.
- [ ] Place current desktop/mobile reference frames with annotations for navigation density, partial scoping, false-confidence risk, ambiguous timestamps, and hidden mobile scope.
- [ ] Add the six-destination issue map and backend-contract status legend: Shipped and UI contract required.
- [ ] Validate page names, reference dimensions, and annotation readability.

### Task 2: Foundations and variable system

**Produces:** variable collections `Primitives`, `Semantic Color`, `Spacing & Radius`, plus text/effect styles.

- [ ] Create raw color variables for canvas, surface, ink, muted, border, signal, verified, review, blocked, and neutral scales.
- [ ] Create semantic Light-mode aliases for background, surface, text, border, interaction, and status roles.
- [ ] Create spacing values 4, 8, 12, 16, 24, 32 and radii 8, 12, 999 with explicit scopes and CSS syntax.
- [ ] Create UI text styles for display, heading, title, body, label, caption, and telemetry; create panel elevation style.
- [ ] Document color, typography, spacing, radius, and status semantics on `02 Foundations`.
- [ ] Validate every scope, alias, code syntax, font family, and contrast-critical pairing.

### Task 3: Core reusable components

**Produces:** dedicated component pages and documented variants.

- [ ] Build `Navigation Item`: active/inactive, badge/no badge, desktop/compact.
- [ ] Build `Scope Control`: project/run/freshness variants and mobile compact treatment.
- [ ] Build `Status Badge`: Unknown, Active, Verified, Review, Blocked, Stale.
- [ ] Build `Button`: primary, secondary, quiet, danger; default/hover/focus/disabled.
- [ ] Build `Outcome Banner`: Unknown, On track, At risk, Blocked, Stale.
- [ ] Build `Proof Rail Node`: not started, in progress, passed, failed, blocked, unknown with evidence coverage.
- [ ] Build `Action Item`: approval, decision, guardrail, validation, retry, configuration; open/resolved/disabled.
- [ ] Build `Metric + Provenance Card`: available, zero, unavailable, stale.
- [ ] Build `Run Card`, `Evidence Cell`, `Tab`, and `Empty State`.
- [ ] Validate each component structurally and visually before moving to composed screens.

### Task 4: Desktop Overview

**Produces:** `03 Overview — Desktop` at 1440×1100.

- [ ] Compose six-destination rail and persistent scope/freshness bar.
- [ ] Add Blocked outcome banner using the real audited scenario: one guardrail gate, two alerts, one stalled run.
- [ ] Add a plain-language next action sourced from the pipeline recommendation.
- [ ] Add horizontal Proof Rail with current stage, blocked stage, evidence coverage, and source links.
- [ ] Add Active Delivery/Evidence column plus Action Inbox/Budget/Operations side column.
- [ ] Annotate every region with issue number and real source contract.
- [ ] Validate hierarchy, clipping, component-instance usage, and product font.

### Task 5: Truth-state matrix

**Produces:** `04 Overview — States`.

- [ ] Compose No run / Unknown with configured profile and budget but no execution telemetry.
- [ ] Compose Blocked with explicit source-linked gate and failed validation.
- [ ] Compose Stale with last-known values and mutation disabled.
- [ ] Compose Ready only with known required coverage and all required checks evaluated/passed.
- [ ] Validate that Unknown cannot visually or textually read as Ready/100%.

### Task 6: Action Inbox

**Produces:** `05 Decisions — Action Inbox` at 1440×1000.

- [ ] Compose filters: Needs me, Blocking, Approvals, Decisions, Failures, Resolved.
- [ ] Render normalized action instances with scope, owner, age, consequence, source, and safe primary action.
- [ ] Use the shipped terminal-approval rollup from PR #268 and annotate its documented completed-run refresh limitation.
- [ ] Show one-shot guardrail override lifecycle without adding a new backend mutation.
- [ ] Validate ordering, deduplication notes, focus state, and stale-data fail-closed treatment.

### Task 7: Mobile shell and Overview

**Produces:** `06 Mobile` with 390×844 frames.

- [ ] Compose top app bar, six-destination drawer, and sticky compact project/run scope.
- [ ] Stack Outcome, next action, vertical Proof Rail, Action Inbox, Evidence, Spend, and Operations in that order.
- [ ] Preserve 44×44 minimum touch targets and visible focus treatment.
- [ ] Add drawer open and scope-sheet states.
- [ ] Validate no critical horizontal overflow and no hidden scope.

### Task 8: Integration, issue mapping, and QA

**Produces:** final Figma URL, node/page inventory, and validated current-vs-proposed screenshots.

- [ ] Audit hardcoded fills/strokes/spacing/radii and replace them with variables.
- [ ] Audit naming, component instances, duplicate nodes, and unresolved placeholders.
- [ ] Validate UI contrast, focus visibility, non-color status cues, and 390px touch targets.
- [ ] Capture screenshots for Foundations, Components, Desktop Overview, state matrix, Action Inbox, and Mobile.
- [ ] Update `00 Cover & Map` with final issue-to-screen mapping and backend status legend.
- [ ] Add the final Figma link to epic #273 and relevant UI issues after validation.
