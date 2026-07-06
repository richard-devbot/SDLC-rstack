import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { deriveRunTotals, persistedTokenTotals, resolveRunTotals } from '../src/observability/metrics/derive.js';
import { entryFromRun } from '../src/observability/dashboard/state/rollup-index.js';
import { toClientState } from '../src/observability/dashboard/state/client-state.js';
import { buildRunReport } from '../src/observability/collectors/reporter.js';

// owner: RStack developed by Richardson Gunde
//
// Read-path coverage for #83: persisted cumulative metrics are preferred,
// legacy runs without token fields still render from event recompute.

const COST_EVENTS = [
  { type: 'run_started', ts: '2026-07-01T05:00:00.000Z' },
  { type: 'cost_recorded', usd: 0.25, tokens: 12000, ts: '2026-07-01T05:01:00.000Z' },
  { type: 'cost_recorded', usd: 0.15, tokens: 8000, ts: '2026-07-01T05:02:00.000Z' },
];

test('persistedTokenTotals reads the incremental metrics shape and rejects legacy values', () => {
  assert.deepEqual(
    persistedTokenTotals({ cumulative_tokens: { input: 100, output: 50, total: 150 } }),
    { input: 100, output: 50, total: 150 },
  );
  // total derived when missing; malformed members collapse to 0
  assert.deepEqual(
    persistedTokenTotals({ cumulative_tokens: { input: 100, output: 'junk' } }),
    { input: 100, output: 0, total: 100 },
  );
  assert.equal(persistedTokenTotals({}), null);
  assert.equal(persistedTokenTotals({ cumulative_tokens: 20000 }), null);
  assert.equal(persistedTokenTotals(null), null);
});

test('resolveRunTotals prefers persisted cumulative metrics over event recompute', () => {
  const totals = resolveRunTotals(COST_EVENTS, {
    cumulative_cost_usd: 0.9,
    cumulative_tokens: { input: 40000, output: 10000, total: 50000 },
  });
  assert.equal(totals.cost_usd, 0.9);
  assert.equal(totals.tokens, 50000);
  // Event-derived dimensions are untouched.
  assert.equal(totals.duration_ms, 2 * 60 * 1000);
});

test('resolveRunTotals falls back to event recompute for legacy runs', () => {
  const legacyMetrics = { cumulative_cost_usd: 0, stage_status: { '07-code': 'PASS' } };
  const totals = resolveRunTotals(COST_EVENTS, legacyMetrics);
  assert.equal(totals.cost_usd, 0.4);
  assert.equal(totals.tokens, 20000);
  assert.deepEqual(totals, deriveRunTotals(COST_EVENTS));
});

test('rollup index entry carries object token totals and per-stage telemetry maps', () => {
  const run = {
    runId: 'run-telemetry',
    manifest: { created_at: '2026-07-01T05:00:00.000Z' },
    derivedStatus: 'active',
    metrics: {
      cumulative_cost_usd: 0.42,
      cumulative_tokens: { input: 12000, output: 3000, total: 15000 },
      stage_cost_usd: { '07-code': 0.42 },
      stage_tokens: { '07-code': { input: 12000, output: 3000, total: 15000 } },
    },
    totals: null,
    tasks: [],
    events: [{ type: 'context_recorded', ts: '2026-07-01T05:01:00.000Z' }],
  };
  const entry = entryFromRun(run);
  assert.equal(entry.tokens, 15000, 'object-shaped cumulative_tokens must not collapse to 0');
  assert.equal(entry.cost_usd, 0.42);
  assert.deepEqual(entry.metrics.stage_cost_usd, { '07-code': 0.42 });
  assert.deepEqual(entry.metrics.stage_tokens['07-code'], { input: 12000, output: 3000, total: 15000 });
  // context_recorded is high-volume telemetry — excluded from notable events.
  assert.deepEqual(entry.notable_events, []);
});

test('client state surfaces per-stage cost/tokens for Run Analytics', () => {
  const state = toClientState({
    runs: [{
      runId: 'run-telemetry',
      metrics: {
        stage_cost_usd: { '07-code': 0.42 },
        stage_tokens: { '07-code': { input: 12000, output: 3000, total: 15000 } },
      },
      events: [],
      evidence: [],
      tasks: [],
    }],
  });
  assert.deepEqual(state.runs[0].stageCost, { '07-code': 0.42 });
  assert.deepEqual(state.runs[0].stageTokens, { '07-code': { input: 12000, output: 3000, total: 15000 } });
  // Legacy runs without the maps degrade to empty objects, not crashes.
  const legacy = toClientState({ runs: [{ runId: 'legacy', metrics: {}, events: [], evidence: [], tasks: [] }] });
  assert.deepEqual(legacy.runs[0].stageCost, {});
  assert.deepEqual(legacy.runs[0].stageTokens, {});
});

test('buildRunReport cost summary prefers persisted metrics and falls back to events', async () => {
  const baseDir = mkdtempSync(join(tmpdir(), 'rstack-report-metrics-'));
  try {
    const eventsJsonl = `${COST_EVENTS.map((event) => JSON.stringify(event)).join('\n')}\n`;

    const persistedRun = join(baseDir, 'run-persisted');
    mkdirSync(persistedRun, { recursive: true });
    writeFileSync(join(persistedRun, 'manifest.json'), JSON.stringify({ run_id: 'run-persisted' }));
    writeFileSync(join(persistedRun, 'events.jsonl'), eventsJsonl);
    writeFileSync(join(persistedRun, 'tasks.json'), JSON.stringify({ tasks: [] }));
    writeFileSync(join(persistedRun, 'metrics.json'), JSON.stringify({
      cumulative_cost_usd: 0.9,
      cumulative_tokens: { input: 40000, output: 10000, total: 50000 },
    }));
    const persistedReport = await buildRunReport(persistedRun);
    assert.equal(persistedReport.cost_summary.total_usd, 0.9);
    assert.equal(persistedReport.cost_summary.total_tokens, 50000);
    assert.equal(persistedReport.cost_summary.source, 'metrics');
    assert.equal(persistedReport.cost_summary.entries.length, 2);

    const legacyRun = join(baseDir, 'run-legacy');
    mkdirSync(legacyRun, { recursive: true });
    writeFileSync(join(legacyRun, 'manifest.json'), JSON.stringify({ run_id: 'run-legacy' }));
    writeFileSync(join(legacyRun, 'events.jsonl'), eventsJsonl);
    writeFileSync(join(legacyRun, 'tasks.json'), JSON.stringify({ tasks: [] }));
    const legacyReport = await buildRunReport(legacyRun);
    assert.equal(legacyReport.cost_summary.total_usd, 0.4);
    assert.equal(legacyReport.cost_summary.total_tokens, 20000);
    assert.equal(legacyReport.cost_summary.source, 'events');
  } finally {
    rmSync(baseDir, { recursive: true, force: true });
  }
});
