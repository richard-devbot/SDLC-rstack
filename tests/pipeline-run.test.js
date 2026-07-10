import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { planNextAction, runPipeline } from '../src/commands/pipeline-run.js';

const execFileAsync = promisify(execFile);
const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'rstack-agents.js');

function seedRun(projectRoot, runId, { tasks, approvals = [], events = [], taskFiles = {} }) {
  const runDir = path.join(projectRoot, '.rstack', 'runs', runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(path.join(runDir, 'manifest.json'), JSON.stringify({ run_id: runId, goal: 'Runner fixture', status: 'IN_PROGRESS' }));
  writeFileSync(path.join(runDir, 'tasks.json'), JSON.stringify({ tasks }));
  writeFileSync(path.join(runDir, 'approvals.json'), JSON.stringify(approvals));
  writeFileSync(path.join(runDir, 'events.jsonl'), events.map((event) => JSON.stringify(event)).join('\n') + (events.length ? '\n' : ''));
  for (const [taskId, files] of Object.entries(taskFiles)) {
    const taskDir = path.join(runDir, 'tasks', taskId);
    mkdirSync(taskDir, { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(path.join(taskDir, name), typeof content === 'string' ? content : JSON.stringify(content));
    }
  }
  return runDir;
}

const task = (id, status, extra = {}) => ({ id, title: id, status, stage_artifacts: [{ stage_id: '07-code' }], ...extra });

test('runner skips PASS work and claims the next pending task via the injected invoker', async () => {
  const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'rstack-run-'));
  seedRun(projectRoot, 'run-a', { tasks: [task('001-env', 'PASS'), task('002-req', 'PENDING')] });

  const calls = [];
  const invokeTool = async (tool, params) => {
    calls.push({ tool, params });
    // Simulate sdlc_build_next: stamp IN_PROGRESS + write the packet.
    const runDir = path.join(projectRoot, '.rstack', 'runs', 'run-a');
    writeFileSync(path.join(runDir, 'tasks.json'), JSON.stringify({ tasks: [task('001-env', 'PASS'), task('002-req', 'IN_PROGRESS')] }));
    mkdirSync(path.join(runDir, 'tasks', '002-req'), { recursive: true });
    writeFileSync(path.join(runDir, 'tasks', '002-req', 'prompt.md'), '# packet');
  };

  const report = await runPipeline(projectRoot, { runId: 'run-a', invokeTool });
  assert.deepEqual(calls.map((call) => call.tool), ['sdlc_build_next']);
  assert.equal(report.steps[0].action, 'claim');
  assert.equal(report.steps[0].task_id, '002-req', 'PASS task must be skipped');
  assert.equal(report.stopped_on, 'missing_contract', 'runner stops once the packet awaits agent execution');
});

test('runner validates an active task that has a builder contract', async () => {
  const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'rstack-run-'));
  seedRun(projectRoot, 'run-a', {
    tasks: [task('001-env', 'IN_PROGRESS')],
    taskFiles: { '001-env': { 'builder.json': { task_id: '001-env', status: 'PASS' } } },
  });

  const calls = [];
  const invokeTool = async (tool) => {
    calls.push(tool);
    // Simulate sdlc_validate: PASS the task.
    const runDir = path.join(projectRoot, '.rstack', 'runs', 'run-a');
    writeFileSync(path.join(runDir, 'tasks.json'), JSON.stringify({ tasks: [task('001-env', 'PASS')] }));
  };

  const report = await runPipeline(projectRoot, { runId: 'run-a', invokeTool });
  assert.deepEqual(calls, ['sdlc_validate']);
  assert.equal(report.stopped_on, 'complete');
});

