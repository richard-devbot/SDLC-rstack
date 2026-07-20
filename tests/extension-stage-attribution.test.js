/**
 * Regression: stage_completed events must carry canonical stage ids.
 *
 * Plan task ids (e.g. "002-requirements") are NOT canonical stage ids
 * (e.g. "02-requirements"). sdlc_validate used to emit stage_completed with
 * stage_id = task.id, corrupting every per-stage aggregation (reporter
 * stage_elapsed, alerts stage labels, dashboard stage matrix).
 *
 * owner: RStack developed by Richardson Gunde
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CANONICAL_SDLC_STAGES } from '../src/core/harness/stages.js';
import extension from '../extensions/rstack-sdlc.ts';

const mockPi = {
  tools: {},
  commands: {},
  on: () => {},
  registerTool(tool) { this.tools[tool.name] = tool; },
  registerCommand(name, command) { this.commands[name] = command; },
};

test('sdlc_validate attributes stage_completed to canonical stages, not task ids', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-stage-attr-'));
  const previousProjectRoot = process.env.RSTACK_PROJECT_ROOT;
  const previousWebhook = process.env.RSTACK_SLACK_WEBHOOK;
  process.env.RSTACK_PROJECT_ROOT = projectRoot;
  delete process.env.RSTACK_SLACK_WEBHOOK;

  extension(mockPi);

  const start = await mockPi.tools.sdlc_start.execute('1', { goal: 'Stage attribution regression' });
  const runId = start.details.run_id;
  await mockPi.tools.sdlc_plan.execute('2', { run_id: runId });

  // #404: the plan now contains one task per canonical stage, and the claim is
  // the first pending stage (00-environment). We validate the actually-claimed
  // task through the real claim path (#405), not by writing into an arbitrary
  // task dir.
  const tasksPath = join(projectRoot, '.rstack', 'runs', runId, 'tasks.json');
  const planned = JSON.parse(readFileSync(tasksPath, 'utf8')).tasks;
  assert.equal(planned.length, CANONICAL_SDLC_STAGES.length, 'plan should contain one task per canonical stage');

  // 00-environment's default approval gate is plan.md — approve it so the real
  // claim path grants the attempt (this is the flow #405 now requires).
  await mockPi.tools.sdlc_approve.execute('approve-plan', { run_id: runId, artifact: 'plan.md', status: 'APPROVED' });
  const claim = await mockPi.tools.sdlc_build_next.execute('claim', { run_id: runId });
  const task = claim.details.task;
  assert.equal(task.id, '00-environment', 'first claim is the first canonical stage');
  const expectedStageIds = [...new Set(task.stage_artifacts.map((artifact) => artifact.stage_id))];
  assert.deepEqual(expectedStageIds, ['00-environment'], 'task targets exactly its own canonical stage');

  // Write a passing builder contract into the claimed task output dir.
  const outputDir = join(projectRoot, task.output_dir);
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, 'builder.json'), JSON.stringify({
    task_id: task.id,
    agent: 'builder',
    status: 'PASS',
    summary: 'Environment captured and documented for regression test',
    files_modified: [],
    tests_run: ['SKIPPED: regression fixture'],
    risks: [],
    next_steps: [],
    memory_summary: {
      work_done: 'Captured environment for the regression scenario',
      evidence: ['tasks.json'],
    },
    stage_summaries: expectedStageIds.map((stageId) => ({
      stage_id: stageId,
      work_done: `Stage ${stageId} artifacts produced for regression test`,
      evidence: ['tasks.json'],
    })),
  }, null, 2));

  const result = await mockPi.tools.sdlc_validate.execute('3', { run_id: runId, task_id: task.id });
  assert.equal(result.details.status, 'PASS', `validation should pass: ${JSON.stringify(result.details.issues)}`);

  const events = readFileSync(join(projectRoot, '.rstack', 'runs', runId, 'events.jsonl'), 'utf8')
    .split('\n').filter(Boolean).map((line) => JSON.parse(line));
  const stageEvents = events.filter((event) => event.type === 'stage_completed');
  assert.ok(stageEvents.length > 0, 'PASS validation should emit stage_completed');

  const canonicalIds = new Set(CANONICAL_SDLC_STAGES.map((stage) => stage.id));
  for (const event of stageEvents) {
    assert.ok(canonicalIds.has(event.stage_id), `stage_id must be canonical, got: ${event.stage_id}`);
    assert.equal(event.task_id, task.id, 'task_id should keep the task attribution');
    assert.equal(typeof event.elapsed_ms, 'number');
  }
  assert.deepEqual(
    stageEvents.map((event) => event.stage_id).sort(),
    [...expectedStageIds].sort(),
    'one stage_completed per canonical stage the task targets',
  );
  const checkpointEvents = events.filter((event) => event.type === 'stage_checkpoint_saved');
  assert.deepEqual(
    checkpointEvents.map((event) => event.stage_id).sort(),
    [...expectedStageIds].sort(),
    'every canonical stage the task produced should be checkpointed',
  );

  rmSync(projectRoot, { recursive: true, force: true });
  if (previousProjectRoot) process.env.RSTACK_PROJECT_ROOT = previousProjectRoot;
  else delete process.env.RSTACK_PROJECT_ROOT;
  if (previousWebhook) process.env.RSTACK_SLACK_WEBHOOK = previousWebhook;
});
