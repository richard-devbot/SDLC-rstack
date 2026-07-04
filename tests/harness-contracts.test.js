import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateBuilderContract,
  validateBuilderCompleteness,
  validateValidatorContract,
  BUILDER_REQUIRED_FIELDS,
  VALIDATOR_REQUIRED_FIELDS,
} from '../src/core/harness/contracts.js';

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

test('builder contract accepts optional Contract v2 execution telemetry', () => {
  const result = validateBuilderContract({
    task_id: '004-implementation',
    agent: 'builder',
    status: 'PASS',
    summary: 'Implemented with telemetry.',
    files_modified: ['src/app.js'],
    tests_run: ['npm test'],
    risks: [],
    next_steps: [],
    execution: { tools_used: ['read_file', 'patch'], events: [{ type: 'tool_call' }] },
    cost: { currency: 'USD', estimated_usd: 1.5, actual_usd: 1.25 },
    context: { profile: 'business-flex', injected_sources: ['requirements'] },
    routing: { selected_by: 'profile-domain-stage-affinity', explanation: ['profile:business-flex'] },
  }, '004-implementation');

  assert.equal(result.ok, true);
  assert.ok(result.checks.some((check) => check.name === 'builder_v2_execution_tools_used_is_array'));
  assert.ok(result.checks.some((check) => check.name === 'builder_v2_cost_values_are_numeric'));
});

test('builder contract v2 fields fail when present as non-objects', () => {
  // execution, cost, context, routing must be plain objects when present
  const base = {
    task_id: '004-implementation',
    agent: 'builder',
    status: 'PASS',
    summary: 'Contract v2 non-object edge case.',
    files_modified: [],
    tests_run: [],
    risks: [],
    next_steps: [],
  };

  for (const field of ['execution', 'cost', 'context', 'routing']) {
    // array value — should fail is_object check
    const withArray = { ...base, [field]: ['not', 'an', 'object'] };
    const arrayResult = validateBuilderContract(withArray, '004-implementation');
    const arrayCheck = arrayResult.checks.find((c) => c.name === `builder_v2_${field}_is_object`);
    assert.ok(arrayCheck, `check builder_v2_${field}_is_object should exist for array value`);
    assert.equal(arrayCheck.status, 'FAIL', `${field} as array should fail is_object`);

    // string value — should fail is_object check
    const withString = { ...base, [field]: 'just-a-string' };
    const stringResult = validateBuilderContract(withString, '004-implementation');
    const stringCheck = stringResult.checks.find((c) => c.name === `builder_v2_${field}_is_object`);
    assert.ok(stringCheck, `check builder_v2_${field}_is_object should exist for string value`);
    assert.equal(stringCheck.status, 'FAIL', `${field} as string should fail is_object`);

    // null value — should fail is_object check
    const withNull = { ...base, [field]: null };
    const nullResult = validateBuilderContract(withNull, '004-implementation');
    const nullCheck = nullResult.checks.find((c) => c.name === `builder_v2_${field}_is_object`);
    assert.ok(nullCheck, `check builder_v2_${field}_is_object should exist for null value`);
    assert.equal(nullCheck.status, 'FAIL', `${field} as null should fail is_object`);

    // valid object — should pass
    const withObject = { ...base, [field]: { key: 'value' } };
    const objectResult = validateBuilderContract(withObject, '004-implementation');
    const objectCheck = objectResult.checks.find((c) => c.name === `builder_v2_${field}_is_object`);
    assert.ok(objectCheck, `check builder_v2_${field}_is_object should exist for object value`);
    assert.equal(objectCheck.status, 'PASS', `${field} as object should pass`);
  }
});

test('builder contract v2 execution.tools_used fails when not an array', () => {
  const base = {
    task_id: '004-implementation',
    agent: 'builder',
    status: 'PASS',
    summary: 'Testing tools_used types.',
    files_modified: [],
    tests_run: [],
    risks: [],
    next_steps: [],
  };

  // string — should fail
  const withString = { ...base, execution: { tools_used: 'read_file,edit' } };
  const stringResult = validateBuilderContract(withString, '004-implementation');
  const stringCheck = stringResult.checks.find((c) => c.name === 'builder_v2_execution_tools_used_is_array');
  assert.ok(stringCheck, 'builder_v2_execution_tools_used_is_array check should exist');
  assert.equal(stringCheck.status, 'FAIL');

  // object — should fail
  const withObj = { ...base, execution: { tools_used: { read: true } } };
  const objResult = validateBuilderContract(withObj, '004-implementation');
  assert.equal(objResult.checks.find((c) => c.name === 'builder_v2_execution_tools_used_is_array').status, 'FAIL');

  // valid array — should pass with correct evidence
  const withArray = { ...base, execution: { tools_used: ['read_file', 'patch', 'bash'] } };
  const arrayResult = validateBuilderContract(withArray, '004-implementation');
  const arrayCheck = arrayResult.checks.find((c) => c.name === 'builder_v2_execution_tools_used_is_array');
  assert.equal(arrayCheck.status, 'PASS');
  assert.ok(arrayCheck.evidence.includes('3 tool(s)'));

  // empty array — still a valid array
  const withEmpty = { ...base, execution: { tools_used: [] } };
  const emptyResult = validateBuilderContract(withEmpty, '004-implementation');
  assert.equal(emptyResult.checks.find((c) => c.name === 'builder_v2_execution_tools_used_is_array').status, 'PASS');
});

