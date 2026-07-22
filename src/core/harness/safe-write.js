import { mkdir, open, readdir, readFile, rename, rm, stat, utimes } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';

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

// Staleness threshold, resolved per call (#287): env-tunable so slow
// environments (network mounts, Windows AV scans, loaded CI) can raise it —
// and so tests can exercise the takeover path without 10-second sleeps.
function lockStaleMs(env = process.env) {
  const raw = Number(env.RSTACK_LOCK_STALE_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_LOCK_STALE_MS;
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

// Generation fence (#448): withFileLock runs its critical section inside this
// context carrying the lock path + the acquisition token. An atomic write to
// the very file that context guards re-verifies the on-disk token IMMEDIATELY
// before the rename — so a stalled owner whose lock was stolen after a stale
// takeover cannot clobber the successor's state (the write is refused, not just
// detected after the fact). Propagates across awaits; no caller changes.
const lockContext = new AsyncLocalStorage();

// Reads the current lock token. Throws on unreadable/corrupt lock state so the
// fence can fail closed WITH the cause attached (a takeover and a corrupt lock
// are different failures — callers must be able to tell them apart).
async function readLockToken(lockPath) {
  return JSON.parse(await readFile(lockPath, 'utf8'))?.token ?? null;
}

// Thrown when a fenced write is refused because the lock was taken over (or its
// state became unreadable) mid-critical-section. Carries the underlying cause
// when the refusal was driven by an I/O/parse failure rather than a plain
// token mismatch. Callers can treat it as "retry the whole locked op".
export class LockFenceError extends Error {
  constructor(file, options = {}) {
    super(`[rstack] write to ${file} refused: this process no longer holds the lock (taken over after a stale timeout, or the lock became unreadable). The successor's state is preserved; retry the locked operation.`, options);
    this.name = 'LockFenceError';
    this.code = 'ELOCKFENCE';
  }
}

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
  // Generation fence (#448): if we are inside the withFileLock section that
  // guards THIS file, confirm we still own the lock right before committing. A
  // stalled owner whose lock was stolen aborts here instead of clobbering the
  // successor. Fires only for a write to the locked file itself (the contended
  // read-modify-write case); identity is compared on RESOLVED paths so an
  // equivalent spelling (./, trailing slash, ..) can't slip past the fence.
  // NOTE: the check and the rename are two syscalls, so a microsecond window
  // remains where a takeover between them could still race — a fully atomic
  // commit needs an OS-level lease/CAS, out of scope for an advisory-lock
  // helper. This collapses the original seconds-wide window (the whole critical
  // section) to that irreducible gap and fails closed on unreadable lock state.
  const ctx = lockContext.getStore();
  if (ctx && ctx.guardedFile === resolve(file)) {
    let currentToken;
    try {
      currentToken = await readLockToken(ctx.lockPath);
    } catch (cause) {
      await rm(tmp, { force: true }).catch(() => {});
      throw new LockFenceError(file, { cause });
    }
    if (currentToken !== ctx.token) {
      await rm(tmp, { force: true }).catch(() => {});
      throw new LockFenceError(file);
    }
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
async function breakStaleLock(lockPath, staleMs) {
  let info;
  try {
    info = await stat(lockPath);
  } catch {
    return true; // vanished — owner released it, retry acquisition now
  }
  if (Date.now() - info.mtimeMs < staleMs) return false;
  const takeover = `${lockPath}.stale.${process.pid}`;
  try {
    await rename(lockPath, takeover);
  } catch {
    return true; // another waiter broke it first — retry acquisition
  }
  await rm(takeover, { force: true }).catch(() => {});
  console.warn(`[rstack] broke stale lock ${lockPath} (held > ${staleMs}ms)`);
  return true;
}

// Monotonic token counter — combined with pid it uniquely names one
// acquisition, so release and heartbeat can verify the lock is still OURS.
let lockSeq = 0;

/**
 * Run `fn` while holding an advisory `${file}.lock`. The lock file is created
 * with O_EXCL (flag 'wx') and contains `{ pid, ts, token }`. Locks whose
 * mtime is older than RSTACK_LOCK_STALE_MS (default 10s) are considered
 * stale, broken, and logged.
 *
 * #287 hardening — two defects closed:
 *   1. HEARTBEAT: the lock's mtime is refreshed at ~staleMs/3 while `fn`
 *      runs (verifying the token first), so a long-but-alive critical
 *      section is never mistaken for a crashed owner and stolen.
 *   2. OWNER-CHECKED RELEASE: the finally no longer deletes whatever lock
 *      file exists — it deletes ONLY a lock still carrying this
 *      acquisition's token. Without this, an owner whose lock was broken
 *      (genuine freeze > staleMs) would delete the NEW holder's lock and
 *      admit a third writer.
 *
 * opts.heartbeatMs: override the interval; 0 disables (tests use this to
 * exercise the takeover path deterministically).
 */
export async function withFileLock(file, fn, opts = {}) {
  const lockPath = `${file}.lock`;
  const staleMs = lockStaleMs();
  await mkdir(dirname(file), { recursive: true });
  for (;;) {
    let handle;
    try {
      handle = await open(lockPath, 'wx');
    } catch (err) {
      if (err?.code !== 'EEXIST') throw err;
      if (!(await breakStaleLock(lockPath, staleMs))) await sleep(LOCK_RETRY_DELAY_MS);
      continue;
    }
    const token = `${process.pid}.${Date.now()}.${lockSeq++}`;
    const heartbeatMs = opts.heartbeatMs ?? Math.max(25, Math.floor(staleMs / 3));
    let heartbeat;
    try {
      try {
        await handle.writeFile(JSON.stringify({ pid: process.pid, ts: new Date().toISOString(), token }));
      } finally {
        await handle.close();
      }
      if (heartbeatMs > 0) {
        heartbeat = setInterval(async () => {
          try {
            const current = JSON.parse(await readFile(lockPath, 'utf8'));
            if (current?.token === token) {
              const now = new Date();
              await utimes(lockPath, now, now);
            } else {
              clearInterval(heartbeat); // taken over — never freshen a successor's lock
            }
          } catch { /* lock unreadable/gone — the release path handles it */ }
        }, heartbeatMs);
        heartbeat.unref?.();
      }
      // Run the critical section inside the fence context so an atomic write to
      // this file re-verifies our token before committing (#448). guardedFile is
      // the RESOLVED target so the fence can't be bypassed by an equivalent path.
      return await lockContext.run({ lockPath, token, guardedFile: resolve(file) }, () => fn());
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      try {
        const current = JSON.parse(await readFile(lockPath, 'utf8'));
        if (current?.token === token) {
          await rm(lockPath, { force: true });
        } else {
          console.warn(`[rstack] lock ${lockPath} was taken over during a long critical section — leaving the new holder's lock in place`);
        }
      } catch { /* already released or broken — nothing of ours to remove */ }
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
