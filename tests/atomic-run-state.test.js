/**
 * Atomic writes + advisory locking for run state files (issue #81):
 *   1. concurrent read-modify-write cycles all land (no lost updates)
 *   2. truncated/torn files recover instead of poisoning the run
 *   3. stale locks (crashed owner) are broken after 10s
 *   4. orphaned .tmp files are ignored by readers and swept when old
 *
 * owner: RStack developed by Richardson Gunde
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  cleanOrphanedTmpFiles,
  withFileLock,
  writeJsonAtomic,
} from '../src/core/harness/safe-write.js';
import { updateRunMetrics } from '../src/core/harness/run-state.js';
import { appendRunApproval } from '../src/core/tracker/approvals.js';

function tempDir(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

test('writeJsonAtomic leaves valid JSON and no tmp residue', async () => {
  const dir = tempDir('rstack-atomic-');
  const file = join(dir, 'metrics.json');

  await writeJsonAtomic(file, { hello: 'world' });
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { hello: 'world' });
  assert.deepEqual(readdirSync(dir), ['metrics.json'], 'no tmp or lock files remain');

  rmSync(dir, { recursive: true, force: true });
});

test('withFileLock serializes interleaved read-modify-write — both updates land', async () => {
  const dir = tempDir('rstack-atomic-');
  const file = join(dir, 'counter.json');
  await writeJsonAtomic(file, { count: 0 });

  // Without locking these 20 increments interleave and most are lost.
  const bump = () => withFileLock(file, async () => {
    const current = JSON.parse(readFileSync(file, 'utf8'));
    // Yield so another waiter would interleave here without the lock.
    await new Promise((done) => setTimeout(done, 1));
    await writeJsonAtomic(file, { count: current.count + 1 });
  });
  await Promise.all(Array.from({ length: 20 }, bump));

  assert.equal(JSON.parse(readFileSync(file, 'utf8')).count, 20, 'every update landed');
  assert.equal(existsSync(`${file}.lock`), false, 'lock released');

  rmSync(dir, { recursive: true, force: true });
});

test('concurrent updateRunMetrics calls both land', async () => {
  const runDir = tempDir('rstack-atomic-run-');

  await Promise.all([
    updateRunMetrics(runDir, { stage_status: { '02-requirements': 'PASS' }, stage_elapsed_ms: { '02-requirements': 1200 } }),
    updateRunMetrics(runDir, { stage_status: { '07-code': 'PASS' }, stage_elapsed_ms: { '07-code': 3400 } }),
  ]);

  const metrics = JSON.parse(readFileSync(join(runDir, 'metrics.json'), 'utf8'));
  assert.equal(metrics.stage_status['02-requirements'], 'PASS');
  assert.equal(metrics.stage_status['07-code'], 'PASS');
  assert.equal(metrics.stage_elapsed_ms['02-requirements'], 1200);
  assert.equal(metrics.stage_elapsed_ms['07-code'], 3400);

  rmSync(runDir, { recursive: true, force: true });
});

test('concurrent appendRunApproval calls both land', async () => {
  const projectRoot = tempDir('rstack-atomic-appr-');
  const runDir = join(projectRoot, '.rstack', 'runs', 'run-1');
  await writeJsonAtomic(join(runDir, 'manifest.json'), { run_id: 'run-1' });

  await Promise.all([
    appendRunApproval(projectRoot, 'run-1', { artifact: 'plan.md', status: 'APPROVED', approver: 'a' }),
    appendRunApproval(projectRoot, 'run-1', { artifact: 'architecture.md', status: 'APPROVED', approver: 'b' }),
  ]);

  const approvals = JSON.parse(readFileSync(join(runDir, 'approvals.json'), 'utf8'));
  assert.equal(approvals.length, 2, 'neither approval was lost');
  assert.deepEqual(approvals.map((a) => a.artifact).sort(), ['architecture.md', 'plan.md']);

  rmSync(projectRoot, { recursive: true, force: true });
});

test('truncated metrics.json recovers on the next update', async () => {
  const runDir = tempDir('rstack-atomic-trunc-');
  // Simulate a torn write from a crashed legacy writer.
  writeFileSync(join(runDir, 'metrics.json'), '{"cumulative_cost_usd": 1.5, "stage_st');

  const merged = await updateRunMetrics(runDir, { stage_status: { '07-code': 'PASS' } });
  assert.equal(merged.stage_status['07-code'], 'PASS');

  const reread = JSON.parse(readFileSync(join(runDir, 'metrics.json'), 'utf8'));
  assert.equal(reread.stage_status['07-code'], 'PASS', 'file is valid JSON again');

  rmSync(runDir, { recursive: true, force: true });
});

test('a stale lock (older than 10s) is broken and logged', async () => {
  const dir = tempDir('rstack-atomic-stale-');
  const file = join(dir, 'tasks.json');
  const lockPath = `${file}.lock`;

  // A crashed writer left its lock behind 30 seconds ago.
  writeFileSync(lockPath, JSON.stringify({ pid: 999999, ts: new Date(Date.now() - 30_000).toISOString() }));
  const past = new Date(Date.now() - 30_000);
  utimesSync(lockPath, past, past);

  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    const result = await withFileLock(file, async () => 'ran');
    assert.equal(result, 'ran', 'lock acquired despite stale holder');
  } finally {
    console.warn = originalWarn;
  }

  assert.ok(warnings.some((line) => line.includes('stale lock')), 'stale break was logged');
  assert.equal(existsSync(lockPath), false, 'lock released after fn');

  rmSync(dir, { recursive: true, force: true });
});

test('a fresh lock is honored — waiter blocks until release', async () => {
  const dir = tempDir('rstack-atomic-fresh-');
  const file = join(dir, 'tasks.json');

  const order = [];
  // Signal the moment the holder is inside the critical section, so the waiter
  // is only started once the lock is provably held — no timing guess that can
  // race on a slow/contended CI runner.
  let holderEntered;
  const holderEnteredP = new Promise((resolve) => { holderEntered = resolve; });
  const holder = withFileLock(file, async () => {
    order.push('holder-start');
    holderEntered();
    await new Promise((done) => setTimeout(done, 50));
    order.push('holder-end');
  });
  await holderEnteredP;
  const waiter = withFileLock(file, async () => {
    order.push('waiter');
  });
  await Promise.all([holder, waiter]);

  assert.deepEqual(order, ['holder-start', 'holder-end', 'waiter'], 'waiter ran only after release');

  rmSync(dir, { recursive: true, force: true });
});

test('withFileLock releases the lock when fn throws', async () => {
  const dir = tempDir('rstack-atomic-throw-');
  const file = join(dir, 'tasks.json');

  await assert.rejects(withFileLock(file, async () => { throw new Error('boom'); }), /boom/);
  assert.equal(existsSync(`${file}.lock`), false, 'lock released after throw');
  // The file is lockable again immediately.
  assert.equal(await withFileLock(file, async () => 'ok'), 'ok');

  rmSync(dir, { recursive: true, force: true });
});

test('cleanOrphanedTmpFiles sweeps old tmp files, keeps fresh and real ones', async () => {
  const dir = tempDir('rstack-atomic-orphan-');
  writeFileSync(join(dir, 'metrics.json'), '{}');
  writeFileSync(join(dir, 'metrics.json.tmp.12345'), '{"torn":');
  writeFileSync(join(dir, 'metrics.json.tmp.12345.7'), '{"torn":');
  writeFileSync(join(dir, 'tasks.json.tmp.99'), '{"fresh": true}');

  // Age the orphans past the sweep threshold; the third stays fresh.
  const past = new Date(Date.now() - 120_000);
  utimesSync(join(dir, 'metrics.json.tmp.12345'), past, past);
  utimesSync(join(dir, 'metrics.json.tmp.12345.7'), past, past);

  const removed = await cleanOrphanedTmpFiles(dir);
  assert.equal(removed, 2, 'both aged orphans removed');
  assert.deepEqual(readdirSync(dir).sort(), ['metrics.json', 'tasks.json.tmp.99']);

  rmSync(dir, { recursive: true, force: true });
});
