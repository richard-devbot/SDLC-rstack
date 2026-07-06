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
import { commandCenterScript } from './pages/command-center.js';
import { businessFlexScript } from './pages/business-flex.js';
import { studioScript } from './pages/studio.js';
import { workflowMapScript } from './pages/workflow-map.js';
import { projectsRunsScript } from './pages/projects-runs.js';
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
import { diagnosticsScript } from './pages/diagnostics.js';

export function clientScript(port) {
  return [
    stageMetaScript,
    libScript,
    drawerScript,
    commandCenterScript,
    businessFlexScript,
    studioScript,
    workflowMapScript,
    projectsRunsScript,
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
    diagnosticsScript,
    coreScript(port),
  ].join('\n');
}

// Registration order = bundle order above = render order in applyState.
function coreScript(port) {
  return `
// ── core: state, scope, router, transport ─────────────────────────
var STATE = null;
var PORT = ${port};
var WS_CONNECTED = false;
var reconnectTimer = null;
var ws = null;


// Data-freshness tracking (issue #87): never let stale data look live.
var LAST_SERVER_TS = null;   // ISO ts carried by the last snapshot
var LAST_SNAPSHOT_AT = 0;    // client clock (ms) when the last snapshot landed
var LAST_ETAG = null;        // ETag for conditional REST polling
var POLL_TIMER = null;       // REST fallback poll handle (active while WS down)
var FRESHNESS_TIMER = null;  // 1s heartbeat that ages the freshness chip
var LAST_CONN_KIND = null;   // last announced connection kind (debounces aria)

// Topbar titles come from the same nav registry that renders the sidebar
// (ui/pages/index.js) — one list, no hand-mirrored copy.
var PAGE_LABELS = ${JSON.stringify(Object.fromEntries(pages.map(([id, , label]) => [id, label])))};

document.querySelectorAll('.nav-link').forEach(function(btn) {
  btn.addEventListener('click', function() {
    showPage(btn.getAttribute('data-page'));
  });
});

function showPage(name) {
  document.querySelectorAll('.nav-link').forEach(function(btn) {
    var active = btn.getAttribute('data-page') === name;
    btn.classList.toggle('active', active);
    if (active) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  });
  document.querySelectorAll('.page').forEach(function(page) {
    page.classList.toggle('active', page.id === 'page-' + name);
  });
  setText('page-title', PAGE_LABELS[name] || name);
}

// Keyboard access: Escape closes the run drawer; Enter/Space activates
// row-style clickables (run tables, presence cards, studio workstations).
// Rows are re-rendered wholesale on every snapshot, so activation is
// delegated here instead of wiring per-element listeners.
document.addEventListener('keydown', function(event) {
  if (event.key === 'Escape') {
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
  var scoped = applyScope(state);
  try { renderFrame(state); } catch (err) { showErr('frame: ' + err.message); }
  PAGE_RENDERERS.forEach(function(page) {
    try {
      page.render(page.unscoped ? state : scoped);
    } catch (err) {
      showErr(page.errLabel + ': ' + err.message);
    }
  });
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
    setText(page.id + '-updated', s.ts ? 'Updated ' + fmtTime(s.ts) : '');
  });
}

function fetchState() {
  // Conditional request: an unchanged snapshot returns 304, which still
  // confirms the data is current (refresh the freshness clock) without a
  // re-render. ETag stripping of server eval-time stamps lives server-side.
  var opts = LAST_ETAG ? { headers: { 'If-None-Match': LAST_ETAG } } : {};
  return authAwareFetch('/api/state', opts)
    .then(function(response) {
      var etag = response.headers.get('etag');
      if (etag) LAST_ETAG = etag;
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
      return response.json().then(function(data) { applyState(data, { fromSnapshot: true }); return data; });
    })
    .catch(function(err) {
      // Don't claim freshness — let the heartbeat age the chip toward stale.
      updateFreshness();
      showErr('HTTP load failed: ' + err.message);
    });
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
      applyState(JSON.parse(event.data), { fromSnapshot: true });
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

updateFreshness();
// Heartbeat: re-evaluate freshness every second so the chip ages from "live"
// to "stale"/"disconnected" on its own, even when no new snapshot arrives.
FRESHNESS_TIMER = setInterval(updateFreshness, 1000);
fetchState();
connectWS();
`;
}
