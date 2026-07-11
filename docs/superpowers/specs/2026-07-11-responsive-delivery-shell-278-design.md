<!-- owner: RStack developed by Richardson Gunde -->

# Responsive Delivery Shell Design (#278)

## Outcome

Replace the 21-item primary navigation with six delivery-intent destinations:
Overview, Runs, Evidence, Decisions, Spend, and Operations. Keep every existing
page renderer and page ID available as a destination-local secondary view while
the later consolidation issues establish parity.

This design implements issue #278 on top of the canonical server-owned scope
contract delivered by #276. It deliberately does not change dashboard state
semantics, backend actions, or page content.

## Coordination boundaries

- Claude Office owns #221 in `state/rollup-index.js` and related state tests.
- Claude Main owns #222 in validation and harness contracts.
- Codex owns #278 in dashboard navigation, shell markup, shell styling, and
  navigation-focused tests.
- The branches have no intended file overlap.
- Destination badges stay absent unless a normalized scoped Action Inbox source
  from #281 exists. The shell must not derive its own actionable-count formula.

## Chosen approach

Use one declarative navigation model that owns destination labels, icons,
default pages, secondary legacy pages, and compatibility mapping. Render all
desktop, tablet, and mobile navigation from that model and let the browser
router update both destination and secondary-page state.

Alternatives rejected:

1. Merely regroup the 21 links under six headings. This still presents 21 equal
   choices and does not solve mobile navigation cost.
2. Remove or merge legacy renderers immediately. That couples #278 to the later
   Overview, Run Workspace, Evidence, Spend, and Operations parity work.
3. Maintain separate desktop and mobile navigation models. That creates routing
   drift and makes deep-link compatibility harder to prove.

## Information architecture

| Destination | Default page | Destination-local secondary pages |
| --- | --- | --- |
| Overview | `command` | Command Center |
| Runs | `projects` | Projects & Runs, Workflow Map, Run Analytics, Studio, Agent Work |
| Evidence | `release-readiness` | Release Readiness, Requirements & Traceability, Run Report, Security, Compliance |
| Decisions | `approvals` | Approvals, Decisions / Readiness, Alerts & Guardrails |
| Spend | `business-flex` | Business Flex, Cost & Budget |
| Operations | `live-feed` | Live Feed, Team & Presence, Team & Layers, Environment & Integrations, Diagnostics |

Every one of the 21 page IDs appears exactly once. This is a migration layer,
not a content consolidation.

## Layout and visual direction

The shell uses a restrained “delivery spine”: six meaningful line icons on a
quiet navigation rail, with a strong vertical active marker. Numeric internal
page codes are removed from navigation. The existing white/slate/blue product
palette remains so this work feels native to Business Hub rather than a visual
rebrand.

Desktop (above 1100px):

```text
┌──────────────────────┬──────────────────────────────────────────────┐
│ RSTACK               │ Page title  Project  Run  Freshness Actions│
│                      ├──────────────────────────────────────────────┤
│ ▣ Overview           │                                              │
│   Command Center     │                  page                        │
│ ▷ Runs               │                 content                      │
│ ◇ Evidence           │                                              │
│ ! Decisions          │                                              │
│ $ Spend              │                                              │
│ ⚙ Operations         │                                              │
└──────────────────────┴──────────────────────────────────────────────┘
```

Tablet (701px–1100px):

```text
┌────────┬───────────────────────────────────────────────────────────┐
│ R      │ Page title / freshness                                   │
│ ▣      │ Project and run scope                                    │
│ ▷      ├───────────────────────────────────────────────────────────┤
│ ◇      │                                                           │
│ !      │                        content                            │
│ $      │                                                           │
│ ⚙      │                                                           │
└────────┴───────────────────────────────────────────────────────────┘
```

The active destination exposes its secondary views in a compact flyout-like
panel attached to the rail. Labels remain available to assistive technology.

Mobile (700px and below, verified at 390px):

```text
┌──────────────────────────────────────┐
│ ☰  RStack               freshness   │
│ Project             Run             │
│ scope provenance / worktree          │
├──────────────────────────────────────┤
│                                      │
│              page content            │
│                                      │
└──────────────────────────────────────┘

Menu open:
┌──────────────────────────┐░░░░░░░░░░░
│ Navigate             ×   │░ overlay ░
│ ▣ Overview               │░░░░░░░░░░░
│   Command Center         │
│ ▷ Runs                   │
│   Projects & Runs        │
│   Workflow Map           │
│   …                      │
└──────────────────────────┘
```

The collapsed menu never precedes content in document flow. The persistent
context bar carries project, run, worktree context, and freshness outside the
drawer.

## Navigation and compatibility behavior

- Clicking a destination opens its default page and exposes its secondary
  views.
- Clicking a secondary view changes only the page; it retains project/run
  scope and marks its parent destination active.
- `showPage(<legacy-page-id>)` remains the public compatibility entry point for
  existing inline actions.
- The router accepts `#page=<legacy-page-id>`, `?<page=>` when supplied, and a
  direct legacy hash such as `#security`.
- The existing `#run=<opaque-scope-key>` format remains valid. Page and run hash
  parameters can coexist without either erasing the other.
- Back and forward navigation restores the destination, secondary page, and
  preserved scope.
- Unknown page IDs resolve honestly to the Overview default without throwing.

## Accessibility and interaction

- Exactly six controls carry the primary-destination role.
- Active destination and active secondary view use shape, weight, marker, and
  `aria-current`, not color alone.
- Mobile menu button exposes `aria-expanded` and `aria-controls`.
- The mobile drawer is a labelled modal dialog.
- Opening moves focus to the drawer; closing returns focus to the opener.
- `Escape` closes the drawer. `Tab` and `Shift+Tab` cycle inside it.
- Selecting a secondary page closes the mobile drawer and returns focus to the
  menu button without moving focus behind an overlay.
- All interactive targets are at least 44 by 44 CSS pixels at mobile sizes.
- Focus indicators remain visible, and reduced-motion preferences disable
  drawer and active-marker transitions.

## Data and badges

The shell consumes only existing state and scope behavior. It does not add a
backend contract. No destination badge is shown from `alerts`,
`pendingApprovals`, or `blockedGates` independently because those collections
do not yet form the normalized Action Inbox contract required by #281.

When #281 ships, it can attach its single scoped count source to the declarative
navigation model without changing shell structure.

## Failure handling

- Missing or malformed route values fall back to Overview.
- Missing secondary page DOM does not leave the shell blank; Overview activates.
- Drawer close is idempotent.
- Scope reset messages and stale/disconnected freshness behavior remain owned by
  #276 and are never hidden by navigation state.

## Verification

Automated tests must prove:

- exactly six primary destinations;
- all 21 legacy IDs map exactly once and remain rendered;
- old and new deep links resolve correctly while preserving run scope;
- `showPage()` activates the correct parent destination;
- normalized badge absence does not trigger a fabricated count;
- mobile drawer ARIA, focus trap, Escape, close, and focus return;
- desktop, tablet, and 390px CSS contracts including 44px targets;
- the complete client bundle remains valid and all page modules register;
- lint, typecheck, dashboard-focused tests, and full `npm test` pass.

Browser evidence in the PR will include 1440px, 1024px, 768px, and 390px
captures plus keyboard-only notes and representative legacy deep-link checks.

## Self-review

The model assigns every legacy page once, names a default for every destination,
preserves the canonical scope contract, and avoids a competing actionable-count
formula. No renderer removal, state-changing control, backend mutation, or
unrelated page redesign is included.