test('builder contract v2 cost values fail when non-numeric', () => {
  const base = {
    task_id: '004-implementation',
    agent: 'builder',
    status: 'PASS',
    summary: 'Testing cost numeric validation.',
    files_modified: [],
    tests_run: [],
    risks: [],
    next_steps: [],
  };

  // string values — should fail
  const withStringCost = { ...base, cost: { estimated_usd: 'high', actual_usd: 'unknown' } };
  const stringResult = validateBuilderContract(withStringCost, '004-implementation');
  const stringCheck = stringResult.checks.find((c) => c.name === 'builder_v2_cost_values_are_numeric');
  assert.ok(stringCheck, 'builder_v2_cost_values_are_numeric check should exist');
  assert.equal(stringCheck.status, 'FAIL');

  // only estimated_usd present and numeric — should pass
  const withOnlyEstimated = { ...base, cost: { currency: 'USD', estimated_usd: 1.5 } };
  const estimatedResult = validateBuilderContract(withOnlyEstimated, '004-implementation');
  const estimatedCheck = estimatedResult.checks.find((c) => c.name === 'builder_v2_cost_values_are_numeric');
  assert.ok(estimatedCheck);
  assert.equal(estimatedCheck.status, 'PASS');

  // only actual_usd present and numeric — should pass
  const withOnlyActual = { ...base, cost: { currency: 'USD', actual_usd: 0.75 } };
  const actualResult = validateBuilderContract(withOnlyActual, '004-implementation');
  assert.equal(actualResult.checks.find((c) => c.name === 'builder_v2_cost_values_are_numeric').status, 'PASS');

  // both present and numeric — should pass
  const withBoth = { ...base, cost: { currency: 'USD', estimated_usd: 2.0, actual_usd: 1.8 } };
  const bothResult = validateBuilderContract(withBoth, '004-implementation');
  assert.equal(bothResult.checks.find((c) => c.name === 'builder_v2_cost_values_are_numeric').status, 'PASS');
  assert.equal(bothResult.ok, true);

  // estimated_usd is a non-numeric string but actual_usd is null (not present) — only estimated checked
  const withBadEstimated = { ...base, cost: { estimated_usd: 'NaN-ish' } };
  const badEstimatedResult = validateBuilderContract(withBadEstimated, '004-implementation');
  assert.equal(badEstimatedResult.checks.find((c) => c.name === 'builder_v2_cost_values_are_numeric').status, 'FAIL');
});

test('builder contract v2 cost check is skipped when both cost values are absent', () => {
  const contract = {
    task_id: '004-implementation',
    agent: 'builder',
    status: 'PASS',
    summary: 'No cost info.',
    files_modified: [],
    tests_run: [],
    risks: [],
    next_steps: [],
    cost: { currency: 'USD' }, // no estimated_usd or actual_usd
  };
  const result = validateBuilderContract(contract, '004-implementation');
  assert.ok(result.ok);
  // cost check should NOT be generated when both values are absent
  assert.ok(!result.checks.some((c) => c.name === 'builder_v2_cost_values_are_numeric'));
});

