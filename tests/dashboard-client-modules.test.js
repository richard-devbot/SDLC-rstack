/**
 * Client bundle assembly (#95) — the dashboard client is split into per-page
 * modules concatenated at serve time. These tests pin the contract: every nav
 * page has a module in the served bundle, every module self-registers with
 * the page registry, and the single-request/no-build-step serving stance holds.
 *
 * owner: RStack developed by Richardson Gunde
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { dashboardHtml } from '../src/observability/dashboard/ui.js';
import { clientScript } from '../src/observability/dashboard/ui/client.js';
import { pages } from '../src/observability/dashboard/ui/pages/index.js';

const NAV_IDS = pages.map(([id]) => id);

test('served client bundle contains every page module', () => {
  const bundle = clientScript(3008);
  assert.equal(NAV_IDS.length, 21, 'nav registry lists all 21 pages');
  for (const id of NAV_IDS) {
    assert.match(bundle, new RegExp(`// ── page: ${id} `), `page module banner for "${id}" is in the bundle`);
    assert.match(bundle, new RegExp(`registerPage\\('${id}',`), `page "${id}" self-registers with the registry`);
  }
});

test('served bundle is syntactically valid JS and inline-script safe (#216 review F1)', () => {
  const bundle = clientScript(3008);
  // 20 page modules get edited in parallel and live inside template literals
  // that eslint cannot see into — a syntax error in any of them would pass
  // tests yet kill the whole dashboard at load. Compiling (not executing) the
  // bundle catches that here instead of in the browser.
  assert.doesNotThrow(() => new Function(bundle), 'assembled client bundle must compile');
  // The assembler does no escaping, so a literal </script anywhere in a module
  // would terminate the inline <script> tag mid-bundle and break the page.
  assert.ok(!bundle.includes('</script'), 'bundle must not contain a literal </script sequence');
});

test('bundle keeps the shared lib, drawer and core sections', () => {
  const bundle = clientScript(3008);
  assert.match(bundle, /── shared lib ─/);
  assert.match(bundle, /── run drawer ─/);
  assert.match(bundle, /── core: state, scope, router, transport ─/);
  assert.match(bundle, /function registerPage\(id, opts\)/);
  assert.match(bundle, /var PAGE_RENDERERS = \[\];/);
  // The core dispatches through the registry — no hard-coded per-page calls.
  assert.match(bundle, /PAGE_RENDERERS\.forEach/);
});

test('registry order matches the historical applyState render order', () => {
  const bundle = clientScript(3008);
  const order = [...bundle.matchAll(/registerPage\('([\w-]+)',/g)].map((m) => m[1]);
  assert.deepEqual(order, [
    'command', 'business-flex', 'studio', 'workflow', 'projects',
    'run-analytics', 'run-report', 'team', 'agent-work', 'live-feed',
    'approvals', 'decisions', 'release-readiness', 'security', 'compliance',
    'cost-budget', 'alerts-guardrails', 'traceability', 'team-layers', 'environment', 'diagnostics',
  ]);
});

test('shell and nav carry the ARIA + keyboard accessibility contract (#95)', () => {
  const html = dashboardHtml(3008);
  // Nav landmark, current-page marking (initial markup + runtime toggling).
  assert.match(html, /<nav id="primary-navigation" class="destination-nav" aria-label="Business Hub destinations">/);
  assert.match(html, /data-page="command" data-parent-destination="overview" aria-current="page"/);
  assert.match(html, /setAttribute\('aria-current', 'page'\)/);
  // Drawer is a labelled modal dialog with focus management and Esc close.
  assert.match(html, /id="drawer-panel" role="dialog" aria-modal="true" aria-labelledby="drawer-title"/);
  assert.match(html, /aria-label="Close run details"/);
  assert.match(html, /DRAWER_RETURN_FOCUS/);
  assert.match(html, /event\.key === 'Escape'/);
  // Errors announce; the live feed is a labelled log region.
  assert.match(html, /id="err" role="alert"/);
  assert.match(html, /id="live-feed-list" role="log" aria-label="Event stream"/);
  // Row-style clickables are keyboard reachable with delegated activation.
  assert.match(html, /class="clickable" tabindex="0"/);
  assert.match(html, /\.clickable\[tabindex\], \.workstation\[tabindex\]/);
  // Status badges get spoken labels, not just colored counts.
  assert.match(html, /setBadge\('badge-approvals', pending\.length, 'pending approvals'\)/);
});

test('dashboard HTML still ships the whole bundle in a single page load', () => {
  const html = dashboardHtml(3008);
  for (const id of NAV_IDS) {
    assert.match(html, new RegExp(`// ── page: ${id} `), `page module "${id}" served inline`);
  }
  // No module loader, no external bundle fetch — the no-build-step stance.
  assert.doesNotMatch(html, /<script src=/);
  assert.doesNotMatch(html, /import\s*\(/);
});
