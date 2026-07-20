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
//     is verified on disk before any "restorable" answer, every save stamps
//     a schema-versioned integrity manifest (sha-256 per file), and rollback
//     returns a pinned status (SUCCESS | NO_CHECKPOINT | INVALID_STAGE |
//     CORRUPT) instead of a best-effort boolean. A checkpoint that disagrees
//     with its manifest FAILS CLOSED — it is never restored.
//   - Checkpoint events are a pinned contract (same discipline as
//     LOOP_EVENT_TYPES and retry_decision): unknown types throw.
// One checkpoint slot per stage — the last save wins, so after a PASS the
// slot holds the validated artifacts and at the next claim it holds the
// state the new attempt started from. The harness never calls a model.

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { CANONICAL_SDLC_STAGES, getCanonicalStage } from './stages.js';
import { createStageCheckpoint, rollbackStage } from './run-state.js';
import { rstackStateDir } from './runs.js';
import { withFileLock, writeJsonAtomic } from './safe-write.js';

// #425: every canonical stage is checkpoint-critical by default. Previously
// only five stages (06/07/08/09/12) earned a pre-build restore point, so a
// failed retry on requirements, planning, jira, summary, compliance, or cost
// had nothing to roll back to. Since #404 each stage is its own claim-bound
// task, "checkpoint every claim" is exactly one small stage-artifact dir per
// checkpoint — the invariant is now Claim → Execute → Validate → Gate →
// Checkpoint at ALL 15 stages. Projects that want fewer can still narrow the
// set via .rstack config `checkpoints.critical_stages` (unchanged).
export const DEFAULT_CRITICAL_STAGE_IDS = Object.freeze(
  CANONICAL_SDLC_STAGES.map((stage) => stage.id),
);

export const CHECKPOINT_EVENT_TYPES = Object.freeze([
  'stage_checkpoint_before_saved',
  'stage_checkpoint_after_saved',
  'stage_checkpoint_reverted',
]);

export const CHECKPOINT_PHASES = Object.freeze(['before', 'after']);

export const ROLLBACK_STATUSES = Object.freeze(['SUCCESS', 'NO_CHECKPOINT', 'INVALID_STAGE', 'CORRUPT']);

// Every checkpoint saved through saveStageCheckpoint gets a schema-versioned
// integrity manifest (sha-256 + size per file) as a SIBLING of the checkpoint
// directory, so a restore never copies the manifest into live stage artifacts.
export const CHECKPOINT_MANIFEST_SCHEMA_VERSION = 1;

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

export function stageCheckpointManifestPath(runDir, stageId) {
  const stage = getCanonicalStage(stageId);
  if (!stage) throw new Error(`Unknown canonical SDLC stage: ${stageId}`);
  return join(runDir, 'checkpoints', `${stage.id}.manifest.json`);
}

// Recursive file inventory of a checkpoint directory: sorted relative paths
// (posix separators) with sizes, optionally sha-256 content hashes. Stage
// artifact folders are small JSON trees, so a synchronous walk is fine.
function walkCheckpointFiles(dir, { hash = false } = {}) {
  const files = [];
  const walk = (current, prefix) => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = join(current, entry.name);
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(absolute, relativePath);
      } else if (entry.isFile()) {
        const record = { path: relativePath, size: statSync(absolute).size };
        if (hash) record.sha256 = createHash('sha256').update(readFileSync(absolute)).digest('hex');
        files.push(record);
      }
    }
  };
  walk(dir, '');
  return files;
}

function readCheckpointManifest(manifestPath, stageId) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    return { manifest: null, problem: 'unparseable manifest' };
  }
  if (parsed?.schema_version !== CHECKPOINT_MANIFEST_SCHEMA_VERSION) {
    return { manifest: null, problem: `schema_version ${JSON.stringify(parsed?.schema_version)} (expected ${CHECKPOINT_MANIFEST_SCHEMA_VERSION})` };
  }
  if (parsed.stage_id !== stageId) {
    return { manifest: null, problem: `manifest names stage ${JSON.stringify(parsed.stage_id)}, not ${stageId}` };
  }
  if (!Array.isArray(parsed.files) || parsed.files.some((file) => typeof file?.path !== 'string' || typeof file?.sha256 !== 'string')) {
    return { manifest: null, problem: 'malformed files inventory' };
  }
  return { manifest: parsed, problem: null };
}

