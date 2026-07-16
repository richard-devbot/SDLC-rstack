/**
 * Transition queue fan-out for manager responsibilities.
 *
 * owner: RStack developed by Richardson Gunde
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createTransitionScheduler } from '../src/observability/dashboard/ui/studio3d/transitions.js';

test('one handoff event schedules its session motion and one manager check-in', () => {
  const applied = [];
  const scheduler = createTransitionScheduler({ apply: (transition) => applied.push(transition) });
  const event = {
    id: 'handoff-1',
    type: 'handoff_created',
    agent_session_id: 'session-a',
    task_id: 'task-a',
    from: 'builder',
    to: 'validator',
    timestamp: '2026-07-15T10:00:00.000Z',
    source: 'events.jsonl',
  };

  assert.equal(scheduler.ingest([event]), 2);
  assert.deepEqual(applied, []);
  scheduler.tick(1_000);
  scheduler.tick(1_001);

  assert.deepEqual(applied.map((item) => item.intent.action), ['handoff', 'manager_check_in']);
  assert.equal(applied[1].event, event);
  assert.deepEqual(applied.map((item) => item.started_at_ms), [1_000, 1_001]);
  assert.match(applied[1].id, /:manager$/);
});

test('retry manager fan-out remains idempotent and primes without replay', () => {
  const applied = [];
  const scheduler = createTransitionScheduler({ apply: (transition) => applied.push(transition) });
  const event = {
    id: 'retry-1',
    type: 'task_retry_scheduled',
    agent_session_id: 'session-a',
    task_id: 'task-a',
    attempt: 2,
    timestamp: '2026-07-15T10:00:00.000Z',
    source: 'events.jsonl',
  };

  assert.equal(scheduler.ingest([event], { prime: true }), 0);
  assert.equal(scheduler.ingest([event]), 0);
  scheduler.tick(1_000);
  assert.deepEqual(applied, []);
});
