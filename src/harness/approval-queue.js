import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// owner: RStack developed by Richardson Gunde

const QUEUE_FILE = '.rstack/approvals.jsonl';

function queuePath(projectRoot) {
  return join(projectRoot, QUEUE_FILE);
}

export async function appendApproval(projectRoot, entry) {
  await mkdir(join(projectRoot, '.rstack'), { recursive: true });
  const line = JSON.stringify({ ...entry, ts: new Date().toISOString() }) + '\n';
  const path = queuePath(projectRoot);
  try {
    await writeFile(path, line, { flag: 'a' });
  } catch { /* best-effort */ }
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

export async function resolveApproval(projectRoot, id, decision, resolvedBy) {
  const all = await readApprovals(projectRoot);
  const idx = all.findIndex(a => a.id === id);
  if (idx === -1) return false;
  all[idx] = { ...all[idx], status: decision, resolvedBy, resolvedAt: new Date().toISOString() };
  const path = queuePath(projectRoot);
  await writeFile(path, all.map(a => JSON.stringify(a)).join('\n') + '\n');
  return true;
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
