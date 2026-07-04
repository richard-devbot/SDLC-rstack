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

function hasMeaningfulText(value, minLength = 10) {
  return typeof value === 'string' && value.trim().length >= minLength;
}

// Evidence entries must carry actual text — a command, a path, or an object
// with at least one non-empty string field. Bare truthy junk like [{}] is not
// proof and must not satisfy the completeness gate.
function meaningfulEvidenceItem(item) {
  if (typeof item === 'string') return item.trim().length > 0;
  if (item && typeof item === 'object' && !Array.isArray(item)) {
    return Object.values(item).some((value) => typeof value === 'string' && value.trim().length > 0);
  }
  return false;
}

function hasNonEmptyArray(value) {
  return Array.isArray(value) && value.some(meaningfulEvidenceItem);
}

// Completeness gate for passing builders (#118): a PASS or DONE_WITH_CONCERNS
// contract must carry enough structure for validators, retries, memory, and
// later agents — evidence, memory summaries, and per-stage summaries. FAIL and
// BLOCKED contracts are exempt: they are valid statuses, just never passing.
export function validateBuilderCompleteness(builder, { expectedStageIds = [] } = {}) {
  const checks = [];
  const passingStatus = ['PASS', 'DONE_WITH_CONCERNS'].includes(builder?.status);
  if (!passingStatus) return summarizeChecks(checks);
  // Shared harness API: tolerate null/non-array option shapes instead of
  // throwing mid-validation in external consumers.
  const stageIdTargets = Array.isArray(expectedStageIds) ? expectedStageIds.filter(Boolean) : [];

  checks.push({
    name: 'builder_summary_meaningful',
    status: hasMeaningfulText(builder?.summary, 10) ? 'PASS' : 'FAIL',
    evidence: hasMeaningfulText(builder?.summary, 10) ? 'summary present' : 'summary must be at least 10 characters',
  });

  checks.push({
    name: 'builder_tests_run_has_evidence',
    status: hasNonEmptyArray(builder?.tests_run) ? 'PASS' : 'FAIL',
    evidence: hasNonEmptyArray(builder?.tests_run) ? `${builder.tests_run.length} item(s)` : 'tests_run must include commands run or SKIPPED: reason',
  });

  checks.push({
    name: 'builder_memory_summary_exists',
    status: builder?.memory_summary && typeof builder.memory_summary === 'object' ? 'PASS' : 'FAIL',
    evidence: builder?.memory_summary && typeof builder.memory_summary === 'object' ? 'present' : 'missing memory_summary',
  });

  checks.push({
    name: 'builder_memory_summary_work_done',
    status: hasMeaningfulText(builder?.memory_summary?.work_done, 10) ? 'PASS' : 'FAIL',
    evidence: hasMeaningfulText(builder?.memory_summary?.work_done, 10) ? 'present' : 'memory_summary.work_done missing or too short',
  });

  checks.push({
    name: 'builder_memory_summary_evidence',
    status: hasNonEmptyArray(builder?.memory_summary?.evidence) ? 'PASS' : 'FAIL',
    evidence: hasNonEmptyArray(builder?.memory_summary?.evidence) ? `${builder.memory_summary.evidence.length} item(s)` : 'memory_summary.evidence must list proof paths or commands',
  });

  const stageSummaries = Array.isArray(builder?.stage_summaries) ? builder.stage_summaries : [];
  const actualStageIds = new Set(stageSummaries.map((item) => item?.stage_id).filter(Boolean));
  for (const stageId of stageIdTargets) {
    const summary = stageSummaries.find((item) => item?.stage_id === stageId);
    checks.push({
      name: `stage_summary_${stageId}_exists`,
      status: summary ? 'PASS' : 'FAIL',
      evidence: summary ? 'present' : `missing stage_summaries entry for ${stageId}`,
    });
    if (summary) {
      checks.push({
        name: `stage_summary_${stageId}_work_done`,
        status: hasMeaningfulText(summary.work_done, 10) ? 'PASS' : 'FAIL',
        evidence: hasMeaningfulText(summary.work_done, 10) ? 'present' : 'work_done missing or too short',
      });
      checks.push({
        name: `stage_summary_${stageId}_evidence`,
        status: hasNonEmptyArray(summary.evidence) ? 'PASS' : 'FAIL',
        evidence: hasNonEmptyArray(summary.evidence) ? `${summary.evidence.length} item(s)` : 'evidence must list proof paths or commands',
      });
    }
  }
  if (!stageIdTargets.length) {
    checks.push({
      name: 'stage_summaries_not_required',
      status: 'PASS',
      evidence: 'task has no canonical stage targets',
    });
  } else if (stageSummaries.length) {
    checks.push({
      name: 'stage_summaries_only_known_stages',
      status: stageSummaries.every((item) => !item?.stage_id || stageIdTargets.includes(item.stage_id)) ? 'PASS' : 'FAIL',
      evidence: `expected ${stageIdTargets.join(', ')}; got ${[...actualStageIds].join(', ')}`,
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
