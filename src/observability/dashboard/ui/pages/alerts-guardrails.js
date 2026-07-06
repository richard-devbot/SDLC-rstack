// owner: RStack developed by Richardson Gunde
//
// Alerts & Guardrails page module — renders into #page-alerts-guardrails. Plain client JS
// concatenated into the served bundle by ui/client.js; self-registers its
// renderer with the page registry (ui/lib.js).

export const alertsGuardrailsScript = `
// ── page: alerts-guardrails ────────────────────────────────────────────────
function renderAlertsGuardrails(s) {
  var alerts = s.alerts || [];
  var blocked = s.blockedGates || [];
  setText('alerts-count', alerts.length + ' alerts');
  setText('blocked-count', blocked.length + ' blocked gates');
  setHTML('alerts-list', alerts.map(alertHtml).join('') || emptyHtml('All clear', 'No thresholds are currently breached.'));
  setHTML('blocked-list', blocked.map(function(gate) {
    return '<div class="alert-card warn"><div class="strong">' + esc(gate.title) + '</div><div class="muted">' + esc(gate.detail) + '</div><div class="feed-meta"><span>' + esc(gate.runId || '') + '</span><span>' + esc(fmtTime(gate.ts)) + '</span></div></div>';
  }).join('') || emptyHtml('No blocked gates', 'Blocked approval gate history appears here.'));
}

function alertHtml(alert) {
  return '<div class="alert-card ' + esc(alert.level || 'info') + '"><div class="agent-head"><div><div class="strong">' + esc(alert.title || alert.type || 'Alert') + '</div><div class="muted">' + esc(alert.detail || '') + '</div><div class="feed-meta"><span>' + esc(alert.type || '') + '</span><span>' + esc(alert.runId || '') + '</span></div></div>' + pill(alert.level || 'info') + '</div></div>';
}

registerPage('alerts-guardrails', {
  errLabel: 'alerts',
  sub: 'Threshold alerts, blocked gates, guardrails, stalled work and spend risks.',
  unscoped: true,
  render: renderAlertsGuardrails
});
`;
