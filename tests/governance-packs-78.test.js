// Governance packs (#78): the packaged pack registry, profile→pack defaults,
// config override + validation, and init recording the active set.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PACK_ENFORCEMENT_LEVELS,
  PROFILE_PACK_DEFAULTS,
  enabledPacksForConfig,
  knownPackNames,
  listPacks,
  packsForProfile,
  validateEnabledPacksConfig,
  validatePackMetadata,
} from '../src/core/packs.js';
import { validateRstackConfig } from '../src/core/harness/config-validation.js';
import { initFramework } from '../src/integrations/init.js';
import { readConfiguredPolicies } from '../src/observability/dashboard/state/configured-policy.js';

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('every packaged pack has valid metadata and a name matching its directory', () => {
  const packs = listPacks();
  assert.equal(packs.length, 8);
  for (const pack of packs) {
    assert.deepEqual(pack.issues, [], `${pack.dir}: ${JSON.stringify(pack.issues)}`);
    assert.equal(pack.name, pack.dir);
    assert.ok(PACK_ENFORCEMENT_LEVELS.includes(pack.enforcement), `${pack.dir} enforcement`);
    assert.ok(pack.provides.length >= 1);
  }
  assert.deepEqual(knownPackNames().sort(), [
    'attestations', 'compliance-iso-42001', 'compliance-nist-ai-rmf', 'cross-harness-review',
    'dor-basic', 'dor-enterprise', 'drift-detection', 'untrusted-pr-gate',
  ]);
});

test('profile→pack defaults match the maturity ladder', () => {
  assert.deepEqual(packsForProfile('lean-mvp'), ['dor-basic']);
  assert.deepEqual(packsForProfile('business-flex'), ['dor-basic', 'cross-harness-review', 'drift-detection']);
  const enterprise = packsForProfile('enterprise-webapp');
  assert.ok(enterprise.includes('dor-enterprise'));
  assert.ok(enterprise.includes('cross-harness-review'));
  assert.ok(enterprise.includes('attestations'));
  assert.ok(enterprise.includes('untrusted-pr-gate'));
  assert.ok(enterprise.includes('compliance-nist-ai-rmf'));
  assert.ok(enterprise.includes('compliance-iso-42001'));
  assert.ok(!enterprise.includes('dor-basic'), 'enterprise upgrades, not stacks, the DOR gate');
  // unknown profile falls back to business-flex, matching profileConfig()
  assert.deepEqual(packsForProfile('no-such-profile'), packsForProfile('business-flex'));
  // every default references a real pack
  const known = knownPackNames();
  for (const names of Object.values(PROFILE_PACK_DEFAULTS)) {
    for (const name of names) assert.ok(known.includes(name), `${name} must exist in packs/`);
  }
});

test('enabled_packs in config overrides the profile default set', () => {
  assert.deepEqual(
    enabledPacksForConfig({ profile: 'enterprise-webapp', enabled_packs: ['dor-basic'] }),
    ['dor-basic'],
  );
  assert.deepEqual(
    enabledPacksForConfig({ profile: 'lean-mvp' }),
    ['dor-basic'],
  );
  // malformed override (non-string entries) falls back to the profile set
  assert.deepEqual(
    enabledPacksForConfig({ profile: 'lean-mvp', enabled_packs: [42] }),
    ['dor-basic'],
  );
});

test('config validation names unknown packs and routes through validateRstackConfig', () => {
  assert.deepEqual(validateEnabledPacksConfig(['dor-basic', 'attestations']), []);
  const unknown = validateEnabledPacksConfig(['dor-basic', 'not-a-pack']);
  assert.equal(unknown.length, 1);
  assert.match(unknown[0].problem, /unknown pack "not-a-pack"/);
  assert.equal(validateEnabledPacksConfig('dor-basic').length, 1); // non-array
  const routed = validateRstackConfig({ profile: 'lean-mvp', enabled_packs: ['nope'] });
  assert.ok(routed.some((issue) => issue.field === 'enabled_packs'));
});

test('validatePackMetadata names missing and malformed fields', () => {
  assert.deepEqual(validatePackMetadata({
    name: 'x-pack', title: 'X', description: 'does x', enforcement: 'advisory', provides: ['x'],
  }), []);
  const issues = validatePackMetadata({ name: 'Bad Name', enforcement: 'nuclear', provides: [] });
  const fields = issues.map((issue) => issue.field);
  assert.ok(fields.includes('title'));
  assert.ok(fields.includes('description'));
  assert.ok(fields.includes('name'));
  assert.ok(fields.includes('enforcement'));
  assert.ok(fields.includes('provides'));
});

test('init records the profile pack set in rstack.config.json', async () => {
  const registryDir = mkdtempSync(join(tmpdir(), 'rstack-registry-'));
  const previousRegistryDir = process.env.RSTACK_REGISTRY_DIR;
  process.env.RSTACK_REGISTRY_DIR = registryDir;
  try {
    const root = mkdtempSync(join(tmpdir(), 'rstack-packs-init-'));
    const report = await initFramework(root, 'custom', { packageRoot: PACKAGE_ROOT, profile: 'enterprise-webapp' });
    const config = JSON.parse(readFileSync(join(root, '.rstack', 'rstack.config.json'), 'utf8'));
    assert.deepEqual(config.enabled_packs, packsForProfile('enterprise-webapp'));
    assert.ok(report.created.some((item) => item.includes('packs:')));
  } finally {
    if (previousRegistryDir === undefined) delete process.env.RSTACK_REGISTRY_DIR;
    else process.env.RSTACK_REGISTRY_DIR = previousRegistryDir;
  }
});

test('configured-policy state exposes active packs with enforcement for the Hub', async () => {
  const root = mkdtempSync(join(tmpdir(), 'rstack-packs-policy-'));
  mkdirSync(join(root, '.rstack'), { recursive: true });
  writeFileSync(join(root, '.rstack', 'rstack.config.json'), JSON.stringify({
    profile: 'business-flex',
    enabled_packs: ['dor-basic', 'untrusted-pr-gate'],
  }));
  const policy = await readConfiguredPolicies([root], [{ root, id: 'p1', name: 'demo' }]);
  const packs = policy.projects[0].profile.governancePacks;
  assert.deepEqual(packs.map((pack) => pack.name), ['dor-basic', 'untrusted-pr-gate']);
  assert.equal(packs.find((pack) => pack.name === 'dor-basic').enforcement, 'advisory');
  assert.equal(packs.find((pack) => pack.name === 'untrusted-pr-gate').enforcement, 'blocking');
});
