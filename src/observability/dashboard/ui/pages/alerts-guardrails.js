// owner: RStack developed by Richardson Gunde
//
// Alerts & Guardrails page module — renders into #page-alerts-guardrails. Plain client JS
// concatenated into the served bundle by ui/client.js; self-registers its
// renderer with the page registry (ui/lib.js).
//
// Loop-engineering depth (#156 remainder + #215 ops slice): retry state per
// task, guardrail triggers with limit-vs-value and override status, and
// context-pressure warnings. All three panels are derived from the recent
// server-composed event feed plus task/approval state already in the
// snapshot — nothing is fabricated, and each panel says when it is empty.

export const alertsGuardrailsScript = `
// ── page: alerts-guardrails ────────────────────────────────────────────────
// Panel injection uses opsEnsureSection, declared in pages/live-feed.js — the
// earliest-concatenated wave:ops module in the served bundle.
var OPS_ALERTS_PANELS_HTML =
  '<div class="panel" id="ops-retry-panel" style="margin-top:16px">' +
    '<div class="panel-head"><span class="panel-title">Retry State</span><span class="panel-note" id="ops-retry-count"></span></div>' +
    '<div class="panel-body"><div class="stack-list" id="ops-retry-list"></div>' +
    '<div class="ops-note">Derived from the recent event stream: retry scheduling, budget exhaustion and human-context pauses per task.</div></div>' +
  '</div>' +
  '<div class="grid-2" style="margin-top:16px">' +
    '<div class="panel" id="ops-guardrail-panel">' +
      '<div class="panel-head"><span class="panel-title">Guardrail Triggers</span><span class="panel-note" id="ops-guardrail-count"></span></div>' +
      '<div class="panel-body"><div class="stack-list" id="ops-guardrail-list"></div></div>' +
    '</div>' +
    '<div class="panel" id="ops-pressure-panel">' +
      '<div class="panel-head"><span class="panel-title">Context Pressure Warnings</span><span class="panel-note" id="ops-pressure-count"></span></div>' +
      '<div class="panel-body"><div class="stack-list" id="ops-pressure-list"></div></div>' +
    '</div>' +
  '</div>';

function renderAlertsGuardrails(s) {
  var alerts = s.alerts || [];
  var blocked = s.blockedGates || [];
  setText('alerts-count', alerts.length + ' alerts');
  setText('blocked-count', blocked.length + ' blocked gates');
  setHTML('alerts-list', alerts.map(alertHtml).join('') || emptyHtml('All clear', 'No thresholds are currently breached.'));
  setHTML('blocked-list', blocked.map(function(gate) {
    return '<div class="alert-card warn"><div class="strong">' + esc(gate.title) + '</div><div class="muted">' + esc(gate.detail) + '</div><div class="feed-meta"><span>' + esc(gate.runId || '') + '</span><span>' + timeHtml(gate.ts) + '</span></div></div>';
  }).join('') || emptyHtml('No blocked gates', 'Blocked approval gate history appears here.'));

  opsEnsureSection('alerts-guardrails', 'ops-retry-panel', OPS_ALERTS_PANELS_HTML);
  renderOpsRetryPanel(s);
  renderOpsGuardrailPanel(s);
  renderOpsPressurePanel(s);
}

function alertHtml(alert) {
  return '<div class="alert-card ' + esc(alert.level || 'info') + '"><div class="agent-head"><div><div class="strong">' + esc(alert.title || alert.type || 'Alert') + '</div><div class="muted">' + esc(alert.detail || '') + '</div><div class="feed-meta"><span>' + esc(alert.type || '') + '</span><span>' + esc(alert.runId || '') + '</span></div></div>' + pill(alert.level || 'info') + '</div></div>';
}

// ── Retry state (#156: retry traces) ────────────────────────────────────────
var OPS_RETRY_EVENT_TYPES = {
  task_retry_scheduled: 'scheduled',
  task_retry_exhausted: 'exhausted',
  task_human_context_required: 'human_required'
};

// retry_decision action → panel state (pinned #123 contract:
// action ∈ complete|retry|exhausted|human_context|block).
var OPS_DECISION_STATES = {
  retry: 'scheduled',
  exhausted: 'exhausted',
  human_context: 'human_required',
  block: 'validator_blocked',
  complete: 'resolved'
};

function opsRetryStateLabel(state) {
  if (state === 'scheduled') return pill('warn', 'retry scheduled');
  if (state === 'exhausted') return pill('fail', 'budget exhausted');
  if (state === 'human_required') return pill('blocked', 'human input required');
  if (state === 'validator_blocked') return pill('blocked', 'validator blocked');
  if (state === 'resolved') return pill('pass', 'resolved');
  if (state === 'blocked_unknown') return pill('blocked', 'blocked');
  return pill('info', state || 'unknown');
}

// Latest retry signal per task for one run, folded from the recent feed.
// Oldest-first; at EQUAL timestamps the action-specific event
// (task_retry_exhausted / _scheduled / _human_context_required) outranks the
// paired retry_decision — the emitter appends both in the same tick, decision
// first, and the specific event is the final word on the state. Without this
// tiebreak an exhausted task could render under the decision's mapping alone.
function opsRetryStateForRun(run, feed) {
  var items = [];
  feed.forEach(function(item) {
    if (item.runId !== run.runId) return;
    if (item.type !== 'retry_decision' && !OPS_RETRY_EVENT_TYPES[item.type]) return;
    if (!item.data || !item.data.task_id) return;
    items.push(item);
  });
  items.sort(function(a, b) {
    var byTs = String(a.ts || '').localeCompare(String(b.ts || ''));
    if (byTs !== 0) return byTs;
    return (a.type === 'retry_decision' ? 0 : 1) - (b.type === 'retry_decision' ? 0 : 1);
  });
  var byTask = {};
  items.forEach(function(item) {
    var d = item.data;
    var prev = byTask[d.task_id] || {};
    if (item.type === 'retry_decision') {
      byTask[d.task_id] = {
        state: OPS_DECISION_STATES[String(d.action || '').toLowerCase()] || prev.state || 'unknown',
        attempt: d.attempt != null ? d.attempt : prev.attempt,
        maxAttempts: d.max_attempts != null ? d.max_attempts : prev.maxAttempts,
        reason: d.reason || prev.reason,
        action: d.action || prev.action,
        nextStatus: d.next_status || prev.nextStatus,
        ts: item.ts
      };
    } else {
      byTask[d.task_id] = {
        state: OPS_RETRY_EVENT_TYPES[item.type],
        attempt: d.attempt != null ? d.attempt : prev.attempt,
        maxAttempts: d.max_attempts != null ? d.max_attempts : prev.maxAttempts,
        reason: d.reason || prev.reason,
        action: prev.action,
        nextStatus: prev.nextStatus,
        ts: item.ts
      };
    }
  });
  return byTask;
}

function opsRetryRowHtml(run, task, info) {
  var attempts = info && info.attempt != null
    ? 'attempt ' + info.attempt + (info.maxAttempts != null ? '/' + info.maxAttempts : '')
    : '';
  var decisionMeta = info && (info.action || info.nextStatus)
    ? 'decision: ' + (info.action || '?') + (info.nextStatus ? ' → ' + info.nextStatus : '')
    : '';
  return '<div class="alert-card ' + (info && info.state === 'scheduled' ? 'warn' : 'critical') + '"><div class="agent-head"><div>' +
    '<div class="strong mono">' + esc(task.id) + (task.stageId ? ' <span class="muted">(' + esc(task.stageId) + ')</span>' : '') + '</div>' +
    (info && info.reason ? '<div class="muted">' + esc(info.reason) + '</div>' : '') +
    (!info ? '<div class="muted">Task is BLOCKED — cause outside the recent event window (validator, DoR, destructive-gate or attempt budget; no retry evidence in view).</div>' : '') +
    '<div class="feed-meta"><span>' + esc((run.runId || '').slice(-16)) + '</span>' + (attempts ? '<span>' + esc(attempts) + '</span>' : '') + (decisionMeta ? '<span>' + esc(decisionMeta) + '</span>' : '') + '<span>task status: ' + esc(task.status || 'READY') + '</span></div>' +
    // "budget exhausted" is earned only by real task_retry_exhausted /
    // exhausted-decision evidence — a BLOCKED task without in-window events
    // gets the generic blocked pill, never a fabricated cause.
    '</div>' + opsRetryStateLabel(info ? info.state : 'blocked_unknown') + '</div></div>';
}

function renderOpsRetryPanel(s) {
  var feed = s.feed || [];
  var rows = [];
  (s.runs || []).forEach(function(run) {
    var byTask = opsRetryStateForRun(run, feed);
    (run.tasks || []).forEach(function(task) {
      var info = byTask[task.id] || null;
      if (!info && task.status !== 'BLOCKED') return;
      rows.push(opsRetryRowHtml(run, task, info));
    });
  });
  setText('ops-retry-count', rows.length + ' task(s) in retry flow');
  setHTML('ops-retry-list', rows.join('') || emptyHtml('No retry activity', 'No task in the recent event window has needed a second attempt or hit its attempt budget.'));
}

// ── Guardrail triggers + override status (#156: guardrail depth) ────────────
function opsOverrideStatusHtml(runId, taskId, s) {
  if (!taskId) return '<div class="ops-note">No task id on this trigger — cannot look up an override.</div>';
  var artifact = 'guardrail-override:' + taskId;
  var consumed = (s.feed || []).some(function(item) {
    return item.type === 'guardrail_overridden' && item.runId === runId && item.data && item.data.task_id === taskId;
  });
  if (consumed) return '<div class="ops-note">Override consumed — exactly one extra attempt was granted, then the gate re-armed.</div>';
  var record = null;
  (s.runs || []).forEach(function(run) {
    if (run.runId !== runId) return;
    (run.approvals || []).forEach(function(approval) {
      if (approval.artifact === artifact) record = approval;
    });
  });
  if (!record) return '<div class="ops-note">No override on file — the task stays blocked until a ' + esc(artifact) + ' approval is granted.</div>';
  var status = String(record.status || '').toUpperCase();
  if (status === 'APPROVED') return '<div class="ops-note">Override approved' + (record.approver ? ' by ' + esc(record.approver) : '') + ' — the next claim gets exactly one attempt.</div>';
  if (status === 'REJECTED') return '<div class="ops-note">Override rejected' + (record.approver ? ' by ' + esc(record.approver) : '') + ' — the task stays blocked.</div>';
  return '<div class="ops-note">Override request on file (status: ' + esc(record.status || 'pending') + ').</div>';
}

function renderOpsGuardrailPanel(s) {
  var items = (s.feed || []).filter(function(item) { return item.type === 'guardrail_triggered'; }).slice(0, 20);
  setText('ops-guardrail-count', items.length + ' trigger(s)');
  setHTML('ops-guardrail-list', items.map(function(item) {
    var d = item.data || {};
    var limit = d.limit_name || 'guardrail';
    var values = d.current_value != null && d.limit_value != null
      ? 'value ' + d.current_value + ' hit limit ' + d.limit_value
      : (d.reason || 'limit reached');
    return '<div class="alert-card warn"><div class="agent-head"><div>' +
      '<div class="strong">' + esc(limit) + '</div>' +
      '<div class="muted">' + esc(values) + (d.task_id ? ' — task ' + esc(d.task_id) : '') + '</div>' +
      '<div class="feed-meta"><span>' + esc((item.runId || '').slice(-16)) + '</span><span>' + timeHtml(item.ts) + '</span></div>' +
      opsOverrideStatusHtml(item.runId, d.task_id, s) +
      '</div>' + pill('blocked', 'blocked') + '</div></div>';
  }).join('') || emptyHtml('No guardrail triggers', 'No guardrail has blocked a task in the recent event window.'));
}

// ── Context pressure warnings (#215 / #211) ─────────────────────────────────
function renderOpsPressurePanel(s) {
  var items = (s.feed || []).filter(function(item) { return item.type === 'context_pressure_warning'; }).slice(0, 20);
  setText('ops-pressure-count', items.length + ' warning(s)');
  setHTML('ops-pressure-list', items.map(function(item) {
    var d = item.data || {};
    var size = d.size != null && d.threshold != null
      ? d.size + ' vs threshold ' + d.threshold + (d.metric ? ' ' + d.metric : '')
      : 'size unavailable';
    return '<div class="alert-card info"><div class="agent-head"><div>' +
      '<div class="strong">' + esc(d.source || 'context') + '</div>' +
      '<div class="muted">' + esc(size) + (d.task_id ? ' — task ' + esc(d.task_id) : '') + (d.stage_id ? ' (' + esc(d.stage_id) + ')' : '') + '</div>' +
      '<div class="feed-meta"><span>' + esc((item.runId || '').slice(-16)) + '</span><span>' + timeHtml(item.ts) + '</span></div>' +
      '<div class="ops-note">Detect-only warning — nothing was pruned or truncated.</div>' +
      '</div>' + pill('warn', 'pressure') + '</div></div>';
  }).join('') || emptyHtml('No context pressure warnings', 'Builder context stayed under every configured threshold in the recent event window.'));
}

registerPage('alerts-guardrails', {
  errLabel: 'alerts',
  sub: 'Threshold alerts, blocked gates, guardrails, retry state, context pressure, stalled work and spend risks.',
  unscoped: true,
  render: renderAlertsGuardrails
});
`;
