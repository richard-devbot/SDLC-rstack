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
    case 'stage_completed':
      return `Completed ${stageLabel(event.stage_id)} in ${fmtMs(event.elapsed_ms)}`;
    case 'task_validated':
      return event.status === 'PASS'
        ? `✅ Task passed — ${event.task_id ?? 'unknown'}`
        : `❌ Task failed — ${event.task_id ?? 'unknown'}`;
    case 'quality_score_recorded': {
      const pct = event.total_checks > 0
        ? Math.round((event.pass_checks / event.total_checks) * 100) : 0;
      return `Quality score ${pct}% — ${event.pass_checks ?? '?'}/${event.total_checks ?? '?'} checks passed (${event.task_id ?? ''})`;
    }
    case 'approval_gate':
      return `Approval gate: ${event.artifact ?? 'artifact'} — ${event.status ?? 'APPROVED'}`;
    case 'approval_gate_blocked':
      return `Approval required — missing: ${(event.missing ?? []).join(', ') || (event.reason ?? 'action blocked')}`;
    case 'clarification_answers_added': {
      const who = event.answered_by ? ` by ${event.answered_by}` : '';
      const preview = Array.isArray(event.answers) && event.answers.length
        ? ` — "${String(event.answers[0]).slice(0, 80)}"` : '';
      return `${event.count ?? ''} clarification answer${event.count !== 1 ? 's' : ''} added${who}${preview}`;
    }
    case 'task_started':
      return `Started task — ${event.task_id ?? 'unknown'}`;
    case 'builder_task_prepared':
      return `Builder prepared for task — ${event.task_id ?? 'unknown'}`;
    case 'run_started':
      return `Run started${event.task_count ? ` — ${event.task_count} tasks planned` : ''}`;
    case 'plan_created':
      return `Plan created — ${event.task_count ?? '?'} tasks`;
    case 'cost_recorded': {
      const rawCost = event.usd ?? event.cost ?? 0;
      const cost = Number(rawCost);
      return `Cost recorded: $${Number.isFinite(cost) ? cost.toFixed(4) : '0.0000'}`;
    }
    case 'guardrail_triggered':
      return `🛡 Guardrail blocked ${event.task_id ?? 'task'} — ${event.reason ?? event.limit_name ?? event.limit ?? 'budget exceeded'}`;
    case 'guardrail_overridden':
      return `🛡 Guardrail override consumed — ${event.task_id ?? 'task'} granted exactly one more attempt (${event.artifact ?? 'override'})`;
    case 'validation_failed':
      return `↻ Validation failed — attempt ${event.attempt ?? '?'}/${event.max_attempts ?? '?'} for ${event.task_id ?? 'task'}`;
    case 'task_retry_scheduled':
      return `↻ Retry ${event.attempt ?? '?'}/${event.max_attempts ?? '?'} scheduled — ${event.task_id ?? 'task'}: ${event.reason ?? 'validator requested another attempt'}`;
    case 'task_retry_exhausted':
      return `⛔ Retries exhausted (${event.attempt ?? '?'}/${event.max_attempts ?? '?'}) — ${event.task_id ?? 'task'} blocked pending guardrail-override${event.reason ? ` (${event.reason})` : ''}`;
    case 'task_human_context_required':
      return `⏸ Human context required — ${event.task_id ?? 'task'} paused after attempt ${event.attempt ?? '?'}/${event.max_attempts ?? '?'}: ${event.reason ?? 'validator needs more information'}`;
    case 'task_blocked_by_validator':
      return `⛔ Blocked by validator — ${event.task_id ?? 'task'}: ${event.reason ?? 'validation cannot proceed'}`;
    case 'dor_gate_blocked':
      return `Definition-of-Ready blocked ${event.task_id ?? 'task'} — pending: ${(event.pending_required ?? []).join(', ') || 'required decisions'}`;
    case 'memory_recalled':
      return `Memory recalled — ${event.count ?? 0} episodes injected`;
    case 'episode_memory_written':
      return `Memory saved — episode written for ${event.task_id ?? 'run'}`;
    case 'session_shutdown':
      return `Session ended`;
    case 'observer_new_run':
      return `New run detected: ${event.run_id?.slice(-12) ?? '?'}`;
    case 'loop_iteration_started':
      return `🔁 Goal-loop iteration ${event.iteration ?? '?'}/${event.max_iterations ?? '?'} started${event.goal_id ? ` — goal ${event.goal_id}` : ''}`;
    case 'goal_evaluated':
      return `🎯 Goal ${event.goal_id ?? '?'} evaluated: ${event.status ?? '?'} (score ${event.score ?? '?'})${event.reason ? ` — ${event.reason}` : ''}`;
    case 'loop_iteration_retrying_stages':
      return `↻ Loop iteration ${event.iteration ?? '?'}/${event.max_iterations ?? '?'} — resetting stages: ${(event.stages ?? []).join(', ') || 'none'}`;
    case 'loop_completed':
      return `✅ Goal loop complete — ${event.goal_id ?? 'goal'} met at iteration ${event.iteration ?? '?'} (score ${event.score ?? '?'})`;
    case 'loop_blocked':
      return `⛔ Goal loop stopped (${event.stopped_on ?? 'blocked'})${event.reason ? ` — ${event.reason}` : ''}`;
    default:
      // Retry-recovery events (BLE-3) share a retry_* prefix — render them
      // rather than dropping unknown loop-engineering signals from the feed.
      if (/^retry_/.test(String(event.type ?? ''))) {
        return `↻ ${String(event.type).replace(/_/g, ' ')} — ${event.task_id ?? event.stage_id ?? 'task'}${event.reason ? ` (${event.reason})` : ''}`;
      }
      return null;
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
