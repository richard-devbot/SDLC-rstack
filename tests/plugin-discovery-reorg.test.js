/**
 * Domain-manifest consolidation regression: plugins/ went from 72 individual
 * plugin.json files (one per sub-plugin) to one consolidated plugin.json per
 * domain folder (plugins/<domain>/plugin.json, agents/commands as arrays of
 * each sub-plugin's own subdirectory) — sdlc-rstack stays a standalone
 * plugin. Every discovery path stops at the FIRST plugin.json it finds
 * walking down from plugins/, so the domain manifest shadows the individual
 * sub-plugin ones without requiring them to be deleted first — this pins
 * that behavior so a future regression can't silently drop a domain.
 *
 * owner: RStack developed by Richardson Gunde
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addPlugin, findPluginDirs, PACKAGE_PLUGINS_DIR } from '../src/commands/list.js';

const DOMAIN_NAMES = [
  'backend', 'frontend-mobile', 'devops-cloud', 'security', 'languages',
  'data-ml', 'quality-testing', 'docs-content', 'product-team', 'specialized',
];

test('findPluginDirs discovers the 10 domain plugins + sdlc-rstack, not the 72 sub-plugins', async () => {
  const found = await findPluginDirs(PACKAGE_PLUGINS_DIR);
  assert.equal(found.length, 11, 'one consolidated manifest per domain + sdlc-rstack, sub-plugin manifests are shadowed');

  const byName = new Map(found.map((p) => [p.name, p]));
  for (const domain of DOMAIN_NAMES) {
    assert.ok(byName.get(domain)?.dir.endsWith(`plugins/${domain}`), `${domain} resolves at its domain root, not a sub-plugin path`);
  }
  assert.ok(byName.get('sdlc-rstack')?.dir.endsWith('plugins/sdlc-rstack'), 'sdlc-rstack resolves at the top level, untouched');
});

test('addPlugin("backend") copies the whole consolidated domain, including every sub-plugin', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'rstack-add-domain-plugin-'));
  const originalCwd = process.cwd();
  process.chdir(cwd);
  try {
    await addPlugin('backend');
    const { readFile } = await import('node:fs/promises');
    const manifest = JSON.parse(await readFile(join(cwd, '.rstack', 'plugins', 'backend', 'plugin.json'), 'utf8'));
    assert.equal(manifest.name, 'backend');
    assert.ok(Array.isArray(manifest.agents) && manifest.agents.length > 0, 'domain manifest declares its sub-plugin agent paths');
    // a representative sub-plugin's own content is still physically present under the domain.
    const subPluginAgent = await readFile(
      join(cwd, '.rstack', 'plugins', 'backend', 'backend-development', 'agents', 'tdd-orchestrator.md'),
      'utf8',
    );
    assert.ok(subPluginAgent.length > 0);
  } finally {
    process.chdir(originalCwd);
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('addPlugin still rejects a truly unknown name', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'rstack-add-plugin-missing-'));
  const originalCwd = process.cwd();
  process.chdir(cwd);
  try {
    await assert.rejects(() => addPlugin('does-not-exist'), /not found in package plugins/);
  } finally {
    process.chdir(originalCwd);
    rmSync(cwd, { recursive: true, force: true });
  }
});
