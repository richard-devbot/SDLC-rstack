/**
 * Transient Sandbox — "The Scientist" (#452), PR 2: wiring into the validate
 * gate + feeding the Critic (#451).
 *
 * Covers the pure seams (config resolution, AUTHORITATIVE command resolution,
 * execution→check mapping) and the exported runValidationExecution wiring with
 * an injected spawn/runtime so CI needs no container daemon. Also proves the
 * Scientist→Critic loop: a failed sandbox run's REAL logs surface in
 * priorCritiqueBlock.
 *
 * owner: RStack developed by Richardson Gunde
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  DEFAULT_SANDBOX_CONFIG,
  resolveSandboxConfig,
  resolveSandboxCommand,
  executionCheck,
} from '../src/core/harness/sandbox.js';
import { runValidationExecution, priorCritiqueBlock } from '../src/integrations/pi/rstack-sdlc.ts';
import { validateSandboxConfig } from '../src/core/harness/config-validation.js';

function fakeChild({ code = 0, stdout = '', stderr = '', hang = false } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => { child.killed = true; child.emit('close', null); };
  if (!hang) {
    setTimeout(() => {
      if (stdout) child.stdout.emit('data', Buffer.from(stdout));
      if (stderr) child.stderr.emit('data', Buffer.from(stderr));
      child.emit('close', code);
    }, 0);
  }
  return child;
}

// --- resolveSandboxConfig ---------------------------------------------------

test('resolveSandboxConfig merges valid fields and ignores bad-typed ones', () => {
  const cfg = resolveSandboxConfig({ image: 'node:20-alpine', network: true, command: 'npm test', timeout_ms: 5000, enabled: 'nope' });
  assert.equal(cfg.image, 'node:20-alpine');
  assert.equal(cfg.network, true);
  assert.equal(cfg.command, 'npm test');
  assert.equal(cfg.timeoutMs, 5000);
  assert.equal(cfg.enabled, true, 'bad-typed enabled falls back to the safe default');
});

test('resolveSandboxConfig defaults are safe (enabled, no network, shell image)', () => {
  const cfg = resolveSandboxConfig();
  assert.equal(cfg.enabled, DEFAULT_SANDBOX_CONFIG.enabled);
  assert.equal(cfg.network, false);
  assert.equal(cfg.command, null);
  assert.deepEqual(cfg.perStage, {});
});

test('resolveSandboxConfig keeps only per-stage entries with a real command', () => {
  const cfg = resolveSandboxConfig({ per_stage: { '07-code': { command: 'pytest -q', image: 'python:3.12-slim' }, '08-testing': { image: 'x' } } });
  assert.equal(cfg.perStage['07-code'].command, 'pytest -q');
  assert.equal(cfg.perStage['07-code'].image, 'python:3.12-slim');
  assert.equal(cfg.perStage['08-testing'], undefined, 'no command → dropped');
});

// --- resolveSandboxCommand (authoritative only) -----------------------------

test('resolveSandboxCommand NEVER uses the builder self-report; only trusted sources', () => {
  const config = resolveSandboxConfig({ command: 'npm test' });
  // A malicious builder trying to smuggle a trivially-green command via the
  // contract has no field here — tests_run is not consulted at all.
  const resolved = resolveSandboxCommand({ config, stageIds: [], task: { id: 't', tests_run: ['true'] } });
  assert.equal(resolved.command, 'npm test', 'global config command wins; builder tests_run ignored');
});

test('resolveSandboxCommand priority: task.test_command > per_stage > global', () => {
  const config = resolveSandboxConfig({ command: 'global-cmd', per_stage: { '07-code': { command: 'stage-cmd' } } });
  assert.equal(resolveSandboxCommand({ config, stageIds: ['07-code'], task: { test_command: 'task-cmd' } }).command, 'task-cmd');
  assert.equal(resolveSandboxCommand({ config, stageIds: ['07-code'], task: {} }).command, 'stage-cmd');
  assert.equal(resolveSandboxCommand({ config, stageIds: ['02-requirements'], task: {} }).command, 'global-cmd');
});

test('resolveSandboxCommand returns null when nothing authoritative is configured', () => {
  assert.equal(resolveSandboxCommand({ config: resolveSandboxConfig(), stageIds: ['07-code'], task: { tests_run: ['npm test'] } }), null);
});

// --- executionCheck mapping -------------------------------------------------

test('executionCheck maps PASS/FAIL/observed with real logs on FAIL', () => {
  const pass = executionCheck({ status: 'PASS', tier: 'docker', evidence: 'exit 0 in 12ms', exit_code: 0 }, 'npm test');
  assert.equal(pass.status, 'PASS');

  const fail = executionCheck({ status: 'FAIL', tier: 'docker', exit_code: 1, stderr_tail: 'AssertionError: nope', stdout_tail: '1 failing' }, 'npm test');
  assert.equal(fail.status, 'FAIL');
  assert.match(fail.evidence, /AssertionError: nope/, 'evidence is the ACTUAL log output, not a summary');
  assert.match(fail.evidence, /1 failing/);
  assert.match(fail.root_cause, /exit 1/);

  const observed = executionCheck({ status: 'observed', tier: 'unverified', evidence: 'no container runtime available' }, 'npm test');
  assert.equal(observed.status, 'WARN', 'no runtime → WARN, never a false PASS');
});

// --- runValidationExecution wiring (injected spawn/runtime) ------------------

test('runValidationExecution: FAIL exit → FAIL check carrying real logs (feeds the critic)', async () => {
  const { record, check } = await runValidationExecution({
    projectRoot: '/proj',
    task: { id: '07-code', test_command: 'pytest -q' },
    stageIds: ['07-code'],
    config: resolveSandboxConfig({ command: 'pytest -q' }),
    deps: { runtime: 'docker', containerName: 'rstack-sbx-test', spawn: () => fakeChild({ code: 1, stderr: 'E   assert 1 == 2' }) },
  });
  assert.equal(check.status, 'FAIL');
  assert.match(check.evidence, /assert 1 == 2/);
  assert.equal(record.status, 'FAIL');
  assert.equal(record.exit_code, 1);
});

test('runValidationExecution: PASS exit → PASS check', async () => {
  const { check } = await runValidationExecution({
    projectRoot: '/proj',
    task: { id: '07-code', test_command: 'npm test' },
    config: resolveSandboxConfig({ command: 'npm test' }),
    deps: { runtime: 'docker', spawn: () => fakeChild({ code: 0, stdout: '5 passed' }) },
  });
  assert.equal(check.status, 'PASS');
});

test('runValidationExecution: no runtime → WARN, no false green', async () => {
  const { record, check } = await runValidationExecution({
    projectRoot: '/proj',
    task: { id: '07-code', test_command: 'npm test' },
    config: resolveSandboxConfig({ command: 'npm test' }),
    deps: { probe: () => false }, // no docker/podman
  });
  assert.equal(check.status, 'WARN');
  assert.equal(record.tier, 'unverified');
});

test('runValidationExecution: disabled → WARN, sandbox never spawned', async () => {
  let spawned = false;
  const { check } = await runValidationExecution({
    projectRoot: '/proj',
    task: { id: '07-code', test_command: 'npm test' },
    config: resolveSandboxConfig({ enabled: false, command: 'npm test' }),
    deps: { runtime: 'docker', spawn: () => { spawned = true; return fakeChild({}); } },
  });
  assert.equal(check.status, 'WARN');
  assert.equal(spawned, false, 'disabled config must not execute anything');
});

test('runValidationExecution: no authoritative command → WARN (never runs builder-chosen cmd)', async () => {
  let spawned = false;
  const { check } = await runValidationExecution({
    projectRoot: '/proj',
    task: { id: '07-code', tests_run: ['rm -rf /'] }, // builder self-report — must be ignored
    config: resolveSandboxConfig(),
    deps: { runtime: 'docker', spawn: () => { spawned = true; return fakeChild({}); } },
  });
  assert.equal(check.status, 'WARN');
  assert.equal(spawned, false, 'no authoritative command → nothing executes');
});

// --- Scientist → Critic (#451) end-to-end -----------------------------------

test('priorCritiqueBlock surfaces the sandboxed execution logs at the top', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rstack-critique-'));
  const outputDir = join('out');
  mkdirSync(join(dir, outputDir), { recursive: true });
  writeFileSync(join(dir, outputDir, 'validation.json'), JSON.stringify({
    task_id: '07-code',
    status: 'FAIL',
    retry_recommendation: 'retry_builder',
    execution: { status: 'FAIL', tier: 'docker', exit_code: 1, stderr_tail: 'E   assert add(2,2) == 5', stdout_tail: '1 failed, 0 passed' },
    issues: [{ name: 'sandbox_execution', status: 'FAIL', evidence: 'Command `pytest` exit 1 ...long dump...' }],
    checks: [],
  }));
  const block = await priorCritiqueBlock(dir, { output_dir: outputDir });
  assert.match(block, /Sandboxed execution FAILED/);
  assert.match(block, /assert add\(2,2\) == 5/, 'REAL stderr reaches the retrying builder');
  assert.match(block, /1 failed, 0 passed/);
  // The full log dump is rendered once (from the structured record), not also
  // duplicated as a sandbox_execution bullet.
  assert.equal((block.match(/assert add\(2,2\) == 5/g) || []).length, 1);
});

// --- config validation ------------------------------------------------------

test('validateSandboxConfig flags unknown keys, bad types, and typo\'d stages', () => {
  const issues = validateSandboxConfig({
    enabled: 'yes',
    network: 1,
    command: '',
    bogus: true,
    per_stage: { 'not-a-stage': { command: 'x' }, '07-code': { image: 'x' } },
  });
  const fields = issues.map((i) => i.field);
  assert.ok(fields.includes('sandbox.enabled'));
  assert.ok(fields.includes('sandbox.network'));
  assert.ok(fields.includes('sandbox.command'));
  assert.ok(fields.includes('sandbox.bogus'));
  assert.ok(fields.includes('sandbox.per_stage.not-a-stage'));
  assert.ok(fields.includes('sandbox.per_stage.07-code'), 'per-stage entry with no command is flagged');
});

test('validateSandboxConfig passes a well-formed block', () => {
  assert.deepEqual(
    validateSandboxConfig({ enabled: true, image: 'node:20-alpine', command: 'npm test', network: false, timeout_ms: 60000, per_stage: { '07-code': { command: 'npm test' } } }),
    [],
  );
});
