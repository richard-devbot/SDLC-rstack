/**
 * Generation fencing for withFileLock (#448).
 *
 * A stalled owner whose lock is broken by a successor after the stale timeout
 * must NOT clobber the successor's state when it resumes. An atomic write to
 * the locked file re-verifies the acquisition token immediately before the
 * rename and refuses (LockFenceError) if the lock was taken over — the write
 * is refused, not merely detected after the damage.
 *
 * owner: RStack developed by Richardson Gunde
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { withFileLock, writeJsonAtomic, LockFenceError } from '../src/core/harness/safe-write.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('a REAL stale takeover fences the resumed owner and preserves the successor', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'rstack-fence-real-'));
  const prevStale = process.env.RSTACK_LOCK_STALE_MS;
  process.env.RSTACK_LOCK_STALE_MS = '40'; // small so A goes stale during its barrier wait
  t.after(() => {
    if (prevStale === undefined) delete process.env.RSTACK_LOCK_STALE_MS;
    else process.env.RSTACK_LOCK_STALE_MS = prevStale;
    rmSync(dir, { recursive: true, force: true });
  });

  const target = join(dir, 'tasks.json');
  let releaseA;
  const aBarrier = new Promise((r) => { releaseA = r; });

  // A acquires the lock via the real open('wx') path, then stalls on a barrier
  // with NO heartbeat, so the lock genuinely goes stale on disk.
  const aPromise = withFileLock(target, async () => {
    await aBarrier;
    await writeJsonAtomic(target, { holder: 'A' }); // must be fenced
  }, { heartbeatMs: 0 });

  await sleep(90); // A holds it; lock mtime is now older than staleMs

  // B is a real second caller: open('wx') → EEXIST → breakStaleLock → acquires.
  await withFileLock(target, async () => {
    await writeJsonAtomic(target, { holder: 'B' });
  });

  releaseA(); // A resumes and attempts its now-illegitimate write
  await assert.rejects(aPromise, (err) => err instanceof LockFenceError && err.code === 'ELOCKFENCE');
  assert.deepEqual(JSON.parse(readFileSync(target, 'utf8')), { holder: 'B' }, 'successor state preserved');
});

test('a live owner (token unchanged) writes normally — no false fence', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rstack-fence-live-'));
  try {
    const target = join(dir, 'metrics.json');
    const result = await withFileLock(target, async () => {
      await writeJsonAtomic(target, { cost: 1.23 });
      return 'ok';
    });
    assert.equal(result, 'ok');
    assert.deepEqual(JSON.parse(readFileSync(target, 'utf8')), { cost: 1.23 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the fence resolves equivalent paths — a ./-spelled write is still guarded', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'rstack-fence-path-'));
  const prevStale = process.env.RSTACK_LOCK_STALE_MS;
  t.after(() => {
    if (prevStale === undefined) delete process.env.RSTACK_LOCK_STALE_MS;
    else process.env.RSTACK_LOCK_STALE_MS = prevStale;
    rmSync(dir, { recursive: true, force: true });
  });
  const target = join(dir, 'tasks.json');
  const equivalent = join(dir, '.', 'tasks.json'); // same file, different spelling
  writeFileSync(target, JSON.stringify({ holder: 'successor' }));

  await assert.rejects(
    withFileLock(target, async () => {
      // Simulate takeover, then write via the EQUIVALENT path — must still fence.
      writeFileSync(`${target}.lock`, JSON.stringify({ pid: 999, token: 'successor-token' }));
      await writeJsonAtomic(equivalent, { holder: 'stale-owner' });
    }),
    (err) => err instanceof LockFenceError,
  );
  assert.deepEqual(JSON.parse(readFileSync(target, 'utf8')), { holder: 'successor' }, 'equivalent-path write refused');
});

test('the fence only guards the locked file — a write to another file is never fenced', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rstack-fence-other-'));
  try {
    const locked = join(dir, 'events.jsonl');
    const other = join(dir, 'sidecar.json');
    // A write to a DIFFERENT file inside the lock proceeds unfenced. No release
    // exception is expected, so we await directly (no error suppression).
    await withFileLock(locked, async () => {
      await writeJsonAtomic(other, { wrote: true });
    });
    assert.ok(existsSync(other) && JSON.parse(readFileSync(other, 'utf8')).wrote === true, 'non-locked write landed');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
