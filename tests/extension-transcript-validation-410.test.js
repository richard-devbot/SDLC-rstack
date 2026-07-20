/**
 * Stage-01 transcript validation (#410): the transcript previously had NO
 * validation — a missing or goalless transcript.json passed silently, and
 * stage 02 built requirements from nothing. The 01-transcript validator
 * profile now gates on the artifact's presence and its load-bearing `goals`
 * field, matching how the other validated stages (06/07/08/12/13) work.
 *
 * owner: RStack developed by Richardson Gunde
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

function builderFor(taskId) {
  return {
    task_id: taskId,
    agent: 'builder',
    status: 'PASS',
    summary: 'Transcript captured for the transcript-validation regression',
    files_modified: [],
    tests_run: ['SKIPPED: transcript fixture'],
    risks: [],
    next_steps: [],
    memory_summary: { work_done: 'Captured the transcript for the regression scenario', evidence: ['tasks.json'] },
    stage_summaries: [{ stage_id: '01-transcript', work_done: 'Transcript produced for the regression', evidence: ['tasks.json'] }],
  };
}

async function validateTranscript({ transcript }) {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-transcript-410-'));
  const previousProjectRoot = process.env.RSTACK_PROJECT_ROOT;
  const previousWebhook = process.env.RSTACK_SLACK_WEBHOOK;
  process.env.RSTACK_PROJECT_ROOT = projectRoot;
  delete process.env.RSTACK_SLACK_WEBHOOK;
  try {
    extension(mockPi);
    const start = await mockPi.tools.sdlc_start.execute('1', { goal: 'Transcript validation regression' });
    const runId = start.details.run_id;
    const runDir = join(projectRoot, '.rstack', 'runs', runId);
    await mockPi.tools.sdlc_plan.execute('2', { run_id: runId });

    if (transcript !== undefined) {
      const txDir = join(runDir, 'artifacts', 'stages', '01-transcript');
      mkdirSync(txDir, { recursive: true });
      writeFileSync(join(txDir, 'transcript.json'), JSON.stringify(transcript));
    }

    const task = claimTaskForTest(projectRoot, runId, '01-transcript');
    const outputDir = join(projectRoot, task.output_dir);
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(join(outputDir, 'builder.json'), JSON.stringify(builderFor('01-transcript')));

    const result = await mockPi.tools.sdlc_validate.execute('3', { run_id: runId, task_id: '01-transcript' });
    const validation = JSON.parse(readFileSync(join(outputDir, 'validation.json'), 'utf8'));
    return { result, validation };
  } finally {
    if (previousProjectRoot === undefined) delete process.env.RSTACK_PROJECT_ROOT;
    else process.env.RSTACK_PROJECT_ROOT = previousProjectRoot;
    if (previousWebhook !== undefined) process.env.RSTACK_SLACK_WEBHOOK = previousWebhook;
    rmSync(projectRoot, { recursive: true, force: true });
  }
}

test('#410: a transcript with goals passes; the transcript profile is selected', async () => {
  const { result, validation } = await validateTranscript({ transcript: { project_name: 'x', goals: ['ship the thing'] } });
  assert.equal(result.details.status, 'PASS', `valid transcript should pass: ${JSON.stringify(result.details.issues)}`);
  assert.equal(validation.validator_profile.stage_id, '01-transcript', 'the transcript stage gets its own validator');
  assert.ok(validation.checks.some((c) => c.name === 'required_check_transcript_present' && c.status === 'PASS'));
  assert.ok(validation.checks.some((c) => c.name === 'required_check_transcript_has_goals' && c.status === 'PASS'));
});

test('#410: a missing transcript.json fails validation', async () => {
  const { result, validation } = await validateTranscript({ transcript: undefined });
  assert.equal(result.details.status, 'FAIL', 'a missing transcript must fail — no more silent pass');
  assert.ok(validation.checks.some((c) => c.name === 'required_check_transcript_present' && c.status === 'FAIL'));
});

test('#410: a transcript without goals fails validation', async () => {
  const { result, validation } = await validateTranscript({ transcript: { project_name: 'x', goals: [] } });
  assert.equal(result.details.status, 'FAIL', 'an empty goals list must fail');
  assert.ok(validation.checks.some((c) => c.name === 'required_check_transcript_has_goals' && c.status === 'FAIL'));
});
