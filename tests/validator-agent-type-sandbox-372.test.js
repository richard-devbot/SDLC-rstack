// owner: RStack developed by Richardson Gunde
//
// #372 — a validator subagent must be read-only on Claude Code, including its
// BASH commands. Two mechanisms, both exercised here:
//   1. Context escalation: the session guard reads `agent_type` from the
//      PreToolUse payload (the ONLY signal available for a plugin subagent,
//      whose agent-def hooks Claude Code ignores by design) and escalates to
//      the validator sandbox even though the hook wiring passes
//      `--context builder`. One-way — never downgrades an env-stamped validator.
//   2. Sandbox coverage: the validator sandbox denies file-writing bash
//      (`echo > src`, cp/ln/tee) while still allowing reads/tests and scratch
//      redirects to /dev/null and /tmp.
// Verified end-to-end through the real `rstack-agents guard` CLI (exit codes).

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveGuardContext } from '../src/commands/guard.js';

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

// The session guard wiring passes `--context builder`; agent_type must override.
function runGuard(payload, { env = {} } = {}) {
  return new Promise((resolveP, rejectP) => {
    const child = spawn(process.execPath, [BIN, 'guard', '--context', 'builder'], {
      cwd: tmpdir(), env: cleanEnv(env), stdio: ['pipe', 'pipe', 'pipe'],
    });
    // Hard timeout so a hung guard can never wedge CI (CodeRabbit).
    const timer = setTimeout(() => { child.kill('SIGKILL'); rejectP(new Error('guard subprocess timed out')); }, 10_000);
    let stdout = '';
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', () => {});
    child.on('error', (e) => { clearTimeout(timer); rejectP(e); });
    child.on('close', (code) => { clearTimeout(timer); resolveP({ code, verdict: (() => { try { return JSON.parse(stdout); } catch { return null; } })() }); });
    child.stdin.end(JSON.stringify(payload));
  });
}

const bash = (command, agent_type) => ({ tool_name: 'Bash', tool_input: { command }, ...(agent_type ? { agent_type } : {}) });
const write = (file_path, agent_type) => ({ tool_name: 'Write', tool_input: { file_path }, ...(agent_type ? { agent_type } : {}) });

// --- context escalation (unit) ----------------------------------------------

test('agent_type validator escalates to the validator sandbox even under --context builder', () => {
  assert.equal(resolveGuardContext('builder', {}, 'validator'), 'validator');
  assert.equal(resolveGuardContext('builder', {}, 'security-reviewer'), 'validator');
  assert.equal(resolveGuardContext('builder', {}, 'code-reviewer'), 'validator');
  assert.equal(resolveGuardContext('builder', {}, 'qa-expert'), 'validator');
});

test('a non-validator agent_type does NOT escalate (builder stays builder)', () => {
  assert.equal(resolveGuardContext('builder', {}, 'builder'), 'builder');
  assert.equal(resolveGuardContext('builder', {}, 'code-writer'), 'builder');
  assert.equal(resolveGuardContext('builder', {}, null), 'builder');
});

test('escalation is one-way: a spoofed builder agent_type cannot downgrade an env-stamped validator', () => {
  assert.equal(resolveGuardContext('builder', { RSTACK_VALIDATOR_CONTEXT: '1' }, 'builder'), 'validator');
});

// --- validator subagent: mutations blocked (end-to-end) ---------------------

for (const [label, command] of [
  ['redirect to source', 'echo x > src/app.js'],
  ['cp over a source file', 'cp /tmp/evil.js src/app.js'],
  ['tee a source file', 'cat x | tee src/app.js'],
  ['symlink create', 'ln -s a b'],
  ['append to source', 'printf x >> src/app.js'],
]) {
  test(`validator subagent BASH write blocked: ${label}`, async () => {
    const { code } = await runGuard(bash(command, 'validator'));
    assert.equal(code, EXIT_BLOCK, `expected block for validator bash: ${command}`);
  });
}

test('validator subagent Write tool is blocked', async () => {
  const { code } = await runGuard(write('src/app.js', 'validator'));
  assert.equal(code, EXIT_BLOCK);
});

// Traversal must not escape the /tmp allowance back into the workspace (#372).
for (const [label, command] of [
  ['/tmp/.. traversal to source', 'echo x > /tmp/../src/app.js'],
  ['deep traversal', 'echo x > /tmp/a/../../etc/cron.d/x'],
  ['absolute non-temp path', 'echo x > /etc/passwd'],
]) {
  test(`validator subagent redirect traversal blocked: ${label}`, async () => {
    const { code } = await runGuard(bash(command, 'validator'));
    assert.equal(code, EXIT_BLOCK, `expected block for traversal: ${command}`);
  });
}

// --- validator subagent: reads / tests / scratch allowed --------------------

for (const [label, command] of [
  ['ls', 'ls -la'],
  ['grep', 'grep -r foo src'],
  ['run tests', 'npm test'],
  ['tests with fd dup', 'npm test 2>&1'],
  ['discard to /dev/null', 'pytest 2>/dev/null'],
  ['scratch to /tmp', 'npm test > /tmp/out.log 2>&1'],
]) {
  test(`validator subagent read/test allowed: ${label}`, async () => {
    const { code } = await runGuard(bash(command, 'validator'));
    assert.equal(code, EXIT_ALLOW, `expected allow for validator bash: ${command}`);
  });
}

// --- builder subagent unaffected --------------------------------------------

test('builder subagent may write via bash (no escalation)', async () => {
  const { code } = await runGuard(bash('echo x > src/app.js', 'builder'));
  assert.equal(code, EXIT_ALLOW);
});

test('a call with no agent_type keeps builder behavior (safe allowed)', async () => {
  const { code } = await runGuard(bash('ls'));
  assert.equal(code, EXIT_ALLOW);
});
