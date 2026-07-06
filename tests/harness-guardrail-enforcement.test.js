import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_HARNESS_GUARDRAILS,
  resolveGuardrails,
  loadProjectGuardrails,
  isDestructiveTask,
  countTaskAttempts,
  guardrailOverrideArtifact,
  hasGuardrailOverride,
  evaluateTaskClaim,
  evaluateBuilderTelemetry,
  guardrailEvent,
} from '../src/core/harness/guardrails.js';

test('resolveGuardrails merges overrides and rejects invalid values', () => {
  const merged = resolveGuardrails({ maxTaskAttempts: 5, maxToolCallsPerTask: '60' });
  assert.equal(merged.maxTaskAttempts, 5);
  assert.equal(merged.maxToolCallsPerTask, 60);
  assert.equal(merged.maxMessagesPerTask, DEFAULT_HARNESS_GUARDRAILS.maxMessagesPerTask);

  const invalid = resolveGuardrails({ maxTaskAttempts: -1, maxMessagesPerTask: 'lots', unknownRule: 99 });
  assert.equal(invalid.maxTaskAttempts, DEFAULT_HARNESS_GUARDRAILS.maxTaskAttempts);
  assert.equal(invalid.maxMessagesPerTask, DEFAULT_HARNESS_GUARDRAILS.maxMessagesPerTask);
  assert.ok(!('unknownRule' in invalid));

  const flags = resolveGuardrails({ requireEvidenceForPass: false });
  assert.equal(flags.requireEvidenceForPass, false);

  // String booleans: only explicit "true"/"false" are honored — Boolean("false")
  // coercion would have flipped flags on unexpectedly.
  assert.equal(resolveGuardrails({ requireEvidenceForPass: 'false' }).requireEvidenceForPass, false);
  assert.equal(resolveGuardrails({ requireBuilderContract: 'true' }).requireBuilderContract, true);
  assert.equal(resolveGuardrails({ requireEvidenceForPass: 'nope' }).requireEvidenceForPass, DEFAULT_HARNESS_GUARDRAILS.requireEvidenceForPass);
});

test('loadProjectGuardrails reads overrides from rstack.config.json and falls back on bad input', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-guardrails-'));
  try {
    const defaults = await loadProjectGuardrails(projectRoot);
    assert.deepEqual(defaults, { ...DEFAULT_HARNESS_GUARDRAILS });

    mkdirSync(join(projectRoot, '.rstack'), { recursive: true });
    writeFileSync(
      join(projectRoot, '.rstack', 'rstack.config.json'),
      JSON.stringify({ profile: 'business-flex', guardrails: { maxTaskAttempts: 3 } }),
    );
    const configured = await loadProjectGuardrails(projectRoot);
    assert.equal(configured.maxTaskAttempts, 3);
    assert.equal(configured.maxToolCallsPerTask, DEFAULT_HARNESS_GUARDRAILS.maxToolCallsPerTask);

    writeFileSync(join(projectRoot, '.rstack', 'rstack.config.json'), 'not json');
    const fallback = await loadProjectGuardrails(projectRoot);
    assert.deepEqual(fallback, { ...DEFAULT_HARNESS_GUARDRAILS });
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('isDestructiveTask recognizes destructive markers', () => {
  assert.equal(isDestructiveTask({ destructive: true }), true);
  assert.equal(isDestructiveTask({ risk_level: 'destructive' }), true);
  assert.equal(isDestructiveTask({ id: '004-implementation' }), false);
  assert.equal(isDestructiveTask(null), false);
});

test('countTaskAttempts counts only task_started events for the task', () => {
  const events = [
    { type: 'task_started', task_id: '004-implementation' },
    { type: 'task_started', task_id: '004-implementation' },
    { type: 'task_started', task_id: '002-requirements' },
    { type: 'builder_task_prepared', task_id: '004-implementation' },
  ];
  assert.equal(countTaskAttempts(events, '004-implementation'), 2);
  assert.equal(countTaskAttempts(events, '002-requirements'), 1);
  assert.equal(countTaskAttempts([], '004-implementation'), 0);
});

test('evaluateTaskClaim allows tasks under the attempt budget', () => {
  const result = evaluateTaskClaim({
    task: { id: '004-implementation' },
    events: [{ type: 'task_started', task_id: '004-implementation' }],
  });
  assert.equal(result.allowed, true);
  assert.equal(result.overridden, false);
  assert.equal(result.violations.length, 0);
});

test('evaluateTaskClaim blocks tasks at the attempt budget', () => {
  const events = [
    { type: 'task_started', task_id: '004-implementation' },
    { type: 'task_started', task_id: '004-implementation' },
  ];
  const result = evaluateTaskClaim({ task: { id: '004-implementation' }, events });
  assert.equal(result.allowed, false);
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0].rule, 'maxTaskAttempts');
  assert.equal(result.violations[0].limit, DEFAULT_HARNESS_GUARDRAILS.maxTaskAttempts);
  assert.equal(result.violations[0].observed, 2);
  assert.equal(result.override_artifact, 'guardrail-override:004-implementation');
});

test('evaluateTaskClaim applies the stricter destructive attempt budget', () => {
  const events = [{ type: 'task_started', task_id: '009-deploy' }];
  const result = evaluateTaskClaim({ task: { id: '009-deploy', destructive: true }, events });
  assert.equal(result.allowed, false);
  assert.equal(result.violations[0].rule, 'maxDestructiveTaskAttempts');
  assert.equal(result.violations[0].limit, DEFAULT_HARNESS_GUARDRAILS.maxDestructiveTaskAttempts);
});

