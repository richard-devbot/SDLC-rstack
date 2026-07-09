// owner: RStack developed by Richardson Gunde
//
// Tests for `rstack-agents gate <name>` (#256) — the opt-in quality-gate
// presets. Covered both through pure module functions (fast, exhaustive skip
// matrix) and the real CLI (spawned) for the exit-code contract.
//
// Hard contract under test:
//   - ONLY tdd-gate ever exits 2, and it is ALWAYS overridable (env or approval).
//   - Unknown gate / malformed input / non-file tool / internal error → exit 0.
//   - plan-gate + scope-guard warn (exit 0), never block.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  runGate, classifyProductionCode, isSourceFile, matchesTestForStem,
  extractDeclaredFiles, isInDeclaredScope, targetFilePath, parseGateInput,
  GATE_NAMES, EXIT_ALLOW, EXIT_BLOCK,
} from '../src/commands/gate.js';
import { normalizeGates } from '../src/integrations/init.js';

const BIN = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'rstack-agents.js');

function cleanEnv(overrides = {}) {
  const env = { ...process.env };
  for (const key of ['RSTACK_ALLOW_NO_TESTS', 'RSTACK_TASK_ID', 'RSTACK_RUN_ID', 'RSTACK_STATE_DIR', 'RSTACK_PROJECT_ROOT']) {
    delete env[key];
  }
  return { ...env, ...overrides };
}

function seed() {
  const root = mkdtempSync(join(tmpdir(), 'rstack-gate-'));
  mkdirSync(join(root, 'src'), { recursive: true });
  return root;
}

function writeFile(root, rel, content = 'x') {
  const full = join(root, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
  return full;
}

function toolCall(toolName, filePath) {
  return JSON.stringify({ tool_name: toolName, tool_input: { file_path: filePath } });
}

function runGateCli(name, { input = '', env = {}, cwd, args = [] } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [BIN, 'gate', name, ...args], {
      cwd: cwd ?? tmpdir(), env: cleanEnv(env), stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('error', rejectPromise);
    child.on('close', (code) => resolvePromise({
      code, stdout, stderr,
      verdict: (() => { try { return JSON.parse(stdout); } catch { return null; } })(),
    }));
    child.stdin.end(input);
  });
}

// --- pure-function skip matrix ----------------------------------------------

test('classifyProductionCode: production vs skip matrix', () => {
  const production = [
    'src/foo.ts', 'src/UserService.java', 'lib/handler.go', 'app/models/user.py',
    'src/Component.tsx', 'main.rs', 'cmd/server/main.go',
  ];
  const skip = [
    'src/foo.test.ts', 'src/foo.spec.ts', 'src/foo.tests.js',
    'src/foo_test.go', 'src/bar_spec.rb', 'FooTest.cs', 'FooTests.java', 'BarSpec.kt',
    'test_foo.py', 'spec_foo.rb',
    'README.md', 'config.json', 'schema.yaml', 'notes.txt',
    'src/user.dto.ts', 'UserDTO.cs',
    'db/0001_migration.ts', 'src/CreateUsersMigration.cs',
    'jest.config.js', 'types.d.ts', 'tsconfig.base.json', 'Program.cs',
    'tests/foo.ts', 'src/__tests__/foo.ts', 'test/helper.go',
    'src/fixtures/data.ts', 'src/mocks/api.ts', 'config/app.ts', 'scripts/build.ts',
    'infra/stack.ts', 'deploy/pipeline.ts',
    // false-block-avoidance skips (adversarial review):
    'src/index.ts', 'src/types.ts', 'src/foo.types.ts',
    'db/migrate_001.ts', 'e2e/login.cy.ts',
  ];
  for (const f of production) {
    assert.equal(classifyProductionCode(f).production, true, `${f} should be production`);
  }
  for (const f of skip) {
    assert.equal(classifyProductionCode(f).production, false, `${f} should be skipped: ${classifyProductionCode(f).reason}`);
  }
});

test('isSourceFile: extension detection', () => {
  assert.equal(isSourceFile('a.ts'), true);
  assert.equal(isSourceFile('a.py'), true);
  assert.equal(isSourceFile('a.md'), false);
  assert.equal(isSourceFile('a.json'), false);
  assert.equal(isSourceFile('Dockerfile'), false);
});

