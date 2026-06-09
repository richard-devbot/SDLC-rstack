export const BUILDER_REQUIRED_FIELDS = Object.freeze([
  'task_id',
  'status',
  'summary',
  'files_modified',
  'tests_run',
  'risks',
  'next_steps',
]);

export const VALIDATOR_REQUIRED_FIELDS = Object.freeze([
  'task_id',
  'validator',
  'status',
  'checks',
  'issues',
  'retry_recommendation',
]);

export const BUILDER_STATUSES = Object.freeze(['PASS', 'FAIL', 'BLOCKED', 'DONE_WITH_CONCERNS']);
export const VALIDATOR_STATUSES = Object.freeze(['PASS', 'FAIL']);
export const RETRY_RECOMMENDATIONS = Object.freeze(['none', 'retry_builder', 'ask_user', 'block']);

function hasOwn(value, field) {
  return Object.prototype.hasOwnProperty.call(value, field);
}

export function validateRequiredFields(value, fields, prefix) {
  return fields.map((field) => {
    const present = value && hasOwn(value, field);
    return {
      name: `${prefix}_has_${field}`,
      status: present ? 'PASS' : 'FAIL',
      evidence: present ? 'present' : 'missing',
    };
  });
}

function summarizeChecks(checks) {
  return {
    ok: checks.every((check) => check.status === 'PASS'),
    checks,
    issues: checks.filter((check) => check.status === 'FAIL'),
  };
}

export function validateBuilderContract(builder, expectedTaskId) {
  const checks = validateRequiredFields(builder, BUILDER_REQUIRED_FIELDS, 'builder');

  // agent is optional — default to 'builder' for backward compat and external builders
  checks.push({
    name: 'builder_has_agent',
    status: 'PASS',
    evidence: (builder && hasOwn(builder, 'agent') && builder.agent)
      ? String(builder.agent)
      : "not set, defaulted to 'builder'",
  });

  if (builder && hasOwn(builder, 'task_id')) {
    const matches = !expectedTaskId || builder.task_id === expectedTaskId;
    checks.push({
      name: 'builder_task_id_matches',
      status: matches ? 'PASS' : 'FAIL',
      evidence: matches ? builder.task_id : `expected ${expectedTaskId}, got ${builder.task_id}`,
    });
  }

  if (builder && hasOwn(builder, 'status')) {
    const allowed = BUILDER_STATUSES.includes(builder.status);
    checks.push({
      name: 'builder_status_allowed',
      status: allowed ? 'PASS' : 'FAIL',
      evidence: String(builder.status),
    });
  }

  for (const field of ['files_modified', 'tests_run', 'risks', 'next_steps']) {
    if (builder && hasOwn(builder, field)) {
      const isArray = Array.isArray(builder[field]);
      checks.push({
        name: `builder_${field}_is_array`,
        status: isArray ? 'PASS' : 'FAIL',
        evidence: isArray ? `${builder[field].length} item(s)` : 'not an array',
      });
    }
  }

  for (const field of ['execution', 'cost', 'context', 'routing']) {
    if (builder && hasOwn(builder, field)) {
      const isObject = builder[field] && typeof builder[field] === 'object' && !Array.isArray(builder[field]);
      checks.push({
        name: `builder_v2_${field}_is_object`,
        status: isObject ? 'PASS' : 'FAIL',
        evidence: isObject ? 'structured telemetry present' : 'not an object',
      });
    }
  }

  if (builder?.execution?.tools_used) {
    const isArray = Array.isArray(builder.execution.tools_used);
    checks.push({
      name: 'builder_v2_execution_tools_used_is_array',
      status: isArray ? 'PASS' : 'FAIL',
      evidence: isArray ? `${builder.execution.tools_used.length} tool(s)` : 'not an array',
    });
  }

  if (builder?.cost?.estimated_usd != null || builder?.cost?.actual_usd != null) {
    const numeric = ['estimated_usd', 'actual_usd']
      .filter((field) => builder.cost[field] != null)
      .every((field) => Number.isFinite(Number(builder.cost[field])));
    checks.push({
      name: 'builder_v2_cost_values_are_numeric',
      status: numeric ? 'PASS' : 'FAIL',
      evidence: numeric ? 'numeric cost telemetry' : 'non-numeric cost telemetry',
    });
  }

  if (builder && ['BLOCKED', 'FAIL'].includes(builder.status)) {
    checks.push({
      name: 'builder_reported_not_pass',
      status: 'FAIL',
      evidence: builder.status,
    });
  }

  return summarizeChecks(checks);
}

export function validateValidatorContract(validator, expectedTaskId) {
  const checks = validateRequiredFields(validator, VALIDATOR_REQUIRED_FIELDS, 'validator');

  if (validator && hasOwn(validator, 'task_id')) {
    const matches = !expectedTaskId || validator.task_id === expectedTaskId;
    checks.push({
      name: 'validator_task_id_matches',
      status: matches ? 'PASS' : 'FAIL',
      evidence: matches ? validator.task_id : `expected ${expectedTaskId}, got ${validator.task_id}`,
    });
  }

  if (validator && hasOwn(validator, 'status')) {
    const allowed = VALIDATOR_STATUSES.includes(validator.status);
    checks.push({
      name: 'validator_status_allowed',
      status: allowed ? 'PASS' : 'FAIL',
      evidence: String(validator.status),
    });
  }

  if (validator && hasOwn(validator, 'retry_recommendation')) {
    const allowed = RETRY_RECOMMENDATIONS.includes(validator.retry_recommendation);
    checks.push({
      name: 'validator_retry_recommendation_allowed',
      status: allowed ? 'PASS' : 'FAIL',
      evidence: String(validator.retry_recommendation),
    });
  }

  for (const field of ['checks', 'issues']) {
    if (validator && hasOwn(validator, field)) {
      const isArray = Array.isArray(validator[field]);
      checks.push({
        name: `validator_${field}_is_array`,
        status: isArray ? 'PASS' : 'FAIL',
        evidence: isArray ? `${validator[field].length} item(s)` : 'not an array',
      });
    }
  }

  return summarizeChecks(checks);
}
