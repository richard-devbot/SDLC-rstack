import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { extractBuilderTelemetry, builderTelemetryEvents, telemetryMetricsUpdate, builderContractKey } from '../src/core/harness/telemetry.js';
import { updateRunMetrics } from '../src/core/harness/run-state.js';

// owner: RStack developed by Richardson Gunde

// ── extractBuilderTelemetry ──────────────────────────────────────────────────

test('extractBuilderTelemetry reads v2 cost/context/execution fields', () => {
  const telemetry = extractBuilderTelemetry({
    task_id: '004-implementation',
    status: 'PASS',
    cost: { currency: 'USD', estimated_usd: 1.5, actual_usd: 1.25, input_tokens: 12000, output_tokens: 3000 },
    context: { profile: 'business-flex', workflow: 'feature', injected_sources: ['requirements', 'memory'], tokens_used: 42000, tokens_available: 200000 },
    execution: { tools_used: ['read_file', 'patch', 'bash'] },
  });

  assert.deepEqual(telemetry.cost, { estimated_usd: 1.5, actual_usd: 1.25, usd: 1.25, currency: 'USD' });
  assert.deepEqual(telemetry.tokens, { input: 12000, output: 3000, total: 15000 });
  assert.equal(telemetry.tools_used_count, 3);
  assert.deepEqual(telemetry.context, {
    profile: 'business-flex',
    workflow: 'feature',
    injected_source_count: 2,
    tokens_used: 42000,
    tokens_available: 200000,
  });
});

test('extractBuilderTelemetry falls back to the estimate when actual spend is missing', () => {
  const telemetry = extractBuilderTelemetry({ cost: { estimated_usd: 0.8 } });
  assert.equal(telemetry.cost.usd, 0.8);
  assert.equal(telemetry.cost.actual_usd, null);
});

test('extractBuilderTelemetry accepts the legacy bare-number cost shape', () => {
  const telemetry = extractBuilderTelemetry({ cost: 0.37 });
  assert.deepEqual(telemetry.cost, { estimated_usd: null, actual_usd: 0.37, usd: 0.37, currency: 'USD' });
  assert.equal(telemetry.tokens, null);
});

test('extractBuilderTelemetry ignores non-numeric cost and token values', () => {
  const telemetry = extractBuilderTelemetry({
    cost: { estimated_usd: 'high', actual_usd: 'unknown', input_tokens: 'many' },
    context: { profile: '', workflow: '   ' },
  });
  assert.equal(telemetry.cost, null);
  assert.equal(telemetry.tokens, null);
  // empty-string profile/workflow carry no data — context stays null
  assert.equal(telemetry.context, null);
});

test('extractBuilderTelemetry returns nulls for missing or malformed contracts', () => {
  assert.deepEqual(extractBuilderTelemetry(null), { cost: null, tokens: null, tools_used_count: null, tool_calls: null, context: null });
  assert.deepEqual(extractBuilderTelemetry({}), { cost: null, tokens: null, tools_used_count: null, tool_calls: null, context: null });
  assert.deepEqual(extractBuilderTelemetry({ cost: [], context: 'nope' }).cost, null);
});

test('extractBuilderTelemetry derives token total when only splits are present', () => {
  const telemetry = extractBuilderTelemetry({ cost: { tokens: 9000 } });
  assert.deepEqual(telemetry.tokens, { input: 0, output: 0, total: 9000 });
});

// ── builderTelemetryEvents ───────────────────────────────────────────────────

test('builderTelemetryEvents emits pinned cost_recorded and context_recorded payloads', () => {
  const telemetry = extractBuilderTelemetry({
    cost: { currency: 'USD', estimated_usd: 1.5, actual_usd: 1.25, input_tokens: 100, output_tokens: 50 },
    context: { profile: 'business-flex', workflow: 'feature', injected_sources: ['memory'] },
  });
  const events = builderTelemetryEvents('004-implementation', telemetry);
  assert.equal(events.length, 2);

  assert.deepEqual(events[0], {
    type: 'cost_recorded',
    task_id: '004-implementation',
    usd: 1.25,
    cost: 1.25,
    estimated_usd: 1.5,
    actual_usd: 1.25,
    currency: 'USD',
    tokens: 150,
    input_tokens: 100,
    output_tokens: 50,
    source: 'builder_contract',
  });
  assert.deepEqual(events[1], {
    type: 'context_recorded',
    task_id: '004-implementation',
    profile: 'business-flex',
    workflow: 'feature',
    injected_sources: 1,
    tokens_used: null,
    tokens_available: null,
    source: 'builder_contract',
  });
});

test('builderTelemetryEvents emits nothing when the contract carries no telemetry', () => {
  assert.deepEqual(builderTelemetryEvents('task', extractBuilderTelemetry({})), []);
  assert.deepEqual(builderTelemetryEvents('task', null), []);
});

