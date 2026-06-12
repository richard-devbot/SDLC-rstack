// owner: RStack developed by Richardson Gunde

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadProjectProfile } from '../profiles.js';
import { readDecisions, resolveRunId, runDirectory, summarizeDecisions } from './decisions.js';

const STAGE_ORDER = [
  '00-environment', '01-transcript', '02-requirements', '03-documentation', '04-planning', '05-jira',
  '06-architecture', '07-code', '08-testing', '09-deployment', '10-summary', '11-feedback-loop',
  '12-security-threat-model', '13-compliance-checker', '14-cost-estimation',
];

export function readinessModeForProfile(profile) {
  const name = typeof profile === 'string' ? profile : profile?.profile;
  if (name === 'enterprise-webapp') return 'blocking';
  if (name === 'lean-mvp') return 'warn';
  return 'approval';
}

function stageIndex(stageId) {
  return STAGE_ORDER.indexOf(stageId);
}

function isRequiredBefore(decision, targetStage) {
  if (!targetStage) return true;
  const requiredIndex = stageIndex(decision.required_before_stage);
  const targetIndex = stageIndex(targetStage);
  if (requiredIndex === -1) throw new Error(`Unknown required_before_stage: ${decision.required_before_stage}`);
  if (targetIndex === -1) throw new Error(`Unknown target_stage: ${targetStage}`);
  return requiredIndex <= targetIndex;
}

async function readJson(path, fallback = null) {
  if (!existsSync(path)) return fallback;
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return fallback; }
}

async function profileNameForRun(projectRoot, runId) {
  const runDir = runDirectory(projectRoot, runId);
  const manifest = await readJson(join(runDir, 'manifest.json'), {});
  const tasks = await readJson(join(runDir, 'tasks.json'), {});
  const projectProfile = await loadProjectProfile(projectRoot);
  return manifest.profile || tasks.profile || projectProfile.profile || 'business-flex';
}

export async function dorCheck(projectRoot, { runId, targetStage = '07-code', writeReport = true } = {}) {
  if (targetStage && stageIndex(targetStage) === -1) throw new Error(`Unknown target_stage: ${targetStage}`);
  const selected = await resolveRunId(projectRoot, runId);
  const profile = await profileNameForRun(projectRoot, selected);
  const mode = readinessModeForProfile(profile);
  const decisions = await readDecisions(projectRoot, selected);
  const summary = summarizeDecisions(decisions);
  const requiredPending = decisions.filter((decision) => decision.status === 'pending' && isRequiredBefore(decision, targetStage));
  const stalePending = summary.stale.filter((decision) => isRequiredBefore(decision, targetStage));
  const blocking = mode === 'blocking' && requiredPending.length > 0;
  const warn = !blocking && (requiredPending.length > 0 || stalePending.length > 0);
  const status = blocking ? 'FAIL' : warn ? 'WARN' : 'PASS';
  const score = decisions.length === 0 ? 100 : Math.max(0, Math.round(((summary.resolved + summary.waived) / decisions.length) * 100));
  const report = {
    run_id: selected,
    profile,
    mode,
    target_stage: targetStage,
    status,
    score,
    generated_at: new Date().toISOString(),
    pending_required: requiredPending.map((decision) => decision.decision_id),
    stale_decisions: stalePending.map((decision) => decision.decision_id),
    summary,
    message: status === 'FAIL'
      ? `${requiredPending.length} required decision(s) must be resolved before ${targetStage}.`
      : status === 'WARN'
        ? `${requiredPending.length} pending decision(s) should be resolved or waived before ${targetStage}.`
        : 'Definition-of-Ready passed for the selected stage.',
  };
  if (writeReport) {
    const runDir = runDirectory(projectRoot, selected);
    await mkdir(runDir, { recursive: true });
    await writeFile(join(runDir, 'dor-report.json'), JSON.stringify(report, null, 2));
    await writeFile(join(runDir, 'readiness.json'), JSON.stringify({ run_id: selected, updated_at: report.generated_at, status, score, mode, pending_required: report.pending_required }, null, 2));
  }
  return report;
}

export async function assertReadyForStage(projectRoot, { runId, targetStage = '07-code' } = {}) {
  const report = await dorCheck(projectRoot, { runId, targetStage, writeReport: true });
  return {
    ok: report.status !== 'FAIL',
    report,
  };
}
