import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RETRY_ACTIONS,
  RETRY_ACTION_STATUSES,
  attemptCountForTask,
  classifyRetryDecision,
  compactValidationIssues,
  nextTaskStatusForRetry,
} from '../src/core/harness/retry-policy.js';
import { DEFAULT_HARNESS_GUARDRAILS, countTaskAttempts } from '../src/core/harness/guardrails.js';

const task = { id: 'task-1' };

function startedEvents(count, taskId = 'task-1') {
  return Array.from({ length: count }, () => ({ type: 'task_started', task_id: taskId }));
}

test('attemptCountForTask reuses the guardrail counting logic', () => {
  const events = [
    ...startedEvents(2),
    { type: 'task_started', task_id: 'task-2' },
    { type: 'task_validated', task_id: 'task-1' },
    null,
    'junk',
  ];
  assert.equal(attemptCountForTask(events, 'task-1'), 2);
  assert.equal(attemptCountForTask(events, 'task-1'), countTaskAttempts(events, 'task-1'));
  assert.equal(attemptCountForTask(null, 'task-1'), 0);
  assert.equal(attemptCountForTask(undefined, 'task-1'), 0);
  assert.equal(attemptCountForTask('junk', 'task-1'), 0);
});

test('none + PASS completes the task', () => {
  const decision = classifyRetryDecision({
    task,
    validation: { status: 'PASS', retry_recommendation: 'none', issues: [] },
    events: startedEvents(1),
  });
  assert.equal(decision.action, 'complete');
  assert.equal(decision.next_status, 'PASS');
  assert.equal(decision.attempt, 1);
  assert.equal(decision.max_attempts, DEFAULT_HARNESS_GUARDRAILS.maxTaskAttempts);
  assert.deepEqual(decision.issues, []);
  assert.ok(decision.reason.includes('task-1'));
});

test('retry_builder under budget schedules a retry with re-claimable FAIL status', () => {
  const decision = classifyRetryDecision({
    task,
    validation: { status: 'FAIL', retry_recommendation: 'retry_builder', issues: ['tests failed'] },
    events: startedEvents(1),
  });
  assert.equal(decision.action, 'retry');
  assert.equal(decision.next_status, 'FAIL');
  assert.equal(decision.attempt, 1);
  assert.equal(decision.max_attempts, 2);
  assert.deepEqual(decision.issues, ['tests failed']);
  assert.ok(decision.reason.includes('1 of 2'), decision.reason);
});

test('retry_builder at the attempt budget exhausts to BLOCKED and names the override artifact', () => {
  const decision = classifyRetryDecision({
    task,
    validation: { status: 'FAIL', retry_recommendation: 'retry_builder' },
    events: startedEvents(2),
  });
  assert.equal(decision.action, 'exhausted');
  assert.equal(decision.next_status, 'BLOCKED');
  assert.equal(decision.attempt, 2);
  assert.equal(decision.max_attempts, 2);
  assert.ok(decision.reason.includes('guardrail-override:task-1'), decision.reason);
});

test('retry_builder over the budget also exhausts', () => {
  const decision = classifyRetryDecision({
    task,
    validation: { status: 'FAIL', retry_recommendation: 'retry_builder' },
    events: startedEvents(5),
  });
  assert.equal(decision.action, 'exhausted');
  assert.equal(decision.next_status, 'BLOCKED');
});

test('destructive tasks use the tighter destructive attempt budget', () => {
  const destructiveTask = { id: 'task-1', destructive: true };
  const decision = classifyRetryDecision({
    task: destructiveTask,
    validation: { status: 'FAIL', retry_recommendation: 'retry_builder' },
    events: startedEvents(1),
  });
  assert.equal(decision.action, 'exhausted');
  assert.equal(decision.max_attempts, DEFAULT_HARNESS_GUARDRAILS.maxDestructiveTaskAttempts);

  const riskLevel = classifyRetryDecision({
    task: { id: 'task-1', risk_level: 'destructive' },
    validation: { status: 'FAIL', retry_recommendation: 'retry_builder' },
    events: startedEvents(1),
  });
  assert.equal(riskLevel.action, 'exhausted');
});

test('guardrails override param raises the budget through resolveGuardrails', () => {
  const decision = classifyRetryDecision({
    task,
    validation: { status: 'FAIL', retry_recommendation: 'retry_builder' },
    events: startedEvents(2),
    guardrails: { maxTaskAttempts: 3 },
  });
  assert.equal(decision.action, 'retry');
  assert.equal(decision.max_attempts, 3);

  // Invalid overrides fall back to defaults instead of weakening the budget.
  const invalid = classifyRetryDecision({
    task,
    validation: { status: 'FAIL', retry_recommendation: 'retry_builder' },
    events: startedEvents(2),
    guardrails: { maxTaskAttempts: 'lots' },
  });
  assert.equal(invalid.action, 'exhausted');
  assert.equal(invalid.max_attempts, DEFAULT_HARNESS_GUARDRAILS.maxTaskAttempts);
});

