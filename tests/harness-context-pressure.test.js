import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  DEFAULT_CONTEXT_PRESSURE_THRESHOLDS,
  CONTEXT_PRESSURE_THRESHOLD_FIELDS,
  resolveContextPressureThresholds,
  classifyContextPressure,
  validateContextPressureConfig,
  loadProjectContextPressureThresholds,
} from '../src/core/harness/context-pressure.js';
import { validateRstackConfig, validateProjectConfigs } from '../src/core/harness/config-validation.js';
import { buildPipelineState, summarizePipelineState } from '../src/core/harness/pipeline-state.js';

// owner: RStack developed by Richardson Gunde

const big = (n) => 'x'.repeat(n);

// ── resolveContextPressureThresholds ─────────────────────────────────────────

test('resolveContextPressureThresholds returns defaults with no override', () => {
  assert.deepEqual(resolveContextPressureThresholds(), { ...DEFAULT_CONTEXT_PRESSURE_THRESHOLDS });
  assert.deepEqual(resolveContextPressureThresholds(null), { ...DEFAULT_CONTEXT_PRESSURE_THRESHOLDS });
  assert.deepEqual(resolveContextPressureThresholds('nonsense'), { ...DEFAULT_CONTEXT_PRESSURE_THRESHOLDS });
});

test('resolveContextPressureThresholds merges valid fields and ignores bad ones (safe defaults)', () => {
  const resolved = resolveContextPressureThresholds({
    builder_prompt_chars: 500,
    injected_memory_chars: -1,       // invalid -> default
    context_tokens_ratio: 0.5,
    context_tokens_used: 'lots',     // invalid -> default
    unknown_key: 999,                // ignored
  });
  assert.equal(resolved.builder_prompt_chars, 500);
  assert.equal(resolved.injected_memory_chars, DEFAULT_CONTEXT_PRESSURE_THRESHOLDS.injected_memory_chars);
  assert.equal(resolved.context_tokens_ratio, 0.5);
  assert.equal(resolved.context_tokens_used, DEFAULT_CONTEXT_PRESSURE_THRESHOLDS.context_tokens_used);
  assert.ok(!('unknown_key' in resolved));
});

test('resolveContextPressureThresholds accepts config wrappers', () => {
  const nested = resolveContextPressureThresholds({ context_pressure: { thresholds: { builder_prompt_chars: 42 } } });
  assert.equal(nested.builder_prompt_chars, 42);
  const flat = resolveContextPressureThresholds({ context_pressure: { builder_prompt_chars: 43 } });
  assert.equal(flat.builder_prompt_chars, 43);
  const direct = resolveContextPressureThresholds({ thresholds: { builder_prompt_chars: 44 } });
  assert.equal(direct.builder_prompt_chars, 44);
});

// ── classifyContextPressure: threshold breach -> event ───────────────────────

test('oversized memory summary emits a context_pressure_warning', () => {
  const events = classifyContextPressure({
    taskId: '004-implementation',
    contract: { memory_summary: { context_to_keep: big(30000) } },
    thresholds: { injected_memory_chars: 24000 },
  });
  const warn = events.find((e) => e.source === 'memory_summary');
  assert.ok(warn, 'expected a memory_summary warning');
  assert.equal(warn.type, 'context_pressure_warning');
  assert.equal(warn.task_id, '004-implementation');
  assert.equal(warn.metric, 'chars');
  assert.equal(warn.blocking, false);
  assert.ok(warn.size > warn.threshold);
});

test('oversized builder prompt (task packet) emits a warning', () => {
  const events = classifyContextPressure({
    taskId: 't1',
    builderPrompt: big(1000),
    thresholds: { builder_prompt_chars: 500 },
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].source, 'builder_prompt');
  assert.equal(events[0].size, 1000);
  assert.equal(events[0].threshold, 500);
});

test('oversized injected memory block emits a warning', () => {
  const events = classifyContextPressure({
    memoryBlock: big(30000),
    thresholds: { injected_memory_chars: 24000 },
  });
  const warn = events.find((e) => e.source === 'injected_memory');
  assert.ok(warn);
  assert.ok(!('task_id' in warn), 'no task id -> no task_id field');
});

test('oversized stage summary emits a warning stamped with stage_id', () => {
  const events = classifyContextPressure({
    taskId: 't2',
    contract: { stage_summaries: [
      { stage_id: '07-code', work_done: big(9000) },
      { stage_id: '02-requirements', work_done: 'small' },
    ] },
    thresholds: { stage_summary_chars: 8000 },
  });
  const warn = events.find((e) => e.source === 'stage_summary');
  assert.ok(warn);
  assert.equal(warn.stage_id, '07-code');
  assert.equal(events.filter((e) => e.source === 'stage_summary').length, 1, 'small stage summary stays silent');
});

