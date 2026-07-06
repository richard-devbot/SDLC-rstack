// owner: RStack developed by Richardson Gunde
//
// Run drawer — the slide-over detail panel opened from any page that lists
// runs (Projects, Team, Run Analytics trends, Studio inspector). Includes the
// artifact viewer entry point. Concatenated into the bundle by ui/client.js.

export const drawerScript = `
// ── run drawer ─────────────────────────────────────────────
// Focus management: opening the drawer moves focus to its close button;
// closing returns focus to the element that opened it (keyboard walkthrough
// in #95). Escape-to-close is delegated in the core keydown handler.
var DRAWER_RETURN_FOCUS = null;

function openDrawerRow(row) {
  openDrawer(row.getAttribute('data-runid'));
}

function openDrawer(runId) {
  var run = (STATE && STATE.runs || []).filter(function(item) { return item.runId === runId; })[0];
  if (!run) return;
  var tasks = run.tasks || [];
  var timeline = run.activityTimeline || [];
  var passed = tasks.filter(function(task) { return task.status === 'PASS'; }).length;
  var failed = tasks.filter(function(task) { return task.status === 'FAIL'; }).length;
  var totals = run.totals || {};
  var calls = totals.tool_calls || timeline.reduce(function(total, item) { return total + (item.toolCalls || 0); }, 0);
  var cost = totals.cost_usd || (run.metrics || {}).cumulative_cost_usd || 0;
  setText('drawer-title', (run.manifest && run.manifest.goal) || run.runId);
  setText('drawer-sub', shortName(run.projectRoot) + ' / ' + run.runId);
  setHTML('drawer-body',
    '<div class="kpi-grid">' +
      '<div class="kpi blue"><div class="kpi-v">' + fmtDur(totals.duration_ms) + '</div><div class="kpi-l">Duration</div></div>' +
      '<div class="kpi blue"><div class="kpi-v">' + calls + '</div><div class="kpi-l">Tool Calls</div></div>' +
      '<div class="kpi green"><div class="kpi-v">' + passed + '</div><div class="kpi-l">Passed</div></div>' +
      '<div class="kpi red"><div class="kpi-v">' + failed + '</div><div class="kpi-l">Failed</div></div>' +
      '<div class="kpi amber"><div class="kpi-v">' + (totals.quality_avg !== null && totals.quality_avg !== undefined ? Math.round(totals.quality_avg * 100) + '%' : '-') + '</div><div class="kpi-l">Quality</div></div>' +
      '<div class="kpi amber"><div class="kpi-v">$' + Number(cost).toFixed(4) + '</div><div class="kpi-l">Cost</div></div>' +
    '</div>' +
    '<div class="panel"><div class="panel-head"><span class="panel-title">Deliverables</span><span class="panel-note">' + (run.artifactIndex || []).length + ' artifacts</span></div><div class="panel-body">' +
      artifactListHtml(run) +
    '</div></div>' +
    '<div class="panel"><div class="panel-head"><span class="panel-title">Evidence</span><span class="panel-note">' + (run.evidenceCount || 0) + ' records</span></div><div class="panel-body">' +
      evidenceListHtml(run) +
    '</div></div>' +
    '<div class="panel"><div class="panel-head"><span class="panel-title">Task Timeline</span></div><div class="panel-body"><div class="gantt">' +
      ganttHtml(run.timeline || []) +
    '</div></div></div>' +
    '<div class="panel"><div class="panel-head"><span class="panel-title">Activity by Minute</span></div><div class="panel-body">' +
      (timeline.map(function(item) {
        return '<div class="feed-row"><div class="feed-icon info">' + (item.toolCalls || 0) + '</div><div><div class="feed-summary">' + esc(item.minute || '') + '</div><div class="feed-meta"><span>' + (item.stagesDone || []).length + ' stages</span><span>' + (item.guardrails || 0) + ' guardrails</span></div></div></div>';
      }).join('') || emptyHtml('No timeline', '')) +
    '</div></div>');
  DRAWER_RETURN_FOCUS = document.activeElement;
  document.getElementById('drawer-overlay').classList.add('open');
  var panel = document.getElementById('drawer-panel');
  panel.classList.add('open');
  var closeBtn = panel.querySelector('.drawer-close');
  if (closeBtn) closeBtn.focus();
}

function artifactListHtml(run) {
  var items = run.artifactIndex || [];
  if (!items.length) return emptyHtml('No artifacts yet', 'Stage deliverables (requirements, architecture, QA reports…) appear here.');
  var byStage = {};
  items.forEach(function(item) { (byStage[item.stage] = byStage[item.stage] || []).push(item); });
  return Object.keys(byStage).sort().map(function(stage) {
    return '<div class="artifact-group"><div class="artifact-stage mono">' + esc(stage) + '</div>' +
      byStage[stage].map(function(item) {
        var name = item.path.split('/').pop();
        return '<button class="artifact-link" data-runid="' + esc(run.runId) + '" data-path="' + esc(item.path) + '" onclick="viewArtifact(this)">' +
          '<span class="mono">' + esc(name) + '</span><span class="faint mono">' + Math.ceil((item.size || 0) / 1024) + ' KB</span></button>';
      }).join('') + '</div>';
  }).join('');
}

function evidenceListHtml(run) {
  var entries = run.evidenceRecent || [];
  if (!entries.length) return emptyHtml('No evidence yet', 'Validation evidence records appear here.');
  return entries.map(function(entry) {
    return '<div class="evidence-row">' + pill(entry.status === 'PASS' ? 'pass' : 'fail', entry.status) +
      '<span class="mono">' + esc(entry.task_id || '') + '</span>' +
      '<span class="muted">' + esc(entry.kind || '') + '</span>' +
      '<span class="faint mono">' + (entry.ts ? fmtTime(entry.ts) : '') + '</span></div>';
  }).join('');
}

function viewArtifact(btn) {
  var runId = btn.getAttribute('data-runid');
  var path = btn.getAttribute('data-path');
  authAwareFetch('/api/artifact?run=' + encodeURIComponent(runId) + '&path=' + encodeURIComponent(path))
    .then(function(response) { return response.json(); })
    .then(function(data) {
      if (data.error) { showErr('artifact: ' + data.error); return; }
      var body = document.getElementById('drawer-body');
      // Rich rendering (Markdown / structured JSON / JSONL) lives in
      // artifact-render.js; fall back to a raw <pre> if that module is absent.
      if (typeof renderArtifactInto === 'function') {
        renderArtifactInto(body, data, runId, function() { openDrawer(runId); });
      } else {
        var kb = Math.ceil((data.size || 0) / 1024);
        body.innerHTML =
          '<div class="ar-toolbar"><button class="tb-chip ar-back">← Back to run</button>' +
          '<span class="ar-path mono">' + esc(data.path) + '</span><span class="ar-size">' + kb + ' KB</span></div>' +
          '<div class="panel"><div class="panel-body"><pre class="artifact-content">' + esc(data.content) + '</pre></div></div>';
        var fb = body.querySelector('.ar-back');
        if (fb) fb.addEventListener('click', function() { openDrawer(runId); });
      }
    })
    .catch(function(err) { showErr('artifact: ' + err.message); });
}

function closeDrawer() {
  document.getElementById('drawer-overlay').classList.remove('open');
  document.getElementById('drawer-panel').classList.remove('open');
  if (DRAWER_RETURN_FOCUS && typeof DRAWER_RETURN_FOCUS.focus === 'function' && document.contains(DRAWER_RETURN_FOCUS)) {
    DRAWER_RETURN_FOCUS.focus();
  }
  DRAWER_RETURN_FOCUS = null;
}
`;
