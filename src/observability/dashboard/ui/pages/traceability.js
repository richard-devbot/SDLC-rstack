// owner: RStack developed by Richardson Gunde
//
// Requirements & Traceability page module — renders into #page-traceability. Plain client JS
// concatenated into the served bundle by ui/client.js; self-registers its
// renderer with the page registry (ui/lib.js).

export const traceabilityScript = `
// ── page: traceability ────────────────────────────────────────────────
function renderTraceability(s) {
  var traces = s.traceMap || [];
  setHTML('traceability-list', traces.map(function(trace) {
    var steps = [
      ['Requirements', trace.stages && trace.stages.requirements],
      ['Architecture', trace.stages && trace.stages.architecture],
      ['Code', trace.stages && trace.stages.code],
      ['Testing', trace.stages && trace.stages.testing]
    ].map(function(step) {
      return '<span class="trace-step ' + (step[1] ? 'done' : '') + '">' + esc(step[0]) + '</span>';
    }).join('');
    var reqs = (trace.requirements || []).slice(0, 5).map(function(req) {
      return '<div class="agent-item"><div class="mono faint">' + esc(req.id || req.area || 'requirement') + '</div><div>' + esc((req.description || req.title || req.text || '').slice(0, 170)) + '</div></div>';
    }).join('');
    var tasks = (trace.passTasks || []).slice(0, 6).map(function(task) {
      return '<div class="agent-item"><div class="strong">' + esc(task.title || task.id) + '</div><div class="muted mono">' + esc(task.id) + ' / ' + (task.evidenceCount || 0) + ' checks</div></div>';
    }).join('');
    return '<div class="trace-card"><div class="agent-head"><div><div class="agent-title">' + esc(trace.goal || trace.runId) + '</div><div class="muted mono">' + esc(shortName(trace.projectRoot)) + ' / ' + esc(trace.runId) + '</div></div>' + pill('pass', (trace.evidenceTotal || 0) + ' checks') + '</div><div class="trace-flow">' + steps + '</div><div class="grid-2" style="margin-top:12px"><div>' + (reqs || emptyHtml('No requirements', '')) + '</div><div>' + (tasks || emptyHtml('No verified tasks', '')) + '</div></div></div>';
  }).join('') || emptyHtml('No traceability data', 'Requirements and evidence appear after stage artifacts are written.'));
}

registerPage('traceability', {
  errLabel: 'traceability',
  sub: 'FR/NFR requirements, stage artifacts, verified tasks and evidence connected by run.',
  render: renderTraceability
});
`;
