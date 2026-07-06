// owner: RStack developed by Richardson Gunde
//
// Team & Presence page module — renders into #page-team. Plain client JS
// concatenated into the served bundle by ui/client.js; self-registers its
// renderer with the page registry (ui/lib.js).

export const teamPresenceScript = `
// ── page: team ────────────────────────────────────────────────
// ── Team & Presence page (issue #42) ────────────────────────────────────────
function renderTeam(s) {
  var presence = s.presence || [];
  var live = presence.filter(function(item) { return item.live; });
  setText('team-live-count', live.length + ' live / ' + presence.length + ' recent');
  setHTML('team-live', presence.map(function(item) {
    var dot = item.live ? '<span class="presence-dot live"></span>' : '<span class="presence-dot"></span>';
    var task = item.currentTask
      ? chip((item.currentTask.agent || 'agent') + ' → ' + item.currentTask.title)
      : '<span class="muted">between tasks</span>';
    return '<div class="stack-item clickable" data-runid="' + esc(item.runId) + '" onclick="openDrawerRow(this)">' +
      '<div>' + dot + '<span class="strong">' + esc(item.startedBy) + '</span> <span class="muted">on</span> ' + esc(shortName(item.projectRoot)) + '' +
      '<div class="muted">' + esc(item.goal) + '</div></div>' +
      '<div class="metric-row">' + task + '<span class="faint mono">' + fmtAgo(item.secondsAgo) + '</span></div>' +
    '</div>';
  }).join('') || emptyHtml('Nobody live right now', 'Runs with events in the last 30 minutes appear here.'));

  var people = s.people || [];
  setText('team-people-count', people.length + ' people');
  setHTML('team-people-table', people.map(function(person) {
    return '<tr>' +
      '<td><div class="strong">' + esc(person.name) + '</div>' + (person.email ? '<div class="faint mono">' + esc(person.email) + '</div>' : '') + '</td>' +
      '<td class="mono">' + person.runsStarted + '</td>' +
      '<td class="mono">' + person.approvals + (person.rejections ? ' <span class="muted">/ ' + person.rejections + ' rejected</span>' : '') + '</td>' +
      '<td class="mono">' + person.guidance + '</td>' +
      '<td class="mono muted">' + (person.lastSeen ? fmtTime(person.lastSeen) : '-') + '</td>' +
    '</tr>';
  }).join('') || '<tr><td colspan="5" class="empty">No people yet — runs started after the people layer record who did what</td></tr>');

  var projects = s.projectSummaries || [];
  var blocked = s.blockedGates || [];
  var runs = s.runs || [];
  setText('team-manager-count', projects.length + ' projects');
  setHTML('team-manager-table', projects.map(function(project) {
    var projectRuns = runs.filter(function(run) { return run.projectRoot === project.projectRoot; });
    var durations = projectRuns.map(function(run) { return (run.totals || {}).duration_ms || 0; }).filter(Boolean);
    var avg = durations.length ? durations.reduce(function(sum, ms) { return sum + ms; }, 0) / durations.length : 0;
    var total = project.passed + project.failed;
    var rate = total ? Math.round(project.passed / total * 100) : 0;
    var gates = blocked.filter(function(gate) { return projectRuns.some(function(run) { return run.runId === gate.runId; }); }).length;
    return '<tr>' +
      '<td><div class="strong">' + esc(project.name) + '</div></td>' +
      '<td class="mono">' + project.runs + (project.active ? ' <span class="muted">(' + project.active + ' active)</span>' : '') + '</td>' +
      '<td class="mono">' + fmtDur(avg) + '</td>' +
      '<td class="mono">' + rate + '%</td>' +
      '<td class="mono">' + (gates ? '<span class="strong">' + gates + '</span>' : '0') + '</td>' +
    '</tr>';
  }).join('') || '<tr><td colspan="5" class="empty">No projects yet</td></tr>');

  var guidanceFeed = (s.feed || []).filter(function(item) { return item.type === 'clarification_answers_added'; });
  setText('team-guidance-count', guidanceFeed.length + ' entries');
  setHTML('team-guidance', guidanceFeed.slice(0, 30).map(feedRowHtml).join('') ||
    emptyHtml('No guidance recorded yet', 'When a developer answers clarification questions, it shows up here with their name.'));
}

registerPage('team', {
  errLabel: 'team',
  sub: 'Who is live and working right now, the people behind every run, approval and guidance, and the manager project rollup.',
  render: renderTeam
});
`;
