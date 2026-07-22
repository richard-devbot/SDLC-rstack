import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

import { rstackStateDir } from './runs.js';

// owner: RStack developed by Richardson Gunde
//
// Approval audit consistency checks (#133).
//
// Approval records are a trust boundary: a record in a run's approvals.json
// UNBLOCKS gated work (required-artifact gates, guardrail-override claims,
// release DONE-stamping). Records reach that file from several writers — the
// sdlc_approve tool, the Business Hub dashboard, and the harness itself — so
// every consumer must validate a record before trusting it, exactly like the
// goal-evaluation contract (#128): the consumer validates, never the writer
// alone. A record that fails audit is treated as ABSENT — the stage stays
// gated, the failure is reported, and nothing crashes.
//
// Same {ok, checks, issues} shape as contracts.js / validateGoalEvaluation so
// hosts and validators can gate on it without new plumbing.

// Run-level approvals.json records use UPPERCASE statuses; the .rstack
// approval queue (approvals.jsonl) uses lowercase. The casing is part of the
// contract — a run record claiming status "approved" is malformed, not a
// synonym, because every gate compares against 'APPROVED' exactly and a
// lax audit would let casing confusion mask a forged or corrupted record.
export const RUN_APPROVAL_STATUSES = Object.freeze(['APPROVED', 'REJECTED', 'PENDING', 'CONSUMED']);
// 'consumed' (#238) mirrors the run-level CONSUMED marker for queue-only
// gates (Business Hub env writes): a spent one-shot approval keeps its
// record but can never satisfy trustedApprovedArtifacts again — the gate
// requires exactly 'approved'.
export const QUEUE_APPROVAL_STATUSES = Object.freeze(['pending', 'approved', 'rejected', 'consumed']);

// Sources that claim the record came through the Business Hub HTTP path.
// Those records must carry token-verified actor evidence (#161/#168): the
// dashboard only resolves approvals after a timing-safe RSTACK_APPROVAL_TOKEN
// check, and it stamps `actor: { name, via: 'dashboard', tokenVerified: true }`
// on the resolution. A record claiming a dashboard source without that
// evidence was not written by the authenticated dashboard path.
export const DASHBOARD_APPROVAL_SOURCES = Object.freeze(['dashboard', 'business-hub']);

// ── Optional record provenance (#369, defense in depth) ──────────────────────
//
// The HARD boundary against a self-minted approval is the destructive gate
// refusing to let the agent WRITE approvals.json at all (destructive-actions.js
// now classifies any write to .rstack/ as protected — the tool AND bash paths).
// This signature is the second layer: when RSTACK_APPROVAL_SIGNING_KEY is set,
// every trust-granting (APPROVED) run record must carry a valid HMAC over its
// load-bearing fields, so a record that reached the file some other way (an
// unguarded harness, a future tool, a classifier miss) cannot unblock work
// unless it was signed by a legitimate writer.
//
// HONEST SCOPE: on a single-user host where the agent runs shell as the same OS
// user as the harness, the agent can read the key (`printenv`) and could sign a
// forgery — there, the write-blocking gate (Layer 1) is the real boundary and
// this is depth-in-defense only. The signature becomes a TRUE boundary when the
// key is genuinely out of the agent's reach: CI, a remote approval service, or a
// multi-user host. Off by default (no key ⇒ unsigned mode, legacy behavior),
// exactly like the attestation envelope (attestations.js).
export const APPROVAL_SIGNING_KEY_ENV = 'RSTACK_APPROVAL_SIGNING_KEY';

// Canonical payload over the fields a forger would need to control — binds the
// artifact, status, run, id, timestamp, approver, and artifact digest together so a signed
// APPROVED record cannot be moved to another artifact or run.
function approvalSignaturePayload(record) {
  return JSON.stringify([
    'rstack-approval-v1',
    String(record?.artifact ?? ''),
    String(record?.status ?? ''),
    String(record?.run_id ?? ''),
    String(record?.id ?? ''),
    String(record?.timestamp ?? ''),
    String(record?.approver ?? ''),
    String(record?.artifact_sha256 ?? ''),
  ]);
}

