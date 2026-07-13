// owner: RStack developed by Richardson Gunde
//
// Cockpit controls (#285): the shared contract for authenticated, audited
// run/recovery actions invoked from the Business Hub. This module is the
// SINGLE source of truth for:
//   - the feature flag (OFF by default, fails closed)
//   - the action catalogue, risk levels, and audit event names
//   - server-declared eligibility, derived from the SAME pipeline rollup the
//     CLI reads so a UI-declared action can never drift from what execution
//     would do (the route still re-verifies from ground truth before acting)
//   - the append-only idempotency ledger that is ALSO the immutable audit trail
//
// Pure decision helpers take already-loaded inputs; the disk helpers
// (ledger claim/complete) serialize on the harness file lock. The server route
// and any future CLI verb both consume these — never a second implementation.
// See docs/security/cockpit-controls-threat-model.md.

import { existsSync } from 'node:fs';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { withFileLock } from './safe-write.js';
import { destructiveApprovalArtifact } from './destructive-actions.js';
import { getCanonicalStage } from './stages.js';

export const COCKPIT_ACTION_TYPES = Object.freeze({
  RESUME_RUN: 'resume-run',
  RESTORE_CHECKPOINT: 'restore-checkpoint',
});

export const COCKPIT_RISK = Object.freeze({ LOW: 'low', HIGH: 'high' });

// Immutable audit event names, per action, for the run timeline (events.jsonl).
export const COCKPIT_AUDIT_EVENTS = Object.freeze({
  [COCKPIT_ACTION_TYPES.RESUME_RUN]: 'cockpit_resume_run',
  [COCKPIT_ACTION_TYPES.RESTORE_CHECKPOINT]: 'cockpit_checkpoint_restored',
});

// Append-only ledger: BOTH the idempotency store and the immutable audit trail.
export const COCKPIT_LEDGER_FILE = join('.rstack', 'cockpit-actions.jsonl');

// How many model-free steps a single resume-run invocation advances. Bounded so
// one click can never run away; the runner stops at every gate anyway.
export const RESUME_MAX_STEPS = 5;

const TRUTHY = new Set(['1', 'true', 'yes', 'on']);

// The env flag is a global kill-switch/enable; policy can enable per project.
export function cockpitControlsEnabledFromEnv(env = process.env) {
  return TRUTHY.has(String(env.RSTACK_COCKPIT_CONTROLS ?? '').trim().toLowerCase());
}

// OFF by default. Enabled by the env flag OR a policy opt-in — mirrors how
// managers are resolved (env OR policy). `policy` is the parsed .rstack/policy.json.
export function cockpitControlsEnabled(policy, env = process.env) {
  if (cockpitControlsEnabledFromEnv(env)) return true;
  return policy?.cockpit_controls?.enabled === true;
}

export function isKnownCockpitAction(type) {
  return type === COCKPIT_ACTION_TYPES.RESUME_RUN
    || type === COCKPIT_ACTION_TYPES.RESTORE_CHECKPOINT;
}

// Destructive-approval artifact for a checkpoint restore. Colons are safe in
// artifact names; runIds/stageIds never contain a slash, so the result always
// passes isSafeArtifactName. Kept here so the route and the projection name the
// gate identically.
export function checkpointRestoreArtifact(runId, stageId) {
  return destructiveApprovalArtifact(`checkpoint-restore:${runId}:${stageId}`);
}

// A client-supplied idempotency key: a short, path-safe token. 8–128 chars of
// [A-Za-z0-9._:-], no traversal. Rejecting anything else keeps the ledger
// scannable and the key un-weaponizable as a path.
const SAFE_IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
export function isValidIdempotencyKey(key) {
  return typeof key === 'string' && SAFE_IDEMPOTENCY_KEY.test(key) && !key.includes('..');
}

// ── Eligibility (pure) ──────────────────────────────────────────────────────
// Derived from the compact pipeline rollup (state/pipeline-rollup.js), the same
// summary the CLI's `pipeline status` renders. The route re-derives from ground
// truth (planNextAction / deep verifyStageCheckpoint) before doing any work.

const RESUMABLE_KINDS = new Set(['active', 'pending', 'retry', 'failed']);

const RESUME_DISABLED_REASONS = Object.freeze({
  approval: 'a human approval is pending — resolve it before resuming',
  guardrail_blocked: 'retry budget exhausted — approve the guardrail override first',
  complete: 'the pipeline is complete — nothing to resume',
  unknown: 'no actionable backend work detected',
});

// Given a run's compact rollup, decide whether resume-run may be offered.
// Fails closed: no rollup, or a stale rollup, is not eligible.
export function evaluateResumeEligibility(rollup) {
  if (!rollup) return { eligible: false, reason: 'no pipeline state for this run yet', kind: 'unknown' };
  if (rollup.stale) return { eligible: false, reason: 'the run snapshot is stale — refresh before acting', kind: rollup.next_action?.kind ?? 'unknown' };
  const kind = rollup.next_action?.kind ?? 'unknown';
  if (RESUMABLE_KINDS.has(kind)) return { eligible: true, reason: null, kind };
  return { eligible: false, reason: RESUME_DISABLED_REASONS[kind] ?? 'the run is not in a resumable state', kind };
}

