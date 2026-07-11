import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { evaluateRequiredChecks, DELEGATED_SEMANTIC_CHECKS } from '../src/core/harness/required-checks.js';
import { DEFAULT_VALIDATOR_REGISTRY, GENERIC_VALIDATOR_PROFILE, validatorDelegationCheck } from '../src/core/harness/validator-registry.js';
import extension from '../extensions/rstack-sdlc.ts';

// owner: RStack developed by Richardson Gunde
//
// #222: validator-profile required_checks were recorded as delegated-only —
// a stage requiring a specialized validator could pass validation without its
// declared checks ever running. These pins cover the mechanical evaluator per
// check family, the honest-FAIL contract for unknown/unevaluable checks, the
// no-false-failures rule for profiles without required_checks, and the wiring
// through the real sdlc_validate.

function ctxFor(profile, overrides = {}) {
  return {
    profile,
    task: { stage_artifacts: [] },
    builder: undefined,
    projectRoot: overrides.projectRoot ?? '/nonexistent',
    runDir: overrides.runDir ?? '/nonexistent/.rstack/runs/run-x',
    signals: { builderContractOk: false, filesModifiedOk: false, testsRunOk: false },
    ...overrides,
  };
}

function byName(checks, id) {
  return checks.find((check) => check.name === `required_check_${id}`);
}

test('no required_checks → no enforcement, no false failures', async () => {
  const result = await evaluateRequiredChecks(ctxFor({ stage_id: null, required_checks: [] }));
  assert.deepEqual(result, { ok: true, checks: [], delegated: [] });
});

test('signal-mapped checks reuse the validate verdicts', async () => {
  const good = await evaluateRequiredChecks(ctxFor(GENERIC_VALIDATOR_PROFILE, {
    signals: { builderContractOk: true, filesModifiedOk: true, testsRunOk: true },
  }));
  assert.equal(good.ok, true);
  assert.equal(byName(good.checks, 'builder_contract_complete').status, 'PASS');
  assert.equal(byName(good.checks, 'files_modified_exist').status, 'PASS');

  const bad = await evaluateRequiredChecks(ctxFor(GENERIC_VALIDATOR_PROFILE));
  assert.equal(bad.ok, false);
  assert.equal(byName(bad.checks, 'builder_contract_complete').status, 'FAIL');
});

test('artifact presence and field checks read the canonical stage artifact JSON', async (t) => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-222-artifact-'));
  t.after(() => rmSync(projectRoot, { recursive: true, force: true }));
  const runDir = join(projectRoot, '.rstack', 'runs', 'run-a');
  const stageDir = join(runDir, 'artifacts', 'stages', '06-architecture');
  await mkdir(stageDir, { recursive: true });
  const profile = DEFAULT_VALIDATOR_REGISTRY['06-architecture'];

  const missing = await evaluateRequiredChecks(ctxFor(profile, { projectRoot, runDir }));
  assert.equal(missing.ok, false);
  assert.equal(byName(missing.checks, 'architecture_artifact_present').status, 'FAIL');
  assert.match(byName(missing.checks, 'architecture_artifact_present').evidence, /not found/);

  await writeFile(join(stageDir, 'system_design.json'), JSON.stringify({
    components: ['api'], interfaces: ['rest'], data_model: {}, tradeoffs: ['monolith first'],
  }));
  const partial = await evaluateRequiredChecks(ctxFor(profile, { projectRoot, runDir }));
  assert.equal(byName(partial.checks, 'architecture_artifact_present').status, 'PASS');
  assert.equal(byName(partial.checks, 'components_and_interfaces_defined').status, 'PASS');
  assert.equal(byName(partial.checks, 'tradeoffs_documented').status, 'PASS');
  assert.equal(byName(partial.checks, 'security_boundaries_identified').status, 'FAIL',
    'missing output-contract field FAILs honestly with the field named');
  assert.match(byName(partial.checks, 'security_boundaries_identified').evidence, /security_boundaries/);

  await writeFile(join(stageDir, 'system_design.json'), JSON.stringify({
    components: ['api'], interfaces: ['rest'], data_model: {}, tradeoffs: ['monolith first'], security_boundaries: ['authn edge'],
  }));
  const full = await evaluateRequiredChecks(ctxFor(profile, {
    projectRoot, runDir,
    signals: { builderContractOk: true, filesModifiedOk: true, testsRunOk: true },
  }));
  assert.equal(full.ok, true, JSON.stringify(full.checks.filter((c) => c.status === 'FAIL')));
});

