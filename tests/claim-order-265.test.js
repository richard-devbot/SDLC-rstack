import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import extension from '../extensions/rstack-sdlc.ts';
import { planNextAction } from '../src/commands/pipeline-run.js';

// #265: the claim candidate search must address failure where it happened —
// FAIL first (retry policy engages at the point of failure), then BLOCKED
// (override gate surfaces the block instead of skipping ahead), then fresh
// PENDING/READY work. The old fresh-work-first order deferred every failure
// to the tail of the plan, leaving the #149 hard-block unreachable mid-run.

const mockPi = {
  tools: {},
  commands: {},
  on: () => {},
  registerTool(tool) {
    this.tools[tool.name] = tool;
  },
  registerCommand(cmd, opts) {
    this.commands[cmd] = opts;
  }
};

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

test('sdlc_build_next re-claims a FAIL task before any later PENDING task, then hard-blocks and resumes via override', async (t) => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-claim-order-'));
  process.env.RSTACK_PROJECT_ROOT = projectRoot;
  t.after(() => {
    delete process.env.RSTACK_PROJECT_ROOT;
    rmSync(projectRoot, { recursive: true, force: true });
  });

  extension(mockPi);

  const start = await mockPi.tools.sdlc_start.execute('1', { goal: 'Claim-order regression check' });
  const runId = start.details.run_id;
  const runDir = join(projectRoot, '.rstack', 'runs', runId);

  await mockPi.tools.sdlc_plan.execute('2', { run_id: runId });
  const tasks = readJson(join(runDir, 'tasks.json')).tasks;
  assert.ok(tasks.length >= 2, 'regression needs a multi-task plan');
  const firstTaskId = tasks[0].id;
  const secondTaskId = tasks[1].id;

  await mockPi.tools.sdlc_approve.execute('3', { run_id: runId, artifact: 'plan.md', status: 'APPROVED' });

  await t.test('attempt 1: claim serves the first task', async () => {
    const res = await mockPi.tools.sdlc_build_next.execute('4', { run_id: runId });
    assert.equal(res.details.task.id, firstTaskId);
  });

  await t.test('after a FAIL validation the SAME task is re-claimed, not the next PENDING one', async () => {
    // No builder.json on disk → validation FAILs with retry_builder.
    const validation = await mockPi.tools.sdlc_validate.execute('5', { run_id: runId, task_id: firstTaskId });
    assert.equal(validation.details.status, 'FAIL');

    const res = await mockPi.tools.sdlc_build_next.execute('6', { run_id: runId });
    assert.equal(res.details.task.id, firstTaskId, 'FAIL task must be re-claimed before later PENDING tasks');

    const after = readJson(join(runDir, 'tasks.json')).tasks;
    assert.equal(after.find((task) => task.id === secondTaskId).status, 'PENDING', 'later task must stay untouched while the failure is addressed');
  });

  await t.test('an exhausted budget surfaces BLOCKED for the failed task instead of advancing the plan', async () => {
    // Burn attempt 2 (default maxTaskAttempts is 2), then try to claim again.
    const validation = await mockPi.tools.sdlc_validate.execute('7', { run_id: runId, task_id: firstTaskId });
    assert.equal(validation.details.status, 'FAIL');

    const res = await mockPi.tools.sdlc_build_next.execute('8', { run_id: runId });
    assert.ok(res.details.guardrail_violations?.length, 'claim must return the guardrail block, not a fresh task');
    assert.equal(res.details.task.id, firstTaskId);
    assert.equal(res.details.override_artifact, `guardrail-override:${firstTaskId}`);

    const after = readJson(join(runDir, 'tasks.json')).tasks;
    assert.equal(after.find((task) => task.id === firstTaskId).status, 'BLOCKED');
    assert.equal(after.find((task) => task.id === secondTaskId).status, 'PENDING', 'the block must not be skipped by claiming later work');
  });

  await t.test('an approved guardrail override resumes the BLOCKED task before any PENDING task', async () => {
    await mockPi.tools.sdlc_approve.execute('9', { run_id: runId, artifact: `guardrail-override:${firstTaskId}`, status: 'APPROVED' });
    const res = await mockPi.tools.sdlc_build_next.execute('10', { run_id: runId });
    assert.equal(res.details.task.id, firstTaskId, 'override-approved BLOCKED task resumes ahead of fresh work');

    const after = readJson(join(runDir, 'tasks.json')).tasks;
    assert.equal(after.find((task) => task.id === firstTaskId).status, 'IN_PROGRESS');
  });
});

test('planNextAction mirrors the governed claim order', async (t) => {
  await t.test('a FAIL task is claimed before a later PENDING task', () => {
    const plan = planNextAction({
      state: { approval_blockers: [] },
      tasks: [
        { id: '001-env', status: 'PASS' },
        { id: '002-req', status: 'FAIL' },
        { id: '003-arch', status: 'PENDING' },
      ],
      events: [],
      approvals: [],
      guardrails: {},
      taskContext: {},
    });
    assert.equal(plan.action, 'claim');
    assert.equal(plan.task_id, '002-req');
    assert.equal(plan.retry, true);
  });

  await t.test('an exhausted BLOCKED task stops the run instead of silently starting fresh work', () => {
    const plan = planNextAction({
      state: { approval_blockers: [] },
      tasks: [
        { id: '001-env', status: 'BLOCKED' },
        { id: '002-req', status: 'PENDING' },
      ],
      events: [
        { type: 'task_started', task_id: '001-env' },
        { type: 'task_started', task_id: '001-env' },
      ],
      approvals: [],
      guardrails: {},
      taskContext: {},
    });
    assert.equal(plan.action, 'stop');
    assert.equal(plan.stopped_on, 'blocked_retry_policy');
    assert.equal(plan.task_id, '001-env');
  });
});
