<!-- owner: RStack developed by Richardson Gunde -->

# Responsive Delivery Shell (#278) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 21-item primary dashboard navigation with a six-destination responsive shell while preserving every legacy page, deep link, scope selection, and freshness signal.

**Architecture:** A new declarative navigation module owns the six destinations and the one-to-one legacy-page mapping. Server-rendered desktop/mobile markup and a plain-JavaScript router consume that model, while existing page renderers remain unchanged. CSS provides persistent desktop, compact tablet, and focus-trapped mobile navigation without adding dependencies or backend state.

**Tech Stack:** Node.js ESM, server-rendered HTML, dependency-free browser JavaScript, CSS media queries, `node:test`, existing Business Hub browser runtime.

## Global Constraints

- Keep all 21 legacy page IDs and renderers addressable until their consolidation issues verify parity.
- Use exactly six primary labels: Overview, Runs, Evidence, Decisions, Spend, Operations.
- Preserve the canonical project/run scope and freshness contract delivered by #276.
- Do not derive destination badge counts from independent alerts, approvals, or guardrail formulas; #281 owns the future normalized source.
- Do not add state-changing controls, dependencies, or a dashboard framework.
- Use plain-language labels and meaningful line icons; internal numeric page codes are not navigation icons.
- Meet 44x44px mobile targets, visible focus, focus containment/return, Escape close, `aria-expanded`, `aria-controls`, and `aria-current`.
- Verify desktop, tablet, 768px, and 390px layouts with no critical overflow.

---

### Task 1: Declarative six-destination model

**Files:**
- Create: `src/observability/dashboard/ui/navigation.js`
- Modify: `src/observability/dashboard/ui/pages/index.js`
- Create: `tests/dashboard-navigation.test.js`

**Interfaces:**
- Consumes: existing legacy page IDs and labels from `pages/index.js`.
- Produces: `destinations`, `pages`, `pageToDestination`, `destinationForPage(pageId)`, `desktopNavigationMarkup()`, and `mobileNavigationMarkup()`.

- [ ] **Step 1: Write the failing model tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  destinations,
  pages,
  destinationForPage,
} from '../src/observability/dashboard/ui/navigation.js';

test('six intent destinations cover every legacy page exactly once', () => {
  assert.deepEqual(destinations.map((item) => item.label), [
    'Overview', 'Runs', 'Evidence', 'Decisions', 'Spend', 'Operations',
  ]);
  const childIds = destinations.flatMap((item) => item.children.map((child) => child.id));
  assert.equal(childIds.length, 21);
  assert.equal(new Set(childIds).size, 21);
  assert.deepEqual(new Set(childIds), new Set(pages.map(([id]) => id)));
});

test('legacy pages resolve to a destination and defaults are valid children', () => {
  for (const destination of destinations) {
    assert.ok(destination.children.some((child) => child.id === destination.defaultPage));
    for (const child of destination.children) {
      assert.equal(destinationForPage(child.id).id, destination.id);
    }
  }
  assert.equal(destinationForPage('unknown').id, 'overview');
});
```

- [ ] **Step 2: Run the tests and confirm the missing-module failure**

Run: `node --test tests/dashboard-navigation.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `ui/navigation.js`.

- [ ] **Step 3: Implement the navigation model**

Create six frozen destination records with the mapping in the approved design.
Each record contains `{ id, label, icon, defaultPage, children, badgeSource: null }`.
Export the legacy tuple shape for compatibility:

```js
export const pages = destinations.flatMap((destination) =>
  destination.children.map((child) => [child.id, child.icon, child.label, destination.label]),
);

export function destinationForPage(pageId) {
  return pageToDestination[pageId] || destinations[0];
}
```

Move the old `pages` constant out of `pages/index.js`, import it from
`navigation.js`, and re-export it so existing imports do not break.

- [ ] **Step 4: Run the focused model tests**

Run: `node --test tests/dashboard-navigation.test.js`

Expected: PASS for both mapping tests.

