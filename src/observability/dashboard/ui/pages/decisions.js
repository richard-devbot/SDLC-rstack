// owner: RStack developed by Richardson Gunde
//
// Decisions / Readiness page module — renders into #page-decisions. Plain client JS
// concatenated into the served bundle by ui/client.js; self-registers its
// renderer with the page registry (ui/lib.js).

export const decisionsScript = `
// ── page: decisions ────────────────────────────────────────────────
function renderDecisions(s) {
  var state = s.decisions || { runs: [], totals: {} };
  var runs = state.runs || [];
  var decisions = [];
  runs.forEach(function(run) {
    (run.decisions || []).forEach(function(decision) {
      decisions.push({ run: run, decision: decision });
    });
  });
  var pending = decisions.filter(function(item) { return item.decision.status === 'pending'; });
  setText('decisions-count', pending.length + ' pending / ' + decisions.length + ' total');
  setText('readiness-count', runs.length + ' runs');
  setHTML('decisions-list', decisions.slice(0, 40).map(function(item) {
    var d = item.decision;
    return '<div class="approval-card ' + esc(d.status || 'pending') + '"><div class="agent-head"><div><div class="strong">' + esc(d.decision_id + ' — ' + d.question) + '</div><div class="muted">' + esc(d.recommendation ? 'Recommendation: ' + d.recommendation : 'No recommendation recorded') + '</div><div class="feed-meta"><span>' + esc(d.impact) + '</span><span>before ' + esc(d.required_before_stage) + '</span><span>' + esc((item.run.runId || '').slice(-16)) + '</span></div></div>' + pill(d.status || 'pending', d.status || 'pending') + '</div></div>';
  }).join('') || emptyHtml('No decisions recorded', 'Use sdlc_decisions or rstack-agents decisions to add Decision Queue items.'));
  setHTML('readiness-list', runs.map(function(run) {
    var r = run.readiness || {};
    return '<div class="alert-card ' + (r.status === 'FAIL' ? 'fail' : r.status === 'WARN' ? 'warn' : 'pass') + '"><div class="agent-head"><div><div class="strong">' + esc(run.goal || run.runId) + '</div><div class="muted">' + esc(r.message || 'Definition-of-Ready status') + '</div><div class="feed-meta"><span>' + esc(run.profile || '') + '</span><span>' + esc(r.mode || '') + '</span><span>score ' + esc(r.score || 0) + '</span></div></div>' + pill(r.status || 'PASS') + '</div></div>';
  }).join('') || emptyHtml('No readiness data', 'Run sdlc_dor_check or rstack-agents dor after starting an RStack run.'));
}

registerPage('decisions', {
  errLabel: 'decisions',
  sub: 'Decision Queue and Definition-of-Ready status from decisions.json, dor-report.json and readiness.json.',
  render: renderDecisions
});
`;