test('threat-model entry checks: STRIDE categories and high-risk mitigations', async (t) => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-222-threat-'));
  t.after(() => rmSync(projectRoot, { recursive: true, force: true }));
  const runDir = join(projectRoot, '.rstack', 'runs', 'run-a');
  const stageDir = join(runDir, 'artifacts', 'stages', '12-security-threat-model');
  await mkdir(stageDir, { recursive: true });
  const profile = DEFAULT_VALIDATOR_REGISTRY['12-security-threat-model'];

  await writeFile(join(stageDir, 'threat_model.json'), JSON.stringify({
    threats: [
      { category: 'Spoofing', risk: 'high', mitigation: 'mTLS' },
      { category: 'Tampering', risk: 'high' },
    ],
    mitigations: ['mTLS'], risk_ratings: ['high'],
  }));
  const result = await evaluateRequiredChecks(ctxFor(profile, { projectRoot, runDir }));
  assert.equal(byName(result.checks, 'threat_model_artifact_present').status, 'PASS');
  assert.equal(byName(result.checks, 'stride_categories_covered').status, 'PASS');
  assert.equal(byName(result.checks, 'high_risks_have_mitigation').status, 'FAIL');
  assert.match(byName(result.checks, 'high_risks_have_mitigation').evidence, /1 of 2/);
  assert.deepEqual(result.delegated, ['no_secrets_introduced'], 'semantic remainder stays delegated, never fabricated');
});

test('no_placeholder_stubs scans modified files; unknown check ids FAIL honestly', async (t) => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-222-stubs-'));
  t.after(() => rmSync(projectRoot, { recursive: true, force: true }));
  await writeFile(join(projectRoot, 'clean.js'), 'export const ok = 1;\n');
  await writeFile(join(projectRoot, 'stubbed.js'), 'export function pay() { throw new Error("not implemented"); }\n');

  const profile = { stage_id: '07-code', required_checks: ['no_placeholder_stubs', 'made_up_custom_check'] };
  const result = await evaluateRequiredChecks(ctxFor(profile, {
    projectRoot,
    runDir: join(projectRoot, '.rstack', 'runs', 'run-a'),
    builder: { files_modified: ['clean.js', 'stubbed.js'] },
  }));
  assert.equal(result.ok, false);
  assert.equal(byName(result.checks, 'no_placeholder_stubs').status, 'FAIL');
  assert.match(byName(result.checks, 'no_placeholder_stubs').evidence, /stubbed\.js/);
  assert.equal(byName(result.checks, 'made_up_custom_check').status, 'FAIL');
  assert.match(byName(result.checks, 'made_up_custom_check').evidence, /unknown required check/);

  const clean = await evaluateRequiredChecks(ctxFor({ stage_id: '07-code', required_checks: ['no_placeholder_stubs'] }, {
    projectRoot,
    runDir: join(projectRoot, '.rstack', 'runs', 'run-a'),
    builder: { files_modified: ['clean.js'] },
  }));
  assert.equal(clean.ok, true);

  // Zero modified files: vacuous PASS with the reason stated — whether a code
  // stage may ship nothing is the completeness gate's question, not this scan's.
  const empty = await evaluateRequiredChecks(ctxFor({ stage_id: '07-code', required_checks: ['no_placeholder_stubs'] }, {
    projectRoot,
    runDir: join(projectRoot, '.rstack', 'runs', 'run-a'),
    builder: { files_modified: [] },
  }));
  assert.equal(byName(empty.checks, 'no_placeholder_stubs').status, 'PASS');
  assert.match(byName(empty.checks, 'no_placeholder_stubs').evidence, /nothing to scan/);
});

test('delegation record names only the semantic remainder once enforcement runs', () => {
  const profile = DEFAULT_VALIDATOR_REGISTRY['12-security-threat-model'];
  const record = validatorDelegationCheck(profile, ['no_secrets_introduced']);
  assert.match(record.evidence, /enforced mechanically above/);
  assert.match(record.evidence, /no_secrets_introduced/);
  assert.ok(!record.evidence.includes('stride_categories_covered'), 'mechanically-enforced checks are no longer listed as delegated');
  // Back-compat: no argument lists the full declared set.
  const legacy = validatorDelegationCheck(profile);
  assert.match(legacy.evidence, /stride_categories_covered/);
});

test('every registry check id is either mechanical or consciously delegated', async () => {
  const declared = new Set();
  for (const profile of [GENERIC_VALIDATOR_PROFILE, ...Object.values(DEFAULT_VALIDATOR_REGISTRY)]) {
    for (const id of profile.required_checks) declared.add(id);
  }
  for (const id of declared) {
    if (DELEGATED_SEMANTIC_CHECKS.has(id)) continue;
    const result = await evaluateRequiredChecks(ctxFor({ stage_id: '06-architecture', required_checks: [id] }));
    const entry = byName(result.checks, id);
    assert.ok(entry, `${id} must produce a real check entry`);
    assert.ok(!/unknown required check/.test(entry.evidence),
      `${id} is declared in the shipped registry but has no mechanical evaluator — add one or move it to DELEGATED_SEMANTIC_CHECKS`);
  }
});

