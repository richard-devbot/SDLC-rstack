// owner: RStack developed by Richardson Gunde
//
// Diagnostics page module — renders into #page-diagnostics. Plain client JS
// concatenated into the served bundle by ui/client.js; self-registers its
// renderer with the page registry (ui/lib.js).

export const diagnosticsScript = `
// ── page: diagnostics ────────────────────────────────────────────────
function renderDiagnostics(s) {
  var d = s.diagnostics || {};
  var rows = [
    ['Runs', d.runCount || 0],
    ['Tasks', d.taskCount || 0],
    ['Events', d.eventCount || 0],
    ['Evidence records', d.evidenceCount || 0],
    ['Missing builder contracts', d.missingBuilderCount || 0],
    ['Missing validation contracts', d.missingValidationCount || 0],
    ['Data integrity errors', d.integrityErrorCount || 0]
  ];
  setHTML('diagnostics-health', rows.map(function(row) {
    return '<div class="feed-row"><div class="feed-icon info">i</div><div><div class="feed-summary">' + esc(row[0]) + '</div></div><div class="feed-ts">' + esc(row[1]) + '</div></div>';
  }).join(''));
  var integrity = d.integrity || [];
  var configIssues = d.configIssues || [];
  var problems = integrity.map(function(issue) {
    return '<div class="feed-row"><div class="feed-icon warn">!</div><div><div class="feed-summary">' + esc(issue.file) + '</div><div class="feed-meta"><span>' + esc(issue.runId || '') + '</span><span>' + esc(issue.error) + '</span></div></div></div>';
  }).concat(configIssues.map(function(issue) {
    return '<div class="feed-row"><div class="feed-icon warn">!</div><div><div class="feed-summary">' + esc(issue.file) + '</div><div class="feed-meta"><span>' + esc(issue.field || 'config') + '</span><span>' + esc(issue.problem) + '</span></div></div></div>';
  }));
  setHTML('diagnostics-integrity', problems.join('') || emptyHtml('No data integrity or config problems', 'Damaged run files and invalid .rstack config values appear here.'));
  setHTML('diagnostics-roots', (d.sourceRoots || s.sourceRoots || []).map(function(root) {
    return '<div class="project-card"><div class="strong">' + esc(shortName(root)) + '</div><div class="project-path mono">' + esc(root) + '</div></div>';
  }).join('') || emptyHtml('No source roots', ''));
  renderDiagnosticsRuns(s);
}

// Run Data & Restore Points (#156/#215): manifest schema versions (v1 legacy
// vs v2 — migration state made observable) and per-stage checkpoint status
// from the server-owned rollup. Restorability is verified on disk by the
// harness (#132/#203); this renders the verdict, it never re-derives it.
function diagnosticsCheckpointHtml(cp) {
  var stages = (cp && cp.stages) || [];
  if (!stages.length) {
    var total = (cp && cp.total) || 0;
    return '<span class="muted">' + (total ? total + ' checkpoint event(s), none currently restorable' : 'No restore points') + '</span>';
  }
  return stages.map(function(stage) {
    var corrupt = !stage.restorable && String(stage.reason || '').indexOf('corrupt') === 0;
    var legacy = stage.restorable && stage.reason === 'legacy_unverified';
    var cls = corrupt ? 'fail' : legacy ? 'warn' : 'pass';
    var label = corrupt ? 'CORRUPT' : legacy ? 'legacy' : 'restorable';
    var title = stage.reason ? stage.id + ': ' + stage.reason : stage.id;
    return '<span class="pill ' + cls + '" title="' + esc(title) + '">' + esc(stage.id) + ' ' + esc(label) + '</span>';
  }).join(' ');
}

function renderDiagnosticsRuns(s) {
  var runs = s.runs || [];
  setText('diagnostics-runs-note', runs.length + ' run(s)');
  setHTML('diagnostics-runs', runs.slice(0, 30).map(function(run) {
    var version = run.schemaVersion;
    var versionLabel = version == null ? 'v1 legacy' : 'v' + version;
    var versionCls = version == null ? 'warn' : 'pass';
    return '<div class="feed-row"><div class="feed-icon info">◇</div><div>' +
      '<div class="feed-summary mono">' + esc((run.runId || '').slice(-40)) + '</div>' +
      '<div class="feed-meta"><span>manifest schema: ' + esc(versionLabel) + '</span></div>' +
      '<div style="margin-top:4px">' + diagnosticsCheckpointHtml(run.checkpoints) + '</div>' +
      '</div>' + pill(versionCls, versionLabel) + '</div>';
  }).join('') || emptyHtml('No runs', 'Run data health appears once a run exists.'));
}

registerPage('diagnostics', {
  errLabel: 'diagnostics',
  sub: 'Source roots, missing builder contracts, validation coverage and raw .rstack data health.',
  unscoped: true,
  render: renderDiagnostics
});
`;