// Attach an HMAC signature when a key is configured; return the record
// unchanged in unsigned mode. Every run-level APPROVED writer calls this before
// persisting (sdlc_approve, appendRunApproval) so signed and verified stay in
// lockstep.
export function signApprovalRecord(record, key = process.env[APPROVAL_SIGNING_KEY_ENV]) {
  if (typeof key !== 'string' || !key.trim()) return record;
  return { ...record, sig: createHmac('sha256', key.trim()).update(approvalSignaturePayload(record)).digest('hex') };
}

// Verify a record's HMAC. Timing-safe, matching attestations.js.
export function verifyApprovalRecordSignature(record, key = process.env[APPROVAL_SIGNING_KEY_ENV]) {
  if (typeof key !== 'string' || !key.trim()) return { verified: false, reason: `no signing key — set ${APPROVAL_SIGNING_KEY_ENV}` };
  const expected = createHmac('sha256', key.trim()).update(approvalSignaturePayload(record)).digest('hex');
  const actual = String(record?.sig ?? '');
  const matches = expected.length === actual.length
    && timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(actual, 'utf8'));
  return matches ? { verified: true, reason: 'approval signature verified' } : { verified: false, reason: 'approval signature missing or does not match' };
}

// Run ids are timestamp-slug strings — never path separators or traversal.
// Canonical definition (moved here from tracker/approvals.js so the write
// path and the read-side audit can never drift apart).
const SAFE_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/;

export function isSafeRunId(runId) {
  return typeof runId === 'string' && SAFE_RUN_ID.test(runId) && !runId.includes('..');
}

// Artifacts are file/stage names (plan.md, guardrail-override:004-impl),
// never paths.
export function isSafeArtifactName(artifact) {
  return typeof artifact === 'string' && artifact.length > 0 && artifact.length < 256
    && !artifact.includes('/') && !artifact.includes('\\') && !artifact.includes('..');
}

// #443: resolve an approval artifact NAME to its backing file within the run,
// mirroring the bridge's resolver (the mission spec docs live in the run's
// specs dir; plan.md may also sit at the run root). isSafeArtifactName already
// forbids separators/traversal, so the join cannot escape runDir — the
// containment check is belt-and-suspenders. Virtual/stage artifacts
// (guardrail-override:…, stage ids) resolve to null and carry no digest.
export function approvalArtifactFilePath(runDir, artifact) {
  if (!runDir || !isSafeArtifactName(artifact)) return null;
  const base = resolve(runDir);
  for (const candidate of [join(base, 'specs', artifact), join(base, artifact)]) {
    const resolved = resolve(candidate);
    if (resolved !== base && !resolved.startsWith(base + sep)) continue;
    if (existsSync(resolved)) return resolved;
  }
  return null;
}

