import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { withFileLock, writeFileAtomic, writeJsonAtomic } from '../harness/safe-write.js';
import { isSafeRunId, isSafeArtifactName, validateApprovalRecord } from '../harness/approval-audit.js';

// owner: RStack developed by Richardson Gunde

const QUEUE_FILE = '.rstack/approvals.jsonl';

// Run ids are timestamp-slug strings — never path separators or traversal.
// A crafted approval id could otherwise encode a runId like "../../etc" and
// drive a write outside .rstack/runs (issue #54). The canonical validators
// live in harness/approval-audit.js (#133) so the write path here and the
// read-side gate audit can never drift apart.
export { isSafeRunId } from '../harness/approval-audit.js';

const safeArtifact = isSafeArtifactName;

// Resolve a run's approvals.json and assert it stays inside .rstack/runs/<runId>.
// Returns null if the runId is unsafe, escapes the sandbox, or the run has no
// manifest.json (i.e. it isn't a real run).
function safeRunApprovalsPath(projectRoot, runId) {
  if (!isSafeRunId(runId)) return null;
  const runsRoot = resolve(projectRoot, '.rstack', 'runs');
  const runDir = resolve(runsRoot, runId);
  if (runDir !== join(runsRoot, runId) || !(runDir === runsRoot || runDir.startsWith(runsRoot + sep))) return null;
  if (!existsSync(join(runDir, 'manifest.json'))) return null;
  return join(runDir, 'approvals.json');
}

function queuePath(projectRoot) {
  return join(projectRoot, QUEUE_FILE);
}

function policyPath(projectRoot) {
  return join(projectRoot, '.rstack', 'policy.json');
}

function encodePart(value) {
  return encodeURIComponent(String(value ?? ''));
}

function decodePart(value) {
  try { return decodeURIComponent(value ?? ''); } catch { return value ?? ''; }
}

export function approvalQueueId({ runId, taskId, artifact }) {
  return `gate:${encodePart(runId)}:${encodePart(taskId ?? '')}:${encodePart(artifact)}`;
}

export function parseApprovalQueueId(id) {
  if (typeof id !== 'string' || !id.startsWith('gate:')) return null;
  const [, runId, taskId, artifact] = id.split(':');
  if (!runId || !artifact) return null;
  const decoded = { runId: decodePart(runId), taskId: decodePart(taskId), artifact: decodePart(artifact) };
  // Reject ids whose decoded parts could traverse the filesystem.
  if (!isSafeRunId(decoded.runId) || !safeArtifact(decoded.artifact)) return null;
  if (decoded.taskId && (decoded.taskId.includes('/') || decoded.taskId.includes('..'))) return null;
  return decoded;
}

async function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return fallback; }
}

async function writeQueue(projectRoot, approvals) {
  await mkdir(join(projectRoot, '.rstack'), { recursive: true });
  const path = queuePath(projectRoot);
  const lines = approvals.map((approval) => JSON.stringify(approval)).join('\n');
  await writeFileAtomic(path, lines ? `${lines}\n` : '');
}

export async function readApprovalPolicy(projectRoot) {
  const policy = await readJson(policyPath(projectRoot), {});
  return policy && typeof policy === 'object' ? policy : {};
}

