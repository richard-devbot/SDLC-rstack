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

  rmSync(registryDir, { recursive: true, force: true });
  if (previousRegistryDir) process.env.RSTACK_REGISTRY_DIR = previousRegistryDir;
  else delete process.env.RSTACK_REGISTRY_DIR;
});
