import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_PARALLEL_TARGET,
  PARALLEL_GROUP_HARD_CAP,
  BENCHMARK_MODES,
  checkDataIndependence,
  aggregateSequentialTime,
  aggregateParallelTime,
  evaluateParallelGate,
  buildBenchmarkArtifact,
  validateParallelGroupsConfig,
} from '../src/core/harness/parallel-benchmark.js';
import { validateRstackConfig } from '../src/core/harness/config-validation.js';

// ── Data-independence ────────────────────────────────────────────────────────

test('data-independent canonical group passes', () => {
  const { ok, issues } = checkDataIndependence([
    { id: '12-security-threat-model' },
    { id: '13-compliance-checker' },
    { id: '14-cost-estimation' },
  ]);
  assert.equal(ok, true);
  assert.deepEqual(issues, []);
});

test('non-canonical stage id is rejected', () => {
  const { ok, issues } = checkDataIndependence([{ id: '004-implementation' }]);
  assert.equal(ok, false);
  assert.match(issues[0], /not a canonical stage id/);
});

test('a stage reading a group member output is a data dependency', () => {
  // 07-code produces code_report.json; if a sibling in the group reads it,
  // the group is not parallel-safe.
  const { ok, issues } = checkDataIndependence([
    { id: '07-code' },
    { id: '08-testing', reads: ['code_report.json'] },
  ]);
  assert.equal(ok, false);
  assert.match(issues.join(' '), /not data-independent/);
});

test('duplicate stage in a group is rejected', () => {
  const { ok, issues } = checkDataIndependence([
    { id: '12-security-threat-model' },
    { id: '12-security-threat-model' },
  ]);
  assert.equal(ok, false);
  assert.match(issues.join(' '), /appears twice/);
});

test('group over the hard cap is rejected, not truncated', () => {
  const members = [
    '02-requirements', '03-documentation', '05-jira',
    '12-security-threat-model', '13-compliance-checker', '14-cost-estimation',
    '10-summary',
  ].map((id) => ({ id }));
  assert.equal(members.length, PARALLEL_GROUP_HARD_CAP + 1);
  const { ok, issues } = checkDataIndependence(members);
  assert.equal(ok, false);
  assert.match(issues.join(' '), /exceeds the hard cap/);
});

test('empty group is rejected', () => {
  const { ok, issues } = checkDataIndependence([]);
  assert.equal(ok, false);
  assert.match(issues[0], /at least one stage/);
});

// ── Timing aggregation (injected, no clock) ──────────────────────────────────

const TIMINGS = {
  '12-security-threat-model': 900,
  '13-compliance-checker': 750,
  '14-cost-estimation': 600,
};

test('sequential time is the sum of durations', () => {
  const total = aggregateSequentialTime(TIMINGS, Object.keys(TIMINGS));
  assert.equal(total, 2250);
});

test('parallel time is the slowest member per group', () => {
  const total = aggregateParallelTime(TIMINGS, [Object.keys(TIMINGS)], []);
  assert.equal(total, 900); // max of the group
});

test('parallel time sums groups run in series plus solo stages', () => {
  const timings = { a: 100, b: 200, c: 50, d: 400 };
  // getCanonicalStage is not consulted by the aggregators, so synthetic ids
  // are fine here — we are testing arithmetic, not id validity.
  const total = aggregateParallelTime(
    timings,
    [['a', 'b'], ['c']], // 200 + 50
    ['d'], // + 400
  );
  assert.equal(total, 650);
});

test('missing timing throws (no silent zero)', () => {
  assert.throws(() => aggregateSequentialTime(TIMINGS, ['nope']), /missing or non-positive timing/);
  assert.throws(() => aggregateParallelTime(TIMINGS, [['nope']], []), /missing or non-positive timing/);
});

// ── The >= target gate ───────────────────────────────────────────────────────

test('gate enables when improvement meets the default 40% target', () => {
  // 2250 -> 900 == 60% faster.
  const gate = evaluateParallelGate({ seqTimeMs: 2250, parTimeMs: 900 });
  assert.equal(gate.target, DEFAULT_PARALLEL_TARGET);
  assert.equal(gate.deltaMs, 1350);
  assert.ok(Math.abs(gate.improvement - 0.6) < 1e-9);
  assert.equal(gate.meetsTarget, true);
  assert.equal(gate.enable, true);
});

test('gate keeps disabled just below target', () => {
  // 1000 -> 610 == 39% faster, under the 40% target.
  const gate = evaluateParallelGate({ seqTimeMs: 1000, parTimeMs: 610 });
  assert.equal(gate.meetsTarget, false);
  assert.equal(gate.enable, false);
  assert.match(gate.reason, /stay disabled/);
});

test('gate is exact at the boundary (>=)', () => {
  // Exactly 40% faster must enable (target is inclusive).
  const gate = evaluateParallelGate({ seqTimeMs: 1000, parTimeMs: 600 });
  assert.equal(gate.improvement, 0.4);
  assert.equal(gate.enable, true);
});