- [ ] **Step 5: Run the existing module contract tests**

Run: `node --test tests/dashboard-client-modules.test.js`

Expected: the historical `NAV_IDS.length === 21` and every page-module registration remain PASS.

- [ ] **Step 6: Commit the model**

```bash
git add src/observability/dashboard/ui/navigation.js src/observability/dashboard/ui/pages/index.js tests/dashboard-navigation.test.js
git commit -m "feat(dashboard): define six delivery destinations (#278)"
```

### Task 2: Render the responsive shell from one model

**Files:**
- Modify: `src/observability/dashboard/ui/navigation.js`
- Modify: `src/observability/dashboard/ui/pages/index.js`
- Modify: `src/observability/dashboard/ui/index.js`
- Modify: `tests/dashboard-navigation.test.js`
- Modify: `tests/dashboard-client-modules.test.js`

**Interfaces:**
- Consumes: `destinations` from Task 1.
- Produces: desktop `<nav id="primary-navigation">`, mobile menu button, mobile overlay, and `<aside id="mobile-navigation">` using identical destination/child IDs.

- [ ] **Step 1: Add failing markup assertions**

```js
test('shell renders six primary controls and 21 secondary legacy controls', () => {
  const html = dashboardHtml(3008);
  assert.equal((html.match(/class="destination-link/g) || []).length, 12);
  assert.equal((html.match(/class="secondary-link/g) || []).length, 42);
  assert.equal((html.match(/data-primary-destination=/g) || []).length, 12);
  assert.match(html, /id="mobile-nav-toggle"[^>]*aria-expanded="false"[^>]*aria-controls="mobile-navigation"/);
  assert.match(html, /id="mobile-navigation" role="dialog" aria-modal="true" aria-labelledby="mobile-nav-title"/);
});
```

The counts are doubled because desktop and mobile render from the same model;
only one surface is visible at a time.

- [ ] **Step 2: Run the markup tests and confirm failure**

Run: `node --test tests/dashboard-navigation.test.js tests/dashboard-client-modules.test.js`

Expected: FAIL because destination and mobile navigation markup do not exist.

- [ ] **Step 3: Implement shared destination markup**

In `navigation.js`, implement a private `navigationGroups(surface)` that returns
six destination buttons and their child lists. Use inline SVG with
`aria-hidden="true"`, `aria-current="page"` only on the active initial child,
and `aria-expanded`/`aria-controls` on each destination control.

Export:

```js
export function desktopNavigationMarkup() {
  return `<nav id="primary-navigation" class="destination-nav" aria-label="Business Hub destinations">${navigationGroups('desktop')}</nav>`;
}

export function mobileNavigationMarkup() {
  return `<div id="mobile-nav-overlay" aria-hidden="true"></div>
    <aside id="mobile-navigation" role="dialog" aria-modal="true" aria-labelledby="mobile-nav-title" aria-hidden="true">
      <header class="mobile-nav-head"><h2 id="mobile-nav-title">Navigate</h2><button id="mobile-nav-close" aria-label="Close navigation">×</button></header>
      <nav aria-label="Business Hub mobile destinations">${navigationGroups('mobile')}</nav>
    </aside>`;
}
```

- [ ] **Step 4: Replace the old shell markup**

In `index.js`, replace `sidebarMarkup()` with `desktopNavigationMarkup()`, add
the mobile toggle before the page title, and append `mobileNavigationMarkup()`
after `#shell`. Keep scope, freshness, page markup, and the run-details drawer
in their existing ownership positions.

- [ ] **Step 5: Run markup and module tests**

Run: `node --test tests/dashboard-navigation.test.js tests/dashboard-client-modules.test.js`

Expected: PASS with six destination groups per surface and all legacy sections still present.

- [ ] **Step 6: Commit shell markup**

```bash
git add src/observability/dashboard/ui/navigation.js src/observability/dashboard/ui/pages/index.js src/observability/dashboard/ui/index.js tests/dashboard-navigation.test.js tests/dashboard-client-modules.test.js
git commit -m "feat(dashboard): render the responsive delivery shell (#278)"
```

