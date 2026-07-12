// owner: RStack developed by Richardson Gunde

// #282: Evidence Center renders the server-owned projection only. It never
// derives a pass from missing browser data and never recalculates readiness.
export const traceabilityScript = `
// ── page: traceability ────────────────────────────────────────────────
var EVIDENCE_VIEW = 'summary';
var EVIDENCE_STATUS = 'all';

function evidenceTone(status) {
  return status === 'verified' ? 'pass' : status === 'failed' ? 'danger' : 'idle';
}

function evidenceLabel(status) {
  return status === 'verified' ? 'Verified' : status === 'failed' ? 'Failed / blocked' : 'Unknown / not evaluated';
}

function evidenceSourceButton(source) {
  if (!source) return '<span class="evidence-no-source">No source observed</span>';
  var meta = esc(source.kind) + ' · ' + esc(source.path || 'unnamed source');
  if (source.linkable) {
    return '<button type="button" class="evidence-source" data-runid="' + esc(source.runId) + '" data-path="' + esc(String(source.path).replace(/^\\.rstack\\/runs\\/[^/]+\\//, '')) + '" onclick="viewArtifact(this)">' + meta + '</button>';
  }
  return '<span class="evidence-source static">' + meta + '</span>';
}

function evidenceCell(cell) {
  var refs = cell.sourceRefs || [];
  return '<div class="evidence-cell ' + esc(cell.status) + '">' +
    '<div>' + pill(evidenceTone(cell.status), evidenceLabel(cell.status)) + '</div>' +
    '<div class="evidence-availability">' + esc(String(cell.availability || 'unknown').replaceAll('_', ' ')) + '</div>' +
    refs.slice(0, 2).map(evidenceSourceButton).join('') +
    (refs.length > 2 ? '<span class="muted">+' + (refs.length - 2) + ' more sources</span>' : '') +
  '</div>';
}

function evidenceSummary(model) {
  var s = model.summary || {};
  return '<section class="evidence-kpis" aria-label="Evidence coverage">' +
    '<div><span>Coverage</span><strong>' + (s.coveragePercent == null ? 'Not evaluated' : s.coveragePercent + '%') + '</strong><small>' + (s.verified || 0) + ' of ' + (s.expected || 0) + ' expected</small></div>' +
    '<div><span>Verified</span><strong>' + (s.verified || 0) + '</strong><small>real passing sources</small></div>' +
    '<div><span>Failed / blocked</span><strong>' + (s.failed || 0) + '</strong><small>observed negative proof</small></div>' +
    '<div><span>Unknown</span><strong>' + (s.unknown || 0) + '</strong><small>missing or unavailable</small></div>' +
  '</section>' +
  '<div class="evidence-verdict ' + esc(model.status || 'unknown') + '"><div><span>Release evidence verdict</span><strong>' + esc(evidenceLabel(model.status === 'blocked' ? 'failed' : model.status)) + '</strong></div><div><span>Evaluated</span><time>' + esc(fmtTime(model.evaluatedAt)) + '</time></div></div>';
}

function evidenceMatrix(model) {
  var rows = (model.rows || []).filter(function(row) {
    if (EVIDENCE_STATUS === 'all') return true;
    return Object.values(row.cells || {}).some(function(cell) { return cell.status === EVIDENCE_STATUS; });
  });
  if (!rows.length) return emptyHtml('No evidence rows in this view', 'Choose another status or select a run with a requirement specification.');
  var kinds = model.kinds || [];
  return '<div class="evidence-matrix" role="table" aria-label="Requirement evidence matrix">' +
    '<div class="evidence-matrix-row evidence-matrix-head" role="row"><div role="columnheader">Requirement</div>' + kinds.map(function(kind) { return '<div role="columnheader">' + esc(kind) + '</div>'; }).join('') + '</div>' +
    rows.map(function(row) {
      return '<article class="evidence-matrix-row" role="row"><header role="rowheader"><strong>' + esc(row.requirementId) + '</strong><span>' + esc(row.requirement) + '</span><small>' + esc(shortName(row.projectRoot)) + ' / ' + esc(row.runId) + '</small></header>' +
        kinds.map(function(kind) { return '<div role="cell" data-evidence-kind="' + esc(kind) + '"><span class="evidence-mobile-label">' + esc(kind) + '</span>' + evidenceCell(row.cells[kind]) + '</div>'; }).join('') + '</article>';
    }).join('') + '</div>';
}

function evidenceRationale(model) {
  return (model.rationale || []).map(function(item) {
    return '<article class="evidence-rationale"><div><strong>' + esc(item.requirementId) + ' · ' + esc(item.kind) + '</strong><span>' + pill(evidenceTone(item.status), evidenceLabel(item.status)) + '</span></div>' +
      (item.sourceRefs || []).map(evidenceSourceButton).join('') + '</article>';
  }).join('') || emptyHtml('No readiness rationale', 'Rationale appears when requirements create expected evidence rows.');
}

function setEvidenceView(view) {
  EVIDENCE_VIEW = view;
  renderTraceability(STATE || {});
}

function setEvidenceStatus(status) {
  EVIDENCE_STATUS = status;
  renderTraceability(STATE || {});
}

function exportEvidenceProjection() {
  var model = (STATE && STATE.evidenceCenter) || {};
  var blob = new Blob([JSON.stringify(model, null, 2)], { type: 'application/json' });
  var link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'rstack-evidence-projection.json';
  link.click();
  URL.revokeObjectURL(link.href);
}

// Traceability Drift (#74): on-demand scan of the newest run — requirements
// without tasks, completed work without contracts, stale references,
// contradicted readiness. Same scanner as the drift CLI; renders below the
// Evidence Center as its own panel (ported across the #282 rewrite).
function driftFindingRow(f) {
  return '<div class="feed-row"><div class="feed-icon ' + (f.severity === 'error' ? 'fail' : 'warn') + '">' + (f.severity === 'error' ? 'NO' : '!') + '</div>' +
    '<div><div class="feed-summary">' + esc(f.message) + '</div>' +
    '<div class="feed-meta"><span>' + esc(f.type) + '</span><span class="mono">' + esc(f.artifact || '') + '</span></div></div></div>';
}

function fillDriftCard(run) {
  if (!run) { setHTML('drift-card-body', emptyHtml('No runs in scope', 'Drift is scanned per run once one exists.')); return; }
  authAwareFetch('/api/drift?run=' + encodeURIComponent(run.runId))
    .then(function(r) { return r.json(); })
    .then(function(d) {
      if (!d || d.error) { setHTML('drift-card-body', emptyHtml('Drift scan unavailable', (d && d.error) || '')); return; }
      var s = d.summary || {};
      setHTML('drift-card-kpis',
        '<div class="stat-chip"><span class="stat-n">' + (s.requirements || 0) + '</span><span class="stat-l">requirements</span></div>' +
        '<div class="stat-chip"><span class="stat-n">' + (s.tasks || 0) + '</span><span class="stat-l">tasks</span></div>' +
        '<div class="stat-chip"><span class="stat-n">' + (s.missing_evidence || 0) + '</span><span class="stat-l">missing evidence</span></div>' +
        '<div class="stat-chip"><span class="stat-n">' + (s.stale_references || 0) + '</span><span class="stat-l">stale references</span></div>');
      setHTML('drift-card-status', pill(d.status === 'PASS' ? 'pass' : d.status === 'WARN' ? 'warn' : 'fail', 'drift ' + d.status) + ' <span class="mono">' + esc(run.runId.slice(-24)) + '</span>');
      setHTML('drift-card-body', (d.findings || []).slice(0, 12).map(driftFindingRow).join('') ||
        emptyHtml('No drift detected', 'Requirements, tasks, evidence, and approvals line up for this run.'));
    })
    .catch(function() { setHTML('drift-card-body', emptyHtml('Drift scan unavailable', '')); });
}

function renderTraceability(s) {
  var model = s.evidenceCenter || { status: 'unknown', summary: {}, rows: [], sources: [], rationale: [], kinds: [] };
  var views = [['summary','Summary'],['matrix','Matrix'],['rationale','Readiness rationale']];
  var filters = [['all','All'],['verified','Verified'],['failed','Failed / blocked'],['unknown','Unknown']];
  var body = EVIDENCE_VIEW === 'summary'
    ? evidenceSummary(model) + '<div class="panel"><div class="panel-head"><span class="panel-title">Coverage by requirement</span><span class="panel-note">' + (model.rows || []).length + ' requirements</span></div><div class="panel-body">' + evidenceMatrix(model) + '</div></div>'
    : EVIDENCE_VIEW === 'matrix'
      ? '<nav class="evidence-status-filters" aria-label="Evidence status filters">' + filters.map(function(item) { return '<button type="button" aria-pressed="' + (EVIDENCE_STATUS === item[0]) + '" onclick="setEvidenceStatus(\\'' + item[0] + '\\')">' + item[1] + '</button>'; }).join('') + '</nav>' + evidenceMatrix(model)
      : '<div class="evidence-rationale-list">' + evidenceRationale(model) + '</div>';
  setHTML('traceability-list',
    '<div class="evidence-toolbar"><nav aria-label="Evidence Center views">' + views.map(function(item) { return '<button type="button" aria-pressed="' + (EVIDENCE_VIEW === item[0]) + '" onclick="setEvidenceView(\\'' + item[0] + '\\')">' + item[1] + '</button>'; }).join('') + '</nav>' +
    '<button type="button" class="tb-chip" onclick="exportEvidenceProjection()">Export same projection</button></div>' + body +
    '<div class="panel" style="margin-top:16px"><div class="panel-head"><span class="panel-title">Traceability Drift</span><span class="panel-note" id="drift-card-status"></span></div>' +
    '<div class="panel-body"><div class="stat-chips" id="drift-card-kpis"></div><div id="drift-card-body" style="margin-top:12px"></div></div></div>');
  fillDriftCard((s.runs || [])[0]);
}

registerPage('traceability', {
  errLabel: 'Evidence Center',
  sub: 'Source-linked implementation, test, security, compliance, and approval evidence. Unknown is never pass.',
  render: renderTraceability
});
`;
