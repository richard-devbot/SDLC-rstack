// owner: RStack developed by Richardson Gunde

import { readDecisions, summarizeDecisions } from '../../../core/harness/decisions.js';
import { dorCheck } from '../../../core/harness/readiness.js';

export async function buildDecisionState(runs) {
  const entries = [];
  for (const run of runs ?? []) {
    try {
      const decisions = await readDecisions(run.projectRoot, run.runId);
      const readiness = await dorCheck(run.projectRoot, { runId: run.runId, writeReport: false });
      entries.push({
        runId: run.runId,
        projectRoot: run.projectRoot,
        goal: run.manifest?.goal || run.runId,
        profile: readiness.profile,
        readiness,
        summary: summarizeDecisions(decisions),
        decisions,
      });
    } catch (err) {
      entries.push({
        runId: run.runId,
        projectRoot: run.projectRoot,
        goal: run.manifest?.goal || run.runId,
        profile: run.profile?.profile || 'unknown',
        readiness: {
          status: 'WARN',
          score: 0,
          mode: 'unknown',
          pending_required: [],
          message: 'Readiness unavailable because decisions or readiness data could not be loaded.',
          error: true,
          errorMessage: err?.message || String(err),
        },
        summary: { total: 0, pending: 0, resolved: 0, waived: 0, byImpact: {}, stale: [] },
        decisions: [],
      });
    }
  }
  return {
    runs: entries,
    totals: entries.reduce((acc, entry) => {
      acc.total += entry.summary.total;
      acc.pending += entry.summary.pending;
      acc.resolved += entry.summary.resolved;
      acc.waived += entry.summary.waived;
      if (entry.readiness.status === 'FAIL') acc.fail++;
      if (entry.readiness.status === 'WARN') acc.warn++;
      if (entry.readiness.status === 'PASS') acc.pass++;
      return acc;
    }, { total: 0, pending: 0, resolved: 0, waived: 0, pass: 0, warn: 0, fail: 0 }),
  };
}
