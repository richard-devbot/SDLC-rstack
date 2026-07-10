import { existsSync } from 'node:fs';
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
export function validateApprovalRecord(record, { casing = 'run', expectedRunId } = {}) {
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
export function trustedApprovedArtifacts(approvals = [], { casing = 'run', expectedRunId } = {}) {
  const approvedStatus = casing === 'queue' ? 'approved' : 'APPROVED';
  const approved = new Set();
  for (const [artifact, history] of historiesByArtifact(approvals)) {
    const latest = history[history.length - 1];
    if (latest.status !== approvedStatus) continue;
    if (approvalHistoryIssues(history).length) continue;
    if (validateApprovalRecord(latest, { casing, expectedRunId }).ok) approved.add(artifact);
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
