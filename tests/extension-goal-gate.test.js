/**
 * Goal-contract gate wiring (#196): sdlc_validate must runtime-enforce the
 * agent-11 goal contract. On a goal-driven run (goal.json present in the run
 * dir) a task targeting 11-feedback-loop FAILs validation when feedback.json
 * is missing or its goal_evaluation section is malformed — with the named
 * checks recorded in validation.json, not just a silent ASK_USER at loop
 * time. Runs with no active goal keep the section optional.
 *
 * owner: RStack developed by Richardson Gunde
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claimTaskForTest } from './helpers/claim.js';
import extension from '../extensions/rstack-sdlc.ts';

const mockPi = {
  tools: {},
  commands: {},
  on: () => {},
  registerTool(tool) { this.tools[tool.name] = tool; },
  registerCommand(name, command) { this.commands[name] = command; },
};

test('sdlc_validate enforces the goal_evaluation contract on goal-driven runs', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-goal-gate-'));
  const previousProjectRoot = process.env.RSTACK_PROJECT_ROOT;
  const previousWebhook = process.env.RSTACK_SLACK_WEBHOOK;
  process.env.RSTACK_PROJECT_ROOT = projectRoot;
  delete process.env.RSTACK_SLACK_WEBHOOK;

  extension(mockPi);

  const start = await mockPi.tools.sdlc_start.execute('1', { goal: 'Goal-contract gate regression' });
  const runId = start.details.run_id;
  await mockPi.tools.sdlc_plan.execute('2', { run_id: runId });

  const runDir = join(projectRoot, '.rstack', 'runs', runId);

  // #404: 11-feedback-loop is now its own task (it carries the goal_evaluation
  // contract). #405: each validate consumes the claim, so every re-validation
  // below re-claims first — exactly the real retry path.
  const reclaim = () => claimTaskForTest(projectRoot, runId, '11-feedback-loop');
  const releaseTask = reclaim();
  const expectedStageIds = [...new Set(releaseTask.stage_artifacts.map((artifact) => artifact.stage_id))];
  assert.deepEqual(expectedStageIds, ['11-feedback-loop'], 'feedback task targets only its own stage');

  const outputDir = join(projectRoot, releaseTask.output_dir);
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, 'builder.json'), JSON.stringify({
    task_id: releaseTask.id,
    agent: 'builder',
    status: 'PASS',
    summary: 'Release readiness verified for the goal-gate regression test',
    files_modified: [],
    tests_run: ['SKIPPED: regression fixture'],
    risks: [],
    next_steps: [],
    memory_summary: {
      work_done: 'Verified release readiness for the goal-gate regression scenario',
      evidence: ['tasks.json'],
    },
    stage_summaries: expectedStageIds.map((stageId) => ({
      stage_id: stageId,
      work_done: `Stage ${stageId} artifacts produced for regression test`,
      evidence: ['tasks.json'],
    })),
  }, null, 2));

  // 1. No active goal: the section stays optional — validation passes and the
  //    gate records why it did not enforce.
  const noGoal = await mockPi.tools.sdlc_validate.execute('3', { run_id: runId, task_id: releaseTask.id });
  assert.equal(noGoal.details.status, 'PASS', `goal-less run should pass: ${JSON.stringify(noGoal.details.issues)}`);
  reclaim();
  const noGoalValidation = JSON.parse(readFileSync(join(outputDir, 'validation.json'), 'utf8'));
  assert.ok(
    noGoalValidation.checks.some((check) => check.name === 'goal_evaluation_not_required' && check.status === 'PASS'),
    'no-goal runs record the informational pass-through check',
  );

  // 2. Goal active + no feedback artifact: validation FAILs with the gate
  //    check recorded in validation.json.
  writeFileSync(join(runDir, 'goal.json'), JSON.stringify({
    goal_id: 'release-fixture',
    criteria: [{ id: 'c1', kind: 'judge', question: 'Is the release satisfying?' }],
  }, null, 2));
  const missing = await mockPi.tools.sdlc_validate.execute('4', { run_id: runId, task_id: releaseTask.id });
  assert.equal(missing.details.status, 'FAIL', 'goal-driven run without feedback.json must fail validation');
  reclaim();
  const missingValidation = JSON.parse(readFileSync(join(outputDir, 'validation.json'), 'utf8'));
  assert.ok(
    missingValidation.issues.some((check) => check.name === 'goal_evaluation_feedback_artifact'),
    'the missing feedback artifact is a named issue in validation.json',
  );

  // 3. Goal active + malformed goal_evaluation: the shape checks surface as
  //    validation issues.
  const feedbackDir = join(runDir, 'artifacts', 'stages', '11-feedback-loop');
  mkdirSync(feedbackDir, { recursive: true });
  writeFileSync(join(feedbackDir, 'feedback.json'), JSON.stringify({
    summary: { critical_count: 0 },
    issues: [],
    goal_evaluation: { status: 'GREAT', consistency_score: 'high' },
  }, null, 2));
  const malformed = await mockPi.tools.sdlc_validate.execute('5', { run_id: runId, task_id: releaseTask.id });
  assert.equal(malformed.details.status, 'FAIL', 'malformed goal_evaluation must fail validation');
  reclaim();
  const malformedValidation = JSON.parse(readFileSync(join(outputDir, 'validation.json'), 'utf8'));
  const malformedNames = malformedValidation.issues.map((check) => check.name);
  assert.ok(malformedNames.includes('goal_evaluation_status_allowed'));
  assert.ok(malformedNames.includes('goal_evaluation_has_reason'));

  // 4. Goal active + well-formed goal_evaluation: validation passes again.
  writeFileSync(join(feedbackDir, 'feedback.json'), JSON.stringify({
    summary: { critical_count: 0 },
    issues: [],
    goal_evaluation: {
      goal_id: 'release-fixture',
      status: 'PASS',
      consistency_score: 95,
      critical_count: 0,
      failing_stages: [],
      recommended_rerun_stages: [],
      requires_human_decision: false,
      reason: 'All release criteria met with evidence.',
      criteria: [{ criterion_id: 'c1', result: 'met', evidence: ['tasks.json'] }],
    },
  }, null, 2));
  const wellFormed = await mockPi.tools.sdlc_validate.execute('6', { run_id: runId, task_id: releaseTask.id });
  assert.equal(wellFormed.details.status, 'PASS', `well-formed goal_evaluation should pass: ${JSON.stringify(wellFormed.details.issues)}`);
  const passValidation = JSON.parse(readFileSync(join(outputDir, 'validation.json'), 'utf8'));
  assert.ok(
    passValidation.checks.some((check) => check.name === 'goal_evaluation_is_object' && check.status === 'PASS'),
    'the shape checks are recorded even on PASS',
  );

  // 5. Tasks that never target stage 11 see no goal checks even with an
  //    active goal. 07-code is claimed and validated on its own.
  const codeTask = claimTaskForTest(projectRoot, runId, '07-code');
  await mockPi.tools.sdlc_validate.execute('7', { run_id: runId, task_id: codeTask.id });
  const codeValidation = JSON.parse(readFileSync(join(projectRoot, codeTask.output_dir, 'validation.json'), 'utf8'));
  assert.ok(
    codeValidation.checks.every((check) => !check.name.startsWith('goal_evaluation')),
    'non-stage-11 tasks carry no goal_evaluation checks',
  );

  rmSync(projectRoot, { recursive: true, force: true });
  if (previousProjectRoot) process.env.RSTACK_PROJECT_ROOT = previousProjectRoot;
  else delete process.env.RSTACK_PROJECT_ROOT;
  if (previousWebhook) process.env.RSTACK_SLACK_WEBHOOK = previousWebhook;
});
