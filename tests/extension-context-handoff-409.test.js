/**
 * Deterministic cross-stage context handoff (#409): a late stage's builder
 * prompt must contain the ACTUAL environment and transcript artifacts from the
 * same run — injected directly, independent of episodic recall (which is
 * lexical and would usually drop them at this stage distance).
 *
 * owner: RStack developed by Richardson Gunde
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

test('#409: a late stage receives the environment + transcript artifacts in its builder prompt', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-ctx-409-'));
  const previousProjectRoot = process.env.RSTACK_PROJECT_ROOT;
  const previousWebhook = process.env.RSTACK_SLACK_WEBHOOK;
  process.env.RSTACK_PROJECT_ROOT = projectRoot;
  delete process.env.RSTACK_SLACK_WEBHOOK;

  try {
    extension(mockPi);
    const start = await mockPi.tools.sdlc_start.execute('1', { goal: 'Context handoff regression' });
    const runId = start.details.run_id;
    const runDir = join(projectRoot, '.rstack', 'runs', runId);
    await mockPi.tools.sdlc_plan.execute('2', { run_id: runId });

    // Produce the foundational stage-00/01 artifacts with recognizable markers.
    const envDir = join(runDir, 'artifacts', 'stages', '00-environment');
    const txDir = join(runDir, 'artifacts', 'stages', '01-transcript');
    mkdirSync(envDir, { recursive: true });
    mkdirSync(txDir, { recursive: true });
    writeFileSync(join(envDir, 'environment_report.json'), JSON.stringify({ run_mode: 'brownfield', marker: 'ENV-MARKER-42' }));
    writeFileSync(join(txDir, 'transcript.json'), JSON.stringify({ goals: ['deliver TRANSCRIPT-MARKER-99'] }));

    // Park everything except the last stage as PASS so the claim lands on
    // 14-cost-estimation, and satisfy its standing approval gates.
    const tasksPath = join(runDir, 'tasks.json');
    const state = JSON.parse(readFileSync(tasksPath, 'utf8'));
    for (const task of state.tasks) { if (task.id !== '14-cost-estimation') task.status = 'PASS'; }
    writeFileSync(tasksPath, JSON.stringify(state, null, 2));
    for (const artifact of ['plan.md', 'requirements.json', 'architecture.md']) {
      await mockPi.tools.sdlc_approve.execute(`ap-${artifact}`, { run_id: runId, artifact, status: 'APPROVED' });
    }

    const claim = await mockPi.tools.sdlc_build_next.execute('3', { run_id: runId });
    assert.equal(claim.details.task.id, '14-cost-estimation', 'the late stage is claimed');
    const prompt = claim.content[0].text;

    assert.match(prompt, /Prior stage inputs/, 'the prompt carries a prior-stage-inputs block');
    assert.match(prompt, /00-environment/, 'the environment stage is named');
    assert.match(prompt, /ENV-MARKER-42/, 'the actual environment artifact content is injected');
    assert.match(prompt, /01-transcript/, 'the transcript stage is named');
    assert.match(prompt, /TRANSCRIPT-MARKER-99/, 'the actual transcript artifact content is injected');
  } finally {
    if (previousProjectRoot === undefined) delete process.env.RSTACK_PROJECT_ROOT;
    else process.env.RSTACK_PROJECT_ROOT = previousProjectRoot;
    if (previousWebhook !== undefined) process.env.RSTACK_SLACK_WEBHOOK = previousWebhook;
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('#409: the first stage gets no prior-stage-inputs block', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-ctx-409b-'));
  const previousProjectRoot = process.env.RSTACK_PROJECT_ROOT;
  const previousWebhook = process.env.RSTACK_SLACK_WEBHOOK;
  process.env.RSTACK_PROJECT_ROOT = projectRoot;
  delete process.env.RSTACK_SLACK_WEBHOOK;

  try {
    extension(mockPi);
    const start = await mockPi.tools.sdlc_start.execute('1', { goal: 'First stage has no priors' });
    const runId = start.details.run_id;
    await mockPi.tools.sdlc_plan.execute('2', { run_id: runId });
    await mockPi.tools.sdlc_approve.execute('ap', { run_id: runId, artifact: 'plan.md', status: 'APPROVED' });
    const claim = await mockPi.tools.sdlc_build_next.execute('3', { run_id: runId });
    assert.equal(claim.details.task.id, '00-environment');
    assert.doesNotMatch(claim.content[0].text, /Prior stage inputs/, 'stage 00 has no prior inputs');
  } finally {
    if (previousProjectRoot === undefined) delete process.env.RSTACK_PROJECT_ROOT;
    else process.env.RSTACK_PROJECT_ROOT = previousProjectRoot;
    if (previousWebhook !== undefined) process.env.RSTACK_SLACK_WEBHOOK = previousWebhook;
    rmSync(projectRoot, { recursive: true, force: true });
  }
});
