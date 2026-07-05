import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { scanRepository, detectSpecialistGaps } from '../src/core/adopt/scan.js';

function seedBrownfieldRepo() {
  const root = mkdtempSync(join(tmpdir(), 'rstack-adopt-scan-'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({
    name: 'legacy-app',
    scripts: { test: 'jest' },
    dependencies: { express: '^4.18.0', react: '^18.0.0' },
    devDependencies: { jest: '^29.0.0' },
  }));
  writeFileSync(join(root, 'README.md'), '# Legacy App\nA billing system.');
  mkdirSync(join(root, 'docs'), { recursive: true });
  writeFileSync(join(root, 'docs', 'api.md'), '# API');
  mkdirSync(join(root, 'tests'), { recursive: true });
  writeFileSync(join(root, 'tests', 'billing.test.js'), 'test');
  mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
  writeFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'on: push');
  writeFileSync(join(root, 'Dockerfile'), 'FROM node:20');
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(root, 'node_modules', 'junk'), { recursive: true });
  return root;
}

test('scanRepository detects toolchain, docs, tests, ci, and deploy with evidence paths', async () => {
  const root = seedBrownfieldRepo();
  const scan = await scanRepository(root);

  assert.ok(scan.toolchain.languages.some((entry) => entry.language === 'javascript' && entry.evidence === 'package.json'));
  assert.ok(scan.toolchain.frameworks.some((entry) => entry.framework === 'express'));
  assert.ok(scan.toolchain.frameworks.some((entry) => entry.framework === 'jest'));
  assert.ok(scan.docs.includes('README.md'));
  assert.ok(scan.docs.includes(join('docs', 'api.md')));
  assert.deepEqual(scan.tests.testDirs, [{ dir: 'tests', files: 1 }]);
  assert.equal(scan.tests.testCommand, 'npm test');
  assert.deepEqual(scan.ci, [join('.github', 'workflows', 'ci.yml')]);
  assert.ok(scan.deploy.includes('Dockerfile'));
  // node_modules and dot-dirs never leak into structure signals.
  assert.deepEqual(scan.topLevelDirs, ['docs', 'src', 'tests']);
});

test('scanRepository on an empty directory reports empty findings, never throws', async () => {
  const root = mkdtempSync(join(tmpdir(), 'rstack-adopt-empty-'));
  const scan = await scanRepository(root);
  assert.deepEqual(scan.toolchain.languages, []);
  assert.deepEqual(scan.docs, []);
  assert.deepEqual(scan.ci, []);
  assert.equal(scan.tests.testCommand, null);
});

test('detectSpecialistGaps reports uncovered stacks and stays quiet when covered', () => {
  const detected = {
    languages: [{ language: 'javascript' }, { language: 'go' }],
    frameworks: [{ framework: 'react' }, { framework: 'express' }],
  };
  const gaps = detectSpecialistGaps(detected, ['react-developer', 'javascript-pro', 'backend-express-architect']);
  assert.deepEqual(gaps, [{ kind: 'language', name: 'go' }]);
  assert.deepEqual(detectSpecialistGaps(detected, ['go-pro', 'react-developer', 'javascript-pro', 'express-architect']), []);
  assert.deepEqual(detectSpecialistGaps({ languages: [], frameworks: [] }, []), []);
});