// Complete, audit-passing approval record — the #133 consistency audit
// requires actor, timestamp, and exact status casing before any record may
// unblock work.
function approvalRecord(artifact, status, overrides = {}) {
  return { id: `app-${status}`, artifact, status, approver: 'Manager Maya', timestamp: '2026-07-06T10:00:00.000Z', ...overrides };
}

test('evaluateTaskClaim honors an APPROVED guardrail override, latest record wins', () => {
  const events = [
    { type: 'task_started', task_id: '004-implementation' },
    { type: 'task_started', task_id: '004-implementation' },
  ];
  const artifact = guardrailOverrideArtifact('004-implementation');

  const approved = evaluateTaskClaim({
    task: { id: '004-implementation' },
    events,
    approvals: [approvalRecord(artifact, 'APPROVED')],
  });
  assert.equal(approved.allowed, true);
  assert.equal(approved.overridden, true);
  assert.equal(approved.violations.length, 1, 'violations stay visible for auditing');

  const consumed = evaluateTaskClaim({
    task: { id: '004-implementation' },
    events,
    approvals: [
      approvalRecord(artifact, 'APPROVED'),
      approvalRecord(artifact, 'CONSUMED'),
    ],
  });
  assert.equal(consumed.allowed, false, 'a consumed override no longer unblocks');
  assert.equal(hasGuardrailOverride([approvalRecord(artifact, 'APPROVED'), approvalRecord(artifact, 'CONSUMED')], '004-implementation'), false);
});

test('hasGuardrailOverride: malformed or tampered records never unblock (#133)', () => {
  const taskId = '004-implementation';
  const artifact = guardrailOverrideArtifact(taskId);

  // Malformed shapes are treated as absent — the task stays gated.
  assert.equal(hasGuardrailOverride([{ artifact, status: 'APPROVED' }], taskId), false, 'missing approver/timestamp');
  assert.equal(hasGuardrailOverride([approvalRecord(artifact, 'APPROVED', { approver: '  ' })], taskId), false, 'blank approver');
  assert.equal(hasGuardrailOverride([approvalRecord(artifact, 'APPROVED', { timestamp: 'yesterday-ish' })], taskId), false, 'unparseable timestamp');
  assert.equal(hasGuardrailOverride([approvalRecord(artifact, 'approved')], taskId), false, 'lowercase status is casing confusion, not a synonym');
  assert.equal(hasGuardrailOverride([approvalRecord(artifact, 'APPROVED', { source: 'business-hub' })], taskId), false, 'dashboard source without token evidence');
  assert.equal(hasGuardrailOverride(['junk', null, 42, {}], taskId), false, 'junk entries never unblock or crash');

  // Tampering the CONSUMED marker of a spent override must NOT resurrect the
  // earlier APPROVED record: the malformed LATEST record poisons the artifact.
  const tamperedConsumed = [
    approvalRecord(artifact, 'APPROVED'),
    { artifact, status: 'CONSUMED' }, // approver/timestamp stripped
  ];
  assert.equal(hasGuardrailOverride(tamperedConsumed, taskId), false, 'tampered CONSUMED does not resurrect the override');

  // A complete record with dashboard token evidence still unblocks.
  const evidenced = approvalRecord(artifact, 'APPROVED', {
    source: 'business-hub',
    actor: { name: 'Manager Maya', via: 'dashboard', tokenVerified: true },
  });
  assert.equal(hasGuardrailOverride([evidenced], taskId), true);
});

test('evaluateTaskClaim respects configured attempt budgets', () => {
  const events = [
    { type: 'task_started', task_id: '004-implementation' },
    { type: 'task_started', task_id: '004-implementation' },
  ];
  const result = evaluateTaskClaim({
    task: { id: '004-implementation' },
    events,
    guardrails: { maxTaskAttempts: 4 },
  });
  assert.equal(result.allowed, true);
});

test('evaluateBuilderTelemetry flags tool-call and message overages, ignores absent telemetry', () => {
  const over = evaluateBuilderTelemetry({
    builder: { execution: { tool_calls: 41, messages: 26 } },
  });
  assert.equal(over.ok, false);
  assert.deepEqual(over.violations.map((violation) => violation.rule).sort(), ['maxMessagesPerTask', 'maxToolCallsPerTask']);

  const under = evaluateBuilderTelemetry({ builder: { execution: { tool_calls: 12, messages: 5 } } });
  assert.equal(under.ok, true);

  const absent = evaluateBuilderTelemetry({ builder: { status: 'PASS' } });
  assert.equal(absent.ok, true);
  assert.equal(evaluateBuilderTelemetry({}).ok, true);
});

test('guardrailEvent matches the observability event shape', () => {
  const violation = { rule: 'maxTaskAttempts', limit: 2, observed: 2, reason: 'task 004-implementation already has 2 attempt(s); limit is 2' };
  const event = guardrailEvent('004-implementation', violation);
  assert.equal(event.type, 'guardrail_triggered');
  assert.equal(event.task_id, '004-implementation');
  assert.equal(event.limit_name, 'maxTaskAttempts');
  assert.equal(event.current_value, 2);
  assert.equal(event.limit_value, 2);
  // Legacy aliases used by the sdlc_trace CLI renderer
  assert.equal(event.limit, 'maxTaskAttempts');
  assert.equal(event.value, 2);
  assert.ok(event.reason.includes('004-implementation'));
});
