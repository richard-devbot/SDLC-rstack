import { mkdir, open, readdir, rename, rm, stat } from 'node:fs/promises';
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

const LOCK_STALE_MS = 10_000;
const LOCK_RETRY_DELAY_MS = 25;
const TMP_ORPHAN_MS = 60_000;

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

// Monotonic per-process sequence: two concurrent writers in the SAME process
// share a pid, so pid alone would make them scribble over one tmp file.
let tmpSeq = 0;

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
  if (Date.now() - info.mtimeMs < LOCK_STALE_MS) return false;
  const takeover = `${lockPath}.stale.${process.pid}`;
  try {
    await rename(lockPath, takeover);
  } catch {
    return true; // another waiter broke it first — retry acquisition
  }
  await rm(takeover, { force: true }).catch(() => {});
  console.warn(`[rstack] broke stale lock ${lockPath} (held > ${LOCK_STALE_MS}ms)`);
  return true;
}

/**
 * Run `fn` while holding an advisory `${file}.lock`. The lock file is created
 * with O_EXCL (flag 'wx') and contains `{ pid, ts }` for debugging. Locks not
 * released within 10s are considered stale, broken, and logged.
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
    try {
      try {
        await handle.writeFile(JSON.stringify({ pid: process.pid, ts: new Date().toISOString() }));
      } finally {
        await handle.close();
      }
      return await fn();
    } finally {
      await rm(lockPath, { force: true }).catch(() => {});
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
