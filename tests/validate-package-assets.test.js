/**
 * Tests for publishable Pi package assets.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..');

async function readJson(relPath) {
  return JSON.parse(await readFile(path.join(REPO_ROOT, relPath), 'utf8'));
}

test('package-local publishable asset directories exist', () => {
  for (const dir of ['agents', 'skills', 'prompts', 'plugins', 'extensions']) {
    assert.ok(existsSync(path.join(REPO_ROOT, dir)), `${dir}/ should exist`);
  }
});

test('package.json ships Pi extension, agents, skills, prompts, plugins, research, and RFCs', async () => {
  const pkg = await readJson('package.json');
  for (const required of ['extensions/', 'agents/', 'skills/', 'prompts/', 'plugins/', 'research/', 'rfcs/', 'docs/mintlify', 'docs/loop-recipes.md']) {
    assert.ok(pkg.files.includes(required), `package.json files should include ${required}`);
  }
  assert.deepEqual(pkg.pi.extensions, ['./extensions/rstack-sdlc.ts']);
  assert.deepEqual(pkg.pi.skills, ['./skills']);
  assert.deepEqual(pkg.pi.prompts, ['./prompts']);
});

test('legacy private workspace folders are not required for package runtime', () => {
  assert.ok(existsSync(path.join(REPO_ROOT, 'agents', 'core', 'orchestrator.md')));
  assert.ok(existsSync(path.join(REPO_ROOT, 'agents', 'core', 'builder.md')));
  assert.ok(existsSync(path.join(REPO_ROOT, 'agents', 'core', 'validator.md')));
  assert.ok(existsSync(path.join(REPO_ROOT, 'skills', 'frontend-design', 'SKILL.md')));
  assert.ok(existsSync(path.join(REPO_ROOT, 'prompts', 'plan_w_team.md')));
});