/**
 * Answer "can this stage actually be restored?" from the filesystem, never
 * from events or memory. `restorable: true` requires the checkpoint path to
 * exist AND be a directory; when an integrity manifest is present the file
 * inventory must match it exactly (and with `deep: true` every sha-256 must
 * match) — any disagreement is a corrupt checkpoint and fails closed.
 *
 * Checkpoints saved before manifests existed have nothing to verify against;
 * they stay restorable but are reported honestly as `verified: false`
 * (reason `legacy_unverified`) instead of being silently trusted.
 */
export function verifyStageCheckpoint(runDir, stageId, { deep = false } = {}) {
  if (!getCanonicalStage(stageId)) {
    return { restorable: false, verified: false, reason: 'invalid_stage', checkpoint_dir: null };
  }
  const checkpointDir = join(runDir, 'checkpoints', stageId);
  if (!existsSync(checkpointDir)) {
    return { restorable: false, verified: false, reason: 'no_checkpoint', checkpoint_dir: checkpointDir };
  }
  let stats;
  try {
    stats = statSync(checkpointDir);
  } catch {
    return { restorable: false, verified: false, reason: 'no_checkpoint', checkpoint_dir: checkpointDir };
  }
  if (!stats.isDirectory()) {
    return { restorable: false, verified: false, reason: 'not_a_directory', checkpoint_dir: checkpointDir };
  }

  const manifestPath = stageCheckpointManifestPath(runDir, stageId);
  if (!existsSync(manifestPath)) {
    return { restorable: true, verified: false, reason: 'legacy_unverified', checkpoint_dir: checkpointDir };
  }
  const { manifest, problem } = readCheckpointManifest(manifestPath, stageId);
  if (!manifest) {
    return { restorable: false, verified: false, reason: 'corrupt_manifest', detail: problem, checkpoint_dir: checkpointDir };
  }

  let actual;
  try {
    actual = walkCheckpointFiles(checkpointDir, { hash: deep });
  } catch {
    return { restorable: false, verified: false, reason: 'corrupt_file_set', detail: 'checkpoint directory is unreadable', checkpoint_dir: checkpointDir };
  }
  const expectedByPath = new Map(manifest.files.map((file) => [file.path, file]));
  if (actual.length !== manifest.files.length || actual.some((file) => !expectedByPath.has(file.path))) {
    return { restorable: false, verified: false, reason: 'corrupt_file_set', detail: 'checkpoint files do not match the manifest inventory', checkpoint_dir: checkpointDir };
  }
  for (const file of actual) {
    const expected = expectedByPath.get(file.path);
    if (file.size !== expected.size || (deep && file.sha256 !== expected.sha256)) {
      return { restorable: false, verified: false, reason: 'corrupt_content', detail: `checkpoint file ${file.path} does not match its recorded ${deep ? 'sha-256' : 'size'}`, checkpoint_dir: checkpointDir };
    }
  }
  return { restorable: true, verified: true, reason: null, checkpoint_dir: checkpointDir };
}

// Save + rollback of the same stage serialize on a per-stage lock anchor
// (sibling of the checkpoint directory) so a pre-claim save can never
// interleave with a concurrent restore of the same slot.
function checkpointLockAnchor(runDir, stageId) {
  return join(runDir, 'checkpoints', `${stageId}.slot`);
}

/**
 * Save a checkpoint for one canonical stage, stamp its integrity manifest
 * (schema-versioned, sha-256 + size per file), and VERIFY it landed on disk.
 * Returns { saved, verified, checkpoint_dir, manifest_path, file_count,
 * event_type } — callers must only emit the checkpoint event when both saved
 * and verified are true, so an event in the ledger always corresponds to a
 * checkpoint that really exists and matches its manifest.
 *
 * Crash safety: the previous manifest is kept until the new one is written
 * atomically, so a save that dies mid-copy leaves manifest and files
 * DISAGREEING — verification reports the slot corrupt and rollback fails
 * closed instead of restoring a torn snapshot.
 */