test('context token count and ratio each emit their own warning', () => {
  const events = classifyContextPressure({
    taskId: 't3',
    contract: { context: { tokens_used: 190000, tokens_available: 200000 } },
    thresholds: { context_tokens_used: 160000, context_tokens_ratio: 0.85 },
  });
  const count = events.find((e) => e.metric === 'tokens');
  const ratio = events.find((e) => e.metric === 'ratio');
  assert.ok(count && count.source === 'context_tokens' && count.size === 190000);
  assert.ok(ratio && ratio.source === 'context_tokens');
  assert.equal(ratio.tokens_used, 190000);
  assert.equal(ratio.tokens_available, 200000);
  assert.ok(ratio.size > 0.85 && ratio.size <= 1);
});

test('oversized artifact summary emits a warning with the artifact name', () => {
  const events = classifyContextPressure({
    taskId: 't4',
    artifactSummaries: [
      { name: 'plan.md', text: big(13000) },
      { name: 'small.md', text: 'tiny' },
    ],
    thresholds: { artifact_summary_chars: 12000 },
  });
  const warn = events.find((e) => e.source === 'artifact_summary');
  assert.ok(warn);
  assert.equal(warn.artifact, 'plan.md');
  assert.equal(events.filter((e) => e.source === 'artifact_summary').length, 1);
});

// ── under-threshold -> silence ───────────────────────────────────────────────

test('under-threshold context produces no events (silence)', () => {
  const events = classifyContextPressure({
    taskId: 't5',
    builderPrompt: 'short',
    memoryBlock: 'short',
    contract: {
      memory_summary: { context_to_keep: 'small' },
      stage_summaries: [{ stage_id: '07-code', work_done: 'small' }],
      context: { tokens_used: 1000, tokens_available: 200000 },
    },
    artifactSummaries: [{ name: 'a.md', text: 'small' }],
  });
  assert.deepEqual(events, []);
});

test('detect-only: never emits memory_pruned or artifact_summary_truncated', () => {
  const events = classifyContextPressure({
    taskId: 't6',
    builderPrompt: big(1000000),
    memoryBlock: big(1000000),
    contract: {
      memory_summary: { x: big(1000000) },
      stage_summaries: [{ stage_id: '07-code', work_done: big(1000000) }],
      context: { tokens_used: 500000, tokens_available: 200000 },
    },
    artifactSummaries: [{ name: 'a.md', text: big(1000000) }],
    thresholds: DEFAULT_CONTEXT_PRESSURE_THRESHOLDS,
  });
  assert.ok(events.length > 0, 'sanity: massive context should warn');
  for (const event of events) {
    assert.equal(event.type, 'context_pressure_warning');
    assert.notEqual(event.type, 'memory_pruned');
    assert.notEqual(event.type, 'artifact_summary_truncated');
  }
});

test('missing / malformed inputs never throw and yield no events', () => {
  assert.deepEqual(classifyContextPressure(), []);
  assert.deepEqual(classifyContextPressure({ contract: null, artifactSummaries: null }), []);
  assert.deepEqual(classifyContextPressure({ contract: 'nope', builderPrompt: 12345 }), []);
});

// ── validateContextPressureConfig ────────────────────────────────────────────

test('validateContextPressureConfig accepts a clean block', () => {
  assert.deepEqual(validateContextPressureConfig({ builder_prompt_chars: 100000, context_tokens_ratio: 0.9 }), []);
  assert.deepEqual(validateContextPressureConfig(null), []);
});

test('validateContextPressureConfig names the exact field and problem', () => {
  const issues = validateContextPressureConfig({
    builder_prompt_chars: -5,
    context_tokens_ratio: 2,
    not_a_threshold: 1,
  });
  assert.ok(issues.some((i) => i.field === 'context_pressure.builder_prompt_chars' && /positive number/.test(i.problem)));
  assert.ok(issues.some((i) => i.field === 'context_pressure.context_tokens_ratio' && /\(0, 1\]/.test(i.problem)));
  assert.ok(issues.some((i) => i.field === 'context_pressure.not_a_threshold' && /unknown context-pressure threshold key/.test(i.problem)));
});

test('validateContextPressureConfig handles the nested thresholds wrapper', () => {
  const issues = validateContextPressureConfig({ thresholds: { stage_summary_chars: 'big' } });
  assert.ok(issues.some((i) => i.field === 'context_pressure.thresholds.stage_summary_chars'));
});

test('validateContextPressureConfig rejects a non-object block', () => {
  const issues = validateContextPressureConfig('nope');
  assert.equal(issues.length, 1);
  assert.equal(issues[0].field, 'context_pressure');
});

