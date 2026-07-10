// owner: RStack developed by Richardson Gunde
//
// Tests for `rstack-agents guard` (#227) — the framework-neutral enforcement
// guard. Exercised through the real CLI (spawned subprocess) so exit codes,
// stdin parsing, and stdout/stderr contracts are all covered end-to-end.
// The guard must REUSE the harness classifiers, so the obfuscation cases here
// are the same shapes the destructive-actions suite pins (env-prefix,
// /bin/rm, --force-with-lease).

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'rstack-agents.js');

// Hermetic env: strip every RStack knob that could change guard behavior.
function cleanEnv(overrides = {}) {
  const env = { ...process.env };
  for (const key of ['RSTACK_ALLOW_DESTRUCTIVE', 'RSTACK_TASK_ID', 'RSTACK_AGENT_CONTEXT', 'RSTACK_VALIDATOR_CONTEXT', 'RSTACK_STATE_DIR']) {
    delete env[key];
  }
  return { ...env, ...overrides };
}

function runGuard(args, { input = '', env = {}, cwd } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [BIN, 'guard', ...args], {
      cwd: cwd ?? tmpdir(),
      env: cleanEnv(env),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', rejectPromise);
    child.on('close', (code) => resolvePromise({ code, stdout, stderr, verdict: (() => { try { return JSON.parse(stdout); } catch { return null; } })() }));
    child.stdin.end(input);
  });
}

function seedProject({ runId = 'run-guard-test', approvals = [] } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'rstack-guard-'));
  const runDir = join(root, '.rstack', 'runs', runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, 'manifest.json'), JSON.stringify({ run_id: runId }));
  writeFileSync(join(runDir, 'approvals.json'), JSON.stringify(approvals));
  return { root, runId };
}

function approvedRecord(artifact, runId) {
  return {
    id: `rec-${artifact}`,
    artifact,
    status: 'APPROVED',
    approver: 'richardson',
    timestamp: new Date().toISOString(),
    run_id: runId,
  };
}

// --- builder context: allow / block ----------------------------------------

test('builder allows a safe command (flags) with exit 0', async () => {
  const { code, verdict } = await runGuard(['--command', 'ls -la']);
  assert.equal(code, 0);
  assert.equal(verdict.decision, 'allow');
  assert.equal(verdict.category, null);
  assert.equal(verdict.context, 'builder');
});

test('builder blocks obfuscated destructive commands without approval (exit 2, reason on stderr)', async () => {
  const { root } = seedProject();
  // Same obfuscation shapes the destructive-actions suite pins: env-prefix,
  // absolute /bin/rm, and --force-with-lease.
  const cases = [
    ['FOO=1 rm -rf /tmp/x', 'broad-delete'],
    ['/bin/rm -rf /tmp/x', 'broad-delete'],
    ['git push --force-with-lease origin main', 'git-force'],
  ];
  for (const [command, category] of cases) {
    const { code, verdict, stderr } = await runGuard(['--command', command, '--task', 't1', '--project', root]);
    assert.equal(code, 2, `expected block: ${command}`);
    assert.equal(verdict.decision, 'block');
    assert.equal(verdict.category, category, `category for: ${command}`);
    assert.match(verdict.reason, /requires approval/);
    assert.match(stderr, /BLOCKED/, 'human reason must reach stderr');
  }
});

test('builder allows a destructive command with RSTACK_ALLOW_DESTRUCTIVE=1 (mirrors the Pi hook)', async () => {
  const { code, verdict } = await runGuard(['--command', 'rm -rf /tmp/x'], { env: { RSTACK_ALLOW_DESTRUCTIVE: '1' } });
  assert.equal(code, 0);
  assert.equal(verdict.decision, 'allow');
  assert.equal(verdict.category, 'broad-delete');
  assert.match(verdict.reason, /RSTACK_ALLOW_DESTRUCTIVE/);
});

test('destructive with no resolvable task id fails closed with guidance', async () => {
  const { root } = seedProject();
  const { code, verdict } = await runGuard(['--command', 'rm -rf /tmp/x', '--project', root]);
  assert.equal(code, 2);
  assert.equal(verdict.decision, 'block');
  assert.match(verdict.reason, /--task/);
  assert.match(verdict.reason, /RSTACK_TASK_ID/);
});

test('destructive with no resolvable run fails closed', async () => {
  const root = mkdtempSync(join(tmpdir(), 'rstack-guard-norun-'));
  const { code, verdict } = await runGuard(['--command', 'rm -rf /tmp/x', '--task', 't1', '--project', root]);
  assert.equal(code, 2);
  assert.equal(verdict.decision, 'block');
  assert.match(verdict.reason, /Fail closed/);
});

test('destructive allowed when the run carries an audited destructive-action approval', async () => {
  const runId = 'run-approved';
  const { root } = seedProject({ runId, approvals: [approvedRecord('destructive-action:t1', runId)] });
  const { code, verdict } = await runGuard(['--command', 'rm -rf /tmp/x', '--task', 't1', '--project', root, '--run-id', runId]);
  assert.equal(code, 0);
  assert.equal(verdict.decision, 'allow');
  assert.equal(verdict.approval_artifact, 'destructive-action:t1');
});

