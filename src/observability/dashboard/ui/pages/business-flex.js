// owner: RStack developed by Richardson Gunde
//
// Business Flex page module — renders into #page-business-flex. Plain client JS
// concatenated into the served bundle by ui/client.js; self-registers its
// renderer with the page registry (ui/lib.js).

export const businessFlexScript = `
// ── page: business-flex ────────────────────────────────────────────────
function renderBusinessFlex(s) {
  var model = businessFlexModel(s);
  var profiles = model.profiles;
  var routing = model.routingSignals;
  var budget = model.budget;
  var domainCount = profiles.reduce(function(set, profile) {
    (profile.enabledDomains || []).forEach(function(domain) { set[domain] = true; });
    return set;
  }, {});
  var domainTotal = Object.keys(domainCount).length;
  setText('business-flex-title', profiles.length ? profiles.length + ' active profile pack' + (profiles.length === 1 ? '' : 's') + ' powering business-team delivery' : 'No RStack profile data loaded yet');
  setText('business-flex-subcopy', 'Profiles decide which teams, agents, plugins, budget guardrails, and dashboard pages are active for this project.');
  setText('business-flex-status-chip', routing.length ? 'Routing visible' : profiles.length ? 'Profile ready' : 'Waiting for run');
  setClass('business-flex-status-chip', 'command-status ' + (routing.length ? 'active' : profiles.length ? 'ok' : 'warn'));
  setText('business-flex-profiles', profiles.length);
  setText('business-flex-profiles-s', profiles.map(function(p) { return p.profile; }).join(', ') || 'run rstack-agents init --profile business-flex');
  setText('business-flex-domains', domainTotal);
  setText('business-flex-domains-s', 'across selected business teams');
  setText('business-flex-budget', '$' + Number(budget.runBudgetTotal || 0).toFixed(2));
  setText('business-flex-budget-s', '$' + Number(budget.estimatedTaskBudget || 0).toFixed(2) + ' estimated task envelopes');
  setText('business-flex-routing', routing.length);
  setText('business-flex-routing-s', (budget.tasksWithBudget || 0) + ' tasks include budget metadata');
  setText('business-flex-profile-count', profiles.length + ' profiles');
  setHTML('business-flex-profiles-list', profiles.map(businessProfileHtml).join('') || emptyHtml('No profile packs yet', 'Run rstack-agents init --profile business-flex, then start and plan a run.'));
  setText('business-flex-budget-count', (budget.tasksWithBudget || 0) + ' task envelopes');
  setHTML('business-flex-budget-list', businessBudgetHtml(model));
  setText('business-flex-routing-count', routing.length + ' routed tasks');
  setHTML('business-flex-routing-list', routing.slice(0, 24).map(businessRoutingHtml).join('') || emptyHtml('No routing proof yet', 'Task routing appears after sdlc_plan writes tasks.json.'));
}

function businessProfileHtml(profile) {
  return '<div class="project-card"><div class="agent-head"><div><div class="strong">' + esc(profile.name || profile.profile) + '</div><div class="muted mono">' + esc(profile.profile) + ' / ' + esc(profile.workflow || '') + ' / ' + esc(profile.runs || 0) + ' runs</div></div>' + pill('active', 'profile') + '</div><div class="chips">' + (profile.enabledDomains || []).slice(0, 8).map(chip).join('') + '</div><div class="muted">Agents: ' + esc((profile.enabledAgents || []).slice(0, 5).join(', ') || '-') + '</div><div class="muted">Plugins: ' + esc((profile.enabledPlugins || []).slice(0, 5).join(', ') || '-') + '</div></div>';
}

function businessBudgetHtml(model) {
  var budget = model.budget || {};
  return '<div class="metric-row">' + pill('warn', '$' + Number(budget.runBudgetTotal || 0).toFixed(2) + ' run budget') + pill('pass', '$' + Number(budget.estimatedTaskBudget || 0).toFixed(2) + ' task estimate') + pill('info', (budget.tasksWithBudget || 0) + ' budgeted tasks') + '</div><div class="muted" style="margin-top:12px">Budget policy is loaded from .rstack/budget.json and copied into plan/task metadata before delegated work starts.</div>';
}

function businessRoutingHtml(item) {
  return '<div class="agent-item"><div class="agent-head"><div><div class="strong">' + esc(item.title || item.taskId) + '</div><div class="muted mono">' + esc(item.profile || '') + ' / ' + esc(item.taskId || '') + ' / ' + esc(shortName(item.projectRoot)) + '</div></div>' + pill('active', item.selectedBy || 'routed') + '</div><div class="chips">' + (item.explanation || []).slice(0, 6).map(chip).join('') + '</div><div class="muted">Specialists: ' + esc((item.specialists || []).slice(0, 6).join(', ') || '-') + '</div>' + (item.budget ? '<div class="muted">Budget envelope: ' + esc(item.budget.currency || 'USD') + ' ' + esc(item.budget.estimated_ai_cost_usd || 0) + '</div>' : '') + '</div>';
}

registerPage('business-flex', {
  errLabel: 'business flex',
  sub: 'Profiles, budget guardrails, selected teams, and routing proof for business-team SDLC flexibility.',
  render: renderBusinessFlex
});
`;
