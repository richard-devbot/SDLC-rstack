/**
 * Action Inbox UI (#281).
 * owner: RStack developed by Richardson Gunde
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { actionInboxScript } from '../src/observability/dashboard/ui/pages/action-inbox.js';
import { clientScript } from '../src/observability/dashboard/ui/client.js';
import { dashboardHtml } from '../src/observability/dashboard/ui.js';
import { styles } from '../src/observability/dashboard/ui/styles.js';

test('Action Inbox exposes normalized filters, source, scope, lifecycle and fail-closed actions', () => {
  for (const filter of ['all', 'blocking', 'approvals', 'decisions', 'failures', 'resolved']) {
    assert.ok(actionInboxScript.includes(`'${filter}'`));
  }
  assert.match(actionInboxScript, /availability/);
  assert.match(actionInboxScript, /allowedActions/);
  assert.match(actionInboxScript, /Source unavailable/);
  assert.match(actionInboxScript, /aria-pressed/);
  assert.match(actionInboxScript, /page: 'approvals'/);
  assert.match(actionInboxScript, /showPage\(/);
  assert.doesNotMatch(actionInboxScript, /fetch\('\/api\/(approve|reject)/, 'Inbox does not duplicate mutation authority');
});

test('Decisions navigation points to Action Inbox and preserves legacy compatibility pages', () => {
  const html = dashboardHtml(3008);
  assert.match(html, /data-page="action-inbox"/);
  assert.match(html, /id="page-action-inbox"/);
  assert.match(html, /"approvals":"decisions"/);
  const bundle = clientScript(3008);
  assert.doesNotThrow(() => new Function(bundle));
  assert.equal([...bundle.matchAll(/registerPage\('action-inbox',/g)].length, 1);
});

test('Action Inbox filters and cards remain keyboard/mobile safe', () => {
  assert.match(styles, /\.action-inbox-filters[^}]*overflow-x:\s*auto/);
  assert.match(styles, /\.action-inbox-filter:focus-visible/);
  assert.match(styles, /@media \(max-width:640px\)[\s\S]*\.action-card-main[^}]*grid-template-columns:\s*1fr/);
});
