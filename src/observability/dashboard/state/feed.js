import { plainLanguageSummary } from '../../alerts/engine.js';

// owner: RStack developed by Richardson Gunde

export function buildActivityFeed(runs) {
  const skipInFeed = new Set(['tool_call', 'tool_result']);
  const activityFeed = [];

  for (const run of (runs ?? []).slice(0, 15)) {
    const toolBursts = {};
    for (const ev of run.events ?? []) {
      if (ev.type !== 'tool_call') continue;
      const min = ev.ts?.slice(0, 16);
      if (!min) continue;
      toolBursts[min] = (toolBursts[min] ?? 0) + 1;
    }
    for (const [min, count] of Object.entries(toolBursts)) {
      if (count >= 3) {
        activityFeed.push({
          ts: `${min}:00.000Z`,
          summary: `${count} tool calls - agent working`,
          type: 'tool_burst',
          runId: run.runId,
          projectRoot: run.projectRoot,
          goal: run.manifest?.goal,
          level: 'tool',
        });
      }
    }

    for (const ev of run.events ?? []) {
      if (skipInFeed.has(ev.type)) continue;
      const summary = plainLanguageSummary(ev);
      if (!summary) continue;
      activityFeed.push({
        ts: ev.ts,
        summary,
        type: ev.type,
        runId: run.runId,
        projectRoot: run.projectRoot,
        goal: run.manifest?.goal,
        level: eventLevel(ev),
      });
    }
  }

  return activityFeed
    .sort((a, b) => (b.ts ?? '').localeCompare(a.ts ?? ''))
    .slice(0, 200);
}

function eventLevel(ev) {
  if (ev.type === 'task_validated' && ev.status === 'FAIL') return 'fail';
  if (ev.type === 'validation_failed') return 'fail';
  if (ev.type === 'guardrail_triggered') return 'warn';
  if (ev.type === 'guardrail_overridden') return 'pass';
  if (ev.type === 'dor_gate_blocked') return 'blocked';
  if (/^retry_/.test(String(ev.type ?? ''))) return 'warn';
  if (ev.type === 'approval_gate_blocked') return 'blocked';
  if (ev.type === 'approval_gate') return 'pass';
  if (ev.type === 'quality_score_recorded') return 'pass';
  if (ev.type === 'session_shutdown') return 'dim';
  return 'info';
}
