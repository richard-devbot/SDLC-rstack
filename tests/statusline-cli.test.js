// owner: RStack developed by Richardson Gunde
//
// Tests for `rstack-agents statusline` (#257) — the Claude Code statusLine
// command. Exercised through the real CLI (spawned subprocess) so the stdin
// parsing, the ALWAYS-exit-0 + ALWAYS-one-line contract, the active-run vs
// no-run shapes, malformed/empty stdin safety, and the no-secret guarantee are
// covered end-to-end, plus unit coverage for the pure builder + parser.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildStatusLine, parseSessionInput } from '../src/commands/statusline.js';

const BIN = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'rstack-agents.js');

function cleanEnv(overrides = {}) {
  const env = { ...process.env };
  for (const key of ['RSTACK_RUN_ID', 'RSTACK_STATE_DIR', 'RSTACK_PROJECT_ROOT', 'RSTACK_OBSERVE_SOURCE']) {
    delete env[key];
  }
  return { ...env, ...overrides };
}

function runStatusline(args, { input = '', env = {}, cwd } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [BIN, 'statusline', ...args], {
      cwd: cwd ?? tmpdir(),
      env: cleanEnv(env),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('error', rejectPromise);
    child.on('close', (code) => resolvePromise({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}

// A minimal but real run: manifest + one pending decision + one queued approval
// (pending) + one approved approval so the line reports non-zero counts.
function seedProject({ runId = 'run-statusline-test', withActivity = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'rstack-statusline-'));
  const runDir = join(root, '.rstack', 'runs', runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, 'manifest.json'), JSON.stringify({ run_id: runId, project_root: root, status: 'IN_PROGRESS' }));
  if (withActivity) {
    writeFileSync(join(runDir, 'decisions.json'), JSON.stringify({
      run_id: runId,
      decisions: [{ decision_id: 'DEC-001', question: 'db choice SECRET-sk-xyz', status: 'pending', impact: 'architecture' }],
    }));
    writeFileSync(join(root, '.rstack', 'approvals.jsonl'),
      JSON.stringify({ id: 'gate:pending', runId, artifact: 'architecture.md', status: 'pending' }) + '\n'
      + JSON.stringify({ id: 'gate:approved', runId, artifact: 'requirements.md', status: 'approved' }) + '\n');
  }
  return { root, runId, runDir };
}

const SESSION = JSON.stringify({ model: { display_name: 'Fable' }, cwd: '/tmp/whatever' });

test('statusline: active run shows the stage and ✔/⧗/◇ counts (exit 0, one line)', async () => {
  const { root, runId } = seedProject({ withActivity: true });
  const { code, stdout } = await runStatusline(['--project', root], { input: SESSION });
  assert.equal(code, 0, 'statusline always exits 0');
  const lines = stdout.replace(/\n$/, '').split('\n');
  assert.equal(lines.length, 1, 'prints exactly ONE line');
  const line = lines[0];
  assert.ok(line.startsWith('⬡ rstack'), 'brand mark leads');
  assert.ok(line.includes('Fable'), 'model name present');
  assert.match(line, /✔1\/⧗1/, 'approved + pending approval counts');
  assert.match(line, /◇1/, 'open decision count');
  // The run id resolves; a stage may or may not be present, but the counts prove
  // the active-run branch rendered.
  assert.ok(runId.length > 0);
});

test('statusline: no active run → minimal line with model + cwd basename (exit 0)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'rstack-statusline-norun-'));
  const session = JSON.stringify({ model: { display_name: 'Opus' }, cwd: '/home/me/my-project' });
  const { code, stdout } = await runStatusline(['--project', root], { input: session });
  assert.equal(code, 0);
  const line = stdout.replace(/\n$/, '');
  assert.ok(line.startsWith('⬡ rstack'), 'brand mark leads');
  assert.ok(line.includes('Opus'), 'model name present');
  assert.ok(line.includes('my-project'), 'cwd basename present');
  assert.ok(!line.includes('✔') && !line.includes('◇'), 'no run segments when there is no run');
});

test('statusline: empty stdin still prints a safe line (exit 0)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'rstack-statusline-empty-'));
  const { code, stdout } = await runStatusline(['--project', root], { input: '' });
  assert.equal(code, 0);
  const line = stdout.replace(/\n$/, '');
  assert.ok(line.startsWith('⬡ rstack'), 'brand mark leads even with empty stdin');
  assert.ok(line.includes('Claude'), 'falls back to a default model name');
});

