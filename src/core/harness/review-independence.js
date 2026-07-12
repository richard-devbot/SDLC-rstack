// owner: RStack developed by Richardson Gunde
//
// Review independence (#72): the same model/harness that builds a change must
// not be the only actor validating it. Contracts now carry producer identity
// (agent + harness + model); this module evaluates that identity against a
// `review_policy` (from .rstack/policy.json, defaulted per profile) and
// produces the machine-readable `independence` artifact embedded in
// validation.json and surfaced in the Business Hub.
//
// Enforcement is honest about what it can prove:
//   - a CONFIRMED violation (same-harness self-validation, missing required
//     validator type, no cross-harness validator among known identities)
//     escalates per `fallback_behavior` — warn | ask_user | block;
//   - MISSING identity (legacy contracts written before #72 carry no harness
//     field) can never hard-block a run — it degrades to WARN with the gap
//     named, because blocking on the absence of metadata would brick every
//     pre-#72 run while proving nothing about independence.
// A waiver (reason + approved_by) downgrades a violation to a recorded PASS,
// mirroring the guardrail-override audit pattern.

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const REVIEW_FALLBACK_BEHAVIORS = Object.freeze(['ask_user', 'warn', 'block']);

export const DEFAULT_REVIEW_POLICY = Object.freeze({
  require_cross_harness_review: false,
  forbid_same_harness_builder_and_validator: false,
  required_validators: Object.freeze([]),
  fallback_behavior: 'warn',
});

// Stage id → validator type, so `required_validators: ["code", "test",
// "security"]` in policy.json maps onto the stage-keyed validator registry
// without a second taxonomy.
const STAGE_VALIDATOR_TYPES = Object.freeze({
  '06-architecture': 'architecture',
  '07-code': 'code',
  '08-testing': 'test',
  '12-security-threat-model': 'security',
  '13-compliance-checker': 'compliance',
});

export function validatorTypeForStage(stageId) {
  return STAGE_VALIDATOR_TYPES[stageId] ?? 'generic';
}

// Profile posture (#72 acceptance): enterprise-webapp requires cross-harness
// review and blocks on confirmed violations; business-flex warns when the same
// harness validates its own work; lean-mvp leaves the policy off.
export function reviewPolicyForProfile(name = 'business-flex') {
  if (name === 'enterprise-webapp') {
    return {
      ...DEFAULT_REVIEW_POLICY,
      require_cross_harness_review: true,
      forbid_same_harness_builder_and_validator: true,
      fallback_behavior: 'block',
    };
  }
  if (name === 'business-flex') {
    return { ...DEFAULT_REVIEW_POLICY, forbid_same_harness_builder_and_validator: true };
  }
  return { ...DEFAULT_REVIEW_POLICY };
}

// Field rules for the policy.json `review_policy` block, invoked by
// validatePolicyConfig so the rules live next to the defaults they guard
// (context-pressure precedent).
export function validateReviewPolicyConfig(parsed) {
  const issues = [];
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return [{ field: 'review_policy', problem: 'must be an object — the profile default applies' }];
  }
  for (const flag of ['require_cross_harness_review', 'forbid_same_harness_builder_and_validator']) {
    if (parsed[flag] != null && typeof parsed[flag] !== 'boolean') {
      issues.push({ field: `review_policy.${flag}`, problem: `must be a boolean, got ${JSON.stringify(parsed[flag])} — the profile default applies` });
    }
  }
  if (parsed.required_validators != null
    && (!Array.isArray(parsed.required_validators)
      || parsed.required_validators.some((type) => typeof type !== 'string' || !type.trim()))) {
    issues.push({ field: 'review_policy.required_validators', problem: 'must be an array of non-empty validator type names (e.g. ["code", "test", "security"])' });
  }
  if (parsed.fallback_behavior != null && !REVIEW_FALLBACK_BEHAVIORS.includes(parsed.fallback_behavior)) {
    issues.push({ field: 'review_policy.fallback_behavior', problem: `unknown fallback "${parsed.fallback_behavior}" — expected ${REVIEW_FALLBACK_BEHAVIORS.join(' | ')}; the profile default applies` });
  }
  for (const key of Object.keys(parsed)) {
    if (!(key in DEFAULT_REVIEW_POLICY)) {
      issues.push({ field: `review_policy.${key}`, problem: 'unknown review_policy key — this setting is ignored' });
    }
  }
  return issues;
}