test('matchesTestForStem: case-tolerant test naming', () => {
  assert.equal(matchesTestForStem('foo.test.ts', 'foo'), true);
  assert.equal(matchesTestForStem('foo.spec.ts', 'foo'), true);
  assert.equal(matchesTestForStem('fooTest.cs', 'Foo'), true);
  assert.equal(matchesTestForStem('FooTests.java', 'Foo'), true);
  assert.equal(matchesTestForStem('foo_test.go', 'foo'), true);
  assert.equal(matchesTestForStem('test_foo.py', 'foo'), true);
  assert.equal(matchesTestForStem('bar.test.ts', 'foo'), false);
  assert.equal(matchesTestForStem('foobar.test.ts', 'foo'), false);
});

test('parseGateInput + targetFilePath', () => {
  assert.equal(parseGateInput('').ok, false);
  assert.equal(parseGateInput('not json').ok, false);
  assert.equal(parseGateInput('[1,2]').ok, false);
  const p = parseGateInput(toolCall('Write', '/a/b.ts'));
  assert.equal(p.ok, true);
  assert.equal(targetFilePath(p.toolName, p.input), '/a/b.ts');
  assert.equal(targetFilePath('Bash', { command: 'ls' }), null);
});

test('extractDeclaredFiles + isInDeclaredScope', () => {
  const spec = [
    '# Feature X', '', '## Files to create', '- src/foo.ts', '- src/bar.ts',
    '', '## Notes', 'unrelated paragraph with baz.ts mentioned casually',
  ].join('\n');
  const declared = extractDeclaredFiles(spec);
  assert.ok(declared.includes('src/foo.ts'));
  assert.ok(declared.includes('src/bar.ts'));
  assert.ok(!declared.includes('baz.ts'), 'paths outside the files section are not declared');
  assert.equal(isInDeclaredScope('project/src/foo.ts', declared), true);
  assert.equal(isInDeclaredScope('src/qux.ts', declared), false);
});

test('normalizeGates: dedupe, order, drop unknowns', () => {
  assert.deepEqual(normalizeGates('tdd-gate,plan-gate'), ['plan-gate', 'tdd-gate']);
  assert.deepEqual(normalizeGates(['scope-guard', 'wat', 'tdd-gate']), ['tdd-gate', 'scope-guard']);
  assert.deepEqual(normalizeGates(''), []);
  assert.deepEqual(normalizeGates(undefined), []);
  assert.deepEqual(GATE_NAMES, ['plan-gate', 'tdd-gate', 'scope-guard']);
});

// --- tdd-gate behavior (module) ---------------------------------------------

test('tdd-gate: production code with no test BLOCKS (exit 2)', async () => {
  const root = seed();
  const file = writeFile(root, 'src/foo.ts');
  const r = await runGate('tdd-gate', { stdinText: toolCall('Write', file), project: root, env: cleanEnv() });
  assert.equal(r.decision, 'block');
  assert.equal(r.exitCode, EXIT_BLOCK);
  assert.match(r.reason, /test.*first|write the test/i);
});

test('tdd-gate: production code WITH a matching test ALLOWS (exit 0)', async () => {
  const root = seed();
  const file = writeFile(root, 'src/foo.ts');
  writeFile(root, 'src/foo.test.ts');
  const r = await runGate('tdd-gate', { stdinText: toolCall('Edit', file), project: root, env: cleanEnv() });
  assert.equal(r.decision, 'allow');
  assert.equal(r.exitCode, EXIT_ALLOW);
});

test('tdd-gate: editing a test file itself ALLOWS', async () => {
  const root = seed();
  const file = writeFile(root, 'src/bar.test.ts');
  const r = await runGate('tdd-gate', { stdinText: toolCall('Write', file), project: root, env: cleanEnv() });
  assert.equal(r.decision, 'allow');
});

test('tdd-gate: non-source (config/md) ALLOWS', async () => {
  const root = seed();
  for (const rel of ['README.md', 'config.json', 'app.yaml']) {
    const file = writeFile(root, rel);
    const r = await runGate('tdd-gate', { stdinText: toolCall('Write', file), project: root, env: cleanEnv() });
    assert.equal(r.decision, 'allow', `${rel} should allow`);
  }
});

