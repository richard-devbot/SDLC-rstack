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

test('a taken-over owner\'s write to the locked file is refused, preserving the successor', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rstack-fence-'));
  try {
    const target = join(dir, 'tasks.json');
    writeJsonAtomicSync(target, { holder: 'successor', v: 2 });

    await assert.rejects(
      withFileLock(target, async () => {
        // Simulate a stale takeover mid-critical-section: a successor broke our
        // lock and now holds it under a different token, and wrote v2 (above).
        writeFileSync(`${target}.lock`, JSON.stringify({ pid: 999999, token: 'successor-token' }));
        // Our resumed write MUST be refused rather than clobber the successor.
        await writeJsonAtomic(target, { holder: 'stale-owner', v: 1 });
      }),
      (err) => err instanceof LockFenceError && err.code === 'ELOCKFENCE',
    );

    assert.deepEqual(JSON.parse(readFileSync(target, 'utf8')), { holder: 'successor', v: 2 }, 'successor state preserved');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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

test('the fence only guards the locked file — a write to another file is never fenced', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rstack-fence-other-'));
  try {
    const locked = join(dir, 'events.jsonl');
    const other = join(dir, 'sidecar.json');
    await withFileLock(locked, async () => {
      // Even if THIS lock were taken over, a write to a DIFFERENT file proceeds.
      writeFileSync(`${locked}.lock`, JSON.stringify({ pid: 1, token: 'someone-else' }));
      await writeJsonAtomic(other, { wrote: true });
    }).catch((err) => {
      // The release path may warn about the taken-over lock; that's fine.
      if (err instanceof LockFenceError) throw err; // but a fence here would be a bug
    });
    assert.ok(existsSync(other) && JSON.parse(readFileSync(other, 'utf8')).wrote === true, 'non-locked write landed');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Small sync helper so the "successor" seed doesn't itself run under a lock ctx.
function writeJsonAtomicSync(file, obj) {
  writeFileSync(file, JSON.stringify(obj, null, 2));
}
