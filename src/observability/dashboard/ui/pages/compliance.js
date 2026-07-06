// owner: RStack developed by Richardson Gunde
//
// Compliance page module — renders into #page-compliance. Plain client JS
// concatenated into the served bundle by ui/client.js; self-registers its
// renderer with the page registry (ui/lib.js).

export const complianceScript = `
// ── page: compliance ────────────────────────────────────────────────
function renderCompliance(s) {
  var runs = s.runs || [];
  var complianceRuns = runs.filter(function(run) { return (run.stageReports || []).indexOf('13-compliance-checker') !== -1; });
  var evidence = (s.diagnostics && s.diagnostics.evidenceCount) || 0;
  var tasks = (s.diagnostics && s.diagnostics.taskCount) || allTasks(s).length;
  var coverage = tasks ? Math.min(100, Math.round((evidence / tasks) * 100)) : 0;
  setText('compliance-score-count', complianceRuns.length + ' compliance runs');
  setHTML('compliance-scorecards', [
    { name: 'Audit evidence coverage', value: coverage + '%', detail: evidence + ' evidence records / ' + tasks + ' tasks' },
    { name: 'Compliance stage coverage', value: complianceRuns.length, detail: 'runs with 13-compliance-checker output' },
    { name: 'Validation gaps', value: (s.diagnostics && s.diagnostics.missingValidationCount) || 0, detail: 'missing validation contracts' }
  ].map(function(card) { return '<div class="command-row"><div><div class="strong">' + esc(card.name) + '</div><div class="muted">' + esc(card.detail) + '</div></div><div class="side-v mini">' + esc(card.value) + '</div></div>'; }).join(''));
  setHTML('compliance-controls', complianceRuns.length ? '<div class="stack-list">' + complianceRuns.slice(0, 12).map(function(run) { return '<div class="command-row"><div><div class="strong">Compliance report available</div><div class="muted mono">' + esc(run.runId) + '</div></div>' + pill('pass', 'report') + '</div>'; }).join('') + '</div>' : emptyHtml('Compliance stage not run in this scope', 'Run stage 13 or select a run that produced compliance_report.json.'));
}

registerPage('compliance', {
  errLabel: 'compliance',
  sub: 'Control coverage, audit gaps, evidence status, and compliance readiness across SDLC runs.',
  render: renderCompliance
});
`;
