import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, mkdtempSync, appendFileSync } from 'node:fs';
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

test('sdlc_validate drives post-validation transitions through the retry policy', async (t) => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-retry-policy-'));
  process.env.RSTACK_PROJECT_ROOT = projectRoot;

  extension(mockPi);

  const start = await mockPi.tools.sdlc_start.execute('1', { goal: 'Retry policy wiring check' });
  const runId = start.details.run_id;
  const runDir = join(projectRoot, '.rstack', 'runs', runId);

  await mockPi.tools.sdlc_plan.execute('2', { run_id: runId });
  const firstTaskId = readJson(join(runDir, 'tasks.json')).tasks[0].id;

  // Satisfy the standing human approval gate so the claim proceeds.
  await mockPi.tools.sdlc_approve.execute('3', { run_id: runId, artifact: 'plan.md', status: 'APPROVED' });
  await mockPi.tools.sdlc_build_next.execute('4', { run_id: runId });

  await t.test('a FAIL validation under budget schedules a retry and stamps the task FAIL', async () => {
    // No builder.json was written, so validation fails with retry_builder.
    const res = await mockPi.tools.sdlc_validate.execute('5', { run_id: runId, task_id: firstTaskId });
    assert.equal(res.details.status, 'FAIL');
    assert.equal(res.details.retry_recommendation, 'retry_builder');

    // FAIL keeps the task re-claimable by sdlc_build_next.
    const tasks = readJson(join(runDir, 'tasks.json')).tasks;
    assert.equal(tasks.find((task) => task.id === firstTaskId).status, 'FAIL');

    const events = readEvents(runDir);
    const decision = events.filter((event) => event.type === 'retry_decision').pop();
    assert.ok(decision, 'retry_decision event must be appended');
    assert.equal(decision.task_id, firstTaskId);
    assert.equal(decision.action, 'retry');
    assert.equal(decision.next_status, 'FAIL');
    assert.equal(decision.attempt, 1);
    assert.equal(decision.max_attempts, 2);
    assert.equal(decision.retry_recommendation, 'retry_builder');
    assert.ok('stage_id' in decision, 'retry_decision carries stage_id');
    assert.equal(typeof decision.reason, 'string');
    assert.ok(decision.reason.length > 0);
    assert.ok(Array.isArray(decision.issues));
    assert.ok(decision.issues.length > 0, 'compacted validator issues travel with the decision');

    const scheduled = events.filter((event) => event.type === 'task_retry_scheduled').pop();
    assert.ok(scheduled, 'task_retry_scheduled event must be appended');
    assert.equal(scheduled.task_id, firstTaskId);
    assert.equal(scheduled.attempt, 1);
    assert.ok(!('action' in scheduled), 'specific events omit action/next_status');

    // Backward compat: dashboards render validation_failed on the retry path.
    assert.ok(events.some((event) => event.type === 'validation_failed' && event.task_id === firstTaskId));
    assert.ok(!events.some((event) => event.type === 'task_retry_exhausted'));
  });

  await t.test('an exhausted validation stamps BLOCKED and emits task_retry_exhausted + guardrail_triggered', async () => {
    // A second recorded attempt puts the task at the default budget (2).
    appendFileSync(join(runDir, 'events.jsonl'), JSON.stringify({ ts: new Date().toISOString(), type: 'task_started', task_id: firstTaskId }) + '\n');

    const res = await mockPi.tools.sdlc_validate.execute('6', { run_id: runId, task_id: firstTaskId });
    assert.equal(res.details.status, 'FAIL');

    // BLOCKED matches the guardrail claim-gate semantics: the task needs a
    // guardrail-override approval before another attempt.
    const tasks = readJson(join(runDir, 'tasks.json')).tasks;
    assert.equal(tasks.find((task) => task.id === firstTaskId).status, 'BLOCKED');

    const events = readEvents(runDir);
    const decision = events.filter((event) => event.type === 'retry_decision').pop();
    assert.equal(decision.action, 'exhausted');
    assert.equal(decision.next_status, 'BLOCKED');
    assert.equal(decision.attempt, 2);
    assert.equal(decision.max_attempts, 2);

    const exhausted = events.filter((event) => event.type === 'task_retry_exhausted').pop();
    assert.ok(exhausted, 'task_retry_exhausted event must be appended');
    assert.equal(exhausted.task_id, firstTaskId);
    assert.equal(exhausted.attempt, 2);

    // guardrail_triggered keeps its exact pre-retry-policy shape — the claim
    // gate and dashboards key on it.
    const guardrail = events.filter((event) => event.type === 'guardrail_triggered').pop();
    assert.ok(guardrail, 'guardrail_triggered event must still be emitted');
    assert.equal(guardrail.task_id, firstTaskId);
    assert.equal(guardrail.limit_name, 'maxTaskAttempts');
    assert.equal(guardrail.limit, 'maxTaskAttempts');
    assert.equal(guardrail.current_value, 2);
    assert.equal(guardrail.limit_value, 2);
    assert.equal(guardrail.reason, `task ${firstTaskId} already has 2 attempt(s); limit is 2`);
  });

  rmSync(projectRoot, { recursive: true, force: true });
});
