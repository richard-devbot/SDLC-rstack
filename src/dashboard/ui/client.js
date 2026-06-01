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
  workflow: 'Workflow Map',
  projects: 'Projects & Runs',
  'agent-work': 'Agent Work',
  'live-feed': 'Live Feed',
  approvals: 'Approvals',
  'alerts-guardrails': 'Alerts & Guardrails',
  traceability: 'Traceability',
  'team-layers': 'Team & Layers',
  diagnostics: 'Diagnostics'
};

var PAGE_SUBS = {
  command: 'Operational overview across every known .rstack project, run, agent action, approval and alert.',
  workflow: 'The canonical SDLC flow, grouped by stage with pass, fail, active and ready counts from real run tasks.',
  projects: 'All registered project roots and their run sessions, costs, task status and activity timeline.',
  'agent-work': 'Builder and validator work grouped by project, run, stage and agent contract.',
  'live-feed': 'Real-time event stream from events.jsonl plus live WebSocket refreshes.',
  approvals: 'Human-in-loop actions from the approval queue only.',
  'alerts-guardrails': 'Threshold alerts, blocked gates, guardrails, stalled work and spend risks.',
  traceability: 'Requirements, stage artifacts, verified tasks and evidence connected by run.',
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
  try { renderFrame(state); } catch (err) { showErr('frame: ' + err.message); }
  try { renderCommand(state); } catch (err) { showErr('command: ' + err.message); }
  try { renderWorkflow(state); } catch (err) { showErr('workflow: ' + err.message); }
  try { renderProjects(state); } catch (err) { showErr('projects: ' + err.message); }
  try { renderAgentWork(state); } catch (err) { showErr('agent work: ' + err.message); }
  try { renderLiveFeed(state); } catch (err) { showErr('live feed: ' + err.message); }
  try { renderApprovals(state); } catch (err) { showErr('approvals: ' + err.message); }
  try { renderAlertsGuardrails(state); } catch (err) { showErr('alerts: ' + err.message); }
  try { renderTraceability(state); } catch (err) { showErr('traceability: ' + err.message); }
  try { renderTeamLayers(state); } catch (err) { showErr('team layers: ' + err.message); }
  try { renderDiagnostics(state); } catch (err) { showErr('diagnostics: ' + err.message); }
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
      '<td class="mono muted">$' + Number((run.metrics || {}).cumulative_cost_usd || 0).toFixed(4) + '</td>' +
    '</tr>';
  }).join('') || '<tr><td colspan="5" class="empty">No runs yet</td></tr>');
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
  var calls = timeline.reduce(function(total, item) { return total + (item.toolCalls || 0); }, 0);
  setText('drawer-title', (run.manifest && run.manifest.goal) || run.runId);
  setText('drawer-sub', shortName(run.projectRoot) + ' / ' + run.runId);
  setHTML('drawer-body',
    '<div class="kpi-grid">' +
      '<div class="kpi blue"><div class="kpi-v">' + calls + '</div><div class="kpi-l">Tool Calls</div></div>' +
      '<div class="kpi green"><div class="kpi-v">' + passed + '</div><div class="kpi-l">Passed</div></div>' +
      '<div class="kpi red"><div class="kpi-v">' + failed + '</div><div class="kpi-l">Failed</div></div>' +
      '<div class="kpi amber"><div class="kpi-v">$' + Number((run.metrics || {}).cumulative_cost_usd || 0).toFixed(4) + '</div><div class="kpi-l">Cost</div></div>' +
    '</div>' +
    '<div class="panel"><div class="panel-head"><span class="panel-title">Timeline</span></div><div class="panel-body">' +
      (timeline.map(function(item) {
        return '<div class="feed-row"><div class="feed-icon info">' + (item.toolCalls || 0) + '</div><div><div class="feed-summary">' + esc(item.minute || '') + '</div><div class="feed-meta"><span>' + (item.stagesDone || []).length + ' stages</span><span>' + (item.guardrails || 0) + ' guardrails</span></div></div></div>';
      }).join('') || emptyHtml('No timeline', '')) +
    '</div></div>');
  document.getElementById('drawer-overlay').classList.add('open');
  document.getElementById('drawer-panel').classList.add('open');
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
  fetch('/api/' + action, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: id })
  }).then(function() { return fetchState(); }).catch(function(err) { showErr('approval: ' + err.message); });
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
