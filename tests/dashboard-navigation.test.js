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
} from '../src/observability/dashboard/ui/navigation.js';
import { dashboardHtml } from '../src/observability/dashboard/ui.js';

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
