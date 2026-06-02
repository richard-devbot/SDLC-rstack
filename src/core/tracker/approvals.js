import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// owner: RStack developed by Richardson Gunde

const QUEUE_FILE = '.rstack/approvals.jsonl';

function queuePath(projectRoot) {
  return join(projectRoot, QUEUE_FILE);
}

function runApprovalsPath(projectRoot, runId) {
  return join(projectRoot, '.rstack', 'runs', runId, 'approvals.json');
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
  return { runId: decodePart(runId), taskId: decodePart(taskId), artifact: decodePart(artifact) };
}

async function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return fallback; }
}

async function writeQueue(projectRoot, approvals) {
  await mkdir(join(projectRoot, '.rstack'), { recursive: true });
  const path = queuePath(projectRoot);
  const lines = approvals.map((approval) => JSON.stringify(approval)).join('\n');
  await writeFile(path, lines ? `${lines}\n` : '');
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
  const path = runApprovalsPath(projectRoot, runId);
  await mkdir(join(projectRoot, '.rstack', 'runs', runId), { recursive: true });
  const approvals = await readJson(path, []);
  const all = Array.isArray(approvals) ? approvals : [];
  const next = {
    id: record.id || `app-${new Date().toISOString().replace(/[:.]/g, '-')}`,
    artifact: record.artifact,
    status: record.status,
    approver: record.approver,
    timestamp: record.timestamp || new Date().toISOString(),
    comments: record.comments,
    source: record.source || 'dashboard',
  };
  all.push(next);
  await writeFile(path, JSON.stringify(all, null, 2));
  return next;
}

export async function resolveApproval(projectRoot, id, decision, resolvedBy, options = {}) {
  const all = await readApprovals(projectRoot);
  const idx = all.findIndex(a => a.id === id);
  const parsed = idx === -1 ? parseApprovalQueueId(id) : null;
  if (idx === -1 && !parsed) return false;
  if (idx === -1 && parsed && !existsSync(join(projectRoot, '.rstack', 'runs', parsed.runId))) return false;

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
  const runStatus = decision === 'approved' ? 'APPROVED' : 'REJECTED';
  const resolvedAt = new Date().toISOString();
  const next = { ...base, status: queueStatus, resolvedBy: approver, resolvedAt, updatedAt: resolvedAt };

  if (idx === -1) all.push(next);
  else all[idx] = next;
  await writeQueue(projectRoot, all);

  if (!options.skipRunWrite && base.runId && base.artifact) {
    await appendRunApproval(projectRoot, base.runId, {
      id: `dash-${resolvedAt.replace(/[:.]/g, '-')}`,
      artifact: base.artifact,
      status: runStatus,
      approver,
      timestamp: resolvedAt,
      comments: base.taskId ? `Dashboard ${queueStatus} for blocked task ${base.taskId}` : `Dashboard ${queueStatus}`,
      source: 'business-hub',
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
