import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { writePipelineState } from '../src/core/harness/pipeline-state.js';
import { recommendPipelineAction, formatPipelineStatus } from '../src/commands/pipeline.js';

const execFileAsync = promisify(execFile);
const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'rstack-agents.js');

async function tempProject() {
  return mkdtemp(path.join(os.tmpdir(), 'rstack-pipeline-cli-'));
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

async function seedRun(projectRoot, runId, { goal = 'Ship the CLI', blockedApproval = true } = {}) {
  const dir = runDir(projectRoot, runId);
  await writeJson(path.join(dir, 'manifest.json'), {
    run_id: runId,
    goal,
    status: 'RUNNING',
    profile: 'business-flex',
    created_at: '2026-07-01T00:00:00.000Z',
  });
  await writeJson(path.join(dir, 'tasks.json'), {
    tasks: [
      {
        id: 'task-build-code',
        title: 'Build code',
        status: 'IN_PROGRESS',
        pipeline_agents: ['agent.07-code'],
        stage_artifacts: [{ stage_id: '07-code', artifact_path: `.rstack/runs/${runId}/artifacts/stages/07-code/code_report.json` }],
      },
    ],
  });
  await writeJson(path.join(dir, 'metrics.json'), {
    cumulative_duration_ms: 1200,
    cumulative_cost_usd: 0.42,
    cumulative_tool_calls: 7,
    stage_status: { '00-environment': 'PASS', '07-code': 'RUNNING', '08-testing': 'FAILED' },
  });
  await writeJson(path.join(dir, 'approvals.json'), blockedApproval
    ? [{ artifact: 'plan.md', status: 'PENDING', stage_id: '04-planning' }]
    : []);
  await appendJsonl(path.join(dir, 'events.jsonl'), [
    { ts: '2026-07-01T00:00:01.000Z', type: 'task_started', stage_id: '07-code', task_id: 'task-build-code' },
    { ts: '2026-07-01T00:00:02.000Z', type: 'retry_scheduled', stage_id: '07-code', task_id: 'task-build-code', reason: 'validator failed' },
    { ts: '2026-07-01T00:00:03.000Z', type: 'guardrail_triggered', stage_id: '07-code', task_id: 'task-build-code', reason: 'attempt budget' },
  ]);
  return dir;
}

async function runCli(args, { expectFailure = false } = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [BIN, ...args]);
    return { code: 0, stdout, stderr };
  } catch (error) {
    if (!expectFailure) throw error;
    return { code: error.code ?? 1, stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
  }
}

test('pipeline status prints run metadata, counts, blockers, events, totals, and a recommendation', async () => {
  const projectRoot = await tempProject();
  await seedRun(projectRoot, 'run-a');
  await writePipelineState(projectRoot, 'run-a', { generatedAt: '2026-07-01T00:01:00.000Z' });

  const { stdout } = await runCli(['pipeline', 'status', '--project', projectRoot, '--run-id', 'run-a']);
  assert.match(stdout, /run-a/);
  assert.match(stdout, /Ship the CLI/);
  assert.match(stdout, /RUNNING/);
  assert.match(stdout, /07-code/);
  assert.match(stdout, /task-build-code/);
  assert.match(stdout, /passed/i);
  assert.match(stdout, /failed/i);
  assert.match(stdout, /pending/i);
  assert.match(stdout, /08-testing/);
  assert.match(stdout, /Retries: 1/);
  assert.match(stdout, /Guardrail events: 1/);
  assert.match(stdout, /plan\.md/);
  assert.match(stdout, /\$0\.42/);
  assert.match(stdout, /tool calls 7/i);
  assert.match(stdout, /Next:/);
  // Highest-priority recommendation: the pending approval blocker.
  assert.match(stdout, /Next: Resolve the pending approval for plan\.md/);
});

test('pipeline status --json emits the complete pipeline-state object and nothing else', async () => {
  const projectRoot = await tempProject();
  await seedRun(projectRoot, 'run-a');
  await writePipelineState(projectRoot, 'run-a', { generatedAt: '2026-07-01T00:01:00.000Z' });

  const { stdout } = await runCli(['pipeline', 'status', '--project', projectRoot, '--run-id', 'run-a', '--json']);
  const state = JSON.parse(stdout);
  assert.equal(state.schema_version, 1);
  assert.equal(state.run.run_id, 'run-a');
  assert.ok(Array.isArray(state.stages));
  assert.equal(state.stages.length, 15);
});

test('omitting --run-id selects the latest run', async () => {
  const projectRoot = await tempProject();
  await seedRun(projectRoot, 'run-a');
  await seedRun(projectRoot, 'run-b', { goal: 'Newer run' });
  await writePipelineState(projectRoot, 'run-a');
  await writePipelineState(projectRoot, 'run-b');

  const { stdout } = await runCli(['pipeline', 'status', '--project', projectRoot, '--json']);
  assert.equal(JSON.parse(stdout).run.run_id, 'run-b');
});

