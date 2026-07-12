// owner: RStack developed by Richardson Gunde
//
// Operations Center page module (#284) — renders into #page-operations-center.
// Plain client JS concatenated into the served bundle by ui/client.js;
// self-registers with the page registry (ui/lib.js).
//
// Renders the SERVER-OWNED s.operations projection only — the page never
// re-derives health. The one exception, by design, is Transport (section 1):
// WS-vs-poll mode and snapshot age are the BROWSER's truth, so that card
// reuses the exact WS_CONNECTED / LAST_SNAPSHOT_AT / classifyFreshness state
// the topbar chip already runs on — one freshness formula, two renderings.

export const operationsScript = `
// ── page: operations-center ──────────────────────────────────────────
function opsStatusPill(status) {
  var cls = status === 'ok' ? 'pass' : status === 'warn' ? 'warn' : status === 'blocked' ? 'fail' : 'idle';
  var label = status === 'ok' ? 'healthy' : status === 'unknown' ? 'unknown — no producer data' : status;
  return pill(cls, label);
}

function opsUnavailable(sectionName) {
  return '<div class="muted">' + esc(sectionName) + ' has no producer data in this scope. Unknown is not healthy — start or scope a run to evaluate it.</div>';
}

function renderOpsTransport(s) {
  var kind = typeof classifyFreshness === 'function'
    ? classifyFreshness({ hasData: Boolean(s && s.ts), now: Date.now(), lastSnapshotAt: (typeof LAST_SNAPSHOT_AT !== 'undefined' ? LAST_SNAPSHOT_AT : 0), wsConnected: (typeof WS_CONNECTED !== 'undefined' ? WS_CONNECTED : false) })
    : 'live';
  var mode = (typeof WS_CONNECTED !== 'undefined' && WS_CONNECTED) ? 'WebSocket push' : 'REST poll fallback';
  var generated = s.operations && s.operations.snapshot ? s.operations.snapshot.generatedAt : s.ts;
  var warn = kind === 'stale' || kind === 'reconnecting' || kind === 'disconnected';
  setHTML('ops-transport-body',
    '<span class="pill ' + (kind === 'live' ? 'pass' : kind === 'disconnected' ? 'fail' : 'warn') + '">' + esc(kind) + '</span>' +
    '<span class="ops-transport-mode">' + esc(mode) + '</span>' +
    '<span class="muted">server snapshot: ' + esc(generated ? new Date(generated).toLocaleString() : 'unknown') + '</span>' +
    (warn ? '<div class="ops-stale-banner"><strong>Showing last-known data.</strong> The values below were true as of the stamp above — treat anything time-sensitive as possibly behind.</div>' : ''));
}

function renderOpsHealth(ops) {
  var health = ops.sections.health;
  setHTML('ops-health-note', opsStatusPill(health.status));
  if (health.availability !== 'available') { setHTML('ops-health', opsUnavailable('Actionable health')); return; }
  var rows = (health.top || []).map(function(item) {
    return '<div class="feed-row"><div class="feed-icon ' + (item.blocking ? 'fail' : 'warn') + '">' + (item.blocking ? '×' : '!') + '</div>' +
      '<div><div class="feed-summary">' + esc(item.title) + '</div>' +
      '<div class="feed-meta"><span>' + esc(item.severity || '') + '</span></div></div></div>';
  }).join('');
  setHTML('ops-health',
    '<div class="stat-chips"><div class="stat-chip"><span class="stat-n">' + health.open + '</span><span class="stat-l">open actions</span></div>' +
    '<div class="stat-chip"><span class="stat-n">' + health.blocking + '</span><span class="stat-l">blocking</span></div></div>' +
    (rows || emptyHtml('Nothing needs attention', 'The Action Inbox has no open items in this scope.')) +
    '<button class="tb-chip" style="margin-top:10px" data-page="action-inbox" onclick="showPageFromChip(this)">Open Action Inbox</button>');
}

function renderOpsIntegrations(ops) {
  var section = ops.sections.integrations;
  setHTML('ops-integrations-note', opsStatusPill(section.status));
  if (section.availability !== 'available' && !section.configIssues) { setHTML('ops-integrations', opsUnavailable('Integrations')); return; }
  setHTML('ops-integrations',
    '<div class="stack-list">' +
    '<div class="feed-row"><div class="feed-icon ' + (section.hasEnvironmentReport ? 'info' : 'warn') + '">' + (section.hasEnvironmentReport ? 'i' : '?') + '</div><div><div class="feed-summary">Environment report ' + (section.hasEnvironmentReport ? 'present' : 'missing') + '</div></div></div>' +
    '<div class="feed-row"><div class="feed-icon ' + (section.hasIntegrationsConfig ? 'info' : 'warn') + '">' + (section.hasIntegrationsConfig ? 'i' : '?') + '</div><div><div class="feed-summary">Integrations config ' + (section.hasIntegrationsConfig ? 'present' : 'missing') + '</div></div></div>' +
    (section.setupNeeds ? '<div class="feed-row"><div class="feed-icon warn">!</div><div><div class="feed-summary">' + section.setupNeeds + ' setup need(s) raised by the environment scan</div></div></div>' : '') +
    (section.configIssues ? '<div class="feed-row"><div class="feed-icon warn">!</div><div><div class="feed-summary">' + section.configIssues + ' config validation issue(s)</div></div></div>' : '') +
    '</div>' +
    '<button class="tb-chip" style="margin-top:10px" data-page="environment" onclick="showPageFromChip(this)">Open Environment</button>');
}

function renderOpsRecovery(ops) {
  var section = ops.sections.recovery;
  setHTML('ops-recovery-note', opsStatusPill(section.status));
  if (section.availability !== 'available') { setHTML('ops-recovery', opsUnavailable('Recovery')); return; }
  setHTML('ops-recovery', (section.runs || []).map(function(run) {
    var chips = run.restorable.map(function(id) { return '<span class="pill pass" title="disk-verified restore point">' + esc(id) + ' restorable</span>'; })
      .concat(run.corrupt.map(function(id) { return '<span class="pill fail" title="checkpoint failed deep verification">' + esc(id) + ' CORRUPT</span>'; })).join(' ');
    var retry = run.retries.exhausted || run.retries.human_required
      ? '<div class="feed-meta"><span>' + run.retries.exhausted + ' retry budget(s) exhausted</span><span>' + run.retries.human_required + ' awaiting human context</span></div>'
      : '';
    return '<div class="feed-row"><div class="feed-icon info">↺</div><div>' +
      '<div class="feed-summary mono">' + esc((run.runId || '').slice(-32)) + '</div>' +
      '<div style="margin-top:4px">' + (chips || '<span class="muted">no restore points</span>') + '</div>' + retry +
      '<div class="feed-meta"><span class="mono">' + esc(run.source) + '</span></div>' +
      '</div></div>';
  }).join('') || emptyHtml('No recovery state yet', 'Restore points and retry budgets appear as critical stages run.'));
}

function renderOpsContext(ops) {
  var section = ops.sections.contextMemory;
  setHTML('ops-context-note', opsStatusPill(section.status));
  if (section.availability !== 'available') { setHTML('ops-context', opsUnavailable('Context & memory health')); return; }
  var sources = Object.keys(section.bySource || {}).map(function(source) {
    return '<span class="pill warn">' + esc(source) + ' × ' + section.bySource[source] + '</span>';
  }).join(' ');
  setHTML('ops-context',
    '<div class="stat-chips">' +
    '<div class="stat-chip"><span class="stat-n">' + section.contextPressureWarnings + '</span><span class="stat-l">context pressure warnings</span></div>' +
    '<div class="stat-chip"><span class="stat-n">' + section.memoryWritesSkipped + '</span><span class="stat-l">memory writes skipped</span></div>' +
    '<div class="stat-chip"><span class="stat-n">' + section.metricsDriftEvents + '</span><span class="stat-l">metrics drift events</span></div>' +
    '</div>' + (sources ? '<div style="margin-top:8px">' + sources + '</div>' : ''));
}

function renderOpsAgents(ops) {
  var section = ops.sections.agents;
  setHTML('ops-agents-note', opsStatusPill(section.status));
  setHTML('ops-agents', (section.items || []).map(function(person) {
    return '<div class="feed-row"><div class="feed-icon info">@</div><div><div class="feed-summary">' + esc(person.agent || person.name || 'agent') + '</div>' +
      '<div class="feed-meta"><span>' + esc(person.status || '') + '</span><span>' + esc((person.runId || '').slice(-16)) + '</span></div></div></div>';
  }).join('') || emptyHtml('No agents active', 'Agent presence appears while runs execute.'));
}

function renderOperationsCenter(s) {
  var ops = s.operations;
  renderOpsTransport(s);
  if (!ops) {
    setHTML('ops-health', opsUnavailable('Operations'));
    return;
  }
  renderOpsHealth(ops);
  renderOpsIntegrations(ops);
  renderOpsRecovery(ops);
  renderOpsContext(ops);
  renderOpsAgents(ops);
  var feed = ops.sections.feed;
  setHTML('ops-feed-note', feed.availability === 'available' ? feed.recent + ' recent event(s)' : 'unavailable');
  setHTML('ops-feed', '<div class="muted">Raw activity is secondary detail — plain-language health lives in the sections above.</div>' +
    '<button class="tb-chip" style="margin-top:10px" data-page="live-feed" onclick="showPageFromChip(this)">Open Live Feed</button>');
}

registerPage('operations-center', {
  errLabel: 'operations',
  sub: 'Transport freshness, actionable health, integrations, recovery, context & memory, agents — one operational truth surface.',
  unscoped: false,
  render: renderOperationsCenter
});
`;