test('an approval bound to a different run does not unblock (cross-run replay rejected)', async () => {
  const runId = 'run-current';
  const { root } = seedProject({ runId, approvals: [approvedRecord('destructive-action:t1', 'some-other-run')] });
  const { code, verdict } = await runGuard(['--command', 'rm -rf /tmp/x', '--task', 't1', '--project', root, '--run-id', runId]);
  assert.equal(code, 2);
  assert.equal(verdict.decision, 'block');
});

// --- validator / reviewer / security contexts ------------------------------

test('validator context blocks a Write tool call from Claude Code stdin JSON', async () => {
  const input = JSON.stringify({ tool_name: 'Write', tool_input: { file_path: 'src/app.js', content: 'x' } });
  const { code, verdict } = await runGuard(['--context', 'validator'], { input });
  assert.equal(code, 2);
  assert.equal(verdict.decision, 'block');
  assert.equal(verdict.category, 'validator-sandbox');
  assert.match(verdict.reason, /read-only/);
});

test('validator context allows reads, blocks mutating bash; security context matches', async () => {
  const read = await runGuard(['--context', 'security', '--command', 'cat README.md']);
  assert.equal(read.code, 0);
  assert.equal(read.verdict.decision, 'allow');

  const mutate = await runGuard(['--context', 'reviewer', '--command', 'git commit -m "x"']);
  assert.equal(mutate.code, 2);
  assert.equal(mutate.verdict.category, 'validator-sandbox');
});

test('RSTACK_ALLOW_DESTRUCTIVE never bypasses the validator sandbox', async () => {
  const { code, verdict } = await runGuard(['--context', 'validator', '--tool', 'write', '--path', 'src/app.js'], {
    env: { RSTACK_ALLOW_DESTRUCTIVE: '1' },
  });
  assert.equal(code, 2);
  assert.equal(verdict.decision, 'block');
});

test('RSTACK_VALIDATOR_CONTEXT=1 (delegate-stamped sandbox env) overrides --context builder', async () => {
  const { code, verdict } = await runGuard(['--context', 'builder', '--tool', 'edit', '--path', 'src/app.js'], {
    env: { RSTACK_VALIDATOR_CONTEXT: '1' },
  });
  assert.equal(code, 2);
  assert.equal(verdict.context, 'validator');
});

// --- stdin formats, context env, explain mode ------------------------------

test('Claude Code PreToolUse stdin JSON: safe Bash allows, destructive Bash blocks', async () => {
  const { root } = seedProject();
  const safe = await runGuard(['--project', root], { input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'npm test' } }) });
  assert.equal(safe.code, 0);
  assert.equal(safe.verdict.decision, 'allow');

  const destructive = await runGuard(['--task', 't9', '--project', root], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git push --force origin main' } }),
  });
  assert.equal(destructive.code, 2);
  assert.equal(destructive.verdict.category, 'git-force');
});

test('context defaults from RSTACK_AGENT_CONTEXT env when no --context flag is given', async () => {
  const input = JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: 'src/app.js' } });
  const { code, verdict } = await runGuard([], { input, env: { RSTACK_AGENT_CONTEXT: 'validator' } });
  assert.equal(code, 2);
  assert.equal(verdict.context, 'validator');
});

test('--explain classifies without approval lookup and always exits 0', async () => {
  const destructive = await runGuard(['--explain', '--command', 'terraform destroy']);
  assert.equal(destructive.code, 0, 'explain never blocks');
  assert.equal(destructive.verdict.decision, 'block', 'verdict still reports what enforcement would do');
  assert.equal(destructive.verdict.explain, true);
  assert.equal(destructive.verdict.category, 'deploy');
  assert.match(destructive.verdict.reason, /approval lookup skipped/);

  const safe = await runGuard(['--explain', '--command', 'ls']);
  assert.equal(safe.code, 0);
  assert.equal(safe.verdict.decision, 'allow');
});

// --- unclassifiable / malformed input policy --------------------------------

test('empty stdin with no flags allows with a stderr warning (fail open, documented)', async () => {
  const { code, verdict, stderr } = await runGuard([], { input: '' });
  assert.equal(code, 0);
  assert.equal(verdict.decision, 'allow');
  assert.equal(verdict.reason, 'unclassifiable input');
  assert.match(stderr, /no input to classify/);
});

test('non-JSON stdin is sniffed as a shell command — destructive raw text still blocks', async () => {
  const { root } = seedProject();
  const blocked = await runGuard(['--task', 't1', '--project', root], { input: 'rm -rf /tmp/x' });
  assert.equal(blocked.code, 2, 'destructive-looking raw text must not fail open');
  assert.equal(blocked.verdict.category, 'broad-delete');
  assert.match(blocked.stderr, /not valid JSON/);

  const allowed = await runGuard([], { input: 'this is just some text' });
  assert.equal(allowed.code, 0);
  assert.equal(allowed.verdict.decision, 'allow');
});

test('JSON stdin with no recognizable tool call allows with a warning', async () => {
  const { code, verdict, stderr } = await runGuard([], { input: '42' });
  assert.equal(code, 0);
  assert.equal(verdict.reason, 'unclassifiable input');
  assert.match(stderr, /rstack guard/);
});

test('stdout is a single-line JSON verdict (machine-parseable hook contract)', async () => {
  const { stdout } = await runGuard(['--command', 'ls']);
  const lines = stdout.split('\n').filter(Boolean);
  assert.equal(lines.length, 1, 'exactly one stdout line');
  assert.doesNotThrow(() => JSON.parse(lines[0]));
});
