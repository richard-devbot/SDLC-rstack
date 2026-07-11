// owner: RStack developed by Richardson Gunde
//
// Business Flex page module — renders into #page-business-flex. Plain client JS
// concatenated into the served bundle by ui/client.js; self-registers its
// renderer with the page registry (ui/lib.js).

export const businessFlexScript = `
// ── page: business-flex ────────────────────────────────────────────────
function policyAvailabilityLabel(value) {
  if (value === 'configured') return 'Configured';
  if (value === 'invalid') return 'Invalid configuration';
  if (value === 'inaccessible') return 'Configuration unavailable';
  return 'Policy file missing';
}

function policyAvailabilityTone(value) {
  if (value === 'configured') return 'pass';
  if (value === 'invalid') return 'fail';
  return 'warn';
}

function policyIssuesHtml(issues) {
  if (!(issues || []).length) return '';
  return '<ul class="policy-issues">' + issues.slice(0, 4).map(function(issue) {
    return '<li>' + (issue.field ? '<b>' + esc(issue.field) + ':</b> ' : '') + esc(issue.problem || '') + '</li>';
  }).join('') + '</ul>';
}

function policyRecoveryHtml(availability) {
  if (availability === 'configured') return '';
  return '<button type="button" class="policy-action" onclick="navTo(\\'diagnostics\\')">Open Diagnostics</button>';
}

function policyCapHtml(value, cadence) {
  if (value === null || value === undefined) {
    return '<div class="policy-cap missing"><span>—</span><small>No ' + esc(cadence) + ' cap configured</small></div>';
  }
  return '<div class="policy-cap"><strong>$' + Number(value).toFixed(2) + ' / ' + esc(cadence) + '</strong><small>File-backed limit</small></div>';
}

function policyLaneStateHtml(record, kind) {
  var availability = record && record.availability || 'missing';
  return '<div class="policy-state ' + esc(availability) + '">' +
    pill(policyAvailabilityTone(availability), policyAvailabilityLabel(availability)) +
    '<div class="policy-state-copy">' + (kind === 'profile'
      ? availability === 'missing' ? 'Add rstack.config.json to select an operating profile.' : 'The configured profile cannot be claimed active.'
      : availability === 'missing' ? 'Add budget.json to arm file-backed cost limits.' : 'Invalid or unreadable values are not shown as enforced.') + '</div>' +
    policyIssuesHtml(record && record.issues) + policyRecoveryHtml(availability) +
  '</div>';
}

function businessPolicyLedgerHtml(model) {
  var projects = model.configuredPolicy && model.configuredPolicy.projects || [];
  var observed = model.observedConsumption || {};
  if (!projects.length) {
    return emptyHtml('Policy records unavailable', 'Select a project with an initialized .rstack directory, then open Diagnostics if configuration cannot be loaded.');
  }
  return projects.map(function(project) {
    var profile = project.profile || { availability: 'missing' };
    var budget = project.budget || { availability: 'missing' };
    var projectLabel = project.projectName || shortName(project.projectRoot);
    var worktree = project.worktreeName ? ' · worktree ' + project.worktreeName : '';
    var profileBody = profile.availability === 'configured'
      ? '<div class="policy-value">' + esc(profile.name || profile.id) + '</div>' +
        '<div class="policy-workflow mono">' + esc(profile.workflow || 'Workflow unavailable') + '</div>' +
        '<div class="chips">' + (profile.enabledDomains || []).slice(0, 6).map(chip).join('') + '</div>'
      : policyLaneStateHtml(profile, 'profile');
    var budgetBody = budget.availability === 'configured'
      ? '<div class="policy-caps">' + policyCapHtml(budget.runBudgetUsd, 'run') +
        policyCapHtml(budget.dailyBudgetUsd, 'day') + policyCapHtml(budget.monthlyBudgetUsd, 'month') + '</div>'
      : policyLaneStateHtml(budget, 'budget');
    var observedBody = observed.availability === 'available'
      ? '<div class="policy-value">$' + Number(observed.totalCostUsd || 0).toFixed(2) + '</div>' +
        '<div class="policy-state-copy">Actual consumption · ' + esc(observed.runsWithTelemetry || 0) + ' of ' + esc(observed.runCount || 0) + ' runs reporting</div>' +
        '<div class="policy-source">Metrics: ' + esc((observed.metricsSources && observed.metricsSources.persisted) || 0) + ' persisted · ' + esc((observed.metricsSources && observed.metricsSources.events) || 0) + ' events-derived</div>'
      : '<div class="policy-value muted">No telemetry yet</div><div class="policy-state-copy">Configured limits are active policy, not observed spend. Consumption appears only after the harness records metrics.</div>';
    return '<section class="policy-project" aria-label="Policy for ' + esc(projectLabel) + '">' +
      '<div class="policy-project-head"><div><div class="strong">' + esc(projectLabel) + '</div><div class="muted mono">' + esc(project.projectRoot || '') + esc(worktree) + '</div></div>' +
        pill(policyAvailabilityTone(project.availability), policyAvailabilityLabel(project.availability)) + '</div>' +
      '<div class="policy-ledger">' +
        '<div class="policy-lane policy-current"><div class="policy-kicker">Configured operating policy</div>' + profileBody + '<div class="policy-source">Source · ' + esc(profile.sourcePath || '.rstack/rstack.config.json') + '</div></div>' +
        '<div class="policy-lane policy-limits"><div class="policy-kicker">Enforced limits</div>' + budgetBody + '<div class="policy-source">Source · ' + esc(budget.sourcePath || '.rstack/budget.json') + '</div></div>' +
        '<div class="policy-lane policy-observed"><div class="policy-kicker">Observed consumption</div>' + observedBody + '</div>' +
      '</div>' +
    '</section>';
  }).join('');
}

function businessRunSnapshotsHtml(model) {
  var snapshots = model.runSnapshots || [];
  if (!snapshots.length) {
    return emptyHtml('No run policy snapshots yet', 'Current configured policy is already shown above. Historical policy-at-execution appears here after the first run starts.');
  }
  return '<div class="stack-list">' + snapshots.slice(0, 20).map(function(snapshot) {
    var budget = snapshot.budget || {};
    var changed = snapshot.comparison === 'differs';
    return '<div class="policy-snapshot ' + (changed ? 'changed' : '') + '">' +
      '<div class="agent-head"><div><div class="strong">' + esc(snapshot.runId || 'Run snapshot') + '</div>' +
        '<div class="muted mono">' + esc((snapshot.profile && snapshot.profile.id) || 'profile unavailable') + ' · ' + esc((snapshot.profile && snapshot.profile.workflow) || 'workflow unavailable') + '</div></div>' +
        pill(changed ? 'warn' : snapshot.comparison === 'current' ? 'pass' : 'info', changed ? 'Policy changed since this run' : snapshot.comparison === 'current' ? 'Matches current policy' : 'Current policy unavailable') + '</div>' +
      '<div class="policy-snapshot-caps"><span>Run cap <b>' + (budget.runBudgetUsd === null || budget.runBudgetUsd === undefined ? '—' : '$' + Number(budget.runBudgetUsd).toFixed(2)) + '</b></span>' +
        '<span>Day <b>' + (budget.dailyBudgetUsd === null || budget.dailyBudgetUsd === undefined ? '—' : '$' + Number(budget.dailyBudgetUsd).toFixed(2)) + '</b></span>' +
        '<span>Month <b>' + (budget.monthlyBudgetUsd === null || budget.monthlyBudgetUsd === undefined ? '—' : '$' + Number(budget.monthlyBudgetUsd).toFixed(2)) + '</b></span></div>' +
      (changed ? '<div class="policy-differences">' + (snapshot.differences || []).map(function(item) { return '<span>' + esc(item.field) + ': ' + esc(item.snapshot) + ' → ' + esc(item.current) + '</span>'; }).join('') + '</div>' : '') +
    '</div>';
  }).join('') + '</div>';
}

function renderBusinessFlex(s) {
  var model = businessFlexModel(s);
  var profiles = model.profiles;
  var routing = model.routingSignals;
  var budget = model.budget;
  var policyProjects = model.configuredPolicy && model.configuredPolicy.projects || [];
  var configuredProfiles = policyProjects.filter(function(project) { return project.profile && project.profile.availability === 'configured'; });
  var configuredCaps = policyProjects.filter(function(project) { return project.budget && project.budget.availability === 'configured' && project.budget.runBudgetUsd !== null && project.budget.runBudgetUsd !== undefined; });
  var domainCount = profiles.reduce(function(set, profile) {
    (profile.enabledDomains || []).forEach(function(domain) { set[domain] = true; });
    return set;
  }, {});
  var domainTotal = Object.keys(domainCount).length;
  var policyProblems = policyProjects.filter(function(project) { return project.availability !== 'configured'; }).length;
  setText('business-flex-title', configuredProfiles.length ? configuredProfiles.length + ' configured operating polic' + (configuredProfiles.length === 1 ? 'y' : 'ies') : 'Operating policy needs attention');
  setText('business-flex-subcopy', 'Current project policy, historical run snapshots, and observed consumption are kept separate so configured limits never look like spend.');
  setText('business-flex-status-chip', policyProblems ? policyProblems + ' policy issue' + (policyProblems === 1 ? '' : 's') : 'Policy configured');
  setClass('business-flex-status-chip', 'command-status ' + (policyProblems ? 'warn' : 'ok'));
  setText('business-flex-profiles', configuredProfiles.length);
  setText('business-flex-profiles-s', configuredProfiles.map(function(project) { return project.profile.id; }).join(', ') || 'No configured profile');
  setText('business-flex-domains', domainTotal);
  setText('business-flex-domains-s', 'across selected business teams');
  setText('business-flex-budget', configuredCaps.length ? '$' + configuredCaps.reduce(function(sum, project) { return sum + Number(project.budget.runBudgetUsd); }, 0).toFixed(2) : '—');
  setText('business-flex-budget-s', configuredCaps.length ? configuredCaps.length + ' file-backed run cap' + (configuredCaps.length === 1 ? '' : 's') : 'No valid run cap in scope');
  setText('business-flex-routing', routing.length);
  setText('business-flex-routing-s', (budget.tasksWithBudget || 0) + ' tasks include budget metadata');
  setText('business-flex-profile-count', policyProjects.length + ' project polic' + (policyProjects.length === 1 ? 'y' : 'ies'));
  setHTML('business-flex-profiles-list', businessPolicyLedgerHtml(model));
  setText('business-flex-budget-count', (model.runSnapshots || []).length + ' run snapshot' + ((model.runSnapshots || []).length === 1 ? '' : 's'));
  setHTML('business-flex-budget-list', businessRunSnapshotsHtml(model) + businessBudgetHtml(model));
  setText('business-flex-routing-count', routing.length + ' routed tasks');
  setHTML('business-flex-routing-list', routing.slice(0, 24).map(businessRoutingHtml).join('') || emptyHtml('No routing proof yet', 'Task routing appears after sdlc_plan writes tasks.json.'));
}

function businessProfileHtml(profile) {
  return '<div class="project-card"><div class="agent-head"><div><div class="strong">' + esc(profile.name || profile.profile) + '</div><div class="muted mono">' + esc(profile.profile) + ' / ' + esc(profile.workflow || '') + ' / ' + esc(profile.runs || 0) + ' runs</div></div>' + pill('active', 'profile') + '</div><div class="chips">' + (profile.enabledDomains || []).slice(0, 8).map(chip).join('') + '</div><div class="muted">Agents: ' + esc((profile.enabledAgents || []).slice(0, 5).join(', ') || '-') + '</div><div class="muted">Plugins: ' + esc((profile.enabledPlugins || []).slice(0, 5).join(', ') || '-') + '</div></div>';
}

function businessBudgetHtml(model) {
  var budget = model.budget || {};
  if (!budget.tasksWithBudget && !budget.runBudgetTotal && !budget.estimatedTaskBudget) {
    return emptyHtml('No planned envelopes yet', 'Current configured policy is shown above. Per-run and per-task plans appear here only after planning metadata is written.');
  }
  return '<div class="metric-row">' + pill('warn', '$' + Number(budget.runBudgetTotal || 0).toFixed(2) + ' snapshot run budget') + pill('pass', '$' + Number(budget.estimatedTaskBudget || 0).toFixed(2) + ' task estimate') + pill('info', (budget.tasksWithBudget || 0) + ' budgeted tasks') + '</div><div class="muted" style="margin-top:12px">These are historical plan and task envelopes copied into run metadata. They do not replace the current file-backed policy above.</div>';
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
