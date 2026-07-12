// Review independence (#72): builder/validator identity in contracts, the
// review_policy config block, the pure evaluator (pass / warn / block /
// ask_user / waiver / unverified), and the `review independence` CLI verb.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  DEFAULT_REVIEW_POLICY,
  evaluateReviewIndependence,
  loadReviewPolicy,
  reviewPolicyForProfile,
  validateReviewPolicyConfig,
  validatorTypeForStage,
} from '../src/core/harness/review-independence.js';
import { validatePolicyConfig } from '../src/core/harness/config-validation.js';
import { validateBuilderContract, validateValidatorContract } from '../src/core/harness/contracts.js';
import { runReviewIndependence } from '../src/commands/exposure.js';

const CROSS = {
  builder: { agent: 'backend-builder', harness: 'claude-code', model: 'claude-sonnet-5' },
  validators: [
    { validator: 'validator.07-code', validator_type: 'code', harness: 'codex', model: 'gpt-5', status: 'PASS' },
  ],
};

test('policy disabled → PASS and not enforced', () => {
  const result = evaluateReviewIndependence({
    builder: { harness: 'claude-code' },
    validators: [{ validator: 'v', harness: 'claude-code' }],
    policy: DEFAULT_REVIEW_POLICY,
  });
  assert.equal(result.enforced, false);
  assert.equal(result.status, 'PASS');
});

test('cross-harness review satisfies the enterprise policy', () => {
  const result = evaluateReviewIndependence({ ...CROSS, policy: reviewPolicyForProfile('enterprise-webapp') });
  assert.equal(result.enforced, true);
  assert.equal(result.status, 'PASS');
  assert.deepEqual(result.same_harness_findings, []);
  assert.equal(result.builder.harness, 'claude-code');
  assert.equal(result.validators[0].harness, 'codex');
});

test('same-harness self-validation WARNs under business-flex', () => {
  const result = evaluateReviewIndependence({
    builder: { harness: 'claude-code' },
    validators: [{ validator: 'validator.07-code', validator_type: 'code', harness: 'claude-code', status: 'PASS' }],
    policy: reviewPolicyForProfile('business-flex'),
  });
  assert.equal(result.status, 'WARN');
  assert.equal(result.same_harness_findings.length, 1);
  assert.match(result.same_harness_findings[0], /claude-code/);
  assert.equal(result.recommendation, null);
});

test('same-harness self-validation FAILs with block under enterprise-webapp', () => {
  const result = evaluateReviewIndependence({
    builder: { harness: 'claude-code' },
    validators: [{ validator: 'validator.07-code', validator_type: 'code', harness: 'claude-code', status: 'PASS' }],
    policy: reviewPolicyForProfile('enterprise-webapp'),
  });
  assert.equal(result.status, 'FAIL');
  assert.equal(result.recommendation, 'block');
});

test('ask_user fallback FAILs with an ask_user recommendation', () => {
  const result = evaluateReviewIndependence({
    builder: { harness: 'pi' },
    validators: [{ validator: 'v', harness: 'pi' }],
    policy: { forbid_same_harness_builder_and_validator: true, fallback_behavior: 'ask_user' },
  });
  assert.equal(result.status, 'FAIL');
  assert.equal(result.recommendation, 'ask_user');
});

test('missing required validator types are a confirmed violation', () => {
  const result = evaluateReviewIndependence({
    ...CROSS,
    policy: { required_validators: ['code', 'test', 'security'], fallback_behavior: 'block' },
  });
  assert.equal(result.status, 'FAIL');
  assert.deepEqual(result.missing_validator_types, ['test', 'security']);
});

test('missing identity metadata degrades to WARN, never a hard block', () => {
  const result = evaluateReviewIndependence({
    builder: { agent: 'builder' }, // legacy pre-#72 contract: no harness
    validators: [{ validator: 'rstack-pi-extension', status: 'PASS' }],
    policy: reviewPolicyForProfile('enterprise-webapp'), // fallback: block
  });
  assert.equal(result.status, 'WARN');
  assert.ok(result.unverified.length >= 1);
  assert.equal(result.recommendation, null);
});

