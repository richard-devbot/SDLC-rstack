/**
 * Hardening tests for the Business Hub dashboard server (issue #86):
 *   1. per-IP token-bucket rate limiting on POST endpoints (10/min, 429 + Retry-After)
 *   2. append-only approval audit log (.rstack/approvals-audit.jsonl) for
 *      successful AND denied attempts
 *   3. ETag / If-None-Match → 304 on GET /api/state, /api/run-report, /api/artifact
 *   4. opt-in request logging behind RSTACK_HTTP_LOG=1
 *
 * Each test boots the real server as a child process on an ephemeral port
 * (--port 0) against a throwaway project root.
 *
 * owner: RStack developed by Richardson Gunde
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRateLimiter, etagFor, ifNoneMatchSatisfied, stableStringify } from '../src/observability/dashboard/hardening.js';

const SERVER_PATH = join(process.cwd(), 'src', 'observability', 'dashboard', 'server.js');

function startServer({ projectRoot, env = {} }) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [SERVER_PATH, '--port', '0', '--no-browser', '--project', projectRoot], {
      // cwd + RSTACK_REGISTRY_DIR keep the server hermetic: it must only ever
      // see the throwaway project root, never this machine's real projects.
      cwd: projectRoot,
      env: {
        ...process.env,
        // Neutralize ambient config from the host shell (undefined env values
        // are dropped by spawn), then apply per-test overrides.
        RSTACK_APPROVAL_TOKEN: undefined,
        RSTACK_HTTP_LOG: undefined,
        RSTACK_BUSINESS_PORT: undefined,
        RSTACK_PROJECT_ROOT: undefined,
        RSTACK_NO_BROWSER: '1',
        RSTACK_REGISTRY_DIR: join(projectRoot, '.registry'),
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill('SIGKILL');
        rejectPromise(new Error(`dashboard server did not boot in time\nstdout: ${stdout}\nstderr: ${stderr}`));
      }
    }, 15_000);
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      const match = stdout.match(/Dashboard: http:\/\/localhost:(\d+)/);
      if (match && !settled) {
        settled = true;
        clearTimeout(timer);
        resolvePromise({
          child,
          port: Number(match[1]),
          baseUrl: `http://127.0.0.1:${match[1]}`,
          getStdout: () => stdout,
          stop: () => child.kill('SIGKILL'),
        });
      }
    });
    child.on('exit', (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        rejectPromise(new Error(`dashboard server exited early (code ${code})\nstdout: ${stdout}\nstderr: ${stderr}`));
      }
    });
  });
}

// A run with one blocked approval gate, so /api/state exposes a pending
// approval the POST endpoints can act on.
async function seedRunWithBlockedGate(projectRoot, runId) {
  const runDir = join(projectRoot, '.rstack', 'runs', runId);
  await mkdir(runDir, { recursive: true });
  await writeFile(join(runDir, 'manifest.json'), JSON.stringify({
    run_id: runId,
    goal: 'Hardening fixture',
    created_at: '2026-06-10T08:00:00.000Z',
    framework: 'pi',
  }, null, 2));
  await writeFile(join(runDir, 'tasks.json'), JSON.stringify({ tasks: [] }, null, 2));
  await writeFile(join(runDir, 'events.jsonl'), JSON.stringify({
    ts: '2026-06-10T08:01:00.000Z',
    type: 'approval_gate_blocked',
    task_id: '004-implementation',
    missing: ['architecture.md'],
  }) + '\n');
  await writeFile(join(runDir, 'plan.md'), '# Plan\n\nHardening fixture artifact.\n');
  return runDir;
}

async function readAuditEntries(projectRoot, { minEntries = 1, timeoutMs = 5000 } = {}) {
  const auditPath = join(projectRoot, '.rstack', 'approvals-audit.jsonl');
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const raw = await readFile(auditPath, 'utf8').catch(() => '');
    const entries = raw.split('\n').filter(Boolean).map((line) => JSON.parse(line));
    if (entries.length >= minEntries) return entries;
    if (Date.now() > deadline) return entries;
    await new Promise((r) => setTimeout(r, 50));
  }
}

test('token bucket allows a burst of 10, denies the 11th, and refills over time', () => {
  let clock = 0;
  const limiter = createRateLimiter({ capacity: 10, windowMs: 60_000, now: () => clock });

  for (let i = 0; i < 10; i++) {
    assert.equal(limiter.check('1.2.3.4').allowed, true, `request ${i + 1} fits the burst`);
  }
  const denied = limiter.check('1.2.3.4');
  assert.equal(denied.allowed, false, '11th request inside the window is denied');
  assert.ok(denied.retryAfterSec >= 1, 'Retry-After is at least one second');

  // A different IP has its own bucket.
  assert.equal(limiter.check('5.6.7.8').allowed, true);

  // 6 seconds refills one token (10 per minute).
  clock += 6_000;
  assert.equal(limiter.check('1.2.3.4').allowed, true, 'refilled token is spendable');
  assert.equal(limiter.check('1.2.3.4').allowed, false, 'only one token refilled');
});

test('ETag helpers: stable hashes and If-None-Match matching incl. weak/list forms', () => {
  const etag = etagFor('{"a":1}');
  assert.equal(etag, etagFor('{"a":1}'));
  assert.notEqual(etag, etagFor('{"a":2}'));
  assert.equal(ifNoneMatchSatisfied(etag, etag), true);
  assert.equal(ifNoneMatchSatisfied(`W/${etag}`, etag), true);
  assert.equal(ifNoneMatchSatisfied(`"other", ${etag}`, etag), true);
  assert.equal(ifNoneMatchSatisfied('*', etag), true);
  assert.equal(ifNoneMatchSatisfied('"other"', etag), false);
  assert.equal(ifNoneMatchSatisfied(undefined, etag), false);
});

test('stableStringify drops server eval-time timestamps so the ETag is stable across rebuilds', () => {
  // Two consecutive state builds differ only in restamped "now" fields at any
  // nesting depth — top-level ts, alert ts, decision-readiness generated_at.
  const buildA = { ts: '2026-06-14T09:00:00.000Z', policy: { loadedAt: '2026-06-14T09:00:00.000Z', runBudgetUsd: 10 }, runs: [{ id: 'r1', status: 'DONE' }], alerts: [{ kind: 'stalled', ts: 1 }], decisions: { runs: [{ readiness: { generated_at: '2026-06-14T09:00:00.001Z', status: 'PASS' } }] } };
  const buildB = { ts: '2026-06-14T09:00:05.000Z', policy: { loadedAt: '2026-06-14T09:00:05.000Z', runBudgetUsd: 10 }, runs: [{ id: 'r1', status: 'DONE' }], alerts: [{ kind: 'stalled', ts: 2 }], decisions: { runs: [{ readiness: { generated_at: '2026-06-14T09:00:05.999Z', status: 'PASS' } }] } };
  assert.equal(stableStringify(buildA), stableStringify(buildB), 'timestamp-only deltas hash identically');
  assert.equal(etagFor(stableStringify(buildA)), etagFor(stableStringify(buildB)));

  // A real data change (status moves) must still change the hash.
  const buildC = { ...buildB, runs: [{ id: 'r1', status: 'FAILED' }] };
  assert.notEqual(stableStringify(buildA), stableStringify(buildC), 'real data change is not masked');
});

test('auth matrix holds and the 11th POST in a minute gets 429 + Retry-After', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-harden-rate-'));
  let server;
  try {
    server = await startServer({ projectRoot, env: { RSTACK_APPROVAL_TOKEN: 'secret-token' } });
    const url = `${server.baseUrl}/api/approve`;

    // 1: wrong content type is rejected before anything else.
    const noJson = await fetch(url, { method: 'POST', body: 'x=1' });
    assert.equal(noJson.status, 415);

    // 2: JSON without the approval token.
    const noToken = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'x', resolvedBy: 'Maya' }),
    });
    assert.equal(noToken.status, 401);

    // 3: valid token but a foreign Origin (CSRF shape).
    const evilOrigin = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-rstack-approval-token': 'secret-token',
        Origin: 'https://evil.example',
      },
      body: JSON.stringify({ id: 'x', resolvedBy: 'Maya' }),
    });
    assert.equal(evilOrigin.status, 403);

    // 4-10: authenticated requests with a missing id → 400, but every one of
    // them still spends a rate-limit token.
    for (let i = 0; i < 7; i++) {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-rstack-approval-token': 'secret-token' },
        body: JSON.stringify({}),
      });
      assert.equal(r.status, 400, `request ${i + 4} passes the limiter and fails validation`);
    }

    // 11: the bucket is empty.
    const throttled = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-rstack-approval-token': 'secret-token' },
      body: JSON.stringify({}),
    });
    assert.equal(throttled.status, 429);
    const retryAfter = Number(throttled.headers.get('retry-after'));
    assert.ok(Number.isInteger(retryAfter) && retryAfter >= 1, `Retry-After is a positive integer (got ${throttled.headers.get('retry-after')})`);
    const body = await throttled.json();
    assert.equal(body.ok, false);

    // GET endpoints are not throttled by the POST limiter.
    const health = await fetch(`${server.baseUrl}/health`);
    assert.equal(health.status, 200);
  } finally {
    server?.stop();
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('an oversized approval body gets a clean 413 (not a connection reset) and is audited', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-harden-413-'));
  let server;
  try {
    server = await startServer({ projectRoot, env: { RSTACK_APPROVAL_TOKEN: 'secret-token' } });
    const oversized = JSON.stringify({ id: 'x', resolvedBy: 'Maya', pad: 'a'.repeat(70 * 1024) });
    const res = await fetch(`${server.baseUrl}/api/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-rstack-approval-token': 'secret-token' },
      body: oversized,
    });
    // The body exceeds the 64 KB cap: the server must answer 413, not drop the
    // socket. A reset would surface as a fetch TypeError instead of a response.
    assert.equal(res.status, 413, 'oversized body is rejected with a real HTTP 413');
    const entries = await readAuditEntries(projectRoot, { minEntries: 1 });
    assert.ok(
      entries.some((e) => e.outcome === 'denied' && /too large/i.test(e.reason || '')),
      'the oversized attempt is recorded in the audit trail',
    );
  } finally {
    server?.stop();
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('approval audit log records denied and successful attempts as append-only JSONL', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-harden-audit-'));
  let server;
  try {
    const runId = '2026-06-10T08-00-00-audit';
    await seedRunWithBlockedGate(projectRoot, runId);
    server = await startServer({ projectRoot, env: { RSTACK_APPROVAL_TOKEN: 'secret-token' } });

    // Denied attempt: no token.
    const denied = await fetch(`${server.baseUrl}/api/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'whatever', resolvedBy: 'Imposter' }),
    });
    assert.equal(denied.status, 401);

    // Successful attempt: resolve the real pending approval.
    const state = await (await fetch(`${server.baseUrl}/api/state`)).json();
    const approval = state.pendingApprovals.find((item) => item.artifact === 'architecture.md');
    assert.ok(approval, 'fixture exposes a pending approval');

    const success = await fetch(`${server.baseUrl}/api/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-rstack-approval-token': 'secret-token' },
      body: JSON.stringify({ id: approval.id, resolvedBy: 'Manager Maya' }),
    });
    assert.equal(success.status, 200);
    assert.equal((await success.json()).ok, true);

    const entries = await readAuditEntries(projectRoot, { minEntries: 2 });
    assert.ok(entries.length >= 2, `audit log has both attempts (got ${entries.length})`);

    const deniedEntry = entries.find((e) => e.outcome === 'denied');
    assert.ok(deniedEntry, 'denied attempt is audited');
    assert.equal(deniedEntry.decision, 'approved');
    assert.equal(deniedEntry.resolvedBy, null, 'identity is never trusted from an unauthenticated body');
    assert.ok(deniedEntry.ts, 'denied entry is timestamped');
    assert.ok(deniedEntry.remote, 'denied entry records the client address');
    assert.equal(deniedEntry.origin, null);

    const successEntry = entries.find((e) => e.outcome === 'success');
    assert.ok(successEntry, 'successful attempt is audited');
    assert.equal(successEntry.id, approval.id);
    assert.equal(successEntry.decision, 'approved');
    assert.equal(successEntry.resolvedBy, 'Manager Maya');
    assert.ok(successEntry.ts && successEntry.remote, 'success entry carries ts and remote');

    // Append-only: the denied entry written first is still the first line.
    assert.equal(entries[0].outcome, 'denied');
  } finally {
    server?.stop();
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('GET /api/state, /api/run-report, /api/artifact serve ETags and answer If-None-Match with 304', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-harden-etag-'));
  let server;
  try {
    const runId = '2026-06-10T08-00-00-etag';
    await seedRunWithBlockedGate(projectRoot, runId);
    server = await startServer({ projectRoot });

    const endpoints = [
      `${server.baseUrl}/api/state`,
      `${server.baseUrl}/api/run-report?run=${encodeURIComponent(runId)}`,
      `${server.baseUrl}/api/artifact?run=${encodeURIComponent(runId)}&path=plan.md`,
    ];

    // Warm the rollup index: the first /api/state assembles a freshly-parsed
    // run, after which the same run is served from .rstack/index.json in a
    // slimmer shape. That one cold→warm transition legitimately changes the
    // payload; ETag stability is a steady-state guarantee, so prime it once
    // before asserting revalidation.
    await (await fetch(`${server.baseUrl}/api/state`)).json();

    for (const endpoint of endpoints) {
      const first = await fetch(endpoint);
      assert.equal(first.status, 200, `${endpoint} responds 200`);
      const etag = first.headers.get('etag');
      assert.ok(etag, `${endpoint} sends an ETag`);
      await first.json();

      const revalidated = await fetch(endpoint, { headers: { 'If-None-Match': etag } });
      assert.equal(revalidated.status, 304, `${endpoint} revalidates to 304`);
      assert.equal(revalidated.headers.get('etag'), etag, `${endpoint} repeats the ETag on 304`);
      assert.equal(await revalidated.text(), '', `${endpoint} sends no body on 304`);

      const stale = await fetch(endpoint, { headers: { 'If-None-Match': '"stale-etag"' } });
      assert.equal(stale.status, 200, `${endpoint} serves the full body for a stale validator`);
    }

    // Error responses are never cacheable: no ETag on a 404.
    const missing = await fetch(`${server.baseUrl}/api/run-report?run=no-such-run`);
    assert.equal(missing.status, 404);
    assert.equal(missing.headers.get('etag'), null);
  } finally {
    server?.stop();
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('request logging stays off by default and turns on with RSTACK_HTTP_LOG=1', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-harden-log-'));
  let quietServer;
  let loudServer;
  try {
    quietServer = await startServer({ projectRoot });
    await fetch(`${quietServer.baseUrl}/health`);
    await new Promise((r) => setTimeout(r, 200));
    assert.ok(!quietServer.getStdout().includes('[rstack-http]'), 'no request lines without the env flag');

    loudServer = await startServer({ projectRoot, env: { RSTACK_HTTP_LOG: '1' } });
    await fetch(`${loudServer.baseUrl}/health`);
    const deadline = Date.now() + 3000;
    while (!loudServer.getStdout().includes('[rstack-http]') && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    const logged = loudServer.getStdout();
    assert.ok(logged.includes('[rstack-http]'), 'request line appears with RSTACK_HTTP_LOG=1');
    assert.match(logged, /\[rstack-http\] \S+ \S+ GET \/health 200 \d+ms/);
  } finally {
    quietServer?.stop();
    loudServer?.stop();
    rmSync(projectRoot, { recursive: true, force: true });
  }
});
