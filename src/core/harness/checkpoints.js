// owner: RStack developed by Richardson Gunde
//
// Critical-stage checkpoints (#132, BLE-5.2): loop retries mutate stage
// artifacts, so the stages where a bad rewrite is expensive get a restore
// point BEFORE the builder touches them (claim time) and another AFTER
// validation passes. Everything here is enforced in code, never prompt text:
//   - The critical set is configurable (.rstack/rstack.config.json
//     `checkpoints.critical_stages`) but every entry must be a canonical
//     stage id — plan task ids (e.g. "007-code") are rejected, the exact
//     conflation that silently broke checkpoints before (#116).
//   - Rollback support is never claimed on faith: the checkpoint directory
//     is verified on disk before any "restorable" answer, and rollback
//     returns a pinned status (SUCCESS | NO_CHECKPOINT | INVALID_STAGE)
//     instead of a best-effort boolean.
//   - Checkpoint events are a pinned contract (same discipline as
//     LOOP_EVENT_TYPES and retry_decision): unknown types throw.
// One checkpoint slot per stage — the last save wins, so after a PASS the
// slot holds the validated artifacts and at the next claim it holds the
// state the new attempt started from. The harness never calls a model.

import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { getCanonicalStage } from './stages.js';
import { createStageCheckpoint, rollbackStage } from './run-state.js';
import { rstackStateDir } from './runs.js';
import { withFileLock } from './safe-write.js';

export const DEFAULT_CRITICAL_STAGE_IDS = Object.freeze([
  '06-architecture',
  '07-code',
  '08-testing',
  '09-deployment',
  '12-security-threat-model',
]);

export const CHECKPOINT_EVENT_TYPES = Object.freeze([
  'stage_checkpoint_before_saved',
  'stage_checkpoint_after_saved',
  'stage_checkpoint_reverted',
]);

export const CHECKPOINT_PHASES = Object.freeze(['before', 'after']);

export const ROLLBACK_STATUSES = Object.freeze(['SUCCESS', 'NO_CHECKPOINT', 'INVALID_STAGE']);

// ── Pinned event contract ────────────────────────────────────────────────────

export function checkpointEvent(type, fields = {}) {
  if (!CHECKPOINT_EVENT_TYPES.includes(type)) {
    throw new Error(`Unknown checkpoint event type: ${type} — expected ${CHECKPOINT_EVENT_TYPES.join(' | ')}`);
  }
  if (!getCanonicalStage(fields.stage_id)) {
    throw new Error(`Checkpoint events require a canonical stage_id, got: ${fields.stage_id}`);
  }
  return { type, ...fields };
}

// ── Critical-stage set resolution (same pattern as resolveLoopBounds) ───────

export function resolveCriticalStages(overrides) {
  if (!Array.isArray(overrides)) return [...DEFAULT_CRITICAL_STAGE_IDS];
  const resolved = [];
  for (const stageId of overrides) {
    // Non-canonical entries are dropped here and warned about by config
    // validation (validateRstackConfig) — never silently checkpointed under
    // a name rollback would not accept.
    if (typeof stageId !== 'string' || !getCanonicalStage(stageId)) continue;
    if (!resolved.includes(stageId)) resolved.push(stageId);
  }
  // An explicitly configured empty (or all-invalid) list disables
  // critical-stage checkpoints — deliberate opt-out, not a fallback.
  return resolved;
}

export async function loadProjectCriticalStages(projectRoot) {
  const configPath = join(rstackStateDir(projectRoot), 'rstack.config.json');
  if (!existsSync(configPath)) return resolveCriticalStages();
  try {
    const parsed = JSON.parse(await readFile(configPath, 'utf8'));
    const overrides = parsed?.checkpoints?.critical_stages;
    return resolveCriticalStages(Array.isArray(overrides) ? overrides : undefined);
  } catch (error) {
    if (error instanceof SyntaxError) {
      console.error(`[rstack] Ignoring malformed ${configPath}: ${error.message}. Default critical stages apply.`);
      return resolveCriticalStages();
    }
    throw error;
  }
}

export function isCriticalStage(stageId, criticalStages = DEFAULT_CRITICAL_STAGE_IDS) {
  return criticalStages.includes(stageId);
}

// ── Verified checkpoint state (no best-effort claims) ────────────────────────

