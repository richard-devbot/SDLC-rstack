// owner: RStack developed by Richardson Gunde
//
// Security page module — renders into #page-security. Plain client JS
// concatenated into the served bundle by ui/client.js; self-registers its
// renderer with the page registry (ui/lib.js).
//
// #91: the page renders the REAL stage-12 threat model (threat_model.json)
// of the newest run in scope that produced one — STRIDE registry, severity
// heatmap, mitigation progress and release gate — instead of the earlier
// alert-count heuristic. When no threat model exists the page says exactly
// which stage produces it; it never fabricates a "no blocker" verdict.

export const securityScript = `
// ── page: security ────────────────────────────────────────────────
function threatSeverity(threat) {
  return String((threat && (threat.risk_level || threat.severity)) || 'UNRATED').toUpperCase();
}

function severityCounts(tm) {
  var summary = tm.threat_summary || {};
  if (summary.total_threats != null) {
    return {
      CRITICAL: Number(summary.critical_count) || 0,
      HIGH: Number(summary.high_count) || 0,
      MEDIUM: Number(summary.medium_count) || 0,
      LOW: Number(summary.low_count) || 0,
    };
  }
  var counts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  (tm.threats || []).forEach(function(threat) {
    var sev = threatSeverity(threat);
    if (counts[sev] != null) counts[sev]++;
  });
  return counts;
}

function mitigationStatus(threat) {
  var mit = threat && threat.mitigation;
  if (!mit || (!mit.description && !mit.type)) return null;
  return (mit.type ? String(mit.type) : 'recorded') + (mit.effort ? ' · ' + mit.effort + ' effort' : '');
}

function strideStrip(threats) {
  var by = {};
  (threats || []).forEach(function(threat) {
    var cat = threat.stride_category || 'Uncategorized';
    by[cat] = (by[cat] || 0) + 1;
  });
  return Object.keys(by).map(function(cat) { return chip(cat + ': ' + by[cat]); }).join('');
}

function securityRegistryRows(tm, runId) {
  var order = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, UNRATED: 4 };
  var threats = (tm.threats || []).slice().sort(function(a, b) {
    return (order[threatSeverity(a)] || 0) - (order[threatSeverity(b)] || 0);
  });
  return threats.slice(0, 50).map(function(threat) {
    var sev = threatSeverity(threat);
    var sevCls = sev === 'CRITICAL' ? 'critical' : sev === 'HIGH' ? 'fail' : sev === 'MEDIUM' ? 'warn' : 'info';
    var dread = threat.dread_score && threat.dread_score.overall != null ? '<div class="req-note mono">DREAD ' + esc(String(threat.dread_score.overall)) + '</div>' : '';
    var mit = mitigationStatus(threat);
    return '<tr><td>' + pill(sevCls, sev) + dread + '</td>' +
      '<td><div class="strong">' + esc(threat.title || threat.id || 'Threat') + '</div>' +
      '<div class="muted">' + esc(threat.stride_category || 'uncategorized') + (threat.affected_component ? ' · ' + esc(threat.affected_component) : '') + '</div>' +
      (threat.description ? '<div class="req-note">' + esc(String(threat.description).slice(0, 160)) + '</div>' : '') + '</td>' +
      '<td class="mono muted">' + esc(String(runId || '').slice(-24)) + '</td>' +
      '<td>' + (mit ? pill('pass', 'mitigation planned') + '<div class="req-note">' + esc(mit) + '</div>' : pill('warn', 'no mitigation') + '<div class="req-note">no mitigation recorded</div>') + '</td></tr>';
  }).join('');
}

function renderThreatModel(tm, runId) {
  var threats = tm.threats || [];
  var counts = severityCounts(tm);
  var mitigated = threats.filter(function(threat) { return mitigationStatus(threat) !== null; }).length;
  setText('security-threat-count', threats.length + ' threats · run ' + String(runId).slice(-24));
  setHTML('security-threat-heatmap',
    '<div class="heatmap heatmap-4">' +
    '<div class="heat crit"><b>' + counts.CRITICAL + '</b><span>critical</span></div>' +
    '<div class="heat high"><b>' + counts.HIGH + '</b><span>high</span></div>' +
    '<div class="heat med"><b>' + counts.MEDIUM + '</b><span>medium</span></div>' +
    '<div class="heat low"><b>' + counts.LOW + '</b><span>low</span></div></div>' +
    '<div class="stride-strip">' + strideStrip(threats) + '</div>' +
    '<div class="kv" style="margin-top:10px"><span>Mitigation progress</span><b>' + mitigated + ' of ' + threats.length + ' threats have a recorded mitigation</b></div>' +
    ((tm.trust_boundaries || []).length ? '<div class="kv"><span>Trust boundaries</span><b>' + tm.trust_boundaries.length + '</b></div>' : ''));
  var open = counts.CRITICAL + counts.HIGH;
  var gate = tm.release_gate;
  setHTML('security-release-gate', open > 0 || (gate && gate.ready === false)
    ? '<div class="alert-card warn"><div class="strong">Security release gate needs review</div><div class="muted">' +
      (open > 0 ? open + ' critical/high threat' + (open === 1 ? '' : 's') + ' open in the newest threat model. ' : '') +
      esc((gate && gate.reason) || 'Resolve or mitigate before shipment.') + '</div></div>'
    : '<div class="alert-card pass"><div class="strong">No critical or high threats open</div><div class="muted">Newest threat model reports ' + threats.length + ' threat' + (threats.length === 1 ? '' : 's') + ', none rated critical or high.</div></div>');
  setHTML('security-threat-registry', securityRegistryRows(tm, runId) ||
    '<tr><td colspan="4" class="empty">The threat model exists but lists no threats.</td></tr>');
}

function renderSecurityEmpty(reason) {
  setText('security-threat-count', 'no threat model');
  var explain = emptyHtml('No threat model yet', reason);
  setHTML('security-threat-heatmap', explain);
  setHTML('security-release-gate', '<div class="alert-card"><div class="strong">Release gate unknown</div><div class="muted">Without a stage-12 threat model there is no basis to claim the release is security-clean.</div></div>');
  setHTML('security-threat-registry', '<tr><td colspan="4">' + explain + '</td></tr>');
}

function renderSecurity(s) {
  var runs = s.runs || [];
  var securityRuns = runs.filter(function(run) { return (run.stageReports || []).indexOf('12-security-threat-model') !== -1; });
  if (!securityRuns.length) {
    renderSecurityEmpty('Stage 12 (security threat model) writes threat_model.json — the STRIDE registry, severity heatmap and mitigation status appear once a run in scope produces it.');
    return;
  }
  var run = securityRuns[0];
  fetchRunReport(run.runId).then(function(report) {
    var tm = report && report.stages && report.stages['12-security-threat-model'];
    if (!tm || tm._truncated) {
      renderSecurityEmpty('The stage-12 artifact for run ' + run.runId.slice(-24) + ' could not be read.');
      return;
    }
    renderThreatModel(tm, run.runId);
  });
}

registerPage('security', {
  errLabel: 'security',
  sub: 'STRIDE threat registry, severity heatmap, mitigation progress and release gate from the newest stage-12 threat model in scope.',
  render: renderSecurity
});
`;
