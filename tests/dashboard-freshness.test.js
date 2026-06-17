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

// --- Additional edge-case and boundary tests ---

test('classifyFreshness with no arguments defaults opts and returns loading', () => {
  // opts defaults to {} when called with no argument; hasData is falsy
  assert.equal(api.classifyFreshness(), 'loading');
  assert.equal(api.classifyFreshness(null), 'loading');
  assert.equal(api.classifyFreshness({}), 'loading');
});

test('classifyFreshness at exact stale boundary (age === staleMs) is still live', () => {
  // age must be strictly greater than staleMs to flip to stale
  assert.equal(
    api.classifyFreshness({ now: NOW, lastSnapshotAt: NOW - 10000, wsConnected: true, hasData: true }),
    'live',
  );
});

test('classifyFreshness one ms past stale boundary is stale', () => {
  assert.equal(
    api.classifyFreshness({ now: NOW, lastSnapshotAt: NOW - 10001, wsConnected: true, hasData: true }),
    'stale',
  );
});

test('classifyFreshness at exact disconnect boundary (age === disconnectMs) is not yet disconnected', () => {
  // age must be strictly greater than disconnectMs
  assert.equal(
    api.classifyFreshness({ now: NOW, lastSnapshotAt: NOW - 30000, wsConnected: false, hasData: true }),
    'reconnecting',
  );
});

test('classifyFreshness one ms past disconnect boundary is disconnected', () => {
  assert.equal(
    api.classifyFreshness({ now: NOW, lastSnapshotAt: NOW - 30001, wsConnected: false, hasData: true }),
    'disconnected',
  );
});

test('custom disconnectMs threshold is respected', () => {
  // With disconnectMs=5000, age=6000 should be disconnected
  assert.equal(
    api.classifyFreshness({ now: NOW, lastSnapshotAt: NOW - 6000, wsConnected: true, hasData: true, disconnectMs: 5000 }),
    'disconnected',
  );
  // With disconnectMs=60000, age=31000 should not be disconnected
  assert.equal(
    api.classifyFreshness({ now: NOW, lastSnapshotAt: NOW - 31000, wsConnected: true, hasData: true, disconnectMs: 60000 }),
    'stale',
  );
});

test('hasData=false always returns loading regardless of socket state or age', () => {
  assert.equal(
    api.classifyFreshness({ now: NOW, lastSnapshotAt: NOW - 1000, wsConnected: true, hasData: false }),
    'loading',
  );
  assert.equal(
    api.classifyFreshness({ now: NOW, lastSnapshotAt: NOW - 100000, wsConnected: false, hasData: false }),
    'loading',
  );
});

test('freshnessDotClass returns status-connecting for loading kind', () => {
  assert.equal(api.freshnessDotClass('loading'), 'status-connecting');
});

test('freshnessDotClass returns status-connecting for stale kind', () => {
  assert.equal(api.freshnessDotClass('stale'), 'status-connecting');
});

test('freshnessLabel falls back to em-dash when stamp is null', () => {
  assert.equal(api.freshnessLabel('live', null), 'Live · updated —');
  assert.equal(api.freshnessLabel('stale', null), 'Stale · data as of —');
  assert.equal(api.freshnessLabel('reconnecting', null), 'Reconnecting · data as of —');
  assert.equal(api.freshnessLabel('disconnected', null), 'Disconnected · data as of —');
});

test('freshnessLabel for stale kind includes as-of timestamp', () => {
  assert.equal(api.freshnessLabel('stale', '09:05:55'), 'Stale · data as of 09:05:55');
});

test('freshnessLabel for reconnecting kind includes as-of timestamp', () => {
  assert.equal(api.freshnessLabel('reconnecting', '23:59:59'), 'Reconnecting · data as of 23:59:59');
});

test('freshnessLabel for unknown kind falls back to disconnected phrasing', () => {
  // Any unrecognised kind hits the default branch
  assert.equal(api.freshnessLabel('unknown-kind', '12:00:00'), 'Disconnected · data as of 12:00:00');
  assert.equal(api.freshnessLabel('', null), 'Disconnected · data as of —');
});

test('classifyFreshness prefers disconnect over socket-down when both conditions met', () => {
  // age > disconnectMs takes priority over !wsConnected → 'reconnecting'
  assert.equal(
    api.classifyFreshness({ now: NOW, lastSnapshotAt: NOW - 35000, wsConnected: false, hasData: true }),
    'disconnected',
  );
});

test('classifyFreshness socket up with age just inside both thresholds is live', () => {
  // age < staleMs < disconnectMs, wsConnected → live
  assert.equal(
    api.classifyFreshness({ now: NOW, lastSnapshotAt: NOW - 5000, wsConnected: true, hasData: true }),
    'live',
  );
});
