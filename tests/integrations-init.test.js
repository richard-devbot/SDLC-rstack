/**
 * Tests for rstack-agents init — framework detection and idempotent setup.
 *
 * owner: RStack developed by Richardson Gunde
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectFramework, initFramework, FRAMEWORKS } from '../src/integrations/init.js';

function tmpProject(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

test('init framework detection and setup', async (t) => {
  // Hermetic global registry — never touch the real ~/.rstack.
  const registryDir = tmpProject('rstack-registry-');
  const previousRegistryDir = process.env.RSTACK_REGISTRY_DIR;
  process.env.RSTACK_REGISTRY_DIR = registryDir;

  await t.test('detects claude-code from .claude directory', async () => {
    const root = tmpProject('rstack-init-cc-');
    mkdirSync(join(root, '.claude'), { recursive: true });
    assert.equal(await detectFramework(root), 'claude-code');
    rmSync(root, { recursive: true, force: true });
  });

  await t.test('detects operator from operator.json', async () => {
    const root = tmpProject('rstack-init-op-');
    writeFileSync(join(root, 'operator.json'), '{}');
    assert.equal(await detectFramework(root), 'operator');
    rmSync(root, { recursive: true, force: true });
  });

  await t.test('detects pi from package.json dependencies', async () => {
    const root = tmpProject('rstack-init-pi-');
    writeFileSync(join(root, 'package.json'), JSON.stringify({
      dependencies: { '@earendil-works/pi-coding-agent': '*' },
    }));
    assert.equal(await detectFramework(root), 'pi');
    rmSync(root, { recursive: true, force: true });
  });

  await t.test('falls back to custom', async () => {
    const root = tmpProject('rstack-init-custom-');
    assert.equal(await detectFramework(root), 'custom');
    rmSync(root, { recursive: true, force: true });
  });

  await t.test('rejects unknown frameworks', async () => {
    const root = tmpProject('rstack-init-bad-');
    await assert.rejects(() => initFramework(root, 'jenkins'), /Unknown framework/);
    rmSync(root, { recursive: true, force: true });
  });

  await t.test('init claude-code creates state dir, doc, registers project — idempotently', async () => {
    const root = tmpProject('rstack-init-run-');
    mkdirSync(join(root, '.claude'), { recursive: true });

    const first = await initFramework(root, 'claude-code');
    assert.equal(first.framework, 'claude-code');
    assert.ok(existsSync(join(root, '.rstack', 'runs')), '.rstack/runs created');
    assert.ok(existsSync(join(root, '.rstack', 'rstack.config.json')), 'business profile config created');
    assert.ok(existsSync(join(root, '.rstack', 'budget.json')), 'budget policy created');
    const profile = JSON.parse(readFileSync(join(root, '.rstack', 'rstack.config.json'), 'utf8'));
    const budget = JSON.parse(readFileSync(join(root, '.rstack', 'budget.json'), 'utf8'));
    assert.equal(profile.profile, 'business-flex');
    assert.ok(profile.enabled_domains.includes('backend'));
    assert.equal(budget.currency, 'USD');
    assert.ok(budget.run_budget_usd > 0);
    assert.ok(existsSync(join(root, '.claude', 'rstack-sdlc.md')), 'usage doc created');
    assert.ok(first.created.some((item) => item.includes('.rstack/')));
    assert.ok(first.nextSteps.length > 0);

    const registry = JSON.parse(readFileSync(join(registryDir, 'known-projects.json'), 'utf8'));
    assert.ok(registry.some((entry) => entry.includes('rstack-init-run-')), 'project registered');

    // Second run: nothing overwritten, everything reported as skipped.
    const doc = readFileSync(join(root, '.claude', 'rstack-sdlc.md'), 'utf8');
    const second = await initFramework(root, 'claude-code');
    assert.ok(second.skipped.some((item) => item.includes('.rstack/')));
    assert.ok(second.skipped.some((item) => item.includes('rstack.config.json')));
    assert.ok(second.skipped.some((item) => item.includes('budget.json')));
    assert.ok(second.skipped.some((item) => item.includes('rstack-sdlc.md')));
    assert.equal(readFileSync(join(root, '.claude', 'rstack-sdlc.md'), 'utf8'), doc, 'existing file untouched');
    rmSync(root, { recursive: true, force: true });
  });

  await t.test('init operator writes example settings with package path', async () => {
    const root = tmpProject('rstack-init-opset-');
    const report = await initFramework(root, 'operator', { packageRoot: '/opt/rstack' });
    const example = JSON.parse(readFileSync(join(root, 'rstack-operator.example.json'), 'utf8'));
    assert.equal(example.extensions.list[0].path, join('/opt/rstack', 'extensions', 'rstack_sdlc.py'));
    assert.ok(Object.keys(example.extensions.list[0].settings).includes('slack_webhook'));
    assert.ok(report.nextSteps.some((step) => step.includes('settings.json')));
    rmSync(root, { recursive: true, force: true });
  });

  await t.test('FRAMEWORKS list is the published contract', () => {
    assert.deepEqual([...FRAMEWORKS], ['pi', 'claude-code', 'operator', 'custom']);
  });

  await t.test('init with lean-mvp profile writes correct profile and budget files', async () => {
    const root = tmpProject('rstack-init-lean-');
    const report = await initFramework(root, 'custom', { profile: 'lean-mvp' });
    assert.equal(report.profile, 'lean-mvp');
    const profile = JSON.parse(readFileSync(join(root, '.rstack', 'rstack.config.json'), 'utf8'));
    const budget = JSON.parse(readFileSync(join(root, '.rstack', 'budget.json'), 'utf8'));
    assert.equal(profile.profile, 'lean-mvp');
    assert.equal(profile.workflow, 'lean-mvp-sdlc');
    assert.ok(profile.enabled_domains.includes('product'));
    assert.ok(!profile.enabled_domains.includes('devops'), 'lean-mvp should not include devops');
    assert.equal(budget.run_budget_usd, 5);
    assert.equal(budget.require_approval_above_usd, 10);
    rmSync(root, { recursive: true, force: true });
  });

  await t.test('init with enterprise-webapp profile writes correct profile and budget files', async () => {
    const root = tmpProject('rstack-init-ent-');
    const report = await initFramework(root, 'custom', { profile: 'enterprise-webapp' });
    assert.equal(report.profile, 'enterprise-webapp');
    const profile = JSON.parse(readFileSync(join(root, '.rstack', 'rstack.config.json'), 'utf8'));
    const budget = JSON.parse(readFileSync(join(root, '.rstack', 'budget.json'), 'utf8'));
    assert.equal(profile.profile, 'enterprise-webapp');
    assert.equal(profile.workflow, 'enterprise-webapp-sdlc');
    assert.ok(profile.enabled_domains.includes('security'));
    assert.ok(profile.enabled_plugins.includes('security-scanning'));
    assert.equal(budget.run_budget_usd, 25);
    assert.equal(budget.require_approval_above_usd, 50);
    rmSync(root, { recursive: true, force: true });
  });

  await t.test('init defaults to business-flex profile when profile option is omitted', async () => {
    const root = tmpProject('rstack-init-default-profile-');
    const report = await initFramework(root, 'custom');
    assert.equal(report.profile, 'business-flex');
    const profile = JSON.parse(readFileSync(join(root, '.rstack', 'rstack.config.json'), 'utf8'));
    assert.equal(profile.profile, 'business-flex');
    rmSync(root, { recursive: true, force: true });
  });

  await t.test('init report includes profile name in nextSteps', async () => {
    const root = tmpProject('rstack-init-nextsteps-');
    const report = await initFramework(root, 'custom', { profile: 'lean-mvp' });
    assert.ok(report.nextSteps.some((step) => step.includes('lean-mvp')), 'nextSteps should mention the active profile');
    assert.ok(report.nextSteps.some((step) => step.includes('rstack.config.json')), 'nextSteps should mention config file');
    assert.ok(report.nextSteps.some((step) => step.includes('budget.json')), 'nextSteps should mention budget file');
    rmSync(root, { recursive: true, force: true });
  });

  await t.test('init with unknown profile falls back to business-flex', async () => {
    const root = tmpProject('rstack-init-unknown-profile-');
    const report = await initFramework(root, 'custom', { profile: 'not-a-real-profile' });
    // profileConfig falls back to business-flex for unknown names
    assert.equal(report.profile, 'business-flex');
    const profile = JSON.parse(readFileSync(join(root, '.rstack', 'rstack.config.json'), 'utf8'));
    assert.equal(profile.profile, 'business-flex');
    rmSync(root, { recursive: true, force: true });
  });

  await t.test('init profile files are skipped on second run (idempotent)', async () => {
    const root = tmpProject('rstack-init-idempotent-profile-');
    await initFramework(root, 'custom', { profile: 'lean-mvp' });
    // Modify the files to prove they are not overwritten
    writeFileSync(join(root, '.rstack', 'rstack.config.json'), JSON.stringify({ profile: 'modified' }));
    const second = await initFramework(root, 'custom', { profile: 'lean-mvp' });
    assert.ok(second.skipped.some((item) => item.includes('rstack.config.json')), 'rstack.config.json should be skipped on second run');
    assert.ok(second.skipped.some((item) => item.includes('budget.json')), 'budget.json should be skipped on second run');
    const profile = JSON.parse(readFileSync(join(root, '.rstack', 'rstack.config.json'), 'utf8'));
    assert.equal(profile.profile, 'modified', 'manually modified profile should not be overwritten');
    rmSync(root, { recursive: true, force: true });
  });

  rmSync(registryDir, { recursive: true, force: true });
  if (previousRegistryDir) process.env.RSTACK_REGISTRY_DIR = previousRegistryDir;
  else delete process.env.RSTACK_REGISTRY_DIR;
});