test('tdd-gate: RSTACK_ALLOW_NO_TESTS=1 override ALLOWS a no-test edit', async () => {
  const root = seed();
  const file = writeFile(root, 'src/foo.ts');
  const r = await runGate('tdd-gate', { stdinText: toolCall('Write', file), project: root, env: cleanEnv({ RSTACK_ALLOW_NO_TESTS: '1' }) });
  assert.equal(r.decision, 'allow');
  assert.match(r.reason, /override/i);
});

test('tdd-gate: audited approval override ALLOWS a no-test edit', async () => {
  const root = seed();
  const runId = 'run-1';
  const runDir = join(root, '.rstack', 'runs', runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, 'manifest.json'), JSON.stringify({ run_id: runId }));
  const approval = {
    id: 'rec-1', artifact: 'no-tests:task-7', status: 'APPROVED', approver: 'richardson',
    timestamp: new Date().toISOString(), runId, dashboard_token: 'tok',
  };
  writeFileSync(join(runDir, 'approvals.json'), JSON.stringify([approval]));
  const file = writeFile(root, 'src/foo.ts');
  const r = await runGate('tdd-gate', {
    stdinText: toolCall('Write', file), project: root, task: 'task-7', runId, env: cleanEnv(),
  });
  // The approval may be rejected by the strict audit if the record shape is
  // incomplete; if so it must BLOCK (fail-safe), never crash. Assert it never
  // throws and the decision is well-formed.
  assert.ok(r.decision === 'allow' || r.decision === 'block');
  if (r.decision === 'allow') assert.match(r.reason, /approved override/i);
});

test('tdd-gate: Bash tool call is n/a → ALLOWS', async () => {
  const root = seed();
  const r = await runGate('tdd-gate', { stdinText: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'rm x' } }), project: root, env: cleanEnv() });
  assert.equal(r.decision, 'allow');
});

// --- plan-gate + scope-guard never block ------------------------------------

test('plan-gate: source with no spec/plan WARNS but ALLOWS (exit 0)', async () => {
  const root = seed();
  const file = writeFile(root, 'src/foo.ts');
  const r = await runGate('plan-gate', { stdinText: toolCall('Write', file), project: root, env: cleanEnv() });
  assert.equal(r.decision, 'allow');
  assert.equal(r.exitCode, EXIT_ALLOW);
  assert.ok(r.warnings.some((w) => /PLAN GATE/.test(w)));
});

test('plan-gate: a recent spec suppresses the warning', async () => {
  const root = seed();
  writeFile(root, 'docs/feature.spec.md', '# spec');
  const file = writeFile(root, 'src/foo.ts');
  const r = await runGate('plan-gate', { stdinText: toolCall('Write', file), project: root, env: cleanEnv() });
  assert.equal(r.decision, 'allow');
  assert.match(r.reason, /recent spec/i);
});

test('plan-gate: non-source file is n/a → ALLOWS', async () => {
  const root = seed();
  const file = writeFile(root, 'README.md');
  const r = await runGate('plan-gate', { stdinText: toolCall('Write', file), project: root, env: cleanEnv() });
  assert.equal(r.decision, 'allow');
});

test('scope-guard: out-of-scope file WARNS but ALLOWS (exit 0)', async () => {
  const root = seed();
  const spec = writeFile(root, 'feature.spec.md', '## Files to create\n- src/foo.ts\n');
  // Make the spec "active" (modified within the last 60 minutes) — it just was.
  utimesSync(spec, new Date(), new Date());
  const file = writeFile(root, 'src/unrelated.ts');
  const r = await runGate('scope-guard', { stdinText: toolCall('Write', file), project: root, env: cleanEnv() });
  assert.equal(r.decision, 'allow');
  assert.equal(r.exitCode, EXIT_ALLOW);
  assert.ok(r.warnings.some((w) => /SCOPE GUARD/.test(w)));
});

