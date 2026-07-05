/**
 * Validator registry (#120): critical SDLC stages map to stage-specific
 * validator profiles; everything else falls back to the generic profile.
 * Project overrides in .rstack/validators/registry.json deep-merge over the
 * defaults per stage and a malformed file falls back loudly.
 *
 * owner: RStack developed by Richardson Gunde
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_VALIDATOR_REGISTRY,
  GENERIC_VALIDATOR_PROFILE,
  loadValidatorRegistry,
  resolveValidatorProfile,
} from '../src/core/harness/validator-registry.js';

const CRITICAL_STAGES = [
  '06-architecture',
  '07-code',
  '08-testing',
  '12-security-threat-model',
  '13-compliance-checker',
];

function writeRegistryOverride(projectRoot, content) {
  const dir = join(projectRoot, '.rstack', 'validators');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'registry.json'), content);
}

test('default registry covers all critical stages with read-only, checked profiles', () => {
  for (const stageId of CRITICAL_STAGES) {
    const entry = DEFAULT_VALIDATOR_REGISTRY[stageId];
    assert.ok(entry, `registry entry for ${stageId}`);
    assert.equal(entry.stage_id, stageId);
    assert.equal(entry.validator, `validator.${stageId}`);
    assert.equal(entry.read_only, true, `${stageId} validator must be read-only`);
    assert.ok(typeof entry.model_hint === 'string' && entry.model_hint.length > 0);
    assert.ok(Array.isArray(entry.required_checks) && entry.required_checks.length > 0, `${stageId} needs required_checks`);
    assert.ok(Array.isArray(entry.output_contract_fields), `${stageId} needs output_contract_fields`);
  }
});

test('resolveValidatorProfile picks the highest-priority registered stage from mixed targets', () => {
  // 003-architecture style task: 06-architecture + 12-security + unregistered 14-cost.
  const profile = resolveValidatorProfile(['06-architecture', '12-security-threat-model', '14-cost-estimation']);
  assert.equal(profile.stage_id, '12-security-threat-model', 'security outranks architecture');

  const codeProfile = resolveValidatorProfile(['07-code']);
  assert.equal(codeProfile.validator, 'validator.07-code');

  const codeOverTesting = resolveValidatorProfile(['08-testing', '07-code']);
  assert.equal(codeOverTesting.stage_id, '07-code', 'code outranks testing regardless of input order');
});

test('resolveValidatorProfile falls back to the generic profile', () => {
  for (const stageIds of [[], ['04-planning', '05-jira'], null, undefined]) {
    const profile = resolveValidatorProfile(stageIds);
    assert.equal(profile, GENERIC_VALIDATOR_PROFILE);
    assert.equal(profile.validator, 'validator.generic');
    assert.equal(profile.read_only, true);
    assert.ok(profile.required_checks.length > 0, 'generic profile still asserts minimal checks');
  }
});

test('loadValidatorRegistry returns defaults when no override file exists', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-validator-registry-'));
  try {
    assert.deepEqual(await loadValidatorRegistry(projectRoot), DEFAULT_VALIDATOR_REGISTRY);
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('project override merges fields per stage without losing defaults', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-validator-registry-'));
  try {
    writeRegistryOverride(projectRoot, JSON.stringify({
      '07-code': { model_hint: 'sonnet' },
    }));
    const registry = await loadValidatorRegistry(projectRoot);
    const entry = registry['07-code'];
    assert.equal(entry.model_hint, 'sonnet', 'override applied');
    assert.equal(entry.validator, 'validator.07-code', 'default validator kept');
    assert.deepEqual([...entry.required_checks], [...DEFAULT_VALIDATOR_REGISTRY['07-code'].required_checks], 'default checks kept');
    assert.equal(entry.read_only, true);
    // Untouched stages keep their default entries.
    assert.deepEqual(registry['08-testing'], DEFAULT_VALIDATOR_REGISTRY['08-testing']);
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('project override cannot flip a validator to read-write', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-validator-registry-'));
  const errors = [];
  const originalError = console.error;
  console.error = (...args) => errors.push(args.join(' '));
  try {
    writeRegistryOverride(projectRoot, JSON.stringify({
      '12-security-threat-model': { read_only: false },
    }));
    const registry = await loadValidatorRegistry(projectRoot);
    assert.equal(registry['12-security-threat-model'].read_only, true, 'read_only is clamped to true');
    assert.ok(errors.some((line) => line.includes('read_only')), 'clamping is loud');
  } finally {
    console.error = originalError;
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('override can promote an unregistered canonical stage over the generic profile', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-validator-registry-'));
  try {
    writeRegistryOverride(projectRoot, JSON.stringify({
      '09-deployment': { validator: 'validator.09-deployment', required_checks: ['deployment_report_exists'] },
    }));
    const registry = await loadValidatorRegistry(projectRoot);
    const profile = resolveValidatorProfile(['09-deployment'], registry);
    assert.equal(profile.stage_id, '09-deployment');
    assert.equal(profile.validator, 'validator.09-deployment');
    assert.deepEqual(profile.required_checks, ['deployment_report_exists']);
    assert.equal(profile.read_only, true);
    // Registered critical stages still outrank a promoted stage.
    const mixed = resolveValidatorProfile(['09-deployment', '07-code'], registry);
    assert.equal(mixed.stage_id, '07-code');
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('malformed override file falls back loudly to defaults', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-validator-registry-'));
  const errors = [];
  const originalError = console.error;
  console.error = (...args) => errors.push(args.join(' '));
  try {
    writeRegistryOverride(projectRoot, '{ not json');
    const registry = await loadValidatorRegistry(projectRoot);
    assert.deepEqual(registry, DEFAULT_VALIDATOR_REGISTRY);
    assert.ok(errors.some((line) => line.includes('malformed')), 'malformed file must warn');

    errors.length = 0;
    writeRegistryOverride(projectRoot, JSON.stringify(['not', 'an', 'object']));
    assert.deepEqual(await loadValidatorRegistry(projectRoot), DEFAULT_VALIDATOR_REGISTRY);
    assert.ok(errors.length > 0, 'non-object shape must warn');

    errors.length = 0;
    writeRegistryOverride(projectRoot, JSON.stringify({ 'not-a-stage': { model_hint: 'opus' } }));
    const withUnknown = await loadValidatorRegistry(projectRoot);
    assert.equal(withUnknown['not-a-stage'], undefined, 'non-canonical stage ids are ignored');
    assert.ok(errors.some((line) => line.includes('not-a-stage')), 'unknown stage id must warn');
  } finally {
    console.error = originalError;
    rmSync(projectRoot, { recursive: true, force: true });
  }
});