test('builder contract v2 checks are absent when v2 fields are not present', () => {
  const minimalContract = {
    task_id: '004-implementation',
    agent: 'builder',
    status: 'PASS',
    summary: 'Minimal contract with no v2 telemetry.',
    files_modified: [],
    tests_run: [],
    risks: [],
    next_steps: [],
  };
  const result = validateBuilderContract(minimalContract, '004-implementation');
  assert.equal(result.ok, true);
  const v2CheckNames = result.checks.filter((c) => c.name.startsWith('builder_v2_'));
  assert.equal(v2CheckNames.length, 0, 'no v2 checks should be generated for minimal contracts');
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

test('builder completeness requires evidence, memory summaries, and stage summaries for passing statuses', () => {
  const complete = {
    task_id: '004-implementation',
    status: 'PASS',
    summary: 'Implemented the payment flow end to end.',
    files_modified: ['src/pay.js'],
    tests_run: ['npm test'],
    risks: [],
    next_steps: [],
    memory_summary: {
      work_done: 'Built and validated the payment flow.',
      evidence: ['tests/pay.test.js'],
    },
    stage_summaries: [
      { stage_id: '07-code', work_done: 'Implemented payment module.', evidence: ['src/pay.js'] },
    ],
  };
  const ok = validateBuilderCompleteness(complete, { expectedStageIds: ['07-code'] });
  assert.equal(ok.ok, true);

  // PASS without memory_summary.evidence must fail with an actionable issue.
  const missingEvidence = { ...complete, memory_summary: { work_done: 'Built and validated the payment flow.', evidence: [] } };
  const bad = validateBuilderCompleteness(missingEvidence, { expectedStageIds: ['07-code'] });
  assert.equal(bad.ok, false);
  const issue = bad.issues.find((check) => check.name === 'builder_memory_summary_evidence');
  assert.ok(issue, 'missing evidence must surface as a named issue');
  assert.match(issue.evidence, /proof paths or commands/);

  // DONE_WITH_CONCERNS is held to the same bar.
  const concerns = validateBuilderCompleteness({ ...missingEvidence, status: 'DONE_WITH_CONCERNS' }, { expectedStageIds: ['07-code'] });
  assert.equal(concerns.ok, false);

  // FAIL and BLOCKED are valid statuses and exempt from completeness.
  for (const status of ['FAIL', 'BLOCKED']) {
    const exempt = validateBuilderCompleteness({ status }, { expectedStageIds: ['07-code'] });
    assert.equal(exempt.ok, true);
    assert.equal(exempt.checks.length, 0);
  }
});

test('builder completeness enforces per-stage summaries against the task packet', () => {
  const builder = {
    status: 'PASS',
    summary: 'Delivered requirements and planning stages.',
    tests_run: ['SKIPPED: docs-only stage'],
    memory_summary: { work_done: 'Wrote requirement and planning artifacts.', evidence: ['requirements.json'] },
    stage_summaries: [
      { stage_id: '02-requirements', work_done: 'Extracted functional requirements.', evidence: ['requirements.json'] },
    ],
  };

  const result = validateBuilderCompleteness(builder, { expectedStageIds: ['02-requirements', '04-planning'] });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((check) => check.name === 'stage_summary_04-planning_exists'));

  // Summaries for stages outside the packet are flagged.
  const foreign = validateBuilderCompleteness(
    { ...builder, stage_summaries: [...builder.stage_summaries, { stage_id: '09-deployment', work_done: 'Deployed something unexpected.', evidence: ['deploy.log'] }] },
    { expectedStageIds: ['02-requirements'] },
  );
  assert.equal(foreign.ok, false);
  assert.ok(foreign.issues.some((check) => check.name === 'stage_summaries_only_known_stages'));

  // No canonical stage targets -> completeness passes with an explicit marker.
  const none = validateBuilderCompleteness(builder, { expectedStageIds: [] });
  assert.ok(none.checks.some((check) => check.name === 'stage_summaries_not_required' && check.status === 'PASS'));
});

test('builder completeness fails a PASS contract missing memory_summary entirely', () => {
  const noMemory = {
    status: 'PASS',
    summary: 'Implemented the payment flow end to end.',
    tests_run: ['npm test'],
    stage_summaries: [{ stage_id: '07-code', work_done: 'Implemented payment module.', evidence: ['src/pay.js'] }],
  };
  const result = validateBuilderCompleteness(noMemory, { expectedStageIds: ['07-code'] });
  assert.equal(result.ok, false);
  const exists = result.issues.find((check) => check.name === 'builder_memory_summary_exists');
  assert.ok(exists, 'absent memory_summary must fail the exists check');
  assert.equal(exists.evidence, 'missing memory_summary');
});

test('builder completeness tolerates null or non-array expectedStageIds', () => {
  const builder = {
    status: 'PASS',
    summary: 'Delivered with valid memory summaries.',
    tests_run: ['npm test'],
    memory_summary: { work_done: 'Delivered the work end to end.', evidence: ['tests/x.test.js'] },
  };
  for (const bad of [null, undefined, 'not-an-array', 42]) {
    const result = validateBuilderCompleteness(builder, { expectedStageIds: bad });
    assert.ok(result.checks.some((check) => check.name === 'stage_summaries_not_required'), `expectedStageIds=${String(bad)} must degrade to no stage targets, not throw`);
  }
});

test('builder completeness rejects junk evidence entries that carry no text', () => {
  const base = {
    status: 'PASS',
    summary: 'Attempting to pass with junk evidence.',
    memory_summary: { work_done: 'Did the work with proof attached.', evidence: [{}] },
    tests_run: [{}],
  };
  const junk = validateBuilderCompleteness(base, { expectedStageIds: [] });
  assert.equal(junk.ok, false);
  assert.ok(junk.issues.some((check) => check.name === 'builder_tests_run_has_evidence'));
  assert.ok(junk.issues.some((check) => check.name === 'builder_memory_summary_evidence'));

  // Object-shaped evidence with real text remains valid.
  const structured = validateBuilderCompleteness({
    ...base,
    tests_run: ['npm test'],
    memory_summary: { work_done: 'Did the work with proof attached.', evidence: [{ kind: 'file', path: 'tests/pay.test.js' }] },
  }, { expectedStageIds: [] });
  assert.equal(structured.ok, true);
});
