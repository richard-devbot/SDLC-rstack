/**
 * Safe normalized lifecycle contract for delegated agent sessions.
 *
 * owner: RStack developed by Richardson Gunde
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AGENT_LIFECYCLE_TYPES,
  agentLifecycleEvent,
  isTerminalAgentLifecycle,
} from '../src/core/harness/agent-lifecycle.js';

const NOW = '2026-07-13T10:00:00.000Z';

test('lifecycle constructor allow-lists fields and normalizes identifiers', () => {
  const event = agentLifecycleEvent('agent_session_started', {
    run_id: 'run-1',
    task_id: '004-implementation',
    stage_ids: ['07-code', '../secret', '07-code'],
    agent_session_id: 'session-1',
    delegation_id: 'delegation-1',
    agent_id: 'agent.07-code',
    role: 'builder',
    harness: 'pi',
    model: 'gemini-2.5-pro',
    sandbox_id: '/private/worktrees/studio',
    specialist_ids: ['specialist.frontend.ui'],
    skill_ids: [],
    plugin_ids: ['plugin.browser'],
    prompt: 'private prompt',
    stderr: 'secret output',
  }, { now: NOW });

  assert.equal(event.type, 'agent_session_started');
  assert.equal(event.timestamp, NOW);
  assert.deepEqual(event.stage_ids, ['07-code']);
  assert.equal(event.sandbox_id, 'studio');
  assert.ok(!Object.hasOwn(event, 'prompt'));
  assert.ok(!Object.hasOwn(event, 'stderr'));
});

test('lifecycle constructor sanitizes summaries and caps capability arrays', () => {
  const event = agentLifecycleEvent('agent_activity', {
    agent_session_id: 'session-1',
    activity_class: 'verification',
    summary: `Ran tests\n${'x'.repeat(400)}`,
    specialist_ids: Array.from({ length: 40 }, (_, index) => `specialist.${index}`),
  }, { now: NOW });

  assert.equal(event.summary.includes('\n'), false);
  assert.equal(event.summary.length, 240);
  assert.equal(event.specialist_ids.length, 32);
});

test('lifecycle vocabulary is exact and terminal states are explicit', () => {
  assert.deepEqual([...AGENT_LIFECYCLE_TYPES], [
    'delegation_requested',
    'agent_session_started',
    'agent_session_ready',
    'agent_capabilities_attached',
    'agent_activity',
    'agent_waiting',
    'handoff_created',
    'artifact_emitted',
    'agent_session_completed',
    'agent_session_failed',
    'agent_session_stopped',
  ]);
  assert.equal(isTerminalAgentLifecycle('agent_session_completed'), true);
  assert.equal(isTerminalAgentLifecycle('agent_session_failed'), true);
  assert.equal(isTerminalAgentLifecycle('agent_session_stopped'), true);
  assert.equal(isTerminalAgentLifecycle('agent_activity'), false);
  assert.throws(() => agentLifecycleEvent('made_up', {}, { now: NOW }), /Unknown agent lifecycle event/);
});