export async function saveStageCheckpoint(runDir, stageId, phase, { taskId = null } = {}) {
  if (!CHECKPOINT_PHASES.includes(phase)) {
    throw new Error(`Unknown checkpoint phase: ${phase} — expected ${CHECKPOINT_PHASES.join(' | ')}`);
  }
  if (!getCanonicalStage(stageId)) {
    throw new Error(`Unknown canonical SDLC stage: ${stageId}`);
  }
  return withFileLock(checkpointLockAnchor(runDir, stageId), async () => {
    const eventType = phase === 'before' ? 'stage_checkpoint_before_saved' : 'stage_checkpoint_after_saved';
    const saved = await createStageCheckpoint(runDir, stageId);
    if (!saved) {
      return { saved: false, verified: false, checkpoint_dir: stageCheckpointDir(runDir, stageId), manifest_path: null, file_count: 0, event_type: eventType };
    }
    const manifestPath = stageCheckpointManifestPath(runDir, stageId);
    const files = walkCheckpointFiles(stageCheckpointDir(runDir, stageId), { hash: true });
    await writeJsonAtomic(manifestPath, {
      schema_version: CHECKPOINT_MANIFEST_SCHEMA_VERSION,
      stage_id: stageId,
      phase,
      task_id: taskId,
      created_at: new Date().toISOString(),
      file_count: files.length,
      files,
    });
    const verification = verifyStageCheckpoint(runDir, stageId);
    return {
      saved: true,
      verified: verification.restorable && verification.verified,
      checkpoint_dir: verification.checkpoint_dir,
      manifest_path: manifestPath,
      file_count: files.length,
      event_type: eventType,
    };
  });
}

/**
 * Restore a stage from its checkpoint with a pinned status:
 *   INVALID_STAGE — the id is not a canonical stage id (plan task ids are
 *                   never accepted; this is checked before touching disk).
 *   NO_CHECKPOINT — the checkpoint directory does not exist; nothing was
 *                   modified and rollback support is NOT claimed.
 *   CORRUPT       — the checkpoint disagrees with its integrity manifest
 *                   (unparseable/mismatched manifest, missing/extra files,
 *                   or a sha-256 mismatch). FAIL CLOSED: the live stage
 *                   directory is never touched by a snapshot that cannot be
 *                   proven intact.
 *   SUCCESS       — the stage directory was restored from the checkpoint.
 *                   `verified: false` on the result marks a pre-manifest
 *                   legacy checkpoint that had nothing to verify against.
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
    // Deep verification: every file hashed against the manifest before the
    // live stage directory is touched.
    const verification = verifyStageCheckpoint(runDir, stageId, { deep: true });
    if (!verification.restorable) {
      if (verification.reason === 'no_checkpoint') {
        return {
          status: 'NO_CHECKPOINT',
          checkpoint_dir: verification.checkpoint_dir,
          detail: `No checkpoint exists at ${verification.checkpoint_dir} — stage ${stageId} cannot be restored.`,
        };
      }
      return {
        status: 'CORRUPT',
        checkpoint_dir: verification.checkpoint_dir,
        reason: verification.reason,
        detail: `Checkpoint for stage ${stageId} failed integrity verification (${verification.reason}${verification.detail ? `: ${verification.detail}` : ''}) — nothing was restored; the live stage artifacts are untouched. Save a fresh checkpoint to repair the slot.`,
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
      verified: verification.verified,
      checkpoint_dir: verification.checkpoint_dir,
      detail: verification.verified
        ? `Stage ${stageId} restored from its last checkpoint (integrity verified against the manifest).`
        : `Stage ${stageId} restored from a pre-manifest legacy checkpoint — restore succeeded but content integrity could not be verified.`,
    };
  });
}
