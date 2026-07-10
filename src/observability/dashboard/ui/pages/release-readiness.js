// owner: RStack developed by Richardson Gunde
//
// Release Readiness page module — renders into #page-release-readiness. Plain client JS
// concatenated into the served bundle by ui/client.js; self-registers its
// renderer with the page registry (ui/lib.js).

export const releaseReadinessScript = `
// ── page: release-readiness ────────────────────────────────────────────────
function renderReleaseReadiness(s) {
  var readiness = s.readiness || {
    status: 'unknown', summary: 'Release readiness is unavailable in this snapshot.',
    coverage: { percent: null }, checks: [], blockers: [], evaluatedAt: null
  };
  var status = readiness.status || 'unknown';
  var labels = { blocked: 'Blocked', at_risk: 'At risk', ready: 'Ready', unknown: 'Unknown' };
  var verdicts = { blocked: 'BLOCKED', at_risk: 'AT RISK', ready: 'READY TO SHIP', unknown: 'NOT EVALUATED' };
  var tones = { blocked: 'danger', at_risk: 'warn', ready: 'ok', unknown: 'neutral' };
  var checks = readiness.checks || [];
  var blockers = readiness.blockers || [];
  var coverage = readiness.coverage || {};

  setText('release-readiness-verdict', verdicts[status] || 'NOT EVALUATED');
  setText('release-readiness-summary', readiness.summary || 'Release readiness is unavailable.');
  setText('release-readiness-chip', labels[status] || 'Unknown');
  setClass('release-readiness-chip', 'command-status readiness-signal ' + (tones[status] || 'neutral'));
  setText('release-readiness-count', coverage.percent === null || coverage.percent === undefined
    ? 'Coverage not evaluated'
    : coverage.percent + '% proof coverage');

  setHTML('release-readiness-checklist', checks.map(function(item) {
    var source = (item.sourceRefs || [])[0];
    var pillTone = item.status === 'pass' ? 'pass' : item.status === 'fail' ? 'fail' : item.status === 'warning' ? 'warn' : 'info';
    var pillLabel = item.status === 'pass' ? 'PASS' : item.status === 'fail' ? 'BLOCK' : item.status === 'warning' ? 'REVIEW' : 'UNKNOWN';
    return '<div class="command-row readiness-check ' + esc(item.status || 'unknown') + '"><div><div class="strong">' + esc(item.label || item.id) + '</div>' +
      '<div class="muted">' + esc(item.summary || '') + '</div>' +
      (source ? '<div class="source-ref mono">' + esc(source.path) + '</div>' : '') +
      '</div>' + pill(pillTone, pillLabel) + '</div>';
  }).join('') || emptyHtml('No readiness checks evaluated', 'Start a run or select a scope with task and pipeline data.'));

  setHTML('release-readiness-blockers', blockers.map(function(blocker) {
    var source = blocker.sourceRef || {};
    return '<div class="attention-item danger readiness-blocker"><div class="attention-value" aria-hidden="true">!</div><div><div class="attention-title">' +
      esc(blocker.label || 'Release blocker') + '</div><div class="attention-detail">' + esc(blocker.detail || '') + '</div>' +
      (source.path ? '<div class="source-ref mono">' + esc(source.path) + '</div>' : '') +
      '</div><span class="pill fail">BLOCK</span></div>';
  }).join('') || (status === 'ready'
    ? emptyHtml('No release blockers', 'Every required source in this scope is present, current and passing.')
    : emptyHtml('No hard blocker recorded', status === 'unknown'
      ? 'Readiness is not evaluated until run, validation and pipeline proof exists.'
      : 'Review the incomplete or cautionary checks before shipment.')));
}

registerPage('release-readiness', {
  errLabel: 'release readiness',
  sub: 'The conservative ship/no-ship view: blockers, test status, unresolved gates, evidence completeness, and manager actions.',
  render: renderReleaseReadiness
});
`;
