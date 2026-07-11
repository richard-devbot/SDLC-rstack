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
  ensureDecisionLogPanel();
  renderDecisionLog(decisions);
}

// ── [wave:command] Decision Log (#94) ──────────────────────────────
// Beyond the pending queue: the chronological record of decisions a human
// already made — who resolved or waived it, when, what the call was, and
// which run it governs. The panel is injected by this module (the page
// skeleton in ui/pages/index.js is shared across parallel page work).
function ensureDecisionLogPanel() {
  if (document.getElementById('decisions-log-panel')) return;
  var page = document.getElementById('page-decisions');
  if (!page) return;
  var grid = page.querySelector('.grid-2');
  if (!grid) return;
  grid.insertAdjacentHTML('afterend',
    '<div class="panel decision-log-panel" id="decisions-log-panel">' +
      '<div class="panel-head"><span class="panel-title">Decision Log</span><span class="panel-note" id="decisions-log-count"></span></div>' +
      '<div class="panel-body"><div class="stack-list" id="decisions-log"></div></div>' +
    '</div>');
}

function decisionResolvedTs(decision) {
  return decision.resolved_at || decision.updated_at || decision.created_at || '';
}

function renderDecisionLog(decisions) {
  var resolved = decisions.filter(function(item) {
    var status = item.decision.status;
    return status === 'resolved' || status === 'waived';
  }).sort(function(a, b) {
    return decisionResolvedTs(b.decision).localeCompare(decisionResolvedTs(a.decision));
  });
  setText('decisions-log-count', resolved.length + ' resolved or waived');
  if (!resolved.length) {
    setHTML('decisions-log', emptyHtml('No resolved decisions yet',
      'When someone resolves or waives a Decision Queue item, the who / when / what lands here as the audit trail.'));
    return;
  }
  setHTML('decisions-log', resolved.slice(0, 60).map(decisionLogRowHtml).join(''));
}

function decisionLogRowHtml(item) {
  var d = item.decision;
  var who = d.resolved_by || 'unrecorded decider';
  var verb = d.status === 'waived' ? 'Waived' : 'Resolved';
  var outcome = d.resolution
    ? 'Decision: ' + d.resolution
    : (d.status === 'waived' ? 'Waived without a recorded resolution.' : 'No resolution text recorded.');
  return '<div class="decision-log-row">' +
    '<div class="decision-log-when mono">' + timeHtml(decisionResolvedTs(d)) + '</div>' +
    '<div class="decision-log-main">' +
      '<div class="strong">' + esc(d.decision_id + ' — ' + d.question) + '</div>' +
      '<div class="muted">' + esc(outcome) + '</div>' +
      '<div class="feed-meta">' +
        '<span>' + esc(verb + ' by ' + who) + '</span>' +
        '<span>impact: ' + esc(d.impact || 'scope') + '</span>' +
        '<span>gated stage ' + esc(d.required_before_stage || '-') + '</span>' +
        '<button class="chip clickable" tabindex="0" data-runid="' + esc(item.run.runId || '') + '" onclick="openDrawerRow(this)" aria-label="Open run details">run ' + esc((item.run.runId || '').slice(-16)) + '</button>' +
      '</div>' +
    '</div>' +
    pill(d.status === 'waived' ? 'warn' : 'pass', d.status) +
  '</div>';
}
// ── end [wave:command] ─────────────────────────────────────────────

registerPage('decisions', {
  errLabel: 'decisions',
  sub: 'Decision Queue, Decision Log and Definition-of-Ready status from decisions.json, dor-report.json and readiness.json.',
  render: renderDecisions
});
`;
