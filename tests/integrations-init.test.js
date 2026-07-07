/**
 * Tests for rstack-agents init — framework detection and idempotent setup.
 *
 * owner: RStack developed by Richardson Gunde
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectFramework, initFramework, FRAMEWORKS, BOOTSTRAP_BY_FRAMEWORK, CLAUDE_CODE_HOOKS } from '../src/integrations/init.js';

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

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

  await t.test('init custom scaffolds AGENTS.md, SOUL.md, HEARTBEAT.md', async () => {
    const root = tmpProject('rstack-init-bootstrap-custom-');
    const report = await initFramework(root, 'custom', { packageRoot: PACKAGE_ROOT });
    assert.ok(existsSync(join(root, 'AGENTS.md')), 'AGENTS.md bootstrap created');
    assert.ok(existsSync(join(root, 'SOUL.md')), 'SOUL.md bootstrap created');
    assert.ok(existsSync(join(root, 'HEARTBEAT.md')), 'HEARTBEAT.md bootstrap created');
    assert.ok(!existsSync(join(root, 'CLAUDE.md')), 'custom init should not create CLAUDE.md');
    assert.ok(report.created.includes('AGENTS.md'));
    assert.ok(report.nextSteps.some((step) => step.includes('SOUL.md')));
    rmSync(root, { recursive: true, force: true });
  });

  await t.test('init pi scaffolds SOUL.md and HEARTBEAT.md only', async () => {
    const root = tmpProject('rstack-init-bootstrap-pi-');
    const report = await initFramework(root, 'pi', { packageRoot: PACKAGE_ROOT });
    assert.ok(existsSync(join(root, 'SOUL.md')));
    assert.ok(existsSync(join(root, 'HEARTBEAT.md')));
    assert.ok(!existsSync(join(root, 'CLAUDE.md')));
    assert.ok(!existsSync(join(root, 'AGENTS.md')));
    assert.deepEqual([...BOOTSTRAP_BY_FRAMEWORK.pi], ['SOUL.md', 'HEARTBEAT.md']);
    assert.ok(report.created.includes('SOUL.md'));
    rmSync(root, { recursive: true, force: true });
  });

  await t.test('bootstrap files are idempotent on second init', async () => {
    const root = tmpProject('rstack-init-bootstrap-idem-');
    await initFramework(root, 'custom', { packageRoot: PACKAGE_ROOT });
    writeFileSync(join(root, 'AGENTS.md'), '# modified');
    const second = await initFramework(root, 'custom', { packageRoot: PACKAGE_ROOT });
    assert.ok(second.skipped.some((item) => item.includes('AGENTS.md')));
    assert.equal(readFileSync(join(root, 'AGENTS.md'), 'utf8'), '# modified');
    rmSync(root, { recursive: true, force: true });
  });

  await t.test('init claude-code creates state dir, doc, registers project — idempotently', async () => {
    const root = tmpProject('rstack-init-run-');
    mkdirSync(join(root, '.claude'), { recursive: true });

    const first = await initFramework(root, 'claude-code', { packageRoot: PACKAGE_ROOT });
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
    assert.ok(existsSync(join(root, 'CLAUDE.md')), 'CLAUDE.md bootstrap created');
    assert.ok(existsSync(join(root, 'SOUL.md')), 'SOUL.md bootstrap created');
    assert.ok(existsSync(join(root, 'HEARTBEAT.md')), 'HEARTBEAT.md bootstrap created');
    assert.ok(first.created.some((item) => item.includes('.rstack/')));
    assert.ok(first.nextSteps.length > 0);

    const registry = JSON.parse(readFileSync(join(registryDir, 'known-projects.json'), 'utf8'));
    assert.ok(registry.some((entry) => entry.includes('rstack-init-run-')), 'project registered');

    // Second run: nothing overwritten, everything reported as skipped.
    const doc = readFileSync(join(root, '.claude', 'rstack-sdlc.md'), 'utf8');
    const second = await initFramework(root, 'claude-code', { packageRoot: PACKAGE_ROOT });
    assert.ok(second.skipped.some((item) => item.includes('.rstack/')));
    assert.ok(second.skipped.some((item) => item.includes('rstack.config.json')));
    assert.ok(second.skipped.some((item) => item.includes('budget.json')));
    assert.ok(second.skipped.some((item) => item.includes('rstack-sdlc.md')));
    assert.ok(second.skipped.some((item) => item.includes('CLAUDE.md')));
    assert.ok(second.skipped.some((item) => item.includes('SOUL.md')));
    assert.ok(second.skipped.some((item) => item.includes('HEARTBEAT.md')));
    assert.equal(readFileSync(join(root, '.claude', 'rstack-sdlc.md'), 'utf8'), doc, 'existing file untouched');
    rmSync(root, { recursive: true, force: true });
  });

  await t.test('init writes the integrations.json intake template — never overwrites an edited one (#237)', async () => {
    const root = tmpProject('rstack-init-integrations-');
    const first = await initFramework(root, 'custom', { packageRoot: PACKAGE_ROOT });
    const integrationsPath = join(root, '.rstack', 'integrations.json');
    assert.ok(existsSync(integrationsPath), '.rstack/integrations.json template created');
    assert.ok(first.created.some((item) => item.includes('integrations.json')));
    const template = JSON.parse(readFileSync(integrationsPath, 'utf8'));
    assert.equal(template.ticketing.provider, 'file-based');
    assert.equal(template.docs.provider, 'none');
    assert.equal(template.notifications.channel, 'none');
    assert.match(template._comment, /Secrets .* belong in \.env/i);
    // No credential-shaped keys anywhere in the shipped template.
    assert.ok(!/token|password|credential|api[_-]?key"/i.test(Object.keys(template).join(' ')));

    // Idempotent: a user-edited file is never overwritten.
    writeFileSync(integrationsPath, JSON.stringify({ ticketing: { provider: 'github' } }));
    const second = await initFramework(root, 'custom', { packageRoot: PACKAGE_ROOT });
    assert.ok(second.skipped.some((item) => item.includes('integrations.json')));
    assert.equal(JSON.parse(readFileSync(integrationsPath, 'utf8')).ticketing.provider, 'github');
    rmSync(root, { recursive: true, force: true });
  });

  await t.test('init claude-code writes settings.json with the PreToolUse guard hook when none exists', async () => {
    const root = tmpProject('rstack-init-guard-hook-');
    mkdirSync(join(root, '.claude'), { recursive: true });
    const report = await initFramework(root, 'claude-code', { packageRoot: PACKAGE_ROOT });
    const settings = JSON.parse(readFileSync(join(root, '.claude', 'settings.json'), 'utf8'));
    assert.deepEqual(settings, CLAUDE_CODE_HOOKS, 'settings.json matches the pinned hook contract');
    const pre = settings.hooks.PreToolUse[0];
    assert.equal(pre.matcher, 'Bash|Write|Edit');
    assert.equal(pre.hooks[0].command, 'npx --yes rstack-agents guard --context builder');
    assert.ok(settings.hooks.SessionStart, 'hub auto-launch hook preserved alongside the guard');
    assert.ok(report.created.some((item) => item.includes('guard')), 'guard enforcement reported as created');
    assert.ok(report.nextSteps.some((step) => step.includes('rstack-agents guard')), 'guidance mentions the guard');
    rmSync(root, { recursive: true, force: true });
  });

  await t.test('init claude-code never touches an existing settings.json — snippet + guidance instead', async () => {
    const root = tmpProject('rstack-init-guard-existing-');
    mkdirSync(join(root, '.claude'), { recursive: true });
    const existing = JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'my-own-guard' }] }] } }, null, 2);
    writeFileSync(join(root, '.claude', 'settings.json'), existing);

    const report = await initFramework(root, 'claude-code', { packageRoot: PACKAGE_ROOT });
    assert.equal(readFileSync(join(root, '.claude', 'settings.json'), 'utf8'), existing, 'existing hooks block untouched');
    const snippet = JSON.parse(readFileSync(join(root, '.claude', 'rstack-hooks.json'), 'utf8'));
    assert.deepEqual(snippet, CLAUDE_CODE_HOOKS, 'mergeable snippet written next to settings.json');
    assert.ok(report.nextSteps.some((step) => step.includes('rstack-hooks.json')), 'guidance points at the snippet');
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

  await t.test('init on existing .rstack reports prior run count and points at --fresh', async () => {
    const root = tmpProject('rstack-init-prior-runs-');
    mkdirSync(join(root, '.rstack', 'runs', '2026-06-01T07-00-00-000Z-old-run-a'), { recursive: true });
    mkdirSync(join(root, '.rstack', 'runs', '2026-06-09T10-00-00-000Z-old-run-b'), { recursive: true });
    const report = await initFramework(root, 'custom');
    const stateLine = report.skipped.find((item) => item.startsWith('.rstack/'));
    assert.ok(stateLine, '.rstack/ reported as skipped');
    assert.match(stateLine, /2 prior runs preserved/, 'prior run count surfaced');
    assert.match(stateLine, /--fresh/, 'points the user at --fresh');
    rmSync(root, { recursive: true, force: true });
  });

  await t.test('init --fresh archives prior state non-destructively and starts clean', async () => {
    const root = tmpProject('rstack-init-fresh-');
    const oldRun = join(root, '.rstack', 'runs', '2026-06-01T07-00-00-000Z-old-run');
    mkdirSync(oldRun, { recursive: true });
    writeFileSync(join(oldRun, 'manifest.json'), JSON.stringify({ run_id: 'old-run' }));
    writeFileSync(join(root, '.rstack', 'approvals.jsonl'), '{"artifact":"destructive-action"}\n');
    writeFileSync(join(root, '.rstack', 'rstack.config.json'), JSON.stringify({ profile: 'stale' }));

    const report = await initFramework(root, 'custom', { profile: 'lean-mvp', fresh: true });
    assert.ok(report.created.some((item) => item.includes('.rstack/archive/')), 'archive reported');

    const runsDir = join(root, '.rstack', 'runs');
    assert.ok(existsSync(runsDir), 'fresh runs/ exists');
    const { readdirSync } = await import('node:fs');
    assert.equal(readdirSync(runsDir).length, 0, 'no stale runs in fresh workspace');
    assert.ok(!existsSync(join(root, '.rstack', 'approvals.jsonl')), 'stale approvals moved aside');

    const archiveRoot = join(root, '.rstack', 'archive');
    const [stamp] = readdirSync(archiveRoot);
    assert.ok(existsSync(join(archiveRoot, stamp, 'runs', '2026-06-01T07-00-00-000Z-old-run', 'manifest.json')), 'old run preserved in archive');
    assert.ok(existsSync(join(archiveRoot, stamp, 'approvals.jsonl')), 'old approvals preserved in archive');

    const profile = JSON.parse(readFileSync(join(root, '.rstack', 'rstack.config.json'), 'utf8'));
    assert.equal(profile.profile, 'lean-mvp', 'fresh init applies the requested profile, not the stale config');
    rmSync(root, { recursive: true, force: true });
  });

  await t.test('init --fresh on a brand-new project behaves like plain init', async () => {
    const root = tmpProject('rstack-init-fresh-clean-');
    const report = await initFramework(root, 'custom', { fresh: true });
    assert.ok(existsSync(join(root, '.rstack', 'runs')), 'runs/ created');
    assert.ok(!existsSync(join(root, '.rstack', 'archive')), 'no archive created when there was nothing to archive');
    assert.ok(report.created.some((item) => item.includes('rstack.config.json')));
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
