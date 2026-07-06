// owner: RStack developed by Richardson Gunde
//
// Run Analytics page module — renders into #page-run-analytics. Plain client JS
// concatenated into the served bundle by ui/client.js; self-registers its
// renderer with the page registry (ui/lib.js).

export const runAnalyticsScript = `
// ── page: run-analytics ────────────────────────────────────────────────
var ANALYTICS_RUN_ID = null;

function renderRunAnalytics(s) {
  var runs = s.runs || [];
  var select = document.getElementById('analytics-run-select');
  if (select) {
    if (!ANALYTICS_RUN_ID || !runs.some(function(run) { return run.runId === ANALYTICS_RUN_ID; })) {
      ANALYTICS_RUN_ID = runs.length ? runs[0].runId : null;
    }
    select.innerHTML = runs.map(function(run) {
      var label = ((run.manifest && run.manifest.goal) || run.runId).slice(0, 70);
      return '<option value="' + esc(run.runId) + '"' + (run.runId === ANALYTICS_RUN_ID ? ' selected' : '') + '>' + esc(label) + '</option>';
    }).join('');
  }
  renderAnalyticsRun(ANALYTICS_RUN_ID);
  renderStageBars(s);
  renderTrendTable(s);
}

function renderAnalyticsRun(runId) {
  ANALYTICS_RUN_ID = runId;
  var run = ((STATE && STATE.runs) || []).filter(function(item) { return item.runId === runId; })[0];
  if (!run) {
    setHTML('analytics-kpis', '');
    setHTML('analytics-gantt', emptyHtml('No runs yet', 'Run timelines appear once a run records task events.'));
    return;
  }
  var totals = run.totals || {};
  setHTML('analytics-kpis',
    '<div class="kpi blue"><div class="kpi-v">' + fmtDur(totals.duration_ms) + '</div><div class="kpi-l">Run Duration</div></div>' +
    '<div class="kpi blue"><div class="kpi-v">' + (totals.tool_calls || 0) + '</div><div class="kpi-l">Tool Calls</div></div>' +
    '<div class="kpi green"><div class="kpi-v">' + (totals.tasks_passed || 0) + '</div><div class="kpi-l">Passed</div></div>' +
    '<div class="kpi red"><div class="kpi-v">' + (totals.tasks_failed || 0) + '</div><div class="kpi-l">Failed</div></div>' +
    '<div class="kpi amber"><div class="kpi-v">' + (totals.quality_avg !== null && totals.quality_avg !== undefined ? Math.round(totals.quality_avg * 100) + '%' : '-') + '</div><div class="kpi-l">Avg Quality</div></div>' +
    '<div class="kpi amber"><div class="kpi-v">$' + Number(totals.cost_usd || 0).toFixed(4) + '</div><div class="kpi-l">Cost</div></div>');
  setHTML('analytics-gantt', ganttHtml(run.timeline || []));
}

function renderStageBars(s) {
  var stages = (s.trends && s.trends.stages) || {};
  var ids = Object.keys(stages).sort();
  setText('analytics-stage-count', ids.length + ' stages');
  if (!ids.length) {
    setHTML('analytics-stage-bars', emptyHtml('No stage durations yet', 'stage_completed events populate this view.'));
    return;
  }
  var max = Math.max.apply(null, ids.map(function(id) { return stages[id].avg_elapsed_ms || 0; })) || 1;
  setHTML('analytics-stage-bars', ids.map(function(id) {
    var stage = stages[id];
    var width = Math.max(2, ((stage.avg_elapsed_ms || 0) / max) * 100);
    return '<div class="stage-bar-row">' +
      '<div class="stage-bar-label mono">' + esc(id) + '</div>' +
      '<div class="stage-bar-track"><div class="stage-bar-fill" style="width:' + width.toFixed(1) + '%"></div></div>' +
      '<div class="stage-bar-value mono">' + fmtDur(stage.avg_elapsed_ms) + ' <span class="faint">x' + stage.runs + '</span></div>' +
    '</div>';
  }).join(''));
}

function renderTrendTable(s) {
  var rows = (s.trends && s.trends.runs) || [];
  setText('analytics-trend-count', rows.length + ' runs');
  setHTML('analytics-trend-table', rows.map(function(row) {
    return '<tr class="clickable" tabindex="0" data-runid="' + esc(row.runId) + '" onclick="openDrawerRow(this)" aria-label="Open run details">' +
      '<td><div class="strong">' + esc((row.goal || row.runId).slice(0, 60)) + '</div><div class="faint mono">' + esc(String(row.created_at || '').slice(0, 16)) + '</div></td>' +
      '<td class="mono">' + fmtDur(row.duration_ms) + '</td>' +
      '<td class="mono">' + (row.tool_calls || 0) + '</td>' +
      '<td><span class="strong">' + (row.tasks_passed || 0) + '</span><span class="muted">/' + ((row.tasks_passed || 0) + (row.tasks_failed || 0)) + '</span></td>' +
      '<td class="mono">' + (row.quality_avg !== null && row.quality_avg !== undefined ? Math.round(row.quality_avg * 100) + '%' : '-') + '</td>' +
      '<td class="mono muted">$' + Number(row.cost_usd || 0).toFixed(4) + '</td>' +
    '</tr>';
  }).join('') || '<tr><td colspan="6" class="empty">No runs yet</td></tr>');
}

registerPage('run-analytics', {
  errLabel: 'run analytics',
  sub: 'Wall-clock run timelines, per-stage durations and run-over-run delivery trends derived from events.jsonl.',
  render: renderRunAnalytics
});
`;
