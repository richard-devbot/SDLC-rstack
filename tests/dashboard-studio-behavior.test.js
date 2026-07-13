/**
 * Source-backed robot behavior and authored office topology.
 *
 * owner: RStack developed by Richardson Gunde
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  behaviorIntent,
  freezeReason,
  restingBehavior,
  safeActivityGesture,
} from '../src/observability/dashboard/ui/studio3d/behavior.js';
import {
  STUDIO_TOPOLOGY,
  routePoints,
  workstationSlot,
} from '../src/observability/dashboard/ui/studio3d/topology.js';

test('lifecycle events map to explicit robot actions without inventing work', () => {
  assert.deepEqual(behaviorIntent({
    type: 'agent_session_started',
    entity_id: 'session-7',
    task_id: '004-implementation',
    stage_ids: ['08-implementation'],
  }), {
    action: 'enter',
    sessionId: 'session-7',
    taskId: '004-implementation',
    stageIds: ['08-implementation'],
    gesture: null,
    notification: null,
  });

  assert.equal(behaviorIntent({ type: 'poll_received', entity_id: 'session-7' }), null);
  assert.equal(behaviorIntent({
    type: 'agent_activity',
    entity_id: 'session-7',
    activity_class: 'file',
  }).gesture, 'keyboard');
  assert.equal(behaviorIntent({
    type: 'agent_waiting',
    entity_id: 'session-7',
    reason_class: 'approval',
  }).notification, 'approval');
});

test('every normalized lifecycle event has a conservative robot intent', () => {
  const cases = new Map([
    ['delegation_requested', 'delegate'],
    ['agent_session_started', 'enter'],
    ['agent_session_ready', 'walk_to_assignment'],
    ['agent_capabilities_attached', 'collect_capabilities'],
    ['agent_activity', 'work'],
    ['agent_waiting', 'wait'],
    ['handoff_created', 'handoff'],
    ['artifact_emitted', 'return_evidence'],
    ['task_retry_scheduled', 'retry'],
    ['agent_session_completed', 'complete'],
    ['agent_session_failed', 'fail'],
    ['agent_session_stopped', 'exit'],
  ]);

  for (const [type, action] of cases) {
    assert.equal(behaviorIntent({ type, agent_session_id: 'session-1' })?.action, action, type);
  }
});

test('resting behavior, activity gestures, and freeze remain honest', () => {
  assert.equal(restingBehavior({ role: 'validator', status: 'active' }), 'validating');
  assert.equal(restingBehavior({ role: 'builder', status: 'active' }), 'seated_work');
  assert.equal(restingBehavior({ role: 'builder', status: 'waiting' }), 'waiting');
  assert.equal(restingBehavior({ role: 'builder', status: 'blocked' }), 'waiting');
  assert.equal(restingBehavior({ role: 'builder', status: 'completed' }), 'complete');
  assert.equal(restingBehavior({ role: 'builder', status: 'unknown' }), 'standing');

  assert.equal(safeActivityGesture('planning'), 'monitor_focus');
  assert.equal(safeActivityGesture('file_edit'), 'keyboard');
  assert.equal(safeActivityGesture('tool_call'), 'mouse');
  assert.equal(safeActivityGesture('validation'), 'validation_monitor');
  assert.equal(safeActivityGesture('unknown-command'), 'status_only');

  assert.equal(freezeReason({ freshness: { state: 'stale' } }, 'live'), 'stale');
  assert.equal(freezeReason({ freshness: { state: 'fresh' } }, 'disconnected'), 'disconnected');
  assert.equal(freezeReason({ freshness: { state: 'fresh' } }, 'error'), 'error');
  assert.equal(freezeReason({ freshness: { state: 'fresh' } }, 'live'), null);
});

test('company topology has fixed facilities, fifteen departments, and authored routes', () => {
  assert.equal(STUDIO_TOPOLOGY.missions.length, 8);
  assert.equal(STUDIO_TOPOLOGY.departments.length, 15);
  assert.equal(new Set(STUDIO_TOPOLOGY.departments.map((slot) => slot.id)).size, 15);
  assert.equal(STUDIO_TOPOLOGY.builderDesks.length, 8);
  assert.equal(STUDIO_TOPOLOGY.validatorDesks.length, 4);
  assert.equal(STUDIO_TOPOLOGY.dispatchQueue.length, 12);
  assert.equal(new Set(STUDIO_TOPOLOGY.dispatchQueue.map((slot) => slot.id)).size, 12);
  assert.notDeepEqual(STUDIO_TOPOLOGY.dispatch.position, STUDIO_TOPOLOGY.library.position);

  const builder = workstationSlot({ role: 'builder' }, { sessions: [] }, 0);
  const validator = workstationSlot({ role: 'validator' }, { sessions: [] }, 0);
  assert.equal(builder.id, 'builder-desk-1');
  assert.equal(validator.id, 'validator-desk-1');
  assert.equal(workstationSlot({ role: 'builder' }, { sessions: [] }, 8), null);

  assert.deepEqual(routePoints('dispatch_to_library').at(0), STUDIO_TOPOLOGY.dispatch.position);
  assert.deepEqual(routePoints('dispatch_to_library').at(-1), STUDIO_TOPOLOGY.library.entry);
  assert.deepEqual(routePoints('missing-route'), []);
});

test('topology and returned routes are immutable', () => {
  assert.equal(Object.isFrozen(STUDIO_TOPOLOGY), true);
  assert.equal(Object.isFrozen(STUDIO_TOPOLOGY.routes), true);
  assert.equal(Object.isFrozen(routePoints('builder_to_validator')), true);
});