test('ask_user pauses the task for human context', () => {
  const decision = classifyRetryDecision({
    task,
    validation: { status: 'FAIL', retry_recommendation: 'ask_user' },
    events: startedEvents(1),
  });
  assert.equal(decision.action, 'human_context');
  assert.equal(decision.next_status, 'NEEDS_CONTEXT');
});

test('block hard-blocks the task regardless of remaining budget', () => {
  const decision = classifyRetryDecision({
    task,
    validation: { status: 'FAIL', retry_recommendation: 'block' },
    events: [],
  });
  assert.equal(decision.action, 'block');
  assert.equal(decision.next_status, 'BLOCKED');
});

test('missing or unknown recommendation degrades conservatively by validation status', () => {
  const failed = classifyRetryDecision({
    task,
    validation: { status: 'FAIL' },
    events: startedEvents(1),
  });
  assert.equal(failed.action, 'retry');
  assert.equal(failed.retry_recommendation, 'retry_builder');

  const passed = classifyRetryDecision({
    task,
    validation: { status: 'PASS' },
    events: startedEvents(1),
  });
  assert.equal(passed.action, 'complete');
  assert.equal(passed.retry_recommendation, 'none');

  const unknown = classifyRetryDecision({
    task,
    validation: { status: 'FAIL', retry_recommendation: 'try_harder' },
    events: startedEvents(1),
  });
  assert.equal(unknown.action, 'retry');

  // An explicit 'none' on a failed validation must never silently complete.
  const noneButFailed = classifyRetryDecision({
    task,
    validation: { status: 'FAIL', retry_recommendation: 'none' },
    events: startedEvents(1),
  });
  assert.equal(noneButFailed.action, 'retry');
  assert.equal(noneButFailed.next_status, 'FAIL');
});

test('malformed inputs never throw', () => {
  const shapes = [
    {},
    { task: null, validation: null, events: null },
    { task: 'junk', validation: 42, events: 'nope', guardrails: 'nah' },
    { task: {}, validation: { issues: { not: 'an array' } } },
    { task: { id: 7 }, validation: { status: 'MAYBE', retry_recommendation: 9, issues: [[], {}, null, 3] } },
  ];
  for (const shape of shapes) {
    const decision = classifyRetryDecision(shape);
    assert.ok(RETRY_ACTIONS.includes(decision.action), `action for ${JSON.stringify(shape)}`);
    assert.equal(typeof decision.reason, 'string');
    assert.ok(Array.isArray(decision.issues));
  }
  // No argument at all.
  const bare = classifyRetryDecision();
  assert.ok(RETRY_ACTIONS.includes(bare.action));
});

test('issues compaction maps objects, truncates long entries, and caps at 5', () => {
  const longEvidence = 'x'.repeat(300);
  const issues = [
    { name: 'check_a', evidence: 'missing file' },
    { name: 'check_b', evidence: longEvidence },
    'a plain string issue',
    { name: '', evidence: '   ' }, // junk: no meaningful text
    {}, // junk object
    null,
    42,
    { name: 'check_c' },
    { name: 'check_d' },
    { name: 'check_e' },
    { name: 'check_f' },
  ];
  const compacted = compactValidationIssues(issues);
  assert.equal(compacted.length, 5);
  assert.equal(compacted[0], 'check_a: missing file');
  assert.ok(compacted[1].startsWith('check_b: '));
  assert.ok(compacted[1].length <= 121, `truncated length was ${compacted[1].length}`);
  assert.ok(compacted[1].endsWith('…'));
  assert.equal(compacted[2], 'a plain string issue');
  assert.equal(compacted[3], 'check_c');

  assert.deepEqual(compactValidationIssues('junk'), []);
  assert.deepEqual(compactValidationIssues(null), []);

  const viaDecision = classifyRetryDecision({ task, validation: { status: 'FAIL', issues }, events: [] });
  assert.deepEqual(viaDecision.issues, compacted);
});

test('nextTaskStatusForRetry maps every action and falls back to FAIL', () => {
  for (const action of RETRY_ACTIONS) {
    assert.equal(nextTaskStatusForRetry({ action }), RETRY_ACTION_STATUSES[action]);
  }
  assert.equal(nextTaskStatusForRetry({ action: 'complete' }), 'PASS');
  assert.equal(nextTaskStatusForRetry({ action: 'retry' }), 'FAIL');
  assert.equal(nextTaskStatusForRetry({ action: 'exhausted' }), 'BLOCKED');
  assert.equal(nextTaskStatusForRetry({ action: 'human_context' }), 'NEEDS_CONTEXT');
  assert.equal(nextTaskStatusForRetry({ action: 'block' }), 'BLOCKED');
  assert.equal(nextTaskStatusForRetry({ action: 'made_up' }), 'FAIL');
  assert.equal(nextTaskStatusForRetry(null), 'FAIL');
  assert.equal(nextTaskStatusForRetry(), 'FAIL');
});
