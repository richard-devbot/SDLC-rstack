// owner: RStack developed by Richardson Gunde
//
// Client bundle assembler + core runtime for the Business Hub dashboard.
// The core owns cross-page state (snapshot, scope, freshness), the nav
// router, transport (WS + REST fallback) and bootstrap. Page render logic
// lives in ui/pages/*.js modules that self-register with the page registry
// (ui/lib.js); shared helpers in ui/lib.js; the run drawer in ui/drawer.js.
// Everything is plain JS concatenated into a single <script> at serve time
// — zero dependencies, no build step, no framework.

import { stageMetaScript } from './stage-meta.js';
import { libScript } from './lib.js';
import { drawerScript } from './drawer.js';
import { pages } from './pages/index.js';
import { navigationScript } from './navigation.js';
import { commandCenterScript } from './pages/command-center.js';
import { businessFlexScript } from './pages/business-flex.js';
import { studioScript } from './pages/studio.js';
import { workflowMapScript } from './pages/workflow-map.js';
import { projectsRunsScript } from './pages/projects-runs.js';
import { runWorkspaceScript } from './pages/run-workspace.js';
import { runAnalyticsScript } from './pages/run-analytics.js';
import { runReportScript } from './pages/run-report.js';
import { teamPresenceScript } from './pages/team-presence.js';
import { agentWorkScript } from './pages/agent-work.js';
import { liveFeedScript } from './pages/live-feed.js';
import { approvalsScript } from './pages/approvals.js';
import { decisionsScript } from './pages/decisions.js';
import { releaseReadinessScript } from './pages/release-readiness.js';
import { securityScript } from './pages/security.js';
import { complianceScript } from './pages/compliance.js';
import { costBudgetScript } from './pages/cost-budget.js';
import { alertsGuardrailsScript } from './pages/alerts-guardrails.js';
import { traceabilityScript } from './pages/traceability.js';
import { teamLayersScript } from './pages/team-layers.js';
import { environmentScript } from './pages/environment.js';
import { diagnosticsScript } from './pages/diagnostics.js';

export function clientScript(port) {
  return [
    stageMetaScript,
    libScript,
    drawerScript,
    navigationScript,
    commandCenterScript,
    businessFlexScript,
    studioScript,
    workflowMapScript,
    projectsRunsScript,
    runWorkspaceScript,
    runAnalyticsScript,
    runReportScript,
    teamPresenceScript,
    agentWorkScript,
    liveFeedScript,
    approvalsScript,
    decisionsScript,
    releaseReadinessScript,
    securityScript,
    complianceScript,
    costBudgetScript,
    alertsGuardrailsScript,
    traceabilityScript,
    teamLayersScript,
    environmentScript,
    diagnosticsScript,
    coreScript(port),
  ].join('\n');
}

