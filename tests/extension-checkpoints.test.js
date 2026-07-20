/**
 * Critical-stage checkpoint lifecycle (#132, BLE-5.2) — end-to-end through
 * the Pi extension:
 *
 *   claim (sdlc_build_next)  → stage_checkpoint_before_saved for critical stages
 *   PASS (sdlc_validate)     → stage_checkpoint_after_saved for critical stages
 *   sdlc_rollback            → pinned SUCCESS | NO_CHECKPOINT | INVALID_STAGE,
 *                              restore proven on disk, reverted event appended
 *
 * Regression guard: rollback must never accept plan task ids ("004-code") —
 * only canonical stage ids ("07-code"). See docs/HARNESS.md and #116.
 *
 * owner: RStack developed by Richardson Gunde
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import extension from '../extensions/rstack-sdlc.ts';

const mockPi = {
  tools: {},
  commands: {},
  on: () => {},
  registerTool(tool) { this.tools[tool.name] = tool; },
  registerCommand(name, command) { this.commands[name] = command; },
};

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function readEvents(runDir) {
  const path = join(runDir, 'events.jsonl');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

test('critical-stage checkpoint lifecycle: before → after → rollback round-trip', async (t) => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-cp-lifecycle-'));
  const previousProjectRoot = process.env.RSTACK_PROJECT_ROOT;
  const previousStateDir = process.env.RSTACK_STATE_DIR;
  const previousWebhook = process.env.RSTACK_SLACK_WEBHOOK;
  process.env.RSTACK_PROJECT_ROOT = projectRoot;
  delete process.env.RSTACK_STATE_DIR;
  delete process.env.RSTACK_SLACK_WEBHOOK;

  extension(mockPi);

  const start = await mockPi.tools.sdlc_start.execute('1', { goal: 'Critical-stage checkpoint lifecycle' });
  const runId = start.details.run_id;
  const runDir = join(projectRoot, '.rstack', 'runs', runId);
  await mockPi.tools.sdlc_plan.execute('2', { run_id: runId });

  // #404: the code task now IS the canonical stage 07-code (one task per
  // canonical stage). rollback still only accepts canonical stage ids — the
  // INVALID_STAGE subtest below proves a non-canonical id is rejected.
  const tasksPath = join(runDir, 'tasks.json');
  const taskState = readJson(tasksPath);
  const task = taskState.tasks.find((entry) =>
    (entry.stage_artifacts || []).some((artifact) => artifact.stage_id === '07-code'));
  assert.ok(task, 'plan should contain a task targeting 07-code');
  assert.equal(task.id, '07-code', 'the task id is now the canonical stage id');

  // Park every other task as PASS so the claim picks the 07-code task.
  for (const entry of taskState.tasks) {
    if (entry.id !== task.id) entry.status = 'PASS';
  }
  writeFileSync(tasksPath, JSON.stringify(taskState, null, 2));

  // Satisfy the standing human approval gates; only checkpoints are under test.
  for (const artifact of ['plan.md', 'requirements.json', 'architecture.md']) {
    await mockPi.tools.sdlc_approve.execute(`3-${artifact}`, { run_id: runId, artifact, status: 'APPROVED' });
  }

  // Seed a pre-existing artifact — the state a failed retry must roll back to.
  const stageDir = join(runDir, 'artifacts', 'stages', '07-code');
  mkdirSync(stageDir, { recursive: true });
  writeFileSync(join(stageDir, 'code_report.json'), '{"iteration":1}');

  await t.test('claiming a critical-stage task saves a verified pre-stage checkpoint', async () => {
    await mockPi.tools.sdlc_build_next.execute('4', { run_id: runId });
    const claimed = readJson(tasksPath).tasks.find((entry) => entry.id === task.id);
    assert.equal(claimed.status, 'IN_PROGRESS', 'the critical-stage task should be claimed');

    const beforeEvents = readEvents(runDir).filter((event) => event.type === 'stage_checkpoint_before_saved');
    assert.equal(beforeEvents.length, 1, 'exactly one pre-stage checkpoint event for the claimed critical stage');
    assert.equal(beforeEvents[0].stage_id, '07-code');
    assert.equal(beforeEvents[0].task_id, task.id);
    assert.equal(beforeEvents[0].verified, true);
    assert.ok(existsSync(join(runDir, 'checkpoints', '07-code', 'code_report.json')),
      'the event must correspond to a checkpoint directory that really exists');
  });

  await t.test('successful validation saves a verified post-stage checkpoint', async () => {
    // Builder work: the stage artifact advances past the checkpointed state.
    writeFileSync(join(stageDir, 'code_report.json'), '{"iteration":2}');
    const outputDir = join(projectRoot, task.output_dir);
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(join(outputDir, 'builder.json'), JSON.stringify({
      task_id: task.id,
      agent: 'builder',
      status: 'PASS',
      summary: 'Code stage artifacts produced for the checkpoint lifecycle fixture',
      files_modified: [],
      tests_run: ['SKIPPED: checkpoint lifecycle fixture'],
      risks: [],
      next_steps: [],
      memory_summary: { work_done: 'Produced code stage artifacts', evidence: ['tasks.json'] },
      stage_summaries: [{
        stage_id: '07-code',
        work_done: 'Stage 07-code artifacts produced for the checkpoint fixture',
        evidence: ['tasks.json'],
      }],
    }, null, 2));

    const res = await mockPi.tools.sdlc_validate.execute('5', { run_id: runId, task_id: task.id });
    assert.equal(res.details.status, 'PASS', `validation should pass: ${JSON.stringify(res.details.issues)}`);

    const events = readEvents(runDir);
    const afterEvents = events.filter((event) => event.type === 'stage_checkpoint_after_saved');
    assert.equal(afterEvents.length, 1, 'exactly one post-stage checkpoint event for the critical stage');
    assert.equal(afterEvents[0].stage_id, '07-code');
    assert.equal(afterEvents[0].task_id, task.id);
    assert.equal(afterEvents[0].verified, true);
    // The legacy all-stages event is still emitted (compat with existing consumers).
    assert.ok(events.some((event) => event.type === 'stage_checkpoint_saved' && event.stage_id === '07-code'));
    // The checkpoint slot now holds the validated artifacts.
    assert.equal(readFileSync(join(runDir, 'checkpoints', '07-code', 'code_report.json'), 'utf8'), '{"iteration":2}');
  });

  await t.test('sdlc_rollback restores the checkpointed artifacts (SUCCESS)', async () => {
    // A later retry tampers the stage: rewrites the artifact, adds junk.
    writeFileSync(join(stageDir, 'code_report.json'), '{"iteration":"TAMPERED"}');
    writeFileSync(join(stageDir, 'stray.log'), 'junk from a failed retry');

    const res = await mockPi.tools.sdlc_rollback.execute('6', { run_id: runId, stage_id: '07-code' });
    assert.equal(res.details.status, 'SUCCESS');
    assert.equal(readFileSync(join(stageDir, 'code_report.json'), 'utf8'), '{"iteration":2}');
    assert.equal(existsSync(join(stageDir, 'stray.log')), false, 'junk added after the checkpoint must not survive');

    const revertedEvents = readEvents(runDir).filter((event) => event.type === 'stage_checkpoint_reverted');
    assert.equal(revertedEvents.length, 1);
    assert.equal(revertedEvents[0].stage_id, '07-code');
  });

  await t.test('sdlc_rollback rejects non-canonical stage ids (INVALID_STAGE)', async () => {
    // A legacy plan task id ("004-code") is not a canonical stage id and must
    // be rejected — rollback only operates on canonical stage ids.
    const res = await mockPi.tools.sdlc_rollback.execute('7', { run_id: runId, stage_id: '004-code' });
    assert.equal(res.details.status, 'INVALID_STAGE');
    assert.match(res.content[0].text, /canonical/);
  });

  await t.test('sdlc_rollback without a checkpoint reports NO_CHECKPOINT, not success', async () => {
    const res = await mockPi.tools.sdlc_rollback.execute('8', { run_id: runId, stage_id: '13-compliance-checker' });
    assert.equal(res.details.status, 'NO_CHECKPOINT');
    assert.equal(
      readEvents(runDir).filter((event) => event.type === 'stage_checkpoint_reverted').length,
      1,
      'a failed rollback must not append a reverted event',
    );
  });

  await t.test('sdlc_rollback fails closed on a corrupt checkpoint (CORRUPT)', async () => {
    // Corrupt the slot: smuggle a file the integrity manifest never recorded.
    writeFileSync(join(runDir, 'checkpoints', '07-code', 'smuggled.json'), '{"payload":true}');
    writeFileSync(join(stageDir, 'code_report.json'), '{"iteration":"LIVE"}');

    const res = await mockPi.tools.sdlc_rollback.execute('9', { run_id: runId, stage_id: '07-code' });
    assert.equal(res.details.status, 'CORRUPT');
    assert.match(res.content[0].text, /integrity verification/);
    assert.equal(readFileSync(join(stageDir, 'code_report.json'), 'utf8'), '{"iteration":"LIVE"}',
      'a corrupt checkpoint must never touch the live stage artifacts');
    assert.equal(
      readEvents(runDir).filter((event) => event.type === 'stage_checkpoint_reverted').length,
      1,
      'a failed-closed rollback must not append a reverted event',
    );
    rmSync(join(runDir, 'checkpoints', '07-code', 'smuggled.json'));
  });

  await t.test('non-critical stages never emit the critical checkpoint events', () => {
    const events = readEvents(runDir);
    const pinned = events.filter((event) =>
      event.type === 'stage_checkpoint_before_saved' || event.type === 'stage_checkpoint_after_saved');
    assert.ok(pinned.every((event) => event.stage_id === '07-code'),
      `only the critical stage may carry pinned checkpoint events, got: ${JSON.stringify(pinned)}`);
  });

  rmSync(projectRoot, { recursive: true, force: true });
  if (previousProjectRoot) process.env.RSTACK_PROJECT_ROOT = previousProjectRoot;
  else delete process.env.RSTACK_PROJECT_ROOT;
  if (previousStateDir) process.env.RSTACK_STATE_DIR = previousStateDir;
  if (previousWebhook) process.env.RSTACK_SLACK_WEBHOOK = previousWebhook;
});
