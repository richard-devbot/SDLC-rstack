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
import { styles } from '../src/observability/dashboard/ui/styles.js';

test('six intent destinations cover every legacy page exactly once', () => {
  assert.deepEqual(destinations.map((item) => item.label), [
    'Overview', 'Runs', 'Evidence', 'Decisions', 'Spend', 'Operations',
  ]);

  const childIds = destinations.flatMap((item) => item.children.map((child) => child.id));
  assert.equal(childIds.length, 24);
  assert.equal(new Set(childIds).size, 24);
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
  const visibleChildren = destinations.reduce((total, destination) => total + destination.children.filter((child) => !child.hidden).length, 0);

  assert.equal((html.match(/class="destination-link/g) || []).length, 12);
  assert.equal((html.match(/class="secondary-link/g) || []).length, visibleChildren * 2);
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
    { page: 'security', run: '', section: '' },
  );
  assert.deepEqual(
    parseDashboardRoute({ hash: '#page=run-workspace&run=run%3Aabc&section=timeline', search: '' }),
    { page: 'run-workspace', run: 'run:abc', section: 'timeline' },
  );
  assert.deepEqual(
    parseDashboardRoute({ hash: '#run=run-only', search: '?page=cost-budget' }),
    { page: 'cost-budget', run: 'run-only', section: '' },
  );
});

test('dashboard hash formatter preserves page and opaque run scope together', () => {
  assert.equal(
    formatDashboardHash({ pageId: 'run-workspace', runKey: 'run:abc/123', section: 'artifacts' }),
    '#page=run-workspace&run=run%3Aabc%2F123&section=artifacts',
  );
  assert.equal(formatDashboardHash({ pageId: 'command', runKey: '' }), '#page=command');
  assert.equal(formatDashboardHash({ pageId: '', runKey: '' }), '');
});

test('client keeps legacy routing and mobile focus containment', () => {
  const bundle = clientScript(3008);

  assert.match(bundle, /function readDashboardRoute\(\)/);
  assert.match(bundle, /function writeDashboardRoute\(pageId, runKey, section, mode\)/);
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

test('shell has persistent desktop, compact tablet, and 390px mobile contracts', () => {
  assert.match(
    styles,
    /#shell\s*\{[^}]*grid-template-columns:\s*236px minmax\(0, 1fr\)/,
  );
  assert.match(
    styles,
    /@media \(max-width: 1100px\)[\s\S]*grid-template-columns:\s*84px minmax\(0, 1fr\)/,
  );
  assert.match(
    styles,
    /@media \(max-width: 700px\)[\s\S]*#mobile-nav-toggle[^}]*display:\s*grid/,
  );
  assert.match(
    styles,
    /@media \(max-width: 700px\)[\s\S]*\.destination-link[^}]*min-height:\s*44px/,
  );
  assert.match(
    styles,
    /@media \(max-width: 700px\)[\s\S]*\.mission-brief[^}]*grid-template-columns:\s*1fr/,
  );
  assert.match(
    styles,
    /@media \(max-width: 700px\)[\s\S]*\.executive-grid[^}]*grid-template-columns:\s*1fr/,
  );
  assert.match(styles, /:focus-visible/);
  assert.match(styles, /@media \(prefers-reduced-motion:\s*reduce\)/);
});