// Registration order = bundle order above = render order in applyState.
function coreScript(port) {
  return `
// ── core: state, scope, router, transport ─────────────────────────
var STATE = null;
var GLOBAL_STATE = null;
var SCOPE_CATALOG = { projects: [], runs: [] };
var SCOPE_REQUEST_SEQUENCE = 0;
var STATE_ETAGS = {};
var PORT = ${port};
var WS_CONNECTED = false;
var reconnectTimer = null;
var ws = null;


// Data-freshness tracking (issue #87): never let stale data look live.
var LAST_SERVER_TS = null;   // ISO ts carried by the last snapshot
var LAST_SNAPSHOT_AT = 0;    // client clock (ms) when the last snapshot landed
var POLL_TIMER = null;       // REST fallback poll handle (active while WS down)
var FRESHNESS_TIMER = null;  // 1s heartbeat that ages the freshness chip
var LAST_CONN_KIND = null;   // last announced connection kind (debounces aria)

// Topbar titles come from the same nav registry that renders the sidebar
// (ui/pages/index.js) — one list, no hand-mirrored copy.
var PAGE_LABELS = ${JSON.stringify(Object.fromEntries(pages.map(([id, , label]) => [id, label])))};

function resetDashboardScroll() {
  var content = document.getElementById('content');
  if (content) content.scrollTop = 0;
  if (document.scrollingElement) document.scrollingElement.scrollTop = 0;
  if (typeof window.scrollTo === 'function') window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
}

// Keyboard access: Escape closes the run drawer; Enter/Space activates
// row-style clickables (run tables, presence cards, studio workstations).
// Rows are re-rendered wholesale on every snapshot, so activation is
// delegated here instead of wiring per-element listeners.
document.addEventListener('keydown', function(event) {
  if (event.key === 'Escape') {
    if (mobileNavigationIsOpen()) {
      closeMobileNavigation();
      return;
    }
    var panel = document.getElementById('drawer-panel');
    if (panel && panel.classList.contains('open')) closeDrawer();
    return;
  }
  if (event.key !== 'Enter' && event.key !== ' ') return;
  var target = event.target;
  if (!target || typeof target.matches !== 'function') return;
  if (target.matches('.clickable[tabindex], .workstation[tabindex]')) {
    event.preventDefault();
    target.click();
  }
});

function applyState(state, opts) {
  STATE = state;
  // Only a genuine WS/REST snapshot advances the freshness clock. UI-only
  // rerenders (scope changes, studio inspector) reuse STATE and must NOT make
  // old data look freshly updated — that would defeat the staleness signal.
  if (opts && opts.fromSnapshot) {
    LAST_SERVER_TS = (state && state.ts) ? state.ts : LAST_SERVER_TS;
    LAST_SNAPSHOT_AT = Date.now();
  }
  try { updateFreshness(); } catch (err) { /* freshness chip is best-effort */ }
  try { notifyNewGates(state); } catch (err) { /* notifications are best-effort */ }
  try { renderScopeSelectors(state); } catch (err) { showErr('scope: ' + err.message); }
  try { renderFrame(state); } catch (err) { showErr('frame: ' + err.message); }
  PAGE_RENDERERS.forEach(function(page) {
    try {
      // Every snapshot is already completely scoped by the server. Pages that
      // were historically marked unscoped no longer bypass project/run trust.
      page.render(state);
    } catch (err) {
      showErr(page.errLabel + ': ' + err.message);
    }
  });
}

// ── Server-owned project → run scope (issue #276) ───────────────────────────
var SCOPE = {
  project: localStorage.getItem('rstack-scope-project') || '',
  run: localStorage.getItem('rstack-scope-run') || '',
};
var legacyRunId = '';
// Deep links from the previous bare-run-id contract remain compatible. Once
// the global catalog arrives, the id is migrated to its opaque run scope key.
(function initScopeFromRoute() {
  var route = readDashboardRoute();
  if (route.run) {
    legacyRunId = route.run;
    SCOPE.run = '';
    SCOPE.project = '';
  }
})();

function persistScope() {
  localStorage.setItem('rstack-scope-project', SCOPE.project);
  localStorage.setItem('rstack-scope-run', SCOPE.run);
}

function setScopeProject(value) {
  SCOPE.project = value;
  SCOPE.run = '';
  legacyRunId = '';
  persistScope();
  writeDashboardRoute(ACTIVE_PAGE, '', 'replace');
  requestScopedState();
}

function setScopeRun(value) {
  SCOPE.run = value;
  legacyRunId = '';
  var selected = (SCOPE_CATALOG.runs || []).find(function(run) { return run.key === value; });
  if (selected) SCOPE.project = selected.projectId;
  persistScope();
  writeDashboardRoute(ACTIVE_PAGE, value, 'replace');
  requestScopedState();
}

function scopeUrl() {
  if (SCOPE.run) return '/api/state?run=' + encodeURIComponent(SCOPE.run);
  if (SCOPE.project) return '/api/state?project=' + encodeURIComponent(SCOPE.project);
  return '/api/state';
}

function announceScope(message) {
  var live = document.getElementById('scope-live');
  if (live) live.textContent = message;
}

function clearScope(reason) {
  SCOPE.project = '';
  SCOPE.run = '';
  legacyRunId = '';
  persistScope();
  writeDashboardRoute(ACTIVE_PAGE, '', 'replace');
  announceScope(reason || 'Scope reset to All projects.');
}

function resolveSavedScope(catalog) {
  if (!legacyRunId) return;
  var selected = (catalog.runs || []).find(function(run) {
    return run.key === legacyRunId || run.runId === legacyRunId;
  });
  if (selected) {
    SCOPE.run = selected.key;
    SCOPE.project = selected.projectId;
    persistScope();
  } else {
    clearScope('The linked run is no longer available. Scope reset to All projects.');
  }
  legacyRunId = '';
}

function renderScopeSelectors(s) {
  var catalog = s.scopeCatalog || SCOPE_CATALOG || { projects: [], runs: [] };
  var projectSelect = document.getElementById('scope-project');
  var runSelect = document.getElementById('scope-run');
  if (!projectSelect || !runSelect) return;
  resolveSavedScope(catalog);
  projectSelect.innerHTML = '<option value="">All projects</option>' + (catalog.projects || []).map(function(project) {
    var worktrees = (project.roots || []).filter(function(root) { return root.isWorktree; });
    var suffix = worktrees.length === 1 ? ' · worktree ' + worktrees[0].worktreeName
      : worktrees.length > 1 ? ' · ' + worktrees.length + ' worktrees' : '';
    return '<option value="' + esc(project.id) + '"' + (project.id === SCOPE.project ? ' selected' : '') + '>' +
      esc(project.name + suffix) + '</option>';
  }).join('');
  var scopedRuns = SCOPE.project
    ? (catalog.runs || []).filter(function(run) { return run.projectId === SCOPE.project; })
    : (catalog.runs || []);
  runSelect.innerHTML = '<option value="">All runs</option>' + scopedRuns.map(function(run) {
    var context = run.worktreeName ? ' · ' + run.worktreeName : '';
    var label = String(run.goal || run.runId).slice(0, 54) + context;
    return '<option value="' + esc(run.key) + '"' + (run.key === SCOPE.run ? ' selected' : '') + '>' +
      esc(label) + '</option>';
  }).join('');
  var context = 'All project evidence';
  var run = (catalog.runs || []).find(function(entry) { return entry.key === SCOPE.run; });
  var project = (catalog.projects || []).find(function(entry) { return entry.id === SCOPE.project; });
  if (run) {
    context = run.projectName + (run.worktreeName ? ' / ' + run.worktreeName : '') + ' / ' + run.runId;
  } else if (project) {
    context = project.name + ' / all runs';
  } else if ((catalog.projects || []).length) {
    context = catalog.projects.length + ' projects / all runs';
  }
  setText('scope-context', context);
}

// ── Browser + in-app notifications for new governed signals ────────────────
var SEEN_GATES = null;
var SIGNAL_TOAST_TIMER = null;

function announceOperationalSignals(counts) {
  var region = document.getElementById('signal-toast-region');
  if (!region) return;
  var parts = [];
  if (counts.guardrails) parts.push(counts.guardrails + ' guardrail block' + (counts.guardrails === 1 ? '' : 's'));
  if (counts.approvals) parts.push(counts.approvals + ' approval' + (counts.approvals === 1 ? '' : 's'));
  if (counts.alerts) parts.push(counts.alerts + ' alert' + (counts.alerts === 1 ? '' : 's'));
  if (!parts.length) return;
  var tone = counts.guardrails ? 'danger' : counts.approvals ? 'warn' : 'info';
  var title = counts.guardrails ? 'Guardrail stopped unsafe progress'
    : counts.approvals ? 'A manager decision is needed'
    : 'A new operational alert arrived';
  var detail = parts.join(' · ') + ' added since the last live snapshot.';
  region.className = 'signal-toast show ' + tone;
  region.innerHTML = '<div class="signal-toast-mark" aria-hidden="true">' + (tone === 'danger' ? '!' : tone === 'warn' ? '?' : 'i') + '</div>' +
    '<div><div class="signal-toast-title">' + esc(title) + '</div><div class="signal-toast-detail">' + esc(detail) + '</div></div>';
  clearTimeout(SIGNAL_TOAST_TIMER);
  SIGNAL_TOAST_TIMER = setTimeout(function() {
    region.className = 'signal-toast';
  }, 6000);
}

function notifyNewGates(s) {
  var pending = (s.pendingApprovals || []).map(function(item) { return 'p:' + (item.id || item.artifact); });
  var blocked = (s.blockedGates || []).map(function(gate) { return 'b:' + (gate.id || gate.runId); });
  var alerts = (s.alerts || []).map(function(alert) {
    return 'a:' + (alert.id || [alert.type, alert.runId, alert.ts].filter(Boolean).join(':'));
  });
  var current = pending.concat(blocked, alerts);
  if (SEEN_GATES === null) { SEEN_GATES = current; return; } // first snapshot: baseline only
  var freshApprovals = pending.filter(function(key) { return SEEN_GATES.indexOf(key) === -1; });
  var freshGuardrails = blocked.filter(function(key) { return SEEN_GATES.indexOf(key) === -1; });
  var freshAlerts = alerts.filter(function(key) { return SEEN_GATES.indexOf(key) === -1; });
  var fresh = freshApprovals.concat(freshGuardrails, freshAlerts);
  SEEN_GATES = current;
  if (!fresh.length) return;
  announceOperationalSignals({
    approvals: freshApprovals.length,
    guardrails: freshGuardrails.length,
    alerts: freshAlerts.length,
  });
  if (typeof Notification === 'undefined') return;
  if (Notification.permission === 'default') { Notification.requestPermission(); return; }
  if (Notification.permission !== 'granted') return;
  try {
    new Notification('RStack: attention needed', {
      body: fresh.length + ' new governed signal' + (fresh.length === 1 ? '' : 's') + ' waiting for review.',
      tag: 'rstack-governed-signals',
    });
  } catch (err) { /* best-effort */ }
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
  setBadge('badge-approvals', pending.length, 'pending approvals');
  setBadge('badge-alerts', alerts.length, 'active alerts');
  setText('alert-count', alerts.length + ' alerts');
  setText('approval-count', pending.length + ' pending');
  setClass('btn-alerts', 'tb-chip' + (alerts.length ? ' danger' : ''));
  setClass('btn-approvals', 'tb-chip' + (pending.length ? ' warn' : ''));
  PAGE_RENDERERS.forEach(function(page) {
    setText(page.id + '-sub', page.sub);
    var updated = document.getElementById(page.id + '-updated');
    if (updated) {
      updated.innerHTML = s.ts ? 'Updated ' + timeHtml(s.ts) : '';
    }
  });
}

function acceptServerState(state, opts) {
  if (state.scopeCatalog) SCOPE_CATALOG = state.scopeCatalog;
  if (state.scope && state.scope.reset) {
    clearScope(state.scope.reason || 'Scope reset to All projects.');
  }
  applyState(state, opts);
  return state;
}

function requestScopedState() {
  var requestSequence = ++SCOPE_REQUEST_SEQUENCE;
  var url = scopeUrl();
  // Conditional request: an unchanged snapshot returns 304, which still
  // confirms the data is current (refresh the freshness clock) without a
  // re-render. ETag stripping of server eval-time stamps lives server-side.
  var etag = STATE_ETAGS[url];
  var opts = etag ? { headers: { 'If-None-Match': etag } } : {};
  return authAwareFetch(url, opts)
    .then(function(response) {
      if (requestSequence !== SCOPE_REQUEST_SEQUENCE) return null;
      var nextEtag = response.headers.get('etag');
      if (nextEtag) STATE_ETAGS[url] = nextEtag;
      if (response.status === 304) {
        LAST_SNAPSHOT_AT = Date.now();
        updateFreshness();
        return null;
      }
      if (!response.ok) {
        // Never let an error body masquerade as a fresh snapshot.
        return response.json().catch(function() { return {}; }).then(function(body) {
          throw new Error(body.error || ('HTTP ' + response.status));
        });
      }
      return response.json().then(function(data) {
        if (requestSequence !== SCOPE_REQUEST_SEQUENCE) return null;
        return acceptServerState(data, { fromSnapshot: true });
      });
    })
    .catch(function(err) {
      // Don't claim freshness — let the heartbeat age the chip toward stale.
      updateFreshness();
      showErr('HTTP load failed: ' + err.message);
    });
}

function fetchState() {
  return requestScopedState();
}

function handleGlobalSnapshot(state) {
  GLOBAL_STATE = state;
  if (state.scopeCatalog) SCOPE_CATALOG = state.scopeCatalog;
  resolveSavedScope(SCOPE_CATALOG);
  if (SCOPE.project || SCOPE.run) return requestScopedState();
  SCOPE_REQUEST_SEQUENCE += 1; // invalidate any older scoped REST response
  return acceptServerState(state, { fromSnapshot: true });
}

function connectWS() {
  try {
    // Browsers cannot set custom headers on WebSocket upgrades, so the read
    // token travels as a query param when configured.
    var wsProto = location.protocol === 'https:' ? 'wss://' : 'ws://';
    var wsToken = readToken();
    ws = new WebSocket(wsProto + 'localhost:' + PORT + (wsToken ? '/?token=' + encodeURIComponent(wsToken) : ''));
  } catch (err) {
    WS_CONNECTED = false;
    startPolling();
    updateFreshness();
    return;
  }
  ws.onopen = function() {
    WS_CONNECTED = true;
    clearTimeout(reconnectTimer);
    stopPolling();
    updateFreshness();
  };
  ws.onmessage = function(event) {
    try {
      handleGlobalSnapshot(JSON.parse(event.data));
    } catch (err) {
      showErr('WS render: ' + err.message);
    }
  };
  ws.onclose = ws.onerror = function() {
    WS_CONNECTED = false;
    updateFreshness();
    startPolling();
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connectWS, 2500);
  };
}

// While the socket is down, keep data flowing with a 5s REST poll so the
// dashboard recovers on its own (and the chip can show "Reconnecting" with a
// live-as-of stamp rather than a frozen page).
function startPolling() {
  if (POLL_TIMER) return;
  POLL_TIMER = setInterval(function() { if (!WS_CONNECTED) fetchState(); }, 5000);
}

function stopPolling() {
  if (!POLL_TIMER) return;
  clearInterval(POLL_TIMER);
  POLL_TIMER = null;
}

function shortClock(value) {
  if (!value) return null;
  var d = new Date(value);
  if (isNaN(d.getTime())) return String(value).slice(11, 19) || null;
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}

// Single source of truth for the topbar connection chip. Derives the kind from
// socket state + snapshot age, paints the dot/label, and announces transitions
// to assistive tech via the aria-live region.
function updateFreshness() {
  var kind = classifyFreshness({
    now: Date.now(),
    lastSnapshotAt: LAST_SNAPSHOT_AT,
    wsConnected: WS_CONNECTED,
    hasData: LAST_SNAPSHOT_AT > 0,
  });
  var label = freshnessLabel(kind, shortClock(LAST_SERVER_TS));
  setText('status-text', label);
  var statusDot = document.getElementById('status-dot');
  var wsDot = document.getElementById('ws-dot');
  if (statusDot) statusDot.className = 'status-dot ' + freshnessDotClass(kind);
  if (wsDot) wsDot.className = kind === 'live' ? 'ws-dot ws-live' : 'ws-dot';
  if (kind !== LAST_CONN_KIND) {
    LAST_CONN_KIND = kind;
    var live = document.getElementById('conn-live');
    if (live) live.textContent = label;
  }
}

initDashboardNavigation();
updateFreshness();
// Heartbeat: re-evaluate freshness every second so the chip ages from "live"
// to "stale"/"disconnected" on its own, even when no new snapshot arrives.
FRESHNESS_TIMER = setInterval(updateFreshness, 1000);
fetchState();
connectWS();
`;
}