// ── telemetryMetricsUpdate ───────────────────────────────────────────────────

test('telemetryMetricsUpdate splits cost and tokens evenly across canonical stages', () => {
  const telemetry = extractBuilderTelemetry({
    cost: { actual_usd: 0.5, input_tokens: 1000, output_tokens: 500 },
    context: { tokens_used: 42000, tokens_available: 200000 },
  });
  const update = telemetryMetricsUpdate(telemetry, ['07-code', '08-testing']);

  assert.equal(update.increment.cost_usd, 0.5);
  assert.deepEqual(update.increment.stage_cost_usd, { '07-code': 0.25, '08-testing': 0.25 });
  assert.deepEqual(update.increment.tokens, { input: 1000, output: 500, total: 1500 });
  assert.deepEqual(update.increment.stage_tokens, {
    '07-code': { input: 500, output: 250, total: 750 },
    '08-testing': { input: 500, output: 250, total: 750 },
  });
  assert.equal(update.context_tokens_used, 42000);
  assert.equal(update.context_tokens_available, 200000);
});

test('telemetryMetricsUpdate returns null when there is nothing to persist', () => {
  assert.equal(telemetryMetricsUpdate(extractBuilderTelemetry({}), ['07-code']), null);
  assert.equal(telemetryMetricsUpdate(null, []), null);
});

test('telemetryMetricsUpdate omits stage maps when the task has no canonical stages', () => {
  const update = telemetryMetricsUpdate(extractBuilderTelemetry({ cost: { actual_usd: 0.2 } }), []);
  assert.equal(update.increment.cost_usd, 0.2);
  assert.equal(update.increment.stage_cost_usd, undefined);
});

// ── updateRunMetrics increments (#83) ────────────────────────────────────────

