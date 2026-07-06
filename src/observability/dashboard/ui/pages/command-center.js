// owner: RStack developed by Richardson Gunde
//
// Command Center page module — renders into #page-command. Plain client JS
// concatenated into the served bundle by ui/client.js; self-registers its
// renderer with the page registry (ui/lib.js).

export const commandCenterScript = `
// ── page: command ────────────────────────────────────────────────
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
  if (counts.BLOCKED) {
    items.push({ level: 'danger', value: counts.BLOCKED, title: 'Guardrail-blocked tasks', detail: 'Attempt budget exhausted. Approve the guardrail-override entry in Approvals to allow exactly one more attempt.', meta: 'Guardrails' });
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

registerPage('command', {
  errLabel: 'command',
  sub: 'Operational overview across every known .rstack project, run, agent action, approval and alert.',
  render: renderCommand
});
`;
