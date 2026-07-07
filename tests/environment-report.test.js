// owner: RStack developed by Richardson Gunde
//
// environment_report.json shape validation (#237): legacy reports warn but
// never fail; intake-v2 fields (run_mode, run_mode_evidence,
// user_preferences, setup_needs) are strictly typed when present; secrets
// are rejected from user_preferences; the sdlc_validate wiring is a WARN
// check that can never flip a validation verdict.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { validateEnvironmentReport, environmentReportCheck, RUN_MODES } from '../src/core/harness/environment-report.js';
import extension from '../extensions/rstack-sdlc.ts';

const LEGACY_REPORT = {
  tools: { git: true, node: true },
  env_vars: { GITHUB_TOKEN: true, JIRA_TOKEN: false },
  user_preferences: {},
  fallbacks: { docker: 'file-based deployment config' },
  pipeline_ready: true,
  status: 'PASS',
};

const V2_REPORT = {
  ...LEGACY_REPORT,
  run_mode: 'brownfield',
  run_mode_evidence: ['.git/refs/heads — commit history present', 'manifest files present: package.json'],
  user_preferences: { ticketing_platform: 'github' },
  setup_needs: [{ kind: 'ticketing', platform: 'github', required_vars: ['GITHUB_TOKEN'], satisfied: true }],
};

test('legacy report (pre-#237 shape) validates clean; missing legacy fields warn only', () => {
  assert.deepEqual(validateEnvironmentReport(LEGACY_REPORT), []);
  const issues = validateEnvironmentReport({ tools: { git: true } });
  assert.ok(issues.length > 0);
  assert.ok(issues.every((issue) => issue.severity === 'warning'), 'missing legacy fields must never be errors');
  assert.ok(issues.some((issue) => issue.field === 'pipeline_ready'));
});

test('full intake-v2 report validates clean', () => {
  assert.deepEqual(validateEnvironmentReport(V2_REPORT), []);
});

test('run_mode must be a contract run mode when present', () => {
  const issues = validateEnvironmentReport({ ...LEGACY_REPORT, run_mode: 'legacy-rescue' });
  assert.ok(issues.some((issue) => issue.field === 'run_mode' && issue.severity === 'error' && new RegExp(RUN_MODES.join(' \\| ')).test(issue.problem)));
});

test('malformed new fields are error-severity and name the exact field', () => {
  const issues = validateEnvironmentReport({
    ...LEGACY_REPORT,
    run_mode_evidence: 'not-an-array',
    user_preferences: { ticketing_platform: 42 },
    setup_needs: [
      { kind: 'carrier-pigeon', platform: '', required_vars: 'GITHUB_TOKEN', satisfied: 'yes' },
      'not-an-object',
    ],
  });
  const errorFields = issues.filter((issue) => issue.severity === 'error').map((issue) => issue.field);
  assert.ok(errorFields.includes('run_mode_evidence'));
  assert.ok(errorFields.includes('user_preferences.ticketing_platform'));
  assert.ok(errorFields.includes('setup_needs[0].kind'));
  assert.ok(errorFields.includes('setup_needs[0].platform'));
  assert.ok(errorFields.includes('setup_needs[0].required_vars'));
  assert.ok(errorFields.includes('setup_needs[0].satisfied'));
  assert.ok(errorFields.includes('setup_needs[1]'));
});

test('credential-shaped user_preferences keys are rejected — secrets belong in .env', () => {
  const issues = validateEnvironmentReport({ ...LEGACY_REPORT, user_preferences: { jira_api_token: 'abc123' } });
  assert.ok(issues.some((issue) => issue.field === 'user_preferences.jira_api_token' && issue.severity === 'error' && /\.env/.test(issue.problem)));
  // env_vars stays exempt: keys NAME tokens, values are presence booleans.
  assert.deepEqual(validateEnvironmentReport(LEGACY_REPORT), []);
});

test('non-object report is a single error', () => {
  const issues = validateEnvironmentReport(['nope']);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].severity, 'error');
});

