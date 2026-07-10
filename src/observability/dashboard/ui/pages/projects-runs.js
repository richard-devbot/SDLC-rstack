// owner: RStack developed by Richardson Gunde
//
// Projects & Runs page module — renders into #page-projects. Plain client JS
// concatenated into the served bundle by ui/client.js; self-registers its
// renderer with the page registry (ui/lib.js).
//
// #97: each run row carries a stage-report strip — how many of the 15 stages
// produced an artifact, with named chips for the historically dark trio
// (01-transcript "Brief", 03-documentation "Docs", 11-feedback-loop
// "Feedback") so those deliverables stop being invisible at run level.

export const projectsRunsScript = `
// ── page: projects ────────────────────────────────────────────────
// The dark-stage trio (#97): named so a manager can spot at a glance that a
// run has a project brief, a documentation set, or a consistency review.
var DARK_STAGE_CHIPS = [
  ['01-transcript', 'Brief'],
  ['03-documentation', 'Docs'],
  ['11-feedback-loop', 'Feedback']
];

function runStageStrip(run) {
  var produced = run.stageReports || [];
  var named = DARK_STAGE_CHIPS.filter(function(entry) { return produced.indexOf(entry[0]) !== -1; })
    .map(function(entry) { return chip(entry[1]); }).join('');
  return '<div class="run-stage-strip">' + chip(produced.length + '/' + STAGE_IDS.length + ' stage reports') + named + '</div>';
}

function renderProjects(s) {
  var projects = s.projectSummaries || [];
  var runs = s.runs || [];
  setText('projects-count', projects.length + ' roots');
  setText('runs-count', runs.length + ' runs');
  setHTML('projects-grid', projects.map(function(project) {
    var total = project.passed + project.failed;
    var rate = total ? Math.round(project.passed / total * 100) : 0;
    return '<div class="project-card">' +
      '<div><div class="strong">' + esc(project.name) + '</div><div class="project-path mono">' + esc(project.projectRoot) + '</div></div>' +
      '<div class="metric-row">' + pill('info', project.runs + ' runs') + pill('active', project.active + ' active') + pill('pass', project.passed + ' pass') + pill('fail', project.failed + ' fail') + '</div>' +
      '<div class="progress"><div class="progress-fill" style="width:' + rate + '%"></div></div>' +
      '<div class="muted mono">$' + Number(project.cost || 0).toFixed(4) + ' spend</div>' +
    '</div>';
  }).join('') || emptyHtml('No registered projects', 'Known project roots appear here.'));

  setHTML('runs-table', runs.map(function(run) {
    var tasks = run.tasks || [];
    var passed = tasks.filter(function(task) { return task.status === 'PASS'; }).length;
    var project = shortName(run.projectRoot);
    var integrityBadge = run.hasIntegrityErrors ? ' ' + pill('warn', 'data damaged') : '';
    return '<tr class="clickable" tabindex="0" role="button" data-runid="' + esc(run.runId) + '" onclick="openDrawerRow(this)" aria-label="Open run details">' +
      '<td>' + pill(run.derivedStatus || 'idle') + integrityBadge + '</td>' +
      '<td><div class="strong">' + esc((run.manifest && run.manifest.goal) || run.runId) + '</div><div class="faint mono">' + esc(run.runId) + '</div>' + runStageStrip(run) + '</td>' +
      '<td class="mono muted">' + esc(project) + '</td>' +
      '<td><span class="strong">' + passed + '</span><span class="muted">/' + tasks.length + '</span></td>' +
      '<td class="mono muted">' + fmtDur((run.totals || {}).duration_ms) + '</td>' +
      '<td class="mono muted">$' + Number((run.totals || {}).cost_usd || (run.metrics || {}).cumulative_cost_usd || 0).toFixed(4) + '</td>' +
    '</tr>';
  }).join('') || '<tr><td colspan="6" class="empty">No runs yet</td></tr>');
}

registerPage('projects', {
  errLabel: 'projects',
  sub: 'All registered project roots and their run sessions, costs, task status and activity timeline.',
  render: renderProjects
});
`;
