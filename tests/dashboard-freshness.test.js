// owner: RStack developed by Richardson Gunde

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshnessScript } from '../src/observability/dashboard/ui/freshness.js';

// Evaluate the shipped browser script in a sandbox and pull out the pure
// classifier + label helpers (no DOM needed).
const api = new Function(
  freshnessScript + '\nreturn { classifyFreshness, freshnessDotClass, freshnessLabel };',
)();

const NOW = 1_000_000;

test('before any snapshot the chip reads loading', () => {
  assert.equal(api.classifyFreshness({ now: NOW, lastSnapshotAt: 0, wsConnected: false, hasData: false }), 'loading');
});

test('fresh snapshot over a live socket is live', () => {
  assert.equal(api.classifyFreshness({ now: NOW, lastSnapshotAt: NOW - 2000, wsConnected: true, hasData: true }), 'live');
});

test('socket up but snapshots stalled past the stale window is stale', () => {
  assert.equal(api.classifyFreshness({ now: NOW, lastSnapshotAt: NOW - 12_000, wsConnected: true, hasData: true }), 'stale');
});

test('socket down but data still recent (polling) is reconnecting', () => {
  assert.equal(api.classifyFreshness({ now: NOW, lastSnapshotAt: NOW - 4000, wsConnected: false, hasData: true }), 'reconnecting');
});

test('no fresh data past the disconnect window is disconnected regardless of socket', () => {
  assert.equal(api.classifyFreshness({ now: NOW, lastSnapshotAt: NOW - 31_000, wsConnected: true, hasData: true }), 'disconnected');
  assert.equal(api.classifyFreshness({ now: NOW, lastSnapshotAt: NOW - 31_000, wsConnected: false, hasData: true }), 'disconnected');
});

test('thresholds are configurable', () => {
  assert.equal(api.classifyFreshness({ now: NOW, lastSnapshotAt: NOW - 6000, wsConnected: true, hasData: true, staleMs: 5000 }), 'stale');
});

test('dot classes map to the topbar status palette', () => {
  assert.equal(api.freshnessDotClass('live'), 'status-live');
  assert.equal(api.freshnessDotClass('disconnected'), 'status-error');
  assert.equal(api.freshnessDotClass('stale'), 'status-connecting');
  assert.equal(api.freshnessDotClass('reconnecting'), 'status-connecting');
});

test('labels surface the as-of timestamp so data is never silently stale', () => {
  assert.equal(api.freshnessLabel('live', '14:32:05'), 'Live · updated 14:32:05');
  assert.match(api.freshnessLabel('disconnected', '14:32:05'), /Disconnected · data as of 14:32:05/);
  assert.equal(api.freshnessLabel('loading', null), 'Loading…');
});
