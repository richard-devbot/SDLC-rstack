// owner: RStack developed by Richardson Gunde

export function clientScript(port) {
  return `
var STATE = null;
var PORT = ${port};
var WS_CONNECTED = false;
var reconnectTimer = null;
var ws = null;
var WORKFLOW_SELECTED_STAGE_ID = null;

var WORKFLOW_STAGE_META = {
  '00-environment': {
    business: 'System Check',
    persona: 'IT Setup Specialist',
    role: 'Gets the studio ready',
    desc: 'Checks that every tool, folder and runtime needed for a run is available before work starts.',
    reads: 'kickoff context',
    writes: 'readiness report'
  },
  '01-transcript': {
    business: 'Understanding The Ask',
    persona: 'Business Analyst',
    role: 'Captures the working session',
    desc: 'Turns the user conversation into a structured record so later agents do not guess intent.',
    reads: 'session transcript',
    writes: 'project brief'
  },
  '02-requirements': {
    business: 'Define What To Build',
    persona: 'Senior Analyst',
    role: 'Writes the requirements',
    desc: 'Converts the brief into clear feature, constraint and success criteria for delivery.',
    reads: 'project brief',
    writes: 'requirements spec'
  },
  '03-documentation': {
    business: 'Business Paperwork',
    persona: 'Technical Writer',
    role: 'Prepares decision-ready docs',
    desc: 'Packages requirements into readable documents that business and delivery teams can review.',
    reads: 'requirements',
    writes: 'documentation set'
  },
  '04-planning': {
    business: 'Delivery Plan',
    persona: 'Project Manager',
    role: 'Breaks work into steps',
    desc: 'Turns the scope into a staged plan with sequencing, milestones and handoff expectations.',
    reads: 'requirements',
    writes: 'implementation plan'
  },
  '05-jira': {
    business: 'Task Tickets',
    persona: 'Scrum Master',
    role: 'Creates trackable work',
    desc: 'Makes the work visible as tickets and acceptance criteria that teams can follow.',
    reads: 'delivery plan',
    writes: 'task tickets'
  },
  '06-architecture': {
    business: 'System Design',
    persona: 'Solution Architect',
    role: 'Designs the system',
    desc: 'Defines the architecture, data movement, major trade-offs and technical boundaries.',
    reads: 'requirements',
    writes: 'system design'
  },
  '07-code': {
    business: 'Build The Software',
    persona: 'Senior Developer',
    role: 'Writes production code',
    desc: 'Implements the planned changes and records what changed through builder contracts.',
    reads: 'system design',
    writes: 'code report'
  },
  '08-testing': {
    business: 'Quality Checks',
    persona: 'QA Lead',
    role: 'Validates the work',
    desc: 'Checks outcomes against requirements and attaches validation evidence to the run.',
    reads: 'code report',
    writes: 'test report'
  },
  '09-deployment': {
    business: 'Going Live',
    persona: 'DevOps Engineer',
    role: 'Prepares release',
    desc: 'Packages delivery, release checks, deployment evidence and rollout readiness.',
    reads: 'test report',
    writes: 'deployment report'
  },
  '10-summary': {
    business: 'Handoff Package',
    persona: 'Delivery Lead',
    role: 'Summarizes the run',
    desc: 'Collects outcomes, proof and next steps into a handoff summary.',
    reads: 'all stage outputs',
    writes: 'run summary'
  },
  '11-feedback-loop': {
    business: 'Learning Loop',
    persona: 'Customer Success Lead',
    role: 'Captures feedback',
    desc: 'Feeds lessons, follow-ups and product signals back into the next iteration.',
    reads: 'handoff summary',
    writes: 'feedback record'
  },
  '12-security-threat-model': {
    business: 'Security Review',
    persona: 'Security Lead',
    role: 'Models threats',
    desc: 'Identifies security risks, attack surfaces and mitigation needs before shipment confidence is claimed.',
    reads: 'architecture and code',
    writes: 'threat model'
  },
  '13-compliance-checker': {
    business: 'Compliance Check',
    persona: 'Compliance Lead',
    role: 'Checks obligations',
    desc: 'Reviews privacy, regulatory, policy and enterprise-readiness expectations for the run.',
    reads: 'requirements and evidence',
    writes: 'compliance report'
  },
  '14-cost-estimation': {
    business: 'Cost Forecast',
    persona: 'Finance Analyst',
    role: 'Estimates operating cost',
    desc: 'Captures cost signals and expected operating impact so business teams can plan responsibly.',
    reads: 'deployment design',
    writes: 'cost estimate'
  }
};

var PAGE_LABELS = {
  command: 'Command Center',
  'business-flex': 'Business Flex',
  workflow: 'Workflow Map',
  projects: 'Projects & Runs',
  'run-report': 'Run Report',
  'run-analytics': 'Run Analytics',
  'agent-work': 'Agent Work',
  'live-feed': 'Live Feed',
  team: 'Team & Presence',
  approvals: 'Approvals',
  decisions: 'Decisions / Readiness',
  'release-readiness': 'Release Readiness',
  security: 'Security',
  compliance: 'Compliance',
  'cost-budget': 'Cost & Budget',
  'alerts-guardrails': 'Alerts & Guardrails',
  traceability: 'Requirements & Traceability',
  'team-layers': 'Team & Layers',
  diagnostics: 'Diagnostics'
};

var PAGE_SUBS = {
  command: 'Operational overview across every known .rstack project, run, agent action, approval and alert.',
  'business-flex': 'Profiles, budget guardrails, selected teams, and routing proof for business-team SDLC flexibility.',
  workflow: 'The canonical SDLC flow, grouped by stage with pass, fail, active and ready counts from real run tasks.',
  projects: 'All registered project roots and their run sessions, costs, task status and activity timeline.',
  'run-analytics': 'Wall-clock run timelines, per-stage durations and run-over-run delivery trends derived from events.jsonl.',
  team: 'Who is live and working right now, the people behind every run, approval and guidance, and the manager project rollup.',
  studio: 'The live agent studio — every stage as a workstation, the Manager narrating progress, status as glow. Click an agent for their report.',
  'run-report': 'Every stage report as an infographic — requirements, architecture, tests, security, compliance, cost, release gate — for the selected run.',
  'agent-work': 'Builder and validator work grouped by project, run, stage and agent contract.',
  'live-feed': 'Real-time event stream from events.jsonl plus live WebSocket refreshes.',
  approvals: 'Human-in-loop actions from the approval queue only.',
  decisions: 'Decision Queue and Definition-of-Ready status from decisions.json, dor-report.json and readiness.json.',
  'release-readiness': 'The conservative ship/no-ship view: blockers, test status, unresolved gates, evidence completeness, and manager actions.',
  security: 'Threat registry and release-gate status from threat-model artifacts, open risks, and security-stage findings.',
  compliance: 'Control coverage, audit gaps, evidence status, and compliance readiness across SDLC runs.',
  'cost-budget': 'Estimated cost, run spend, budget envelopes, and cost drivers for business governance.',
  'alerts-guardrails': 'Threshold alerts, blocked gates, guardrails, stalled work and spend risks.',
  traceability: 'FR/NFR requirements, stage artifacts, verified tasks and evidence connected by run.',
  'team-layers': 'Stack layers and framework health across harness, tracker, alerts, hooks, memory and observers.',
  diagnostics: 'Source roots, missing builder contracts, validation coverage and raw .rstack data health.'
};

document.querySelectorAll('.nav-link').forEach(function(btn) {
  btn.addEventListener('click', function() {
    showPage(btn.getAttribute('data-page'));
  });
});

function showPage(name) {
  document.querySelectorAll('.nav-link').forEach(function(btn) {
    btn.classList.toggle('active', btn.getAttribute('data-page') === name);
  });
  document.querySelectorAll('.page').forEach(function(page) {
    page.classList.toggle('active', page.id === 'page-' + name);
  });
  setText('page-title', PAGE_LABELS[name] || name);
}

function applyState(state) {
  STATE = state;
  try { notifyNewGates(state); } catch (err) { /* notifications are best-effort */ }
  try { renderScopeSelectors(state); } catch (err) { showErr('scope: ' + err.message); }
  var scoped = applyScope(state);
  try { renderFrame(state); } catch (err) { showErr('frame: ' + err.message); }
  try { renderCommand(scoped); } catch (err) { showErr('command: ' + err.message); }
  try { renderBusinessFlex(scoped); } catch (err) { showErr('business flex: ' + err.message); }
  try { renderStudio(scoped); } catch (err) { showErr('studio: ' + err.message); }
  try { renderWorkflow(scoped); } catch (err) { showErr('workflow: ' + err.message); }
  try { renderProjects(scoped); } catch (err) { showErr('projects: ' + err.message); }
  try { renderRunAnalytics(scoped); } catch (err) { showErr('run analytics: ' + err.message); }
  try { renderRunReport(scoped); } catch (err) { showErr('run report: ' + err.message); }
  try { renderTeam(scoped); } catch (err) { showErr('team: ' + err.message); }
  try { renderAgentWork(scoped); } catch (err) { showErr('agent work: ' + err.message); }
  try { renderLiveFeed(scoped); } catch (err) { showErr('live feed: ' + err.message); }
  try { renderApprovals(state); } catch (err) { showErr('approvals: ' + err.message); }
  try { renderDecisions(scoped); } catch (err) { showErr('decisions: ' + err.message); }
  try { renderReleaseReadiness(scoped); } catch (err) { showErr('release readiness: ' + err.message); }
  try { renderSecurity(scoped); } catch (err) { showErr('security: ' + err.message); }
  try { renderCompliance(scoped); } catch (err) { showErr('compliance: ' + err.message); }
  try { renderCostBudget(scoped); } catch (err) { showErr('cost budget: ' + err.message); }
  try { renderAlertsGuardrails(state); } catch (err) { showErr('alerts: ' + err.message); }
  try { renderTraceability(scoped); } catch (err) { showErr('traceability: ' + err.message); }
  try { renderTeamLayers(scoped); } catch (err) { showErr('team layers: ' + err.message); }
  try { renderDiagnostics(state); } catch (err) { showErr('diagnostics: ' + err.message); }
}

// ── Global project → run scope (issue #43) ──────────────────────────────────
var SCOPE = {
  project: localStorage.getItem('rstack-scope-project') || '',
  run: localStorage.getItem('rstack-scope-run') || '',
};
// Deep link: #run=<runId> wins over stored scope.
(function initScopeFromHash() {
  var match = /[#&]run=([^&]+)/.exec(location.hash || '');
  if (match) { SCOPE.run = decodeURIComponent(match[1]); SCOPE.project = ''; }
})();

function setScopeProject(value) {
  SCOPE.project = value;
  SCOPE.run = '';
  localStorage.setItem('rstack-scope-project', value);
  localStorage.setItem('rstack-scope-run', '');
  if (location.hash) history.replaceState(null, '', location.pathname);
  if (STATE) applyState(STATE);
}

function setScopeRun(value) {
  SCOPE.run = value;
  localStorage.setItem('rstack-scope-run', value);
  history.replaceState(null, '', value ? '#run=' + encodeURIComponent(value) : location.pathname);
  if (STATE) applyState(STATE);
}

function renderScopeSelectors(s) {
  var runs = s.runs || [];
  var projectSelect = document.getElementById('scope-project');
  var runSelect = document.getElementById('scope-run');
  if (!projectSelect || !runSelect) return;
  var roots = [];
  runs.forEach(function(run) { if (run.projectRoot && roots.indexOf(run.projectRoot) === -1) roots.push(run.projectRoot); });
  projectSelect.innerHTML = '<option value="">All projects</option>' + roots.map(function(root) {
    return '<option value="' + esc(root) + '"' + (root === SCOPE.project ? ' selected' : '') + '>' + esc(shortName(root)) + '</option>';
  }).join('');
  var scopedRuns = SCOPE.project ? runs.filter(function(run) { return run.projectRoot === SCOPE.project; }) : runs;
  runSelect.innerHTML = '<option value="">All runs</option>' + scopedRuns.map(function(run) {
    var label = ((run.manifest && run.manifest.goal) || run.runId).slice(0, 60);
    return '<option value="' + esc(run.runId) + '"' + (run.runId === SCOPE.run ? ' selected' : '') + '>' + esc(label) + '</option>';
  }).join('');
}

function applyScope(s) {
  if (!SCOPE.project && !SCOPE.run) return s;
  var runs = (s.runs || []).filter(function(run) {
    if (SCOPE.run) return run.runId === SCOPE.run;
    return run.projectRoot === SCOPE.project;
  });
  var runIds = {};
  runs.forEach(function(run) { runIds[run.runId] = true; });
  var copy = {};
  for (var key in s) copy[key] = s[key];
  copy.runs = runs;
  copy.feed = (s.feed || []).filter(function(item) { return !item.runId || runIds[item.runId]; });
  copy.agentWork = (s.agentWork || []).filter(function(work) { return !work.runId || runIds[work.runId]; });
  copy.agentGroups = (s.agentGroups || []).filter(function(group) { return !group.runId || runIds[group.runId]; });
  copy.businessFlex = null;
  if (s.decisions) {
    var scopedDecisionRuns = (s.decisions.runs || []).filter(function(row) { return runIds[row.runId]; });
    var scopedTotals = scopedDecisionRuns.reduce(function(acc, row) {
      var summary = row.summary || {};
      var readiness = row.readiness || {};
      acc.total += Number(summary.total || 0);
      acc.pending += Number(summary.pending || 0);
      acc.resolved += Number(summary.resolved || 0);
      acc.waived += Number(summary.waived || 0);
      if (readiness.status === 'PASS') acc.pass += 1;
      if (readiness.status === 'WARN') acc.warn += 1;
      if (readiness.status === 'FAIL') acc.fail += 1;
      return acc;
    }, { total: 0, pending: 0, resolved: 0, waived: 0, pass: 0, warn: 0, fail: 0 });
    copy.decisions = {
      totals: scopedTotals,
      runs: scopedDecisionRuns
    };
  }
  copy.presence = (s.presence || []).filter(function(item) { return runIds[item.runId]; });
  copy.trends = s.trends ? {
    stages: s.trends.stages || {},
    runs: (s.trends.runs || []).filter(function(row) { return runIds[row.runId]; }),
  } : s.trends;
  return copy;
}

// ── Browser notifications for new approval gates (issue #42) ────────────────
var SEEN_GATES = null;

function notifyNewGates(s) {
  var pending = (s.pendingApprovals || []).map(function(item) { return 'p:' + (item.id || item.artifact); });
  var blocked = (s.blockedGates || []).map(function(gate) { return 'b:' + (gate.id || gate.runId); });
  var current = pending.concat(blocked);
  if (SEEN_GATES === null) { SEEN_GATES = current; return; } // first snapshot: baseline only
  var fresh = current.filter(function(key) { return SEEN_GATES.indexOf(key) === -1; });
  SEEN_GATES = current;
  if (!fresh.length || typeof Notification === 'undefined') return;
  if (Notification.permission === 'default') { Notification.requestPermission(); return; }
  if (Notification.permission !== 'granted') return;
  try {
    new Notification('RStack: approval needed', {
      body: fresh.length + ' new approval gate(s) waiting. No change ships without sign-off.',
      tag: 'rstack-approvals',
    });
  } catch (err) { /* best-effort */ }
}

// ── Team & Presence page (issue #42) ────────────────────────────────────────
function renderTeam(s) {
  var presence = s.presence || [];
  var live = presence.filter(function(item) { return item.live; });
  setText('team-live-count', live.length + ' live / ' + presence.length + ' recent');
  setHTML('team-live', presence.map(function(item) {
    var dot = item.live ? '<span class="presence-dot live"></span>' : '<span class="presence-dot"></span>';
    var task = item.currentTask
      ? chip((item.currentTask.agent || 'agent') + ' → ' + item.currentTask.title)
      : '<span class="muted">between tasks</span>';
    return '<div class="stack-item clickable" data-runid="' + esc(item.runId) + '" onclick="openDrawerRow(this)">' +
      '<div>' + dot + '<span class="strong">' + esc(item.startedBy) + '</span> <span class="muted">on</span> ' + esc(shortName(item.projectRoot)) + '' +
      '<div class="muted">' + esc(item.goal) + '</div></div>' +
      '<div class="metric-row">' + task + '<span class="faint mono">' + fmtAgo(item.secondsAgo) + '</span></div>' +
    '</div>';
  }).join('') || emptyHtml('Nobody live right now', 'Runs with events in the last 30 minutes appear here.'));

  var people = s.people || [];
  setText('team-people-count', people.length + ' people');
  setHTML('team-people-table', people.map(function(person) {
    return '<tr>' +
      '<td><div class="strong">' + esc(person.name) + '</div>' + (person.email ? '<div class="faint mono">' + esc(person.email) + '</div>' : '') + '</td>' +
      '<td class="mono">' + person.runsStarted + '</td>' +
      '<td class="mono">' + person.approvals + (person.rejections ? ' <span class="muted">/ ' + person.rejections + ' rejected</span>' : '') + '</td>' +
      '<td class="mono">' + person.guidance + '</td>' +
      '<td class="mono muted">' + (person.lastSeen ? fmtTime(person.lastSeen) : '-') + '</td>' +
    '</tr>';
  }).join('') || '<tr><td colspan="5" class="empty">No people yet — runs started after the people layer record who did what</td></tr>');

  var projects = s.projectSummaries || [];
  var blocked = s.blockedGates || [];
  var runs = s.runs || [];
  setText('team-manager-count', projects.length + ' projects');
  setHTML('team-manager-table', projects.map(function(project) {
    var projectRuns = runs.filter(function(run) { return run.projectRoot === project.projectRoot; });
    var durations = projectRuns.map(function(run) { return (run.totals || {}).duration_ms || 0; }).filter(Boolean);
    var avg = durations.length ? durations.reduce(function(sum, ms) { return sum + ms; }, 0) / durations.length : 0;
    var total = project.passed + project.failed;
    var rate = total ? Math.round(project.passed / total * 100) : 0;
    var gates = blocked.filter(function(gate) { return projectRuns.some(function(run) { return run.runId === gate.runId; }); }).length;
    return '<tr>' +
      '<td><div class="strong">' + esc(project.name) + '</div></td>' +
      '<td class="mono">' + project.runs + (project.active ? ' <span class="muted">(' + project.active + ' active)</span>' : '') + '</td>' +
      '<td class="mono">' + fmtDur(avg) + '</td>' +
      '<td class="mono">' + rate + '%</td>' +
      '<td class="mono">' + (gates ? '<span class="strong">' + gates + '</span>' : '0') + '</td>' +
    '</tr>';
  }).join('') || '<tr><td colspan="5" class="empty">No projects yet</td></tr>');

  var guidanceFeed = (s.feed || []).filter(function(item) { return item.type === 'clarification_answers_added'; });
  setText('team-guidance-count', guidanceFeed.length + ' entries');
  setHTML('team-guidance', guidanceFeed.slice(0, 30).map(feedRowHtml).join('') ||
    emptyHtml('No guidance recorded yet', 'When a developer answers clarification questions, it shows up here with their name.'));
}

function fmtAgo(seconds) {
  if (seconds < 60) return seconds + 's ago';
  var minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes + 'm ago';
  return Math.floor(minutes / 60) + 'h ago';
}

function renderFrame(s) {
  var tasks = allTasks(s);
  var passed = tasks.filter(function(task) { return task.status === 'PASS'; }).length;
  var alerts = s.alerts || [];
  var pending = s.pendingApprovals || [];
  setText('side-runs', s.totalRuns || 0);
  setText('side-cost', '$' + Number(s.totalCost || 0).toFixed(2));
  setText('side-pass', passed);
  setText('side-agents', (s.agentWork || []).length);
  setBadge('badge-approvals', pending.length);
  setBadge('badge-alerts', alerts.length);
  setText('alert-count', alerts.length + ' alerts');
  setText('approval-count', pending.length + ' pending');
  setClass('btn-alerts', 'tb-chip' + (alerts.length ? ' danger' : ''));
  setClass('btn-approvals', 'tb-chip' + (pending.length ? ' warn' : ''));
  Object.keys(PAGE_SUBS).forEach(function(page) {
    setText(page + '-sub', PAGE_SUBS[page]);
    setText(page + '-updated', s.ts ? 'Updated ' + fmtTime(s.ts) : '');
  });
}

function renderCommand(s) {
  var tasks = allTasks(s);
  var counts = taskStatusCounts(tasks);
  var diagnostics = s.diagnostics || {};
  var projects = s.projectSummaries || [];
  var agentWork = s.agentWork || [];
  var activeRunCount = (s.activeRuns || []).length;
  var pendingWork = counts.PENDING + counts.READY + counts.QUEUED;
  var evidenceActions = agentWork.filter(function(work) { return (work.evidenceCount || 0) > 0; }).length;
  var attentionItems = commandAttentionItems(s, counts);
  var hasAttention = attentionItems.length > 0;

  setText('command-summary-title', commandSummaryTitle(s, attentionItems, counts));
  setText('command-summary-sub', commandSummarySub(s, attentionItems, counts));
  setText('command-status-chip', hasAttention ? 'Needs review' : activeRunCount ? 'Live work running' : 'All clear');
  setClass('command-status-chip', 'command-status ' + (hasAttention ? 'warn' : activeRunCount ? 'active' : 'ok'));
  renderExecutiveMissionBrief(s);

  setText('kpi-projects', projects.length);
  setText('kpi-projects-s', (s.sourceRoots || []).length + ' source roots tracked');
  setText('kpi-runs', s.totalRuns || 0);
  setText('kpi-runs-s', (s.todayCount || 0) + ' today, ' + activeRunCount + ' active');
  setText('kpi-pass', counts.PASS);
  setText('kpi-pass-s', counts.FAIL + ' failed, ' + tasks.length + ' total tasks');
  setText('kpi-progress', counts.IN_PROGRESS);
  setText('kpi-progress-s', activeRunCount + ' active runs now');
  setText('kpi-pending', pendingWork);
  setText('kpi-pending-s', (diagnostics.missingValidationCount || 0) + ' missing validations');
  setText('kpi-evidence', diagnostics.evidenceCount || 0);
  setText('kpi-evidence-s', evidenceActions + ' agent actions with checks');

  setText('command-attention-count', attentionItems.length ? attentionItems.length + ' signals' : 'clear');
  setHTML('command-attention', attentionItems.length ? attentionItems.map(attentionItemHtml).join('') : emptyHtml('No open attention signals', 'Approvals, alerts, blocked gates and validation gaps will appear here.'));

  setText('command-stage-count', (s.stageMatrix || []).length + ' canonical stages');
  setHTML('command-stage-strip', commandStageStripHtml(s));

  setText('command-project-count', projects.length + ' projects');
  setHTML('command-projects', commandProjectsHtml(s));

  setText('command-agent-count', agentWork.length + ' actions');
  setHTML('command-agent-proof', commandAgentProofHtml(s));

  setText('command-layer-count', (s.layers || []).length + ' layers');
  setHTML('command-layers', commandLayersHtml(s));

  var feed = (s.feed || []).slice(0, 12);
  setText('command-feed-count', feed.length + ' events');
  setHTML('command-feed', feed.length ? feed.map(feedRowHtml).join('') : emptyHtml('No activity yet', 'Events appear as runs execute.'));
}

function renderExecutiveMissionBrief(s) {
  var tasks = allTasks(s);
  var counts = taskStatusCounts(tasks);
  var pendingApprovals = (s.pendingApprovals || []).length;
  var blocked = (s.blockedGates || []).length;
  var alerts = (s.alerts || []).length;
  var missingValidation = (s.diagnostics && s.diagnostics.missingValidationCount) || 0;
  var openDecisionCount = (((s.decisions || {}).runs || []).reduce(function(sum, run) {
    return sum + ((run.decisions || []).filter(function(d) { return (d.status || 'pending') === 'pending'; }).length);
  }, 0));
  var blockers = blocked + pendingApprovals + counts.FAIL;
  var score = Math.max(0, 100 - (blockers * 12) - Math.min(35, missingValidation) - Math.min(20, alerts));
  var verdict = blockers ? 'BLOCKED' : alerts || missingValidation ? 'READY WITH CONCERNS' : 'READY';
  var nextAction = blockers
    ? 'Resolve ' + blockers + ' blocking gate/test signal' + (blockers === 1 ? '' : 's') + ' before shipment.'
    : openDecisionCount
      ? 'Review ' + openDecisionCount + ' pending architecture/product decision' + (openDecisionCount === 1 ? '' : 's') + '.'
      : missingValidation
        ? 'Attach missing validation proof before production confidence is claimed.'
        : 'No manager-blocking action detected in the current scope.';
  setText('executive-readiness-verdict', verdict);
  setText('executive-next-action', nextAction);
  setText('executive-governance-score', score + '%');
  setText('executive-decision-summary', pendingApprovals ? pendingApprovals + ' approval' + (pendingApprovals === 1 ? '' : 's') + ' pending' : openDecisionCount ? openDecisionCount + ' decision' + (openDecisionCount === 1 ? '' : 's') + ' pending' : 'No pending manager decision');
  var risks = [
    { label: 'Blocked gates', value: blocked, tone: blocked ? 'danger' : 'ok' },
    { label: 'Alerts', value: alerts, tone: alerts ? 'danger' : 'ok' },
    { label: 'Missing validations', value: missingValidation, tone: missingValidation ? 'warn' : 'ok' },
    { label: 'Failed tasks', value: counts.FAIL, tone: counts.FAIL ? 'danger' : 'ok' }
  ];
  setHTML('executive-risk-strip', risks.map(function(risk) {
    return '<div class="risk-chip ' + risk.tone + '"><b>' + esc(risk.value) + '</b><span>' + esc(risk.label) + '</span></div>';
  }).join(''));
}

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

function businessFlexModel(s) {
  if (s.businessFlex && ((s.businessFlex.profiles || []).length || (s.businessFlex.routingSignals || []).length)) return s.businessFlex;
  var profiles = {};
  var routingSignals = [];
  var budget = { runBudgetTotal: 0, estimatedTaskBudget: 0, tasksWithBudget: 0 };
  (s.runs || []).forEach(function(run) {
    var profile = run.profile || {};
    var id = profile.profile || (run.manifest && run.manifest.profile) || 'unprofiled';
    if (!profiles[id]) profiles[id] = { profile: id, name: profile.name || id, workflow: run.workflow || profile.workflow || '', runs: 0, enabledDomains: [], enabledAgents: [], enabledPlugins: [], dashboardPages: [] };
    profiles[id].runs += 1;
    ['enabledDomains', 'enabledAgents', 'enabledPlugins', 'dashboardPages'].forEach(function(key) {
      var sourceKey = key.replace(/[A-Z]/g, function(c) { return '_' + c.toLowerCase(); });
      (profile[sourceKey] || profile[key] || []).forEach(function(value) {
        if (profiles[id][key].indexOf(value) === -1) profiles[id][key].push(value);
      });
    });
    budget.runBudgetTotal += Number((run.budgetPolicy && run.budgetPolicy.run_budget_usd) || 0);
    (run.tasks || []).forEach(function(task) {
      if (task.budget_envelope) {
        budget.tasksWithBudget += 1;
        budget.estimatedTaskBudget += Number(task.budget_envelope.estimated_ai_cost_usd || 0);
      }
      if (task.routing) routingSignals.push({ runId: run.runId, projectRoot: run.projectRoot, taskId: task.id, title: task.title, profile: task.profile || id, selectedBy: task.routing.selected_by, explanation: task.routing.explanation || [], specialists: task.specialists || [], budget: task.budget_envelope || null });
    });
  });
  return { profiles: Object.keys(profiles).map(function(k) { return profiles[k]; }), budget: budget, routingSignals: routingSignals };
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

function commandSummaryTitle(s, attentionItems, counts) {
  var activeRunCount = (s.activeRuns || []).length;
  if (attentionItems.length) {
    return 'Delivery is active with ' + attentionItems.length + ' attention signals';
  }
  if (activeRunCount) {
    return activeRunCount + ' run session' + (activeRunCount === 1 ? ' is' : 's are') + ' moving now';
  }
  if ((s.totalRuns || 0) > 0) {
    return 'No active runs right now, history is ready for review';
  }
  return 'No .rstack run sessions loaded yet';
}

function commandSummarySub(s, attentionItems, counts) {
  var blocked = (s.blockedGates || []).length;
  var pendingApprovals = (s.pendingApprovals || []).length;
  var diagnostics = s.diagnostics || {};
  var pendingWork = counts.PENDING + counts.READY + counts.QUEUED;
  if (attentionItems.length) {
    return blocked + ' blocked gates, ' + pendingApprovals + ' pending approvals, ' + pendingWork + ' pending tasks and ' + (diagnostics.missingValidationCount || 0) + ' missing validations are being shown from live .rstack data.';
  }
  return (s.totalRuns || 0) + ' runs, ' + (s.projectSummaries || []).length + ' projects, ' + (s.agentWork || []).length + ' agent actions and ' + (s.alerts || []).length + ' alerts are loaded from .rstack.';
}

function commandAttentionItems(s, counts) {
  var runs = s.runs || [];
  var diagnostics = s.diagnostics || {};
  var stalled = runs.filter(function(run) { return run.derivedStatus === 'stalled'; }).length;
  var blocked = (s.blockedGates || []).length;
  var pendingApprovals = (s.pendingApprovals || []).length;
  var alerts = (s.alerts || []).length;
  var missingValidation = diagnostics.missingValidationCount || 0;
  var missingBuilder = diagnostics.missingBuilderCount || 0;
  var items = [];

  if (pendingApprovals) {
    items.push({ level: 'warn', value: pendingApprovals, title: 'Human approval needed', detail: 'Queue-backed approvals waiting for a manager decision.', meta: 'Approvals' });
  }
  if (blocked) {
    items.push({ level: 'danger', value: blocked, title: 'Blocked guardrail gates', detail: 'Historical gate blocks that can slow release confidence.', meta: 'Guardrails' });
  }
  if (stalled) {
    items.push({ level: 'warn', value: stalled, title: 'Stalled run sessions', detail: 'Run sessions with no recent movement in the tracked .rstack data.', meta: 'Runs' });
  }
  if (counts.FAIL) {
    items.push({ level: 'danger', value: counts.FAIL, title: 'Failed tasks', detail: 'Tasks marked FAIL by the underlying run state.', meta: 'Workflow' });
  }
  if (missingValidation) {
    items.push({ level: 'warn', value: missingValidation, title: 'Missing validations', detail: 'Agent work that does not yet have validation.json proof attached.', meta: 'Proof' });
  }
  if (missingBuilder) {
    items.push({ level: 'warn', value: missingBuilder, title: 'Missing builder contracts', detail: 'Tasks without builder.json summaries, decisions and file evidence.', meta: 'Agent work' });
  }
  if (alerts && !blocked && !stalled && !counts.FAIL) {
    items.push({ level: 'info', value: alerts, title: 'Alerts available', detail: 'Threshold signals are available in Alerts & Guardrails.', meta: 'Alerts' });
  }

  return items;
}

function attentionItemHtml(item) {
  return '<div class="attention-item ' + esc(item.level || 'info') + '">' +
    '<div class="attention-value">' + esc(item.value) + '</div>' +
    '<div><div class="attention-title">' + esc(item.title) + '</div><div class="attention-detail">' + esc(item.detail) + '</div></div>' +
    pill(item.level === 'danger' ? 'fail' : item.level === 'warn' ? 'warn' : 'info', item.meta || 'Review') +
  '</div>';
}

function commandStageStripHtml(s) {
  var stages = s.stageMatrix || [];
  return stages.length ? stages.map(stageMiniHtml).join('') : emptyHtml('No SDLC stage data', 'The 15-stage map appears when run tasks are loaded.');
}

function stageMiniHtml(stage) {
  var runs = stage.runs || [];
  var riskCount = runs.reduce(function(total, run) { return total + (run.riskCount || 0); }, 0);
  var evidenceCount = runs.reduce(function(total, run) { return total + (run.evidenceCount || 0); }, 0);
  var validationCount = runs.filter(function(run) { return !!run.validationStatus; }).length;
  var status = (stage.fail || 0) > 0 ? 'danger' : (stage.active || 0) > 0 ? 'active' : (stage.pass || 0) > 0 ? 'pass' : 'ready';
  var index = String(stage.id || '').slice(0, 2);
  return '<div class="stage-mini ' + esc(status) + '">' +
    '<div class="stage-mini-top"><span class="stage-index">' + esc(index || '--') + '</span>' + pill(status === 'danger' ? 'fail' : status === 'active' ? 'running' : status === 'pass' ? 'pass' : 'ready', status === 'danger' ? 'risk' : status) + '</div>' +
    '<div class="stage-mini-name">' + esc(stage.title || stage.id || 'Stage') + '</div>' +
    '<div class="stage-mini-agent">' + esc(stage.agent || 'agent') + '</div>' +
    '<div class="stage-mini-artifact">' + esc(stage.artifact || 'artifact') + '</div>' +
    '<div class="stage-mini-metrics">' +
      '<span><b>' + esc(stage.pass || 0) + '</b> pass</span>' +
      '<span><b>' + esc(stage.fail || 0) + '</b> fail</span>' +
      '<span><b>' + esc(stage.active || 0) + '</b> active</span>' +
      '<span><b>' + esc(stage.ready || 0) + '</b> ready</span>' +
    '</div>' +
    '<div class="stage-mini-foot">' + chip(evidenceCount + ' checks') + chip(validationCount + ' validations') + chip(riskCount + ' risks') + '</div>' +
  '</div>';
}

function commandProjectsHtml(s) {
  var projects = s.projectSummaries || [];
  if (!projects.length) return emptyHtml('No registered projects', 'Known project roots appear after the registry or run folders are loaded.');
  return projects.map(function(project) {
    var total = project.passed + project.failed;
    var rate = total ? Math.round(project.passed / total * 100) : 0;
    var state = project.active ? 'active' : project.stalled ? 'warn' : project.runs ? 'pass' : 'ready';
    return '<div class="command-row">' +
      '<div><div class="strong">' + esc(project.name) + '</div><div class="feed-meta"><span>' + esc(project.runs) + ' runs</span><span>' + esc(project.tasks) + ' tasks</span><span>' + esc(project.stalled) + ' stalled</span></div></div>' +
      '<div class="command-row-side">' + pill(state, project.active ? project.active + ' active' : state) + '<div class="progress"><div class="progress-fill" style="width:' + rate + '%"></div></div></div>' +
    '</div>';
  }).join('');
}

function commandAgentProofHtml(s) {
  var work = s.agentWork || [];
  var diagnostics = s.diagnostics || {};
  var evidenceActions = work.filter(function(item) { return (item.evidenceCount || 0) > 0; }).length;
  var risks = work.reduce(function(total, item) { return total + (item.riskCount || 0); }, 0);
  var recent = work.slice(0, 4);
  var summary = '<div class="proof-grid">' +
    '<div><div class="proof-value">' + esc(work.length) + '</div><div class="proof-label">agent actions</div></div>' +
    '<div><div class="proof-value">' + esc(evidenceActions) + '</div><div class="proof-label">with checks</div></div>' +
    '<div><div class="proof-value">' + esc(risks) + '</div><div class="proof-label">reported risks</div></div>' +
    '<div><div class="proof-value">' + esc(diagnostics.missingValidationCount || 0) + '</div><div class="proof-label">missing validations</div></div>' +
  '</div>';
  if (!recent.length) return summary + emptyHtml('No agent work yet', 'builder.json and validation.json data appears here.');
  return summary + '<div class="proof-list">' + recent.map(function(item) {
    return '<div class="proof-item"><div><div class="strong">' + esc(item.title || item.taskId) + '</div><div class="feed-meta"><span>' + esc(shortName(item.projectRoot)) + '</span><span>' + esc(item.stageId || item.taskId || '') + '</span></div></div>' +
      '<div class="metric-row">' + pill(item.status || 'ready') + chip((item.evidenceCount || 0) + ' checks') + chip((item.riskCount || 0) + ' risks') + '</div></div>';
  }).join('') + '</div>';
}

function commandLayersHtml(s) {
  var layers = s.layers || [];
  if (!layers.length) return emptyHtml('No layer data', 'Stack layer health appears once the snapshot is loaded.');
  return layers.map(function(layer) {
    return '<div class="command-row layer-row-mini">' +
      '<div><div class="strong">' + esc(layer.name) + '</div><div class="attention-detail">' + esc(layer.detail) + '</div></div>' +
      '<div class="command-row-side">' + pill(layer.health, layer.health) + '<div class="side-v mini">' + esc(layer.count) + '</div></div>' +
    '</div>';
  }).join('');
}

function renderWorkflow(s) {
  var stages = s.stageMatrix || [];
  var runs = s.runs || [];
  var activeStages = stages.filter(function(stage) { return (stage.active || 0) > 0; }).length;
  var validations = stages.reduce(function(total, stage) {
    return total + (stage.runs || []).filter(function(run) { return !!run.validationStatus; }).length;
  }, 0);

  setText('workflow-count', stages.length);
  setText('workflow-runs', runs.length);
  setText('workflow-active-stages', activeStages);
  setText('workflow-validations', validations);

  if (!WORKFLOW_SELECTED_STAGE_ID || !stages.some(function(stage) { return stage.id === WORKFLOW_SELECTED_STAGE_ID; })) {
    var focused = stages.filter(function(stage) { return (stage.fail || 0) > 0; })[0] ||
      stages.filter(function(stage) { return (stage.active || 0) > 0; })[0] ||
      stages.filter(function(stage) { return (stage.pass || 0) > 0; })[0] ||
      stages[0];
    WORKFLOW_SELECTED_STAGE_ID = focused && focused.id;
  }

  setHTML('workflow-rail', workflowRailHtml(stages));
  setHTML('workflow-grid', stages.length ? stages.map(workflowStageCardHtml).join('') : emptyHtml('No workflow data', 'Stage data appears once runs are loaded.'));
  setHTML('workflow-inspector', workflowInspectorHtml(stages.filter(function(stage) { return stage.id === WORKFLOW_SELECTED_STAGE_ID; })[0], s));
}

function workflowRailHtml(stages) {
  if (!stages.length) return '';
  return stages.map(function(stage, index) {
    var status = workflowStageStatus(stage);
    return '<button type="button" class="rail-step ' + esc(status) + (stage.id === WORKFLOW_SELECTED_STAGE_ID ? ' selected' : '') + '" data-stageid="' + esc(stage.id) + '" onclick="openWorkflowStageButton(this)">' +
      '<span>' + esc(String(index).padStart(2, '0')) + '</span>' +
      '<b>' + esc((stage.title || '').split(' ')[0] || stage.id) + '</b>' +
    '</button>';
  }).join('');
}

function workflowStageCardHtml(stage, index) {
  var meta = workflowStageMeta(stage);
  var status = workflowStageStatus(stage);
  var runs = stage.runs || [];
  var riskCount = runs.reduce(function(total, run) { return total + (run.riskCount || 0); }, 0);
  var evidenceCount = runs.reduce(function(total, run) { return total + (run.evidenceCount || 0); }, 0);
  var validationCount = runs.filter(function(run) { return !!run.validationStatus; }).length;
  var done = stage.pass || 0;
  var fail = stage.fail || 0;
  var active = stage.active || 0;
  var ready = stage.ready || 0;
  var total = Math.max(1, runs.length || done + fail + active + ready);
  var passWidth = Math.round(done / total * 100);
  var failWidth = Math.round(fail / total * 100);
  var activeWidth = Math.round(active / total * 100);
  var readyWidth = Math.max(0, 100 - passWidth - failWidth - activeWidth);

  return '<button type="button" class="workspace-stage-card ' + esc(status) + (stage.id === WORKFLOW_SELECTED_STAGE_ID ? ' selected' : '') + '" data-stageid="' + esc(stage.id) + '" onclick="openWorkflowStageButton(this)">' +
    '<div class="workspace-stage-top"><span class="workspace-stage-id">' + esc(String(index).padStart(2, '0')) + '</span>' + pill(status === 'fail' ? 'fail' : status === 'running' ? 'running' : status === 'pass' ? 'pass' : 'ready', status === 'fail' ? 'review' : status) + '</div>' +
    '<div class="workspace-agent">' +
      '<div class="agent-avatar">' + esc(String(index).padStart(2, '0')) + '</div>' +
      '<div><div class="agent-persona">' + esc(meta.persona) + '</div><div class="agent-role">' + esc(meta.role) + '</div></div>' +
    '</div>' +
    '<div class="workspace-stage-title">' + esc(stage.title || stage.id || 'Stage') + '</div>' +
    '<div class="workspace-stage-business">' + esc(meta.business) + '</div>' +
    '<div class="workspace-contract"><span>' + esc(stage.agent || 'agent') + '</span><span>' + esc(stage.artifact || 'artifact') + '</span></div>' +
    '<div class="stage-stack-bar" aria-hidden="true">' +
      '<i class="pass" style="width:' + passWidth + '%"></i>' +
      '<i class="fail" style="width:' + failWidth + '%"></i>' +
      '<i class="running" style="width:' + activeWidth + '%"></i>' +
      '<i class="ready" style="width:' + readyWidth + '%"></i>' +
    '</div>' +
    '<div class="workspace-stage-metrics">' +
      '<span><b>' + esc(done) + '</b> pass</span>' +
      '<span><b>' + esc(fail) + '</b> fail</span>' +
      '<span><b>' + esc(active) + '</b> active</span>' +
      '<span><b>' + esc(ready) + '</b> ready</span>' +
    '</div>' +
    '<div class="run-dot-row">' + runs.slice(0, 22).map(runDotHtml).join('') + (runs.length > 22 ? '<span class="run-more">+' + esc(runs.length - 22) + '</span>' : '') + '</div>' +
    '<div class="workspace-stage-foot">' + chip(evidenceCount + ' checks') + chip(validationCount + ' validations') + chip(riskCount + ' risks') + '</div>' +
  '</button>';
}

function workflowInspectorHtml(stage, s) {
  if (!stage) return emptyHtml('No stage selected', 'Pick a stage to inspect its run-level tracking.');
  var meta = workflowStageMeta(stage);
  var runs = stage.runs || [];
  var riskCount = runs.reduce(function(total, run) { return total + (run.riskCount || 0); }, 0);
  var evidenceCount = runs.reduce(function(total, run) { return total + (run.evidenceCount || 0); }, 0);
  var validationCount = runs.filter(function(run) { return !!run.validationStatus; }).length;
  var runRows = runs.map(function(run) {
    return '<div class="inspector-run">' +
      '<div><div class="strong">' + esc(shortName(run.projectRoot)) + '</div><div class="mono faint">' + esc((run.runId || '').slice(-24)) + '</div></div>' +
      '<div class="inspector-run-meta">' +
        pill(run.status || 'ready') +
        chip((run.evidenceCount || 0) + ' checks') +
        chip((run.validationStatus || 'no validation')) +
        chip((run.riskCount || 0) + ' risks') +
      '</div>' +
      '<div class="mono muted">' + esc(run.taskId || stage.id || '') + '</div>' +
    '</div>';
  }).join('');

  return '<div class="inspector-card">' +
    '<div class="inspector-eyebrow">Selected stage</div>' +
    '<div class="inspector-title">' + esc(stage.title || stage.id || 'Stage') + '</div>' +
    '<div class="inspector-subtitle">' + esc(meta.business) + ' / ' + esc(meta.persona) + '</div>' +
    '<p>' + esc(meta.desc) + '</p>' +
    '<div class="inspector-io">' +
      '<div><span>Reads</span><b>' + esc(meta.reads) + '</b></div>' +
      '<div><span>Writes</span><b>' + esc(meta.writes) + '</b></div>' +
      '<div><span>Agent</span><b>' + esc(stage.agent || 'agent') + '</b></div>' +
      '<div><span>Artifact</span><b>' + esc(stage.artifact || 'artifact') + '</b></div>' +
    '</div>' +
    '<div class="inspector-stats">' +
      '<div><b>' + esc(runs.length) + '</b><span>runs</span></div>' +
      '<div><b>' + esc(evidenceCount) + '</b><span>checks</span></div>' +
      '<div><b>' + esc(validationCount) + '</b><span>validations</span></div>' +
      '<div><b>' + esc(riskCount) + '</b><span>risks</span></div>' +
    '</div>' +
    '<div class="inspector-section-title">Run tracking</div>' +
    '<div class="inspector-run-list">' + (runRows || emptyHtml('No run rows', 'This stage is defined but no run data has been loaded yet.')) + '</div>' +
  '</div>';
}

function workflowStageMeta(stage) {
  var fallback = {
    business: stage.title || 'Stage work',
    persona: stage.agent || 'RStack Agent',
    role: 'Owns this SDLC layer',
    desc: 'Tracks status, evidence, validations and risks for this stage from the run state.',
    reads: 'previous stage output',
    writes: stage.artifact || 'stage artifact'
  };
  var meta = WORKFLOW_STAGE_META[stage.id] || {};
  return {
    business: meta.business || fallback.business,
    persona: meta.persona || fallback.persona,
    role: meta.role || fallback.role,
    desc: meta.desc || fallback.desc,
    reads: meta.reads || fallback.reads,
    writes: meta.writes || fallback.writes
  };
}

function workflowStageStatus(stage) {
  if ((stage.fail || 0) > 0) return 'fail';
  if ((stage.active || 0) > 0) return 'running';
  if ((stage.pass || 0) > 0) return 'pass';
  return 'ready';
}

function runDotHtml(run) {
  var status = String(run.status || 'READY').toUpperCase();
  var cls = status === 'PASS' ? 'pass' : status === 'FAIL' ? 'fail' : status === 'IN_PROGRESS' ? 'running' : 'ready';
  return '<span class="run-dot ' + cls + '" title="' + esc(shortName(run.projectRoot) + ' / ' + (run.runId || '') + ' / ' + status) + '"></span>';
}

function openWorkflowStageButton(btn) {
  openWorkflowStage(btn.getAttribute('data-stageid'));
}

function openWorkflowStage(stageId) {
  WORKFLOW_SELECTED_STAGE_ID = stageId;
  if (STATE) renderWorkflow(STATE);
}

function renderProjects(s) {
  var projects = s.projectSummaries || [];
  var runs = s.runs || [];
  setText('projects-count', projects.length + ' roots');
  setText('runs-count', runs.length + ' runs');
  setHTML('projects-grid', projects.map(function(project) {
    var total = project.passed + project.failed;
    var rate = total ? Math.round(project.passed / total * 100) : 0;
    return '<div class="project-card">' +
      '<div><div class="strong">' + esc(project.name) + '</div><div class="project-path mono">' + esc(project.projectRoot) + '</div></div>' +
      '<div class="metric-row">' + pill('info', project.runs + ' runs') + pill('active', project.active + ' active') + pill('pass', project.passed + ' pass') + pill('fail', project.failed + ' fail') + '</div>' +
      '<div class="progress"><div class="progress-fill" style="width:' + rate + '%"></div></div>' +
      '<div class="muted mono">$' + Number(project.cost || 0).toFixed(4) + ' spend</div>' +
    '</div>';
  }).join('') || emptyHtml('No registered projects', 'Known project roots appear here.'));

  setHTML('runs-table', runs.map(function(run) {
    var tasks = run.tasks || [];
    var passed = tasks.filter(function(task) { return task.status === 'PASS'; }).length;
    var project = shortName(run.projectRoot);
    return '<tr class="clickable" data-runid="' + esc(run.runId) + '" onclick="openDrawerRow(this)">' +
      '<td>' + pill(run.derivedStatus || 'idle') + '</td>' +
      '<td><div class="strong">' + esc((run.manifest && run.manifest.goal) || run.runId) + '</div><div class="faint mono">' + esc(run.runId) + '</div></td>' +
      '<td class="mono muted">' + esc(project) + '</td>' +
      '<td><span class="strong">' + passed + '</span><span class="muted">/' + tasks.length + '</span></td>' +
      '<td class="mono muted">' + fmtDur((run.totals || {}).duration_ms) + '</td>' +
      '<td class="mono muted">$' + Number((run.totals || {}).cost_usd || (run.metrics || {}).cumulative_cost_usd || 0).toFixed(4) + '</td>' +
    '</tr>';
  }).join('') || '<tr><td colspan="6" class="empty">No runs yet</td></tr>');
}

function renderAgentWork(s) {
  var groups = s.agentGroups || groupAgentWork(s.agentWork || []);
  var workCount = (s.agentWork || []).length;
  setText('agent-work-count', workCount + ' actions');
  setHTML('agent-work-list', groups.map(function(group) {
    var agents = Object.keys(group.agents || {});
    return '<div class="agent-group">' +
      '<div class="agent-head"><div><div class="agent-title">' + esc(group.goal || group.runId) + '</div><div class="muted mono">' + esc(shortName(group.projectRoot)) + ' / ' + esc(group.runId) + '</div></div>' +
      '<div class="metric-row">' + pill('pass', group.passed + ' pass') + pill('fail', group.failed + ' fail') + pill('info', group.evidence + ' checks') + pill('warn', group.risks + ' risks') + '</div></div>' +
      '<div class="chips">' + agents.slice(0, 6).map(function(agent) { return chip(agent + ' x' + group.agents[agent]); }).join('') + '</div>' +
      '<div class="agent-items">' + (group.items || []).slice(0, 8).map(agentItemHtml).join('') + '</div>' +
    '</div>';
  }).join('') || emptyHtml('No agent contracts yet', 'builder.json and validation.json data appears here.'));
}

function renderLiveFeed(s) {
  var feed = s.feed || [];
  setText('live-feed-count', feed.length + ' events');
  setHTML('live-feed-list', feed.length ? feed.map(feedRowHtml).join('') : emptyHtml('No events yet', 'Live event data appears here.'));
}

function renderApprovals(s) {
  var approvals = s.approvals || [];
  var pending = approvals.filter(function(item) { return !item.status || item.status === 'pending'; });
  var resolved = approvals.filter(function(item) { return item.status && item.status !== 'pending'; });
  setText('approvals-count', pending.length + ' pending');
  setHTML('approvals-list', pending.map(function(item) { return approvalHtml(item, true); }).join('') || emptyHtml('No pending approvals', 'Only queue-backed approvals appear here.'));
  setHTML('approvals-resolved', resolved.slice(0, 20).map(function(item) { return approvalHtml(item, false); }).join('') || emptyHtml('No resolved approvals', 'Approved and rejected queue entries appear here.'));
}

function renderDecisions(s) {
  var state = s.decisions || { runs: [], totals: {} };
  var runs = state.runs || [];
  var decisions = [];
  runs.forEach(function(run) {
    (run.decisions || []).forEach(function(decision) {
      decisions.push({ run: run, decision: decision });
    });
  });
  var pending = decisions.filter(function(item) { return item.decision.status === 'pending'; });
  setText('decisions-count', pending.length + ' pending / ' + decisions.length + ' total');
  setText('readiness-count', runs.length + ' runs');
  setHTML('decisions-list', decisions.slice(0, 40).map(function(item) {
    var d = item.decision;
    return '<div class="approval-card ' + esc(d.status || 'pending') + '"><div class="agent-head"><div><div class="strong">' + esc(d.decision_id + ' — ' + d.question) + '</div><div class="muted">' + esc(d.recommendation ? 'Recommendation: ' + d.recommendation : 'No recommendation recorded') + '</div><div class="feed-meta"><span>' + esc(d.impact) + '</span><span>before ' + esc(d.required_before_stage) + '</span><span>' + esc((item.run.runId || '').slice(-16)) + '</span></div></div>' + pill(d.status || 'pending', d.status || 'pending') + '</div></div>';
  }).join('') || emptyHtml('No decisions recorded', 'Use sdlc_decisions or rstack-agents decisions to add Decision Queue items.'));
  setHTML('readiness-list', runs.map(function(run) {
    var r = run.readiness || {};
    return '<div class="alert-card ' + (r.status === 'FAIL' ? 'fail' : r.status === 'WARN' ? 'warn' : 'pass') + '"><div class="agent-head"><div><div class="strong">' + esc(run.goal || run.runId) + '</div><div class="muted">' + esc(r.message || 'Definition-of-Ready status') + '</div><div class="feed-meta"><span>' + esc(run.profile || '') + '</span><span>' + esc(r.mode || '') + '</span><span>score ' + esc(r.score || 0) + '</span></div></div>' + pill(r.status || 'PASS') + '</div></div>';
  }).join('') || emptyHtml('No readiness data', 'Run sdlc_dor_check or rstack-agents dor after starting an RStack run.'));
}

function renderReleaseReadiness(s) {
  var tasks = allTasks(s);
  var counts = taskStatusCounts(tasks);
  var blocked = (s.blockedGates || []).length;
  var alerts = (s.alerts || []).length;
  var pending = (s.pendingApprovals || []).length;
  var missingValidation = (s.diagnostics && s.diagnostics.missingValidationCount) || 0;
  var passEvidence = (s.diagnostics && s.diagnostics.evidenceCount) || 0;
  var checks = [
    { name: 'Tests passing', ok: counts.FAIL === 0, detail: counts.PASS + ' passed / ' + counts.FAIL + ' failed' },
    { name: 'Approval gates resolved', ok: blocked === 0 && pending === 0, detail: blocked + ' blocked gates, ' + pending + ' pending approvals' },
    { name: 'Validation evidence attached', ok: missingValidation === 0, detail: passEvidence + ' evidence records, ' + missingValidation + ' missing validations' },
    { name: 'Operational alerts clear', ok: alerts === 0, detail: alerts + ' active alerts' }
  ];
  var blockedCount = checks.filter(function(c) { return !c.ok; }).length;
  var verdict = blockedCount ? 'BLOCKED — ' + blockedCount + ' release condition' + (blockedCount === 1 ? '' : 's') + ' need work' : 'READY TO SHIP';
  setText('release-readiness-verdict', verdict);
  setText('release-readiness-chip', blockedCount ? 'Blocked' : 'Ready');
  setClass('release-readiness-chip', 'command-status ' + (blockedCount ? 'warn' : 'ok'));
  setText('release-readiness-count', checks.filter(function(c) { return c.ok; }).length + '/' + checks.length + ' passed');
  setHTML('release-readiness-checklist', checks.map(function(check) {
    return '<div class="command-row"><div><div class="strong">' + esc(check.name) + '</div><div class="muted">' + esc(check.detail) + '</div></div>' + pill(check.ok ? 'pass' : 'warn', check.ok ? 'PASS' : 'BLOCK') + '</div>';
  }).join(''));
  setHTML('release-readiness-blockers', checks.filter(function(c) { return !c.ok; }).map(function(check) {
    return '<div class="attention-item warn"><div class="attention-value">!</div><div><div class="attention-title">' + esc(check.name) + '</div><div class="attention-detail">' + esc(check.detail) + '</div></div><span class="pill warn">ACTION</span></div>';
  }).join('') || emptyHtml('No release blockers', 'This scoped data is ready by the conservative dashboard checks.'));
}

function renderSecurity(s) {
  var runs = s.runs || [];
  var securityRuns = runs.filter(function(run) { return (run.stageReports || []).indexOf('12-security-threat-model') !== -1; });
  var alertRisks = (s.alerts || []).filter(function(alert) { return /security|threat|risk|gate/i.test(String(alert.title || alert.type || alert.detail || '')); });
  var high = alertRisks.length;
  var medium = Math.max(0, ((s.blockedGates || []).length));
  var low = securityRuns.length;
  setText('security-threat-count', (high + medium + low) + ' signals');
  setHTML('security-threat-heatmap', '<div class="heatmap"><div class="heat high"><b>' + high + '</b><span>high security/risk alerts</span></div><div class="heat med"><b>' + medium + '</b><span>blocked gates to review</span></div><div class="heat low"><b>' + low + '</b><span>runs with security stage</span></div></div>');
  setHTML('security-release-gate', high || medium ? '<div class="alert-card warn"><div class="strong">Security release gate needs review</div><div class="muted">Resolve open security/risk alerts and blocked gates before shipment.</div></div>' : '<div class="alert-card pass"><div class="strong">No security blocker detected</div><div class="muted">Threat model artifacts are present where the run produced them.</div></div>');
  var rows = (alertRisks.length ? alertRisks : securityRuns.slice(0, 20).map(function(run) { return { level: 'info', title: 'Security threat model produced', detail: 'Stage 12 artifact present', runId: run.runId }; })).slice(0, 30);
  setHTML('security-threat-registry', rows.map(function(item) {
    return '<tr><td>' + pill(item.level || 'info', item.level || 'info') + '</td><td><div class="strong">' + esc(item.title || item.type || 'Security signal') + '</div><div class="muted">' + esc(item.detail || '') + '</div></td><td class="mono muted">' + esc((item.runId || '').slice(-24)) + '</td><td>Review / mitigate</td></tr>';
  }).join('') || '<tr><td colspan="4" class="empty">No security stage artifacts or security alerts in scope.</td></tr>');
}

function renderCompliance(s) {
  var runs = s.runs || [];
  var complianceRuns = runs.filter(function(run) { return (run.stageReports || []).indexOf('13-compliance-checker') !== -1; });
  var evidence = (s.diagnostics && s.diagnostics.evidenceCount) || 0;
  var tasks = (s.diagnostics && s.diagnostics.taskCount) || allTasks(s).length;
  var coverage = tasks ? Math.min(100, Math.round((evidence / tasks) * 100)) : 0;
  setText('compliance-score-count', complianceRuns.length + ' compliance runs');
  setHTML('compliance-scorecards', [
    { name: 'Audit evidence coverage', value: coverage + '%', detail: evidence + ' evidence records / ' + tasks + ' tasks' },
    { name: 'Compliance stage coverage', value: complianceRuns.length, detail: 'runs with 13-compliance-checker output' },
    { name: 'Validation gaps', value: (s.diagnostics && s.diagnostics.missingValidationCount) || 0, detail: 'missing validation contracts' }
  ].map(function(card) { return '<div class="command-row"><div><div class="strong">' + esc(card.name) + '</div><div class="muted">' + esc(card.detail) + '</div></div><div class="side-v mini">' + esc(card.value) + '</div></div>'; }).join(''));
  setHTML('compliance-controls', complianceRuns.length ? '<div class="stack-list">' + complianceRuns.slice(0, 12).map(function(run) { return '<div class="command-row"><div><div class="strong">Compliance report available</div><div class="muted mono">' + esc(run.runId) + '</div></div>' + pill('pass', 'report') + '</div>'; }).join('') + '</div>' : emptyHtml('Compliance stage not run in this scope', 'Run stage 13 or select a run that produced compliance_report.json.'));
}

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

function renderAlertsGuardrails(s) {
  var alerts = s.alerts || [];
  var blocked = s.blockedGates || [];
  setText('alerts-count', alerts.length + ' alerts');
  setText('blocked-count', blocked.length + ' blocked gates');
  setHTML('alerts-list', alerts.map(alertHtml).join('') || emptyHtml('All clear', 'No thresholds are currently breached.'));
  setHTML('blocked-list', blocked.map(function(gate) {
    return '<div class="alert-card warn"><div class="strong">' + esc(gate.title) + '</div><div class="muted">' + esc(gate.detail) + '</div><div class="feed-meta"><span>' + esc(gate.runId || '') + '</span><span>' + esc(fmtTime(gate.ts)) + '</span></div></div>';
  }).join('') || emptyHtml('No blocked gates', 'Blocked approval gate history appears here.'));
}

function renderTraceability(s) {
  var traces = s.traceMap || [];
  setHTML('traceability-list', traces.map(function(trace) {
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
  }).join('') || emptyHtml('No traceability data', 'Requirements and evidence appear after stage artifacts are written.'));
}

function renderTeamLayers(s) {
  var layers = s.layers || [];
  var frameworks = s.frameworks || {};
  setHTML('layers-grid', layers.map(function(layer) {
    return '<div class="layer-card"><div class="agent-head"><div><div class="strong">' + esc(layer.name) + '</div><div class="muted">' + esc(layer.detail) + '</div></div>' + pill(layer.health, layer.health) + '</div><div class="kpi-v" style="font-size:22px">' + esc(layer.count) + '</div></div>';
  }).join('') || emptyHtml('No layer data', 'Layer health appears here.'));
  setHTML('framework-table', Object.keys(frameworks).map(function(name) {
    var item = frameworks[name];
    return '<tr><td class="strong">' + esc(name) + '</td><td>' + item.runs + '</td><td style="color:var(--green);font-weight:800">' + item.pass + '</td><td style="color:var(--red);font-weight:800">' + item.fail + '</td><td class="mono muted">$' + Number(item.cost || 0).toFixed(4) + '</td></tr>';
  }).join('') || '<tr><td colspan="5" class="empty">No framework data</td></tr>');
}

function renderDiagnostics(s) {
  var d = s.diagnostics || {};
  var rows = [
    ['Runs', d.runCount || 0],
    ['Tasks', d.taskCount || 0],
    ['Events', d.eventCount || 0],
    ['Evidence records', d.evidenceCount || 0],
    ['Missing builder contracts', d.missingBuilderCount || 0],
    ['Missing validation contracts', d.missingValidationCount || 0]
  ];
  setHTML('diagnostics-health', rows.map(function(row) {
    return '<div class="feed-row"><div class="feed-icon info">i</div><div><div class="feed-summary">' + esc(row[0]) + '</div></div><div class="feed-ts">' + esc(row[1]) + '</div></div>';
  }).join(''));
  setHTML('diagnostics-roots', (d.sourceRoots || s.sourceRoots || []).map(function(root) {
    return '<div class="project-card"><div class="strong">' + esc(shortName(root)) + '</div><div class="project-path mono">' + esc(root) + '</div></div>';
  }).join('') || emptyHtml('No source roots', ''));
}

function workloadHtml(s) {
  var runs = s.runs || [];
  var active = runs.filter(function(run) { return run.derivedStatus === 'active'; }).length;
  var stalled = runs.filter(function(run) { return run.derivedStatus === 'stalled'; }).length;
  var ended = runs.filter(function(run) { return run.derivedStatus === 'ended' || run.derivedStatus === 'done'; }).length;
  return '<div class="metric-row">' + pill('active', active + ' active') + pill('warn', stalled + ' stalled') + pill('pass', ended + ' ended') + '</div>' +
    '<div style="margin-top:12px">' + (s.projectSummaries || []).slice(0, 5).map(function(project) {
      return '<div class="feed-row"><div class="feed-icon info">' + esc(String(project.runs || 0)) + '</div><div><div class="feed-summary">' + esc(project.name) + '</div><div class="feed-meta"><span>' + project.tasks + ' tasks</span><span>$' + Number(project.cost || 0).toFixed(4) + '</span></div></div></div>';
    }).join('') + '</div>';
}

function healthHtml(s) {
  var blocked = (s.blockedGates || []).length;
  var alerts = (s.alerts || []).length;
  var missing = (s.diagnostics && s.diagnostics.missingValidationCount) || 0;
  return '<div class="metric-row">' + pill(alerts ? 'warn' : 'pass', alerts + ' alerts') + pill(blocked ? 'warn' : 'pass', blocked + ' blocked') + pill(missing ? 'warn' : 'pass', missing + ' missing validation') + '</div>';
}

function agentItemHtml(work) {
  var total = work.totalChecks || 0;
  var rate = total ? Math.round((work.passChecks || 0) / total * 100) : 0;
  return '<div class="agent-item"><div class="agent-head"><div><div class="strong">' + esc(work.title || work.taskId) + '</div><div class="muted mono">' + esc(work.stageId || work.taskId || '') + ' / ' + esc(work.agent || '') + '</div></div>' + pill(work.status || 'ready') + '</div>' +
    '<div class="agent-summary">' + esc(work.summary || work.workDone || 'No builder summary yet.') + '</div>' +
    (total ? '<div class="progress" style="margin-top:8px"><div class="progress-fill" style="width:' + rate + '%"></div></div>' : '') +
    '<div class="chips">' + chip((work.passChecks || 0) + '/' + total + ' checks') + chip((work.riskCount || 0) + ' risks') + (work.filesModified || []).slice(0, 2).map(chip).join('') + '</div></div>';
}

function approvalHtml(item, canAct) {
  var status = item.status || 'pending';
  return '<div class="approval-card ' + esc(status) + '"><div class="agent-head"><div><div class="strong">' + esc(item.title || item.type || 'Approval required') + '</div><div class="muted">' + esc(item.detail || item.reason || '') + '</div><div class="feed-meta"><span>' + esc(shortName(item.projectRoot)) + '</span><span>' + esc((item.runId || '').slice(-16)) + '</span><span>' + esc(fmtTime(item.ts)) + '</span></div></div>' + pill(status, status) + '</div>' +
    (canAct ? '<div class="approval-actions"><button class="btn primary" data-id="' + esc(item.id) + '" onclick="approveFromButton(this)">Approve</button><button class="btn danger" data-id="' + esc(item.id) + '" onclick="rejectFromButton(this)">Reject</button></div>' : '') +
    '</div>';
}

function alertHtml(alert) {
  return '<div class="alert-card ' + esc(alert.level || 'info') + '"><div class="agent-head"><div><div class="strong">' + esc(alert.title || alert.type || 'Alert') + '</div><div class="muted">' + esc(alert.detail || '') + '</div><div class="feed-meta"><span>' + esc(alert.type || '') + '</span><span>' + esc(alert.runId || '') + '</span></div></div>' + pill(alert.level || 'info') + '</div></div>';
}

function feedRowHtml(item) {
  var level = item.level || 'info';
  var icon = level === 'pass' ? 'OK' : level === 'fail' ? 'NO' : level === 'blocked' ? 'BL' : level === 'warn' ? '!' : 'i';
  return '<div class="feed-row"><div class="feed-icon ' + esc(level) + '">' + icon + '</div><div><div class="feed-summary">' + esc(item.summary || '') + '</div><div class="feed-meta">' + (item.runId ? '<span>' + esc(item.runId.slice(-14)) + '</span>' : '') + (item.projectRoot ? '<span>' + esc(shortName(item.projectRoot)) + '</span>' : '') + (item.type ? '<span>' + esc(item.type) + '</span>' : '') + '</div></div><div class="feed-ts">' + esc(fmtTime(item.ts)) + '</div></div>';
}

function groupAgentWork(work) {
  var groups = {};
  (work || []).forEach(function(item) {
    var key = (item.projectRoot || 'unknown') + '::' + item.runId;
    if (!groups[key]) groups[key] = { projectRoot: item.projectRoot, runId: item.runId, goal: item.goal, total: 0, passed: 0, failed: 0, evidence: 0, risks: 0, agents: {}, items: [] };
    var group = groups[key];
    group.total += 1;
    if (item.status === 'PASS') group.passed += 1;
    if (item.status === 'FAIL') group.failed += 1;
    group.evidence += item.evidenceCount || 0;
    group.risks += item.riskCount || 0;
    group.agents[item.agent || 'agent'] = (group.agents[item.agent || 'agent'] || 0) + 1;
    group.items.push(item);
  });
  return Object.keys(groups).map(function(key) { return groups[key]; });
}

// ── Studio: Jarvis-style live agent workspace (issue #44) ───────────────────
// Personas translate stage ids into people a manager recognizes — straight
// from the workspace-v8 concept: agents introduce themselves.
var STAGE_PERSONAS = {
  '00-environment': ['DevOps Engineer', 'Prepare the Workshop'],
  '01-transcript': ['Business Analyst', 'Listen to the Customer'],
  '02-requirements': ['Product Manager', 'Define What to Build'],
  '03-documentation': ['Technical Writer', 'Write It Down'],
  '04-planning': ['Delivery Manager', 'Plan the Work'],
  '05-jira': ['Scrum Master', 'Create the Tickets'],
  '06-architecture': ['Solution Architect', 'Design the System'],
  '07-code': ['Senior Developer', 'Build the Software'],
  '08-testing': ['QA Engineer', 'Prove It Works'],
  '09-deployment': ['Release Engineer', 'Ship It'],
  '10-summary': ['Program Manager', 'Report the Outcome'],
  '11-feedback-loop': ['Quality Coach', 'Close the Loop'],
  '12-security-threat-model': ['Security Engineer', 'Find the Threats'],
  '13-compliance-checker': ['Compliance Officer', 'Check the Rules'],
  '14-cost-estimation': ['FinOps Analyst', 'Count the Cost'],
};
var STUDIO_STAGE_ORDER = Object.keys(STAGE_PERSONAS);
var STUDIO_NARRATION = { text: '', shown: 0, timer: null };
var STUDIO_SELECTED_STAGE = null;

function studioRun(s) {
  var runs = s.runs || [];
  if (!runs.length) return null;
  var active = runs.filter(function(run) { return run.derivedStatus === 'active'; });
  return active[0] || runs[0];
}

function studioStageModel(run) {
  // stage → { status, task, voice } from the run's tasks + stage timings.
  var model = {};
  STUDIO_STAGE_ORDER.forEach(function(stageId) { model[stageId] = { status: 'queued', task: null, voice: '' }; });
  (run.tasks || []).forEach(function(task) {
    var stageIds = (task.stage_artifacts || []).map(function(artifact) { return artifact.stage_id; });
    if (!stageIds.length && task.stageId) stageIds = [task.stageId];
    stageIds.forEach(function(stageId) {
      if (!model[stageId]) return;
      var entry = model[stageId];
      var status = String(task.status || '').toUpperCase();
      var mapped = status === 'PASS' ? 'done' : status === 'IN_PROGRESS' ? 'running' : status === 'FAIL' ? 'fail' : 'queued';
      // Strongest signal wins: running > fail > done > queued.
      var rank = { running: 3, fail: 2, done: 1, queued: 0 };
      if (rank[mapped] >= rank[entry.status]) {
        entry.status = mapped;
        entry.task = task;
        entry.voice = (task.builder && (task.builder.work_done || task.builder.summary)) ||
          (mapped === 'queued' ? 'Waiting for the conveyor…' : '') || '';
      }
    });
  });
  // Stage elapsed from derived metrics marks completion even without tasks.
  Object.keys(run.stageElapsed || {}).forEach(function(stageId) {
    if (model[stageId] && model[stageId].status === 'queued') model[stageId].status = 'done';
  });
  return model;
}

function renderStudio(s) {
  var run = studioRun(s);
  var grid = document.getElementById('studio-grid');
  if (!grid) return;
  if (!run) {
    setHTML('studio-grid', emptyHtml('The studio is empty', 'Start a run and the agents take their desks.'));
    setText('studio-narration', 'No runs yet. The studio opens with the first sdlc_start.');
    return;
  }
  var totals = run.totals || {};
  var isActive = run.derivedStatus === 'active';
  setText('studio-run-label', (run.startedBy ? run.startedBy + ' · ' : '') + run.runId.slice(0, 40));
  var visor = document.getElementById('studio-visor');
  if (visor) visor.className = 'studio-visor' + (isActive ? ' live' : '');
  setHTML('studio-hud',
    '<div><span>' + fmtDur(totals.duration_ms) + '</span><label>elapsed</label></div>' +
    '<div><span>' + (totals.tasks_passed || 0) + '</span><label>passed</label></div>' +
    '<div><span>' + (totals.tool_calls || 0) + '</span><label>tool calls</label></div>' +
    '<div><span>' + (totals.quality_avg !== null && totals.quality_avg !== undefined ? Math.round(totals.quality_avg * 100) + '%' : '—') + '</span><label>quality</label></div>');

  // The Manager narrates the newest event for this run.
  var latest = (s.feed || []).filter(function(item) { return item.runId === run.runId; })[0];
  var narration = latest
    ? latest.summary + (isActive ? ' — the studio is live.' : '')
    : 'Studio idle. Last run: ' + ((run.manifest && run.manifest.goal) || run.runId).slice(0, 80);
  typeNarration(narration);

  var model = studioStageModel(run);
  setHTML('studio-grid', STUDIO_STAGE_ORDER.map(function(stageId) {
    var persona = STAGE_PERSONAS[stageId];
    var entry = model[stageId];
    var voice = entry.voice ? '“' + entry.voice.slice(0, 110) + (entry.voice.length > 110 ? '…' : '') + '”' : '';
    var badge = entry.status === 'running' ? '● WORKING NOW' : entry.status === 'done' ? '✓ COMPLETE' : entry.status === 'fail' ? '✗ NEEDS REVIEW' : '○ QUEUED';
    return '<div class="workstation ' + entry.status + (stageId === STUDIO_SELECTED_STAGE ? ' selected' : '') + '" data-stage="' + esc(stageId) + '" onclick="openStudioStage(this)">' +
      '<div class="ws-head"><span class="ws-id mono">' + esc(stageId.slice(0, 2)) + '</span><span class="ws-status-dot"></span></div>' +
      '<div class="ws-business">' + esc(persona[1]) + '</div>' +
      '<div class="ws-persona mono">' + esc(persona[0]) + '</div>' +
      '<div class="ws-badge mono">' + badge + '</div>' +
      (voice ? '<div class="ws-voice">' + esc(voice) + '</div>' : '') +
    '</div>';
  }).join(''));
  if (STUDIO_SELECTED_STAGE) renderStudioInspector(run, model, STUDIO_SELECTED_STAGE);
}

function typeNarration(text) {
  if (text === STUDIO_NARRATION.text) return;
  STUDIO_NARRATION.text = text;
  STUDIO_NARRATION.shown = 0;
  clearInterval(STUDIO_NARRATION.timer);
  STUDIO_NARRATION.timer = setInterval(function() {
    STUDIO_NARRATION.shown += 3;
    var el = document.getElementById('studio-narration');
    if (!el) { clearInterval(STUDIO_NARRATION.timer); return; }
    el.textContent = STUDIO_NARRATION.text.slice(0, STUDIO_NARRATION.shown) + (STUDIO_NARRATION.shown < STUDIO_NARRATION.text.length ? '▌' : '');
    if (STUDIO_NARRATION.shown >= STUDIO_NARRATION.text.length) clearInterval(STUDIO_NARRATION.timer);
  }, 30);
}

function openStudioStage(el) {
  STUDIO_SELECTED_STAGE = el.getAttribute('data-stage');
  if (STATE) applyState(STATE);
}

function renderStudioInspector(run, model, stageId) {
  var panel = document.getElementById('studio-inspector');
  if (!panel) return;
  var persona = STAGE_PERSONAS[stageId] || ['Agent', stageId];
  var entry = model[stageId] || { status: 'queued', task: null };
  var task = entry.task;
  panel.style.display = 'block';
  var checks = task && task.validation
    ? '<div class="metric-row">' + pill('pass', task.validation.pass_checks + '/' + task.validation.total_checks + ' checks') +
      (task.validation.failed_checks || []).slice(0, 3).map(function(name) { return pill('fail', name); }).join('') + '</div>'
    : '';
  panel.innerHTML =
    '<div class="panel-head"><span class="panel-title">' + esc(persona[0]) + ' — ' + esc(persona[1]) + '</span>' +
    '<button class="drawer-close" onclick="closeStudioInspector()">x</button></div>' +
    '<div class="panel-body">' +
      (task
        ? '<div class="strong">' + esc(task.title || task.id) + '</div>' +
          '<div class="muted">' + esc(task.description || '') + '</div>' +
          (task.builder && task.builder.work_done ? '<div class="ws-voice">“' + esc(task.builder.work_done) + '”</div>' : '') +
          checks +
          '<div class="chips">' + (task.specialists || []).map(function(name) { return chip(name); }).join('') + '</div>' +
          '<button class="tb-chip" data-runid="' + esc(run.runId) + '" onclick="openDrawerRow(this)">Open full run</button>'
        : '<div class="muted">No task routed to this stage yet — ' + esc(persona[0]) + ' is ' + (entry.status === 'done' ? 'finished.' : 'waiting at their desk.') + '</div>') +
    '</div>';
}

function closeStudioInspector() {
  STUDIO_SELECTED_STAGE = null;
  var panel = document.getElementById('studio-inspector');
  if (panel) panel.style.display = 'none';
}

// ── Stage report infographics (issue #60) — shared by Run Report + Studio 3D ─
var REPORT_CACHE = {};            // runId → { stages, deliverables }
var REPORT_RUN_ID = null;

var STAGE_CARD_META = {
  '00-environment': { icon: '🧰', title: 'Environment', persona: 'DevOps' },
  '01-transcript': { icon: '🎙', title: 'Transcript', persona: 'Business Analyst' },
  '02-requirements': { icon: '📋', title: 'Requirements', persona: 'Product Manager' },
  '03-documentation': { icon: '📝', title: 'Documentation', persona: 'Technical Writer' },
  '04-planning': { icon: '🗺', title: 'Planning', persona: 'Delivery Manager' },
  '05-jira': { icon: '🎫', title: 'Tickets', persona: 'Scrum Master' },
  '06-architecture': { icon: '🏛', title: 'Architecture', persona: 'Solution Architect' },
  '07-code': { icon: '⚙️', title: 'Code', persona: 'Senior Developer' },
  '08-testing': { icon: '🧪', title: 'Testing', persona: 'QA Engineer' },
  '09-deployment': { icon: '🚀', title: 'Deployment', persona: 'Release Engineer' },
  '10-summary': { icon: '📊', title: 'Summary', persona: 'Program Manager' },
  '11-feedback-loop': { icon: '🔄', title: 'Feedback Loop', persona: 'Quality Coach' },
  '12-security-threat-model': { icon: '🛡', title: 'Security', persona: 'Security Engineer' },
  '13-compliance-checker': { icon: '⚖️', title: 'Compliance', persona: 'Compliance Officer' },
  '14-cost-estimation': { icon: '💰', title: 'Cost', persona: 'FinOps Analyst' },
};
var STAGE_CARD_ORDER = Object.keys(STAGE_CARD_META);

function fetchRunReport(runId) {
  if (REPORT_CACHE[runId]) return Promise.resolve(REPORT_CACHE[runId]);
  return fetch('/api/run-report?run=' + encodeURIComponent(runId))
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
      return '<div class="kv"><span>Status</span><b>' + esc(d.status || '-') + '</b></div>' + miniList('Blockers', d.blockers || d.release_constraints);
    case '10-summary':
      return statChips([
        { n: (d.open_risks || []).length, l: 'open risks' },
        { n: (d.not_built_or_not_done || []).length, l: 'not done' },
        { n: (d.next_steps || []).length, l: 'next steps' },
      ]) + gateBadge(d.release_gate) + miniList('Open risks', d.open_risks, function(r) { return (r.severity ? '[' + r.severity + '] ' : '') + (r.summary || r.id || ''); });
    case '11-feedback-loop':
      return '<div class="gauge-wrap">' + svgGauge(d.consistency_score, scoreColor(d.consistency_score)) + '<span class="gauge-lab">consistency</span></div>' +
        miniList('Findings', d.traceability_findings, function(f) { return (f.requirement || '') + ' — ' + (f.status || ''); });
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
        { n: (d.open_questions || []).length, l: 'open questions' },
      ]) + miniList('Goals', d.goals);
    case '03-documentation':
      return statChips([{ n: (d.documents_written || []).length, l: 'docs written' }, { n: (d.known_limitations_documented || []).length, l: 'limitations' }]) +
        miniList('Documents', d.documents_written);
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

var ANALYTICS_RUN_ID = null;

function renderRunAnalytics(s) {
  var runs = s.runs || [];
  var select = document.getElementById('analytics-run-select');
  if (select) {
    if (!ANALYTICS_RUN_ID || !runs.some(function(run) { return run.runId === ANALYTICS_RUN_ID; })) {
      ANALYTICS_RUN_ID = runs.length ? runs[0].runId : null;
    }
    select.innerHTML = runs.map(function(run) {
      var label = ((run.manifest && run.manifest.goal) || run.runId).slice(0, 70);
      return '<option value="' + esc(run.runId) + '"' + (run.runId === ANALYTICS_RUN_ID ? ' selected' : '') + '>' + esc(label) + '</option>';
    }).join('');
  }
  renderAnalyticsRun(ANALYTICS_RUN_ID);
  renderStageBars(s);
  renderTrendTable(s);
}

function renderAnalyticsRun(runId) {
  ANALYTICS_RUN_ID = runId;
  var run = ((STATE && STATE.runs) || []).filter(function(item) { return item.runId === runId; })[0];
  if (!run) {
    setHTML('analytics-kpis', '');
    setHTML('analytics-gantt', emptyHtml('No runs yet', 'Run timelines appear once a run records task events.'));
    return;
  }
  var totals = run.totals || {};
  setHTML('analytics-kpis',
    '<div class="kpi blue"><div class="kpi-v">' + fmtDur(totals.duration_ms) + '</div><div class="kpi-l">Run Duration</div></div>' +
    '<div class="kpi blue"><div class="kpi-v">' + (totals.tool_calls || 0) + '</div><div class="kpi-l">Tool Calls</div></div>' +
    '<div class="kpi green"><div class="kpi-v">' + (totals.tasks_passed || 0) + '</div><div class="kpi-l">Passed</div></div>' +
    '<div class="kpi red"><div class="kpi-v">' + (totals.tasks_failed || 0) + '</div><div class="kpi-l">Failed</div></div>' +
    '<div class="kpi amber"><div class="kpi-v">' + (totals.quality_avg !== null && totals.quality_avg !== undefined ? Math.round(totals.quality_avg * 100) + '%' : '-') + '</div><div class="kpi-l">Avg Quality</div></div>' +
    '<div class="kpi amber"><div class="kpi-v">$' + Number(totals.cost_usd || 0).toFixed(4) + '</div><div class="kpi-l">Cost</div></div>');
  setHTML('analytics-gantt', ganttHtml(run.timeline || []));
}

function ganttHtml(segments) {
  var timed = segments.filter(function(seg) { return seg.started_at; });
  if (!timed.length) return emptyHtml('No timeline segments', 'task_started / task_validated events build this view.');
  var start = Math.min.apply(null, timed.map(function(seg) { return Date.parse(seg.started_at); }));
  var end = Math.max.apply(null, timed.map(function(seg) {
    return seg.ended_at ? Date.parse(seg.ended_at) : Date.parse(seg.started_at);
  }));
  var span = Math.max(1, end - start);
  return timed.map(function(seg) {
    var s0 = Date.parse(seg.started_at);
    var s1 = seg.ended_at ? Date.parse(seg.ended_at) : end;
    var left = ((s0 - start) / span) * 100;
    var width = Math.max(0.8, ((s1 - s0) / span) * 100);
    var cls = seg.status === 'PASS' ? 'pass' : seg.status === 'FAIL' ? 'fail' : 'running';
    var label = seg.task_id + (seg.attempt > 1 ? ' (attempt ' + seg.attempt + ')' : '');
    var stages = (seg.stage_ids || []).join(', ');
    return '<div class="gantt-row">' +
      '<div class="gantt-label" title="' + esc(stages) + '">' + esc(label) + '</div>' +
      '<div class="gantt-track">' +
        '<div class="gantt-bar ' + cls + '" style="left:' + left.toFixed(2) + '%;width:' + width.toFixed(2) + '%" title="' + esc(label + ' — ' + fmtDur(seg.elapsed_ms) + (stages ? ' — ' + stages : '')) + '"></div>' +
      '</div>' +
      '<div class="gantt-dur mono">' + (seg.ended_at ? fmtDur(seg.elapsed_ms) : 'running') + '</div>' +
    '</div>';
  }).join('');
}

function renderStageBars(s) {
  var stages = (s.trends && s.trends.stages) || {};
  var ids = Object.keys(stages).sort();
  setText('analytics-stage-count', ids.length + ' stages');
  if (!ids.length) {
    setHTML('analytics-stage-bars', emptyHtml('No stage durations yet', 'stage_completed events populate this view.'));
    return;
  }
  var max = Math.max.apply(null, ids.map(function(id) { return stages[id].avg_elapsed_ms || 0; })) || 1;
  setHTML('analytics-stage-bars', ids.map(function(id) {
    var stage = stages[id];
    var width = Math.max(2, ((stage.avg_elapsed_ms || 0) / max) * 100);
    return '<div class="stage-bar-row">' +
      '<div class="stage-bar-label mono">' + esc(id) + '</div>' +
      '<div class="stage-bar-track"><div class="stage-bar-fill" style="width:' + width.toFixed(1) + '%"></div></div>' +
      '<div class="stage-bar-value mono">' + fmtDur(stage.avg_elapsed_ms) + ' <span class="faint">x' + stage.runs + '</span></div>' +
    '</div>';
  }).join(''));
}

function renderTrendTable(s) {
  var rows = (s.trends && s.trends.runs) || [];
  setText('analytics-trend-count', rows.length + ' runs');
  setHTML('analytics-trend-table', rows.map(function(row) {
    return '<tr class="clickable" data-runid="' + esc(row.runId) + '" onclick="openDrawerRow(this)">' +
      '<td><div class="strong">' + esc((row.goal || row.runId).slice(0, 60)) + '</div><div class="faint mono">' + esc(String(row.created_at || '').slice(0, 16)) + '</div></td>' +
      '<td class="mono">' + fmtDur(row.duration_ms) + '</td>' +
      '<td class="mono">' + (row.tool_calls || 0) + '</td>' +
      '<td><span class="strong">' + (row.tasks_passed || 0) + '</span><span class="muted">/' + ((row.tasks_passed || 0) + (row.tasks_failed || 0)) + '</span></td>' +
      '<td class="mono">' + (row.quality_avg !== null && row.quality_avg !== undefined ? Math.round(row.quality_avg * 100) + '%' : '-') + '</td>' +
      '<td class="mono muted">$' + Number(row.cost_usd || 0).toFixed(4) + '</td>' +
    '</tr>';
  }).join('') || '<tr><td colspan="6" class="empty">No runs yet</td></tr>');
}

function fmtDur(ms) {
  ms = Number(ms) || 0;
  if (ms < 1000) return ms + 'ms';
  var sec = Math.round(ms / 1000);
  if (sec < 60) return sec + 's';
  var min = Math.floor(sec / 60);
  if (min < 60) return min + 'm ' + (sec % 60) + 's';
  return Math.floor(min / 60) + 'h ' + (min % 60) + 'm';
}

function openDrawerRow(row) {
  openDrawer(row.getAttribute('data-runid'));
}

function openDrawer(runId) {
  var run = (STATE && STATE.runs || []).filter(function(item) { return item.runId === runId; })[0];
  if (!run) return;
  var tasks = run.tasks || [];
  var timeline = run.activityTimeline || [];
  var passed = tasks.filter(function(task) { return task.status === 'PASS'; }).length;
  var failed = tasks.filter(function(task) { return task.status === 'FAIL'; }).length;
  var totals = run.totals || {};
  var calls = totals.tool_calls || timeline.reduce(function(total, item) { return total + (item.toolCalls || 0); }, 0);
  var cost = totals.cost_usd || (run.metrics || {}).cumulative_cost_usd || 0;
  setText('drawer-title', (run.manifest && run.manifest.goal) || run.runId);
  setText('drawer-sub', shortName(run.projectRoot) + ' / ' + run.runId);
  setHTML('drawer-body',
    '<div class="kpi-grid">' +
      '<div class="kpi blue"><div class="kpi-v">' + fmtDur(totals.duration_ms) + '</div><div class="kpi-l">Duration</div></div>' +
      '<div class="kpi blue"><div class="kpi-v">' + calls + '</div><div class="kpi-l">Tool Calls</div></div>' +
      '<div class="kpi green"><div class="kpi-v">' + passed + '</div><div class="kpi-l">Passed</div></div>' +
      '<div class="kpi red"><div class="kpi-v">' + failed + '</div><div class="kpi-l">Failed</div></div>' +
      '<div class="kpi amber"><div class="kpi-v">' + (totals.quality_avg !== null && totals.quality_avg !== undefined ? Math.round(totals.quality_avg * 100) + '%' : '-') + '</div><div class="kpi-l">Quality</div></div>' +
      '<div class="kpi amber"><div class="kpi-v">$' + Number(cost).toFixed(4) + '</div><div class="kpi-l">Cost</div></div>' +
    '</div>' +
    '<div class="panel"><div class="panel-head"><span class="panel-title">Deliverables</span><span class="panel-note">' + (run.artifactIndex || []).length + ' artifacts</span></div><div class="panel-body">' +
      artifactListHtml(run) +
    '</div></div>' +
    '<div class="panel"><div class="panel-head"><span class="panel-title">Evidence</span><span class="panel-note">' + (run.evidenceCount || 0) + ' records</span></div><div class="panel-body">' +
      evidenceListHtml(run) +
    '</div></div>' +
    '<div class="panel"><div class="panel-head"><span class="panel-title">Task Timeline</span></div><div class="panel-body"><div class="gantt">' +
      ganttHtml(run.timeline || []) +
    '</div></div></div>' +
    '<div class="panel"><div class="panel-head"><span class="panel-title">Activity by Minute</span></div><div class="panel-body">' +
      (timeline.map(function(item) {
        return '<div class="feed-row"><div class="feed-icon info">' + (item.toolCalls || 0) + '</div><div><div class="feed-summary">' + esc(item.minute || '') + '</div><div class="feed-meta"><span>' + (item.stagesDone || []).length + ' stages</span><span>' + (item.guardrails || 0) + ' guardrails</span></div></div></div>';
      }).join('') || emptyHtml('No timeline', '')) +
    '</div></div>');
  document.getElementById('drawer-overlay').classList.add('open');
  document.getElementById('drawer-panel').classList.add('open');
}

function artifactListHtml(run) {
  var items = run.artifactIndex || [];
  if (!items.length) return emptyHtml('No artifacts yet', 'Stage deliverables (requirements, architecture, QA reports…) appear here.');
  var byStage = {};
  items.forEach(function(item) { (byStage[item.stage] = byStage[item.stage] || []).push(item); });
  return Object.keys(byStage).sort().map(function(stage) {
    return '<div class="artifact-group"><div class="artifact-stage mono">' + esc(stage) + '</div>' +
      byStage[stage].map(function(item) {
        var name = item.path.split('/').pop();
        return '<button class="artifact-link" data-runid="' + esc(run.runId) + '" data-path="' + esc(item.path) + '" onclick="viewArtifact(this)">' +
          '<span class="mono">' + esc(name) + '</span><span class="faint mono">' + Math.ceil((item.size || 0) / 1024) + ' KB</span></button>';
      }).join('') + '</div>';
  }).join('');
}

function evidenceListHtml(run) {
  var entries = run.evidenceRecent || [];
  if (!entries.length) return emptyHtml('No evidence yet', 'Validation evidence records appear here.');
  return entries.map(function(entry) {
    return '<div class="evidence-row">' + pill(entry.status === 'PASS' ? 'pass' : 'fail', entry.status) +
      '<span class="mono">' + esc(entry.task_id || '') + '</span>' +
      '<span class="muted">' + esc(entry.kind || '') + '</span>' +
      '<span class="faint mono">' + (entry.ts ? fmtTime(entry.ts) : '') + '</span></div>';
  }).join('');
}

function viewArtifact(btn) {
  var runId = btn.getAttribute('data-runid');
  var path = btn.getAttribute('data-path');
  fetch('/api/artifact?run=' + encodeURIComponent(runId) + '&path=' + encodeURIComponent(path))
    .then(function(response) { return response.json(); })
    .then(function(data) {
      if (data.error) { showErr('artifact: ' + data.error); return; }
      var body = document.getElementById('drawer-body');
      var back = document.createElement('button');
      back.className = 'tb-chip';
      back.textContent = '← Back to run';
      back.addEventListener('click', function() { openDrawer(runId); });
      body.innerHTML =
        '<div class="panel" style="margin-top:12px"><div class="panel-head"><span class="panel-title mono">' + esc(data.path) + '</span><span class="panel-note">' + Math.ceil(data.size / 1024) + ' KB</span></div>' +
        '<div class="panel-body"><pre class="artifact-content">' + esc(data.content) + '</pre></div></div>';
      body.insertBefore(back, body.firstChild);
    })
    .catch(function(err) { showErr('artifact: ' + err.message); });
}

function closeDrawer() {
  document.getElementById('drawer-overlay').classList.remove('open');
  document.getElementById('drawer-panel').classList.remove('open');
}

function approveFromButton(btn) {
  resolveApproval(btn.getAttribute('data-id'), 'approve');
}

function rejectFromButton(btn) {
  resolveApproval(btn.getAttribute('data-id'), 'reject');
}

function resolveApproval(id, action) {
  var resolvedBy = localStorage.getItem('rstack-approver-name') || '';
  if (!resolvedBy && typeof window.prompt === 'function') {
    resolvedBy = window.prompt('Manager name for this approval decision') || '';
    if (resolvedBy) localStorage.setItem('rstack-approver-name', resolvedBy);
  }
  // Approvals require the signed token (RSTACK_APPROVAL_TOKEN) so identity
  // can't be spoofed from a bare request. Stored locally after first entry.
  var token = localStorage.getItem('rstack-approval-token') || '';
  if (!token && typeof window.prompt === 'function') {
    token = window.prompt('Approval token (RSTACK_APPROVAL_TOKEN set on the hub)') || '';
    if (token) localStorage.setItem('rstack-approval-token', token);
  }
  fetch('/api/' + action, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-rstack-approval-token': token },
    body: JSON.stringify({ id: id, resolvedBy: resolvedBy || 'dashboard' })
  }).then(function(response) {
    if (!response.ok) {
      return response.json().then(function(body) {
        throw new Error(body.error || ('HTTP ' + response.status));
      });
    }
    return fetchState();
  }).catch(function(err) { showErr('approval: ' + err.message); });
}

function fetchState() {
  return fetch('/api/state')
    .then(function(response) { return response.json(); })
    .then(function(data) {
      applyState(data);
      if (!WS_CONNECTED) {
        setConnectionStatus('connecting', 'Loaded (connecting…)');
      }
    })
    .catch(function(err) {
      setConnectionStatus('error', 'HTTP error');
      showErr('HTTP load failed: ' + err.message);
    });
}

function connectWS() {
  try {
    ws = new WebSocket('ws://localhost:' + PORT);
  } catch (err) {
    setConnectionStatus('error', 'Socket unavailable');
    return;
  }
  ws.onopen = function() {
    WS_CONNECTED = true;
    clearTimeout(reconnectTimer);
    setConnectionStatus('live', 'Live');
  };
  ws.onmessage = function(event) {
    try {
      applyState(JSON.parse(event.data));
    } catch (err) {
      showErr('WS render: ' + err.message);
    }
  };
  ws.onclose = ws.onerror = function() {
    WS_CONNECTED = false;
    setConnectionStatus('connecting', 'Reconnecting...');
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connectWS, 2500);
  };
}

function setConnectionStatus(kind, label) {
  setText('status-text', label);
  var statusDot = document.getElementById('status-dot');
  var wsDot = document.getElementById('ws-dot');
  if (statusDot) statusDot.className = 'status-dot status-' + kind;
  if (wsDot) wsDot.className = kind === 'live' ? 'ws-dot ws-live' : 'ws-dot';
}

function allTasks(s) {
  return (s.runs || []).reduce(function(items, run) { return items.concat(run.tasks || []); }, []);
}

function taskStatusCounts(tasks) {
  var counts = { PASS: 0, FAIL: 0, IN_PROGRESS: 0, PENDING: 0, READY: 0, QUEUED: 0 };
  (tasks || []).forEach(function(task) {
    var status = String(task.status || 'READY').toUpperCase();
    if (status === 'RUNNING') status = 'IN_PROGRESS';
    if (status === 'DONE') status = 'PASS';
    if (!counts[status]) counts[status] = 0;
    counts[status] += 1;
  });
  return counts;
}

function barCells(n, cls) {
  var out = '';
  var count = Math.min(8, n || 0);
  for (var i = 0; i < count; i++) out += '<span class="mini-bar ' + cls + '"></span>';
  if (!out) out = '<span class="mini-bar"></span>';
  return out;
}

function pill(status, label) {
  var value = label || String(status || 'ready');
  var cls = String(status || 'ready').toLowerCase();
  if (cls === 'pass' || cls === 'passed') cls = 'pass';
  if (cls === 'fail' || cls === 'failed') cls = 'fail';
  if (cls === 'in_progress') cls = 'running';
  return '<span class="pill ' + esc(cls) + '">' + esc(value) + '</span>';
}

function chip(label) {
  return '<span class="chip">' + esc(label || '') + '</span>';
}

function emptyHtml(title, detail) {
  return '<div class="empty"><div class="empty-title">' + esc(title || 'Empty') + '</div>' + (detail ? '<div>' + esc(detail) + '</div>' : '') + '</div>';
}

function shortName(path) {
  return String(path || '-').split('/').filter(Boolean).pop() || '-';
}

function fmtTime(value) {
  if (!value) return '-';
  return String(value).replace('T', ' ').slice(0, 16);
}

function setText(id, value) {
  var el = document.getElementById(id);
  if (el) el.textContent = value;
}

function setHTML(id, value) {
  var el = document.getElementById(id);
  if (el) el.innerHTML = value;
}

function setClass(id, value) {
  var el = document.getElementById(id);
  if (el) el.className = value;
}

function setBadge(id, value) {
  var el = document.getElementById(id);
  if (!el) return;
  el.textContent = value;
  el.style.display = value > 0 ? 'inline-block' : 'none';
}

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showErr(message) {
  var el = document.getElementById('err');
  if (!el) return;
  el.textContent = 'Error: ' + message;
  el.style.display = 'block';
  console.error('[rstack-business]', message);
}

setConnectionStatus('connecting', 'Loading...');
fetchState();
connectWS();
`;
}
