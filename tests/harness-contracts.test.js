import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateBuilderContract,
  validateValidatorContract,
  BUILDER_REQUIRED_FIELDS,
  VALIDATOR_REQUIRED_FIELDS,
} from '../src/harness/contracts.js';

test('builder contract requires all Harness fields; agent is optional with graceful default', () => {
  const valid = {
    task_id: '004-implementation',
    agent: 'builder',
    status: 'PASS',
    summary: 'Implemented harness foundation.',
    files_modified: ['src/harness/stages.js'],
    tests_run: ['npm test'],
    risks: [],
    next_steps: [],
  };

  const result = validateBuilderContract(valid, '004-implementation');
  assert.equal(result.ok, true);
  // agent is no longer hard-required — backward-compat with older/external builders
  assert.deepEqual(BUILDER_REQUIRED_FIELDS, ['task_id', 'status', 'summary', 'files_modified', 'tests_run', 'risks', 'next_steps']);

  // missing agent still passes (defaults to 'builder') — does not block validation
  const missingAgent = { ...valid };
  delete missingAgent.agent;
  const missingResult = validateBuilderContract(missingAgent, '004-implementation');
  assert.equal(missingResult.ok, true);
  const agentCheck = missingResult.checks.find((c) => c.name === 'builder_has_agent');
  assert.ok(agentCheck, 'builder_has_agent check should exist');
  assert.equal(agentCheck.status, 'PASS');
  assert.ok(agentCheck.evidence.includes("defaulted to 'builder'"));
});

test('builder contract validates task id, status, and array fields', () => {
  const result = validateBuilderContract({
    task_id: 'wrong-task',
    agent: 'builder',
    status: 'DONE',
    summary: 'Bad contract.',
    files_modified: 'src/harness/stages.js',
    tests_run: [],
    risks: [],
    next_steps: [],
  }, '004-implementation');

  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.name === 'builder_task_id_matches'));
  assert.ok(result.issues.some((issue) => issue.name === 'builder_status_allowed'));
  assert.ok(result.issues.some((issue) => issue.name === 'builder_files_modified_is_array'));
});

test('validator contract requires all Harness fields', () => {
  const valid = {
    task_id: '004-implementation',
    validator: 'rstack-pi-extension',
    status: 'PASS',
    checks: [],
    issues: [],
    retry_recommendation: 'none',
  };

  const result = validateValidatorContract(valid, '004-implementation');
  assert.equal(result.ok, true);
  assert.deepEqual(VALIDATOR_REQUIRED_FIELDS, ['task_id', 'validator', 'status', 'checks', 'issues', 'retry_recommendation']);

  const invalid = { ...valid, retry_recommendation: 'maybe', checks: 'not-array' };
  delete invalid.validator;
  const invalidResult = validateValidatorContract(invalid, '004-implementation');
  assert.equal(invalidResult.ok, false);
  assert.ok(invalidResult.issues.some((issue) => issue.name === 'validator_has_validator'));
  assert.ok(invalidResult.issues.some((issue) => issue.name === 'validator_retry_recommendation_allowed'));
  assert.ok(invalidResult.issues.some((issue) => issue.name === 'validator_checks_is_array'));
});
