/**
 * Browser scope orchestration and responsive trust strip (#276).
 *
 * owner: RStack developed by Richardson Gunde
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { clientScript } from '../src/observability/dashboard/ui/client.js';
import { dashboardHtml } from '../src/observability/dashboard/ui.js';
import { libScript } from '../src/observability/dashboard/ui/lib.js';
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

test('timestamps are locale-aware, timezone-bearing, and retain full ISO provenance', () => {
  const api = new Function(libScript + '; return { timeModel, timeHtml, fmtTime };')();
  const model = api.timeModel('2026-07-11T10:30:00.000Z');
  assert.equal(model.valid, true);
  assert.equal(model.iso, '2026-07-11T10:30:00.000Z');
  assert.match(model.label, /(GMT|UTC|IST|[+-]\d{1,2}:?\d{2})/i);
  assert.match(
    api.timeHtml('2026-07-11T10:30:00.000Z'),
    /<time datetime="2026-07-11T10:30:00.000Z" title="2026-07-11T10:30:00.000Z">/,
  );
  assert.equal(api.fmtTime('not-a-time'), 'Invalid time');
  assert.equal(api.fmtTime(null), 'Time unavailable');
});

test('event markup uses semantic time elements instead of sliced timestamp strings', () => {
  const bundle = clientScript(3008);
  assert.doesNotMatch(bundle, /String\(value\)\.replace\('T', ' '\)\.slice\(0, 16\)/);
  assert.doesNotMatch(bundle, /esc\(fmtTime\((?:item|gate)\.ts\)\)/);
  assert.match(bundle, /timeHtml\((?:item|gate)\.ts\)/);
  assert.match(bundle, /timeZoneName:\s*'short'/);
});
