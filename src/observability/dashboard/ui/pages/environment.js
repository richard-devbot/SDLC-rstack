// owner: RStack developed by Richardson Gunde
//
// Environment & Integrations page module (#238) — renders into
// #page-environment. Plain client JS concatenated into the served bundle by
// ui/client.js; self-registers with the page registry (ui/lib.js).
//
// Secrecy contract mirrored client-side: env VALUES exist only in this tab's
// memory (ENV_HELD_VALUES) between the approval request and the approved
// write — they are never rendered, never stored in local/sessionStorage, and
// the server never echoes them back.

export const environmentScript = `
// ── page: environment ──────────────────────────────────────────────
// Values held in-memory only, keyed by env key, so the user does not have to
// retype a secret between "request approval" and "write after approval".
// Deliberately NOT persisted anywhere.
var ENV_HELD_VALUES = {};

function envApproverName() {
  var name = localStorage.getItem('rstack-approver-name') || '';
  if (!name && typeof window.prompt === 'function') {
    name = window.prompt('Your name (recorded on the audit trail)') || '';
    if (name) localStorage.setItem('rstack-approver-name', name);
  }
  return name;
}

function envApprovalToken() {
  var token = sessionStorage.getItem('rstack-approval-token') || '';
  if (!token && typeof window.prompt === 'function') {
    token = window.prompt('Approval token (RSTACK_APPROVAL_TOKEN set on the hub)') || '';
    if (token) sessionStorage.setItem('rstack-approval-token', token);
  }
  return token;
}

function envSetMsg(text, isError) {
  var el = document.getElementById('env-write-msg');
  if (!el) return;
  el.textContent = text || '';
  el.className = 'muted';
  el.style.color = isError ? '#e5484d' : '';
}

function envWriteFromButton(btn) {
  envStartWrite(btn.getAttribute('data-key') || '');
}

function envStartNewKey() {
  var key = (window.prompt('New env key (uppercase letters, digits, underscores — e.g. JIRA_TOKEN)') || '').trim();
  if (!key) return;
  envStartWrite(key);
}

function envStartWrite(key) {
  if (!key) return;
  var value = ENV_HELD_VALUES[key];
  if (value == null) {
    value = window.prompt('Value for ' + key + ' — held in this browser tab ONLY until a manager approves; never stored server-side before approval.');
    if (value == null || value === '') return;
    ENV_HELD_VALUES[key] = value;
  }
  var resolvedBy = envApproverName();
  var token = envApprovalToken();
  fetch('/api/env-write', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-rstack-approval-token': token },
    body: JSON.stringify({ key: key, value: value, resolvedBy: resolvedBy || 'dashboard' })
  }).then(function(response) {
    return response.json().catch(function() { return {}; }).then(function(body) {
      return { status: response.status, body: body };
    });
  }).then(function(result) {
    if (result.status === 200) {
      delete ENV_HELD_VALUES[key];
      envSetMsg('Wrote ' + key + ' to .env (approved by ' + (result.body.approvedBy || 'manager') + '). The approval was consumed — the next write needs a fresh one.');
      return fetchState();
    }
    if (result.status === 409 && result.body.error === 'approval_required') {
      envSetMsg('Approval requested for ' + key + '. A manager must approve it on the Approvals page, then click Set/Update again — the value stays in this tab, nothing was stored.');
      return fetchState();
    }
    if (result.status === 409 && result.body.error === 'gitignore_required') {
      envSetMsg(result.body.detail || '.env is not gitignored — writes are refused until it is.', true);
      return null;
    }
    throw new Error(result.body.error || ('HTTP ' + result.status));
  }).catch(function(err) { showErr('env-write: ' + err.message); });
}

function envDecideFromButton(btn) {
  var status = btn.getAttribute('data-status');
  var resolution = '';
  if (status === 'resolved') {
    resolution = window.prompt('Resolution — what was decided?') || '';
    if (!resolution) return;
  }
  var resolvedBy = envApproverName();
  var token = envApprovalToken();
  fetch('/api/decide', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-rstack-approval-token': token },
    body: JSON.stringify({
      runId: btn.getAttribute('data-runid') || undefined,
      decisionId: btn.getAttribute('data-id'),
      status: status,
      resolution: resolution,
      resolvedBy: resolvedBy || 'dashboard'
    })
  }).then(function(response) {
    if (!response.ok) {
      return response.json().then(function(body) { throw new Error(body.error || ('HTTP ' + response.status)); });
    }
    return fetchState();
  }).catch(function(err) { showErr('decide: ' + err.message); });
}

function envGitignoreBannerHtml(env) {
  if (!env.gitignored) {
    return '<div class="alert-card critical"><div class="agent-head"><div>' +
      '<div class="strong">.env is NOT gitignored</div>' +
      '<div class="muted">A committed .env leaks every secret in it. Add ".env" to .gitignore — the hub refuses all env writes until then.</div>' +
      '</div>' + pill('fail', 'writes refused') + '</div></div>';
  }
  return '<div class="ops-note">.env is gitignored' + (env.exists ? '' : ' (file not created yet — it will be created on the first approved write)') + '. Values are never shown, logged, or included in snapshots — key names and lengths only.</div>';
}

function envApprovalForKey(approvals, key) {
  var match = null;
  (approvals || []).forEach(function(item) { if (item.key === key) match = item; });
  return match;
}

function envKeyRowHtml(entry, approvals) {
  var approval = envApprovalForKey(approvals, entry.key);
  var approvalNote = '';
  if (approval && approval.status === 'pending') approvalNote = '<span class="chip">approval pending</span>';
  else if (approval && approval.status === 'approved') approvalNote = '<span class="chip">approved — submit the write</span>';
  return '<tr><td class="mono">' + esc(entry.key) + '</td>' +
    '<td>' + pill('pass', 'set') + '</td>' +
    '<td>' + esc(String(entry.length)) + ' chars</td>' +
    '<td>' + approvalNote + '</td>' +
    '<td><button class="btn" data-key="' + esc(entry.key) + '" onclick="envWriteFromButton(this)">Set / Update</button></td></tr>';
}

function envSetupNeedHtml(need) {
  return '<div class="alert-card ' + (need.satisfied ? 'pass' : 'warn') + '"><div class="agent-head"><div>' +
    '<div class="strong">' + esc((need.kind || 'setup') + (need.platform ? ' — ' + need.platform : '')) + '</div>' +
    (need.required_vars && need.required_vars.length
      ? '<div class="muted">Needs: ' + need.required_vars.map(function(v) { return '<span class="mono">' + esc(v) + '</span>'; }).join(', ') + '</div>'
      : '') +
    '</div>' + pill(need.satisfied ? 'pass' : 'warn', need.satisfied ? 'satisfied' : 'needed') + '</div></div>';
}

function envReportHtml(report) {
  if (!report) {
    return emptyHtml('No environment report yet', 'Run the 00-environment stage (or rstack-agents adopt) to produce environment_report.json.');
  }
  var prefs = report.user_preferences || {};
  var prefKeys = Object.keys(prefs);
  var tools = report.tools || [];
  var available = tools.filter(function(tool) { return tool.available; }).length;
  return '<div class="feed-meta" style="margin-bottom:10px">' +
      '<span>run ' + esc((report.runId || '').slice(-16)) + '</span>' +
      '<span>mode: ' + esc(report.run_mode || 'not recorded') + '</span>' +
      (report.pipeline_ready === null ? '' : '<span>pipeline ready: ' + (report.pipeline_ready ? 'yes' : 'no') + '</span>') +
      (report.source ? '<span>source: ' + esc(report.source) + '</span>' : '') +
    '</div>' +
    (report.run_mode_evidence.length
      ? '<div class="muted" style="margin-bottom:10px">Evidence: ' + report.run_mode_evidence.map(esc).join('; ') + '</div>'
      : '') +
    (tools.length
      ? '<div class="strong" style="margin-bottom:6px">Tools (' + available + '/' + tools.length + ' available)</div><div class="chips">' +
        tools.map(function(tool) {
          return '<span class="chip">' + esc(tool.name + (tool.detail ? ' ' + tool.detail : '') + (tool.available ? '' : ' — missing')) + '</span>';
        }).join('') + '</div>'
      : '<div class="muted">No tool inventory in the report.</div>') +
    (prefKeys.length
      ? '<div class="strong" style="margin:10px 0 6px">User preferences</div><div class="chips">' +
        prefKeys.map(function(k) { return '<span class="chip">' + esc(k + ': ' + prefs[k]) + '</span>'; }).join('') + '</div>'
      : '') +
    '<div class="strong" style="margin:10px 0 6px">Setup needs</div>' +
    ((report.setup_needs || []).length
      ? report.setup_needs.map(envSetupNeedHtml).join('')
      : emptyHtml('No setup needs recorded', 'A v2 report (issue #237) lists unsatisfied integration setup here.'));
}

function envIntegrationsHtml(environment) {
  var integrations = environment.integrations;
  var channels = (environment.notifications && environment.notifications.channels) || [];
  var parts = [];
  if (integrations && integrations.jira) {
    parts.push('<div class="alert-card pass"><div class="agent-head"><div><div class="strong">Jira</div><div class="muted mono">' +
      esc((integrations.jira.base_url || 'no base_url') + (integrations.jira.project_key ? ' · ' + integrations.jira.project_key : '')) +
      '</div></div>' + pill('pass', 'configured') + '</div></div>');
  }
  if (integrations && integrations.confluence) {
    parts.push('<div class="alert-card pass"><div class="agent-head"><div><div class="strong">Confluence</div><div class="muted mono">' +
      esc((integrations.confluence.base_url || 'no base_url') + (integrations.confluence.space ? ' · ' + integrations.confluence.space : '')) +
      '</div></div>' + pill('pass', 'configured') + '</div></div>');
  }
  if (integrations && integrations.tracker) {
    parts.push('<div class="ops-note">Tracker choice: <span class="strong">' + esc(integrations.tracker) + '</span></div>');
  }
  if (!parts.length) {
    parts.push(emptyHtml('No integrations configured', '.rstack/integrations.json holds endpoints and project keys (never credentials — those go to .env below).'));
  }
  parts.push('<div class="strong" style="margin:10px 0 6px">Notification channels</div>');
  parts.push(channels.length
    ? '<div class="chips">' + channels.map(function(name) { return '<span class="chip">' + esc(name) + '</span>'; }).join('') + '</div><div class="muted" style="margin-top:6px">Channel names only — webhook URLs never leave the server.</div>'
    : emptyHtml('No notification channels', 'Configure .rstack/notifications.json or the RSTACK_*_WEBHOOK env vars.'));
  return parts.join('');
}

function envPendingApprovalHtml(item) {
  return '<div class="approval-card ' + esc(item.status || 'pending') + '"><div class="agent-head"><div>' +
    '<div class="strong mono">' + esc(item.key) + '</div>' +
    '<div class="muted">' + esc(item.artifact) + (item.requestedBy ? ' — requested by ' + esc(item.requestedBy) : '') + '</div>' +
    '<div class="feed-meta"><span>' + esc(fmtTime(item.ts)) + '</span></div>' +
    '</div>' + pill(item.status || 'pending', item.status || 'pending') + '</div>' +
    (item.status === 'pending'
      ? '<div class="muted" style="margin-top:6px">Approve on the Approvals page, then submit the write again from the key table.</div>'
      : '') +
    '</div>';
}

function envDecisionRowHtml(item) {
  var d = item.decision;
  return '<div class="approval-card pending"><div class="agent-head"><div>' +
    '<div class="strong">' + esc(d.decision_id + ' — ' + d.question) + '</div>' +
    '<div class="muted">' + esc(d.recommendation ? 'Recommendation: ' + d.recommendation : 'No recommendation recorded') + '</div>' +
    '<div class="feed-meta"><span>' + esc(d.impact) + '</span><span>before ' + esc(d.required_before_stage) + '</span><span>' + esc((item.run.runId || '').slice(-16)) + '</span></div>' +
    '</div>' + pill('pending', 'pending') + '</div>' +
    '<div class="approval-actions">' +
      '<button class="btn primary" data-id="' + esc(d.decision_id) + '" data-runid="' + esc(item.run.runId || '') + '" data-status="resolved" onclick="envDecideFromButton(this)">Resolve</button>' +
      '<button class="btn" data-id="' + esc(d.decision_id) + '" data-runid="' + esc(item.run.runId || '') + '" data-status="waived" onclick="envDecideFromButton(this)">Waive</button>' +
    '</div></div>';
}

function renderEnvironment(s) {
  var environment = s.environment || {};
  var env = environment.env || { exists: false, gitignored: false, keys: [] };
  var approvals = environment.envApprovals || [];

  setHTML('env-gitignore-banner', envGitignoreBannerHtml(env));
  setHTML('env-report-body', envReportHtml(environment.report));
  setHTML('env-integrations-body', envIntegrationsHtml(environment));

  setText('env-keys-count', env.keys.length + ' key(s)');
  setHTML('env-keys-table', env.keys.map(function(entry) { return envKeyRowHtml(entry, approvals); }).join('') ||
    '<tr><td colspan="5">' + emptyHtml('No keys in .env', 'Use "Set a new key" — every write goes through a manager approval.') + '</td></tr>');

  var pending = environment.pendingEnvApprovals || [];
  setText('env-approvals-count', pending.length + ' pending');
  setHTML('env-approvals-list', approvals.map(envPendingApprovalHtml).join('') ||
    emptyHtml('No env-write approvals', 'Requesting a key write creates a one-shot approval here and on the Approvals page.'));

  var decisionRuns = (s.decisions && s.decisions.runs) || [];
  var pendingDecisions = [];
  decisionRuns.forEach(function(run) {
    (run.decisions || []).forEach(function(decision) {
      if (decision.status === 'pending') pendingDecisions.push({ run: run, decision: decision });
    });
  });
  setText('env-decisions-count', pendingDecisions.length + ' pending');
  setHTML('env-decisions-list', pendingDecisions.slice(0, 40).map(envDecisionRowHtml).join('') ||
    emptyHtml('No pending decisions', 'Environment setup questions (issue #237) land in the Decision Queue and can be resolved or waived here.'));
}

registerPage('environment', {
  errLabel: 'environment',
  sub: 'Environment report, integrations, notification channels, and approval-gated .env writes. Values never appear here.',
  unscoped: true,
  render: renderEnvironment
});
`;
