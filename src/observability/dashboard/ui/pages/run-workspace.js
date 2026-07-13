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

// ── Cockpit controls (#285) ────────────────────────────────────────
// Render ONLY the server-declared allowedActions. A disabled action shows the
// server's reason; a stale/offline snapshot disables everything. Invocation
// goes through a confirmation dialog that repeats the target + consequence,
// then POSTs to /api/action with a per-intent idempotency key.

function cockpitRunForState(s, workspace) {
  var cockpit = s.cockpit;
  if (!cockpit || !cockpit.enabled) return null;
  var runId = workspace && workspace.identity ? workspace.identity.runId : null;
  if (!runId) return null;
  return (cockpit.runs || []).find(function(entry) { return entry.runId === runId; }) || null;
}

function cockpitActionHtml(action) {
  var risk = action.risk === 'high' ? 'critical' : 'info';
  var badges = pill(risk, action.risk + ' risk') + (action.requiresApproval ? pill('pending', 'approval required') : pill('ready', 'no approval'));
  var control = action.enabled
    ? '<button class="btn primary" type="button"' +
        ' data-cockpit-action="' + esc(action.type) + '"' +
        ' data-cockpit-run="' + esc(action.target.runId) + '"' +
        ' data-cockpit-stage="' + esc(action.target.stageId || '') + '"' +
        ' data-cockpit-title="' + esc(action.confirm.title) + '"' +
        ' data-cockpit-consequence="' + esc(action.confirm.consequence) + '"' +
        ' data-cockpit-target="' + esc(action.confirm.target) + '"' +
        ' data-cockpit-approval="' + (action.requiresApproval ? '1' : '0') + '"' +
        ' onclick="cockpitConfirm(this)">' + esc(action.confirm.title) + '</button>'
    : '<button class="btn" type="button" disabled aria-disabled="true" title="' + esc(action.disabledReason || 'unavailable') + '">' + esc(action.confirm.title) + '</button>' +
      '<div class="muted" style="margin-top:6px">' + esc(action.disabledReason || 'This action is unavailable.') + '</div>';
  return '<div class="approval-card" style="margin-bottom:10px"><div class="agent-head"><div>' +
    '<div class="strong">' + esc(action.confirm.title) + '</div>' +
    '<div class="muted">' + esc(action.confirm.consequence) + '</div></div>' + badges + '</div>' +
    '<div class="approval-actions">' + control + '</div></div>';
}

function cockpitControlsPanelHtml(cockpit, cockpitRun) {
  if (!cockpit || !cockpit.enabled || !cockpitRun) return '';
  var actions = cockpitRun.allowedActions || [];
  var body = actions.length
    ? actions.map(cockpitActionHtml).join('')
    : emptyHtml('No controls available', 'This run currently exposes no cockpit actions.');
  var staleNote = cockpitRun.stale
    ? '<div class="ops-note" style="margin:0 0 10px">This run snapshot is stale — controls are disabled until it refreshes.</div>'
    : '';
  return '<div class="panel" id="run-workspace-controls" style="margin-bottom:16px">' +
    '<div class="panel-head"><span class="panel-title">Cockpit controls</span>' +
    '<span class="panel-note">Authenticated, audited, governed — server-declared</span></div>' +
    '<div class="panel-body">' + staleNote + body + '</div></div>';
}

function renderRunWorkspaceControls(s, workspace) {
  var container = document.getElementById('run-workspace-summary');
  if (!container) return;
  var existing = document.getElementById('run-workspace-controls');
  if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
  var html = cockpitControlsPanelHtml(s.cockpit, cockpitRunForState(s, workspace));
  if (!html) return;
  var wrap = document.createElement('div');
  wrap.innerHTML = html;
  container.insertBefore(wrap.firstChild, container.firstChild);
}

// Build a per-intent idempotency key that satisfies the server contract
// (8–128 chars of [A-Za-z0-9._:-]). A fresh click = a fresh intent = a new key;
// re-submitting the SAME key (browser retry) is deduped server-side.
function cockpitIdempotencyKey(action, run, stage) {
  var raw = 'ck-' + action + '-' + run + '-' + (stage || 'x') + '-' + Date.now() + '-' + Math.floor(Math.random() * 1e9);
  var safe = raw.replace(/[^A-Za-z0-9._:-]/g, '-');
  return safe.slice(0, 120);
}

function cockpitCredentials() {
  var resolvedBy = localStorage.getItem('rstack-approver-name') || '';
  if (!resolvedBy && typeof window.prompt === 'function') {
    resolvedBy = window.prompt('Your operator name for this action') || '';
    if (resolvedBy) localStorage.setItem('rstack-approver-name', resolvedBy);
  }
  var token = sessionStorage.getItem('rstack-approval-token') || '';
  if (!token && typeof window.prompt === 'function') {
    token = window.prompt('Approval token (RSTACK_APPROVAL_TOKEN set on the hub)') || '';
    if (token) sessionStorage.setItem('rstack-approval-token', token);
  }
  return { resolvedBy: resolvedBy || 'dashboard', token: token };
}

