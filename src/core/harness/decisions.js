// owner: RStack developed by Richardson Gunde

import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { rstackStateDir, runDirectory, latestRunId, resolveRunId } from './runs.js';
import { withFileLock, writeFileAtomic } from './safe-write.js';

export const DECISION_STATUSES = Object.freeze(['pending', 'resolved', 'waived']);
export const DECISION_IMPACTS = Object.freeze(['architecture', 'security', 'budget', 'scope', 'delivery']);

// Re-exported for existing importers; canonical home is runs.js.
export { rstackStateDir, runDirectory, latestRunId, resolveRunId };

export function decisionsPath(projectRoot, runId) {
  return join(runDirectory(projectRoot, runId), 'decisions.json');
}

function normalizeDecision(raw, index = 0, runId = '') {
  const now = new Date().toISOString();
  const id = String(raw.decision_id || raw.id || `DEC-${String(index + 1).padStart(3, '0')}`);
  const status = DECISION_STATUSES.includes(raw.status) ? raw.status : 'pending';
  return {
    decision_id: id,
    run_id: raw.run_id || runId,
    question: String(raw.question || 'Unspecified decision'),
    impact: DECISION_IMPACTS.includes(raw.impact) ? raw.impact : 'scope',
    required_before_stage: String(raw.required_before_stage || '06-architecture'),
    options: Array.isArray(raw.options) ? raw.options : [],
    recommendation: raw.recommendation || '',
    status,
    resolution: raw.resolution || '',
    resolved_by: raw.resolved_by || '',
    resolved_at: raw.resolved_at || '',
    owner: raw.owner || 'product-owner',
    stale_after_days: Number(raw.stale_after_days || 7),
    created_at: raw.created_at || now,
    updated_at: raw.updated_at || raw.created_at || now,
    links: raw.links || {},
  };
}

// #299 (item 5, second half): converged onto safe-write's withFileLock — the
// previous mkdir-based lock had divergent stale semantics (30s vs 10s), an
// unconditional release, and none of the #287 hardening (heartbeat keeps a
// live holder's lock fresh; owner-checked release means a stale-broken holder
// can never delete its successor's lock). One lock primitive across every
// state file, one set of guarantees.
async function withDecisionLock(projectRoot, runId, fn) {
  const selected = await resolveRunId(projectRoot, runId);
  await mkdir(runDirectory(projectRoot, selected), { recursive: true });
  return withFileLock(decisionsPath(projectRoot, selected), async () => fn(selected));
}

async function readDecisionsUnlocked(projectRoot, runId) {
  const path = decisionsPath(projectRoot, runId);
  if (!existsSync(path)) return [];
  const parsed = JSON.parse(await readFile(path, 'utf8'));
  const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed.decisions) ? parsed.decisions : [];
  return list.map((item, index) => normalizeDecision(item, index, runId));
}

async function writeDecisionsUnlocked(projectRoot, runId, decisions) {
  const path = decisionsPath(projectRoot, runId);
  await mkdir(join(path, '..'), { recursive: true });
  const normalized = decisions.map((item, index) => normalizeDecision(item, index, runId));
  const payload = JSON.stringify({ run_id: runId, updated_at: new Date().toISOString(), decisions: normalized }, null, 2);
  // Crash-durable write (#299): the previous temp+rename skipped the fsync, so
  // a crash after rename but before the OS flushed could leave a zero-length or
  // torn decisions.json. writeFileAtomic does tmp + fsync + rename.
  await writeFileAtomic(path, payload);
  return normalized;
}

export async function readDecisions(projectRoot, runId) {
  const selected = await resolveRunId(projectRoot, runId);
  return readDecisionsUnlocked(projectRoot, selected);
}

export async function writeDecisions(projectRoot, runId, decisions) {
  return withDecisionLock(projectRoot, runId, (selected) => writeDecisionsUnlocked(projectRoot, selected, decisions));
}

export async function addDecision(projectRoot, runId, decision) {
  return withDecisionLock(projectRoot, runId, async (selected) => {
    const current = await readDecisionsUnlocked(projectRoot, selected);
    const nextNumber = current.reduce((max, item) => {
      const match = /^DEC-(\d+)$/.exec(item.decision_id);
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0) + 1;
    const normalized = normalizeDecision({ decision_id: `DEC-${String(nextNumber).padStart(3, '0')}`, ...decision }, current.length, selected);
    const updated = await writeDecisionsUnlocked(projectRoot, selected, [...current, normalized]);
    return updated.find((item) => item.decision_id === normalized.decision_id);
  });
}

export async function decide(projectRoot, runId, decisionId, { status = 'resolved', resolution = '', resolvedBy = 'human' } = {}) {
  if (!['resolved', 'waived'].includes(status)) throw new Error('Decision status must be resolved or waived.');
  return withDecisionLock(projectRoot, runId, async (selected) => {
    const decisions = await readDecisionsUnlocked(projectRoot, selected);
    const decision = decisions.find((item) => item.decision_id === decisionId || item.id === decisionId);
    if (!decision) throw new Error(`Decision not found: ${decisionId}`);
    decision.status = status;
    decision.resolution = resolution || decision.resolution || status;
    decision.resolved_by = resolvedBy;
    decision.resolved_at = new Date().toISOString();
    decision.updated_at = decision.resolved_at;
    await writeDecisionsUnlocked(projectRoot, selected, decisions);
    return decision;
  });
}

export function summarizeDecisions(decisions, now = new Date()) {
  const byStatus = { pending: 0, resolved: 0, waived: 0 };
  const byImpact = {};
  const stale = [];
  for (const decision of decisions) {
    byStatus[decision.status] = (byStatus[decision.status] || 0) + 1;
    byImpact[decision.impact] = (byImpact[decision.impact] || 0) + 1;
    if (decision.status === 'pending') {
      const created = new Date(decision.created_at).getTime();
      const ageDays = Number.isFinite(created) ? (now.getTime() - created) / 86400000 : 0;
      if (ageDays > Number(decision.stale_after_days || 7)) stale.push({ ...decision, age_days: Math.floor(ageDays) });
    }
  }
  return {
    total: decisions.length,
    pending: byStatus.pending || 0,
    resolved: byStatus.resolved || 0,
    waived: byStatus.waived || 0,
    byImpact,
    stale,
  };
}
