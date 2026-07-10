// owner: RStack developed by Richardson Gunde
//
// Compliance page module — renders into #page-compliance. Plain client JS
// concatenated into the served bundle by ui/client.js; self-registers its
// renderer with the page registry (ui/lib.js).
//
// [wave:money] #92: renders the 13-compliance-checker stage artifact
// (compliance_report.json) as a per-framework scorecard with pass/gap counts
// and severity grouping. Reuses the run-report fetch/cache (fetchRunReport,
// same bundle) so a report is parsed once per run. When no run in scope has
// produced the artifact, an honest empty state explains what will appear and
// how the stage is enabled — never an empty chart.

export const complianceScript = `
// ── page: compliance ────────────────────────────────────────────────
var COMPLIANCE_SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

// Normalize compliance_report.json into one model. Tolerates both shapes in
// the wild: the stage-13 agent contract (framework_scores +
// compliance_requirements + overall_compliance) and the compact shape
// (overall_score + controls + release_gate).
function complianceReportModel(report) {
  if (!report || typeof report !== 'object' || report._truncated) return null;
  var controls = (Array.isArray(report.compliance_requirements) ? report.compliance_requirements
    : Array.isArray(report.controls) ? report.controls : []).map(function(c) {
    c = c || {};
    return {
      id: c.id || c.name || '',
      framework: c.framework || '',
      requirement: c.requirement || c.description || c.name || '',
      status: String(c.status || 'UNKNOWN').toUpperCase(),
      risk: String(c.risk_level || c.severity || c.risk || 'NONE').toUpperCase(),
      gap: c.gap_description || c.gap || '',
      action: (c.remediation && c.remediation.action) || c.required_action || ''
    };
  });
  var frameworks = (Array.isArray(report.framework_scores) ? report.framework_scores
    : Array.isArray(report.frameworks) ? report.frameworks : []).map(function(f) {
    f = f || {};
    var total = Number(f.total_requirements !== undefined ? f.total_requirements : f.total) || 0;
    var pass = Number(f.pass_count !== undefined ? f.pass_count : f.pass) || 0;
    var partial = Number(f.partial_count !== undefined ? f.partial_count : f.partial) || 0;
    var fail = Number(f.fail_count !== undefined ? f.fail_count : f.fail) || 0;
    var pct = Number(f.compliance_percentage !== undefined ? f.compliance_percentage : f.percentage);
    return {
      framework: f.framework || f.name || 'unknown',
      total: total, pass: pass, partial: partial, fail: fail,
      pct: isFinite(pct) ? Math.round(pct) : (total ? Math.round((pass / total) * 100) : null),
      status: f.status || ''
    };
  });
  // No explicit framework scores — derive them from the controls list.
  if (!frameworks.length && controls.length) {
    var byFw = {};
    controls.forEach(function(c) {
      var key = c.framework || 'unspecified';
      if (!byFw[key]) byFw[key] = { framework: key, total: 0, pass: 0, partial: 0, fail: 0, status: '' };
      byFw[key].total += 1;
      if (c.status === 'PASS' || c.status === 'MET') byFw[key].pass += 1;
      else if (c.status === 'PARTIAL') byFw[key].partial += 1;
      else if (c.status !== 'NOT_APPLICABLE') byFw[key].fail += 1;
    });
    frameworks = Object.keys(byFw).map(function(key) {
      var f = byFw[key];
      f.pct = f.total ? Math.round((f.pass / f.total) * 100) : null;
      return f;
    });
  }
  var overall = report.overall_compliance || {};
  var score = Number(overall.score_percentage);
  if (!isFinite(score)) score = Number(report.overall_score);
  var gaps = { CRITICAL: Number(overall.critical_gaps) || 0, HIGH: Number(overall.high_gaps) || 0, MEDIUM: Number(overall.medium_gaps) || 0, LOW: Number(overall.low_gaps) || 0 };
  if (!gaps.CRITICAL && !gaps.HIGH && !gaps.MEDIUM && !gaps.LOW) {
    controls.forEach(function(c) {
      if (c.status === 'PASS' || c.status === 'MET' || c.status === 'NOT_APPLICABLE') return;
      if (gaps[c.risk] !== undefined) gaps[c.risk] += 1;
    });
  }
  return {
    frameworks: frameworks,
    controls: controls,
    score: isFinite(score) ? Math.round(score) : null,
    status: overall.status || '',
    gaps: gaps,
    releaseGate: report.release_gate || null
  };
}

function complianceStatusPill(status, pct) {
  var s = String(status || '').toUpperCase();
  if (s === 'COMPLIANT' || (pct !== null && pct >= 90 && !s)) return pill('pass', s || 'compliant');
  if (s === 'NON_COMPLIANT') return pill('fail', 'non-compliant');
  if (s) return pill('warn', s.toLowerCase().replace(/_/g, ' '));
  return pct === null ? pill('ready', 'unscored') : pill(pct >= 90 ? 'pass' : pct >= 60 ? 'warn' : 'fail', pct + '%');
}

function complianceScorecardHtml(model, runId) {
  if (!model) {
    return emptyHtml('Compliance report unreadable',
      'The run produced compliance_report.json but it could not be parsed (or was truncated). Open it in the artifact viewer from the run drawer to inspect the raw file.');
  }
  var overall = '<div class="command-row"><div><div class="strong">Overall compliance</div><div class="muted mono">' + esc(String(runId || '').slice(-40)) + '</div></div>' +
    '<div class="side-v mini">' + (model.score === null ? '—' : model.score + '%') + '</div></div>';
  var gapChips = '<div class="chips">' + COMPLIANCE_SEVERITIES.map(function(sev) {
    return chip(model.gaps[sev] + ' ' + sev.toLowerCase() + ' gap' + (model.gaps[sev] === 1 ? '' : 's'));
  }).join('') + '</div>';
  var gate = model.releaseGate
    ? '<div class="kv"><span>Release gate</span><b>' + (model.releaseGate.ready ? 'ready' : 'blocked' + (model.releaseGate.reason ? ' — ' + esc(String(model.releaseGate.reason).slice(0, 120)) : '')) + '</b></div>'
    : '';
  var rows = model.frameworks.length ? model.frameworks.map(function(f) {
    return '<div class="command-row"><div><div class="strong">' + esc(f.framework) + '</div>' +
      '<div class="muted">' + f.pass + ' pass · ' + f.partial + ' partial · ' + f.fail + ' gap' + (f.fail === 1 ? '' : 's') + ' of ' + f.total + ' controls</div></div>' +
      '<div>' + complianceStatusPill(f.status, f.pct) + '</div></div>';
  }).join('') : '<div class="kv-note">The report carries no per-framework scores or controls list — only the overall score above.</div>';
  return overall + gapChips + gate + rows;
}

function complianceControlsHtml(model) {
  if (!model) return emptyHtml('No controls to show', 'Controls render once the report parses.');
  if (!model.controls.length) {
    return emptyHtml('No controls listed in the report',
      'This compliance_report.json has framework scores but no per-control detail. Per-control status, evidence and gaps render here when the stage writes them.');
  }
  var order = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, NONE: 4 };
  var open = model.controls.filter(function(c) { return c.status !== 'PASS' && c.status !== 'MET' && c.status !== 'NOT_APPLICABLE'; });
  var sorted = open.sort(function(a, b) { return (order[a.risk] !== undefined ? order[a.risk] : 9) - (order[b.risk] !== undefined ? order[b.risk] : 9); });
  var head = open.length
    ? '<div class="kv-note" style="margin-top:0;margin-bottom:8px">' + open.length + ' of ' + model.controls.length + ' controls need action, worst severity first. A control without implementation evidence is a gap — documentation alone does not pass.</div>'
    : '<div class="alert-card pass"><div class="strong">All ' + model.controls.length + ' controls pass</div><div class="muted">Every control in the report has PASS/MET status with evidence recorded by stage 13.</div></div>';
  return head + sorted.slice(0, 30).map(function(c) {
    var level = c.risk === 'CRITICAL' || c.risk === 'HIGH' ? 'fail' : c.risk === 'MEDIUM' ? 'warn' : 'info';
    return '<div class="command-row"><div>' +
      '<div class="strong">' + esc(c.id) + (c.framework ? ' <span class="muted">(' + esc(c.framework) + ')</span>' : '') + '</div>' +
      '<div class="muted">' + esc(String(c.requirement).slice(0, 140)) + '</div>' +
      (c.gap ? '<div class="faint">Gap: ' + esc(String(c.gap).slice(0, 140)) + '</div>' : '') +
      (c.action ? '<div class="faint">Fix: ' + esc(String(c.action).slice(0, 140)) + '</div>' : '') +
      '</div><div>' + pill(level, c.risk !== 'NONE' ? c.risk.toLowerCase() : c.status.toLowerCase()) + '</div></div>';
  }).join('');
}

// Fetch the parsed stage reports for a run — reuses the run-report page's
// cache when present (same bundle) so each report is fetched once.
function complianceFetchReport(runId) {
  if (typeof fetchRunReport === 'function') return fetchRunReport(runId);
  return authAwareFetch('/api/run-report?run=' + encodeURIComponent(runId)).then(function(r) { return r.json(); });
}

function complianceEmptyState() {
  setHTML('compliance-scorecards', emptyHtml('Compliance stage has not run in this scope',
    'Stage 13 (compliance checker) is optional — it runs after testing in regulated domains and writes compliance_report.json with per-framework scores, control status and gaps. Include the stage in your pipeline recipe to populate this page. Brownfield adoption skips it deliberately: compliance posture must come from a real, human-reviewed audit run.'));
  setHTML('compliance-controls', emptyHtml('No controls to show',
    'Per-framework scorecards, control status, gap severity and remediation actions render here from compliance_report.json once stage 13 produces it.'));
}

function renderCompliance(s) {
  var runs = s.runs || [];
  // Fast path: runs the snapshot flags as carrying a stage-13 report. Runs
  // served from the rollup index arrive with an empty stageReports list, so
  // ALSO probe the newest runs directly — the run-report endpoint reads from
  // disk and fetchRunReport caches, so each run is probed at most once.
  var flagged = runs.filter(function(run) { return (run.stageReports || []).indexOf('13-compliance-checker') !== -1; });
  var candidates = flagged.length ? flagged : runs.slice(0, 8);
  if (!candidates.length) {
    setText('compliance-score-count', '0 runs with a compliance report');
    complianceEmptyState();
    return Promise.resolve();
  }
  return Promise.all(candidates.map(function(run) {
    // Promise.resolve().then(...) also converts synchronous fetch throws
    // (blocked fetch, sandboxed env) into the handled no-report path.
    return Promise.resolve()
      .then(function() { return complianceFetchReport(run.runId); })
      .then(function(data) { return { run: run, report: data && data.stages ? data.stages['13-compliance-checker'] : null }; })
      .catch(function() { return { run: run, report: null }; });
  })).then(function(results) {
    var withReport = results.filter(function(item) { return item.report; });
    setText('compliance-score-count', withReport.length + ' run(s) with a compliance report');
    if (!withReport.length) {
      complianceEmptyState();
      return;
    }
    // Newest run with a report wins (runs arrive newest-first); older runs
    // with reports are listed under the scorecard for context.
    var target = withReport[0];
    var others = withReport.slice(1, 8).map(function(item) {
      return '<div class="command-row"><div><div class="strong">Earlier compliance report</div><div class="muted mono">' + esc(item.run.runId) + '</div></div>' + pill('info', 'select run scope to view') + '</div>';
    }).join('');
    var model = complianceReportModel(target.report);
    setHTML('compliance-scorecards', complianceScorecardHtml(model, target.run.runId) + others);
    setHTML('compliance-controls', complianceControlsHtml(model));
  });
}

registerPage('compliance', {
  errLabel: 'compliance',
  sub: 'Per-framework compliance scorecard, control status, gap severity and release gate from the stage-13 compliance_report.json.',
  render: renderCompliance
});
`;