test('environmentReportCheck: PASS on clean report, WARN on issues/malformed/missing — never FAIL', async () => {
  const runDir = mkdtempSync(join(tmpdir(), 'rstack-env-report-'));

  // Missing entirely → WARN naming both candidate paths.
  const missing = await environmentReportCheck(runDir);
  assert.equal(missing.status, 'WARN');
  assert.match(missing.evidence, /no environment_report\.json/);

  // Legacy path only → still found; canonical path preferred when both exist.
  mkdirSync(join(runDir, 'artifacts', 'stages', '00-environment'), { recursive: true });
  writeFileSync(join(runDir, 'artifacts', 'environment_report.json'), JSON.stringify(LEGACY_REPORT));
  const legacy = await environmentReportCheck(runDir);
  assert.equal(legacy.status, 'PASS');
  assert.match(legacy.evidence, /^artifacts\/environment_report\.json$/);

  writeFileSync(join(runDir, 'artifacts', 'stages', '00-environment', 'environment_report.json'), JSON.stringify({ ...V2_REPORT, run_mode: 'bogus' }));
  const canonical = await environmentReportCheck(runDir);
  assert.equal(canonical.status, 'WARN');
  assert.match(canonical.evidence, /^artifacts\/stages\/00-environment\/environment_report\.json/);
  assert.match(canonical.evidence, /run_mode/);

  // Malformed JSON → WARN with the parse error, never a throw.
  writeFileSync(join(runDir, 'artifacts', 'stages', '00-environment', 'environment_report.json'), '{not json');
  const malformed = await environmentReportCheck(runDir);
  assert.equal(malformed.status, 'WARN');
  assert.match(malformed.evidence, /malformed JSON/);

  assert.ok([missing, legacy, canonical, malformed].every((check) => check.status !== 'FAIL'), 'the shape check is non-fatal by construction');
});

test('sdlc_validate wiring: stage-00 task gets the shape check; a malformed report never fails validation', async () => {
  const mockPi = {
    tools: {},
    commands: {},
    on: () => {},
    registerTool(tool) { this.tools[tool.name] = tool; },
    registerCommand(name, command) { this.commands[name] = command; },
  };
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-env-report-wire-'));
  const previousProjectRoot = process.env.RSTACK_PROJECT_ROOT;
  const previousWebhook = process.env.RSTACK_SLACK_WEBHOOK;
  process.env.RSTACK_PROJECT_ROOT = projectRoot;
  delete process.env.RSTACK_SLACK_WEBHOOK;
  try {
    extension(mockPi);
    const start = await mockPi.tools.sdlc_start.execute('1', { goal: 'Environment report shape wiring regression' });
    const runId = start.details.run_id;
    await mockPi.tools.sdlc_plan.execute('2', { run_id: runId });

    const runDir = join(projectRoot, '.rstack', 'runs', runId);
    const tasks = JSON.parse(readFileSync(join(runDir, 'tasks.json'), 'utf8')).tasks;
    // 001-product-clarification targets 00-environment (+ 01-transcript).
    const envTask = tasks.find((entry) => entry.id === '001-product-clarification');
    assert.ok(envTask, 'plan should contain the 001-product-clarification task');
    const expectedStageIds = [...new Set(envTask.stage_artifacts.map((artifact) => artifact.stage_id))];
    assert.ok(expectedStageIds.includes('00-environment'));

    // A v2 report with an INVALID run_mode: the shape check must WARN, and
    // validation must still PASS (non-fatal by contract).
    mkdirSync(join(runDir, 'artifacts', 'stages', '00-environment'), { recursive: true });
    writeFileSync(join(runDir, 'artifacts', 'stages', '00-environment', 'environment_report.json'), JSON.stringify({ ...LEGACY_REPORT, run_mode: 'not-a-mode' }));

    const outputDir = join(projectRoot, envTask.output_dir);
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(join(outputDir, 'builder.json'), JSON.stringify({
      task_id: envTask.id,
      agent: 'builder',
      status: 'PASS',
      summary: 'Environment detection completed for the wiring regression test',
      files_modified: [],
      tests_run: ['SKIPPED: regression fixture'],
      risks: [],
      next_steps: [],
      memory_summary: { work_done: 'Detected environment for the shape-check regression', evidence: ['tasks.json'] },
      stage_summaries: expectedStageIds.map((stageId) => ({
        stage_id: stageId,
        work_done: `Stage ${stageId} artifacts produced for regression test`,
        evidence: ['tasks.json'],
      })),
    }, null, 2));

    const result = await mockPi.tools.sdlc_validate.execute('3', { run_id: runId, task_id: envTask.id });
    assert.equal(result.details.status, 'PASS', `shape WARN must never fail validation: ${JSON.stringify(result.details.issues)}`);
    const validation = JSON.parse(readFileSync(join(outputDir, 'validation.json'), 'utf8'));
    const shapeCheck = validation.checks.find((check) => check.name === 'environment_report_shape');
    assert.ok(shapeCheck, 'stage-00 validation records the shape check');
    assert.equal(shapeCheck.status, 'WARN');
    assert.match(shapeCheck.evidence, /run_mode/);
    assert.ok(!validation.issues.some((issue) => issue.name === 'environment_report_shape'), 'WARN checks never land in issues[]');
  } finally {
    if (previousProjectRoot === undefined) delete process.env.RSTACK_PROJECT_ROOT;
    else process.env.RSTACK_PROJECT_ROOT = previousProjectRoot;
    if (previousWebhook !== undefined) process.env.RSTACK_SLACK_WEBHOOK = previousWebhook;
  }
});