async function readJsonIfExists(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// Effective policy for a project: profile posture overlaid with the explicit
// `review_policy` block from .rstack/policy.json. Invalid field values fall
// back to the profile default (config validation names them separately).
export async function loadReviewPolicy(projectRoot) {
  const config = await readJsonIfExists(join(projectRoot, '.rstack', 'rstack.config.json'));
  const policy = reviewPolicyForProfile(config?.profile ?? 'business-flex');
  const overrides = (await readJsonIfExists(join(projectRoot, '.rstack', 'policy.json')))?.review_policy;
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) return policy;
  for (const flag of ['require_cross_harness_review', 'forbid_same_harness_builder_and_validator']) {
    if (typeof overrides[flag] === 'boolean') policy[flag] = overrides[flag];
  }
  if (Array.isArray(overrides.required_validators)
    && overrides.required_validators.every((type) => typeof type === 'string' && type.trim())) {
    policy.required_validators = overrides.required_validators.map((type) => type.trim());
  }
  if (REVIEW_FALLBACK_BEHAVIORS.includes(overrides.fallback_behavior)) {
    policy.fallback_behavior = overrides.fallback_behavior;
  }
  return policy;
}

function identityString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeValidator(entry) {
  return {
    validator: identityString(entry?.validator) ?? 'unknown-validator',
    validator_type: identityString(entry?.validator_type) ?? 'generic',
    harness: identityString(entry?.harness),
    model: identityString(entry?.model),
    status: identityString(entry?.status),
  };
}

function validWaiver(waiver) {
  return Boolean(identityString(waiver?.reason) && identityString(waiver?.approved_by));
}

// Pure evaluation: builder contract + validator contracts + effective policy →
// the `independence` artifact. Returns status PASS | WARN | FAIL plus a
// `recommendation` (ask_user | block | null) the caller maps onto
// retry_recommendation when the verdict is FAIL.
export function evaluateReviewIndependence({ builder, validators = [], policy = DEFAULT_REVIEW_POLICY, waiver = null } = {}) {
  const effective = { ...DEFAULT_REVIEW_POLICY, ...policy };
  const enforced = effective.require_cross_harness_review
    || effective.forbid_same_harness_builder_and_validator
    || (Array.isArray(effective.required_validators) && effective.required_validators.length > 0);

  const builderIdentity = {
    agent: identityString(builder?.agent) ?? 'builder',
    harness: identityString(builder?.harness),
    model: identityString(builder?.model),
  };
  const validatorIdentities = validators.map(normalizeValidator);

  const result = {
    enforced,
    status: 'PASS',
    fallback_behavior: effective.fallback_behavior,
    recommendation: null,
    builder: builderIdentity,
    validators: validatorIdentities,
    same_harness_findings: [],
    missing_validator_types: [],
    unverified: [],
    waived: false,
    waiver: null,
    explanation: 'review independence policy not enabled',
  };
  if (!enforced) return result;

  const violations = [];

  if (effective.forbid_same_harness_builder_and_validator) {
    if (!builderIdentity.harness) {
      result.unverified.push('builder contract does not record a harness — same-harness validation cannot be ruled out');
    }
    for (const validator of validatorIdentities) {
      if (!validator.harness) {
        result.unverified.push(`validator ${validator.validator} does not record a harness`);
      } else if (builderIdentity.harness && validator.harness === builderIdentity.harness) {
        const finding = `validator ${validator.validator} ran on the builder's own harness (${validator.harness})`;
        result.same_harness_findings.push(finding);
        violations.push(finding);
      }
    }
  }

  if (effective.require_cross_harness_review) {
    const knownValidatorHarnesses = validatorIdentities.map((validator) => validator.harness).filter(Boolean);
    if (!builderIdentity.harness || knownValidatorHarnesses.length === 0) {
      result.unverified.push('cross-harness review cannot be verified — builder and/or validator harness identity is missing');
    } else if (!knownValidatorHarnesses.some((harness) => harness !== builderIdentity.harness)) {
      violations.push(`no validator ran on a different harness than the builder (${builderIdentity.harness})`);
    }
  }

  const requiredTypes = Array.isArray(effective.required_validators) ? effective.required_validators : [];
  if (requiredTypes.length) {
    const presentTypes = new Set(validatorIdentities.map((validator) => validator.validator_type));
    result.missing_validator_types = requiredTypes.filter((type) => !presentTypes.has(type));
    for (const type of result.missing_validator_types) {
      violations.push(`required validator type "${type}" has no contract`);
    }
  }

  if (violations.length && validWaiver(waiver)) {
    result.waived = true;
    result.waiver = { reason: waiver.reason.trim(), approved_by: waiver.approved_by.trim() };
    result.explanation = `violation waived by ${result.waiver.approved_by}: ${result.waiver.reason} (${violations.join('; ')})`;
    return result;
  }

  if (violations.length) {
    result.status = effective.fallback_behavior === 'warn' ? 'WARN' : 'FAIL';
    if (result.status === 'FAIL') {
      result.recommendation = effective.fallback_behavior === 'ask_user' ? 'ask_user' : 'block';
    }
    result.explanation = violations.join('; ');
    return result;
  }

  if (result.unverified.length) {
    // Missing metadata is a visibility gap, not a proven violation — never
    // hard-block on it (legacy pre-#72 contracts have no identity fields).
    result.status = 'WARN';
    result.explanation = result.unverified.join('; ');
    return result;
  }

  result.explanation = 'builder and validator identities satisfy the review independence policy';
  return result;
}