test('--regenerate creates a missing pipeline-state.json and replaces malformed state', async () => {
  const projectRoot = await tempProject();
  const dir = await seedRun(projectRoot, 'run-a');
  const statePath = path.join(dir, 'pipeline-state.json');
  assert.ok(!existsSync(statePath));

  const { stdout } = await runCli(['pipeline', 'status', '--project', projectRoot, '--run-id', 'run-a', '--regenerate', '--json']);
  assert.equal(JSON.parse(stdout).run.run_id, 'run-a');
  assert.ok(existsSync(statePath), 'regenerate should persist the rollup');

  await writeFile(statePath, 'not json at all', 'utf8');
  await runCli(['pipeline', 'status', '--project', projectRoot, '--run-id', 'run-a', '--regenerate']);
  const repaired = JSON.parse(await readFile(statePath, 'utf8'));
  assert.equal(repaired.run.run_id, 'run-a');
});

test('missing or malformed state without --regenerate fails with the recovery instruction', async () => {
  const projectRoot = await tempProject();
  const dir = await seedRun(projectRoot, 'run-a');

  const missing = await runCli(['pipeline', 'status', '--project', projectRoot, '--run-id', 'run-a'], { expectFailure: true });
  assert.notEqual(missing.code, 0);
  assert.match(missing.stderr, /--regenerate/);
  assert.equal(missing.stdout, '', 'errors must not pollute stdout');

  await writeFile(path.join(dir, 'pipeline-state.json'), '{broken', 'utf8');
  const malformed = await runCli(['pipeline', 'status', '--project', projectRoot, '--run-id', 'run-a'], { expectFailure: true });
  assert.notEqual(malformed.code, 0);
  assert.match(malformed.stderr, /--regenerate/);
});

test('invalid run ids fail without reading outside .rstack/runs', async () => {
  const projectRoot = await tempProject();
  await seedRun(projectRoot, 'run-a');
  const res = await runCli(['pipeline', 'status', '--project', projectRoot, '--run-id', '../escape'], { expectFailure: true });
  assert.notEqual(res.code, 0);
  assert.match(res.stderr, /Invalid run id/);
});

test('a project with no runs fails with start-run guidance', async () => {
  const projectRoot = await tempProject();
  const res = await runCli(['pipeline', 'status', '--project', projectRoot], { expectFailure: true });
  assert.notEqual(res.code, 0);
  assert.match(res.stderr, /No RStack run found/);
});

test('recommendPipelineAction follows the deterministic priority order', () => {
  const baseStage = (id, status) => ({ id, status, attempts: 1 });

  const approvals = {
    approval_blockers: [{ artifact: 'plan.md', stage_id: '04-planning', status: 'PENDING' }],
    stages: [baseStage('07-code', 'FAILED')],
    current: { stage_id: '07-code', task_id: 't1' },
  };
  assert.match(recommendPipelineAction(approvals), /Resolve the pending approval for plan\.md/);

  const failed = {
    approval_blockers: [],
    stages: [baseStage('06-architecture', 'FAILED'), baseStage('07-code', 'PENDING')],
    current: { stage_id: '07-code', task_id: 't1' },
  };
  assert.match(recommendPipelineAction(failed), /failed stage 06-architecture/);

  const active = {
    approval_blockers: [],
    stages: [baseStage('07-code', 'RUNNING')],
    current: { stage_id: '07-code', task_id: 't1' },
  };
  assert.match(recommendPipelineAction(active), /Continue the active stage 07-code/);

  const pending = {
    approval_blockers: [],
    stages: [baseStage('00-environment', 'PASS'), baseStage('01-transcript', 'PENDING')],
    current: { stage_id: null, task_id: null },
  };
  assert.match(recommendPipelineAction(pending), /Start the first pending stage 01-transcript/);

  const complete = {
    approval_blockers: [],
    stages: [baseStage('00-environment', 'PASS'), baseStage('01-transcript', 'PASS')],
    current: { stage_id: null, task_id: null },
  };
  assert.match(recommendPipelineAction(complete), /Pipeline complete/);

  const unknown = {
    approval_blockers: [],
    stages: [baseStage('00-environment', 'SOMETHING_ODD')],
    current: { stage_id: null, task_id: null },
  };
  assert.match(recommendPipelineAction(unknown), /Inspect the run artifacts/);

  assert.match(recommendPipelineAction(null), /Inspect the run artifacts/);
});

test('formatPipelineStatus renders text without mutating state', () => {
  const state = {
    schema_version: 1,
    run: { run_id: 'run-x', goal: 'Goal', status: 'RUNNING' },
    pipeline: { status: 'RUNNING', stages_total: 2, stages_passed: 1, stages_failed: 0 },
    current: { stage_id: '07-code', task_id: 't1' },
    stages: [
      { id: '00-environment', status: 'PASS', attempts: 1 },
      { id: '07-code', status: 'RUNNING', attempts: 2 },
    ],
    retries: { total: 3, events: [] },
    guardrails: { total: 2, events: [] },
    approval_blockers: [],
    cost_context: { cumulative_duration_ms: 5000, cumulative_cost_usd: 1.5, cumulative_tool_calls: 12, context_tokens_used: null, context_tokens_available: null },
  };
  const frozen = JSON.stringify(state);
  const text = formatPipelineStatus(state);
  assert.match(text, /run-x/);
  assert.match(text, /Retries: 3/);
  assert.match(text, /Guardrail events: 2/);
  assert.equal(JSON.stringify(state), frozen, 'formatting must not mutate state');
});
