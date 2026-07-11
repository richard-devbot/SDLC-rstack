/**
 * Responsive delivery shell (#278): one declarative six-destination model
 * must cover every legacy dashboard page exactly once.
 *
 * owner: RStack developed by Richardson Gunde
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  destinations,
  pages,
  destinationForPage,
  formatDashboardHash,
  parseDashboardRoute,
} from '../src/observability/dashboard/ui/navigation.js';
import { dashboardHtml } from '../src/observability/dashboard/ui.js';
import { clientScript } from '../src/observability/dashboard/ui/client.js';

test('six intent destinations cover every legacy page exactly once', () => {
  assert.deepEqual(destinations.map((item) => item.label), [
    'Overview', 'Runs', 'Evidence', 'Decisions', 'Spend', 'Operations',
  ]);

  const childIds = destinations.flatMap((item) => item.children.map((child) => child.id));
  assert.equal(childIds.length, 21);
  assert.equal(new Set(childIds).size, 21);
  assert.deepEqual(new Set(childIds), new Set(pages.map(([id]) => id)));
});

test('legacy pages resolve to one destination and every default is a child', () => {
  for (const destination of destinations) {
    assert.ok(
      destination.children.some((child) => child.id === destination.defaultPage),
      `${destination.id} default belongs to the destination`,
    );
    for (const child of destination.children) {
      assert.equal(destinationForPage(child.id).id, destination.id);
    }
  }

  assert.equal(destinationForPage('unknown').id, 'overview');
});

test('shell renders desktop and mobile navigation from the same six-destination model', () => {
  const html = dashboardHtml(3008);

  assert.equal((html.match(/class="destination-link/g) || []).length, 12);
  assert.equal((html.match(/class="secondary-link/g) || []).length, 42);
  assert.equal((html.match(/data-primary-destination=/g) || []).length, 12);
  assert.match(
    html,
    /id="mobile-nav-toggle"[^>]*aria-expanded="false"[^>]*aria-controls="mobile-navigation"/,
  );
  assert.match(
    html,
    /id="mobile-navigation" role="dialog" aria-modal="true" aria-labelledby="mobile-nav-title"/,
  );
});

test('dashboard route parser accepts legacy and combined page/run links', () => {
  assert.deepEqual(
    parseDashboardRoute({ hash: '#security', search: '' }),
    { page: 'security', run: '' },
  );
  assert.deepEqual(
    parseDashboardRoute({ hash: '#page=diagnostics&run=run%3Aabc', search: '' }),
    { page: 'diagnostics', run: 'run:abc' },
  );
  assert.deepEqual(
    parseDashboardRoute({ hash: '#run=run-only', search: '?page=cost-budget' }),
    { page: 'cost-budget', run: 'run-only' },
  );
});

test('dashboard hash formatter preserves page and opaque run scope together', () => {
  assert.equal(
    formatDashboardHash({ pageId: 'security', runKey: 'run:abc/123' }),
    '#page=security&run=run%3Aabc%2F123',
  );
  assert.equal(formatDashboardHash({ pageId: 'command', runKey: '' }), '#page=command');
  assert.equal(formatDashboardHash({ pageId: '', runKey: '' }), '');
});

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

test('closing an already closed mobile menu is idempotent and does not steal focus', () => {
  const bundle = clientScript(3008);

  assert.match(bundle, /if \(!panel\.classList\.contains\('open'\)\) return/);
  assert.match(bundle, /MOBILE_NAV_RETURN_FOCUS = null/);
});