### Task 3: Compatibility router and accessible mobile drawer

**Files:**
- Modify: `src/observability/dashboard/ui/navigation.js`
- Modify: `src/observability/dashboard/ui/client.js`
- Modify: `tests/dashboard-navigation.test.js`
- Modify: `tests/dashboard-scope-client.test.js`

**Interfaces:**
- Consumes: `destinationForPage`, `pageToDestination`, the existing `SCOPE`, and `showPage()` callers.
- Produces: `navigationScript`, browser functions `showDestination`, `showPage`, `openMobileNavigation`, `closeMobileNavigation`, `readDashboardRoute`, and `writeDashboardRoute`.

- [ ] **Step 1: Add failing router and accessibility assertions**

```js
test('client keeps legacy routing and mobile focus containment', () => {
  const bundle = clientScript(3008);
  assert.match(bundle, /function readDashboardRoute\(\)/);
  assert.match(bundle, /function writeDashboardRoute\(pageId, runKey, mode\)/);
  assert.match(bundle, /function showDestination\(destinationId/);
  assert.match(bundle, /function openMobileNavigation\(\)/);
  assert.match(bundle, /function closeMobileNavigation\(opts\)/);
  assert.match(bundle, /event\.key === 'Tab'/);
  assert.match(bundle, /MOBILE_NAV_RETURN_FOCUS/);
  assert.match(bundle, /window\.addEventListener\('popstate'/);
});

test('run scope hash writes preserve the current legacy page', () => {
  const bundle = clientScript(3008);
  assert.match(bundle, /writeDashboardRoute\(ACTIVE_PAGE, value/);
  assert.doesNotMatch(bundle, /history\.replaceState\(null, '', value \? '#run='/);
});
```

- [ ] **Step 2: Run the focused tests and confirm failure**

Run: `node --test tests/dashboard-navigation.test.js tests/dashboard-scope-client.test.js`

Expected: FAIL on the missing router and mobile-drawer functions.

- [ ] **Step 3: Implement the generated navigation runtime**

Export `navigationScript` from `navigation.js`. Inject serializable destination
and compatibility maps into the returned template string. The runtime must:

```js
function showPage(pageId, opts) {
  var resolvedPage = PAGE_TO_DESTINATION[pageId] ? pageId : DEFAULT_PAGE;
  var destinationId = PAGE_TO_DESTINATION[resolvedPage];
  ACTIVE_PAGE = resolvedPage;
  ACTIVE_DESTINATION = destinationId;
  // Toggle destination, secondary, page, aria-current, title, and child group state.
  if (!opts || opts.history !== false) writeDashboardRoute(resolvedPage, SCOPE.run, 'push');
  resetDashboardScroll();
}
```

`readDashboardRoute()` must accept `#page=security&run=<key>`, `#security`, and
`?page=security`. `writeDashboardRoute()` must retain page and run parameters
and use push or replace state as requested.

- [ ] **Step 4: Wire mobile focus and keyboard behavior**

Opening stores `document.activeElement`, marks the panel/overlay open, updates
`aria-expanded`, removes panel `aria-hidden`, and focuses its first destination.
Closing reverses those states and returns focus unless `{ returnFocus: false }`.
The panel `keydown` handler closes on Escape and loops Tab/Shift+Tab between its
first and last enabled focusable controls.

Secondary mobile links call `showPage()` then close the drawer. Destination
buttons call `showDestination()` and expose their secondary group.

- [ ] **Step 5: Preserve page state in the scope router**

Replace the three direct `history.replaceState` hash writes in `client.js` with
`writeDashboardRoute(ACTIVE_PAGE, runKey, 'replace')`. Resolve legacy run IDs
from `readDashboardRoute().run`, bootstrap the requested page after event
listeners are connected, and restore it on `popstate`.

- [ ] **Step 6: Run router, scope, and bundle tests**

