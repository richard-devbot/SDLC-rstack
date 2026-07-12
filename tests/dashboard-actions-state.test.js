/**
 * Normalized Action Inbox state (#281).
 * owner: RStack developed by Richardson Gunde
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildActions } from '../src/observability/dashboard/state/actions.js';
import { buildOverviewProjection } from '../src/observability/dashboard/state/overview.js';

const NOW = '2026-07-12T10:00:00.000Z';

function state() {
  return {
    ts: NOW,
    approvals: [{
      id: 'approval-1', title: 'Approve guarded retry', detail: 'Testing exhausted its retry budget.',
      status: 'pending', artifact: 'guardrail-override:test-task', projectId: 'p1', projectRoot: '/workspace/a',
      runId: 'run-1', taskId: 'test-task', ts: '2026-07-12T08:00:00.000Z', source: 'queue',
      allowedActions: ['approve', 'reject'],
    }, {
      id: 'approval-consumed', title: 'Earlier retry', status: 'CONSUMED', artifact: 'guardrail-override:old-task',
      projectId: 'p1', projectRoot: '/workspace/a', runId: 'run-1', taskId: 'old-task', ts: '2026-07-11T08:00:00.000Z',
    }],
    blockedGates: [{
      id: 'gate-duplicate', title: 'Approval required', detail: 'Task test-task could not proceed',
      runId: 'run-1', taskId: 'test-task', projectId: 'p1', projectRoot: '/workspace/a',
      missing: ['guardrail-override:test-task'], ts: '2026-07-12T08:01:00.000Z', source: 'events',
    }],
    runs: [{
      runId: 'run-1', scopeKey: 'scope-run-1', projectRoot: '/workspace/a', project: { id: 'p1' },
      tasks: [{
        id: 'test-task', title: 'Validate release', stageId: '08-testing', status: 'BLOCKED',
        validation: { status: 'FAIL', issues: ['Integration test failed'] },
      }, {
        id: 'code-task', title: 'Build feature', stageId: '07-code', status: 'FAIL',
        validation: { status: 'FAIL', issues: ['Lint failed'] },
      }],
      pipelineRollup: {
        stale: false,
        next_action: { kind: 'guardrail_blocked', task_id: 'test-task', stage_id: '08-testing', text: 'Approve one retry.' },
        retries: { exhausted: 1 },
      },
    }],
    decisions: { runs: [{
      runId: 'run-1', projectRoot: '/workspace/a', decisions: [{
        decision_id: 'DEC-1', question: 'Choose deployment region', impact: 'deployment', status: 'pending',
        required_before_stage: '09-deployment', created_at: '2026-07-12T07:00:00.000Z', owner: 'delivery-lead',
      }],
    }] },
    alerts: [{ id: 'alert-1', type: 'stalled', severity: 'critical', title: 'Run stalled', detail: 'No progress for 30 minutes', runId: 'run-1', projectId: 'p1', projectRoot: '/workspace/a', ts: '2026-07-12T09:00:00.000Z' }],
    diagnostics: { configIssues: [{ root: '/workspace/a', projectId: 'p1', path: '.rstack/config.json', field: 'maxTaskAttempts', message: 'Expected a positive integer' }] },
    feed: [{
      type: 'approval_audit_failed', runId: 'run-1', projectId: 'p1', projectRoot: '/workspace/a', ts: '2026-07-12T09:30:00.000Z',
      data: { record_id: 'bad-1', artifact: 'plan.md', reason: 'Cross-run replay rejected', issues: ['run_id mismatch'], status: 'APPROVED' },
    }],
  };
}

test('all named attention sources normalize into one source-linked schema', () => {
  const actions = buildActions(state(), { now: NOW });
  const types = new Set(actions.map((action) => action.type));
  for (const type of ['approval', 'decision', 'failure', 'alert', 'configuration', 'audit']) {
    assert.ok(types.has(type), `contains ${type}`);
  }
  assert.ok(actions.every((action) => action.id && action.title && action.consequence && action.nextStep));
  assert.ok(actions.every((action) => action.source?.kind && action.availability));
});

test('guardrail queue record wins and groups the exhausted-task safety-net signals', () => {
  const actions = buildActions(state(), { now: NOW });
  const retry = actions.find((action) => action.taskId === 'test-task');
  assert.equal(retry.type, 'approval');
  assert.equal(retry.status, 'open');
  assert.deepEqual(retry.allowedActions, ['approve', 'reject']);
  assert.ok(retry.signals.length >= 2, 'queue, gate, and task/pipeline signals are grouped');
  assert.equal(actions.filter((action) => action.taskId === 'test-task').length, 1);
});

test('ordering is blocking then severity then oldest unresolved and stable id', () => {
  const actions = buildActions(state(), { now: NOW });
  const open = actions.filter((action) => !['resolved', 'consumed', 'approved', 'rejected', 'expired'].includes(action.status));
  assert.equal(open[0].blocking, true);
  const ranks = { critical: 0, high: 1, medium: 2, low: 3 };
  for (let i = 1; i < open.length; i++) {
    if (open[i - 1].blocking === open[i].blocking) {
      assert.ok(ranks[open[i - 1].severity] <= ranks[open[i].severity] || open[i - 1].createdAt <= open[i].createdAt);
    }
  }
});

test('lifecycle and audit invalidity remain visible and fail closed', () => {
  const candidate = state();
  candidate.runs[0].pipelineRollup.stale = true;
  const actions = buildActions(candidate, { now: NOW });
  const consumed = actions.find((action) => action.source.recordId === 'approval-consumed');
  const invalid = actions.find((action) => action.type === 'audit');
  const retry = actions.find((action) => action.taskId === 'test-task');
  assert.equal(consumed.status, 'consumed');
  assert.equal(invalid.availability, 'invalid');
  assert.deepEqual(invalid.allowedActions, []);
  assert.equal(retry.availability, 'stale');
  assert.deepEqual(retry.allowedActions, [], 'stale source disables server actions');
});

test('missing authenticated identity never guesses Needs me', () => {
  const actions = buildActions(state(), { now: NOW });
  assert.equal(actions.some((action) => action.needsMe === true), false);
  assert.ok(actions.every((action) => action.needsMe === null));
});

test('Overview count and next action consume the same normalized queue', () => {
  const candidate = state();
  const actions = buildActions(candidate, { now: NOW });
  const overview = buildOverviewProjection({
    ...candidate,
    actions,
    readiness: { status: 'blocked', summary: 'Delivery is blocked.', blockers: [], coverage: {}, evaluatedAt: NOW },
  });
  const firstOpen = actions.find((action) => !['approved', 'rejected', 'consumed', 'resolved', 'expired'].includes(action.status));
  assert.equal(overview.actionCount, actions.filter((action) => !['approved', 'rejected', 'consumed', 'resolved', 'expired'].includes(action.status)).length);
  assert.equal(overview.nextAction.actionId, firstOpen.id);
  assert.equal(overview.nextAction.text, firstOpen.nextStep);
});