export function stageCheckpointDir(runDir, stageId) {
  const stage = getCanonicalStage(stageId);
  if (!stage) throw new Error(`Unknown canonical SDLC stage: ${stageId}`);
  return join(runDir, 'checkpoints', stage.id);
}

/**
 * Answer "can this stage actually be restored?" from the filesystem, never
 * from events or memory. `restorable: true` requires the checkpoint path to
 * exist AND be a directory — anything else is reported with the reason.
 */
export function verifyStageCheckpoint(runDir, stageId) {
  if (!getCanonicalStage(stageId)) {
    return { restorable: false, reason: 'invalid_stage', checkpoint_dir: null };
  }
  const checkpointDir = join(runDir, 'checkpoints', stageId);
  if (!existsSync(checkpointDir)) {
    return { restorable: false, reason: 'no_checkpoint', checkpoint_dir: checkpointDir };
  }
  let stats;
  try {
    stats = statSync(checkpointDir);
  } catch {
    return { restorable: false, reason: 'no_checkpoint', checkpoint_dir: checkpointDir };
  }
  if (!stats.isDirectory()) {
    return { restorable: false, reason: 'not_a_directory', checkpoint_dir: checkpointDir };
  }
  return { restorable: true, reason: null, checkpoint_dir: checkpointDir };
}

// Save + rollback of the same stage serialize on a per-stage lock anchor
// (sibling of the checkpoint directory) so a pre-claim save can never
// interleave with a concurrent restore of the same slot.
function checkpointLockAnchor(runDir, stageId) {
  return join(runDir, 'checkpoints', `${stageId}.slot`);
}

/**
 * Save a checkpoint for one canonical stage and VERIFY it landed on disk.
 * Returns { saved, verified, checkpoint_dir, event_type } — callers must only
 * emit the checkpoint event when both saved and verified are true, so an
 * event in the ledger always corresponds to a directory that really exists.
 */
export async function saveStageCheckpoint(runDir, stageId, phase) {
  if (!CHECKPOINT_PHASES.includes(phase)) {
    throw new Error(`Unknown checkpoint phase: ${phase} — expected ${CHECKPOINT_PHASES.join(' | ')}`);
  }
  if (!getCanonicalStage(stageId)) {
    throw new Error(`Unknown canonical SDLC stage: ${stageId}`);
  }
  return withFileLock(checkpointLockAnchor(runDir, stageId), async () => {
    const saved = await createStageCheckpoint(runDir, stageId);
    const verification = verifyStageCheckpoint(runDir, stageId);
    return {
      saved: Boolean(saved),
      verified: verification.restorable,
      checkpoint_dir: verification.checkpoint_dir,
      event_type: phase === 'before' ? 'stage_checkpoint_before_saved' : 'stage_checkpoint_after_saved',
    };
  });
}

/**
 * Restore a stage from its checkpoint with a pinned status:
 *   INVALID_STAGE — the id is not a canonical stage id (plan task ids are
 *                   never accepted; this is checked before touching disk).
 *   NO_CHECKPOINT — the checkpoint directory does not exist; nothing was
 *                   modified and rollback support is NOT claimed.
 *   SUCCESS       — the stage directory was restored from the checkpoint.
 */
export async function rollbackToCheckpoint(runDir, stageId) {
  if (!getCanonicalStage(stageId)) {
    return {
      status: 'INVALID_STAGE',
      checkpoint_dir: null,
      detail: `"${stageId}" is not a canonical SDLC stage id — rollback only accepts canonical stage ids (plan task ids like "007-code" are not stage ids).`,
    };
  }
  return withFileLock(checkpointLockAnchor(runDir, stageId), async () => {
    const verification = verifyStageCheckpoint(runDir, stageId);
    if (!verification.restorable) {
      return {
        status: 'NO_CHECKPOINT',
        checkpoint_dir: verification.checkpoint_dir,
        detail: `No checkpoint exists at ${verification.checkpoint_dir} — stage ${stageId} cannot be restored.`,
      };
    }
    const reverted = await rollbackStage(runDir, stageId);
    if (!reverted) {
      return {
        status: 'NO_CHECKPOINT',
        checkpoint_dir: verification.checkpoint_dir,
        detail: `Checkpoint for stage ${stageId} vanished before restore — nothing was rolled back.`,
      };
    }
    return {
      status: 'SUCCESS',
      checkpoint_dir: verification.checkpoint_dir,
      detail: `Stage ${stageId} restored from its last checkpoint.`,
    };
  });
}