test('gate honours a custom target', () => {
  const gate = evaluateParallelGate({ seqTimeMs: 1000, parTimeMs: 700, target: 0.25 });
  assert.equal(gate.enable, true); // 30% >= 25%
});

test('gate rejects invalid inputs', () => {
  assert.throws(() => evaluateParallelGate({ seqTimeMs: 0, parTimeMs: 0 }), /seqTimeMs/);
  assert.throws(() => evaluateParallelGate({ seqTimeMs: 100, parTimeMs: -1 }), /parTimeMs/);
  assert.throws(() => evaluateParallelGate({ seqTimeMs: 100, parTimeMs: 10, target: 1 }), /target/);
});

// ── Artifact shape ───────────────────────────────────────────────────────────

test('artifact carries the Hub-consumable shape and honest mode stamp', () => {
  const gate = evaluateParallelGate({ seqTimeMs: 2250, parTimeMs: 900 });
  const artifact = buildBenchmarkArtifact({
    runId: 'run-1',
    mode: 'mock',
    stageOrder: Object.keys(TIMINGS),
    groups: [Object.keys(TIMINGS)],
    soloStages: [],
    timings: TIMINGS,
    seqTimeMs: 2250,
    parTimeMs: 900,
    gate,
  });
  assert.equal(artifact.artifact, 'parallel-benchmark');
  assert.equal(artifact.schema_version, 1);
  assert.equal(artifact.mode, 'mock');
  assert.match(artifact.measurement, /synthetic/i);
  assert.equal(artifact.seq_time_ms, 2250);
  assert.equal(artifact.par_time_ms, 900);
  assert.equal(artifact.delta_ms, 1350);
  assert.equal(artifact.meets_target, true);
  assert.equal(artifact.recommendation.enable_parallel_groups, true);
  assert.equal(typeof artifact.improvement_pct, 'number');
  // Must be JSON-serializable for the run artifact index.
  assert.doesNotThrow(() => JSON.stringify(artifact));
});

test('artifact refuses an unknown mode', () => {
  const gate = evaluateParallelGate({ seqTimeMs: 100, parTimeMs: 50 });
  assert.throws(() => buildBenchmarkArtifact({ mode: 'guess', gate, timings: {}, groups: [], stageOrder: [] }), /mode must be one of/);
  assert.deepEqual(BENCHMARK_MODES, ['mock', 'real']);
});

// ── Config validation ────────────────────────────────────────────────────────

test('valid parallel_groups config produces no issues', () => {
  const issues = validateParallelGroupsConfig({
    enabled: false,
    target: 0.4,
    require_benchmark: true,
    groups: [['12-security-threat-model', '13-compliance-checker', '14-cost-estimation']],
  });
  assert.deepEqual(issues, []);
});

test('non-object parallel_groups is flagged', () => {
  const issues = validateParallelGroupsConfig([]);
  assert.match(issues[0].problem, /must be an object/);
});

test('unknown key and bad target are flagged', () => {
  const issues = validateParallelGroupsConfig({ target: 1.5, bogus: true });
  assert.ok(issues.some((i) => i.field === 'parallel_groups.bogus'));
  assert.ok(issues.some((i) => i.field === 'parallel_groups.target' && /fraction/.test(i.problem)));
});

test('non-data-independent group in config is flagged', () => {
  const issues = validateParallelGroupsConfig({
    groups: [['not-a-stage', '12-security-threat-model']],
  });
  assert.ok(issues.some((i) => i.field === 'parallel_groups.groups[0]'));
});

test('enabled:true with no groups is flagged as a contradiction', () => {
  const issues = validateParallelGroupsConfig({ enabled: true, groups: [] });
  assert.ok(issues.some((i) => i.field === 'parallel_groups.enabled' && /nothing to run/.test(i.problem)));
});

test('non-boolean enabled is flagged', () => {
  const issues = validateParallelGroupsConfig({ enabled: 'yes' });
  assert.ok(issues.some((i) => i.field === 'parallel_groups.enabled'));
});

// ── Wired into the shared rstack.config.json validator (#159) ─────────────────

test('validateRstackConfig routes parallel_groups issues with the parallel_groups field prefix', () => {
  const issues = validateRstackConfig({ parallel_groups: { enabled: true, groups: [] } });
  assert.ok(issues.some((i) => i.field === 'parallel_groups.enabled' && /nothing to run/.test(i.problem)));
});

test('validateRstackConfig accepts a valid parallel_groups block', () => {
  assert.deepEqual(
    validateRstackConfig({
      parallel_groups: {
        enabled: false,
        target: 0.4,
        groups: [['12-security-threat-model', '13-compliance-checker', '14-cost-estimation']],
      },
    }),
    [],
  );
});
