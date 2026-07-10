// owner: RStack developed by Richardson Gunde
//
// Run Report page module — renders into #page-run-report. Plain client JS
// concatenated into the served bundle by ui/client.js; self-registers its
// renderer with the page registry (ui/lib.js).

export const runReportScript = `
// ── page: run-report ────────────────────────────────────────────────
// ── Stage report infographics (issue #60) — shared by Run Report + Studio 3D ─
var REPORT_CACHE = {};            // runId → { stages, deliverables }
var REPORT_RUN_ID = null;

// STAGE_CARD_META / STAGE_CARD_ORDER are generated from the canonical
// harness stage list by ui/stage-meta.js.

function fetchRunReport(runId) {
  if (REPORT_CACHE[runId]) return Promise.resolve(REPORT_CACHE[runId]);
  return authAwareFetch('/api/run-report?run=' + encodeURIComponent(runId))
    .then(function(r) { return r.json(); })
    .then(function(data) { if (!data.error) REPORT_CACHE[runId] = data; return data; });
}

function svgDonut(segments) {
  // Arcs start collapsed (dashoffset = full) and fill in when animateReport
  // sets each arc's data-dashoffset → triggers the CSS transition.
  var total = segments.reduce(function(s, x) { return s + x.value; }, 0) || 1;
  var R = 34, C = 2 * Math.PI * R, off = 0;
  var arcs = segments.filter(function(s) { return s.value > 0; }).map(function(s) {
    var len = (s.value / total) * C;
    var seg = '<circle class="donut-arc" cx="44" cy="44" r="' + R + '" fill="none" stroke="' + s.color +
      '" stroke-width="12" stroke-dasharray="' + len.toFixed(2) + ' ' + (C - len).toFixed(2) +
      '" stroke-dashoffset="' + (len - off).toFixed(2) + '" data-dashoffset="' + (-off).toFixed(2) +
      '" transform="rotate(-90 44 44)"></circle>';
    off += len; return seg;
  }).join('');
  return '<svg class="donut" viewBox="0 0 88 88" width="88" height="88">' +
    '<circle cx="44" cy="44" r="' + R + '" fill="none" stroke="var(--soft)" stroke-width="12"></circle>' +
    arcs + '<text class="donut-center" x="44" y="49" text-anchor="middle">' + total + '</text></svg>';
}

function svgGauge(score, color) {
  var pct = Math.max(0, Math.min(100, Number(score) || 0));
  var R = 34, C = Math.PI * R;
  var fill = (pct / 100) * C;
  // Starts empty (dasharray 0) and fills to target via animateReport.
  return '<svg class="gauge" viewBox="0 0 88 52" width="120" height="70">' +
    '<path d="M10 46 A34 34 0 0 1 78 46" fill="none" stroke="var(--soft)" stroke-width="10" stroke-linecap="round"></path>' +
    '<path class="gauge-fill" d="M10 46 A34 34 0 0 1 78 46" fill="none" stroke="' + color + '" stroke-width="10" stroke-linecap="round" ' +
    'stroke-dasharray="0 ' + C.toFixed(2) + '" data-dash="' + fill.toFixed(2) + ' ' + (C - fill).toFixed(2) + '"></path>' +
    '<text class="gauge-center" x="44" y="44" text-anchor="middle">' + pct + '</text></svg>';
}

function statChips(items) {
  return '<div class="stat-chips">' + items.map(function(it) {
    return '<div class="stat-chip"><span class="stat-n" data-count="' + (it.n || 0) + '">' + (it.n || 0) + '</span><span class="stat-l">' + esc(it.l) + '</span></div>';
  }).join('') + '</div>';
}

function gateBadge(gate) {
  if (!gate) return '';
  var ready = gate.ready === true;
  var reason = gate.reason || (gate.blockers ? gate.blockers.join(', ') : '');
  return '<div class="gate ' + (ready ? 'ok' : 'blocked') + '">' +
    '<span class="gate-dot"></span>' + (ready ? 'Release gate: READY' : 'Release gate: BLOCKED') +
    (reason ? '<div class="gate-reason">' + esc(String(reason).slice(0, 160)) + '</div>' : '') + '</div>';
}

function miniList(title, arr, fmt) {
  if (!arr || !arr.length) return '';
  return '<div class="mini-list"><div class="mini-list-h">' + esc(title) + '</div>' +
    arr.slice(0, 5).map(function(x) { return '<div class="mini-list-i">' + esc((fmt ? fmt(x) : x)).slice(0, 120) + '</div>'; }).join('') + '</div>';
}

function scoreColor(score) {
  var s = Number(score) || 0;
  return s >= 80 ? '#16a34a' : s >= 50 ? '#d97706' : '#dc2626';
}

// ── Stephens-artifact cards (#215): cutover, defect analysis, maintenance ──

// 09-deployment "cutover" block: the deliberately chosen strategy, why it
// fits, and the point of no return (Stephens Ch9 — inherited-by-accident is
// not chosen).
function cutoverHtml(cut) {
  if (!cut || !cut.strategy) {
    return '<div class="kv-note">No cutover strategy recorded — stage 09 writes the required cutover block (strategy, rationale, point of no return) into deployment_report.json.</div>';
  }
  return '<div class="cutover-block">' +
    '<div class="kv"><span>Cutover strategy</span><b>' + esc(cut.strategy) + '</b></div>' +
    (cut.rationale ? '<div class="kv-note">' + esc(String(cut.rationale).slice(0, 260)) + '</div>' : '') +
    (cut.point_of_no_return ? '<div class="kv"><span>Point of no return</span><b>' + esc(String(cut.point_of_no_return).slice(0, 120)) + '</b></div>' : '') +
    ((cut.options_considered || []).length ? '<div class="chips">' + cut.options_considered.map(chip).join('') + '</div>' : '') +
    '</div>';
}

// 10-summary "defect_analysis": Ishikawa cause buckets + retry rollup from
// real run events. Honest nulls stay null — rendered as "not yet measured".
function defectAnalysisHtml(da) {
  if (!da) {
    return '<div class="kv-note">Defect analysis not recorded — stage 10 derives it from events.jsonl and task validations at pipeline close.</div>';
  }
  var buckets = (da.totals && da.totals.by_cause_bucket) || {};
  var bucketChips = ['people', 'process', 'tools', 'requirements'].map(function(bucket) {
    var n = Number(buckets[bucket]) || 0;
    return '<div class="stat-chip"><span class="stat-n">' + n + '</span><span class="stat-l">' + esc(bucket) + '</span></div>';
  }).join('');
  var defects = (da.defects || []).length;
  var retry = da.retry_rollup || {};
  var nulls = (da.metrics || []).filter(function(m) { return m && m.value === null; });
  return '<div class="mini-list-h">Defect analysis (Ishikawa cause buckets)</div>' +
    '<div class="stat-chips">' + bucketChips + '</div>' +
    '<div class="kv"><span>Defects recorded</span><b>' + defects + '</b></div>' +
    (Object.keys(retry).length ? '<div class="kv"><span>Retries</span><b>' + (retry.scheduled || 0) + ' scheduled / ' + (retry.exhausted || 0) + ' exhausted / ' + (retry.human_required || 0) + ' human</b></div>' : '') +
    nulls.slice(0, 3).map(function(m) {
      return '<div class="kv"><span>' + esc(m.name) + '</span><b class="muted">not yet measured</b></div>';
    }).join('');
}

// 11-feedback-loop maintenance taxonomy: remediations grouped into the four
// classic categories. Sources are the top-level remediation[] list, the
// issues[].remediation contract field and goal_evaluation criteria.
function maintenanceCounts(d) {
  var counts = { perfective: 0, adaptive: 0, corrective: 0, preventive: 0 };
  var tally = function(cat) { if (cat && counts[cat] != null) counts[cat]++; };
  (d.remediation || []).forEach(function(r) { tally(r && r.maintenance_category); });
  (d.issues || []).forEach(function(issue) { tally(issue && issue.remediation && issue.remediation.maintenance_category); });
  var ge = d.goal_evaluation || {};
  (ge.criteria || []).forEach(function(c) { tally(c && c.maintenance_category); });
  return counts;
}

function maintenanceTaxonomyHtml(d) {
  var counts = maintenanceCounts(d);
  var total = counts.perfective + counts.adaptive + counts.corrective + counts.preventive;
  if (!total) {
    return '<div class="kv-note">No categorized remediations — stage 11 tags each remediation perfective / adaptive / corrective / preventive.</div>';
  }
  return '<div class="mini-list-h">Maintenance taxonomy (' + total + ' remediation' + (total === 1 ? '' : 's') + ')</div>' +
    '<div class="stat-chips">' + ['perfective', 'adaptive', 'corrective', 'preventive'].map(function(cat) {
      return '<div class="stat-chip"><span class="stat-n">' + counts[cat] + '</span><span class="stat-l">' + cat + '</span></div>';
    }).join('') + '</div>';
}

function stageBody(stageId, d) {
  if (!d) return '<div class="muted">No report produced for this stage.</div>';
  if (d._truncated) return '<div class="muted">Report too large to inline (' + Math.ceil(d._bytes / 1024) + ' KB).</div>';
  switch (stageId) {
    case '02-requirements':
      return statChips([
        { n: (d.functional || []).length, l: 'functional' },
        { n: (d.non_functional || []).length, l: 'non-functional' },
        { n: (d.user_stories || []).length, l: 'user stories' },
        { n: (d.out_of_scope || []).length, l: 'out of scope' },
      ]) + miniList('Functional', d.functional, function(r) { return (r.id ? r.id + ' — ' : '') + (r.description || r.area || ''); });
    case '04-planning':
      return statChips([
        { n: (d.milestones || []).length, l: 'milestones' },
        { n: (d.tasks || []).length, l: 'tasks' },
        { n: (d.risks || []).length, l: 'risks' },
      ]) + miniList('Milestones', d.milestones, function(m) { return (m.name || m.id) + (m.target ? ' · ' + m.target : ''); });
    case '06-architecture':
      var routes = (d.live_api_evidence && d.live_api_evidence.routes) || [];
      return statChips([
        { n: (d.components || []).length, l: 'components' },
        { n: routes.length, l: 'API routes' },
        { n: (d.trade_offs || []).length, l: 'trade-offs' },
      ]) + miniList('Components', d.components, function(c) { return c.name + (c.responsibility ? ' — ' + c.responsibility : ''); });
    case '07-code':
      return statChips([
        { n: (d.files_modified || []).length, l: 'files changed' },
        { n: (d.verification || []).length, l: 'verifications' },
        { n: (d.known_concerns || []).length, l: 'concerns' },
      ]) + miniList('Files', d.files_modified);
    case '08-testing': {
      var res = d.results || {};
      var passed = 0, failed = 0;
      Object.keys(res).forEach(function(k) { if (res[k] && typeof res[k] === 'object') { passed += Number(res[k].passed) || 0; failed += Number(res[k].failed) || 0; } });
      var tot = passed + failed || 1;
      return '<div class="bars"><div class="bar-row"><span class="bar-lab">passed</span><div class="bar-track"><div class="bar-fill pass" style="--w:' + (passed / tot * 100) + '%"></div></div><span class="bar-n">' + passed + '</span></div>' +
        '<div class="bar-row"><span class="bar-lab">failed</span><div class="bar-track"><div class="bar-fill fail" style="--w:' + (failed / tot * 100) + '%"></div></div><span class="bar-n">' + failed + '</span></div></div>' +
        miniList('Coverage gaps', d.coverage_gaps);
    }
    case '09-deployment':
      return '<div class="kv"><span>Status</span><b>' + esc(d.status || '-') + '</b></div>' +
        cutoverHtml(d.cutover) +
        miniList('Blockers', d.blockers || d.release_constraints);
    case '10-summary':
      return statChips([
        { n: (d.open_risks || []).length, l: 'open risks' },
        { n: (d.not_built_or_not_done || []).length, l: 'not done' },
        { n: (d.next_steps || []).length, l: 'next steps' },
      ]) + gateBadge(d.release_gate) +
        defectAnalysisHtml(d.defect_analysis) +
        miniList('Open risks', d.open_risks, function(r) { return (r.severity ? '[' + r.severity + '] ' : '') + (r.summary || r.id || ''); });
    case '11-feedback-loop': {
      var consistency = d.consistency_score != null ? d.consistency_score : (d.summary && d.summary.overall_consistency_score);
      var criteria = ((d.goal_evaluation && (d.goal_evaluation.criteria || d.goal_evaluation.results)) || []);
      var met = criteria.filter(function(c) { return c && c.result === 'met'; }).length;
      return '<div class="gauge-wrap">' + svgGauge(consistency, scoreColor(consistency)) + '<span class="gauge-lab">consistency</span></div>' +
        (criteria.length ? '<div class="kv"><span>Goal criteria met</span><b>' + met + '/' + criteria.length + '</b></div>' : '') +
        maintenanceTaxonomyHtml(d) +
        miniList('Issues', d.issues, function(issue) { return (issue.severity ? '[' + issue.severity + '] ' : '') + (issue.title || issue.id || ''); });
    }
    case '12-security-threat-model': {
      var th = d.threats || [];
      var by = { HIGH: 0, MEDIUM: 0, LOW: 0 };
      th.forEach(function(t) { var sv = String(t.severity || '').toUpperCase(); if (by[sv] != null) by[sv]++; });
      return '<div class="donut-wrap">' + svgDonut([
        { value: by.HIGH, color: '#dc2626' }, { value: by.MEDIUM, color: '#d97706' }, { value: by.LOW, color: '#16a34a' },
      ]) + '<div class="donut-legend"><span><i style="background:#dc2626"></i>' + by.HIGH + ' high</span><span><i style="background:#d97706"></i>' + by.MEDIUM + ' med</span><span><i style="background:#16a34a"></i>' + by.LOW + ' low</span></div></div>' +
        gateBadge(d.release_gate);
    }
    case '13-compliance-checker': {
      var blocked = (d.controls || []).filter(function(c) { return c.status && c.status !== 'PASS' && c.status !== 'MET'; });
      return '<div class="gauge-wrap">' + svgGauge(d.overall_score, scoreColor(d.overall_score)) + '<span class="gauge-lab">/ 100</span></div>' +
        gateBadge(d.release_gate) + miniList('Action needed', blocked, function(c) { return (c.id || c.name) + ' — ' + (c.required_action || c.status || ''); });
    }
    case '14-cost-estimation':
      return '<div class="flashcard"><span class="flash-n" data-count="' + (Number(d.monthly_cost_usd) || 0) + '">$' + (Number(d.monthly_cost_usd) || 0) + '</span><span class="flash-l">/ month</span></div>' +
        miniList('Cost drivers', d.cost_drivers) + (d.recommendation ? '<div class="kv-note">' + esc(String(d.recommendation).slice(0, 180)) + '</div>' : '');
    case '00-environment': {
      var tools = d.tools || {};
      var names = Object.keys(tools);
      var avail = names.filter(function(n) { return tools[n] && tools[n].available; }).length;
      return statChips([{ n: avail, l: 'tools ready' }, { n: names.length, l: 'detected' }]) +
        '<div class="kv"><span>Pipeline ready</span><b>' + (d.pipeline_ready ? 'Yes' : 'No') + '</b></div>';
    }
    case '01-transcript':
      return statChips([
        { n: (d.goals || []).length, l: 'goals' },
        { n: (d.stakeholders || []).length, l: 'stakeholders' },
        { n: (d.decisions_made || []).length, l: 'decisions' },
        { n: (d.open_questions || []).length, l: 'open questions' },
      ]) + miniList('Goals', d.goals) +
        miniList('Open questions', d.open_questions);
    case '03-documentation': {
      // Contract fields: documents_created + requirement counts
      // (documentation_output.json); adopted runs index existing docs as
      // "docs" (harvest.js). Render whichever the run really produced.
      var docs = d.documents_created || d.docs || d.documents_written || [];
      var docChips = [{ n: docs.length, l: 'documents' }];
      if (d.total_functional_requirements != null) docChips.push({ n: d.total_functional_requirements, l: 'functional reqs' });
      if (d.total_non_functional_requirements != null) docChips.push({ n: d.total_non_functional_requirements, l: 'non-functional' });
      return statChips(docChips) +
        (d.estimated_complexity ? '<div class="kv"><span>Estimated complexity</span><b>' + esc(d.estimated_complexity) + '</b></div>' : '') +
        miniList('Documents', docs, function(doc) { return String(doc).split('/').pop(); });
    }
    case '05-jira':
      return statChips([{ n: (d.epics || []).length, l: 'epics' }, { n: (d.issues || []).length, l: 'issues' }]) +
        miniList('Epics', d.epics, function(e) { return e.title || e.id; });
    default:
      return '<div class="muted mono">' + esc(JSON.stringify(d).slice(0, 200)) + '…</div>';
  }
}

function stageCardHtml(stageId, d, compact) {
  var meta = STAGE_CARD_META[stageId] || { icon: '•', title: stageId, persona: '' };
  var status = d && d.status ? d.status : '';
  var statusCls = /FAIL|BLOCK|NOT_/.test(status) ? 'fail' : /CONCERN|PARTIAL|WARN/.test(status) ? 'warn' : d ? 'pass' : 'idle';
  return '<div class="stage-card ' + statusCls + (compact ? ' compact' : '') + '">' +
    '<div class="stage-card-h"><span class="stage-card-icon">' + meta.icon + '</span>' +
    '<div><div class="stage-card-title">' + esc(meta.title) + '</div><div class="stage-card-persona mono">' + esc(stageId) + '</div></div>' +
    (status ? '<span class="stage-card-status ' + statusCls + '">' + esc(String(status).replace(/_/g, ' ')) + '</span>' : '') + '</div>' +
    '<div class="stage-card-body">' + stageBody(stageId, d) + '</div></div>';
}

function animateReport(container) {
  if (!container) return;
  requestAnimationFrame(function() {
    container.classList.add('report-animate');
    // Fill donut arcs and gauges from their collapsed start to the target.
    Array.prototype.forEach.call(container.querySelectorAll('.donut-arc[data-dashoffset]'), function(arc) {
      arc.setAttribute('stroke-dashoffset', arc.getAttribute('data-dashoffset'));
    });
    Array.prototype.forEach.call(container.querySelectorAll('.gauge-fill[data-dash]'), function(g) {
      g.setAttribute('stroke-dasharray', g.getAttribute('data-dash'));
    });
  });
  Array.prototype.forEach.call(container.querySelectorAll('[data-count]'), function(el) {
    var target = Number(el.getAttribute('data-count')) || 0;
    if (target <= 0) return;
    var isMoney = el.textContent.indexOf('$') === 0;
    var start = null, dur = 700;
    function step(ts) {
      if (start === null) start = ts;
      var p = Math.min(1, (ts - start) / dur);
      var val = Math.round(target * (0.5 - Math.cos(p * Math.PI) / 2));
      el.textContent = (isMoney ? '$' : '') + val;
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  });
}

function renderRunReport(s) {
  var runs = s.runs || [];
  var select = document.getElementById('report-run-select');
  if (!select) return;
  if (!REPORT_RUN_ID || !runs.some(function(r) { return r.runId === REPORT_RUN_ID; })) {
    REPORT_RUN_ID = runs.length ? runs[0].runId : null;
  }
  select.innerHTML = runs.map(function(run) {
    var label = ((run.manifest && run.manifest.goal) || run.runId).slice(0, 70);
    return '<option value="' + esc(run.runId) + '"' + (run.runId === REPORT_RUN_ID ? ' selected' : '') + '>' + esc(label) + '</option>';
  }).join('');
  if (REPORT_RUN_ID) loadRunReport(REPORT_RUN_ID);
}

function loadRunReport(runId) {
  REPORT_RUN_ID = runId;
  var run = ((STATE && STATE.runs) || []).filter(function(r) { return r.runId === runId; })[0];
  var grid = document.getElementById('report-grid');
  var kpis = document.getElementById('report-kpis');
  if (!grid || !run) return;
  var totals = run.totals || {};
  var produced = run.stageReports || [];
  kpis.innerHTML =
    reportKpi('Status', (run.manifest && run.manifest.status) || '-', 'blue') +
    reportKpi('Stages reported', produced.length + '/15', 'blue') +
    reportKpi('Tasks passed', (totals.tasks_passed || 0) + '/' + ((totals.tasks_passed || 0) + (totals.tasks_failed || 0)), 'green') +
    reportKpi('Quality', totals.quality_avg != null ? Math.round(totals.quality_avg * 100) + '%' : '—', 'amber') +
    reportKpi('Duration', fmtDur(totals.duration_ms), 'blue');
  grid.innerHTML = '<div class="muted" style="padding:20px">Loading run report…</div>';
  fetchRunReport(runId).then(function(report) {
    if (!report || report.error) { grid.innerHTML = emptyHtml('No report', report && report.error); return; }
    grid.innerHTML = STAGE_CARD_ORDER.map(function(stageId) {
      return stageCardHtml(stageId, report.stages[stageId], false);
    }).join('');
    animateReport(grid);
  });
}

function reportKpi(label, value, tone) {
  return '<div class="report-kpi ' + tone + '"><div class="report-kpi-v">' + esc(String(value)) + '</div><div class="report-kpi-l">' + esc(label) + '</div></div>';
}

registerPage('run-report', {
  errLabel: 'run report',
  sub: 'Every stage report as an infographic — requirements, architecture, tests, security, compliance, cost, release gate — for the selected run.',
  render: renderRunReport
});
`;
