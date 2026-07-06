// owner: RStack developed by Richardson Gunde
//
// Cost & Budget page module — renders into #page-cost-budget. Plain client JS
// concatenated into the served bundle by ui/client.js; self-registers its
// renderer with the page registry (ui/lib.js).

export const costBudgetScript = `
// ── page: cost-budget ────────────────────────────────────────────────
function renderCostBudget(s) {
  var model = businessFlexModel(s);
  var budget = model.budget || {};
  var totalCost = Number(s.totalCost || 0);
  var avgCost = (s.totalRuns || 0) ? totalCost / s.totalRuns : 0;
  setText('cost-budget-count', (s.totalRuns || 0) + ' runs');
  setHTML('cost-budget-summary', '<div class="proof-grid"><div><div class="proof-value">$' + totalCost.toFixed(4) + '</div><div class="proof-label">actual tracked spend</div></div><div><div class="proof-value">$' + avgCost.toFixed(4) + '</div><div class="proof-label">avg / run</div></div><div><div class="proof-value">$' + Number(budget.runBudgetTotal || 0).toFixed(2) + '</div><div class="proof-label">profile run budget</div></div><div><div class="proof-value">$' + Number(budget.estimatedTaskBudget || 0).toFixed(2) + '</div><div class="proof-label">estimated task budget</div></div></div>');
  var drivers = [];
  (s.runs || []).forEach(function(run) {
    (run.tasks || []).forEach(function(task) {
      if (task.budget_envelope) drivers.push({ task: task.title || task.id, runId: run.runId, cost: task.budget_envelope.estimated_ai_cost_usd || 0 });
    });
  });
  setHTML('cost-budget-drivers', drivers.slice(0, 20).map(function(driver) {
    return '<div class="command-row"><div><div class="strong">' + esc(driver.task) + '</div><div class="muted mono">' + esc(driver.runId) + '</div></div><div class="side-v mini">$' + Number(driver.cost || 0).toFixed(2) + '</div></div>';
  }).join('') || emptyHtml('No task budget envelopes', 'Business Flex budgets appear after init/profile and task routing metadata are written.'));
}

registerPage('cost-budget', {
  errLabel: 'cost budget',
  sub: 'Estimated cost, run spend, budget envelopes, and cost drivers for business governance.',
  render: renderCostBudget
});
`;
