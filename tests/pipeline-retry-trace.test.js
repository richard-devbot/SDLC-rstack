// owner: RStack developed by Richardson Gunde

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { buildPipelineState } from '../src/core/harness/pipeline-state.js';

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
