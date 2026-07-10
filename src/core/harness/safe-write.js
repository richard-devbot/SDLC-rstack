import { mkdir, open, readdir, readFile, rename, rm, stat, utimes } from 'node:fs/promises';
import { dirname, join } from 'node:path';

// owner: RStack developed by Richardson Gunde

/**
 * Crash-safe writes + advisory locking for shared run-state files
 * (metrics.json, tasks.json, approvals.json — issue #81).
 *
 * Two failure modes this module closes:
 *   1. Torn writes — a process dies (or two race) mid-writeFile and a reader
 *      sees truncated JSON. Fixed by writing `${file}.tmp.${pid}` + fsync +
 *      atomic rename.
 *   2. Lost updates — two read-modify-write cycles interleave and the second
 *      write silently drops the first. Fixed by an advisory `${file}.lock`
 *      lockfile (O_EXCL create) held across the whole read-modify-write.
 */

const DEFAULT_LOCK_STALE_MS = 10_000;
const LOCK_RETRY_DELAY_MS = 25;
const TMP_ORPHAN_MS = 60_000;

// How long a lock may sit un-refreshed before a waiter treats it as a crashed
// owner and breaks it. Read at CALL time (not module load) so it stays
// overridable via RSTACK_LOCK_STALE_MS. The heartbeat below refreshes well
// within this window so a long-but-live critical section is never stolen (#287).
function lockStaleMs() {
  const raw = Number(process.env.RSTACK_LOCK_STALE_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_LOCK_STALE_MS;
}

// Refresh cadence: a third of the stale window keeps the lock comfortably fresh
// even under GC pauses / slow I/O. Overridable for fast tests.
function lockHeartbeatMs() {
  const raw = Number(process.env.RSTACK_LOCK_HEARTBEAT_MS);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return Math.max(1, Math.floor(lockStaleMs() / 3));
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

// Monotonic per-process sequence: two concurrent writers in the SAME process
// share a pid, so pid alone would make them scribble over one tmp file.
let tmpSeq = 0;

// Monotonic per-process lock-acquisition sequence: combined with the pid it
// forms a unique owner token per acquisition, so the release path can verify a
// lock is still OURS before deleting it (#287).
let lockSeq = 0;

/**
 * Write `data` to `file` atomically: tmp file → fsync → rename.
 * Readers never observe a partially written file.
 */
export async function writeFileAtomic(file, data) {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.tmp.${process.pid}.${tmpSeq++}`;
  let handle;
  try {
    handle = await open(tmp, 'w');
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle?.close();
  }
  try {
    await rename(tmp, file);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

/** JSON.stringify(obj, null, 2) written atomically. Returns obj. */
export async function writeJsonAtomic(file, obj) {
  await writeFileAtomic(file, JSON.stringify(obj, null, 2));
  return obj;
}

// A stale lock (owner crashed mid-update) is broken by *renaming* it to a
// pid-unique name first — rename is atomic, so when several waiters detect
// the same stale lock only one wins the takeover; the rest loop and retry.
async function breakStaleLock(lockPath) {
  let info;
  try {
    info = await stat(lockPath);
  } catch {
    return true; // vanished — owner released it, retry acquisition now
  }
  if (Date.now() - info.mtimeMs < lockStaleMs()) return false;
  const takeover = `${lockPath}.stale.${process.pid}`;
  try {
    await rename(lockPath, takeover);
  } catch {
    return true; // another waiter broke it first — retry acquisition
  }
  await rm(takeover, { force: true }).catch(() => {});
  console.warn(`[rstack] broke stale lock ${lockPath} (held > ${lockStaleMs()}ms)`);
  return true;
}

// Release a lock only if it is still OURS (#287). If a mis-detected-stale
// takeover replaced it with a successor's lock, deleting it here would admit a
// third writer — so read the token first and skip the delete on any mismatch
// (or if the file is already gone / unparseable).
async function releaseIfOwned(lockPath, token) {
  try {
    const parsed = JSON.parse(await readFile(lockPath, 'utf8'));
    if (parsed?.token !== token) return; // taken over — not ours to remove
  } catch {
    return; // gone or unparseable — nothing of ours to remove
  }
  await rm(lockPath, { force: true }).catch(() => {});
}

/**
 * Run `fn` while holding an advisory `${file}.lock`. The lock file is created
 * with O_EXCL (flag 'wx') and carries a unique `{ pid, token, ts }` owner
 * stamp. While `fn` runs, a heartbeat refreshes the lock's mtime so a long but
 * LIVE critical section is never mistaken for a crashed owner and broken by a
 * waiter (#287); the release only removes the lock if it is still ours. Locks
 * left un-refreshed past the stale window (default 10s) are broken and logged.
 */
export async function withFileLock(file, fn) {
  const lockPath = `${file}.lock`;
  await mkdir(dirname(file), { recursive: true });
  for (;;) {
    let handle;
    try {
      handle = await open(lockPath, 'wx');
    } catch (err) {
      if (err?.code !== 'EEXIST') throw err;
      if (!(await breakStaleLock(lockPath))) await sleep(LOCK_RETRY_DELAY_MS);
      continue;
    }
    const token = `${process.pid}.${lockSeq++}`;
    try {
      try {
        await handle.writeFile(JSON.stringify({ pid: process.pid, token, ts: new Date().toISOString() }));
      } finally {
        await handle.close();
      }
      // Heartbeat: keep the lock's mtime fresh so a concurrent waiter never
      // breaks a live owner mid-work. Unref'd so it can't keep the process
      // alive; errors (e.g. a genuine takeover after event-loop starvation)
      // are ignored — releaseIfOwned is the authoritative guard.
      const heartbeat = setInterval(() => {
        const now = new Date();
        utimes(lockPath, now, now).catch(() => {});
      }, lockHeartbeatMs());
      heartbeat.unref?.();
      try {
        return await fn();
      } finally {
        clearInterval(heartbeat);
      }
    } finally {
      await releaseIfOwned(lockPath, token);
    }
  }
}

/**
 * Remove orphaned `*.tmp.<pid>` files left behind by a crashed writer.
 * Only files older than `olderThanMs` are removed so an in-flight atomic
 * write is never disturbed. Returns the number of files removed.
 */
export async function cleanOrphanedTmpFiles(dir, { olderThanMs = TMP_ORPHAN_MS } = {}) {
  let entries;
  try {
    entries = await readdir(dir);
  } catch {
    return 0;
  }
  let removed = 0;
  for (const name of entries) {
    if (!/\.tmp\.\d+(?:\.\d+)?$/.test(name)) continue;
    const path = join(dir, name);
    try {
      const info = await stat(path);
      if (Date.now() - info.mtimeMs < olderThanMs) continue;
      await rm(path, { force: true });
      removed += 1;
    } catch {
      // raced with the owning writer — leave it alone
    }
  }
  return removed;
}