// Given a rollup checkpoint-stage entry ({ id, restorable, reason }), decide
// whether restore-checkpoint may be offered for that stage. A corrupt/legacy
// checkpoint is surfaced as DISABLED with its reason (so the operator learns
// why), never enabled.
const CHECKPOINT_REASON_TEXT = Object.freeze({
  corrupt_manifest: 'the checkpoint manifest is corrupt — restore is refused; save a fresh checkpoint',
  corrupt_hash_mismatch: 'checkpoint files failed sha-256 verification — restore is refused',
  corrupt_missing_file: 'the checkpoint is missing files — restore is refused',
  corrupt_extra_file: 'the checkpoint has unexpected files — restore is refused',
  legacy_unverified: 'this is a pre-manifest checkpoint with no integrity manifest to verify against',
});

export function evaluateCheckpointEligibility(stage, { stale = false } = {}) {
  if (!stage || !stage.id) return { eligible: false, reason: 'no checkpoint', stageId: null };
  if (stale) return { eligible: false, reason: 'the run snapshot is stale — refresh before acting', stageId: stage.id };
  if (stage.restorable === true) return { eligible: true, reason: null, stageId: stage.id };
  const reason = CHECKPOINT_REASON_TEXT[stage.reason]
    ?? `checkpoint not restorable${stage.reason ? ` (${stage.reason})` : ''}`;
  return { eligible: false, reason, stageId: stage.id };
}

// Server-side authoritative check that a stage id is a real SDLC stage — the
// route calls this before any rollback, independent of what the client sent.
export function isCanonicalStageId(stageId) {
  return Boolean(getCanonicalStage(stageId));
}

// ── Idempotency ledger + audit trail (disk) ─────────────────────────────────

function ledgerPath(projectRoot) {
  return join(projectRoot, COCKPIT_LEDGER_FILE);
}

async function readLedger(projectRoot) {
  const path = ledgerPath(projectRoot);
  if (!existsSync(path)) return [];
  try {
    const raw = await readFile(path, 'utf8');
    return raw.split('\n').filter(Boolean).flatMap((line) => {
      try { return [JSON.parse(line)]; } catch { return []; }
    });
  } catch {
    return [];
  }
}

// Locate the last COMPLETED entry for a key (the stored replay result), and
// whether any entry for the key is currently STARTED-but-not-completed.
export function summarizeLedgerForKey(entries, key) {
  const forKey = entries.filter((entry) => entry?.idempotencyKey === key);
  const completed = [...forKey].reverse().find((entry) => entry.phase === 'completed') ?? null;
  // The ledger is append-only and read in file order, so the LAST entry for a
  // key is authoritative — using append order, not timestamps, avoids a
  // same-millisecond tie reading a finished action as still in flight.
  const last = forKey.length ? forKey[forKey.length - 1] : null;
  const inProgress = Boolean(last) && last.phase === 'started';
  return { completed, inProgress };
}

// Append one immutable line. Serialized on the ledger lock so concurrent
// invocations never interleave a torn write.
export async function appendLedgerEntry(projectRoot, entry) {
  const path = ledgerPath(projectRoot);
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n';
  await withFileLock(path, async () => {
    await mkdir(join(projectRoot, '.rstack'), { recursive: true });
    await appendFile(path, line);
  });
  return true;
}

// Atomically claim an idempotency key. Under the ledger lock:
//   - a key already `completed` → { status: 'completed', result } (replay: the
//     caller returns the stored result WITHOUT re-executing)
//   - a key `started` and not yet terminal → { status: 'in_progress' } (a
//     concurrent duplicate; the caller returns 409)
//   - otherwise → append a `started` entry and return { status: 'fresh' } (the
//     caller executes, then calls completeLedgerEntry)
// `meta` is the immutable descriptor (action/runId/stageId/actor/remote/origin).
export async function claimIdempotencyKey(projectRoot, key, meta) {
  const path = ledgerPath(projectRoot);
  return withFileLock(path, async () => {
    const entries = await readLedger(projectRoot);
    const { completed, inProgress } = summarizeLedgerForKey(entries, key);
    if (completed) return { status: 'completed', result: completed.result ?? null };
    if (inProgress) return { status: 'in_progress' };
    await mkdir(join(projectRoot, '.rstack'), { recursive: true });
    await appendFile(path, JSON.stringify({
      ts: new Date().toISOString(),
      phase: 'started',
      idempotencyKey: key,
      ...meta,
    }) + '\n');
    return { status: 'fresh' };
  });
}

// Record the terminal outcome of a claimed key (completed or failed). The
// `result` on a `completed` entry is what a later replay of the same key
// returns verbatim.
export async function completeLedgerEntry(projectRoot, key, { phase, meta, result, outcome, detail }) {
  return appendLedgerEntry(projectRoot, {
    phase: phase === 'failed' ? 'failed' : 'completed',
    idempotencyKey: key,
    ...meta,
    outcome: outcome ?? (phase === 'failed' ? 'error' : 'accepted'),
    ...(detail ? { detail } : {}),
    ...(result !== undefined ? { result } : {}),
  });
}
