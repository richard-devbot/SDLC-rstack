/**
 * Validator registry wiring (#120): sdlc_validate must record which validator
 * profile owns each task in validation.json, selected from the task's
 * canonical stage targets — the highest-priority registered stage wins,
 * unregistered stages fall back to the generic profile.
 *
 * owner: RStack developed by Richardson Gunde
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_VALIDATOR_REGISTRY } from '../src/core/harness/validator-registry.js';
import extension from '../extensions/rstack-sdlc.ts';

const mockPi = {
  tools: {},
  commands: {},
  on: () => {},
  registerTool(tool) { this.tools[tool.name] = tool; },
  registerCommand(name, command) { this.commands[name] = command; },
};

test('sdlc_validate records the selected validator profile in validation.json', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-validator-profile-'));
  const previousProjectRoot = process.env.RSTACK_PROJECT_ROOT;
  const previousWebhook = process.env.RSTACK_SLACK_WEBHOOK;
  process.env.RSTACK_PROJECT_ROOT = projectRoot;
  delete process.env.RSTACK_SLACK_WEBHOOK;

  extension(mockPi);

  const start = await mockPi.tools.sdlc_start.execute('1', { goal: 'Validator profile wiring regression' });
  const runId = start.details.run_id;
  await mockPi.tools.sdlc_plan.execute('2', { run_id: runId });

  const tasksPath = join(projectRoot, '.rstack', 'runs', runId, 'tasks.json');
  const tasks = JSON.parse(readFileSync(tasksPath, 'utf8')).tasks;

  // 003-architecture targets 06-architecture + 12-security-threat-model +
  // 14-cost-estimation — the security profile must win the selection.
  const archTask = tasks.find((entry) => entry.id === '003-architecture');
  assert.ok(archTask, 'plan should contain the 003-architecture task');
  const expectedStageIds = [...new Set(archTask.stage_artifacts.map((artifact) => artifact.stage_id))];
  assert.ok(expectedStageIds.includes('12-security-threat-model'), 'fixture should target the security stage');

  const outputDir = join(projectRoot, archTask.output_dir);
  mkdirSync(outputDir, { recursive: true });
  // #222: required_checks are ENFORCED now — the security profile's checks
  // read the canonical stage artifact, so the fixture must actually produce
  // it (this test predates enforcement and used to pass artifact-free).
  const threatDir = join(projectRoot, '.rstack', 'runs', runId, 'artifacts', 'stages', '12-security-threat-model');
  mkdirSync(threatDir, { recursive: true });
  writeFileSync(join(threatDir, 'threat_model.json'), JSON.stringify({
    threats: [{ category: 'Spoofing', risk: 'high', mitigation: 'mTLS between services' }],
    mitigations: ['mTLS between services'],
    risk_ratings: ['high'],
  }, null, 2));
  writeFileSync(join(outputDir, 'builder.json'), JSON.stringify({
    task_id: archTask.id,
    agent: 'builder',
    status: 'PASS',
    summary: 'Architecture and threat model documented for regression test',
    files_modified: [],
    tests_run: ['SKIPPED: regression fixture'],
    risks: [],
    next_steps: [],
    memory_summary: {
      work_done: 'Designed the system and threat model for the regression scenario',
      evidence: ['tasks.json'],
    },
    stage_summaries: expectedStageIds.map((stageId) => ({
      stage_id: stageId,
      work_done: `Stage ${stageId} artifacts produced for regression test`,
      evidence: ['tasks.json'],
    })),
  }, null, 2));

  const result = await mockPi.tools.sdlc_validate.execute('3', { run_id: runId, task_id: archTask.id });
  assert.equal(result.details.status, 'PASS', `validation should pass: ${JSON.stringify(result.details.issues)}`);

  const validation = JSON.parse(readFileSync(join(outputDir, 'validation.json'), 'utf8'));
  assert.equal(validation.validator, 'rstack-pi-extension', 'existing validator field is untouched');
  assert.ok(validation.validator_profile, 'validation.json must carry the selected profile');
  assert.equal(validation.validator_profile.stage_id, '12-security-threat-model', 'highest-priority registered stage wins');
  assert.equal(validation.validator_profile.validator, 'validator.12-security-threat-model');
  assert.equal(typeof validation.validator_profile.model_hint, 'string');
  assert.deepEqual(
    [...validation.validator_profile.required_checks],
    [...DEFAULT_VALIDATOR_REGISTRY['12-security-threat-model'].required_checks],
  );
  assert.ok(
    validation.checks.some((check) => check.name === 'validator_profile_selected' && check.status === 'PASS'),
    'profile selection is recorded as an informational check',
  );

  // 001-product-clarification targets only unregistered stages (00, 01) —
  // the generic profile applies, even when the builder contract is missing.
  const genericTask = tasks.find((entry) => entry.id === '001-product-clarification');
  assert.ok(genericTask, 'plan should contain the 001-product-clarification task');
  const genericResult = await mockPi.tools.sdlc_validate.execute('4', { run_id: runId, task_id: genericTask.id });
  assert.equal(genericResult.details.status, 'FAIL', 'missing builder contract still fails validation');
  const genericValidation = JSON.parse(readFileSync(join(projectRoot, genericTask.output_dir, 'validation.json'), 'utf8'));
  assert.equal(genericValidation.validator_profile.stage_id, null);
  assert.equal(genericValidation.validator_profile.validator, 'validator.generic');

  rmSync(projectRoot, { recursive: true, force: true });
  if (previousProjectRoot) process.env.RSTACK_PROJECT_ROOT = previousProjectRoot;
  else delete process.env.RSTACK_PROJECT_ROOT;
  if (previousWebhook) process.env.RSTACK_SLACK_WEBHOOK = previousWebhook;
});
