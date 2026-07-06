import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { extractBuilderTelemetry, builderTelemetryEvents, telemetryMetricsUpdate } from '../src/core/harness/telemetry.js';
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
  assert.deepEqual(extractBuilderTelemetry(null), { cost: null, tokens: null, tools_used_count: null, context: null });
  assert.deepEqual(extractBuilderTelemetry({}), { cost: null, tokens: null, tools_used_count: null, context: null });
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
