// owner: RStack developed by Richardson Gunde
//
// Tests for `rstack-agents context` (#255) — the framework-neutral context
// injector. Exercised through the real CLI (spawned subprocess) so the stdin
// parsing, the ALWAYS-exit-0 contract, the "no active run → no output" no-op,
// the Claude Code hookSpecificOutput shape, and the no-secret guarantee are all
// covered end-to-end, plus unit coverage for the pure builder.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildContextString, parseHookEventName } from '../src/commands/context.js';

const BIN = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'rstack-agents.js');

function cleanEnv(overrides = {}) {
  const env = { ...process.env };
  for (const key of ['RSTACK_RUN_ID', 'RSTACK_STATE_DIR', 'RSTACK_PROJECT_ROOT', 'RSTACK_OBSERVE_SOURCE']) {
    delete env[key];
  }
  return { ...env, ...overrides };
}

function runContext(args, { input = '', env = {}, cwd } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [BIN, 'context', ...args], {
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

// A minimal but real run: manifest + one pending decision + one pending queued
// approval so the packet reports non-zero blockers.
function seedProject({ runId = 'run-context-test', withBlockers = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'rstack-context-'));
  const runDir = join(root, '.rstack', 'runs', runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, 'manifest.json'), JSON.stringify({ run_id: runId, project_root: root, status: 'IN_PROGRESS' }));
  if (withBlockers) {
    writeFileSync(join(runDir, 'decisions.json'), JSON.stringify({
      run_id: runId,
      decisions: [{ decision_id: 'DEC-001', question: 'db choice', status: 'pending', impact: 'architecture' }],
    }));
    writeFileSync(join(root, '.rstack', 'approvals.jsonl'),
      JSON.stringify({ id: 'gate:x', runId, artifact: 'architecture.md', status: 'pending' }) + '\n');
  }
  return { root, runId, runDir };
}

test('context: active run emits a hookSpecificOutput packet with the run id (exit 0)', async () => {
  const { root, runId } = seedProject();
  const payload = JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: 'add a login page' });
  const { code, stdout } = await runContext(['--project', root], { input: payload });
  assert.equal(code, 0, 'context always exits 0');
  const parsed = JSON.parse(stdout.trim());
  assert.equal(parsed.hookSpecificOutput.hookEventName, 'UserPromptSubmit', 'echoes the hook event name');
  const ctx = parsed.hookSpecificOutput.additionalContext;
  assert.ok(ctx.includes(runId), 'packet names the active run');
  assert.ok(ctx.includes('orchestrator'), 'packet carries the orchestrator pointer');
  assert.ok(ctx.length <= 1024, 'packet stays small (<=1KB)');
});

test('context: no active run is a silent no-op (exit 0, NO stdout)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'rstack-context-norun-'));
  const payload = JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: 'hi' });
  const { code, stdout } = await runContext(['--project', root], { input: payload });
  assert.equal(code, 0, 'still exits 0 with no run');
  assert.equal(stdout.trim(), '', 'no output injected when there is no run');
});

test('context: reports pending approvals + open decisions as blockers', async () => {
  const { root } = seedProject({ withBlockers: true });
  const { code, stdout } = await runContext(['--project', root],
    { input: JSON.stringify({ hook_event_name: 'SessionStart' }) });
  assert.equal(code, 0);
  const ctx = JSON.parse(stdout.trim()).hookSpecificOutput.additionalContext;
  assert.ok(/1 pending approval/.test(ctx), 'counts the pending approval');
  assert.ok(/1 open decision/.test(ctx), 'counts the open decision');
});

test('context: SessionStart hook event is echoed back', async () => {
  const { root } = seedProject();
  const { stdout } = await runContext(['--project', root],
    { input: JSON.stringify({ hook_event_name: 'SessionStart' }) });
  assert.equal(JSON.parse(stdout.trim()).hookSpecificOutput.hookEventName, 'SessionStart');
});