test('a waiver with reason and approver downgrades a violation to recorded PASS', () => {
  const result = evaluateReviewIndependence({
    builder: { harness: 'claude-code' },
    validators: [{ validator: 'v', harness: 'claude-code' }],
    policy: reviewPolicyForProfile('enterprise-webapp'),
    waiver: { reason: 'single-harness lab environment', approved_by: 'richardson' },
  });
  assert.equal(result.status, 'PASS');
  assert.equal(result.waived, true);
  assert.match(result.explanation, /waived by richardson/);
  // a violation remains on record even when waived
  assert.equal(result.same_harness_findings.length, 1);
});

test('a waiver missing reason or approver does not waive anything', () => {
  const result = evaluateReviewIndependence({
    builder: { harness: 'claude-code' },
    validators: [{ validator: 'v', harness: 'claude-code' }],
    policy: reviewPolicyForProfile('enterprise-webapp'),
    waiver: { reason: '   ' },
  });
  assert.equal(result.status, 'FAIL');
  assert.equal(result.waived, false);
});

test('profile postures: enterprise blocks, business-flex warns, lean-mvp is off', () => {
  const enterprise = reviewPolicyForProfile('enterprise-webapp');
  assert.equal(enterprise.require_cross_harness_review, true);
  assert.equal(enterprise.forbid_same_harness_builder_and_validator, true);
  assert.equal(enterprise.fallback_behavior, 'block');
  const flex = reviewPolicyForProfile('business-flex');
  assert.equal(flex.require_cross_harness_review, false);
  assert.equal(flex.forbid_same_harness_builder_and_validator, true);
  assert.equal(flex.fallback_behavior, 'warn');
  const lean = reviewPolicyForProfile('lean-mvp');
  assert.equal(lean.forbid_same_harness_builder_and_validator, false);
  assert.equal(lean.require_cross_harness_review, false);
});

test('stage → validator type mapping', () => {
  assert.equal(validatorTypeForStage('07-code'), 'code');
  assert.equal(validatorTypeForStage('08-testing'), 'test');
  assert.equal(validatorTypeForStage('12-security-threat-model'), 'security');
  assert.equal(validatorTypeForStage(null), 'generic');
});

test('review_policy config validation names bad fields', () => {
  assert.deepEqual(validateReviewPolicyConfig({
    require_cross_harness_review: true,
    forbid_same_harness_builder_and_validator: false,
    required_validators: ['code'],
    fallback_behavior: 'warn',
  }), []);
  const issues = validateReviewPolicyConfig({
    require_cross_harness_review: 'yes',
    required_validators: ['code', ''],
    fallback_behavior: 'explode',
    surprise: true,
  });
  const fields = issues.map((issue) => issue.field);
  assert.ok(fields.includes('review_policy.require_cross_harness_review'));
  assert.ok(fields.includes('review_policy.required_validators'));
  assert.ok(fields.includes('review_policy.fallback_behavior'));
  assert.ok(fields.includes('review_policy.surprise'));
});

test('validatePolicyConfig routes the review_policy block', () => {
  const issues = validatePolicyConfig({ review_policy: { fallback_behavior: 'explode' } });
  assert.ok(issues.some((issue) => issue.field === 'review_policy.fallback_behavior'));
  assert.deepEqual(validatePolicyConfig({ review_policy: { fallback_behavior: 'block' } }), []);
});

test('loadReviewPolicy overlays policy.json on the profile posture', async () => {
  const root = mkdtempSync(join(tmpdir(), 'rstack-review-'));
  mkdirSync(join(root, '.rstack'), { recursive: true });
  writeFileSync(join(root, '.rstack', 'rstack.config.json'), JSON.stringify({ profile: 'lean-mvp' }));
  writeFileSync(join(root, '.rstack', 'policy.json'), JSON.stringify({
    review_policy: {
      require_cross_harness_review: true,
      required_validators: ['code'],
      fallback_behavior: 'not-a-real-fallback', // invalid → profile default survives
    },
  }));
  const policy = await loadReviewPolicy(root);
  assert.equal(policy.require_cross_harness_review, true);
  assert.deepEqual(policy.required_validators, ['code']);
  assert.equal(policy.fallback_behavior, 'warn');
});

