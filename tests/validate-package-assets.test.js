/**
 * Tests for publishable Pi package assets.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

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

// Regression pin: ~125MB of stray, unreferenced 3D-asset experiments in
// src/assetsglb/ (never wired into the Studio — the real Studio models live
// in src/observability/dashboard/ui/studio3d/models/) leaked into the
// published 2.1.0 tarball because package.json's "files" field allowlists
// all of "src/" and .npmignore has NO effect on a path once "files" already
// allowlists it (verified empirically — this is not documented npm behavior
// most people expect). The real exclusion mechanism is a negated entry
// directly in "files" ("!src/assetsglb/**"). This test runs the real `npm
// pack --dry-run` and pins both the exclusion and a sane total-size ceiling,
// so a future large accidental addition anywhere in the tree fails loudly
// instead of silently shipping.
test('npm pack excludes src/assetsglb/ and stays under a sane size ceiling', () => {
  const stdout = execFileSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 120_000,
  });
  const [report] = JSON.parse(stdout);
  const assetsglbFiles = report.files.filter((f) => f.path.startsWith('src/assetsglb/'));
  assert.deepEqual(assetsglbFiles, [], 'src/assetsglb/ must never ship in the published tarball');

  const unpackedMb = report.unpackedSize / 1024 / 1024;
  assert.ok(
    unpackedMb < 60,
    `published tarball unpacked size ballooned to ${unpackedMb.toFixed(1)}MB (ceiling 60MB) — ` +
      'a large file was likely added under an allowlisted "files" directory without a .npmignore/negation check',
  );
});
