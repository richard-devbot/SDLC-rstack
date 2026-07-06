// owner: RStack developed by Richardson Gunde
//
// Security page module — renders into #page-security. Plain client JS
// concatenated into the served bundle by ui/client.js; self-registers its
// renderer with the page registry (ui/lib.js).

export const securityScript = `
// ── page: security ────────────────────────────────────────────────
function renderSecurity(s) {
  var runs = s.runs || [];
  var securityRuns = runs.filter(function(run) { return (run.stageReports || []).indexOf('12-security-threat-model') !== -1; });
  var alertRisks = (s.alerts || []).filter(function(alert) { return /security|threat|risk|gate/i.test(String(alert.title || alert.type || alert.detail || '')); });
  var high = alertRisks.length;
  // First-pass heuristic: all blocked gates are treated as medium-severity
  // security signals. Not every blocked gate is security-related (deployment
  // or architecture approvals also block), so this over-counts until #91 adds
  // a dedicated STRIDE/DREAD registry sourced from threat_model.json.
  var medium = Math.max(0, ((s.blockedGates || []).length));
  var low = securityRuns.length;
  setText('security-threat-count', (high + medium + low) + ' signals');
  setHTML('security-threat-heatmap', '<div class="heatmap"><div class="heat high"><b>' + high + '</b><span>high security/risk alerts</span></div><div class="heat med"><b>' + medium + '</b><span>blocked gates to review</span></div><div class="heat low"><b>' + low + '</b><span>runs with security stage</span></div></div>');
  setHTML('security-release-gate', high || medium ? '<div class="alert-card warn"><div class="strong">Security release gate needs review</div><div class="muted">Resolve open security/risk alerts and blocked gates before shipment.</div></div>' : '<div class="alert-card pass"><div class="strong">No security blocker detected</div><div class="muted">Threat model artifacts are present where the run produced them.</div></div>');
  var rows = (alertRisks.length ? alertRisks : securityRuns.slice(0, 20).map(function(run) { return { level: 'info', title: 'Security threat model produced', detail: 'Stage 12 artifact present', runId: run.runId }; })).slice(0, 30);
  setHTML('security-threat-registry', rows.map(function(item) {
    return '<tr><td>' + pill(item.level || 'info', item.level || 'info') + '</td><td><div class="strong">' + esc(item.title || item.type || 'Security signal') + '</div><div class="muted">' + esc(item.detail || '') + '</div></td><td class="mono muted">' + esc((item.runId || '').slice(-24)) + '</td><td>Review / mitigate</td></tr>';
  }).join('') || '<tr><td colspan="4" class="empty">No security stage artifacts or security alerts in scope.</td></tr>');
}

registerPage('security', {
  errLabel: 'security',
  sub: 'Threat registry and release-gate status from threat-model artifacts, open risks, and security-stage findings.',
  render: renderSecurity
});
`;