Run: `node --test tests/dashboard-navigation.test.js tests/dashboard-scope-client.test.js tests/dashboard-client-modules.test.js`

Expected: PASS and the generated bundle compiles with no literal closing script tag.

- [ ] **Step 7: Commit routing and interaction**

```bash
git add src/observability/dashboard/ui/navigation.js src/observability/dashboard/ui/client.js tests/dashboard-navigation.test.js tests/dashboard-scope-client.test.js
git commit -m "feat(dashboard): preserve legacy routes in the new shell (#278)"
```

### Task 4: Desktop, tablet, and mobile styling

**Files:**
- Modify: `src/observability/dashboard/ui/styles.js`
- Modify: `tests/dashboard-navigation.test.js`

**Interfaces:**
- Consumes: shell classes and IDs from Tasks 2–3.
- Produces: 236px desktop rail, 84px tablet rail, mobile top bar/drawer, active delivery-spine marker, visible focus, reduced motion, and overflow-safe scope controls.

- [ ] **Step 1: Add failing responsive CSS assertions**

```js
test('shell has persistent desktop, compact tablet, and 390px mobile contracts', () => {
  assert.match(styles, /#shell\s*\{[^}]*grid-template-columns:\s*236px minmax\(0, 1fr\)/);
  assert.match(styles, /@media \(max-width: 1100px\)[\s\S]*grid-template-columns:\s*84px minmax\(0, 1fr\)/);
  assert.match(styles, /@media \(max-width: 700px\)[\s\S]*#mobile-nav-toggle[^}]*display:\s*grid/);
  assert.match(styles, /@media \(max-width: 700px\)[\s\S]*\.destination-link[^}]*min-height:\s*44px/);
  assert.match(styles, /:focus-visible/);
  assert.match(styles, /@media \(prefers-reduced-motion:\s*reduce\)/);
});
```

- [ ] **Step 2: Run the test and confirm failure**

Run: `node --test tests/dashboard-navigation.test.js`

Expected: FAIL because the new breakpoints/classes are not styled.

- [ ] **Step 3: Implement the delivery-spine visual system**

Retain existing color tokens. Add styles for `.destination-link`,
`.destination-icon`, `.secondary-nav`, and `.secondary-link`. Use a 3px active
marker plus filled background and font weight so active state is not color-only.
Remove the old numeric `.nav-icon` presentation.

- [ ] **Step 4: Implement responsive states**

- Above 1100px: 236px persistent rail, labels visible, only active secondary group expanded.
- 701–1100px: 84px rail, icon-first destination controls, accessible labels visually clipped, active secondary group shown in an anchored panel that does not resize content.
- 700px and below: one-column shell, desktop rail hidden, mobile toggle visible, 320px/max-88vw sliding modal drawer, overlay, scope controls in two columns, content in normal flow before drawer markup.
- At 390px: all navigation controls and scope selects are at least 44px high; no `100vw` widths or fixed content minimums introduce horizontal overflow.

- [ ] **Step 5: Add focus and reduced-motion rules**

Use a 2px solid outline with 2px offset for destination, secondary, menu, close,
and scope controls. Disable navigation transitions when reduced motion is set.

- [ ] **Step 6: Run navigation and scope responsive tests**

Run: `node --test tests/dashboard-navigation.test.js tests/dashboard-scope-client.test.js`

Expected: PASS for shell, mobile targets, and scope visibility.

- [ ] **Step 7: Commit responsive styling**

```bash
git add src/observability/dashboard/ui/styles.js tests/dashboard-navigation.test.js
git commit -m "feat(dashboard): adapt the delivery shell across viewports (#278)"
```

### Task 5: Browser evidence and production verification

**Files:**
- Modify: `docs/superpowers/plans/2026-07-11-responsive-delivery-shell-278.md` only to check completed steps.

**Interfaces:**
- Consumes: completed shell and local Business Hub server.
- Produces: verified responsive/keyboard/deep-link evidence for the draft PR.

