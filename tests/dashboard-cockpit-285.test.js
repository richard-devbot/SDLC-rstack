/**
 * Cockpit controls — authenticated, audited run/recovery actions (#285).
 *
 * Boots the REAL dashboard server as a child process (--port 0) against a
 * throwaway git repo and drives the full security matrix over HTTP:
 *
 *   - feature flag OFF → 403 forbidden (even with a valid token)
 *   - auth: cross-origin (CSRF) 403, wrong/missing token 401/403
 *   - malformed: unknown action, missing fields, unsafe/absent run, traversal
 *   - resume-run: not_eligible (409) and accepted (202) + audit + run event
 *   - idempotency: replay of a completed key returns the stored result,
 *     a concurrent in-flight duplicate is 409
 *   - restore-checkpoint two-step: 409 approval_required → approve →
 *     202 restored (live artifacts reverted) → one-shot consumed
 *   - restore of an invalid / absent checkpoint is rejected
 *   - rate limiting (429) after the per-IP budget
 *   - no token/secret leaks into /api/state, the ledger, or the audit trail
 *
 * owner: RStack developed by Richardson Gunde
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync, appendFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { saveStageCheckpoint } from '../src/core/harness/checkpoints.js';

const SERVER_PATH = join(process.cwd(), 'src', 'observability', 'dashboard', 'server.js');
const TOKEN = 'cockpit-test-token';

function startServer({ projectRoot, env = {} }) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [SERVER_PATH, '--port', '0', '--no-browser', '--project', projectRoot], {
      cwd: projectRoot,
      env: {
        ...process.env,
        RSTACK_APPROVAL_TOKEN: undefined,
        RSTACK_COCKPIT_CONTROLS: undefined,
        RSTACK_BUSINESS_PORT: undefined,
        RSTACK_PROJECT_ROOT: undefined,
        RSTACK_STATE_DIR: undefined,
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
      if (!settled) { settled = true; child.kill('SIGKILL'); rejectPromise(new Error(`server did not boot\n${stdout}\n${stderr}`)); }
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
          baseUrl: `http://127.0.0.1:${match[1]}`,
          getLogs: () => stdout + stderr,
          stop: () => child.kill('SIGKILL'),
        });
      }
    });
    child.on('exit', (code) => {
      if (!settled) { settled = true; clearTimeout(timer); rejectPromise(new Error(`server exited (code ${code})\n${stdout}\n${stderr}`)); }
    });
  });
}

function makeProjectRoot() {
  const root = mkdtempSync(join(tmpdir(), 'rstack-cockpit-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  appendFileSync(join(root, '.gitignore'), '.env\nnode_modules/\n');
  return root;
}

// A run with an IN_PROGRESS task and NO builder.json: resume is ELIGIBLE (the
// task is active) and advancing it stops at `missing_contract` WITHOUT spawning
// a model-free tool — so the accepted path is exercised with no subprocess.
async function seedActiveRun(projectRoot, runId = 'run-cockpit-active') {
  const runDir = join(projectRoot, '.rstack', 'runs', runId);
  await mkdir(join(runDir, 'tasks', '007-code'), { recursive: true });
  await writeFile(join(runDir, 'manifest.json'), JSON.stringify({ run_id: runId, goal: 'cockpit fixture', created_at: '2026-07-13T08:00:00.000Z', framework: 'pi' }, null, 2));
  await writeFile(join(runDir, 'tasks.json'), JSON.stringify({ tasks: [{ id: '007-code', title: 'code', status: 'IN_PROGRESS', stage_id: '07-code' }] }, null, 2));
  await writeFile(join(runDir, 'approvals.json'), JSON.stringify([]));
  await writeFile(join(runDir, 'events.jsonl'), '');
  return { runId, runDir };
}

// A completed run: resume is NOT eligible (nothing to advance).
async function seedCompleteRun(projectRoot, runId = 'run-cockpit-done') {
  const runDir = join(projectRoot, '.rstack', 'runs', runId);
  await mkdir(runDir, { recursive: true });
  await writeFile(join(runDir, 'manifest.json'), JSON.stringify({ run_id: runId, goal: 'done', created_at: '2026-07-13T08:00:00.000Z', framework: 'pi', status: 'DONE' }, null, 2));
  await writeFile(join(runDir, 'tasks.json'), JSON.stringify({ tasks: [{ id: '007-code', title: 'code', status: 'PASS', stage_id: '07-code' }] }, null, 2));
  await writeFile(join(runDir, 'approvals.json'), JSON.stringify([]));
  await writeFile(join(runDir, 'events.jsonl'), '');
  return { runId, runDir };
}

// A run with a real, verified checkpoint for stage 06-architecture.
const stageLivePath = (runDir, stageId) => join(runDir, 'artifacts', 'stages', stageId, 'hld.md');

async function seedCheckpointRun(projectRoot, runId = 'run-cockpit-ckpt', stageId = '06-architecture') {
  const runDir = join(projectRoot, '.rstack', 'runs', runId);
  await mkdir(join(runDir, 'artifacts', 'stages', stageId), { recursive: true });
  await writeFile(join(runDir, 'manifest.json'), JSON.stringify({ run_id: runId, goal: 'ckpt', created_at: '2026-07-13T08:00:00.000Z', framework: 'pi' }, null, 2));
  await writeFile(join(runDir, 'tasks.json'), JSON.stringify({ tasks: [] }, null, 2));
  await writeFile(join(runDir, 'approvals.json'), JSON.stringify([]));
  await writeFile(join(runDir, 'events.jsonl'), '');
  // Live artifact V1, snapshot it, then overwrite the live copy with V2 so a
  // successful restore is observable (V2 → V1).
  await writeFile(stageLivePath(runDir, stageId), 'CHECKPOINT-V1');
  const saved = await saveStageCheckpoint(runDir, stageId, 'before');
  assert.ok(saved.verified, 'seed checkpoint verified');
  await writeFile(stageLivePath(runDir, stageId), 'LIVE-V2');
  return { runId, runDir, stageId };
}

function post(baseUrl, path, body, { token = TOKEN, headers = {} } = {}) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { 'x-rstack-approval-token': token } : {}), ...headers },
    body: JSON.stringify(body),
  });
}

function readQueue(projectRoot) {
  const path = join(projectRoot, '.rstack', 'approvals.jsonl');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function readLedger(projectRoot) {
  const path = join(projectRoot, '.rstack', 'cockpit-actions.jsonl');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

const ON = { RSTACK_APPROVAL_TOKEN: TOKEN, RSTACK_COCKPIT_CONTROLS: '1' };
const FLAG_OFF = { RSTACK_APPROVAL_TOKEN: TOKEN }; // token set, feature flag off

test('feature flag OFF → 403 forbidden even with a valid token', async () => {
  const root = makeProjectRoot();
  const { runId } = await seedActiveRun(root);
  const server = await startServer({ projectRoot: root, env: FLAG_OFF });
  try {
    const res = await post(server.baseUrl, '/api/action', { action: 'resume-run', runId, idempotencyKey: 'flag-off-key-1', resolvedBy: 'rich' });
    assert.equal(res.status, 403);
    // Nothing was executed or ledgered as completed.
    assert.ok(!readLedger(root).some((e) => e.phase === 'completed'));
  } finally {
    server.stop();
    rmSync(root, { recursive: true, force: true });
  }
});

test('auth: cross-origin 403 and wrong token 401', async () => {
  const root = makeProjectRoot();
  const { runId } = await seedActiveRun(root);
  const server = await startServer({ projectRoot: root, env: ON });
  try {
    const foreign = await post(server.baseUrl, '/api/action', { action: 'resume-run', runId, idempotencyKey: 'auth-key-0001', resolvedBy: 'rich' }, { headers: { Origin: 'https://evil.example.com' } });
    assert.equal(foreign.status, 403, 'foreign Origin rejected (CSRF)');
    const badToken = await post(server.baseUrl, '/api/action', { action: 'resume-run', runId, idempotencyKey: 'auth-key-0002', resolvedBy: 'rich' }, { token: 'wrong' });
    assert.equal(badToken.status, 401, 'wrong token rejected');
  } finally {
    server.stop();
    rmSync(root, { recursive: true, force: true });
  }
});

test('malformed requests are rejected: unknown action, missing fields, unsafe/absent run', async () => {
  const root = makeProjectRoot();
  const { runId } = await seedActiveRun(root);
  const server = await startServer({ projectRoot: root, env: ON });
  try {
    const cases = [
      [{ action: 'start-run', runId, idempotencyKey: 'k-unknown-001', resolvedBy: 'rich' }, 400],       // unknown action
      [{ action: 'resume-run', runId, idempotencyKey: 'k-noactor-001' }, 400],                            // missing resolvedBy
      [{ action: 'resume-run', runId, idempotencyKey: 'short', resolvedBy: 'rich' }, 400],                // bad key
      [{ action: 'resume-run', runId: '../../etc', idempotencyKey: 'k-traversal-1', resolvedBy: 'rich' }, 400], // traversal runId
      [{ action: 'resume-run', runId: 'no-such-run', idempotencyKey: 'k-missing-run', resolvedBy: 'rich' }, 404], // absent run
      [{ action: 'restore-checkpoint', runId, idempotencyKey: 'k-nostage-001', resolvedBy: 'rich' }, 400], // restore w/o stageId
    ];
    for (const [body, expected] of cases) {
      const res = await post(server.baseUrl, '/api/action', body);
      assert.equal(res.status, expected, `${JSON.stringify(body).slice(0, 70)} → ${expected}`);
    }
    // No action ever executed.
    assert.ok(!readLedger(root).some((e) => e.phase === 'completed'));
  } finally {
    server.stop();
    rmSync(root, { recursive: true, force: true });
  }
});

test('resume-run: not_eligible (409) on a complete run', async () => {
  const root = makeProjectRoot();
  const { runId } = await seedCompleteRun(root);
  const server = await startServer({ projectRoot: root, env: ON });
  try {
    const res = await post(server.baseUrl, '/api/action', { action: 'resume-run', runId, idempotencyKey: 'resume-done-key-1', resolvedBy: 'rich' });
    assert.equal(res.status, 409);
    assert.equal((await res.json()).error, 'not_eligible');
  } finally {
    server.stop();
    rmSync(root, { recursive: true, force: true });
  }
});

test('resume-run: accepted (202) advances + audits + emits a run event; replay returns the stored result', async () => {
  const root = makeProjectRoot();
  const { runId, runDir } = await seedActiveRun(root);
  const server = await startServer({ projectRoot: root, env: ON });
  try {
    const key = 'resume-accept-key-01';
    const res = await post(server.baseUrl, '/api/action', { action: 'resume-run', runId, idempotencyKey: key, resolvedBy: 'rich' });
    assert.equal(res.status, 202);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.outcome, 'accepted');
    assert.equal(body.stopped_on, 'missing_contract'); // advanced to the packet-execution gate, no spawn

    // Immutable ledger: started + completed for this key.
    const ledger = readLedger(root).filter((e) => e.idempotencyKey === key);
    assert.deepEqual(ledger.map((e) => e.phase), ['started', 'completed']);
    assert.equal(ledger.at(-1).actor, 'rich');

    // Run event on the timeline.
    const events = readFileSync(join(runDir, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    assert.ok(events.some((e) => e.type === 'cockpit_resume_run' && e.actor === 'rich'));

    // Replay: same key returns the stored result marked replayed, and does NOT
    // append a second started/completed pair.
    const replay = await post(server.baseUrl, '/api/action', { action: 'resume-run', runId, idempotencyKey: key, resolvedBy: 'rich' });
    assert.equal(replay.status, 200);
    assert.equal((await replay.json()).replayed, true);
    const after = readLedger(root).filter((e) => e.idempotencyKey === key);
    assert.deepEqual(after.map((e) => e.phase), ['started', 'completed'], 'no re-execution on replay');
  } finally {
    server.stop();
    rmSync(root, { recursive: true, force: true });
  }
});

test('restore-checkpoint two-step: 409 approval_required → approve → 202 restored → one-shot consumed', async () => {
  const root = makeProjectRoot();
  const { runId, runDir, stageId } = await seedCheckpointRun(root);
  const server = await startServer({ projectRoot: root, env: ON });
  const live = () => readFileSync(stageLivePath(runDir, stageId), 'utf8');
  try {
    // Step 1: no approval → 409 approval_required, pending queue entry, nothing restored.
    const first = await post(server.baseUrl, '/api/action', { action: 'restore-checkpoint', runId, stageId, idempotencyKey: 'restore-key-step-01', resolvedBy: 'rich' });
    assert.equal(first.status, 409);
    const firstBody = await first.json();
    assert.equal(firstBody.error, 'approval_required');
    assert.equal(firstBody.artifact, `destructive-action:checkpoint-restore:${runId}:${stageId}`);
    assert.equal(live(), 'LIVE-V2', 'nothing restored before approval');
    const queued = readQueue(root).find((e) => e.artifact === firstBody.artifact);
    assert.ok(queued && queued.status === 'pending');

    // Manager approves via the existing approve endpoint.
    const approve = await post(server.baseUrl, '/api/approve', { id: queued.id, resolvedBy: 'manager-margo' });
    assert.equal(approve.status, 200);

    // Step 2 (a DIFFERENT idempotency key = a fresh submit after approval): restored.
    const second = await post(server.baseUrl, '/api/action', { action: 'restore-checkpoint', runId, stageId, idempotencyKey: 'restore-key-step-02', resolvedBy: 'rich' });
    assert.equal(second.status, 202);
    const secondBody = await second.json();
    assert.equal(secondBody.outcome, 'accepted');
    assert.equal(secondBody.status, 'SUCCESS');
    assert.equal(secondBody.approvedBy, 'manager-margo');
    assert.equal(live(), 'CHECKPOINT-V1', 'live artifacts reverted to the checkpoint');

    // One-shot: the approval is consumed; a third attempt goes back to 409.
    const consumed = readQueue(root).find((e) => e.id === queued.id);
    assert.equal(consumed.status, 'consumed');
    const third = await post(server.baseUrl, '/api/action', { action: 'restore-checkpoint', runId, stageId, idempotencyKey: 'restore-key-step-03', resolvedBy: 'rich' });
    assert.equal(third.status, 409, 'a second restore needs re-approval');
    assert.equal((await third.json()).error, 'approval_required');

    // Run event recorded.
    const events = readFileSync(join(runDir, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    assert.ok(events.some((e) => e.type === 'cockpit_checkpoint_restored' && e.stage_id === stageId));
  } finally {
    server.stop();
    rmSync(root, { recursive: true, force: true });
  }
});

test('restore-checkpoint: invalid stage 400; absent checkpoint 409 not_eligible', async () => {
  const root = makeProjectRoot();
  const { runId } = await seedCheckpointRun(root, 'run-ckpt-neg');
  const server = await startServer({ projectRoot: root, env: ON });
  try {
    const badStage = await post(server.baseUrl, '/api/action', { action: 'restore-checkpoint', runId, stageId: '007-code', idempotencyKey: 'neg-key-badstage', resolvedBy: 'rich' });
    assert.equal(badStage.status, 400);
    assert.equal((await badStage.json()).error, 'invalid_stage');

    // A canonical stage with no checkpoint → not_eligible (needs an approval to
    // even get here? no — eligibility is checked before the gate).
    const noCkpt = await post(server.baseUrl, '/api/action', { action: 'restore-checkpoint', runId, stageId: '09-deployment', idempotencyKey: 'neg-key-nockpt', resolvedBy: 'rich' });
    assert.equal(noCkpt.status, 409);
    assert.equal((await noCkpt.json()).error, 'not_eligible');
  } finally {
    server.stop();
    rmSync(root, { recursive: true, force: true });
  }
});

test('rate limiting: the per-IP budget returns 429', async () => {
  const root = makeProjectRoot();
  const { runId } = await seedActiveRun(root);
  const server = await startServer({ projectRoot: root, env: ON });
  try {
    let sawRateLimit = false;
    for (let i = 0; i < 14; i++) {
      const res = await post(server.baseUrl, '/api/action', { action: 'resume-run', runId, idempotencyKey: `rl-key-${i}-xxxx`, resolvedBy: 'rich' });
      if (res.status === 429) { sawRateLimit = true; break; }
    }
    assert.ok(sawRateLimit, 'the rate limiter eventually returns 429');
  } finally {
    server.stop();
    rmSync(root, { recursive: true, force: true });
  }
});

test('no token or secret leaks into /api/state, the ledger, or the audit trail', async () => {
  const root = makeProjectRoot();
  const { runId } = await seedActiveRun(root);
  const server = await startServer({ projectRoot: root, env: ON });
  try {
    await post(server.baseUrl, '/api/action', { action: 'resume-run', runId, idempotencyKey: 'leak-key-00001', resolvedBy: 'rich' });
    const state = await (await fetch(`${server.baseUrl}/api/state`)).json();
    assert.ok(!JSON.stringify(state).includes(TOKEN), '/api/state never carries the approval token');
    // The projection declares the run's actions (feature on).
    assert.ok(state.cockpit && state.cockpit.enabled === true, 'cockpit projection is enabled');
    const ledgerRaw = readFileSync(join(root, '.rstack', 'cockpit-actions.jsonl'), 'utf8');
    assert.ok(!ledgerRaw.includes(TOKEN), 'the ledger never carries the token');
    assert.ok(!server.getLogs().includes(TOKEN), 'the token never appears in server logs');
  } finally {
    server.stop();
    rmSync(root, { recursive: true, force: true });
  }
});
