/**
 * Browser scope orchestration and responsive trust strip (#276).
 *
 * owner: RStack developed by Richardson Gunde
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { clientScript } from '../src/observability/dashboard/ui/client.js';
import { dashboardHtml } from '../src/observability/dashboard/ui.js';
import { styles } from '../src/observability/dashboard/ui/styles.js';

test('browser requests server-owned scopes instead of partially filtering snapshots', () => {
  const bundle = clientScript(3008);
  assert.doesNotMatch(bundle, /function applyScope\(/);
  assert.doesNotMatch(bundle, /function selectReadinessScope\(/);
  assert.match(bundle, /function requestScopedState\(/);
  assert.match(bundle, /function handleGlobalSnapshot\(/);
  assert.match(bundle, /var SCOPE_REQUEST_SEQUENCE = 0/);
  assert.match(bundle, /requestSequence !== SCOPE_REQUEST_SEQUENCE/);
  assert.match(bundle, /\/api\/state\?project=/);
  assert.match(bundle, /\/api\/state\?run=/);
  assert.match(bundle, /state\.scope && state\.scope\.reset/);
  assert.match(bundle, /scopeCatalog/);
  assert.doesNotThrow(() => new Function(bundle));
});

test('scope controls remain visible, labelled, and touchable at 390px', () => {
  const html = dashboardHtml(3008);
  assert.match(html, /class="tb-scope" role="group" aria-label="Dashboard data scope"/);
  assert.match(html, /class="scope-label"[^>]*>Project</);
  assert.match(html, /class="scope-label"[^>]*>Run</);
  assert.match(html, /id="scope-live" role="status" aria-live="polite"/);
  assert.match(html, /id="scope-context"/);
  assert.doesNotMatch(styles, /@media \(max-width: 900px\) \{ \.tb-scope \{ display: none; \} \}/);
  assert.match(styles, /\.tb-scope \.run-select[^}]*min-height:\s*44px/);
  assert.match(styles, /@media \(max-width: 640px\)[\s\S]*\.tb-scope[^}]*width:\s*100%/);
});

test('catalog labels canonical projects first and keeps worktree context secondary', () => {
  const bundle = clientScript(3008);
  assert.match(bundle, /project\.name/);
  assert.match(bundle, /worktreeName/);
  assert.match(bundle, /legacyRunId/);
  assert.match(bundle, /Scope reset to All projects/);
});