function cockpitConfirm(btn) {
  var data = {
    action: btn.getAttribute('data-cockpit-action'),
    run: btn.getAttribute('data-cockpit-run'),
    stage: btn.getAttribute('data-cockpit-stage') || null,
    title: btn.getAttribute('data-cockpit-title'),
    consequence: btn.getAttribute('data-cockpit-consequence'),
    target: btn.getAttribute('data-cockpit-target'),
    requiresApproval: btn.getAttribute('data-cockpit-approval') === '1'
  };
  cockpitOpenModal(data);
}

function cockpitCloseModal() {
  var overlay = document.getElementById('cockpit-modal');
  if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
  if (window.__cockpitKeyHandler) { document.removeEventListener('keydown', window.__cockpitKeyHandler); window.__cockpitKeyHandler = null; }
}

function cockpitOpenModal(data) {
  cockpitCloseModal();
  var overlay = document.createElement('div');
  overlay.id = 'cockpit-modal';
  overlay.setAttribute('style', 'position:fixed;inset:0;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;z-index:1000;padding:16px');
  var approvalNote = data.requiresApproval
    ? '<p class="muted">This is a destructive action. It runs only after a manager approves the request on the Approvals page; your submission first opens that governed request.</p>'
    : '';
  overlay.innerHTML =
    '<div role="dialog" aria-modal="true" aria-labelledby="cockpit-modal-title" ' +
    'style="background:var(--panel,#12151c);color:inherit;border:1px solid var(--border,#2a2f3a);border-radius:12px;max-width:520px;width:100%;padding:20px;box-shadow:0 12px 40px rgba(0,0,0,0.5)">' +
      '<h2 id="cockpit-modal-title" style="margin:0 0 8px;font-size:18px">' + esc(data.title) + '</h2>' +
      '<div class="mono muted" style="margin-bottom:10px">' + esc(data.target) + '</div>' +
      '<p style="margin:0 0 10px">' + esc(data.consequence) + '</p>' + approvalNote +
      '<div id="cockpit-modal-status" role="status" aria-live="polite" style="min-height:20px;margin:10px 0"></div>' +
      '<div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap">' +
        '<button class="btn" type="button" id="cockpit-cancel" onclick="cockpitCloseModal()">Cancel</button>' +
        '<button class="btn primary" type="button" id="cockpit-confirm">Confirm</button>' +
      '</div>' +
    '</div>';
  overlay.addEventListener('click', function(event) { if (event.target === overlay) cockpitCloseModal(); });
  document.body.appendChild(overlay);
  window.__cockpitKeyHandler = function(event) { if (event.key === 'Escape') cockpitCloseModal(); };
  document.addEventListener('keydown', window.__cockpitKeyHandler);
  var confirmBtn = document.getElementById('cockpit-confirm');
  confirmBtn.onclick = function() { cockpitSubmit(data); };
  confirmBtn.focus();
}

function cockpitSetStatus(text, tone) {
  var el = document.getElementById('cockpit-modal-status');
  if (el) el.innerHTML = '<span class="' + (tone || 'muted') + '">' + esc(text) + '</span>';
}

function cockpitSubmit(data) {
  var creds = cockpitCredentials();
  var confirmBtn = document.getElementById('cockpit-confirm');
  if (confirmBtn) confirmBtn.disabled = true;
  cockpitSetStatus('Submitting…', 'muted');
  var payload = {
    action: data.action,
    runId: data.run,
    idempotencyKey: cockpitIdempotencyKey(data.action, data.run, data.stage),
    resolvedBy: creds.resolvedBy
  };
  if (data.stage) payload.stageId = data.stage;
  fetch('/api/action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-rstack-approval-token': creds.token },
    body: JSON.stringify(payload)
  }).then(function(response) {
    return response.json().catch(function() { return {}; }).then(function(body) { return { status: response.status, body: body }; });
  }).then(function(result) {
    if (result.status === 202 || result.status === 200) {
      cockpitSetStatus('Accepted — reconciling from the run timeline. See the Timeline tab.', 'strong');
      fetchState();
      setTimeout(cockpitCloseModal, 1400);
      return;
    }
    if (confirmBtn) confirmBtn.disabled = false;
    if (result.status === 409 && result.body.error === 'approval_required') {
      cockpitSetStatus('Approval required — approve "' + (result.body.artifact || 'the request') + '" on the Approvals page, then run this again.', 'muted');
      fetchState();
      return;
    }
    if (result.status === 409 && result.body.error === 'not_eligible') {
      cockpitSetStatus('Not eligible: ' + (result.body.reason || result.body.detail || 'the run state changed'), 'muted');
      return;
    }
    cockpitSetStatus('Failed (' + result.status + '): ' + (result.body.error || result.body.detail || 'request rejected'), 'muted');
  }).catch(function(err) {
    if (confirmBtn) confirmBtn.disabled = false;
    cockpitSetStatus('Failed: ' + err.message, 'muted');
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
  renderRunWorkspaceControls(s, workspace);
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
