// owner: RStack developed by Richardson Gunde
//
// Agent Work page module — renders into #page-agent-work. Plain client JS
// concatenated into the served bundle by ui/client.js; self-registers its
// renderer with the page registry (ui/lib.js).

export const agentWorkScript = `
// ── page: agent-work ────────────────────────────────────────────────
function renderAgentWork(s) {
  var groups = s.agentGroups || groupAgentWork(s.agentWork || []);
  var workCount = (s.agentWork || []).length;
  setText('agent-work-count', workCount + ' actions');
  setHTML('agent-work-list', groups.map(function(group) {
    var agents = Object.keys(group.agents || {});
    return '<div class="agent-group">' +
      '<div class="agent-head"><div><div class="agent-title">' + esc(group.goal || group.runId) + '</div><div class="muted mono">' + esc(shortName(group.projectRoot)) + ' / ' + esc(group.runId) + '</div></div>' +
      '<div class="metric-row">' + pill('pass', group.passed + ' pass') + pill('fail', group.failed + ' fail') + pill('info', group.evidence + ' checks') + pill('warn', group.risks + ' risks') + '</div></div>' +
      '<div class="chips">' + agents.slice(0, 6).map(function(agent) { return chip(agent + ' x' + group.agents[agent]); }).join('') + '</div>' +
      '<div class="agent-items">' + (group.items || []).slice(0, 8).map(agentItemHtml).join('') + '</div>' +
    '</div>';
  }).join('') || emptyHtml('No agent contracts yet', 'builder.json and validation.json data appears here.'));
}

registerPage('agent-work', {
  errLabel: 'agent work',
  sub: 'Builder and validator work grouped by project, run, stage and agent contract.',
  render: renderAgentWork
});
`;
