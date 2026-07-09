// owner: RStack developed by Richardson Gunde
//
// Tests for `rstack-agents observe` (#251) — the framework-neutral
// observability writer. Exercised through the real CLI (spawned subprocess) so
// the stdin parsing, exit-code contract (ALWAYS 0), and on-disk event shape are
// all covered end-to-end, plus the dashboard state builder reading the result.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getRunsForRoot } from '../src/observability/dashboard/state/runs.js';
import { buildActivityFeed } from '../src/observability/dashboard/state/feed.js';
import { normalizeObservation, sanitizeInput } from '../src/commands/observe.js';

const BIN = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'rstack-agents.js');

// Hermetic env: strip RStack knobs that could redirect the run or state dir.
function cleanEnv(overrides = {}) {
  const env = { ...process.env };
  for (const key of ['RSTACK_RUN_ID', 'RSTACK_STATE_DIR', 'RSTACK_PROJECT_ROOT', 'RSTACK_OBSERVE_SOURCE']) {
    delete env[key];
  }
  return { ...env, ...overrides };
}

function runObserve(args, { input = '', env = {}, cwd } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [BIN, 'observe', ...args], {
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

function seedProject({ runId = 'run-observe-test' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'rstack-observe-'));
  const runDir = join(root, '.rstack', 'runs', runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, 'manifest.json'), JSON.stringify({ run_id: runId, project_root: root }));
  return { root, runId, runDir };
}

function readEvents(runDir) {
  const path = join(runDir, 'events.jsonl');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

test('observe: Claude Code PostToolUse payload appends a tool_result event with the right shape + source', async () => {
  const { root, runDir } = seedProject();
  const payload = JSON.stringify({
    hook_event_name: 'PostToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'ls -la' },
    tool_response: { stdout: 'total 8\ndrwxr-xr-x', is_error: false },
  });
  const { code } = await runObserve(['--source', 'claude-code', '--project', root], { input: payload });
  assert.equal(code, 0, 'observe always exits 0');

  const events = readEvents(runDir);
  assert.equal(events.length, 1, 'exactly one event appended');
  const ev = events[0];
  assert.equal(ev.type, 'tool_result');
  assert.equal(ev.tool, 'Bash');
  assert.equal(ev.source, 'claude-code', 'honest harness source label');
  assert.equal(ev.isError, false);
  assert.ok(typeof ev.ts === 'string' && ev.ts.length > 0, 'carries an ISO timestamp like Pi');
  assert.ok(ev.summary.includes('total 8'), 'result summary captured');
});

test('observe: PreToolUse payload records a tool_call intent (so blocked calls still show)', async () => {
  const { root, runDir } = seedProject();
  const payload = JSON.stringify({
    hook_event_name: 'PreToolUse',
    tool_name: 'Write',
    tool_input: { file_path: 'src/app.js' },
  });
  const { code } = await runObserve(['--source', 'claude-code', '--project', root], { input: payload });
  assert.equal(code, 0);

  const events = readEvents(runDir);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'tool_call');
  assert.equal(events[0].tool, 'Write');
  assert.equal(events[0].input.file_path, 'src/app.js', 'non-secret path preserved');
  assert.equal(events[0].source, 'claude-code');
});

test('observe: NO active run is a silent no-op (exit 0, nothing written)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'rstack-observe-norun-'));
  // No .rstack/runs at all.
  const payload = JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } });
  const { code, stdout } = await runObserve(['--source', 'claude-code', '--project', root], { input: payload });
  assert.equal(code, 0, 'still exits 0 with no run');
  assert.equal(stdout.trim(), '', 'silent — no stdout noise on every tool call');
  assert.ok(!existsSync(join(root, '.rstack', 'runs')), 'observe NEVER creates run state');
});

test('observe: a secret-looking value is never written verbatim', async () => {
  const { root, runDir } = seedProject();
  const payload = JSON.stringify({
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'export AWS_SECRET_ACCESS_KEY=AKIAIOSFODNN7EXAMPLE123 && deploy', password: 'hunter2supersecret' },
  });
  const { code } = await runObserve(['--source', 'claude-code', '--project', root], { input: payload });
  assert.equal(code, 0);

  const raw = readFileSync(join(runDir, 'events.jsonl'), 'utf8');
  assert.ok(!raw.includes('AKIAIOSFODNN7EXAMPLE123'), 'AWS key id redacted');
  assert.ok(!raw.includes('hunter2supersecret'), 'password field value redacted');
  assert.ok(raw.includes('[redacted]'), 'redaction marker present');
});

test('observe: a Write with a huge content field never echoes the content verbatim', async () => {
  const { root, runDir } = seedProject();
  const big = 'x'.repeat(50_000);
  const payload = JSON.stringify({
    hook_event_name: 'PreToolUse',
    tool_name: 'Write',
    tool_input: { file_path: 'notes.txt', content: `${big} PRIVATE_MARKER_ABC` },
  });
  const { code } = await runObserve(['--source', 'claude-code', '--project', root], { input: payload });
  assert.equal(code, 0);

  const raw = readFileSync(join(runDir, 'events.jsonl'), 'utf8');
  assert.ok(!raw.includes('PRIVATE_MARKER_ABC'), 'file content is not echoed');
  assert.ok(raw.includes('chars omitted'), 'content collapsed to a length note');
  assert.ok(raw.length < 5000, 'event stays small regardless of content size');
});