test('builder and validator contracts record identity informationally', () => {
  const builder = validateBuilderContract({
    task_id: 't1', status: 'PASS', summary: 'did the work well', files_modified: [],
    tests_run: ['npm test'], risks: [], next_steps: [], harness: 'claude-code', model: 'claude-sonnet-5',
  }, 't1');
  assert.ok(builder.ok);
  const harnessCheck = builder.checks.find((check) => check.name === 'builder_has_harness');
  assert.equal(harnessCheck.status, 'PASS');
  assert.equal(harnessCheck.evidence, 'claude-code');
  // absent identity stays PASS (legacy contracts remain valid) but says so
  const legacy = validateBuilderContract({
    task_id: 't1', status: 'PASS', summary: 'did the work well', files_modified: [],
    tests_run: ['npm test'], risks: [], next_steps: [],
  }, 't1');
  assert.ok(legacy.ok);
  assert.match(legacy.checks.find((check) => check.name === 'builder_has_harness').evidence, /not set/);

  const validator = validateValidatorContract({
    task_id: 't1', validator: 'validator.07-code', status: 'PASS', checks: [], issues: [],
    retry_recommendation: 'none', harness: 'codex', model: 'gpt-5', validator_type: 'code',
  }, 't1');
  assert.ok(validator.ok);
  assert.equal(validator.checks.find((check) => check.name === 'validator_has_validator_type').evidence, 'code');
});

test('review independence CLI verb audits a run from real contract files', async () => {
  const root = mkdtempSync(join(tmpdir(), 'rstack-review-cli-'));
  const runId = 'run-20260712-independence';
  const runDir = join(root, '.rstack', 'runs', runId);
  const okTaskDir = join(runDir, 'tasks', '001-code');
  const badTaskDir = join(runDir, 'tasks', '002-code');
  mkdirSync(okTaskDir, { recursive: true });
  mkdirSync(badTaskDir, { recursive: true });
  writeFileSync(join(root, '.rstack', 'rstack.config.json'), JSON.stringify({ profile: 'enterprise-webapp' }));
  writeFileSync(join(runDir, 'tasks.json'), JSON.stringify({
    tasks: [
      { id: '001-code', output_dir: `.rstack/runs/${runId}/tasks/001-code` },
      { id: '002-code', output_dir: `.rstack/runs/${runId}/tasks/002-code` },
      { id: '003-unstarted', output_dir: `.rstack/runs/${runId}/tasks/003-unstarted` },
    ],
  }));
  const builder = { task_id: '001-code', agent: 'builder', harness: 'claude-code', status: 'PASS' };
  writeFileSync(join(okTaskDir, 'builder.json'), JSON.stringify(builder));
  writeFileSync(join(okTaskDir, 'validator-code.json'), JSON.stringify({
    validator: 'external-reviewer', validator_type: 'code', harness: 'codex', status: 'PASS',
  }));
  writeFileSync(join(badTaskDir, 'builder.json'), JSON.stringify({ ...builder, task_id: '002-code' }));
  writeFileSync(join(badTaskDir, 'validation.json'), JSON.stringify({
    validator: 'rstack-pi-extension', validator_type: 'code', harness: 'claude-code', status: 'PASS',
  }));

  const result = await runReviewIndependence(root, { runId });
  assert.equal(result.enforced, true);
  assert.equal(result.task_count, 2); // unstarted task has nothing to audit
  assert.equal(result.status, 'FAIL'); // worst of PASS + FAIL
  const ok = result.tasks.find((t) => t.task_id === '001-code');
  const bad = result.tasks.find((t) => t.task_id === '002-code');
  assert.equal(ok.status, 'PASS');
  assert.equal(bad.status, 'FAIL');
  assert.ok(bad.independence.same_harness_findings.length >= 1);
});
