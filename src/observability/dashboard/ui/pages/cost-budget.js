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
  var runs = s.runs || [];
  if (!runs.length) {
    return emptyHtml('No runs in scope', 'Actual spend, token totals and provenance appear here once a pipeline run exists in the selected scope.');
  }
  var telemetryRuns = runs.filter(runHasCostTelemetry);
  if (!telemetryRuns.length) {
    return emptyHtml('No cost telemetry recorded yet',
      'Actual spend appears when builder contracts report cost and context at validate — the harness persists it per stage to metrics.json. Nothing here is estimated: until telemetry lands, this stays empty instead of showing $0.00.');
  }
  var totalCost = 0, totalTokens = 0, persisted = 0, recomputed = 0;
  telemetryRuns.forEach(function(run) {
    totalCost += Number((run.totals || {}).cost_usd) || 0;
    totalTokens += run.tokenTotals ? Number(run.tokenTotals.total) || 0 : Number((run.totals || {}).tokens) || 0;
    if (run.metricsSource === 'persisted') persisted += 1; else recomputed += 1;
  });
  var avg = totalCost / telemetryRuns.length;
  return '<div class="proof-grid">' +
    '<div><div class="proof-value">$' + totalCost.toFixed(2) + '</div><div class="proof-label">actual tracked spend</div></div>' +
    '<div><div class="proof-value">' + fmtTokensCompact(totalTokens) + '</div><div class="proof-label">tokens (in + out)</div></div>' +
    '<div><div class="proof-value">$' + avg.toFixed(2) + '</div><div class="proof-label">avg / run with telemetry</div></div>' +
    '<div><div class="proof-value">' + telemetryRuns.length + '/' + runs.length + '</div><div class="proof-label">runs reporting cost</div></div>' +
    '</div>' +
    '<div class="kv-note">Source: ' + persisted + ' run(s) from persisted metrics.json totals, ' + recomputed + ' recomputed from the event stream (legacy or drift-flagged runs).</div>';
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

function configuredCapHtml(value, cadence) {
  if (value === null || value === undefined) {
    return '<div class="policy-cap missing"><span>—</span><small>No ' + esc(cadence) + ' cap configured</small></div>';
  }
  return '<div class="policy-cap"><strong>$' + Number(value).toFixed(2) + ' / ' + esc(cadence) + '</strong><small>Enforced from file</small></div>';
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
    var policyBody = availability === 'configured'
      ? '<div class="policy-caps">' + configuredCapHtml(budget.runBudgetUsd, 'run') + configuredCapHtml(budget.dailyBudgetUsd, 'day') + configuredCapHtml(budget.monthlyBudgetUsd, 'month') + '</div>'
      : '<div class="policy-state ' + esc(availability) + '">' +
        '<div class="policy-state-copy">' + (availability === 'invalid' ? 'Invalid values are not presented as enforced.' : availability === 'inaccessible' ? 'The dashboard could not read this policy file.' : 'Add budget.json to arm file-backed cost limits.') + '</div>' +
        ((budget.issues || []).length ? '<ul class="policy-issues">' + budget.issues.slice(0, 4).map(function(issue) { return '<li>' + (issue.field ? '<b>' + esc(issue.field) + ':</b> ' : '') + esc(issue.problem || '') + '</li>'; }).join('') + '</ul>' : '') +
        '<button type="button" class="policy-action" onclick="showPage(\\'diagnostics\\')">Open Diagnostics</button></div>';
    var consumption = observed.availability === 'available'
      ? '<div class="policy-observation"><strong>$' + Number(observed.totalCostUsd || 0).toFixed(2) + '</strong><span>actual measured consumption · ' + esc(observed.runsWithTelemetry || 0) + ' reporting runs</span></div>'
      : '<div class="policy-observation empty"><strong>No telemetry yet</strong><span>Configured limits do not count as spend. Actual use appears after metrics are recorded.</span></div>';
    return '<section class="configured-budget" aria-label="Budget policy for ' + esc(projectLabel) + '">' +
      '<div class="configured-budget-head"><div><div class="policy-kicker">Current enforced policy</div><div class="strong">' + esc(projectLabel) + '</div></div>' +
        pill(budgetPolicyTone(availability), budgetPolicyLabel(availability)) + '</div>' +
      '<div class="configured-budget-grid"><div>' + policyBody + '<div class="policy-source">Source · ' + esc(budget.sourcePath || '.rstack/budget.json') + '</div></div>' + consumption + '</div>' +
    '</section>';
  }).join('');
}

