import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import extension from '../extensions/rstack-sdlc.ts';

// owner: RStack developed by Richardson Gunde
//
// #266: sdlc_validate '{}' with no IN_PROGRESS task threw a raw unhandled
// Error — a state every run enters right after any validation FAIL. The
// sibling gates (approval, guardrail, DOR) all return structured responses;
// this pins the same contract for the no-task path.

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

test('sdlc_validate returns a structured response when no task is IN_PROGRESS', async (t) => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-validate-no-task-'));
  process.env.RSTACK_PROJECT_ROOT = projectRoot;
  t.after(() => {
    delete process.env.RSTACK_PROJECT_ROOT;
    rmSync(projectRoot, { recursive: true, force: true });
  });

  extension(mockPi);

  const start = await mockPi.tools.sdlc_start.execute('1', { goal: 'Validate no-task contract' });
  const runId = start.details.run_id;
  await mockPi.tools.sdlc_plan.execute('2', { run_id: runId });

  await t.test('before any claim: structured guidance, no throw', async () => {
    const res = await mockPi.tools.sdlc_validate.execute('3', { run_id: runId });
    assert.ok(Array.isArray(res.content), 'structured {content} payload, not an Error');
    assert.match(res.content[0].text, /No task is currently IN_PROGRESS/);
    assert.match(res.content[0].text, /sdlc_build_next/, 'recovery guidance names the next tool');
    assert.equal(res.details.run_id, runId);
    assert.ok(res.details.candidates.length > 0, 'details list the claimable candidates');
  });

  await t.test('the organic repro: validate → FAIL → validate again', async () => {
    await mockPi.tools.sdlc_approve.execute('4', { run_id: runId, artifact: 'plan.md', status: 'APPROVED' });
    const claim = await mockPi.tools.sdlc_build_next.execute('5', { run_id: runId });
    const taskId = claim.details.task.id;

    // No builder.json → FAIL stamps the task out of IN_PROGRESS.
    const first = await mockPi.tools.sdlc_validate.execute('6', { run_id: runId });
    assert.equal(first.details.status, 'FAIL');

    // The documented loop's very next probe used to crash with a raw Error.
    const second = await mockPi.tools.sdlc_validate.execute('7', { run_id: runId });
    assert.ok(Array.isArray(second.content));
    assert.match(second.content[0].text, /No task is currently IN_PROGRESS/);
    assert.ok(second.details.candidates.some((entry) => entry.includes(taskId)),
      'the failed task shows up in the candidate list with its status');
  });

  await t.test('an unknown explicit task_id gets the same structured shape', async () => {
    const res = await mockPi.tools.sdlc_validate.execute('8', { run_id: runId, task_id: 'no-such-task' });
    assert.ok(Array.isArray(res.content));
    assert.match(res.content[0].text, /No task with id "no-such-task"/);
    assert.equal(res.details.requested_task_id, 'no-such-task');
  });
});
