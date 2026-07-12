// owner: RStack developed by Richardson Gunde
//
// Requirements & Traceability page module — renders into #page-traceability. Plain client JS
// concatenated into the served bundle by ui/client.js; self-registers its
// renderer with the page registry (ui/lib.js).
//
// #90: FR/NFR registry straight from the stage-02 requirement spec (Stephens
// Ch4 fields — category, MoSCoW priority, verification method), test coverage
// cross-checked against the stage-08 test report's requirements_covered, and
// the written won't-have list rendered separately (a written won't-have
// prevents scope disputes). The per-run traceability chains stay below.

export const traceabilityScript = `
// ── page: traceability ────────────────────────────────────────────────
function moscowPill(priority) {
  var p = String(priority || '').toLowerCase();
  var cls = p === 'must' ? 'critical' : p === 'should' ? 'warn' : p === 'could' ? 'info' : 'idle';
  return pill(cls, p || 'unranked');
}

// requirement id → list of test levels that claim to cover it, from the
// stage-08 test report (test_levels.*.requirements_covered).
function requirementCoverage(testReport) {
  var covered = {};
  var levels = (testReport && testReport.test_levels) || {};
  Object.keys(levels).forEach(function(level) {
    ((levels[level] && levels[level].requirements_covered) || []).forEach(function(reqId) {
      if (!covered[reqId]) covered[reqId] = [];
      covered[reqId].push(level);
    });
  });
  return covered;
}

function coverageCell(reqId, covered, hasTestReport) {
  if (covered[reqId] && covered[reqId].length) {
    return pill('pass', 'tested') + ' <span class="req-note">' + esc(covered[reqId].join(', ')) + '</span>';
  }
  return '<span class="req-note">' + (hasTestReport
    ? 'not yet traceable — no test in this run references ' + esc(reqId || 'this requirement')
    : 'not yet traceable — stage 08 links tests by requirement ID') + '</span>';
}

function requirementRows(spec, covered, hasTestReport) {
  var rows = (spec.functional || []).map(function(r) {
    return '<tr><td class="mono">' + esc(r.id || '-') + '</td>' +
      '<td>' + esc(String(r.description || r.requirement || '').slice(0, 200)) + '</td>' +
      '<td>' + esc(r.category || 'functional') + '</td>' +
      '<td>' + moscowPill(r.priority) + '</td>' +
      '<td class="req-note">' + esc(String(r.verification || 'no verification method recorded').slice(0, 160)) + '</td>' +
      '<td>' + coverageCell(r.id, covered, hasTestReport) + '</td></tr>';
  });
  return rows.concat((spec.non_functional || []).map(function(r) {
    var text = String(r.requirement || r.description || '').slice(0, 200) + (r.metric ? ' — ' + String(r.metric).slice(0, 80) : '');
    return '<tr><td class="mono">' + esc(r.id || '-') + '</td>' +
      '<td>' + esc(text) + '</td>' +
      '<td>' + esc(r.furps || r.category || 'nonfunctional') + '</td>' +
      '<td>' + moscowPill(r.priority) + '</td>' +
      '<td class="req-note">' + esc(String(r.verification || 'no verification method recorded').slice(0, 160)) + '</td>' +
      '<td>' + coverageCell(r.id, covered, hasTestReport) + '</td></tr>';
  })).join('');
}

function fillRequirementRegistry(run) {
  fetchRunReport(run.runId).then(function(report) {
    var spec = report && report.stages && report.stages['02-requirements'];
    if (!spec || spec._truncated) {
      setHTML('req-registry-body', '<tr><td colspan="6" class="empty">Requirement spec unreadable for this run.</td></tr>');
      return;
    }
    var testReport = report.stages['08-testing'];
    var covered = requirementCoverage(testReport);
    var frs = spec.functional || [];
    var nfrs = spec.non_functional || [];
    var all = frs.concat(nfrs);
    var testedCount = all.filter(function(r) { return covered[r.id] && covered[r.id].length; }).length;
    setText('req-registry-note', frs.length + ' FR / ' + nfrs.length + ' NFR — run ' + run.runId.slice(-24));
    setHTML('req-registry-kpis',
      '<div class="stat-chip"><span class="stat-n">' + frs.length + '</span><span class="stat-l">functional</span></div>' +
      '<div class="stat-chip"><span class="stat-n">' + nfrs.length + '</span><span class="stat-l">non-functional</span></div>' +
      '<div class="stat-chip"><span class="stat-n">' + testedCount + '/' + all.length + '</span><span class="stat-l">with test coverage</span></div>' +
      '<div class="stat-chip"><span class="stat-n">' + (spec.wont_have || []).length + '</span><span class="stat-l">won\\u2019t have</span></div>');
    setHTML('req-registry-body', requirementRows(spec, covered, !!testReport) ||
      '<tr><td colspan="6" class="empty">The requirement spec exists but lists no functional or non-functional requirements.</td></tr>');
    setHTML('req-wont-have', (spec.wont_have || []).map(function(w) {
      return '<div class="wont-have-item"><span class="mono">' + esc(w.id || '') + '</span> ' + esc(String(w.description || '').slice(0, 180)) +
        (w.reason ? ' <span class="req-note">(' + esc(String(w.reason).slice(0, 120)) + ')</span>' : '') + '</div>';
    }).join('') || emptyHtml('Nothing declared won\\u2019t-have', 'Stage 02 records agreed exclusions here so scope disputes have a written answer.'));
    setHTML('req-out-of-scope', (spec.out_of_scope || []).map(function(item) {
      return '<div class="wont-have-item">' + esc(String(item).slice(0, 180)) + '</div>';
    }).join('') || emptyHtml('No out-of-scope list', 'Stage 02 lists out-of-scope items in requirement_spec.json.'));
  });
}

function traceChainCards(traces) {
  return traces.map(function(trace) {
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
  }).join('') || emptyHtml('No traceability data', 'Requirements and evidence appear after stage artifacts are written.');
}

// Traceability Drift (#74): on-demand scan of the newest run — requirements
// without tasks, completed work without contracts, stale references,
// contradicted readiness. Same scanner as the drift CLI.
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
  var runs = s.runs || [];
  var specRuns = runs.filter(function(run) { return (run.stageReports || []).indexOf('02-requirements') !== -1; });
  setHTML('traceability-list',
    '<div class="panel"><div class="panel-head"><span class="panel-title">Requirement Registry (FR / NFR)</span><span class="panel-note" id="req-registry-note"></span></div>' +
    '<div class="panel-body"><div class="stat-chips" id="req-registry-kpis"></div>' +
    '<div class="table-wrap" style="margin-top:12px"><table><thead><tr><th>ID</th><th>Requirement</th><th>Category</th><th>Priority</th><th>Verification</th><th>Test coverage</th></tr></thead><tbody id="req-registry-body"></tbody></table></div></div></div>' +
    '<div class="grid-2">' +
    '<div class="panel"><div class="panel-head"><span class="panel-title">Won\\u2019t Have (agreed exclusions)</span></div><div class="panel-body" id="req-wont-have"></div></div>' +
    '<div class="panel"><div class="panel-head"><span class="panel-title">Out of Scope</span></div><div class="panel-body" id="req-out-of-scope"></div></div>' +
    '</div>' +
    '<div class="panel"><div class="panel-head"><span class="panel-title">Traceability Drift</span><span class="panel-note" id="drift-card-status"></span></div>' +
    '<div class="panel-body"><div class="stat-chips" id="drift-card-kpis"></div><div id="drift-card-body" style="margin-top:12px"></div></div></div>' +
    '<div class="panel"><div class="panel-head"><span class="panel-title">Run Traceability Chains</span><span class="panel-note">' + (s.traceMap || []).length + ' runs</span></div><div class="panel-body" id="trace-chains"></div></div>');
  setHTML('trace-chains', traceChainCards(s.traceMap || []));
  fillDriftCard(runs[0]);
  if (!specRuns.length) {
    var emptyMsg = emptyHtml('No requirement spec yet', 'Stage 02 (requirements) writes requirement_spec.json — the FR/NFR registry with categories, MoSCoW priorities and verification methods appears once a run in scope produces it.');
    setHTML('req-registry-body', '<tr><td colspan="6">' + emptyMsg + '</td></tr>');
    setHTML('req-wont-have', emptyMsg);
    setHTML('req-out-of-scope', emptyMsg);
    return;
  }
  fillRequirementRegistry(specRuns[0]);
}

registerPage('traceability', {
  errLabel: 'traceability',
  sub: 'FR/NFR registry with priorities, verification methods and test coverage, plus per-run traceability chains.',
  render: renderTraceability
});
`;