- [ ] **Step 1: Run focused dashboard tests**

Run: `node --test tests/dashboard-navigation.test.js tests/dashboard-client-modules.test.js tests/dashboard-scope-client.test.js`

Expected: all focused tests PASS.

- [ ] **Step 2: Run static gates**

Run: `npm run lint`

Expected: exit 0.

Run: `npm run typecheck`

Expected: exit 0.

- [ ] **Step 3: Run the complete test suite**

Run: `npm test`

Expected: exit 0 with no failing tests.

- [ ] **Step 4: Inspect four responsive widths in the real dashboard**

Start: `node bin/rstack-business.js --port 3018 --project . --no-browser`

At 1440, 1024, 768, and 390px verify:

- exactly six primary destinations;
- the active secondary group is understandable;
- scope and freshness remain visible;
- no horizontal overflow;
- mobile content renders before the closed menu;
- mobile targets measure at least 44px.

- [ ] **Step 5: Run the keyboard checklist**

At 390px: Tab to menu, Enter to open, cycle Tab and Shift+Tab, open a
destination, select a secondary page, reopen, press Escape, and confirm focus
returns to the menu button. Confirm active state remains distinguishable with
grayscale/color ignored.

- [ ] **Step 6: Verify compatibility routes**

Open `#security`, `#page=cost-budget`, `#page=diagnostics&run=<valid-key>`, and
an unknown page. Confirm the first three select the correct parent destination,
scope remains intact, Back/Forward restores state, and the unknown page falls
back to Overview.

- [ ] **Step 7: Run final hygiene checks and commit evidence updates**

Run: `git diff --check`

Expected: no output and exit 0.

Run: `git status --short`

Expected: only the checked plan file before the evidence commit.

```bash
git add docs/superpowers/plans/2026-07-11-responsive-delivery-shell-278.md
git commit -m "test(dashboard): verify responsive delivery navigation (#278)"
```

- [ ] **Step 8: Push and open the draft PR**

Push `codex/ui-shell-278`, open a draft PR targeting `main`, include `Closes #278`,
link #317/#321 as merged foundations, cite the #278 coordination comment, and
attach responsive, keyboard, route, and test evidence. Leave #278 open until the
PR is merged.

## Plan self-review

- Tasks cover the complete model, all shell surfaces, legacy routing, scope
  coexistence, accessibility, styling, responsive QA, and full verification.
- File responsibilities and interface names are consistent across tasks.
- Every code-changing task starts with a failing test and ends with a focused
  passing test plus a commit.
- The plan contains no renderer deletion, backend action, badge formula, new
  dependency, or file overlap with #221/#222.

## Execution evidence

Completed on branch `codex/ui-shell-278` on 2026-07-11.

- Navigation model: six primary destinations, all 21 legacy page IDs mapped
  exactly once, and no independent actionable badge formula.
- Responsive browser proof: 236px rail at 1440; 84px rail at 1024 and 768;
  mobile drawer at 390; project/run controls remained 44px high; no measured
  horizontal overflow at any audited width.
- Mobile keyboard proof: opening focused Overview; Shift+Tab from Close wrapped
  to Operations; Tab from Operations wrapped to Close; Escape closed the modal
  and returned focus to `mobile-nav-toggle`.
- Route proof: `#security`, `#page=cost-budget`, and
  `#page=diagnostics&run=missing-run` selected Evidence, Spend, and Operations;
  an unknown page fell back to Overview; Back/Forward restored the route.
- Browser-discovered regression: the Overview mission card retained a desktop
  two-column grid at 390px. A failing CSS contract test preceded the fix; the
  final main column measured 306px within a 375px content area.
- Focused dashboard tests: 21/21 passed.
- Full suite after integrating latest `main` (#222 and #324): 1,064/1,064 passed.
- Lint: exit 0 with one pre-existing `tests/papercuts-299.test.js` warning and
  zero errors.
- Typecheck: exit 0.
- Agent validation: 196/196 passed.
- `git diff --check`: clean.