// #443: SHA-256 of an approved artifact's CURRENT bytes so an approval can be
// bound to the exact content that was signed off. Null when the artifact is
// not file-backed (a stage/virtual approval) or unreadable — callers then
// simply store no digest (unchanged, name-only behavior).
export function computeApprovalArtifactDigest(runDir, artifact) {
  const filePath = approvalArtifactFilePath(runDir, artifact);
  if (!filePath) return null;
  try {
    return createHash('sha256').update(readFileSync(filePath)).digest('hex');
  } catch {
    return null;
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isValidTimestamp(value) {
  return typeof value === 'string' && value.length > 0 && Number.isFinite(Date.parse(value));
}

function hasName(actor) {
  return isPlainObject(actor) && typeof actor.name === 'string' && actor.name.trim().length > 0;
}

function summarize(checks) {
  return {
    ok: checks.every((check) => check.status === 'PASS'),
    checks,
    issues: checks.filter((check) => check.status === 'FAIL'),
  };
}

function clip(value) {
  return String(value).slice(0, 200);
}

// Legitimate flows on one machine append records with non-decreasing
// timestamps (the file is append-only under withFileLock). Small NTP clock
// steps are tolerated; anything larger means the history was rewritten or a
// stale record was replayed after a newer one.
const ORDERING_SKEW_TOLERANCE_MS = 60_000;

// Validate a single approval record. `casing: 'run'` (default) audits a
// run-level approvals.json record; `casing: 'queue'` audits a .rstack
// approvals.jsonl queue entry. `expectedRunId` (run casing) enforces run
// binding: a record stamped for another run must not unblock this one.
// Records without a `run_id` stamp predate #133 and are tolerated — binding
// is a consistency check on stamped records, not a signature (an editor of
// approvals.json could strip the stamp, but such an editor can forge whole
// records; file integrity is the host's trust boundary, not this audit's).
// Never throws — junk input fails checks.
export function validateApprovalRecord(record, { casing = 'run', expectedRunId, signingKey = process.env[APPROVAL_SIGNING_KEY_ENV] } = {}) {
  const checks = [];
  const push = (name, pass, evidence) => checks.push({ name, status: pass ? 'PASS' : 'FAIL', evidence });

  if (!isPlainObject(record)) {
    push('approval_is_object', false, 'approval record missing or not an object');
    return summarize(checks);
  }
  push('approval_is_object', true, 'present');

  push('approval_artifact_safe', isSafeArtifactName(record.artifact),
    isSafeArtifactName(record.artifact) ? clip(record.artifact) : `unsafe or missing artifact name: ${clip(record.artifact)}`);

  if (casing === 'queue') {
    // Queue entries: absent status means pending (matches pendingApprovals()).
    const status = record.status ?? 'pending';
    push('approval_status_allowed', QUEUE_APPROVAL_STATUSES.includes(status), clip(status));
    if (isSafeRunId(record.runId) || record.runId === undefined) {
      push('approval_run_id_safe', true, record.runId === undefined ? 'no runId (queue-only entry)' : clip(record.runId));
    } else {
      push('approval_run_id_safe', false, `unsafe runId: ${clip(record.runId)}`);
    }
    push('approval_timestamp_valid', isValidTimestamp(record.ts),
      isValidTimestamp(record.ts) ? record.ts : `ts missing or unparseable: ${clip(record.ts)}`);
    if (status === 'approved' || status === 'rejected') {
      const resolver = typeof record.resolvedBy === 'string' && record.resolvedBy.trim().length > 0;
      push('approval_actor_present', resolver, resolver ? clip(record.resolvedBy) : 'resolved entry has no resolvedBy');
      push('approval_resolved_timestamp_valid', isValidTimestamp(record.resolvedAt),
        isValidTimestamp(record.resolvedAt) ? record.resolvedAt : `resolvedAt missing or unparseable: ${clip(record.resolvedAt)}`);
    }
    return summarize(checks);
  }

  // Run-level record: exact UPPERCASE status only — 'approved' is malformed.
  push('approval_status_allowed', RUN_APPROVAL_STATUSES.includes(record.status),
    RUN_APPROVAL_STATUSES.includes(record.status) ? record.status : `status must be one of ${RUN_APPROVAL_STATUSES.join('/')}, got: ${clip(record.status)}`);

  // Every run-record writer mints an id (appendRunApproval, sdlc_approve,
  // the CONSUMED marker, the dashboard). An id-less record was not written
  // by any known writer — and without an id, replay cannot be detected.
  const idOk = typeof record.id === 'string' && record.id.trim().length > 0;
  push('approval_id_present', idOk, idOk ? clip(record.id) : 'record has no id — no known writer omits it');

  // Run binding: a record stamped for another run must not unblock this one
  // (cross-run replay). A non-string stamp is malformed outright.
  if (record.run_id !== undefined) {
    const stampOk = typeof record.run_id === 'string' && record.run_id.length > 0;
    const bound = stampOk && (expectedRunId === undefined || record.run_id === expectedRunId);
    push('approval_run_binding', bound,
      bound ? clip(record.run_id)
        : stampOk ? `record is bound to run '${clip(record.run_id)}', not '${clip(expectedRunId)}' — cross-run replay`
          : `run_id stamp must be a non-empty string, got: ${clip(record.run_id)}`);
  }

  const approverOk = typeof record.approver === 'string' && record.approver.trim().length > 0;
  push('approval_actor_present', approverOk, approverOk ? clip(record.approver) : 'approver missing or empty');

  push('approval_timestamp_valid', isValidTimestamp(record.timestamp),
    isValidTimestamp(record.timestamp) ? record.timestamp : `timestamp missing or unparseable: ${clip(record.timestamp)}`);

  if (DASHBOARD_APPROVAL_SOURCES.includes(record.source)) {
    const evidenced = hasName(record.actor) && record.actor.tokenVerified === true;
    push('approval_token_evidence_present', evidenced,
      evidenced ? `token-verified actor ${clip(record.actor.name)}` : `source '${clip(record.source)}' claims the dashboard path but carries no token-verified actor evidence`);
  }

  // Provenance (#369): when a signing key is configured, a trust-granting
  // (APPROVED) record MUST carry a valid HMAC. Only APPROVED is checked — a
  // forged REJECTED/CONSUMED/PENDING can only make an artifact MORE gated
  // (fail-safe), never unblock, so signing the trust-granting status suffices.
  // No key ⇒ unsigned mode: this check does not run (legacy behavior).
  if (typeof signingKey === 'string' && signingKey.trim() && record.status === 'APPROVED') {
    const sig = verifyApprovalRecordSignature(record, signingKey);
    push('approval_signature_valid', sig.verified,
      sig.verified ? 'HMAC provenance verified'
        : `${sig.reason} — with ${APPROVAL_SIGNING_KEY_ENV} set, an APPROVED record must be signed by a legitimate writer (legacy unsigned records are rejected only while a key is configured)`);
  }

  return summarize(checks);
}

// History-level consistency checks (#133): replay and ordering are properties
// of an artifact's whole record HISTORY, not of any single record — a
// verbatim copy of a spent APPROVED override is individually well-formed.
// Returns FAIL check entries for the given artifact's in-order history:
//   - approval_no_replay: the same record id appears more than once. The
//     legitimate flow never duplicates ids (every writer mints a fresh one),
//     so a duplicate means a spent record was re-appended to resurrect it.
//   - approval_ordering_sane: a record is timestamped materially BEFORE an
//     earlier record in this append-only file — the history was rewritten,
//     or a stale record (fresh id, original timestamp) was replayed after a
//     newer one. Genuine re-approvals carry fresh timestamps and pass.
// Any FAIL poisons the artifact: fail closed, nothing in an inconsistent
// history may unblock work.
export function approvalHistoryIssues(history = []) {
  const issues = [];
  const records = (Array.isArray(history) ? history : []).filter(isPlainObject);

  const counts = new Map();
  for (const record of records) {
    if (typeof record.id === 'string' && record.id) counts.set(record.id, (counts.get(record.id) ?? 0) + 1);
  }
  const replayed = [...counts].filter(([, count]) => count > 1).map(([id]) => id);
  if (replayed.length) {
    issues.push({
      name: 'approval_no_replay',
      status: 'FAIL',
      evidence: `record id(s) appear more than once: ${replayed.map(clip).join(', ')} — verbatim replay of a spent approval`,
    });
  }

  let maxTs = -Infinity;
  let maxStamp = null;
  for (const record of records) {
    const ts = typeof record.timestamp === 'string' ? Date.parse(record.timestamp) : NaN;
    if (!Number.isFinite(ts)) continue; // unparseable timestamps already fail the per-record audit
    if (ts < maxTs - ORDERING_SKEW_TOLERANCE_MS) {
      issues.push({
        name: 'approval_ordering_sane',
        status: 'FAIL',
        evidence: `record ${clip(record.id ?? '(no id)')} is timestamped ${clip(record.timestamp)}, before the earlier ${clip(maxStamp)} in an append-only history — rewritten or replayed`,
      });
      break;
    }
    if (ts > maxTs) {
      maxTs = ts;
      maxStamp = record.timestamp;
    }
  }

  return issues;
}

// In-order per-artifact histories. Records without a usable artifact name
// cannot address any gate and are excluded (they can neither approve nor
// shadow anything) — but they still fail the per-record audit and get
// reported by auditRunApprovals.
function historiesByArtifact(approvals) {
  const histories = new Map();
  for (const record of Array.isArray(approvals) ? approvals : []) {
    if (!isPlainObject(record) || typeof record.artifact !== 'string' || !record.artifact) continue;
    if (!histories.has(record.artifact)) histories.set(record.artifact, []);
    histories.get(record.artifact).push(record);
  }
  return histories;
}

// Latest-record-wins per artifact, malformed-aware. This is the ONLY approved
// set gate decisions may trust:
//   - a malformed record can never unblock (its artifact is not approved), and
//   - a malformed LATEST record poisons its artifact — it does NOT fall back
//     to an earlier valid record. Otherwise tampering the CONSUMED marker of a
//     spent guardrail-override into junk would resurrect the earlier APPROVED
//     record and grant unlimited attempts. Fail closed: inconsistent history
//     means not approved.
//   - an artifact whose HISTORY fails the replay/ordering checks is poisoned
//     the same way — a re-appended copy of a spent record never resurrects it.
// Records without a usable artifact name cannot address any gate and are
// skipped (they can neither approve nor shadow anything).
export function trustedApprovedArtifacts(approvals = [], { casing = 'run', expectedRunId, signingKey = process.env[APPROVAL_SIGNING_KEY_ENV] } = {}) {
  const approvedStatus = casing === 'queue' ? 'approved' : 'APPROVED';
  const approved = new Set();
  for (const [artifact, history] of historiesByArtifact(approvals)) {
    const latest = history[history.length - 1];
    if (latest.status !== approvedStatus) continue;
    if (approvalHistoryIssues(history).length) continue;
    if (validateApprovalRecord(latest, { casing, expectedRunId, signingKey }).ok) approved.add(artifact);
  }
  return approved;
}

// Audit a run's approvals.json as a whole: context checks first (safe run id,
// run directory backed by a manifest.json — a record for a run that does not
// exist approves nothing), then per-record validation. When context fails,
// EVERY record is rejected — nothing from a phantom run may unblock work.
// Returns { ok, checks, issues, valid, rejected } where rejected entries are
// { record, issues } pairs ready for approvalAuditEvent().
export function auditRunApprovals(rawApprovals, { runId, projectRoot, runDir } = {}) {
  const checks = [];
  const push = (name, pass, evidence) => checks.push({ name, status: pass ? 'PASS' : 'FAIL', evidence });

  if (runId !== undefined || projectRoot !== undefined) {
    push('approval_run_id_safe', isSafeRunId(runId), isSafeRunId(runId) ? runId : `unsafe runId: ${clip(runId)}`);
  }
  let dir = runDir ?? null;
  if (!dir && projectRoot && isSafeRunId(runId)) {
    // Anchor to the shared state-dir resolver so the audit and the run
    // selection (RSTACK_STATE_DIR override included) always agree.
    const runsRoot = resolve(rstackStateDir(projectRoot), 'runs');
    const candidate = resolve(runsRoot, runId);
    // Containment belt-and-suspenders on top of isSafeRunId.
    dir = candidate.startsWith(runsRoot + sep) ? candidate : null;
  }
  if (dir) {
    const manifestExists = existsSync(join(dir, 'manifest.json'));
    push('approval_run_has_manifest', manifestExists, manifestExists ? 'manifest.json present' : `no manifest.json in ${dir} — not a real run`);
  } else if (projectRoot !== undefined || runDir !== undefined) {
    push('approval_run_has_manifest', false, 'run directory could not be resolved safely');
  }

  const contextOk = checks.every((check) => check.status === 'PASS');
  const records = Array.isArray(rawApprovals) ? rawApprovals : [];
  if (!Array.isArray(rawApprovals) && rawApprovals != null) {
    push('approvals_is_array', false, 'approvals.json is not an array — all records ignored');
  }

  const valid = [];
  const rejected = [];
  for (const record of records) {
    // Thread the audited run's id into the binding check (#298): without it
    // even a stamped record passed (expectedRunId === undefined ⇒ bound), so
    // the #133 cross-run replay rejection was inert on this path. Legacy
    // records without a run_id stamp stay valid (the binding branch only
    // fires when the record carries one).
    const result = validateApprovalRecord(record, { casing: 'run', expectedRunId: runId });
    if (contextOk && result.ok) valid.push(record);
    else rejected.push({ record, issues: contextOk ? result.issues : [...checks.filter((check) => check.status === 'FAIL'), ...result.issues] });
  }

  return { ...summarize(checks), valid, rejected };
}

// Pinned event contract for ignored malformed approvals — appended by gate
// consumers so the run's event stream shows WHY a stage stayed gated.
export function approvalAuditEvent(rejection, extra = {}) {
  const record = isPlainObject(rejection?.record) ? rejection.record : {};
  return {
    type: 'approval_audit_failed',
    record_id: typeof record.id === 'string' ? clip(record.id) : null,
    artifact: typeof record.artifact === 'string' ? clip(record.artifact) : null,
    status: record.status === undefined ? null : clip(record.status),
    issues: (rejection?.issues ?? []).map((issue) => `${issue.name}: ${issue.evidence}`),
    reason: 'approval record failed the consistency audit — treated as absent, gated work stays gated',
    ...extra,
  };
}
