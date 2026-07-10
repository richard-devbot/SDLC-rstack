import test from 'node:test';
import assert from 'node:assert/strict';

import { plainLanguageSummary } from '../src/observability/alerts/engine.js';
import { buildActivityFeed } from '../src/observability/dashboard/state/feed.js';

test('loop-engineering events render specific, human-readable feed summaries', () => {
  assert.match(
    plainLanguageSummary({ type: 'guardrail_triggered', task_id: '004-implementation', reason: 'task 004-implementation already has 2 attempt(s); limit is 2' }),
    /Guardrail blocked 004-implementation — task 004-implementation already has 2 attempt/,
  );
  // Legacy events without reason still render via the limit name.
  assert.match(
    plainLanguageSummary({ type: 'guardrail_triggered', limit_name: 'maxTaskAttempts' }),
    /Guardrail blocked task — maxTaskAttempts/,
  );
  assert.match(
    plainLanguageSummary({ type: 'guardrail_overridden', task_id: '004-implementation', artifact: 'guardrail-override:004-implementation' }),
    /override consumed — 004-implementation granted exactly one more attempt/,
  );
  assert.match(
    plainLanguageSummary({ type: 'validation_failed', task_id: '004-implementation', attempt: 1, max_attempts: 2 }),
    /Validation failed — attempt 1\/2 for 004-implementation/,
  );
  assert.match(
    plainLanguageSummary({ type: 'dor_gate_blocked', task_id: '003-architecture', pending_required: ['DEC-001'] }),
    /Definition-of-Ready blocked 003-architecture — pending: DEC-001/,
  );
  // BLE-3 retry events share the retry_ prefix and must not vanish from the feed.
  assert.match(
    plainLanguageSummary({ type: 'retry_scheduled', task_id: '004-implementation', reason: 'validator failed' }),
    /retry scheduled — 004-implementation \(validator failed\)/,
  );
});

test('feed levels distinguish guardrail blocks, overrides, retries, and DoR blocks', () => {
  const run = {
    runId: 'run-x',
    projectRoot: '/tmp/p',
    manifest: { goal: 'Feed levels' },
    events: [
      { ts: '2026-07-04T00:00:01.000Z', type: 'guardrail_triggered', task_id: 't1', reason: 'over budget' },
      { ts: '2026-07-04T00:00:02.000Z', type: 'guardrail_overridden', task_id: 't1', artifact: 'guardrail-override:t1' },
      { ts: '2026-07-04T00:00:03.000Z', type: 'retry_scheduled', task_id: 't1', reason: 'validator failed' },
      { ts: '2026-07-04T00:00:04.000Z', type: 'validation_failed', task_id: 't1', attempt: 1, max_attempts: 2 },
      { ts: '2026-07-04T00:00:05.000Z', type: 'dor_gate_blocked', task_id: 't2', pending_required: ['DEC-002'] },
    ],
  };
  const feed = buildActivityFeed([run]);
  const byType = Object.fromEntries(feed.map((entry) => [entry.type, entry.level]));
  assert.equal(byType.guardrail_triggered, 'warn');
  assert.equal(byType.guardrail_overridden, 'pass');
  assert.equal(byType.retry_scheduled, 'warn');
  assert.equal(byType.validation_failed, 'fail');
  assert.equal(byType.dor_gate_blocked, 'blocked');
});
