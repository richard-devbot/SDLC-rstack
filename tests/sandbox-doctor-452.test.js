/**
 * Transient Sandbox — "The Scientist" (#452), PR 3: doctor tier report +
 * opt-in bounded runtime auto-start.
 *
 * Covers the pure tier verdict (sandboxTierCheck), readiness-vs-installed
 * detection, per-platform start commands, and the injectable bounded auto-start
 * (already-running / not-installed / becomes-ready / times-out) — all without a
 * real container daemon.
 *
 * owner: RStack developed by Richardson Gunde
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  detectInstalledRuntime,
  runtimeStartCommand,
  startContainerRuntime,
  resolveSandboxConfig,
} from '../src/core/harness/sandbox.js';
import { sandboxTierCheck } from '../src/commands/doctor.js';

// --- sandboxTierCheck (pure verdict) ---------------------------------------

test('sandboxTierCheck: ready runtime + configured command → PASS container-verified', () => {
  const c = sandboxTierCheck({ readyRuntime: 'docker', installedRuntime: 'docker', config: resolveSandboxConfig({ command: 'npm test' }) });
  assert.equal(c.status, 'PASS');
  assert.match(c.detail, /container-verified \(docker\)/);
});

test('sandboxTierCheck: ready runtime but NO command → WARN (still unverified)', () => {
  const c = sandboxTierCheck({ readyRuntime: 'docker', installedRuntime: 'docker', config: resolveSandboxConfig() });
  assert.equal(c.status, 'WARN');
  assert.match(c.detail, /NO authoritative test command/);
});

test('sandboxTierCheck: installed but engine stopped → WARN with start hint', () => {
  const c = sandboxTierCheck({ readyRuntime: null, installedRuntime: 'podman', config: resolveSandboxConfig({ command: 'npm test' }) });
  assert.equal(c.status, 'WARN');
  assert.match(c.detail, /engine is not running/);
  assert.match(c.fix, /podman machine start|--start-runtime/);
});

test('sandboxTierCheck: no runtime at all → WARN unverified, never a false green', () => {
  const c = sandboxTierCheck({ readyRuntime: null, installedRuntime: null, config: resolveSandboxConfig({ command: 'npm test' }) });
  assert.equal(c.status, 'WARN');
  assert.match(c.detail, /no container runtime/);
  assert.match(c.detail, /never a false green/);
});

test('sandboxTierCheck: disabled config → WARN, self-report only', () => {
  const c = sandboxTierCheck({ readyRuntime: 'docker', installedRuntime: 'docker', config: resolveSandboxConfig({ enabled: false }) });
  assert.equal(c.status, 'WARN');
  assert.match(c.detail, /DISABLED/);
});

test('sandboxTierCheck: surfaces the auto-start outcome note', () => {
  const c = sandboxTierCheck({ readyRuntime: 'docker', installedRuntime: 'docker', config: resolveSandboxConfig({ command: 'npm test' }), autostart: { message: 'docker engine started and is ready' } });
  assert.match(c.detail, /auto-start: docker engine started and is ready/);
});

// --- detection + start command ---------------------------------------------

test('detectInstalledRuntime prefers docker, falls back to podman, else null', () => {
  assert.equal(detectInstalledRuntime({ probe: (r) => r === 'docker' }), 'docker');
  assert.equal(detectInstalledRuntime({ probe: (r) => r === 'podman' }), 'podman');
  assert.equal(detectInstalledRuntime({ probe: () => false }), null);
});

test('runtimeStartCommand is platform-aware', () => {
  assert.deepEqual(runtimeStartCommand('podman'), { cmd: 'podman', args: ['machine', 'start'] });
  assert.deepEqual(runtimeStartCommand('docker', 'darwin'), { cmd: 'open', args: ['-a', 'Docker'] });
  assert.equal(runtimeStartCommand('docker', 'linux'), null, 'no auto-start of a linux system daemon');
  assert.equal(runtimeStartCommand('nope', 'darwin'), null);
});

// --- startContainerRuntime (bounded, injectable) ----------------------------

test('startContainerRuntime: not installed → runtime null, nothing launched', async () => {
  let launched = false;
  const res = await startContainerRuntime({ installedProbe: () => false, spawnImpl: () => { launched = true; } });
  assert.equal(res.runtime, null);
  assert.equal(res.ready, false);
  assert.equal(launched, false);
});

test('startContainerRuntime: already running → no launch, ready', async () => {
  let launched = false;
  const res = await startContainerRuntime({ installedProbe: (r) => r === 'docker', readyProbe: () => true, spawnImpl: () => { launched = true; } });
  assert.equal(res.started, false);
  assert.equal(res.ready, true);
  assert.equal(launched, false, 'never relaunch an already-running engine');
});

test('startContainerRuntime: installed+stopped → launches, polls, becomes ready', async () => {
  let ready = false;
  const res = await startContainerRuntime({
    installedProbe: (r) => r === 'docker',
    readyProbe: () => ready,
    spawnImpl: () => { ready = true; return { on() {}, unref() {} }; },
    platform: 'darwin',
    sleep: async () => {},
    now: (() => { let t = 0; return () => (t += 1000); })(),
    pollMs: 1, timeoutMs: 100000,
  });
  assert.equal(res.started, true);
  assert.equal(res.ready, true);
  assert.equal(res.runtime, 'docker');
});

test('startContainerRuntime: never ready → bounded timeout, ready false', async () => {
  const res = await startContainerRuntime({
    installedProbe: (r) => r === 'docker',
    readyProbe: () => false,
    spawnImpl: () => ({ on() {}, unref() {} }),
    platform: 'darwin',
    sleep: async () => {},
    now: (() => { let t = 0; return () => (t += 50000); })(),
    pollMs: 1, timeoutMs: 100000,
  });
  assert.equal(res.started, true);
  assert.equal(res.ready, false);
  assert.match(res.message, /not ready within/);
});

test('startContainerRuntime: installed but no platform start path → honest message', async () => {
  const res = await startContainerRuntime({
    installedProbe: (r) => r === 'docker',
    readyProbe: () => false,
    platform: 'linux', // docker on linux is a system daemon we won't sudo-start
    spawnImpl: () => { throw new Error('should not spawn'); },
  });
  assert.equal(res.ready, false);
  assert.match(res.message, /cannot auto-start/);
});