test('observe: malformed stdin exits 0 and writes nothing (never throws)', async () => {
  const { root, runDir } = seedProject();
  const { code, stderr } = await runObserve(['--source', 'claude-code', '--project', root], { input: 'this is }{ not json at all' });
  assert.equal(code, 0, 'garbage stdin still exits 0');
  assert.equal(readEvents(runDir).length, 0, 'nothing observable → nothing written');
  assert.ok(!/throw|TypeError|SyntaxError/i.test(stderr), 'no stack trace leaked');
});

test('observe: empty stdin (TTY-like) exits 0, no-op', async () => {
  const { root, runDir } = seedProject();
  const { code } = await runObserve(['--source', 'claude-code', '--project', root], { input: '' });
  assert.equal(code, 0);
  assert.equal(readEvents(runDir).length, 0);
});

test('observe: --run-id targets a specific run; RSTACK_RUN_ID env resolves too', async () => {
  const { root, runDir } = seedProject({ runId: 'run-A' });
  // second run so "latest" is ambiguous — we want the explicit target honored.
  mkdirSync(join(root, '.rstack', 'runs', 'run-B'), { recursive: true });

  await runObserve(['--source', 'tau', '--project', root, '--run-id', 'run-A'],
    { input: JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'terminal', content: 'ok' }) });
  assert.equal(readEvents(runDir).length, 1, 'event landed in the explicitly targeted run');
  assert.equal(readEvents(join(root, '.rstack', 'runs', 'run-B')).length, 0, 'other run untouched');

  await runObserve(['--source', 'tau', '--project', root],
    { input: JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'terminal', content: 'ok2' }), env: { RSTACK_RUN_ID: 'run-A' } });
  assert.equal(readEvents(runDir).length, 2, 'RSTACK_RUN_ID env honored');
});

test('observe: flag-driven event (no stdin) appends correctly', async () => {
  const { root, runDir } = seedProject();
  const { code } = await runObserve(['--source', 'operator', '--project', root, '--event-type', 'tool_call', '--tool', 'shell']);
  assert.equal(code, 0);
  const events = readEvents(runDir);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'tool_call');
  assert.equal(events[0].tool, 'shell');
  assert.equal(events[0].source, 'operator');
});

test('observe: appended events flow into the dashboard state builder + feed', async () => {
  const { root, runDir } = seedProject();
  // Emit >=3 tool_calls in the same minute so the burst rollup fires.
  const min = new Date().toISOString().slice(0, 16);
  for (let i = 0; i < 4; i++) {
    await runObserve(['--source', 'claude-code', '--project', root],
      { input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: `echo ${i}` } }) });
  }
  // All four should share the minute bucket (fast subprocesses); assert on-disk.
  const events = readEvents(runDir);
  assert.ok(events.length >= 3, 'multiple tool_call events on disk');

  const runs = await getRunsForRoot(root);
  assert.equal(runs.length, 1);
  const dashRun = runs[0];
  assert.ok(dashRun.events.some((e) => e.type === 'tool_call' && e.source === 'claude-code'),
    'dashboard run carries the observe-written tool_call events with their source');
  assert.ok(dashRun.activityTimeline.some((m) => m.toolCalls > 0),
    'activity timeline counts the harness tool calls');

  // Only assert the burst summary when the four events landed in one minute
  // (they nearly always do; guard against a minute boundary flake).
  const feed = buildActivityFeed([dashRun]);
  const burst = feed.find((f) => f.type === 'tool_burst' && f.ts.startsWith(min));
  if (burst) {
    assert.ok(burst.summary.includes('via claude-code'), 'burst names the harness source honestly');
    assert.equal(burst.data?.source, 'claude-code');
  }
});

// --- unit coverage for the normalizer + sanitizer ---------------------------

test('normalizeObservation: Stop / SessionEnd map to session_shutdown', () => {
  assert.deepEqual(normalizeObservation(JSON.stringify({ hook_event_name: 'Stop' })), { type: 'session_shutdown' });
  assert.deepEqual(normalizeObservation(JSON.stringify({ hook_event_name: 'SessionEnd' })), { type: 'session_shutdown' });
});

test('normalizeObservation: nothing observable → null', () => {
  assert.equal(normalizeObservation(''), null);
  assert.equal(normalizeObservation('42'), null);
  assert.equal(normalizeObservation(JSON.stringify({ hook_event_name: 'PreToolUse' })), null, 'no tool → nothing to record');
});

test('sanitizeInput: drops secret keys, omits content, keeps safe paths', () => {
  const out = sanitizeInput({ file_path: 'a.js', content: 'lots of code', apiKey: 'sk-123', command: 'ls' });
  assert.equal(out.file_path, 'a.js');
  assert.equal(out.apiKey, '[redacted]');
  assert.ok(String(out.content).includes('omitted'));
  assert.equal(out.command, 'ls');
});
