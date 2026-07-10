// owner: RStack developed by Richardson Gunde
//
// Release Readiness page module — renders into #page-release-readiness. Plain client JS
// concatenated into the served bundle by ui/client.js; self-registers its
// renderer with the page registry (ui/lib.js).

export const releaseReadinessScript = `
// ── page: release-readiness ────────────────────────────────────────────────
function renderReleaseReadiness(s) {
  var tasks = allTasks(s);
  var counts = taskStatusCounts(tasks);
  var blocked = (s.blockedGates || []).length;
  var alerts = (s.alerts || []).length;
  var pending = (s.pendingApprovals || []).length;
  var missingValidation = (s.diagnostics && s.diagnostics.missingValidationCount) || 0;
  var passEvidence = (s.diagnostics && s.diagnostics.evidenceCount) || 0;
  var checks = [
    { name: 'Tests passing', ok: counts.FAIL === 0, detail: counts.PASS + ' passed / ' + counts.FAIL + ' failed' },
    { name: 'Approval gates resolved', ok: blocked === 0 && pending === 0, detail: blocked + ' blocked gates, ' + pending + ' pending approvals' },
    { name: 'Validation evidence attached', ok: missingValidation === 0, detail: passEvidence + ' evidence records, ' + missingValidation + ' missing validations' },
    { name: 'Operational alerts clear', ok: alerts === 0, detail: alerts + ' active alerts' }
  ];
  var blockedCount = checks.filter(function(c) { return !c.ok; }).length;
  var verdict = blockedCount ? 'BLOCKED — ' + blockedCount + ' release condition' + (blockedCount === 1 ? '' : 's') + ' need work' : 'READY TO SHIP';
  setText('release-readiness-verdict', verdict);
  setText('release-readiness-chip', blockedCount ? 'Blocked' : 'Ready');
  setClass('release-readiness-chip', 'command-status ' + (blockedCount ? 'warn' : 'ok'));
  setText('release-readiness-count', checks.filter(function(c) { return c.ok; }).length + '/' + checks.length + ' passed');
  setHTML('release-readiness-checklist', checks.map(function(check) {
    return '<div class="command-row"><div><div class="strong">' + esc(check.name) + '</div><div class="muted">' + esc(check.detail) + '</div></div>' + pill(check.ok ? 'pass' : 'warn', check.ok ? 'PASS' : 'BLOCK') + '</div>';
  }).join(''));
  setHTML('release-readiness-blockers', checks.filter(function(c) { return !c.ok; }).map(function(check) {
    return '<div class="attention-item warn"><div class="attention-value">!</div><div><div class="attention-title">' + esc(check.name) + '</div><div class="attention-detail">' + esc(check.detail) + '</div></div><span class="pill warn">ACTION</span></div>';
  }).join('') || emptyHtml('No release blockers', 'This scoped data is ready by the conservative dashboard checks.'));
}

registerPage('release-readiness', {
  errLabel: 'release readiness',
  sub: 'The conservative ship/no-ship view: blockers, test status, unresolved gates, evidence completeness, and manager actions.',
  render: renderReleaseReadiness
});
`;
