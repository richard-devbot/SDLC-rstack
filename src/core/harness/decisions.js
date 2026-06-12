// owner: RStack developed by Richardson Gunde

import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export const DECISION_STATUSES = Object.freeze(['pending', 'resolved', 'waived']);
export const DECISION_IMPACTS = Object.freeze(['architecture', 'security', 'budget', 'scope', 'delivery']);

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

export async function resolveRunId(projectRoot, runId) {
  const selected = runId || await latestRunId(projectRoot);
  if (!selected) throw new Error('No RStack run found. Start one with sdlc_start first.');
  return selected;
}

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

export async function readDecisions(projectRoot, runId) {
  const selected = await resolveRunId(projectRoot, runId);
  const path = decisionsPath(projectRoot, selected);
  if (!existsSync(path)) return [];
  const parsed = JSON.parse(await readFile(path, 'utf8'));
  const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed.decisions) ? parsed.decisions : [];
  return list.map((item, index) => normalizeDecision(item, index, selected));
}

export async function writeDecisions(projectRoot, runId, decisions) {
  const selected = await resolveRunId(projectRoot, runId);
  const path = decisionsPath(projectRoot, selected);
  await mkdir(join(path, '..'), { recursive: true });
  const normalized = decisions.map((item, index) => normalizeDecision(item, index, selected));
  await writeFile(path, JSON.stringify({ run_id: selected, updated_at: new Date().toISOString(), decisions: normalized }, null, 2));
  return normalized;
}

export async function addDecision(projectRoot, runId, decision) {
  const selected = await resolveRunId(projectRoot, runId);
  const current = await readDecisions(projectRoot, selected);
  const nextNumber = current.reduce((max, item) => {
    const match = /^DEC-(\d+)$/.exec(item.decision_id);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0) + 1;
  const normalized = normalizeDecision({ decision_id: `DEC-${String(nextNumber).padStart(3, '0')}`, ...decision }, current.length, selected);
  const updated = await writeDecisions(projectRoot, selected, [...current, normalized]);
  return updated.find((item) => item.decision_id === normalized.decision_id);
}

export async function decide(projectRoot, runId, decisionId, { status = 'resolved', resolution = '', resolvedBy = 'human' } = {}) {
  if (!['resolved', 'waived'].includes(status)) throw new Error('Decision status must be resolved or waived.');
  const selected = await resolveRunId(projectRoot, runId);
  const decisions = await readDecisions(projectRoot, selected);
  const decision = decisions.find((item) => item.decision_id === decisionId || item.id === decisionId);
  if (!decision) throw new Error(`Decision not found: ${decisionId}`);
  decision.status = status;
  decision.resolution = resolution || decision.resolution || status;
  decision.resolved_by = resolvedBy;
  decision.resolved_at = new Date().toISOString();
  decision.updated_at = decision.resolved_at;
  await writeDecisions(projectRoot, selected, decisions);
  return decision;
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
