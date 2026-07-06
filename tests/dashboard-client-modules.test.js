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
  assert.equal(NAV_IDS.length, 20, 'nav registry lists all 20 pages');
  for (const id of NAV_IDS) {
    assert.match(bundle, new RegExp(`// ── page: ${id} `), `page module banner for "${id}" is in the bundle`);
    assert.match(bundle, new RegExp(`registerPage\\('${id}',`), `page "${id}" self-registers with the registry`);
  }
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
    'cost-budget', 'alerts-guardrails', 'traceability', 'team-layers', 'diagnostics',
  ]);
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
