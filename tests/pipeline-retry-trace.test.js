// owner: RStack developed by Richardson Gunde

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { buildPipelineState } from '../src/core/harness/pipeline-state.js';
import { formatPipelineStatus, recommendPipelineAction } from '../src/commands/pipeline.js';
import { buildRunReport, formatRetryTraceLine, renderTraceHtml } from '../src/observability/collectors/reporter.js';

async function tempProject() {
  return mkdtemp(path.join(os.tmpdir(), 'rstack-retry-trace-'));
}

function runDir(projectRoot, runId) {
  return path.join(projectRoot, '.rstack', 'runs', runId);
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
}

async function appendJsonl(filePath, entries) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`, 'utf8');
}

// Fixture events follow the pinned BLE-3 emitter contract:
// retry_decision { type, task_id, stage_id, attempt, max_attempts,
//   retry_recommendation, action, next_status, reason, issues[] }
// plus per-action events with the same fields minus action/next_status.
function retryDecision(overrides) {
  return {
    ts: '2026-07-05T00:00:00.000Z',
    type: 'retry_decision',
    task_id: 'task-x',
    stage_id: '07-code',
    attempt: 1,
    max_attempts: 2,
    retry_recommendation: 'retry',
    action: 'retry',
    next_status: 'READY',
    reason: 'validator found missing evidence',
    issues: ['missing evidence'],
    ...overrides,
  };
}

async function seedRetryRun(projectRoot, runId) {
  const dir = runDir(projectRoot, runId);
  await writeJson(path.join(dir, 'manifest.json'), { run_id: runId, goal: 'Retry visibility', status: 'RUNNING' });
  await writeJson(path.join(dir, 'tasks.json'), {
    tasks: [
      { id: 'task-code', status: 'READY', pipeline_agents: ['agent.07-code'] },
      { id: 'task-test', status: 'BLOCKED', pipeline_agents: ['agent.08-testing'] },
      { id: 'task-deploy', status: 'PENDING', pipeline_agents: ['agent.09-deployment'] },
    ],
  });
  await appendJsonl(path.join(dir, 'events.jsonl'), [
    // 07-code: one retry scheduled and still pending → retryable.
    retryDecision({ ts: '2026-07-05T00:00:01.000Z', task_id: 'task-code', stage_id: '07-code' }),
    {
      ts: '2026-07-05T00:00:02.000Z',
      type: 'task_retry_scheduled',
      task_id: 'task-code',
      stage_id: '07-code',
      attempt: 1,
      max_attempts: 2,
      retry_recommendation: 'retry',
      reason: 'validator found missing evidence',
      issues: ['missing evidence'],
    },
    // 08-testing: scheduled once, then exhausted → exhausted wins (latest).
    {
      ts: '2026-07-05T00:00:03.000Z',
      type: 'task_retry_scheduled',
      task_id: 'task-test',
      stage_id: '08-testing',
      attempt: 1,
      max_attempts: 2,
      retry_recommendation: 'retry',
      reason: 'flaky suite',
      issues: [],
    },
    retryDecision({
      ts: '2026-07-05T00:00:04.000Z',
      task_id: 'task-test',
      stage_id: '08-testing',
      attempt: 2,
      action: 'exhausted',
      next_status: 'BLOCKED',
      reason: 'attempt budget spent',
    }),
    {
      ts: '2026-07-05T00:00:05.000Z',
      type: 'task_retry_exhausted',
      task_id: 'task-test',
      stage_id: '08-testing',
      attempt: 2,
      max_attempts: 2,
      retry_recommendation: 'block',
      reason: 'attempt budget spent',
      issues: [],
    },
    // Human-context pause counts in the retry summary but does not flip retry_state.
    {
      ts: '2026-07-05T00:00:06.000Z',
      type: 'task_human_context_required',
      task_id: 'task-code',
      stage_id: '07-code',
      attempt: 1,
      max_attempts: 2,
      retry_recommendation: 'human_context',
      reason: 'requirements ambiguous',
      issues: ['ambiguous requirement'],
    },
    // Legacy events continue to exist and must keep flowing into the rollup.
    { ts: '2026-07-05T00:00:07.000Z', type: 'validation_failed', task_id: 'task-code', stage_id: '07-code', attempt: 1, max_attempts: 2 },
    { ts: '2026-07-05T00:00:08.000Z', type: 'guardrail_triggered', task_id: 'task-test', stage_id: '08-testing', reason: 'attempt budget' },
  ]);
  return dir;
}

test('buildPipelineState carries retry counts and per-stage retry_state', async () => {
  const projectRoot = await tempProject();
  const runId = 'run-retry';
  await seedRetryRun(projectRoot, runId);

  const state = await buildPipelineState(projectRoot, runId, { generatedAt: '2026-07-05T00:01:00.000Z' });

  // Explicit isRetryEvent coverage for the pinned contract names: both
  // retry_decision (x2) and the task_retry_* / human-context events count.
  assert.equal(state.retries.total, 6);
  assert.equal(state.retries.scheduled, 2);
  assert.equal(state.retries.exhausted, 1);
  assert.equal(state.retries.human_required, 1);
  assert.equal(state.retries.events.length, 6);
  assert.ok(state.retries.events.every((event) => event.type && event.task_id));

  const codeStage = state.stages.find((stage) => stage.id === '07-code');
  const testStage = state.stages.find((stage) => stage.id === '08-testing');
  const deployStage = state.stages.find((stage) => stage.id === '09-deployment');
  assert.equal(codeStage.retry_state, 'retryable', 'latest scheduled event → retryable');
  assert.equal(testStage.retry_state, 'exhausted', 'latest exhausted event wins over earlier scheduled');
  assert.equal(deployStage.retry_state, null, 'stages with no retry loop stay null');
});

test('retry summary is all-zero and retry_state null when no retry events exist', async () => {
  const projectRoot = await tempProject();
  const runId = 'run-quiet';
  const dir = runDir(projectRoot, runId);
  await writeJson(path.join(dir, 'manifest.json'), { run_id: runId, status: 'RUNNING' });
  await writeJson(path.join(dir, 'tasks.json'), { tasks: [{ id: 'task-code', status: 'READY', pipeline_agents: ['agent.07-code'] }] });
  await appendJsonl(path.join(dir, 'events.jsonl'), [
    { ts: '2026-07-05T00:00:01.000Z', type: 'task_started', task_id: 'task-code', stage_id: '07-code' },
  ]);

  const state = await buildPipelineState(projectRoot, runId, { generatedAt: '2026-07-05T00:01:00.000Z' });
  assert.deepEqual(state.retries, { total: 0, scheduled: 0, exhausted: 0, human_required: 0, events: [] });
  assert.ok(state.stages.every((stage) => stage.retry_state === null));
});

// ── Pipeline status CLI (unit-level, direct import) ─────────────────────────

function cliState({ retries, stages }) {
  return {
    schema_version: 1,
    run: { run_id: 'run-x', goal: 'Goal', status: 'RUNNING' },
    pipeline: { status: 'RUNNING', stages_total: stages.length, stages_passed: 0, stages_failed: 1 },
    current: { stage_id: null, task_id: null },
    stages,
    retries,
    guardrails: { total: 0, events: [] },
    approval_blockers: [],
    cost_context: { cumulative_duration_ms: 0, cumulative_cost_usd: 0, cumulative_tool_calls: 0, context_tokens_used: null, context_tokens_available: null },
  };
}

test('formatPipelineStatus shows the retry breakdown when non-zero', () => {
  const withBreakdown = cliState({
    retries: { total: 3, scheduled: 2, exhausted: 1, human_required: 0, events: [] },
    stages: [{ id: '07-code', status: 'FAILED', attempts: 2, retry_state: 'exhausted' }],
  });
  assert.match(formatPipelineStatus(withBreakdown), /Retries: 3 \(2 scheduled, 1 exhausted\)/);

  const withHuman = cliState({
    retries: { total: 4, scheduled: 2, exhausted: 1, human_required: 1, events: [] },
    stages: [{ id: '07-code', status: 'FAILED', attempts: 2, retry_state: 'exhausted' }],
  });
  assert.match(formatPipelineStatus(withHuman), /Retries: 4 \(2 scheduled, 1 exhausted, 1 awaiting human context\)/);

  const quiet = cliState({
    retries: { total: 0, scheduled: 0, exhausted: 0, human_required: 0, events: [] },
    stages: [{ id: '07-code', status: 'PASS', attempts: 1, retry_state: null }],
  });
  assert.match(formatPipelineStatus(quiet), /Retries: 0 \|/);
  assert.doesNotMatch(formatPipelineStatus(quiet), /scheduled/);

  // Legacy pipeline-state.json without breakdown fields keeps the plain count.
  const legacy = cliState({
    retries: { total: 2, events: [] },
    stages: [{ id: '07-code', status: 'PASS', attempts: 1 }],
  });
  assert.match(formatPipelineStatus(legacy), /Retries: 2 \|/);
});

test('recommendPipelineAction distinguishes exhausted from retryable failed stages', () => {
  const exhausted = {
    approval_blockers: [],
    stages: [{ id: '08-testing', status: 'FAILED', attempts: 2, retry_state: 'exhausted' }],
    current: { stage_id: null, task_id: null },
  };
  assert.match(recommendPipelineAction(exhausted), /exhausted its retry budget/);
  assert.match(recommendPipelineAction(exhausted), /approve the guardrail-override/);
  assert.match(recommendPipelineAction(exhausted), /inspect the run artifacts/);

  const retryable = {
    approval_blockers: [],
    stages: [{ id: '07-code', status: 'FAILED', attempts: 1, retry_state: 'retryable' }],
    current: { stage_id: null, task_id: null },
  };
  assert.match(recommendPipelineAction(retryable), /Re-run the builder for failed stage 07-code/);
  assert.match(recommendPipelineAction(retryable), /retry is scheduled/);

  // No retry_state → original wording is preserved.
  const plain = {
    approval_blockers: [],
    stages: [{ id: '07-code', status: 'FAILED', attempts: 1, retry_state: null }],
    current: { stage_id: null, task_id: null },
  };
  assert.match(recommendPipelineAction(plain), /Inspect or retry failed stage 07-code/);

  // Deterministic priority order intact: approvals still outrank failed stages.
  const approvalFirst = {
    approval_blockers: [{ artifact: 'plan.md', stage_id: '04-planning', status: 'PENDING' }],
    stages: [{ id: '08-testing', status: 'FAILED', attempts: 2, retry_state: 'exhausted' }],
    current: { stage_id: null, task_id: null },
  };
  assert.match(recommendPipelineAction(approvalFirst), /Resolve the pending approval for plan\.md/);
});

// ── Trace rendering (reporter seam) ──────────────────────────────────────────

test('formatRetryTraceLine renders operator-readable lines with attempt counters', () => {
  assert.equal(
    formatRetryTraceLine({ type: 'task_retry_scheduled', task_id: '004-implementation', attempt: 1, max_attempts: 2, reason: 'validator found missing evidence' }),
    '↻ retry 1/2 — task 004-implementation: validator found missing evidence',
  );
  assert.equal(
    formatRetryTraceLine({ type: 'task_retry_exhausted', task_id: '004-implementation', attempt: 2, max_attempts: 2 }),
    '⛔ retries exhausted (2/2) — task 004-implementation blocked pending guardrail-override',
  );
  assert.match(
    formatRetryTraceLine({ type: 'task_human_context_required', task_id: '003-architecture', attempt: 1, max_attempts: 2, reason: 'requirements ambiguous' }),
    /⏸ human context required — task 003-architecture .*1\/2.*requirements ambiguous/,
  );
  assert.match(
    formatRetryTraceLine({ type: 'task_blocked_by_validator', task_id: '004-implementation', reason: 'contract missing' }),
    /⛔ blocked by validator — task 004-implementation: contract missing/,
  );
  // Falls back to the first issue when reason is absent.
  assert.match(
    formatRetryTraceLine({ type: 'task_retry_scheduled', task_id: 't1', attempt: 1, max_attempts: 3, issues: ['tests_run empty'] }),
    /↻ retry 1\/3 — task t1: tests_run empty/,
  );
  // retry_decision is the audit record — its per-action twin renders instead.
  assert.equal(formatRetryTraceLine(retryDecision({})), null);
  assert.equal(formatRetryTraceLine({ type: 'tool_call', tool: 'bash' }), null);
});

test('buildRunReport attributes retry events to tasks and renderTraceHtml lists them', async () => {
  const projectRoot = await tempProject();
  const runId = 'run-html';
  const dir = await seedRetryRun(projectRoot, runId);

  const report = await buildRunReport(dir);
  const codeTrace = report.tasks['task-code'];
  const testTrace = report.tasks['task-test'];
  assert.equal(codeTrace.retry_events.length, 2, 'scheduled + human-context for task-code');
  assert.equal(testTrace.retry_events.length, 2, 'scheduled + exhausted for task-test');

  const html = renderTraceHtml(testTrace, runId);
  assert.match(html, /Retry History/);
  assert.match(html, /retry 1\/2 — task task-test: flaky suite/);
  assert.match(html, /retries exhausted \(2\/2\) — task task-test blocked pending guardrail-override/);

  // Traces built by older code (no retry_events field) must still render.
  const legacyHtml = renderTraceHtml({ ...testTrace, retry_events: undefined }, runId);
  assert.match(legacyHtml, /No retries — task completed within its first attempt/);
});
