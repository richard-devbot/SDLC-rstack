/**
 * Cross-validate RStack package references.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..');

async function walk(dir, predicate = () => true) {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['.git', 'node_modules', '.rstack'].includes(entry.name)) continue;
      out.push(...await walk(full, predicate));
    } else if (predicate(full)) out.push(full);
  }
  return out;
}

test('no legacy hidden workspace directories are required', () => {
  for (const dir of ['.claude', '.agents', '.codex']) {
    const trackedFiles = execFileSync('git', ['ls-files', dir], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
    assert.equal(trackedFiles, '', `${dir} should not be tracked or required by package runtime`);
  }
});

test('all markdown and plugin manifests carry the RStack owner label', async () => {
  const owner = 'RStack developed by Richardson Gunde';
  const missing = [];
  for (const file of await walk(REPO_ROOT, (candidate) => candidate.endsWith('.md') && !candidate.includes(`${path.sep}node_modules${path.sep}`) && !candidate.includes(`${path.sep}.git${path.sep}`))) {
    const text = await readFile(file, 'utf8');
    if (!text.includes(owner)) missing.push(path.relative(REPO_ROOT, file));
  }
  for (const file of await walk(path.join(REPO_ROOT, 'plugins'), (candidate) => path.basename(candidate) === 'plugin.json')) {
    const plugin = JSON.parse(await readFile(file, 'utf8'));
    if (plugin.owner !== owner) missing.push(path.relative(REPO_ROOT, file));
  }
  assert.deepEqual(missing, []);
});

test('agent references to packaged skills and plugins resolve', async () => {
  const skillNames = new Set((await walk(path.join(REPO_ROOT, 'skills'), (file) => path.basename(file) === 'SKILL.md')).map((file) => path.basename(path.dirname(file))));
  const pluginNames = new Set((await readdir(path.join(REPO_ROOT, 'plugins'), { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name));
  const pluginSkillNames = new Set((await walk(path.join(REPO_ROOT, 'plugins'), (file) => path.basename(file) === 'SKILL.md')).map((file) => path.basename(path.dirname(file))));
  const missing = [];
  for (const file of await walk(path.join(REPO_ROOT, 'agents'), (candidate) => candidate.endsWith('.md'))) {
    const text = await readFile(file, 'utf8');
    for (const match of text.matchAll(/(?<![\w.-])skills\/([A-Za-z0-9_.-]+)(?:\/SKILL\.md)?/g)) {
      const name = match[1];
      if (name.includes('[') || ['plugins', 'hooks'].includes(name)) continue;
      if (!skillNames.has(name) && !pluginSkillNames.has(name)) missing.push(`${path.relative(REPO_ROOT, file)} missing skill ${name}`);
    }
    for (const match of text.matchAll(/(?<![\w.-])plugins\/([A-Za-z0-9_.-]+)/g)) {
      const name = match[1];
      if (name.includes('[') || ['hooks'].includes(name)) continue;
      if (!pluginNames.has(name)) missing.push(`${path.relative(REPO_ROOT, file)} missing plugin ${name}`);
    }
  }
  assert.deepEqual(missing, []);
});
