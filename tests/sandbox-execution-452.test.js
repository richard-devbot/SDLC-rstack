/**
 * Transient Sandbox — "The Scientist" (#452), PR 1: core container execution.
 *
 * Container-only posture: code runs only inside docker/podman; no runtime →
 * NO execution, a labeled `execution: unverified` record (never unconfined,
 * never a false green). Every invocation is locked down (no net, no host env,
 * caps dropped, non-root, read-only mount, resource caps, hard timeout).
 *
 * Uses an injected spawn + runtime probe so CI needs no container daemon.
 *
 * owner: RStack developed by Richardson Gunde
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { detectContainerRuntime, buildSandboxArgv, runInSandbox } from '../src/core/harness/sandbox.js';

function fakeChild({ code = 0, stdout = '', stderr = '', hang = false } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => { child.killed = true; child.emit('close', null); };
  if (!hang) {
    setImmediate(() => {
      if (stdout) child.stdout.emit('data', Buffer.from(stdout));
      if (stderr) child.stderr.emit('data', Buffer.from(stderr));
      child.emit('close', code);
    });
  }
  return child;
}

test('no container runtime → execution unverified, never run unconfined (#452 posture)', async () => {
  const rec = await runInSandbox('/tmp/run', { taskId: '07-code', command: 'npm test' }, { probe: () => false });
  assert.equal(rec.kind, 'execution');
  assert.equal(rec.tier, 'unverified');
  assert.equal(rec.status, 'observed', 'not PASS and not FAIL — an honest non-verdict');
  assert.equal(rec.exit_code, null);
  assert.match(rec.evidence, /no container runtime/);
});

test('detectContainerRuntime prefers docker, falls back to podman, else null', () => {
  assert.equal(detectContainerRuntime({ probe: (r) => r === 'docker' }), 'docker');
  assert.equal(detectContainerRuntime({ probe: (r) => r === 'podman' }), 'podman');
  assert.equal(detectContainerRuntime({ probe: () => false }), null);
});

test('the container argv is locked down (no net, no host env, caps dropped, non-root, RO mount, capped)', () => {
  const argv = buildSandboxArgv('docker', { runDir: '/proj/.rstack/runs/r1', command: 'pytest -q' });
  const s = argv.join(' ');
  assert.match(s, /--network none/, 'network off by default');
  assert.match(s, /--cap-drop ALL/);
  assert.match(s, /no-new-privileges/);
  assert.match(s, /--user 1000:1000/, 'non-root');
  assert.match(s, /--read-only/);
  assert.match(s, /--memory 512m/);
  assert.match(s, /--pids-limit 256/);
  assert.match(s, /\/proj\/\.rstack\/runs\/r1:\/work:ro/, 'code mounted read-only');
  assert.equal(argv.at(-3), 'sh');
  assert.equal(argv.at(-1), 'pytest -q', 'command runs via shell INSIDE the container');
  // Host env is never forwarded: only an explicit HOME is set.
  assert.ok(!s.includes('--env-file') && (s.match(/--env /g) || []).length === 1);
});

test('opt-in network flips to bridge', () => {
  assert.match(buildSandboxArgv('podman', { runDir: '/r', command: 'x', network: true }).join(' '), /--network bridge/);
});

test('exit 0 → PASS with captured output; non-zero → FAIL', async () => {
  const pass = await runInSandbox('/r', { taskId: 't', command: 'true' }, {
    runtime: 'docker', spawn: () => fakeChild({ code: 0, stdout: '5 passed' }),
  });
  assert.equal(pass.status, 'PASS');
  assert.equal(pass.exit_code, 0);
  assert.equal(pass.tier, 'docker');
  assert.match(pass.stdout_tail, /5 passed/);

  const fail = await runInSandbox('/r', { taskId: 't', command: 'false' }, {
    runtime: 'docker', spawn: () => fakeChild({ code: 1, stderr: 'AssertionError: nope' }),
  });
  assert.equal(fail.status, 'FAIL');
  assert.equal(fail.exit_code, 1);
  assert.match(fail.stderr_tail, /AssertionError/, 'stderr captured — feeds the #451 critique loop');
});

test('a hung command is killed at the timeout and reported FAIL', async () => {
  const rec = await runInSandbox('/r', { taskId: 't', command: 'sleep 999', timeoutMs: 40 }, {
    runtime: 'docker', spawn: () => fakeChild({ hang: true }),
  });
  assert.equal(rec.status, 'FAIL');
  assert.equal(rec.exit_code, null);
  assert.match(rec.evidence, /timed out/);
});
