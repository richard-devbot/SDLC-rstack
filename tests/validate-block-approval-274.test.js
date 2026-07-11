import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import extension from '../extensions/rstack-sdlc.ts';

// owner: RStack developed by Richardson Gunde
//
// #274 (found live during the #261–#266 wave verification): when the retry
// policy exhausts a task at VALIDATE time (FAIL → BLOCKED via
// classifyRetryDecision), no approval-queue entry was ever created —
// appendApprovalRequest only fired inside sdlc_build_next's gates, and the
// claim-time anti-flood dedupe then skipped its enqueue for the
// already-BLOCKED task. Net: the guardrail-override card never appeared on
// the Hub's Approvals surface, and no one was paged. These pins prove the
// card is enqueued at the moment of exhaustion and never duplicated.

const mockPi = {
  tools: {},
  commands: {},
  on: () => {},
  registerTool(tool) {
    this.tools[tool.name] = tool;
  },
  registerCommand() {}
};

function readQueue(projectRoot) {
  const path = join(projectRoot, '.rstack', 'approvals.jsonl');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

test('validate-time retry exhaustion enqueues the guardrail-override approval card (#274)', async (t) => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-274-'));
  process.env.RSTACK_PROJECT_ROOT = projectRoot;
  t.after(() => {
    delete process.env.RSTACK_PROJECT_ROOT;
    rmSync(projectRoot, { recursive: true, force: true });
  });

  extension(mockPi);

  const start = await mockPi.tools.sdlc_start.execute('1', { goal: 'Validate-time exhaustion card' });
  const runId = start.details.run_id;
  await mockPi.tools.sdlc_plan.execute('2', { run_id: runId });
  await mockPi.tools.sdlc_approve.execute('3', { run_id: runId, artifact: 'plan.md', status: 'APPROVED' });

  const claim = await mockPi.tools.sdlc_build_next.execute('4', { run_id: runId });
  const taskId = claim.details.task.id;
  const overrideArtifact = `guardrail-override:${taskId}`;

  await t.test('first FAIL (retry scheduled): no card yet', async () => {
    await mockPi.tools.sdlc_validate.execute('5', { run_id: runId, task_id: taskId });
    assert.ok(!readQueue(projectRoot).some((entry) => entry.artifact === overrideArtifact),
      'a retryable FAIL must not page for an override');
  });

  await t.test('exhaustion at validate: the card appears, pending, run/task-scoped', async () => {
    // Attempt 2 (default maxTaskAttempts) — this validate stamps BLOCKED.
    await mockPi.tools.sdlc_build_next.execute('6', { run_id: runId });
    await mockPi.tools.sdlc_validate.execute('7', { run_id: runId, task_id: taskId });

    const cards = readQueue(projectRoot).filter((entry) => entry.artifact === overrideArtifact);
    assert.equal(cards.length, 1, 'exactly one override card is enqueued at exhaustion');
    assert.equal(cards[0].status, 'pending');
    assert.equal(cards[0].runId, runId);
    assert.equal(cards[0].taskId, taskId);
    assert.equal(cards[0].source, 'retry_budget_exhausted');
    assert.match(cards[0].title, /Override guardrail/);
  });

  await t.test('a later claim attempt does not duplicate the card (shared queue id)', async () => {
    // sdlc_build_next re-selects the BLOCKED task; the claim gate returns the
    // blocked response and — with the card already queued under the same id —
    // must not mint a second entry.
    await mockPi.tools.sdlc_build_next.execute('8', { run_id: runId });
    const cards = readQueue(projectRoot).filter((entry) => entry.artifact === overrideArtifact && entry.status === 'pending');
    assert.equal(cards.length, 1, 'still exactly one pending card');
  });

  await t.test('approving the override resumes the task and the loop closes', async () => {
    await mockPi.tools.sdlc_approve.execute('9', { run_id: runId, artifact: overrideArtifact, status: 'APPROVED' });
    const resume = await mockPi.tools.sdlc_build_next.execute('10', { run_id: runId });
    assert.equal(resume.details.task.id, taskId, 'the override-approved task resumes');
  });
});
