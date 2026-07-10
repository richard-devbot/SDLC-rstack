import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { writeFile, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// owner: RStack developed by Richardson Gunde
//
// #287: two compounding defects let withFileLock break its own mutual
// exclusion — the lock's mtime was written once and never refreshed (any
// critical section longer than the stale threshold was mistaken for a crashed
// owner and stolen), and the finally deleted whatever lock file existed with
// no owner check (a stale-broken owner then deleted the NEW holder's lock,
// admitting a third writer). These tests drive both scenarios with a tiny
// RSTACK_LOCK_STALE_MS so the takeover path runs in milliseconds.

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

test('withFileLock integrity under long critical sections (#287)', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'rstack-lock-287-'));
  const prevStale = process.env.RSTACK_LOCK_STALE_MS;
  process.env.RSTACK_LOCK_STALE_MS = '250';
  const { withFileLock } = await import('../src/core/harness/safe-write.js');
  t.after(() => {
    if (prevStale === undefined) delete process.env.RSTACK_LOCK_STALE_MS;
    else process.env.RSTACK_LOCK_STALE_MS = prevStale;
    rmSync(dir, { recursive: true, force: true });
  });

  await t.test('heartbeat: a slow-but-alive owner is never mistaken for stale and stolen', async () => {
    const file = join(dir, 'heartbeat.json');
    const log = [];
    const holder = withFileLock(file, async () => {
      log.push(['A-start', Date.now()]);
      await sleep(900); // 3.6x the stale threshold — pre-fix this lock was stolen at ~250ms
      log.push(['A-end', Date.now()]);
    });
    await sleep(50); // ensure A acquires first
    const waiter = withFileLock(file, async () => {
      log.push(['B-start', Date.now()]);
    });
    await Promise.all([holder, waiter]);
    const at = (name) => log.find(([entry]) => entry === name)[1];
    assert.ok(at('B-start') >= at('A-end'),
      `mutual exclusion held: B started at ${at('B-start')}, A ended at ${at('A-end')} — the live owner's lock must not be stolen`);
  });

  await t.test('owner-checked release: a stale-broken owner never deletes the new holder lock', async () => {
    const file = join(dir, 'takeover.json');
    const log = [];
    // A: heartbeat DISABLED so its lock genuinely goes stale mid-section —
    // the deterministic stand-in for a frozen process (SIGSTOP, GC pause).
    const frozen = withFileLock(file, async () => {
      log.push(['A-start', Date.now()]);
      await sleep(800);
      log.push(['A-end', Date.now()]);
    }, { heartbeatMs: 0 });
    await sleep(50);
    // B: steals A's stale lock at ~250ms and holds well past A's release.
    const successor = withFileLock(file, async () => {
      log.push(['B-start', Date.now()]);
      await sleep(800);
      log.push(['B-end', Date.now()]);
    });
    await sleep(900); // A's finally has run by now (fn ended at ~850)
    // C: pre-fix, A's unconditional rm deleted B's lock at ~850ms and C
    // acquired immediately, overlapping B. Post-fix, C must wait for B.
    const third = withFileLock(file, async () => {
      log.push(['C-start', Date.now()]);
    });
    await Promise.all([frozen, successor, third]);
    const at = (name) => log.find(([entry]) => entry === name)[1];
    assert.ok(at('B-start') < at('A-end'), 'sanity: the takeover really happened while A was frozen');
    assert.ok(at('C-start') >= at('B-end'),
      `third writer admitted: C started at ${at('C-start')} but B ended at ${at('B-end')} — A must not delete B's lock`);
  });

  await t.test('crashed-owner recovery still works: a genuinely dead lock is broken promptly', async () => {
    const file = join(dir, 'crashed.json');
    const lockPath = `${file}.lock`;
    await writeFile(lockPath, JSON.stringify({ pid: 999999, ts: new Date(0).toISOString(), token: 'dead.0.0' }));
    const past = new Date(Date.now() - 60_000);
    await utimes(lockPath, past, past);
    const start = Date.now();
    await withFileLock(file, async () => {});
    assert.ok(Date.now() - start < 2000, 'stale lock from a dead owner is broken without waiting forever');
    assert.ok(!existsSync(lockPath), 'the lock is released after the section');
  });
});
