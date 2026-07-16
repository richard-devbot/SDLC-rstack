// owner: RStack developed by Richardson Gunde
//
// #373 — a task hard-blocked at its attempt budget must not keep mutating the
// workspace tool-call by tool-call. The claim gate (sdlc_build_next) already
// refuses to START a new attempt beyond budget (cross-harness via the bridge);
// this pins the per-tool-call backstop: the guard reads the task's STATUS and
// denies a mutating action from a BLOCKED task — keyed on STATUS, never raw
// attempt count, so a legitimate in-progress Nth attempt is never false-blocked.
// Exercised through the real `rstack-agents guard` CLI (exit-code contract).

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'rstack-agents.js');
const EXIT_ALLOW = 0;
const EXIT_BLOCK = 2;

function cleanEnv(overrides = {}) {
  const env = { ...process.env };
  for (const key of ['RSTACK_ALLOW_DESTRUCTIVE', 'RSTACK_TASK_ID', 'RSTACK_AGENT_CONTEXT', 'RSTACK_VALIDATOR_CONTEXT', 'RSTACK_GUARD_FAIL_OPEN']) {
    delete env[key];
  }
  return { ...env, ...overrides };
}

let seq = 0;
function seedRun(status) {
  const root = mkdtempSync(join(tmpdir(), 'rstack-373-'));
  const runId = `run-373-${seq++}`;
  const dir = join(root, '.rstack', 'runs', runId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ run_id: runId }));
  writeFileSync(join(dir, 'tasks.json'), JSON.stringify({ tasks: [{ id: 't1', status }] }));
  return { root, runId };
}

function runGuard(args, { env = {}, cwd } = {}) {
  return new Promise((resolveP, rejectP) => {
    const child = spawn(process.execPath, [BIN, 'guard', ...args], {
      cwd: cwd ?? tmpdir(), env: cleanEnv(env), stdio: ['pipe', 'pipe', 'pipe'],
    });
    const timer = setTimeout(() => { child.kill('SIGKILL'); rejectP(new Error('guard timed out')); }, 10_000);
    let stdout = '';
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', () => {});
    child.on('error', (e) => { clearTimeout(timer); rejectP(e); });
    child.on('close', (code) => { clearTimeout(timer); resolveP({ code, verdict: (() => { try { return JSON.parse(stdout); } catch { return null; } })() }); });
    child.stdin.end('');
  });
}

// A BLOCKED task's mutations are denied (all mechanisms), reads/scratch allowed.
test('#373 BLOCKED task: Write tool blocked', async () => {
  const { root, runId } = seedRun('BLOCKED');
  const { code, verdict } = await runGuard(['--context', 'builder', '--task', 't1', '--run-id', runId, '--path', 'src/app.js'], { cwd: root });
  assert.equal(code, EXIT_BLOCK);
  assert.equal(verdict.category, 'attempt-budget-exhausted');
});

for (const [label, command] of [
  ['bash redirect to source', 'echo x > src/app.js'],
  ['cp into workspace', 'cp /tmp/e src/app.js'],
  ['destructive rm', 'rm -rf build'],
]) {
  test(`#373 BLOCKED task: bash mutation blocked — ${label}`, async () => {
    const { root, runId } = seedRun('BLOCKED');
    const { code } = await runGuard(['--context', 'builder', '--task', 't1', '--run-id', runId, '--command', command], { cwd: root });
    assert.equal(code, EXIT_BLOCK, `expected block: ${command}`);
  });
}

test('#373 BLOCKED task: RSTACK_ALLOW_DESTRUCTIVE does NOT bypass the budget block', async () => {
  const { root, runId } = seedRun('BLOCKED');
  const { code } = await runGuard(
    ['--context', 'builder', '--task', 't1', '--run-id', runId, '--command', 'rm -rf build'],
    { cwd: root, env: { RSTACK_ALLOW_DESTRUCTIVE: '1' } },
  );
  assert.equal(code, EXIT_BLOCK);
});

for (const [label, command] of [
  ['read (grep)', 'grep -r foo src'],
  ['tests to /tmp scratch', 'npm test > /tmp/out.log 2>&1'],
]) {
  test(`#373 BLOCKED task: non-mutating allowed — ${label}`, async () => {
    const { root, runId } = seedRun('BLOCKED');
    const { code } = await runGuard(['--context', 'builder', '--task', 't1', '--run-id', runId, '--command', command], { cwd: root });
    assert.equal(code, EXIT_ALLOW, `expected allow: ${command}`);
  });
}

// A task the claim gate legitimately advanced is never budget-blocked.
for (const status of ['IN_PROGRESS', 'READY', 'PENDING']) {
  test(`#373 ${status} task: mutation allowed (not budget-blocked)`, async () => {
    const { root, runId } = seedRun(status);
    const { code } = await runGuard(['--context', 'builder', '--task', 't1', '--run-id', runId, '--path', 'src/app.js'], { cwd: root });
    assert.equal(code, EXIT_ALLOW);
  });
}

test('#373 no task id: gate does not fire (no budget context)', async () => {
  const { root, runId } = seedRun('BLOCKED');
  // No --task, no RSTACK_TASK_ID → the budget gate cannot key on a task.
  const { code } = await runGuard(['--context', 'builder', '--run-id', runId, '--path', 'src/app.js'], { cwd: root });
  assert.equal(code, EXIT_ALLOW);
});

test('#373 unknown task id: gate does not fabricate a block', async () => {
  const { root, runId } = seedRun('BLOCKED');
  const { code } = await runGuard(['--context', 'builder', '--task', 'does-not-exist', '--run-id', runId, '--path', 'src/app.js'], { cwd: root });
  assert.equal(code, EXIT_ALLOW);
});