// Budget consumption — the governed cap. run.loopBudgetUsd comes from the
// project's .rstack/budget.json, the exact file the goal loop's cost brake
// reads, so this bar shows the cap that actually stops the loop.
function budgetGovernanceHtml(s) {
  var runs = s.runs || [];
  var policies = businessFlexModel(s).configuredPolicy && businessFlexModel(s).configuredPolicy.projects || [];
  if (!runs.length) {
    var configured = policies.some(function(project) { return project.budget && project.budget.availability === 'configured'; });
    return configured
      ? emptyHtml('No telemetry yet', 'Current file-backed limits are shown above. Run consumption appears here only after a pipeline run records metrics.')
      : emptyHtml('Run consumption unavailable', 'A valid current budget policy and run telemetry are required before consumption can be evaluated.');
  }
  var capped = runs.filter(function(run) {
    return run.loopBudgetUsd !== null && run.loopBudgetUsd !== undefined && isFinite(Number(run.loopBudgetUsd));
  });
  if (!capped.length) {
    var validCapless = policies.some(function(project) {
      return project.budget && project.budget.availability === 'configured' && (project.budget.runBudgetUsd === null || project.budget.runBudgetUsd === undefined);
    });
    return validCapless
      ? emptyHtml('No run cap configured', 'The valid .rstack/budget.json policy omits run_budget_usd, so the loop cost brake is not armed for run spend.')
      : emptyHtml('Run cap unavailable', 'The current policy is missing, invalid, or unreadable. Open Diagnostics before making a cost decision.');
  }
  var rows = capped.slice(0, 12).map(function(run) {
    var cap = Number(run.loopBudgetUsd);
    var spent = Number((run.totals || {}).cost_usd) || 0;
    var hasTelemetry = runHasCostTelemetry(run);
    var pct = cap > 0 ? (spent / cap) * 100 : (spent > 0 ? 100 : 0);
    var cls = pct >= 100 ? 'over' : pct >= 80 ? 'near' : 'ok';
    var label = pct >= 100
      ? 'cap reached — the loop will not start another iteration'
      : hasTelemetry
        ? Math.round(pct) + '% of cap used — ' + (cap - spent > 0 ? '$' + (cap - spent).toFixed(2) + ' headroom' : 'no headroom')
        : 'no spend recorded yet against this cap';
    return '<div class="budget-row">' +
      '<div class="budget-row-head"><div class="strong">' + esc(((run.manifest && run.manifest.goal) || run.runId).slice(0, 70)) + '</div>' +
        '<div class="mono">' + (hasTelemetry ? '$' + spent.toFixed(2) : '—') + ' <span class="muted">of $' + cap.toFixed(2) + '</span></div></div>' +
      '<div class="budget-track"><div class="budget-fill ' + cls + '" style="width:' + Math.min(100, Math.max(hasTelemetry ? 2 : 0, pct)).toFixed(1) + '%"></div></div>' +
      '<div class="budget-note ' + cls + '">' + esc(label) + '</div>' +
    '</div>';
  }).join('');
  return '<div class="kv-note" style="margin-top:0;margin-bottom:10px">run_budget_usd is enforced in code, not by prompt text: the goal loop checks actual spend against this cap before every iteration and stops the run when it is reached.</div>' + rows;
}

function costRunRowsHtml(runs) {
  if (!(runs || []).length) return '<tr><td colspan="4" class="empty">No runs in scope</td></tr>';
  return runs.slice(0, 30).map(function(run) {
    var totals = run.totals || {};
    var hasTelemetry = runHasCostTelemetry(run);
    var tokens = run.tokenTotals ? run.tokenTotals.total : Number(totals.tokens) || 0;
    return '<tr class="clickable" tabindex="0" role="button" data-runid="' + esc(run.runId) + '" onclick="openDrawerRow(this)" aria-label="Open run details">' +
      '<td><div class="strong">' + esc(((run.manifest && run.manifest.goal) || run.runId).slice(0, 60)) + '</div><div class="faint mono">' + esc(String((run.manifest && run.manifest.created_at) || '').slice(0, 16)) + '</div></td>' +
      '<td class="mono">' + (hasTelemetry ? '$' + Number(totals.cost_usd || 0).toFixed(4) : '<span class="muted">—</span>') + '</td>' +
      '<td class="mono">' + (tokens ? fmtTokensCompact(tokens) : '<span class="muted">—</span>') + '</td>' +
      '<td>' + moneySourcePill(hasTelemetry ? run.metricsSource : 'none') + '</td>' +
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
  var drivers = [];
  (s.runs || []).forEach(function(run) {
    (run.tasks || []).forEach(function(task) {
      if (task.budget_envelope) drivers.push({ task: task.title || task.id, runId: run.runId, cost: task.budget_envelope.estimated_ai_cost_usd || 0 });
    });
  });
  var head = (Number(budget.runBudgetTotal) || Number(budget.estimatedTaskBudget))
    ? '<div class="kv"><span>Profile run budget (planned)</span><b>$' + Number(budget.runBudgetTotal || 0).toFixed(2) + '</b></div>' +
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
  var policyProjects = businessFlexModel(s).configuredPolicy && businessFlexModel(s).configuredPolicy.projects || [];
  setText('cost-budget-count', runs.length + ' runs in scope');
  setHTML('cost-budget-summary', costSummaryHtml(s));
  setHTML('cost-budget-policy', configuredBudgetPolicyHtml(s));
  setText('cost-budget-policy-note', policyProjects.length ? policyProjects.length + ' project policy record' + (policyProjects.length === 1 ? '' : 's') : 'policy unavailable');
  setHTML('cost-budget-governance', budgetGovernanceHtml(s));
  var capCount = runs.filter(function(run) { return run.loopBudgetUsd !== null && run.loopBudgetUsd !== undefined; }).length;
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
  setHTML('cost-budget-runs-table', costRunRowsHtml(runs));
  setText('cost-budget-runs-note', runs.filter(runHasCostTelemetry).length + ' with telemetry');
  setHTML('cost-budget-stages', stageCostAcrossRunsHtml(runs));
  setHTML('cost-budget-drivers', costPlannedHtml(s));
}

registerPage('cost-budget', {
  errLabel: 'cost budget',
  sub: 'Current file-backed limits, historical run policy, and actual tracked spend remain separate so configured caps never look like consumption.',
  render: renderCostBudget
});
`;