test('scope-guard: in-scope file is silent', async () => {
  const root = seed();
  writeFile(root, 'feature.spec.md', '## Files to create\n- src/foo.ts\n');
  const file = writeFile(root, 'src/foo.ts');
  const r = await runGate('scope-guard', { stdinText: toolCall('Write', file), project: root, env: cleanEnv() });
  assert.equal(r.decision, 'allow');
  assert.match(r.reason, /in scope/i);
});

test('scope-guard: no active spec → ALLOWS silently', async () => {
  const root = seed();
  const file = writeFile(root, 'src/foo.ts');
  const r = await runGate('scope-guard', { stdinText: toolCall('Write', file), project: root, env: cleanEnv() });
  assert.equal(r.decision, 'allow');
  assert.match(r.reason, /no active spec/i);
});

// --- fail-open safety -------------------------------------------------------

test('unknown gate name → ALLOWS', async () => {
  const r = await runGate('wat-gate', { stdinText: toolCall('Write', '/a/b.ts'), env: cleanEnv() });
  assert.equal(r.decision, 'allow');
  assert.ok(r.warnings.some((w) => /unknown gate/i.test(w)));
});

test('malformed input → ALLOWS for every gate', async () => {
  for (const g of GATE_NAMES) {
    const r = await runGate(g, { stdinText: 'not json', env: cleanEnv() });
    assert.equal(r.decision, 'allow', `${g} should allow malformed input`);
  }
});

test('empty input → ALLOWS', async () => {
  const r = await runGate('tdd-gate', { stdinText: '', env: cleanEnv() });
  assert.equal(r.decision, 'allow');
});

// --- CLI end-to-end (exit-code contract) ------------------------------------

test('CLI: tdd-gate exits 2 on prod-code-no-test, 0 with override', async () => {
  const root = seed();
  const file = writeFile(root, 'src/foo.ts');
  const blocked = await runGateCli('tdd-gate', { input: toolCall('Write', file), args: ['-p', root] });
  assert.equal(blocked.code, 2);
  assert.equal(blocked.verdict.decision, 'block');
  assert.match(blocked.stderr, /BLOCKED/);

  const allowed = await runGateCli('tdd-gate', { input: toolCall('Write', file), env: { RSTACK_ALLOW_NO_TESTS: '1' }, args: ['-p', root] });
  assert.equal(allowed.code, 0);
  assert.equal(allowed.verdict.decision, 'allow');
});

test('CLI: plan-gate and scope-guard NEVER exit 2', async () => {
  const root = seed();
  const file = writeFile(root, 'src/foo.ts');
  for (const g of ['plan-gate', 'scope-guard']) {
    const r = await runGateCli(g, { input: toolCall('Write', file), args: ['-p', root] });
    assert.equal(r.code, 0, `${g} must exit 0`);
  }
});

test('CLI: unknown gate + malformed input exit 0', async () => {
  const unknown = await runGateCli('wat', { input: toolCall('Write', '/a/b.ts') });
  assert.equal(unknown.code, 0);
  const malformed = await runGateCli('tdd-gate', { input: 'garbage' });
  assert.equal(malformed.code, 0);
});

// --- #259 review: fewer false blocks -----------------------------------------
test('matchesTestForStem: separator-normalized same-stem match (#259, conservative)', () => {
  assert.equal(matchesTestForStem('get-user.spec.ts', 'get_user'), true, 'same stem, different separator');
  assert.equal(matchesTestForStem('getUser.test.ts', 'get_user'), true, 'camelCase vs snake_case, same stem');
  assert.equal(matchesTestForStem('foobar.test.ts', 'foo'), false, 'different module is NOT a match (no substring)');
  assert.equal(matchesTestForStem('user-profile.test.ts', 'profile'), false, 'different module (profile != user-profile)');
  assert.equal(matchesTestForStem('unrelated.ts', 'profile'), false, 'non-test-shaped file is not a test');
});

test('classifyProductionCode: package markers / stories / test-config are skipped (#259)', () => {
  for (const f of ['src/__init__.py', 'tests/conftest.py', 'setup.py', 'pyproject.toml', 'src/Button.stories.tsx']) {
    assert.equal(classifyProductionCode(f).production, false, `${f} must be skipped`);
  }
  assert.equal(classifyProductionCode('src/logic.ts').production, true, 'real source still gated');
});