test('updateRunMetrics accumulates cost/token increments across calls', async () => {
  const runDir = mkdtempSync(join(tmpdir(), 'rstack-metrics-incr-'));
  try {
    await updateRunMetrics(runDir, {
      increment: {
        cost_usd: 0.25,
        tokens: { input: 1000, output: 200, total: 1200 },
        stage_cost_usd: { '07-code': 0.25 },
        stage_tokens: { '07-code': { input: 1000, output: 200, total: 1200 } },
      },
    });
    const second = await updateRunMetrics(runDir, {
      increment: {
        cost_usd: 0.15,
        tokens: { input: 500, output: 100, total: 600 },
        stage_cost_usd: { '07-code': 0.05, '08-testing': 0.1 },
        stage_tokens: { '08-testing': { input: 500, output: 100, total: 600 } },
      },
    });

    assert.equal(second.cumulative_cost_usd, 0.4);
    assert.deepEqual(second.cumulative_tokens, { input: 1500, output: 300, total: 1800 });
    assert.deepEqual(second.stage_cost_usd, { '07-code': 0.3, '08-testing': 0.1 });
    assert.deepEqual(second.stage_tokens, {
      '07-code': { input: 1000, output: 200, total: 1200 },
      '08-testing': { input: 500, output: 100, total: 600 },
    });

    // Increments land on disk, not just in the returned object.
    const persisted = JSON.parse(readFileSync(join(runDir, 'metrics.json'), 'utf8'));
    assert.equal(persisted.cumulative_cost_usd, 0.4);
    assert.deepEqual(persisted.cumulative_tokens, { input: 1500, output: 300, total: 1800 });
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

test('concurrent metric increments both land under the file lock', async () => {
  const runDir = mkdtempSync(join(tmpdir(), 'rstack-metrics-race-'));
  try {
    await Promise.all([
      updateRunMetrics(runDir, { increment: { cost_usd: 0.1, tokens: { input: 100, output: 10, total: 110 } } }),
      updateRunMetrics(runDir, { increment: { cost_usd: 0.2, tokens: { input: 200, output: 20, total: 220 } } }),
    ]);
    const persisted = JSON.parse(readFileSync(join(runDir, 'metrics.json'), 'utf8'));
    assert.equal(persisted.cumulative_cost_usd, 0.3);
    assert.deepEqual(persisted.cumulative_tokens, { input: 300, output: 30, total: 330 });
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

test('updateRunMetrics keeps overwrite semantics for cumulative fields and never stamps token fields onto legacy runs', async () => {
  const runDir = mkdtempSync(join(tmpdir(), 'rstack-metrics-legacy-'));
  try {
    // Legacy-style metrics.json: no cumulative_tokens, no stage maps.
    writeFileSync(join(runDir, 'metrics.json'), JSON.stringify({
      cumulative_duration_ms: 1000,
      cumulative_cost_usd: 0.02,
      cumulative_tool_calls: 5,
      stage_elapsed_ms: {},
      stage_status: { '00-environment': 'PASS' },
    }));

    // An unrelated stage-status update (goal-loop reset, harvest) must not
    // materialize cumulative_tokens — its presence is the "persisted totals
    // are authoritative" marker for derive.js.
    const updated = await updateRunMetrics(runDir, { stage_status: { '01-transcript': 'PASS' } });
    assert.equal('cumulative_tokens' in updated, false);
    assert.equal('stage_cost_usd' in updated, false);
    assert.equal('stage_tokens' in updated, false);
    assert.equal(updated.stage_status['00-environment'], 'PASS');
    assert.equal(updated.stage_status['01-transcript'], 'PASS');

    // Explicit cumulative_* values still overwrite (pre-#83 behavior).
    const overwritten = await updateRunMetrics(runDir, { cumulative_cost_usd: 0.5, cumulative_tokens: { input: 10, output: 5 } });
    assert.equal(overwritten.cumulative_cost_usd, 0.5);
    assert.deepEqual(overwritten.cumulative_tokens, { input: 10, output: 5, total: 15 });
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

// ── extractBuilderTelemetry tool_calls (F4) ──────────────────────────────────

test('extractBuilderTelemetry reads execution.tool_calls as the invocation count', () => {
  const telemetry = extractBuilderTelemetry({
    execution: { tools_used: ['read_file', 'patch'], tool_calls: 17 },
  });
  // tools_used_count is distinct tool NAMES; tool_calls is total invocations.
  assert.equal(telemetry.tools_used_count, 2);
  assert.equal(telemetry.tool_calls, 17);
});

test('extractBuilderTelemetry leaves tool_calls null when execution has no count', () => {
  assert.equal(extractBuilderTelemetry({ execution: { tools_used: ['a'] } }).tool_calls, null);
  assert.equal(extractBuilderTelemetry({}).tool_calls, null);
});

test('telemetryMetricsUpdate carries tool_calls into the increment', () => {
  const update = telemetryMetricsUpdate(extractBuilderTelemetry({ execution: { tool_calls: 9 } }), []);
  assert.equal(update.increment.tool_calls, 9);
});

// ── builderContractKey (F1 idempotency) ──────────────────────────────────────

test('builderContractKey is stable across key ordering and differs on content', () => {
  const a = builderContractKey({ task_id: 't', status: 'PASS', cost: { actual_usd: 1 } });
  const b = builderContractKey({ cost: { actual_usd: 1 }, status: 'PASS', task_id: 't' });
  assert.equal(a, b, 'reordered keys hash the same');
  const c = builderContractKey({ task_id: 't', status: 'PASS', cost: { actual_usd: 2 } });
  assert.notEqual(a, c, 'different content hashes differently');
  assert.equal(builderContractKey(null), null);
});

test('telemetryMetricsUpdate stamps the idempotency key when supplied', () => {
  const update = telemetryMetricsUpdate(extractBuilderTelemetry({ cost: { actual_usd: 0.3 } }), [], 'abc123');
  assert.equal(update.increment.idempotency_key, 'abc123');
  const noKey = telemetryMetricsUpdate(extractBuilderTelemetry({ cost: { actual_usd: 0.3 } }), []);
  assert.equal('idempotency_key' in noKey.increment, false);
});

// ── updateRunMetrics idempotency (F1) ────────────────────────────────────────

test('the same contract validated 2×/3× is counted once', async () => {
  const runDir = mkdtempSync(join(tmpdir(), 'rstack-metrics-idem-'));
  try {
    const builder = { task_id: '07-code', status: 'PASS', cost: { actual_usd: 1.0, input_tokens: 1000, output_tokens: 200 } };
    const key = builderContractKey(builder);
    const telemetry = extractBuilderTelemetry(builder);
    const update = telemetryMetricsUpdate(telemetry, ['07-code'], key);

    for (let i = 0; i < 3; i++) {
      await updateRunMetrics(runDir, update);
    }
    const persisted = JSON.parse(readFileSync(join(runDir, 'metrics.json'), 'utf8'));
    assert.equal(persisted.cumulative_cost_usd, 1.0, 'a 3× loop over a $1.00 stage persists $1.00, not $3.00');
    assert.deepEqual(persisted.cumulative_tokens, { input: 1000, output: 200, total: 1200 });
    assert.deepEqual(persisted.applied_telemetry_keys, [key]);
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

test('a new contract after a genuine retry counts again', async () => {
  const runDir = mkdtempSync(join(tmpdir(), 'rstack-metrics-rerun-'));
  try {
    const first = { task_id: '07-code', status: 'FAIL', summary: 'attempt 1', cost: { actual_usd: 1.0 } };
    const second = { task_id: '07-code', status: 'PASS', summary: 'attempt 2 re-ran the builder', cost: { actual_usd: 1.0 } };
    await updateRunMetrics(runDir, telemetryMetricsUpdate(extractBuilderTelemetry(first), ['07-code'], builderContractKey(first)));
    await updateRunMetrics(runDir, telemetryMetricsUpdate(extractBuilderTelemetry(second), ['07-code'], builderContractKey(second)));
    const persisted = JSON.parse(readFileSync(join(runDir, 'metrics.json'), 'utf8'));
    // Two genuinely different attempts (different content → different keys) = real re-spend.
    assert.equal(persisted.cumulative_cost_usd, 2.0);
    assert.equal(persisted.applied_telemetry_keys.length, 2);
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

test('idempotency guard holds under concurrent replays of the same key', async () => {
  const runDir = mkdtempSync(join(tmpdir(), 'rstack-metrics-idem-race-'));
  try {
    const builder = { task_id: '07-code', cost: { actual_usd: 0.5 } };
    const update = telemetryMetricsUpdate(extractBuilderTelemetry(builder), ['07-code'], builderContractKey(builder));
    await Promise.all([
      updateRunMetrics(runDir, update),
      updateRunMetrics(runDir, update),
      updateRunMetrics(runDir, update),
    ]);
    const persisted = JSON.parse(readFileSync(join(runDir, 'metrics.json'), 'utf8'));
    assert.equal(persisted.cumulative_cost_usd, 0.5);
    assert.equal(persisted.applied_telemetry_keys.length, 1);
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

// ── mid-run upgrade seeding (F3) ─────────────────────────────────────────────

test('first new-style increment on a run with prior events seeds from history', async () => {
  const runDir = mkdtempSync(join(tmpdir(), 'rstack-metrics-seed-'));
  try {
    // Realistic legacy metrics.json: pre-#83, cost/tokens lived ONLY in
    // cost_recorded events — metrics.json carried no cumulative_cost_usd
    // accrual and no cumulative_tokens marker. The read path recomputed both.
    writeFileSync(join(runDir, 'metrics.json'), JSON.stringify({
      cumulative_duration_ms: 0,
      cumulative_cost_usd: 0,
      cumulative_tool_calls: 0,
      stage_elapsed_ms: {},
      stage_status: {},
    }));
    const builder = { task_id: '07-code', cost: { actual_usd: 0.1, input_tokens: 100, output_tokens: 20 } };
    const update = telemetryMetricsUpdate(extractBuilderTelemetry(builder), ['07-code'], builderContractKey(builder));
    // Caller recomputes the pre-upgrade history from events ($5.00, 900 tokens)
    // and passes it as the seed so no history is dropped.
    update.seed = { cost_usd: 5.0, tokens: { input: 0, output: 0, total: 900 } };
    const after = await updateRunMetrics(runDir, update);
    // Cost: seeded $5.00 + this validation's $0.10 = $5.10 (not $0.10 — F3 bug).
    assert.equal(after.cumulative_cost_usd, 5.1);
    // Tokens: seeded 900 + this validation's 120.
    assert.equal(after.cumulative_tokens.total, 1020);
    // A second increment must not re-seed (marker now present).
    const again = await updateRunMetrics(runDir, { increment: { tokens: { input: 0, output: 0, total: 5 }, idempotency_key: 'other' } });
    assert.equal(again.cumulative_cost_usd, 5.1);
    assert.equal(again.cumulative_tokens.total, 1025);
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

test('seeding does not fire once the cumulative_tokens marker exists', async () => {
  const runDir = mkdtempSync(join(tmpdir(), 'rstack-metrics-noseed-'));
  try {
    await updateRunMetrics(runDir, { increment: { tokens: { input: 10, output: 5, total: 15 }, idempotency_key: 'k1' } });
    // Marker now present; a later increment carrying a seed must ignore it.
    const after = await updateRunMetrics(runDir, {
      increment: { cost_usd: 0.1, idempotency_key: 'k2' },
      seed: { cost_usd: 99, tokens: { input: 0, output: 0, total: 99999 } },
    });
    assert.equal(after.cumulative_tokens.total, 15, 'seed ignored — marker already present');
    assert.equal(after.cumulative_cost_usd, 0.1);
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

test('updateRunMetrics tolerates malformed increments and token shapes', async () => {
  const runDir = mkdtempSync(join(tmpdir(), 'rstack-metrics-malformed-'));
  try {
    const result = await updateRunMetrics(runDir, {
      increment: {
        cost_usd: 'not-a-number',
        tokens: { input: 'garbage', output: 7 },
        stage_cost_usd: { '07-code': 'NaN' },
        stage_tokens: { '07-code': null },
      },
    });
    assert.equal(result.cumulative_cost_usd, 0);
    assert.deepEqual(result.cumulative_tokens, { input: 0, output: 7, total: 7 });
    assert.deepEqual(result.stage_cost_usd ?? {}, {});
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});
