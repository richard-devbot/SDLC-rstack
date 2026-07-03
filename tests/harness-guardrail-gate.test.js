import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, mkdtempSync, appendFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import extension from '../extensions/rstack-sdlc.ts';

// Mock Pi Extension API
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

function readEvents(runDir) {
  const path = join(runDir, 'events.jsonl');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

test('Guardrail gate blocks over-budget claims and honors one-shot overrides', async (t) => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-guardrail-gate-'));
  process.env.RSTACK_PROJECT_ROOT = projectRoot;

  extension(mockPi);

  const start = await mockPi.tools.sdlc_start.execute('1', { goal: 'Guardrail gate check' });
  const runId = start.details.run_id;
  const runDir = join(projectRoot, '.rstack', 'runs', runId);

  await mockPi.tools.sdlc_plan.execute('2', { run_id: runId });
  const firstTaskId = readJson(join(runDir, 'tasks.json')).tasks[0].id;
  const overrideArtifact = `guardrail-override:${firstTaskId}`;

  // Satisfy the standing human approval gate so only the guardrail gate is under test.
  await mockPi.tools.sdlc_approve.execute('3', { run_id: runId, artifact: 'plan.md', status: 'APPROVED' });

  await t.test('claim under the attempt budget proceeds', async () => {
    const res = await mockPi.tools.sdlc_build_next.execute('4', { run_id: runId });
    assert.ok(!res.content[0].text.includes('Guardrail blocked'), res.content[0].text);
    const tasks = readJson(join(runDir, 'tasks.json')).tasks;
    assert.equal(tasks.find((task) => task.id === firstTaskId).status, 'IN_PROGRESS');
  });

  await t.test('a task at the attempt budget is blocked, evented, and queued for override approval', async () => {
    // Simulate a failed first attempt plus an earlier burned attempt: FAIL status
    // with two task_started events on record puts the task at the default budget.
    // Claiming prefers PENDING tasks over FAIL retries, so park the rest as PASS
    // to make the burned-out task the only claimable one.
    const tasksPath = join(runDir, 'tasks.json');
    const taskState = readJson(tasksPath);
    for (const task of taskState.tasks) {
      task.status = task.id === firstTaskId ? 'FAIL' : 'PASS';
    }
    writeFileSync(tasksPath, JSON.stringify(taskState, null, 2));
    appendFileSync(join(runDir, 'events.jsonl'), JSON.stringify({ ts: new Date().toISOString(), type: 'task_started', task_id: firstTaskId }) + '\n');

    const res = await mockPi.tools.sdlc_build_next.execute('5', { run_id: runId });
    assert.ok(res.content[0].text.includes(`Guardrail blocked ${firstTaskId}`), res.content[0].text);
    assert.equal(res.details.override_artifact, overrideArtifact);
    assert.ok(res.details.guardrail_violations[0].rule === 'maxTaskAttempts');

    // A blocked claim hard-blocks the task for auditability — never IN_PROGRESS.
    assert.equal(readJson(tasksPath).tasks.find((task) => task.id === firstTaskId).status, 'BLOCKED');

    const guardrailEvents = readEvents(runDir).filter((event) => event.type === 'guardrail_triggered');
    assert.ok(guardrailEvents.length >= 1);
    const latest = guardrailEvents[guardrailEvents.length - 1];
    assert.equal(latest.task_id, firstTaskId);
    assert.equal(latest.limit_name, 'maxTaskAttempts');
    assert.equal(latest.limit, 'maxTaskAttempts');

    // The override request lands in the tracker approval queue for the Business Hub.
    const queuePath = join(projectRoot, '.rstack', 'approvals.jsonl');
    assert.ok(existsSync(queuePath), 'approval queue should exist');
    const queued = readFileSync(queuePath, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
    assert.ok(queued.some((entry) => entry.artifact === overrideArtifact && entry.status === 'pending'));
  });

  await t.test('repeated claims while blocked do not flood events or notifications', async () => {
    const before = readEvents(runDir).filter((event) => event.type === 'guardrail_triggered').length;
    const res = await mockPi.tools.sdlc_build_next.execute('5b', { run_id: runId });
    assert.ok(res.content[0].text.includes(`Guardrail blocked ${firstTaskId}`), res.content[0].text);
    const after = readEvents(runDir).filter((event) => event.type === 'guardrail_triggered').length;
    assert.equal(after, before, 'already-BLOCKED claims must not append new guardrail events');
  });

  await t.test('an APPROVED override allows exactly one more attempt and is consumed', async () => {
    await mockPi.tools.sdlc_approve.execute('6', { run_id: runId, artifact: overrideArtifact, status: 'APPROVED' });

    const res = await mockPi.tools.sdlc_build_next.execute('7', { run_id: runId });
    assert.ok(!res.content[0].text.includes('Guardrail blocked'), res.content[0].text);
    assert.equal(readJson(join(runDir, 'tasks.json')).tasks.find((task) => task.id === firstTaskId).status, 'IN_PROGRESS');

    const approvals = readJson(join(runDir, 'approvals.json'));
    const overrideRecords = approvals.filter((approval) => approval.artifact === overrideArtifact);
    assert.equal(overrideRecords[overrideRecords.length - 1].status, 'CONSUMED');

    const events = readEvents(runDir);
    assert.ok(events.some((event) => event.type === 'guardrail_overridden' && event.task_id === firstTaskId));
  });

  await t.test('a consumed override no longer unblocks the task', async () => {
    const tasksPath = join(runDir, 'tasks.json');
    const taskState = readJson(tasksPath);
    taskState.tasks.find((task) => task.id === firstTaskId).status = 'FAIL';
    writeFileSync(tasksPath, JSON.stringify(taskState, null, 2));

    const res = await mockPi.tools.sdlc_build_next.execute('8', { run_id: runId });
    assert.ok(res.content[0].text.includes(`Guardrail blocked ${firstTaskId}`), res.content[0].text);
  });

  rmSync(projectRoot, { recursive: true, force: true });
});