test('all threshold fields are covered by defaults', () => {
  for (const field of CONTEXT_PRESSURE_THRESHOLD_FIELDS) {
    assert.ok(field in DEFAULT_CONTEXT_PRESSURE_THRESHOLDS, `${field} missing default`);
  }
});

// ── config-validation.js integration (#151 wiring) ───────────────────────────

test('validateRstackConfig surfaces context_pressure issues', () => {
  const issues = validateRstackConfig({ context_pressure: { builder_prompt_chars: 'huge' } });
  assert.ok(issues.some((i) => i.field === 'context_pressure.builder_prompt_chars'));
});

test('validateProjectConfigs picks up a bad context_pressure block', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-cp-'));
  mkdirSync(join(projectRoot, '.rstack'), { recursive: true });
  writeFileSync(
    join(projectRoot, '.rstack', 'rstack.config.json'),
    JSON.stringify({ context_pressure: { context_tokens_ratio: 5, bogus: 1 } }),
  );
  const problems = await validateProjectConfigs(projectRoot);
  assert.ok(problems.some((p) => p.file === '.rstack/rstack.config.json' && p.field === 'context_pressure.context_tokens_ratio'));
  assert.ok(problems.some((p) => p.field === 'context_pressure.bogus'));
});

// ── loadProjectContextPressureThresholds (malformed config -> safe defaults) ──

test('loadProjectContextPressureThresholds returns defaults when no config exists', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-cp-'));
  assert.deepEqual(await loadProjectContextPressureThresholds(projectRoot), { ...DEFAULT_CONTEXT_PRESSURE_THRESHOLDS });
});

test('loadProjectContextPressureThresholds falls back to defaults on malformed JSON', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-cp-'));
  mkdirSync(join(projectRoot, '.rstack'), { recursive: true });
  writeFileSync(join(projectRoot, '.rstack', 'rstack.config.json'), '{ not valid json');
  const thresholds = await loadProjectContextPressureThresholds(projectRoot);
  assert.deepEqual(thresholds, { ...DEFAULT_CONTEXT_PRESSURE_THRESHOLDS });
});

test('loadProjectContextPressureThresholds applies valid overrides', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-cp-'));
  mkdirSync(join(projectRoot, '.rstack'), { recursive: true });
  writeFileSync(
    join(projectRoot, '.rstack', 'rstack.config.json'),
    JSON.stringify({ context_pressure: { thresholds: { builder_prompt_chars: 7 } } }),
  );
  const thresholds = await loadProjectContextPressureThresholds(projectRoot);
  assert.equal(thresholds.builder_prompt_chars, 7);
});

// ── pipeline-state rollup: warning count surfaces ────────────────────────────

async function seedRun(runId, eventLines) {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-cp-run-'));
  const runDir = join(projectRoot, '.rstack', 'runs', runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, 'manifest.json'), JSON.stringify({ run_id: runId, status: 'RUNNING' }));
  writeFileSync(join(runDir, 'tasks.json'), JSON.stringify({ tasks: [] }));
  writeFileSync(join(runDir, 'events.jsonl'), eventLines.map((e) => JSON.stringify(e)).join('\n') + '\n');
  return projectRoot;
}

test('pipeline-state rollup counts context_pressure_warning events by source', async () => {
  const projectRoot = await seedRun('run-cp-1', [
    { type: 'context_pressure_warning', task_id: 't1', source: 'memory_summary', metric: 'chars', size: 30000, threshold: 24000, blocking: false },
    { type: 'context_pressure_warning', task_id: 't1', source: 'context_tokens', metric: 'ratio', size: 0.95, threshold: 0.85, blocking: false },
    { type: 'context_pressure_warning', task_id: 't2', source: 'memory_summary', metric: 'chars', size: 40000, threshold: 24000, blocking: false },
    { type: 'quality_score_recorded', task_id: 't1', score: 1 },
  ]);
  const state = await buildPipelineState(projectRoot, 'run-cp-1');
  assert.equal(state.context_pressure.total, 3);
  assert.equal(state.context_pressure.by_source.memory_summary, 2);
  assert.equal(state.context_pressure.by_source.context_tokens, 1);
  assert.equal(state.context_pressure.warnings.length, 3);
  assert.equal(summarizePipelineState(state).context_pressure, 3);
});

test('pipeline-state rollup reports zero pressure when none recorded', async () => {
  const projectRoot = await seedRun('run-cp-2', [{ type: 'quality_score_recorded', task_id: 't1', score: 1 }]);
  const state = await buildPipelineState(projectRoot, 'run-cp-2');
  assert.equal(state.context_pressure.total, 0);
  assert.deepEqual(state.context_pressure.by_source, {});
  assert.equal(summarizePipelineState(state).context_pressure, 0);
  // Not double-counted as a guardrail event.
  assert.equal(state.guardrails.total, 0);
});