test('context: malformed stdin still emits a valid packet (never throws), defaults the event name', async () => {
  const { root, runId } = seedProject();
  const { code, stdout, stderr } = await runContext(['--project', root], { input: 'not json at all }{' });
  assert.equal(code, 0);
  const parsed = JSON.parse(stdout.trim());
  assert.equal(parsed.hookSpecificOutput.hookEventName, 'UserPromptSubmit', 'defaults when event name unknown');
  assert.ok(parsed.hookSpecificOutput.additionalContext.includes(runId));
  assert.ok(!/throw|TypeError|SyntaxError/i.test(stderr), 'no stack trace leaked');
});

test('context: never injects secret-looking material (packet is structural only)', async () => {
  // Even if a prompt carries a secret, the injector must never echo prompt text.
  const { root } = seedProject();
  const payload = JSON.stringify({
    hook_event_name: 'UserPromptSubmit',
    prompt: 'deploy with AWS_SECRET_ACCESS_KEY=AKIAIOSFODNN7EXAMPLE123 and password hunter2supersecret',
  });
  const { stdout } = await runContext(['--project', root], { input: payload });
  assert.ok(!stdout.includes('AKIAIOSFODNN7EXAMPLE123'), 'no AWS key echoed');
  assert.ok(!stdout.includes('hunter2supersecret'), 'no password echoed');
  assert.ok(!stdout.includes('deploy with'), 'prompt text never echoed at all');
});

test('context: --run-id targets a specific run', async () => {
  const { root, runId } = seedProject({ runId: 'run-A' });
  mkdirSync(join(root, '.rstack', 'runs', 'run-B'), { recursive: true });
  writeFileSync(join(root, '.rstack', 'runs', 'run-B', 'manifest.json'), JSON.stringify({ run_id: 'run-B' }));
  const { stdout } = await runContext(['--project', root, '--run-id', runId],
    { input: JSON.stringify({ hook_event_name: 'SessionStart' }) });
  assert.ok(stdout.includes(runId), 'describes the explicitly targeted run');
});

// --- unit coverage for the pure builder + parser ----------------------------

test('buildContextString: empty run id → empty string (no packet)', () => {
  assert.equal(buildContextString({ runId: '' }), '');
  assert.equal(buildContextString({ runId: null }), '');
});

test('buildContextString: includes stage + orchestrator pointer, omits zero blockers', () => {
  const s = buildContextString({ runId: 'run-1', stageId: '07-code', pendingApprovalCount: 0, openDecisionCount: 0 });
  assert.ok(s.includes('run-1'));
  assert.ok(s.includes('07-code'));
  assert.ok(s.includes('orchestrator'));
  assert.ok(!/Blockers:/.test(s), 'no blockers line when both counts are zero');
});

test('buildContextString: singular/plural blocker wording + caps length', () => {
  const one = buildContextString({ runId: 'r', pendingApprovalCount: 1, openDecisionCount: 0 });
  assert.ok(/1 pending approval\b/.test(one) && !/approvals/.test(one));
  const many = buildContextString({ runId: 'r', pendingApprovalCount: 3, openDecisionCount: 2 });
  assert.ok(/3 pending approvals/.test(many) && /2 open decisions/.test(many));
  assert.ok(buildContextString({ runId: 'r' }).length <= 1024);
});

test('buildContextString: sanitizes injected ids (defense in depth)', () => {
  const s = buildContextString({ runId: 'run 1; rm -rf /', stageId: '07-code<script>' });
  // The run id (attacker-influenceable) is stripped of shell metachars/spaces;
  // it renders as "run1rm-rf". (The static pointer legitimately contains a
  // semicolon, so we assert on the injected id specifically, not the whole string.)
  assert.ok(s.includes('run1rm-rf'), 'run id collapsed to safe chars');
  assert.ok(!s.includes('run 1'), 'space + metachars removed from the run id');
  assert.ok(!s.includes('<script>'), 'stage id stripped of angle brackets');
});

test('parseHookEventName: pulls the name, tolerates junk', () => {
  assert.equal(parseHookEventName(JSON.stringify({ hook_event_name: 'SessionStart' })), 'SessionStart');
  assert.equal(parseHookEventName(JSON.stringify({ hookEventName: 'UserPromptSubmit' })), 'UserPromptSubmit');
  assert.equal(parseHookEventName('garbage'), null);
  assert.equal(parseHookEventName(''), null);
  assert.equal(parseHookEventName('42'), null);
});
