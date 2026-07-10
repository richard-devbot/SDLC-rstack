// owner: RStack developed by Richardson Gunde

import { existsSync, readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { writeJsonAtomic } from './safe-write.js';

export function rstackStateDir(projectRoot) {
  return resolve(process.env.RSTACK_STATE_DIR || join(projectRoot, '.rstack'));
}

export function runDirectory(projectRoot, runId) {
  return join(rstackStateDir(projectRoot), 'runs', runId);
}

export async function latestRunId(projectRoot) {
  const runsDir = join(rstackStateDir(projectRoot), 'runs');
  if (!existsSync(runsDir)) return undefined;
  const entries = await readdir(runsDir, { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().at(-1);
}

const RUN_ID_REGEX = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

// --- session pin (#289) ------------------------------------------------------
// The bridge runs one process per tool call, so the extension's in-memory
// sessionRunId never survives to the next call — every no-run_id tool call
// silently fell back to latestRunId(), the exact cross-run misrouting #98
// forbids (a destructive-action approval could land on the newest run instead
// of the one this session started). The pin file persists "the run this
// project most recently started" across processes: every run creator
// (sdlc_start, adopt) writes it, resolvers consult it before any
// newest-directory fallback, and a pin whose run directory no longer exists
// (archived/deleted) is ignored rather than trusted.

export function sessionPinPath(projectRoot) {
  return join(rstackStateDir(projectRoot), 'session.json');
}

export async function writeSessionPin(projectRoot, runId) {
  if (!runId || !RUN_ID_REGEX.test(String(runId))) return null;
  const pin = { run_id: runId, ts: new Date().toISOString(), pid: process.pid };
  // Best-effort: a failed pin write must never fail run creation — the
  // resolvers fall back exactly as before the pin existed.
  try {
    await writeJsonAtomic(sessionPinPath(projectRoot), pin);
    return pin;
  } catch {
    return null;
  }
}

/** Sync read: the pinned run id, or undefined when absent/unsafe/stale. */
export function readSessionPin(projectRoot) {
  try {
    const pin = JSON.parse(readFileSync(sessionPinPath(projectRoot), 'utf8'));
    const runId = pin?.run_id;
    if (typeof runId !== 'string' || !RUN_ID_REGEX.test(runId)) return undefined;
    // A pin pointing at a run that no longer exists (archived, deleted) is
    // stale — ignore it instead of resolving tools into a ghost run.
    return existsSync(runDirectory(projectRoot, runId)) ? runId : undefined;
  } catch {
    return undefined;
  }
}

export async function resolveRunId(projectRoot, runId) {
  if (runId && !RUN_ID_REGEX.test(String(runId))) {
    throw new Error(`Invalid run id "${runId}". Run ids may only contain letters, digits, dots, dashes, and underscores.`);
  }
  // Resolution order (#289): explicit id → session pin → newest directory.
  // The pin and the newest run coincide in single-session use (every creator
  // writes the pin); they diverge exactly when a second session created a
  // newer run — the case where "newest" is the wrong default.
  const selected = runId || readSessionPin(projectRoot) || await latestRunId(projectRoot);
  if (!selected) throw new Error('No RStack run found. Start one with sdlc_start first.');
  return selected;
}
