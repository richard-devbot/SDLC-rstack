// owner: RStack developed by Richardson Gunde

export const runWorkspaceScript = `
// ── page: run-workspace (#280) ─────────────────────────────────────
var RUN_WORKSPACE_CURRENT = null;
var RUN_WORKSPACE_SECTIONS_UI = ['summary', 'work', 'timeline', 'artifacts', 'metrics'];

function runWorkspaceForState(s) {
  var workspaces = s.runWorkspaces || [];
  if (workspaces.length === 1) return workspaces[0];
  if (typeof SCOPE !== 'undefined' && SCOPE.run) {
    return workspaces.find(function(item) {
      return item.identity && (item.identity.runKey === SCOPE.run || item.identity.runId === SCOPE.run);
    }) || null;
  }
  return null;
}

function runWorkspaceTabsHtml() {
  return RUN_WORKSPACE_SECTIONS_UI.map(function(section) {
    var selected = section === ACTIVE_RUN_SECTION;
    return '<button class="run-workspace-tab" type="button" role="tab" data-run-section="' + section + '" ' +
      'aria-controls="run-workspace-' + section + '" aria-selected="' + (selected ? 'true' : 'false') + '" ' +
      'tabindex="' + (selected ? '0' : '-1') + '" onclick="showRunWorkspaceSection(\\'' + section + '\\')">' +
      section.charAt(0).toUpperCase() + section.slice(1) + '</button>';
  }).join('');
}

function runWorkspaceStatusLabel(status) {
  return ({ blocked: 'Blocked', at_risk: 'At risk', ready: 'Ready', unknown: 'Unknown' })[status] || status || 'Unknown';
}

function renderRunWorkspacePassport(workspace) {
  var identity = workspace.identity || {};
  var worktree = identity.worktree || {};
  var next = workspace.nextAction;
  setText('run-workspace-goal', workspace.goal || 'Goal unavailable');
  setText('run-workspace-run-id', identity.runId || 'Run unavailable');
  setText('run-workspace-project', identity.projectRoot || 'Project unavailable');
  setText('run-workspace-worktree', worktree.path || worktree.branch || 'Primary workspace');
  setText('run-workspace-state', runWorkspaceStatusLabel(workspace.outcome && workspace.outcome.status));
  setClass('run-workspace-state', 'overview-state ' + ((workspace.outcome && workspace.outcome.status) || 'unknown'));
  setText('run-workspace-next', next ? next.text : 'No next action is available from this run snapshot.');
  setText('run-workspace-freshness', workspace.stale ? 'Stale snapshot · last-known state' : 'Current server snapshot');
}

function runWorkspaceProofHtml(stages) {
  if (!stages || !stages.length) return emptyHtml('Stage proof unavailable', 'This legacy or partial run has no normalized stage proof.');
  return '<ol class="run-workspace-proof">' + stages.map(function(stage) {
    var proof = stage.proof || {};
    var proofText = proof.expected !== null && proof.expected !== undefined
      ? proof.attached + '/' + proof.expected + ' proof'
      : proof.attached ? proof.attached + ' attached · expected unknown' : 'proof unavailable';
    return '<li tabindex="0" aria-label="' + esc(stage.label + ': ' + stage.state + ', ' + proofText) + '">' +
      '<span aria-hidden="true">' + esc(overviewStageIcon(stage.state)) + '</span><div><strong>' + esc(stage.label) + '</strong>' +
      '<small>' + esc(stage.state.replace('_', ' ')) + ' · ' + esc(proofText) + '</small></div></li>';
  }).join('') + '</ol>';
}

function renderRunWorkspaceSummary(workspace) {
  var outcome = workspace.outcome || {};
  setHTML('run-workspace-summary',
    '<div class="run-workspace-summary-grid"><div class="panel"><div class="panel-head"><span class="panel-title">Outcome</span></div>' +
      '<div class="panel-body"><div class="run-workspace-outcome">' + esc(runWorkspaceStatusLabel(outcome.status)) + '</div>' +
      '<p class="muted">' + esc(outcome.summary || 'Outcome unavailable.') + '</p></div></div>' +
    '<div class="panel"><div class="panel-head"><span class="panel-title">Current action</span></div><div class="panel-body">' +
      '<strong>' + esc(workspace.nextAction ? workspace.nextAction.text : 'No next action recorded.') + '</strong>' +
      '<div class="source-ref">' + esc(workspace.nextAction ? workspace.nextAction.source : 'Source unavailable') + '</div></div></div></div>' +
    '<div class="panel"><div class="panel-head"><span class="panel-title">Stage proof</span></div><div class="panel-body">' +
      runWorkspaceProofHtml(workspace.stageProof) + '</div></div>');
}

function renderRunWorkspaceWork(section) {
  if (!section.available) {
    setHTML('run-workspace-work', emptyHtml('No task or agent activity yet', 'Work becomes available when the run records tasks.'));
    return;
  }
  setHTML('run-workspace-work', '<div class="run-workspace-card-grid">' + section.items.map(function(item) {
    var validation = item.validation || {};
    return '<article class="run-workspace-card"><div class="run-workspace-card-head">' + pill(item.status === 'PASS' ? 'pass' : item.status === 'FAIL' || item.status === 'BLOCKED' ? 'fail' : 'active', item.status) +
      '<span class="mono muted">' + esc(item.stageId || 'stage unavailable') + '</span></div><h3>' + esc(item.title) + '</h3>' +
      '<div class="kv"><span>Agent</span><b>' + esc(item.agent || 'unassigned') + '</b></div>' +
      '<div class="kv"><span>Validation</span><b>' + esc(validation.status || 'not evaluated') + '</b></div>' +
      '<div class="kv"><span>Proof / risks</span><b>' + esc(item.evidenceCount) + ' / ' + esc(item.riskCount) + '</b></div></article>';
  }).join('') + '</div>');
}

function renderRunWorkspaceTimeline(section) {
  if (!section.available) {
    setHTML('run-workspace-timeline', emptyHtml('Timeline unavailable', 'This run has no recorded timeline events.'));
    return;
  }
  setHTML('run-workspace-timeline', '<div class="run-workspace-timeline">' + section.items.map(function(item) {
    return '<div class="run-workspace-event"><time datetime="' + esc(item.ts) + '">' + timeHtml(item.ts) + '</time>' +
      '<div><strong>' + esc(String(item.type || 'event').replaceAll('_', ' ')) + '</strong>' +
      '<small>' + esc(item.task_id || item.stage_id || item.detail || 'Run event') + '</small></div></div>';
  }).join('') + '</div>');
}

function renderRunWorkspaceArtifacts(workspace, section) {
  if (!section.available) {
    setHTML('run-workspace-artifacts', emptyHtml('Artifacts unavailable', 'No safe artifact or evidence paths were recorded for this run.'));
    return;
  }
  setHTML('run-workspace-artifacts', '<div class="run-workspace-card-grid">' + section.items.map(function(item) {
    return '<article class="run-workspace-card"><div class="run-workspace-card-head">' + pill(item.available ? 'info' : 'ready', item.kind) + '</div>' +
      '<h3 class="mono">' + esc(item.path || 'Source unavailable') + '</h3><p class="muted">' + esc(item.source) + '</p>' +
      (item.available ? '<button class="tb-chip" onclick="openDrawer(\\'' + esc(workspace.identity.runId) + '\\')">Open protected preview</button>' : '<span class="muted">Preview unavailable</span>') + '</article>';
  }).join('') + '</div>');
}

function runWorkspaceMetricValue(value, formatter) {
  return value === null || value === undefined ? 'Unavailable' : formatter(value);
}

function renderRunWorkspaceMetrics(section) {
  var totals = section.totals || {};
  var tokens = section.tokenTotals || {};
  var hasMetrics = section.available;
  var summary = '<div class="run-workspace-metrics">' +
    '<div><span>Duration</span><strong>' + (hasMetrics ? runWorkspaceMetricValue(totals.duration_ms, fmtDur) : 'Unavailable') + '</strong></div>' +
    '<div><span>Cost</span><strong>' + (hasMetrics && totals.cost_usd !== null && totals.cost_usd !== undefined ? '$' + Number(totals.cost_usd).toFixed(4) : 'Unavailable') + '</strong></div>' +
    '<div><span>Tokens</span><strong>' + (hasMetrics && tokens.total !== undefined ? esc(tokens.total) : 'Unavailable') + '</strong></div>' +
    '<div><span>Provenance</span><strong>' + esc(section.provenance) + '</strong></div></div>';
  var drivers = section.stageDrivers.length ? '<div class="panel"><div class="panel-head"><span class="panel-title">Per-stage drivers</span></div><div class="panel-body">' +
    section.stageDrivers.map(function(item) { return '<div class="kv"><span class="mono">' + esc(item.stageId) + '</span><b>' +
      (item.costUsd === null ? 'cost unavailable' : '$' + Number(item.costUsd).toFixed(4)) +
      (item.tokens && item.tokens.total ? ' · ' + esc(item.tokens.total) + ' tokens' : '') + '</b></div>'; }).join('') + '</div></div>' : '';
  var recovery = section.recovery.length ? '<div class="panel"><div class="panel-head"><span class="panel-title">Recovery availability</span></div><div class="panel-body">' +
    section.recovery.map(function(item) { return '<div class="kv"><span class="mono">' + esc(item.stageId || 'stage') + '</span><b>' +
      (item.restorable ? 'Checkpoint restorable' : 'Restore unavailable') + '</b></div>'; }).join('') + '</div></div>' : '';
  setHTML('run-workspace-metrics', summary + drivers + recovery + (!hasMetrics ? emptyHtml('Metrics unavailable', 'No persisted or events-derived telemetry exists for this run.') : ''));
}

function renderRunWorkspaceSection() {
  document.querySelectorAll('[data-run-section]').forEach(function(button) {
    var selected = button.getAttribute('data-run-section') === ACTIVE_RUN_SECTION;
    button.setAttribute('aria-selected', selected ? 'true' : 'false');
    button.setAttribute('tabindex', selected ? '0' : '-1');
  });
  RUN_WORKSPACE_SECTIONS_UI.forEach(function(section) {
    var panel = document.getElementById('run-workspace-' + section);
    if (panel) panel.hidden = section !== ACTIVE_RUN_SECTION;
  });
}

function renderRunWorkspace(s) {
  setHTML('run-workspace-tabs', runWorkspaceTabsHtml());
  var workspace = runWorkspaceForState(s);
  RUN_WORKSPACE_CURRENT = workspace;
  var empty = document.getElementById('run-workspace-empty');
  var content = document.getElementById('run-workspace-content');
  if (!workspace) {
    if (empty) { empty.hidden = false; empty.innerHTML = emptyHtml('Select one run to open its workspace', 'Use the persistent Run scope above. Deleted or unavailable run links reset safely.'); }
    if (content) content.hidden = true;
    renderRunWorkspaceSection();
    return;
  }
  if (empty) empty.hidden = true;
  if (content) content.hidden = false;
  renderRunWorkspacePassport(workspace);
  renderRunWorkspaceSummary(workspace);
  renderRunWorkspaceWork(workspace.sections.work);
  renderRunWorkspaceTimeline(workspace.sections.timeline);
  renderRunWorkspaceArtifacts(workspace, workspace.sections.artifacts);
  renderRunWorkspaceMetrics(workspace.sections.metrics);
  renderRunWorkspaceSection();
}

registerPage('run-workspace', {
  errLabel: 'run workspace',
  sub: 'One scoped run across outcome, work, timeline, protected artifacts, metrics, provenance, and recovery availability.',
  render: renderRunWorkspace
});
`;