test('wired through the real sdlc_validate: missing stage artifact FAILs validation (#222)', async (t) => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-222-e2e-'));
  process.env.RSTACK_PROJECT_ROOT = projectRoot;
  t.after(() => {
    delete process.env.RSTACK_PROJECT_ROOT;
    rmSync(projectRoot, { recursive: true, force: true });
  });
  const mockPi = { tools: {}, commands: {}, on: () => {}, registerTool(tool) { this.tools[tool.name] = tool; }, registerCommand() {} };
  extension(mockPi);

  const start = await mockPi.tools.sdlc_start.execute('1', { goal: 'Required checks enforcement', mode: 'express' });
  const runId = start.details.run_id;
  const runDir = join(projectRoot, '.rstack', 'runs', runId);
  await mockPi.tools.sdlc_plan.execute('2', { run_id: runId });
  const claim = await mockPi.tools.sdlc_build_next.execute('3', { run_id: runId });
  const task = claim.details.task;

  // Point the claimed task at the security stage and write a COMPLETE builder
  // contract — so the ONLY failures left are the profile's required checks.
  const fs = await import('node:fs/promises');
  const taskState = JSON.parse(readFileSync(join(runDir, 'tasks.json'), 'utf8'));
  const entry = taskState.tasks.find((candidate) => candidate.id === task.id);
  entry.stage_artifacts = [{ stage_id: '12-security-threat-model', artifact_path: `.rstack/runs/${runId}/artifacts/stages/12-security-threat-model/threat_model.json` }];
  await fs.writeFile(join(runDir, 'tasks.json'), JSON.stringify(taskState, null, 2));
  await fs.writeFile(join(projectRoot, 'src-change.js'), 'export const ok = 1;\n');
  await fs.mkdir(join(projectRoot, task.output_dir), { recursive: true });
  await fs.writeFile(join(projectRoot, task.output_dir, 'builder.json'), JSON.stringify({
    task_id: task.id, status: 'PASS', summary: 'did the work',
    files_modified: ['src-change.js'], tests_run: ['npm test'], risks: [], next_steps: [],
    memory_summary: { work_done: 'Drafted the STRIDE threat model for the health-check endpoint', evidence: ['artifacts/stages/12-security-threat-model/threat_model.json'] },
    stage_summaries: [{ stage_id: '12-security-threat-model', summary: 'threat model drafted', work_done: 'Enumerated STRIDE threats with mitigations for the endpoint', evidence: ['artifacts/stages/12-security-threat-model/threat_model.json'] }],
  }, null, 2));

  const failing = await mockPi.tools.sdlc_validate.execute('4', { run_id: runId, task_id: task.id });
  assert.equal(failing.details.status, 'FAIL', 'missing threat_model.json must fail validation');
  const validation = JSON.parse(readFileSync(join(projectRoot, task.output_dir, 'validation.json'), 'utf8'));
  const artifactCheck = validation.checks.find((check) => check.name === 'required_check_threat_model_artifact_present');
  assert.equal(artifactCheck?.status, 'FAIL', 'the named required check appears as a real FAIL in validation.json');
  assert.ok(existsSync(join(projectRoot, task.output_dir, 'validation.json')));

  // Provide the artifact → the required checks flip and validation PASSes.
  await mockPi.tools.sdlc_build_next.execute('5', { run_id: runId }); // re-claim the FAIL task (#265 order)
  await fs.writeFile(join(projectRoot, task.output_dir, 'builder.json'), JSON.stringify({
    task_id: task.id, status: 'PASS', summary: 'did the work',
    files_modified: ['src-change.js'], tests_run: ['npm test'], risks: [], next_steps: [],
    memory_summary: { work_done: 'Drafted the STRIDE threat model for the health-check endpoint', evidence: ['artifacts/stages/12-security-threat-model/threat_model.json'] },
    stage_summaries: [{ stage_id: '12-security-threat-model', summary: 'threat model drafted', work_done: 'Enumerated STRIDE threats with mitigations for the endpoint', evidence: ['artifacts/stages/12-security-threat-model/threat_model.json'] }],
  }, null, 2));
  const stageDir = join(runDir, 'artifacts', 'stages', '12-security-threat-model');
  await fs.mkdir(stageDir, { recursive: true });
  await fs.writeFile(join(stageDir, 'threat_model.json'), JSON.stringify({
    threats: [{ category: 'Spoofing', risk: 'high', mitigation: 'mTLS' }],
    mitigations: ['mTLS'], risk_ratings: ['high'],
  }));
  const passing = await mockPi.tools.sdlc_validate.execute('6', { run_id: runId, task_id: task.id });
  assert.equal(passing.details.status, 'PASS', JSON.stringify(passing.details.checks?.filter?.((c) => c.status === 'FAIL') ?? passing.details));
});