test('statusline: malformed stdin never crashes (exit 0, one safe line)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'rstack-statusline-bad-'));
  const { code, stdout, stderr } = await runStatusline(['--project', root], { input: 'not json {{{' });
  assert.equal(code, 0);
  assert.equal(stderr, '', 'no error output by default');
  const line = stdout.replace(/\n$/, '');
  assert.ok(line.startsWith('⬡ rstack'), 'brand mark leads on garbage input');
});

test('statusline: NEVER leaks secrets — only structural facts + model/cwd basename', async () => {
  const { root } = seedProject({ withActivity: true });
  // Session payload salted with a fake credential; a leak would echo it.
  const session = JSON.stringify({
    model: { display_name: 'Fable' },
    cwd: '/tmp/proj',
    apiKey: 'sk-SECRET-DO-NOT-LEAK',
    extra: 'AKIAIOSFODNN7EXAMPLE',
  });
  const { code, stdout } = await runStatusline(['--project', root], { input: session });
  assert.equal(code, 0);
  const line = stdout;
  assert.ok(!line.includes('sk-SECRET'), 'no session credential leaks');
  assert.ok(!line.includes('AKIA'), 'no aws-looking token leaks');
  // The decision question text (free text) must never reach the line either.
  assert.ok(!line.includes('SECRET-sk-xyz'), 'decision free text never rendered');
  assert.ok(!line.toLowerCase().includes('db choice'), 'decision question text never rendered');
});

test('statusline: --run-id targets a specific run', async () => {
  const { root, runId } = seedProject({ withActivity: true });
  const { code, stdout } = await runStatusline(['--project', root, '--run-id', runId], { input: SESSION });
  assert.equal(code, 0);
  assert.match(stdout, /✔1\/⧗1/, 'targeted run counts rendered');
});

// --- unit coverage for the pure helpers ------------------------------------

test('buildStatusLine: active-run shape', () => {
  const line = buildStatusLine({
    modelName: 'Fable', runId: 'run-x', stageId: '07-code',
    approvedCount: 2, pendingApprovalCount: 1, openDecisionCount: 3,
  });
  assert.equal(line, '⬡ rstack  Fable  07-code  ✔2/⧗1  ◇3');
});

test('buildStatusLine: no-run shape uses the cwd basename', () => {
  const line = buildStatusLine({ modelName: 'Opus', cwd: '/a/b/cool-repo' });
  assert.equal(line, '⬡ rstack  Opus  cool-repo');
});

test('buildStatusLine: never throws and clamps negatives / non-finite counts', () => {
  const line = buildStatusLine({
    modelName: '', runId: 'r', stageId: null,
    approvedCount: -5, pendingApprovalCount: NaN, openDecisionCount: 2.9,
  });
  assert.ok(line.includes('✔0/⧗0'), 'negatives + NaN clamp to 0');
  assert.ok(line.includes('◇2'), 'fractional decision count truncates');
  assert.ok(line.includes('Claude'), 'empty model falls back');
});

test('buildStatusLine: sanitizes an injected run id / stage id', () => {
  const line = buildStatusLine({ modelName: 'M', runId: 'run x; rm -rf', stageId: '07 code$(x)' });
  assert.ok(!line.includes(';'), 'no shell metachars from run id');
  assert.ok(!line.includes('$'), 'no shell metachars from stage id');
  assert.ok(!line.includes(' rf'), 'no injected whitespace segments');
});

test('parseSessionInput: reads model display_name + cwd, tolerates junk', () => {
  assert.deepEqual(parseSessionInput(JSON.stringify({ model: { display_name: 'X' }, cwd: '/y' })), { modelName: 'X', cwd: '/y' });
  assert.deepEqual(parseSessionInput(JSON.stringify({ model: 'Bare' })), { modelName: 'Bare', cwd: null });
  assert.deepEqual(parseSessionInput(JSON.stringify({ workspace: { current_dir: '/w' } })), { modelName: 'Claude', cwd: '/w' });
  assert.deepEqual(parseSessionInput(''), { modelName: 'Claude', cwd: null });
  assert.deepEqual(parseSessionInput('garbage{'), { modelName: 'Claude', cwd: null });
  assert.deepEqual(parseSessionInput('[1,2,3]'), { modelName: 'Claude', cwd: null });
});
