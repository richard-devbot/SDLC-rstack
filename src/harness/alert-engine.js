// owner: RStack developed by Richardson Gunde

export const DEFAULT_ALERT_THRESHOLDS = Object.freeze({
  costPerRunUsd:     0.50,
  totalDailyCostUsd: 5.00,
  guardrailHitRate:  0.20,   // fraction of tasks that hit guardrails
  failureRate:       0.30,   // fraction of tasks that fail
  pendingApprovals:  1,      // any pending approval triggers alert
  stalledRunMinutes: 30,     // run with no events for this long
});

export function evaluateAlerts(state, thresholds = DEFAULT_ALERT_THRESHOLDS) {
  const alerts = [];
  const now = Date.now();

  for (const run of (state.runs ?? [])) {
    const m = run.metrics ?? {};
    const cost = m.cumulative_cost_usd ?? 0;
    const tasks = run.tasks ?? [];
    const failed = tasks.filter(t => t.status === 'FAIL').length;
    const guardrailHits = m.guardrail_hits ?? 0;

    if (cost >= thresholds.costPerRunUsd) {
      alerts.push({
        id: `cost-${run.runId}`,
        level: cost >= thresholds.costPerRunUsd * 2 ? 'critical' : 'warn',
        type: 'cost_threshold',
        title: 'Run cost threshold exceeded',
        detail: `Run ${run.runId.slice(-12)} cost $${cost.toFixed(4)} (limit $${thresholds.costPerRunUsd})`,
        runId: run.runId,
        ts: now,
      });
    }

    if (tasks.length > 0 && failed / tasks.length >= thresholds.failureRate) {
      alerts.push({
        id: `fail-${run.runId}`,
        level: 'warn',
        type: 'failure_rate',
        title: 'High failure rate',
        detail: `${failed}/${tasks.length} tasks failed in run ${run.runId.slice(-12)}`,
        runId: run.runId,
        ts: now,
      });
    }

    if (tasks.length > 0 && guardrailHits / tasks.length >= thresholds.guardrailHitRate) {
      alerts.push({
        id: `guardrail-${run.runId}`,
        level: 'warn',
        type: 'guardrail_rate',
        title: 'Guardrail hit rate elevated',
        detail: `${guardrailHits} guardrail hits across ${tasks.length} tasks`,
        runId: run.runId,
        ts: now,
      });
    }

    // Stalled run: active (no completed_at) but no recent events
    if (!run.manifest?.completed_at && run.events?.length > 0) {
      const lastEvent = run.events[run.events.length - 1];
      const lastTs = lastEvent?.ts ? new Date(lastEvent.ts).getTime() : 0;
      const staleMs = thresholds.stalledRunMinutes * 60 * 1000;
      if (lastTs && now - lastTs > staleMs) {
        alerts.push({
          id: `stalled-${run.runId}`,
          level: 'warn',
          type: 'stalled_run',
          title: 'Run may be stalled',
          detail: `No activity in ${run.runId.slice(-12)} for ${Math.round((now - lastTs) / 60000)} min`,
          runId: run.runId,
          ts: now,
        });
      }
    }
  }

  // Daily cost alert
  const dailyCost = (state.runs ?? []).reduce((s, r) => s + (r.metrics?.cumulative_cost_usd ?? 0), 0);
  if (dailyCost >= thresholds.totalDailyCostUsd) {
    alerts.push({
      id: 'daily-cost',
      level: dailyCost >= thresholds.totalDailyCostUsd * 2 ? 'critical' : 'warn',
      type: 'daily_cost',
      title: 'Daily cost threshold exceeded',
      detail: `Total today: $${dailyCost.toFixed(4)} (limit $${thresholds.totalDailyCostUsd})`,
      ts: now,
    });
  }

  // Pending approvals
  const pending = state.pendingApprovals ?? 0;
  if (pending >= thresholds.pendingApprovals) {
    alerts.push({
      id: 'pending-approvals',
      level: 'info',
      type: 'pending_approvals',
      title: `${pending} action${pending > 1 ? 's' : ''} awaiting your approval`,
      detail: 'Open the Approvals tab to review and act',
      ts: now,
    });
  }

  return alerts;
}

export function plainLanguageSummary(event) {
  switch (event.type) {
    case 'stage_completed':  return `Completed ${stageLabel(event.stage_id)} in ${fmtMs(event.elapsed_ms)}`;
    case 'task_validated':   return event.status === 'PASS'
      ? `Task passed — ${event.task_id ?? 'unknown'}`
      : `Task failed — ${event.task_id ?? 'unknown'}`;
    case 'run_started':      return `New run started`;
    case 'plan_created':     return `Plan created with ${event.task_count ?? '?'} tasks`;
    case 'cost_recorded':    return `Cost recorded: $${Number(event.usd ?? event.cost ?? 0).toFixed(4)}`;
    case 'guardrail_triggered': return `Guardrail hit: ${event.limit_name ?? event.limit ?? '?'}`;
    case 'memory_recalled':  return `Memory: ${event.count ?? 0} episodes recalled`;
    case 'approval_gate_blocked': return `Approval required — ${event.reason ?? 'action blocked'}`;
    case 'observer_new_run': return `New run detected: ${event.run_id?.slice(-12) ?? '?'}`;
    default: return null;
  }
}

function stageLabel(id) {
  const MAP = {
    '00-environment':'Environment setup','01-transcript':'Transcript parse',
    '02-requirements':'Requirements','03-documentation':'Documentation',
    '04-planning':'Planning','05-jira':'Jira tickets','06-architecture':'Architecture',
    '07-code':'Code generation','08-testing':'Testing','09-deployment':'Deployment',
    '10-summary':'Summary','11-feedback-loop':'Feedback','12-security-threat-model':'Security',
    '13-compliance-checker':'Compliance','14-cost-estimation':'Cost estimate',
  };
  return MAP[id] ?? id ?? 'stage';
}

function fmtMs(ms) {
  if (!ms) return '—';
  if (ms < 1000) return ms + 'ms';
  if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
  return Math.round(ms / 60000) + 'min';
}
