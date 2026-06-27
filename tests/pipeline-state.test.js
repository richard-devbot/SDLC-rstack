import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { CANONICAL_SDLC_STAGES } from '../src/core/harness/stages.js';
import {
  buildPipelineState,
  readPipelineState,
  summarizePipelineState,
  writePipelineState,
} from '../src/core/harness/pipeline-state.js';

async function tempProject() {
  return mkdtemp(path.join(os.tmpdir(), 'rstack-pipeline-state-'));
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

test('buildPipelineState derives status from canonical run files', async () => {
  const projectRoot = await tempProject();
  const runId = 'run-123';
  const dir = runDir(projectRoot, runId);

  await writeJson(path.join(dir, 'manifest.json'), {
    run_id: runId,
    goal: 'Ship a durable loop runner',
    status: 'RUNNING',
    profile: 'business-flex',
    created_at: '2026-06-21T00:00:00.000Z',
  });
  await writeJson(path.join(dir, 'tasks.json'), {
    tasks: [
      {
        id: 'task-build-code',
        title: 'Build code',
        status: 'IN_PROGRESS',
        pipeline_agents: ['agent.07-code'],
        stage_artifacts: [{ stage_id: '07-code', artifact_path: '.rstack/runs/run-123/artifacts/stages/07-code/code_report.json' }],
      },
      {
        id: 'task-test-code',
        title: 'Test code',
        status: 'PENDING',
        pipeline_agents: ['agent.08-testing'],
      },
    ],
  });
  await writeJson(path.join(dir, 'metrics.json'), {
    cumulative_duration_ms: 1200,
    cumulative_cost_usd: 0.42,
    cumulative_tool_calls: 7,
    context_tokens_used: 1000,
    context_tokens_available: 3000,
    stage_status: {
      '00-environment': 'PASS',
      '07-code': 'RUNNING',
    },
    stage_elapsed_ms: {
      '07-code': 900,
    },
  });
  await writeJson(path.join(dir, 'approvals.json'), [
    { artifact: 'plan.md', status: 'PENDING', stage_id: '04-planning' },
    { artifact: 'product-brief.md', status: 'APPROVED', stage_id: '02-requirements' },
  ]);
  await appendJsonl(path.join(dir, 'events.jsonl'), [
    { ts: '2026-06-21T00:00:01.000Z', type: 'stage_started', stage_id: '07-code', task_id: 'task-build-code' },
    { ts: '2026-06-21T00:00:02.000Z', type: 'retry_scheduled', stage_id: '07-code', task_id: 'task-build-code', reason: 'validator failed' },
    { ts: '2026-06-21T00:00:03.000Z', type: 'guardrail_blocked', stage_id: '07-code', task_id: 'task-build-code', reason: 'needs approval' },
  ]);
  await appendJsonl(path.join(dir, 'evidence.jsonl'), [
    { ts: '2026-06-21T00:00:04.000Z', task_id: 'task-build-code', stage_id: '07-code', kind: 'validation', status: 'PASS', evidence: 'tests passed' },
    { ts: '2026-06-21T00:00:05.000Z', task_id: 'task-test-code', stage: '08-testing', kind: 'validation', status: 'INFO', evidence: 'test pending' },
  ]);
  await writeJson(path.join(dir, 'artifacts', 'stages', '07-code', 'code_report.json'), { ok: true });

  const state = await buildPipelineState(projectRoot, runId, { generatedAt: '2026-06-21T00:00:05.000Z' });

  assert.equal(state.schema_version, 1);
  assert.equal(state.run.run_id, runId);
  assert.equal(state.run.goal, 'Ship a durable loop runner');
  assert.equal(state.pipeline.status, 'RUNNING');
  assert.equal(state.current.stage_id, '07-code');
  assert.equal(state.current.task_id, 'task-build-code');
  assert.deepEqual(state.stages.map((stage) => stage.id), CANONICAL_SDLC_STAGES.map((stage) => stage.id));

  const codeStage = state.stages.find((stage) => stage.id === '07-code');
  assert.equal(codeStage.status, 'RUNNING');
  assert.equal(codeStage.attempts, 2);
  assert.deepEqual(codeStage.task_ids, ['task-build-code']);
  assert.equal(codeStage.validation_status, 'PASS');
  assert.deepEqual(codeStage.evidence_paths, [
    '.rstack/runs/run-123/artifacts/stages/07-code/code_report.json',
    'evidence.jsonl#task-build-code',
  ]);
  assert.deepEqual(state.stages.find((stage) => stage.id === '08-testing').evidence_paths, ['evidence.jsonl#task-test-code']);

  assert.equal(state.retries.total, 1);
  assert.equal(state.guardrails.total, 1);
  assert.deepEqual(state.approval_blockers, [{ artifact: 'plan.md', stage_id: '04-planning', status: 'PENDING' }]);
  assert.deepEqual(state.cost_context, {
    cumulative_duration_ms: 1200,
    cumulative_cost_usd: 0.42,
    cumulative_tool_calls: 7,
    context_tokens_used: 1000,
    context_tokens_available: 3000,
  });

  assert.deepEqual(summarizePipelineState(state), {
    run_id: runId,
    status: 'RUNNING',
    current_stage_id: '07-code',
    current_task_id: 'task-build-code',
    stages_total: 15,
    stages_passed: 1,
    stages_failed: 0,
    approval_blockers: 1,
    retries: 1,
    guardrails: 1,
  });
});

test('pipeline-state write/read regenerates equivalent status and handles missing files', async () => {
  const projectRoot = await tempProject();
  const runId = 'run-missing-files';
  const dir = runDir(projectRoot, runId);

  await writeJson(path.join(dir, 'manifest.json'), { run_id: runId, status: 'STARTED' });
  await appendJsonl(path.join(dir, 'events.jsonl'), [
    { ts: '2026-06-21T00:00:01.000Z', type: 'stage_started', stage_id: '02-requirements', task_id: 'task-requirements' },
  ]);
  await mkdir(path.join(dir, 'artifacts', 'stages'), { recursive: true });

  const { state, statePath } = await writePipelineState(projectRoot, runId, { generatedAt: '2026-06-21T00:00:00.000Z' });
  assert.equal(statePath, path.join(dir, 'pipeline-state.json'));
  assert.equal(state.stages.length, CANONICAL_SDLC_STAGES.length);
  assert.equal(state.current.stage_id, '02-requirements');
  assert.equal(state.current.task_id, 'task-requirements');
  assert.equal(state.stages.find((stage) => stage.id === '02-requirements').status, 'RUNNING');
  assert.ok(state.stages.filter((stage) => stage.id !== '02-requirements').every((stage) => stage.status === 'PENDING'));

  const persisted = JSON.parse(await readFile(statePath, 'utf8'));
  assert.deepEqual(persisted, state);

  await rm(statePath);
  const regenerated = await readPipelineState(projectRoot, runId, {
    regenerateIfMissing: true,
    generatedAt: '2026-06-21T00:00:00.000Z',
  });

  assert.deepEqual(summarizePipelineState(regenerated), summarizePipelineState(state));
});