test('runner re-enters a retryable FAIL task but stops on exhausted retry budget', async () => {
  const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'rstack-run-'));
  // One attempt recorded: under the default budget of 2 -> retryable.
  seedRun(projectRoot, 'run-a', {
    tasks: [task('001-env', 'FAIL')],
    events: [{ ts: '2026-07-05T00:00:01.000Z', type: 'task_started', task_id: '001-env' }],
  });
  const dry = await runPipeline(projectRoot, { runId: 'run-a', dryRun: true });
  assert.equal(dry.steps[0].action, 'claim');
  assert.equal(dry.steps[0].retry, true);

  // Two attempts recorded: at budget -> exhausted, needs an override.
  const projectRoot2 = mkdtempSync(path.join(os.tmpdir(), 'rstack-run-'));
  seedRun(projectRoot2, 'run-a', {
    tasks: [task('001-env', 'BLOCKED')],
    events: [
      { ts: '2026-07-05T00:00:01.000Z', type: 'task_started', task_id: '001-env' },
      { ts: '2026-07-05T00:00:02.000Z', type: 'task_started', task_id: '001-env' },
    ],
  });
  const report = await runPipeline(projectRoot2, { runId: 'run-a', invokeTool: async () => assert.fail('must not invoke') });
  assert.equal(report.stopped_on, 'blocked_retry_policy');
  assert.match(report.steps[0].detail, /guardrail-override:001-env/);
});

test('runner stops on pending approvals and on ask_user without invoking anything', async () => {
  const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'rstack-run-'));
  seedRun(projectRoot, 'run-a', {
    tasks: [task('001-env', 'PENDING')],
    approvals: [{ artifact: 'plan.md', status: 'PENDING' }],
  });
  const report = await runPipeline(projectRoot, { runId: 'run-a', invokeTool: async () => assert.fail('must not invoke') });
  assert.equal(report.stopped_on, 'pending_approval');
  assert.match(report.steps[0].detail, /plan\.md/);

  const projectRoot2 = mkdtempSync(path.join(os.tmpdir(), 'rstack-run-'));
  seedRun(projectRoot2, 'run-a', { tasks: [task('001-env', 'NEEDS_CONTEXT')] });
  const report2 = await runPipeline(projectRoot2, { runId: 'run-a', invokeTool: async () => assert.fail('must not invoke') });
  assert.equal(report2.stopped_on, 'ask_user');
});

test('dry-run writes no state at all and max-steps caps live steps', async () => {
  const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'rstack-run-'));
  const runDir = seedRun(projectRoot, 'run-a', { tasks: [task('001-env', 'PENDING')] });

  const dry = await runPipeline(projectRoot, { runId: 'run-a', dryRun: true, invokeTool: async () => assert.fail('dry-run must not invoke') });
  assert.equal(dry.stopped_on, 'dry_run');
  assert.equal(dry.steps[0].action, 'claim');
  assert.ok(!existsSync(path.join(runDir, 'pipeline-state.json')), 'dry-run must not even persist the rollup');

  // Live: an invoker that never resolves the work exercises the step cap.
  const report = await runPipeline(projectRoot, { runId: 'run-a', maxSteps: 2, invokeTool: async () => {} });
  assert.equal(report.stopped_on, 'max_steps');
  assert.equal(report.steps.length, 2);
});

test('planNextAction is deterministic on junk input', () => {
  const plan = planNextAction({ state: { approval_blockers: [] }, tasks: [], events: [], approvals: [], guardrails: undefined });
  assert.equal(plan.action, 'stop');
  assert.equal(plan.stopped_on, 'no_actionable_work');
});

test('CLI: pipeline run --dry-run --json emits the structured report and exits 0', async () => {
  const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'rstack-run-cli-'));
  seedRun(projectRoot, 'run-a', { tasks: [task('001-env', 'PENDING')] });
  const { stdout } = await execFileAsync(process.execPath, [BIN, 'pipeline', 'run', '--project', projectRoot, '--dry-run', '--json']);
  const report = JSON.parse(stdout);
  assert.equal(report.stopped_on, 'dry_run');
  assert.equal(report.steps[0].action, 'claim');
  assert.equal(report.steps[0].dry_run, true);
});
