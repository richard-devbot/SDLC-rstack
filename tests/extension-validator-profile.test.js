/**
 * Validator registry wiring (#120 + #404): sdlc_validate records which
 * validator profile owns each task in validation.json. Since #404, each task
 * targets exactly ONE canonical stage, so a registered stage receives ITS OWN
 * validator instead of being shadowed by a higher-priority stage bundled into
 * the same mission (architecture 06 used to lose to security 12; it no longer
 * does). Unregistered stages fall back to the generic profile.
 *
 * owner: RStack developed by Richardson Gunde
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_VALIDATOR_REGISTRY } from '../src/core/harness/validator-registry.js';
import { claimTaskForTest } from './helpers/claim.js';
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

  // #404: the 06-architecture task now targets ONLY 06-architecture, so it must
  // receive the architecture validator — no longer shadowed by the security
  // stage that used to share its mission bundle.
  const archTask = claimTaskForTest(projectRoot, runId, '06-architecture');
  const expectedStageIds = [...new Set(archTask.stage_artifacts.map((artifact) => artifact.stage_id))];
  assert.deepEqual(expectedStageIds, ['06-architecture'], 'architecture task targets only its own stage');

  const outputDir = join(projectRoot, archTask.output_dir);
  mkdirSync(outputDir, { recursive: true });
  // #222: the architecture profile's required_checks read the canonical stage
  // artifact (system_design.json), so the fixture must produce it with the
  // required fields.
  const archDir = join(projectRoot, '.rstack', 'runs', runId, 'artifacts', 'stages', '06-architecture');
  mkdirSync(archDir, { recursive: true });
  writeFileSync(join(archDir, 'system_design.json'), JSON.stringify({
    components: [{ name: 'api', responsibility: 'request handling' }],
    interfaces: [{ name: 'REST', contract: 'OpenAPI 3' }],
    data_model: { entities: ['user'] },
    tradeoffs: ['monolith-first for delivery speed'],
    security_boundaries: ['authenticated API gateway in front of services'],
  }, null, 2));
  writeFileSync(join(outputDir, 'builder.json'), JSON.stringify({
    task_id: archTask.id,
    agent: 'builder',
    status: 'PASS',
    summary: 'Architecture and system design documented for regression test',
    files_modified: [],
    tests_run: ['SKIPPED: regression fixture'],
    risks: [],
    next_steps: [],
    memory_summary: {
      work_done: 'Designed the system architecture for the regression scenario',
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
  assert.equal(validation.validator_profile.stage_id, '06-architecture', 'the stage now gets its own validator, not a shadowing one');
  assert.equal(validation.validator_profile.validator, 'validator.06-architecture');
  assert.equal(typeof validation.validator_profile.model_hint, 'string');
  assert.deepEqual(
    [...validation.validator_profile.required_checks],
    [...DEFAULT_VALIDATOR_REGISTRY['06-architecture'].required_checks],
  );
  assert.ok(
    validation.checks.some((check) => check.name === 'validator_profile_selected' && check.status === 'PASS'),
    'profile selection is recorded as an informational check',
  );

  // 04-planning is an unregistered stage — the generic profile applies, even
  // when the builder contract is missing (claimed but never built).
  // (00-environment and 01-transcript gained their own profiles in #421/#410.)
  const genericTask = claimTaskForTest(projectRoot, runId, '04-planning');
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
