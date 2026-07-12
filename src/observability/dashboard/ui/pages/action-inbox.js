// owner: RStack developed by Richardson Gunde

export const actionInboxScript = `
// ── page: action-inbox (#281) ─────────────────────────────────────
var ACTION_INBOX_FILTER = 'all';
var ACTION_INBOX_FILTERS = ['all', 'blocking', 'approvals', 'decisions', 'failures', 'resolved'];
var ACTION_CLOSED_STATUSES = ['approved', 'rejected', 'consumed', 'resolved', 'expired'];

function actionInboxIsResolved(action) {
  return ACTION_CLOSED_STATUSES.indexOf(action.status) >= 0;
}

function actionInboxMatches(action, filter) {
  if (filter === 'all') return !actionInboxIsResolved(action);
  if (filter === 'blocking') return action.blocking && !actionInboxIsResolved(action);
  if (filter === 'approvals') return action.type === 'approval';
  if (filter === 'decisions') return action.type === 'decision';
  if (filter === 'failures') return ['failure', 'alert', 'configuration', 'audit'].indexOf(action.type) >= 0;
  if (filter === 'resolved') return actionInboxIsResolved(action);
  return true;
}

function actionInboxSetFilter(filter) {
  if (ACTION_INBOX_FILTERS.indexOf(filter) < 0) filter = 'all';
  ACTION_INBOX_FILTER = filter;
  renderActionInbox(STATE || {});
}

function actionInboxFiltersHtml(actions) {
  return ACTION_INBOX_FILTERS.map(function(filter) {
    var count = actions.filter(function(action) { return actionInboxMatches(action, filter); }).length;
    var label = filter === 'all' ? 'Open' : filter.charAt(0).toUpperCase() + filter.slice(1);
    return '<button class="action-inbox-filter" type="button" aria-pressed="' + (filter === ACTION_INBOX_FILTER ? 'true' : 'false') +
      '" onclick="actionInboxSetFilter(\\'' + filter + '\\')"><span>' + esc(label) + '</span><b>' + count + '</b></button>';
  }).join('');
}

function actionInboxRoute(action) {
  if (action.type === 'approval') return { page: 'approvals', label: 'Review in Approvals' };
  if (action.type === 'decision') return { page: 'decisions', label: 'Review decision' };
  if (action.type === 'configuration') return { page: 'diagnostics', label: 'Open diagnostics' };
  if (action.type === 'alert') return { page: 'live-feed', label: 'Open Operations' };
  if (action.type === 'audit') return { page: 'approvals', label: 'Inspect audit rejection' };
  return { page: 'alerts-guardrails', label: 'Inspect failure' };
}

function actionInboxAge(createdAt) {
  if (!createdAt) return 'age unavailable';
  var timestamp = new Date(createdAt).getTime();
  if (!Number.isFinite(timestamp)) return 'age unavailable';
  var minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  if (minutes < 60) return minutes + 'm old';
  var hours = Math.floor(minutes / 60);
  if (hours < 48) return hours + 'h old';
  return Math.floor(hours / 24) + 'd old';
}

function actionInboxCardHtml(action) {
  var route = actionInboxRoute(action);
  var source = action.source || {};
  var unavailable = action.availability !== 'available';
  var allowedActions = Array.isArray(action.allowedActions) ? action.allowedActions : [];
  var scopes = [action.projectId || shortName(action.projectRoot), action.runId, action.stageId, action.taskId].filter(Boolean);
  return '<article class="action-card ' + esc(action.severity) + (actionInboxIsResolved(action) ? ' resolved' : '') + '">' +
    '<div class="action-card-main"><div><div class="action-card-badges">' + pill(action.blocking ? 'fail' : 'info', action.blocking ? 'blocking' : action.type) +
      pill(action.status, action.status) + pill(unavailable ? 'warn' : 'pass', action.availability) + '</div>' +
      '<h3>' + esc(action.title) + '</h3><p>' + esc(action.consequence) + '</p>' +
      '<div class="action-next"><span>Next step</span><strong>' + esc(action.nextStep) + '</strong></div>' +
      '<div class="feed-meta">' + scopes.map(function(scope) { return '<span>' + esc(scope) + '</span>'; }).join('') +
      '<span>' + esc(action.owner || 'owner unavailable') + '</span><span>' + esc(actionInboxAge(action.createdAt)) + '</span></div>' +
      '<div class="source-ref">' + esc(source.path || source.recordId || 'Source unavailable') + '</div>' +
      ((action.signals || []).length > 1 ? '<div class="action-signals">' + action.signals.length + ' source signals grouped · counted once</div>' : '') +
    '</div><div class="action-card-route"><button class="tb-chip" type="button" onclick="showPage(\\'' + esc(route.page) + '\\')">' + esc(route.label) + '</button>' +
      (allowedActions.length && !unavailable ? '<small>Server allows: ' + esc(allowedActions.join(', ')) + '</small>' : '<small>No mutation available here</small>') +
    '</div></div></article>';
}

function renderActionInbox(s) {
  var actions = s.actions || [];
  var visible = actions.filter(function(action) { return actionInboxMatches(action, ACTION_INBOX_FILTER); });
  var open = actions.filter(function(action) { return !actionInboxIsResolved(action); });
  var blocking = open.filter(function(action) { return action.blocking; });
  setText('action-inbox-open-count', String(open.length));
  setText('action-inbox-blocking-count', String(blocking.length));
  setText('action-inbox-source-count', String(actions.reduce(function(total, action) { return total + ((action.signals || []).length || 1); }, 0)));
  setHTML('action-inbox-filters', actionInboxFiltersHtml(actions));
  setText('action-inbox-result-count', visible.length + ' item' + (visible.length === 1 ? '' : 's'));
  setHTML('action-inbox-list', visible.map(actionInboxCardHtml).join('') || emptyHtml(
    ACTION_INBOX_FILTER === 'resolved' ? 'No resolved actions' : 'No actions in this view',
    ACTION_INBOX_FILTER === 'all' ? 'Approvals, decisions, failures, guardrails, diagnostics and audit rejections will appear from real scoped state.' : 'Choose another filter to inspect the rest of the queue.'
  ));
}

registerPage('action-inbox', {
  errLabel: 'action inbox',
  sub: 'One source-linked queue for approvals, decisions, guardrails, failures, retries, configuration problems, and audit-invalid records.',
  render: renderActionInbox
});
`;
