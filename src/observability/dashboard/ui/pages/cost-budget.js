// owner: RStack developed by Richardson Gunde
//
// Cost & Budget page module — renders into #page-cost-budget. Plain client JS
// concatenated into the served bundle by ui/client.js; self-registers its
// renderer with the page registry (ui/lib.js).
//
// [wave:money] #92 + #215: actual tracked spend with provenance (persisted
// metrics vs event recompute), per-run and per-stage cost breakdowns, token
// totals, and the run_budget_usd consumption view. The budget panel is a
// GOVERNANCE surface: .rstack/budget.json run_budget_usd is the cap the goal
// loop enforces in code before every iteration — the copy says so. Absent
// data renders as an explanatory empty state, never a fabricated $0.00.

export const costBudgetScript = `
// ── page: cost-budget ────────────────────────────────────────────────

// True when the run carries at least one real cost/token signal.
function runHasCostTelemetry(run) {
  if (!run) return false;
  if (run.tokenTotals) return true;
  var totals = run.totals || {};
  return Number(totals.cost_usd) > 0 || Number(totals.tokens) > 0;
}

function costSummaryHtml(s) {
  var observed = businessFlexModel(s).observedConsumption || {};
  if (!observed.runCount) {
    return emptyHtml('No runs in scope', 'Actual spend, token totals and provenance appear here once a pipeline run exists in the selected scope.');
  }
  if (observed.availability !== 'available') {
    return emptyHtml('No cost telemetry recorded yet',
      'Actual spend appears when builder contracts report cost and context at validate — the harness persists it per stage to metrics.json. Nothing here is estimated: until telemetry lands, this stays empty instead of showing $0.00.');
  }
  var measurements = (observed.runs || []).filter(function(run) { return run.availability === 'available'; });
  var totalCost = Number(observed.totalCostUsd) || 0;
  var totalTokens = measurements.reduce(function(sum, run) { return sum + (Number(run.tokens) || 0); }, 0);
  var persisted = Number((observed.metricsSources || {}).persisted) || 0;
  var recomputed = Number((observed.metricsSources || {}).events) || 0;
  var avg = totalCost / observed.runsWithTelemetry;
  return '<div class="proof-grid">' +
    '<div><div class="proof-value">$' + totalCost.toFixed(2) + '</div><div class="proof-label">actual tracked spend</div></div>' +
    '<div><div class="proof-value">' + fmtTokensCompact(totalTokens) + '</div><div class="proof-label">tokens (in + out)</div></div>' +
    '<div><div class="proof-value">$' + avg.toFixed(2) + '</div><div class="proof-label">avg / run with telemetry</div></div>' +
    '<div><div class="proof-value">' + observed.runsWithTelemetry + '/' + observed.runCount + '</div><div class="proof-label">runs reporting cost</div></div>' +
    '</div>' +
    '<div class="kv-note">Source: ' + persisted + ' run(s) from persisted metrics.json totals, ' + recomputed + ' recomputed from the event stream (legacy or drift-flagged runs). Last measured: ' + esc(fmtTime(observed.lastMeasuredAt)) + '.</div>';
}

function budgetPolicyLabel(availability) {
  if (availability === 'configured') return 'Configured';
  if (availability === 'invalid') return 'Invalid configuration';
  if (availability === 'inaccessible') return 'Configuration unavailable';
  return 'Policy file missing';
}

function budgetPolicyTone(availability) {
  if (availability === 'configured') return 'pass';
  if (availability === 'invalid') return 'fail';
  return 'warn';
}

function configuredCapHtml(value, cadence, loopEnforced) {
  if (value === null || value === undefined) {
    return '<div class="policy-cap missing"><span>—</span><small>No ' + esc(cadence) + ' cap configured</small></div>';
  }
  return '<div class="policy-cap"><strong>$' + Number(value).toFixed(2) + ' / ' + esc(cadence) + '</strong><small>' + (loopEnforced ? 'Enforced by goal loop' : 'Configured policy only — no observed loop enforcement') + '</small></div>';
}

function configuredBudgetPolicyHtml(s) {
  var model = businessFlexModel(s);
  var projects = model.configuredPolicy && model.configuredPolicy.projects || [];
  var observed = model.observedConsumption || {};
  if (!projects.length) {
    return emptyHtml('Budget policy unavailable', 'No validated project policy record reached this scope. Open Diagnostics to inspect .rstack/budget.json.');
  }
  return projects.map(function(project) {
    var budget = project.budget || { availability: 'missing', issues: [] };
    var availability = budget.availability || 'missing';
    var projectLabel = project.projectName || shortName(project.projectRoot);
    var projectObserved = (observed.projects || []).find(function(item) {
      return (project.projectId && item.projectId === project.projectId) || item.projectRoot === project.projectRoot;
    });
    var policyBody = availability === 'configured'
      ? '<div class="policy-caps">' + configuredCapHtml(budget.runBudgetUsd, 'run', true) + configuredCapHtml(budget.dailyBudgetUsd, 'day', false) + configuredCapHtml(budget.monthlyBudgetUsd, 'month', false) + '</div>'
      : '<div class="policy-state ' + esc(availability) + '">' +
        '<div class="policy-state-copy">' + (availability === 'invalid' ? 'Invalid values are not presented as enforced.' : availability === 'inaccessible' ? 'The dashboard could not read this policy file.' : 'Add budget.json to arm file-backed cost limits.') + '</div>' +
        ((budget.issues || []).length ? '<ul class="policy-issues">' + budget.issues.slice(0, 4).map(function(issue) { return '<li>' + (issue.field ? '<b>' + esc(issue.field) + ':</b> ' : '') + esc(issue.problem || '') + '</li>'; }).join('') + '</ul>' : '') +
        '<button type="button" class="policy-action" onclick="showPage(\\'diagnostics\\')">Open Diagnostics</button></div>';
    var consumption = projectObserved && projectObserved.availability === 'available'
      ? '<div class="policy-observation"><strong>$' + Number(projectObserved.totalCostUsd).toFixed(2) + '</strong><span>actual measured consumption · ' + esc(projectObserved.runsWithTelemetry) + '/' + esc(projectObserved.runCount) + ' reporting runs · ' + esc((projectObserved.metricsSources || {}).persisted) + ' persisted / ' + esc((projectObserved.metricsSources || {}).events) + ' events-derived</span></div>'
      : '<div class="policy-observation empty"><strong>No telemetry yet</strong><span>Configured limits do not count as spend. Actual use appears after metrics are recorded.</span></div>';
    return '<section class="configured-budget" aria-label="Budget policy for ' + esc(projectLabel) + '">' +
      '<div class="configured-budget-head"><div><div class="policy-kicker">Current enforced policy</div><div class="strong">' + esc(projectLabel) + '</div></div>' +
        pill(budgetPolicyTone(availability), budgetPolicyLabel(availability)) + '</div>' +
      '<div class="configured-budget-grid"><div>' + policyBody + '<div class="policy-source">Source · ' + esc(budget.sourcePath || '.rstack/budget.json') + ' · loaded ' + esc(fmtTime(project.loadedAt)) + '</div></div>' + consumption + '</div>' +
    '</section>';
  }).join('');
}

// Budget consumption — the governed cap. run.loopBudgetUsd comes from the
// project's .rstack/budget.json, the exact file the goal loop's cost brake
// reads, so this bar shows the cap that actually stops the loop.
function budgetGovernanceHtml(s) {
  var model = businessFlexModel(s);
  var observed = model.observedConsumption || {};
  var measurements = observed.runs || [];
  var policies = model.configuredPolicy && model.configuredPolicy.projects || [];
  if (!observed.runCount) {
    var configured = policies.some(function(project) { return project.budget && project.budget.availability === 'configured'; });
    return configured
      ? emptyHtml('No telemetry yet', 'Current file-backed limits are shown above. Run consumption appears here only after a pipeline run records metrics.')
      : emptyHtml('Run consumption unavailable', 'A valid current budget policy and run telemetry are required before consumption can be evaluated.');
  }
  var capped = measurements.filter(function(run) { return run.cap && run.cap.runBudgetUsd !== null; });
  if (!capped.length) {
    var validCapless = policies.some(function(project) {
      return project.budget && project.budget.availability === 'configured' && (project.budget.runBudgetUsd === null || project.budget.runBudgetUsd === undefined);
    });
    return validCapless
      ? emptyHtml('No run cap configured', 'The valid .rstack/budget.json policy omits run_budget_usd, so the loop cost brake is not armed for run spend.')
      : emptyHtml('Run cap unavailable', 'The current policy is missing, invalid, or unreadable. Open Diagnostics before making a cost decision.');
  }
  var rows = capped.slice(0, 12).map(function(measurement) {
    var cap = Number(measurement.cap.runBudgetUsd);
    var spent = Number(measurement.costUsd) || 0;
    var hasTelemetry = measurement.availability === 'available';
    var pct = measurement.cap.usedPercent;
    var exhausted = measurement.cap.status === 'exhausted';
    var staleEnforcement = measurement.cap.status === 'enforcement_stale';
    var cls = exhausted ? 'over' : 'ok';
    var label = staleEnforcement
      ? 'position unavailable — actual consumption is event-derived while the loop brake reads stale or missing metrics.json'
      : exhausted
      ? 'cap reached — the loop will not start another iteration'
      : hasTelemetry
        ? Math.round(pct) + '% of cap used — $' + Number(measurement.cap.remainingUsd).toFixed(2) + ' headroom · within enforced cap'
        : 'no spend recorded yet against this cap';
    return '<div class="budget-row">' +
      '<div class="budget-row-head"><div class="strong">' + esc(measurement.runId) + '</div>' +
        '<div class="mono">' + (hasTelemetry ? '$' + spent.toFixed(2) : '—') + ' <span class="muted">of $' + cap.toFixed(2) + '</span></div></div>' +
      (hasTelemetry && pct !== null ? '<div class="budget-track"><div class="budget-fill ' + cls + '" style="width:' + Math.min(100, Math.max(2, pct)).toFixed(1) + '%"></div></div>' : '') +
      '<div class="budget-note ' + cls + '">' + esc(label) + ' · ' + moneySourcePill(measurement.metricsSource) + (measurement.measuredAt ? ' · ' + esc(fmtTime(measurement.measuredAt)) : '') + '</div>' +
    '</div>';
  }).join('');
  return '<div class="kv-note" style="margin-top:0;margin-bottom:10px">run_budget_usd is enforced in code, not by prompt text: the goal loop checks actual spend against this cap before every iteration and stops the run when it is reached.</div>' + rows;
}

function costRunRowsHtml(runs) {
  if (!(runs || []).length) return '<tr><td colspan="4" class="empty">No runs in scope</td></tr>';
  return runs.slice(0, 30).map(function(run) {
    var measurement = Object.prototype.hasOwnProperty.call(run, 'availability');
    var hasTelemetry = measurement ? run.availability === 'available' : runHasCostTelemetry(run);
    var cost = measurement ? run.costUsd : (run.totals || {}).cost_usd;
    var tokens = measurement ? run.tokens : run.tokenTotals ? run.tokenTotals.total : Number((run.totals || {}).tokens) || 0;
    var source = measurement ? run.metricsSource : run.metricsSource;
    return '<tr class="clickable" tabindex="0" role="button" data-runid="' + esc(run.runId) + '" onclick="openDrawerRow(this)" aria-label="Open run details">' +
      '<td><div class="strong">' + esc(run.runId) + '</div><div class="faint mono">' + esc(shortName(run.projectRoot)) + '</div></td>' +
      '<td class="mono">' + (hasTelemetry ? '$' + Number(cost).toFixed(4) : '<span class="muted">—</span>') + '</td>' +
      '<td class="mono">' + (hasTelemetry ? fmtTokensCompact(tokens) : '<span class="muted">—</span>') + '</td>' +
      '<td>' + moneySourcePill(hasTelemetry ? source : 'none') + (run.measuredAt ? '<div class="faint">' + esc(fmtTime(run.measuredAt)) + '</div>' : '') + '</td>' +
    '</tr>';
  }).join('');
}

// Per-stage spend aggregated across the runs in scope (#135 stage maps).
function stageCostAcrossRunsHtml(runs) {
  var byStage = {};
  (runs || []).forEach(function(run) {
    var cost = run.stageCost || {};
    Object.keys(cost).forEach(function(id) {
      byStage[id] = (byStage[id] || 0) + (Number(cost[id]) || 0);
    });
  });
  var ids = Object.keys(byStage).sort();
  if (!ids.length) {
    return emptyHtml('No per-stage cost telemetry yet',
      'Each stage\\u2019s spend is persisted to metrics.json as its builder contract is validated. Once any run in scope records stage cost, the breakdown renders here.');
  }
  var max = Math.max.apply(null, ids.map(function(id) { return byStage[id]; })) || 1;
  return ids.map(function(id) {
    var width = Math.max(2, (byStage[id] / max) * 100);
    return '<div class="stage-bar-row">' +
      '<div class="stage-bar-label mono">' + esc(id) + '</div>' +
      '<div class="stage-bar-track"><div class="stage-bar-fill money" style="width:' + width.toFixed(1) + '%"></div></div>' +
      '<div class="stage-bar-value mono">$' + byStage[id].toFixed(2) + '</div>' +
    '</div>';
  }).join('');
}

// Planned budgets (Business Flex profile envelopes) — kept as the secondary
// "planned vs actual" reference next to the enforced cap above.
function costPlannedHtml(s) {
  var model = businessFlexModel(s);
  var budget = model.budget || {};
  var observed = model.observedConsumption || {};
  var drivers = [];
  (s.runs || []).forEach(function(run) {
    (run.tasks || []).forEach(function(task) {
      if (task.budget_envelope) drivers.push({ task: task.title || task.id, runId: run.runId, cost: task.budget_envelope.estimated_ai_cost_usd || 0 });
    });
  });
  var head = (Number(budget.runBudgetTotal) || Number(budget.estimatedTaskBudget) || observed.availability === 'available')
    ? (observed.availability === 'available' ? '<div class="kv"><span>Observed actual</span><b>$' + Number(observed.totalCostUsd).toFixed(2) + '</b></div>' : '') +
      '<div class="kv"><span>Profile run budget (planned snapshot)</span><b>$' + Number(budget.runBudgetTotal || 0).toFixed(2) + '</b></div>' +
      '<div class="kv"><span>Estimated task budget (planned)</span><b>$' + Number(budget.estimatedTaskBudget || 0).toFixed(2) + '</b></div>'
    : '';
  var rows = drivers.slice(0, 20).map(function(driver) {
    return '<div class="command-row"><div><div class="strong">' + esc(driver.task) + '</div><div class="muted mono">' + esc(driver.runId) + '</div></div><div class="side-v mini">$' + Number(driver.cost || 0).toFixed(2) + '</div></div>';
  }).join('');
  if (!head && !rows) {
    return emptyHtml('No planned budget envelopes',
      'Business Flex profile budgets and per-task estimates appear after init/profile and task routing metadata are written. These are plans — actual spend is tracked in the panels to the left.');
  }
  return head + rows;
}

function spendPolicyHistoryHtml(s) {
  var model = businessFlexModel(s);
  var snapshots = model.runSnapshots || [];
  if (!snapshots.length) {
    return emptyHtml('No historical run policy yet', 'A run stores the profile and budget policy used at start. Current .rstack policy remains visible above before the first run.');
  }
  return snapshots.slice(0, 20).map(function(snapshot) {
    var differences = snapshot.differences || [];
    var comparison = snapshot.comparison === 'differs' ? 'Changed since run' : snapshot.comparison === 'current' ? 'Matches current policy' : snapshot.comparison === 'partial' ? 'Partial current policy comparison' : 'Current policy unavailable';
    return '<article class="policy-snapshot ' + (snapshot.comparison === 'differs' ? 'changed' : '') + '">' +
      '<div class="agent-head"><div><div class="strong">' + esc(snapshot.runId) + '</div><div class="muted mono">Historical run snapshot · ' + esc(shortName(snapshot.projectRoot)) + '</div></div>' + pill(snapshot.comparison === 'differs' ? 'warn' : snapshot.comparison === 'current' ? 'pass' : 'idle', comparison) + '</div>' +
      '<div class="policy-snapshot-caps"><span>Run <b>' + (snapshot.budget.runBudgetUsd == null ? '—' : '$' + Number(snapshot.budget.runBudgetUsd).toFixed(2)) + '</b></span><span>Day <b>' + (snapshot.budget.dailyBudgetUsd == null ? '—' : '$' + Number(snapshot.budget.dailyBudgetUsd).toFixed(2)) + '</b></span><span>Month <b>' + (snapshot.budget.monthlyBudgetUsd == null ? '—' : '$' + Number(snapshot.budget.monthlyBudgetUsd).toFixed(2)) + '</b></span></div>' +
      (differences.length ? '<div class="policy-differences">' + differences.map(function(item) { return '<span>' + esc(item.field) + ': ' + esc(item.snapshot == null ? '—' : item.snapshot) + ' → ' + esc(item.current == null ? '—' : item.current) + '</span>'; }).join('') + '</div>' : '') +
    '</article>';
  }).join('') + '<button type="button" class="policy-action" onclick="showPage(\\'business-flex\\')">Open Business Flex routing detail</button>';
}

// Panels owned by this module are attached client-side so the shared page
// shell (ui/pages/index.js) stays untouched by the parallel page wave.
function ensureCostBudgetPanels() {
  if (document.getElementById('cost-budget-governance-panel')) return;
  var page = document.getElementById('page-cost-budget');
  if (!page) return;
  var firstGrid = page.querySelector('.grid-2');
  var policy = document.createElement('div');
  policy.className = 'panel';
  policy.id = 'cost-budget-policy-panel';
  policy.innerHTML = '<div class="panel-head"><span class="panel-title">Current Enforced Policy</span><span class="panel-note" id="cost-budget-policy-note"></span></div><div class="panel-body" id="cost-budget-policy"></div>';
  if (firstGrid) page.insertBefore(policy, firstGrid); else page.appendChild(policy);
  var gov = document.createElement('div');
  gov.className = 'panel';
  gov.id = 'cost-budget-governance-panel';
  gov.innerHTML = '<div class="panel-head"><span class="panel-title">Budget Consumption — Loop Cost Brake</span><span class="panel-note" id="cost-budget-governance-note"></span></div><div class="panel-body" id="cost-budget-governance"></div>';
  if (firstGrid) page.insertBefore(gov, firstGrid); else page.appendChild(gov);
  var history = document.createElement('div');
  history.className = 'panel';
  history.id = 'cost-budget-history-panel';
  history.innerHTML = '<div class="panel-head"><span class="panel-title">Historical Run Policy vs Current Policy</span><span class="panel-note" id="cost-budget-history-note"></span></div><div class="panel-body" id="cost-budget-history"></div>';
  if (firstGrid) page.insertBefore(history, firstGrid); else page.appendChild(history);
  var grid = document.createElement('div');
  grid.className = 'grid-2';
  grid.id = 'cost-budget-money-grid';
  grid.innerHTML =
    '<div class="panel"><div class="panel-head"><span class="panel-title">Cost per Run</span><span class="panel-note" id="cost-budget-runs-note"></span></div><div class="table-wrap"><table><thead><tr><th>Run</th><th>Cost</th><th>Tokens</th><th>Data source</th></tr></thead><tbody id="cost-budget-runs-table"></tbody></table></div></div>' +
    '<div class="panel"><div class="panel-head"><span class="panel-title">Spend by Stage (runs in scope)</span><span class="panel-note" id="cost-budget-stages-note"></span></div><div class="panel-body"><div class="stage-bars" id="cost-budget-stages"></div></div></div>';
  page.appendChild(grid);
}

function renderCostBudget(s) {
  ensureCostBudgetPanels();
  var runs = s.runs || [];
  var observed = businessFlexModel(s).observedConsumption || {};
  var policyProjects = businessFlexModel(s).configuredPolicy && businessFlexModel(s).configuredPolicy.projects || [];
  setText('cost-budget-count', runs.length + ' runs in scope');
  setHTML('cost-budget-summary', costSummaryHtml(s));
  setHTML('cost-budget-policy', configuredBudgetPolicyHtml(s));
  setText('cost-budget-policy-note', policyProjects.length ? policyProjects.length + ' project policy record' + (policyProjects.length === 1 ? '' : 's') : 'policy unavailable');
  setHTML('cost-budget-governance', budgetGovernanceHtml(s));
  var capCount = (observed.runs || []).filter(function(run) { return run.cap && run.cap.runBudgetUsd !== null; }).length;
  var configuredCapCount = policyProjects.filter(function(project) {
    return project.budget && project.budget.availability === 'configured' && project.budget.runBudgetUsd !== null && project.budget.runBudgetUsd !== undefined;
  }).length;
  var validCapless = policyProjects.some(function(project) {
    return project.budget && project.budget.availability === 'configured' && (project.budget.runBudgetUsd === null || project.budget.runBudgetUsd === undefined);
  });
  setText('cost-budget-governance-note', capCount
    ? capCount + ' run(s) under a run_budget_usd cap'
    : configuredCapCount ? configuredCapCount + ' current run cap' + (configuredCapCount === 1 ? '' : 's') + ' · no run telemetry'
      : validCapless ? 'No run cap configured' : 'policy unavailable');
  setHTML('cost-budget-history', spendPolicyHistoryHtml(s));
  setText('cost-budget-history-note', (businessFlexModel(s).runSnapshots || []).length + ' run snapshot' + ((businessFlexModel(s).runSnapshots || []).length === 1 ? '' : 's'));
  setHTML('cost-budget-runs-table', costRunRowsHtml(observed.runs || []));
  setText('cost-budget-runs-note', Number(observed.runsWithTelemetry || 0) + ' with telemetry');
  setHTML('cost-budget-stages', stageCostAcrossRunsHtml(runs));
  setHTML('cost-budget-drivers', costPlannedHtml(s));
}

registerPage('cost-budget', {
  errLabel: 'cost budget',
  sub: 'Current file-backed limits, historical run policy, and actual tracked spend remain separate so configured caps never look like consumption.',
  render: renderCostBudget
});
`;