export function configuredManagers(policy = {}, env = process.env) {
  const fromPolicy = [
    ...(Array.isArray(policy.managers) ? policy.managers : []),
    ...(Array.isArray(policy.manager_users) ? policy.manager_users : []),
    ...(Array.isArray(policy.manager_allowlist) ? policy.manager_allowlist : []),
  ];
  const fromEnv = (env.RSTACK_MANAGER_USERS || env.RSTACK_MANAGERS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return [...new Set([...fromPolicy, ...fromEnv].map((item) => String(item).trim()).filter(Boolean))];
}

export async function assertManagerAllowed(projectRoot, resolvedBy, env = process.env) {
  const managers = configuredManagers(await readApprovalPolicy(projectRoot), env);
  if (!managers.length) return true;
  const actor = String(resolvedBy ?? '').trim().toLowerCase();
  const allowed = managers.map((item) => String(item).trim().toLowerCase());
  if (actor && allowed.includes(actor)) return true;
  const err = new Error(`approval by ${resolvedBy || 'unknown'} is not allowed by manager policy`);
  err.statusCode = 403;
  throw err;
}

export async function appendApproval(projectRoot, entry) {
  // Lock the queue across the read-modify-write so concurrent gate blocks
  // (parallel builders) both land instead of overwriting each other.
  return withFileLock(queuePath(projectRoot), async () => {
    const all = await readApprovals(projectRoot);
    const now = new Date().toISOString();
    const id = entry.id || approvalQueueId(entry);
    const existing = all.findIndex((approval) => approval.id === id);
    const next = {
      status: 'pending',
      ...entry,
      id,
      ts: entry.ts ?? now,
      updatedAt: now,
    };

    if (existing === -1) all.push(next);
    else all[existing] = { ...all[existing], ...next };

    await writeQueue(projectRoot, all);
    return next;
  });
}

export async function readApprovals(projectRoot) {
  const path = queuePath(projectRoot);
  if (!existsSync(path)) return [];
  try {
    const raw = await readFile(path, 'utf8');
    return raw.split('\n').filter(Boolean).map(l => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
  } catch { return []; }
}

export async function appendRunApproval(projectRoot, runId, record) {
  if (!runId || !record?.artifact) return null;
  // Hard sandbox: unsafe/escaping runId, or a run with no manifest, writes nothing.
  const path = safeRunApprovalsPath(projectRoot, runId);
  if (!path) return null;
  const next = {
    id: record.id || `app-${new Date().toISOString().replace(/[:.]/g, '-')}`,
    artifact: record.artifact,
    status: record.status,
    approver: record.approver,
    timestamp: record.timestamp || new Date().toISOString(),
    comments: record.comments,
    // Default to a non-dashboard source: a dashboard-sourced record demands
    // token-verified actor evidence (#133), so defaulting to 'dashboard' would
    // make any future no-source caller silently rejected. A programmatic write
    // that means to claim the authenticated dashboard path must say so.
    source: record.source || 'api',
    // Actor evidence travels with the record: dashboard-sourced approvals must
    // prove the token-verified identity that resolved them (#133), and the
    // gate-side audit rejects dashboard records without it.
    ...(record.actor ? { actor: record.actor } : {}),
  };
  // Consistency audit at the write boundary (#133): a record the gate-side
  // audit would reject (unsafe artifact, wrong status casing, missing
  // approver/timestamp, dashboard source without token evidence) is refused
  // outright — malformed approvals never land, same null contract as an
  // unsafe runId.
  if (!validateApprovalRecord(next).ok) return null;
  return withFileLock(path, async () => {
    const approvals = await readJson(path, []);
    const all = Array.isArray(approvals) ? approvals : [];
    all.push(next);
    await writeJsonAtomic(path, all);
    return next;
  });
}

export async function resolveApproval(projectRoot, id, decision, resolvedBy, options = {}) {
  // Lock the queue across the read-modify-write so two concurrent
  // resolutions (dashboard + sdlc_approve) both land. The per-run
  // approvals.json write happens after release — it takes its own lock.
  const resolved = await withFileLock(queuePath(projectRoot), async () => {
    const all = await readApprovals(projectRoot);
    const idx = all.findIndex(a => a.id === id);
    const parsed = idx === -1 ? parseApprovalQueueId(id) : null;
    if (idx === -1 && !parsed) return null;
    // parseApprovalQueueId already rejected unsafe runIds; require a real run.
    if (idx === -1 && parsed && !safeRunApprovalsPath(projectRoot, parsed.runId)) return null;
    // A queued entry could predate validation — re-check before trusting its runId.
    if (idx !== -1 && all[idx].runId && !isSafeRunId(all[idx].runId)) return null;

    const base = idx === -1 ? {
      id,
      ...parsed,
      title: `Approve ${parsed.artifact}`,
      detail: parsed.taskId ? `Task ${parsed.taskId} is blocked` : 'Workflow is blocked',
      status: 'pending',
      source: 'blocked_gate',
      ts: new Date().toISOString(),
    } : all[idx];

    const approver = resolvedBy || 'dashboard';
    await assertManagerAllowed(projectRoot, approver, options.env ?? process.env);

    const queueStatus = decision === 'approved' ? 'approved' : 'rejected';
    const resolvedAt = new Date().toISOString();
    // Audit-proof actor evidence, not just a name string.
    const actor = options.actor ? { ...options.actor } : { name: approver, via: 'api', tokenVerified: false, ts: resolvedAt };
    const next = { ...base, status: queueStatus, resolvedBy: approver, actor, resolvedAt, updatedAt: resolvedAt };

    if (idx === -1) all.push(next);
    else all[idx] = next;
    await writeQueue(projectRoot, all);
    return { base, approver, queueStatus, resolvedAt, actor };
  });
  if (!resolved) return false;

  const { base, approver, queueStatus, resolvedAt, actor } = resolved;
  const runStatus = decision === 'approved' ? 'APPROVED' : 'REJECTED';
  if (!options.skipRunWrite && base.runId && base.artifact) {
    await appendRunApproval(projectRoot, base.runId, {
      id: `dash-${resolvedAt.replace(/[:.]/g, '-')}`,
      artifact: base.artifact,
      status: runStatus,
      approver,
      timestamp: resolvedAt,
      comments: base.taskId ? `Dashboard ${queueStatus} for blocked task ${base.taskId}` : `Dashboard ${queueStatus}`,
      source: 'business-hub',
      // Thread the token-verified actor evidence into the run record — the
      // gate-side audit (#133) requires it before a dashboard-sourced
      // approval may unblock anything.
      actor,
    });
  }

  return true;
}

export async function resolveQueuedApprovalForArtifact(projectRoot, { runId, taskId, artifact, decision, resolvedBy, skipRunWrite = true }) {
  const all = await readApprovals(projectRoot);
  const match = all.find((approval) =>
    approval.runId === runId &&
    approval.artifact === artifact &&
    (taskId ? approval.taskId === taskId : true) &&
    (!approval.status || approval.status === 'pending')
  );
  const id = match?.id || approvalQueueId({ runId, taskId, artifact });
  if (!match && !all.some((approval) => approval.id === id)) return false;
  return resolveApproval(projectRoot, id, decision, resolvedBy, { skipRunWrite });
}

export function pendingApprovals(approvals) {
  return approvals.filter(a => !a.status || a.status === 'pending');
}

export function approvalSummary(approvals) {
  const pending = pendingApprovals(approvals).length;
  const approved = approvals.filter(a => a.status === 'approved').length;
  const rejected = approvals.filter(a => a.status === 'rejected').length;
  return { pending, approved, rejected, total: approvals.length };
}
