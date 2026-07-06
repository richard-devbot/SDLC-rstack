// owner: RStack developed by Richardson Gunde
//
// Client bundle assembler + core runtime for the Business Hub dashboard.
// The core owns cross-page state (snapshot, scope, freshness), the nav
// router, transport (WS + REST fallback) and bootstrap. Page render logic
// lives in ui/pages/*.js modules that self-register with the page registry
// (ui/lib.js); shared helpers in ui/lib.js; the run drawer in ui/drawer.js.
// Everything is plain JS concatenated into a single <script> at serve time
// — zero dependencies, no build step, no framework.

import { libScript } from './lib.js';
import { drawerScript } from './drawer.js';
import { commandCenterScript } from './pages/command-center.js';
import { businessFlexScript } from './pages/business-flex.js';
import { studioScript } from './pages/studio.js';
import { workflowMapScript } from './pages/workflow-map.js';
import { projectsRunsScript } from './pages/projects-runs.js';
import { runAnalyticsScript } from './pages/run-analytics.js';
import { runReportScript } from './pages/run-report.js';
import { agentWorkScript } from './pages/agent-work.js';
import { approvalsScript } from './pages/approvals.js';
import { decisionsScript } from './pages/decisions.js';
import { releaseReadinessScript } from './pages/release-readiness.js';
import { securityScript } from './pages/security.js';
import { complianceScript } from './pages/compliance.js';
import { costBudgetScript } from './pages/cost-budget.js';
import { traceabilityScript } from './pages/traceability.js';

export function clientScript(port) {
  return [
    libScript,
    drawerScript,
    commandCenterScript,
    businessFlexScript,
    studioScript,
    workflowMapScript,
    projectsRunsScript,
    runAnalyticsScript,
    runReportScript,
    agentWorkScript,
    approvalsScript,
    decisionsScript,
    releaseReadinessScript,
    securityScript,
    complianceScript,
    costBudgetScript,
    traceabilityScript,
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
  setBadge('badge-approvals', pending.length);
  setBadge('badge-alerts', alerts.length);
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

// ── page: team ────────────────────────────────────────────────
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

registerPage('team', {
  errLabel: 'team',
  sub: 'Who is live and working right now, the people behind every run, approval and guidance, and the manager project rollup.',
  render: renderTeam
});

// ── page: live-feed ────────────────────────────────────────────────
function renderLiveFeed(s) {
  var feed = s.feed || [];
  setText('live-feed-count', feed.length + ' events');
  setHTML('live-feed-list', feed.length ? feed.map(feedRowHtml).join('') : emptyHtml('No events yet', 'Live event data appears here.'));
}

registerPage('live-feed', {
  errLabel: 'live feed',
  sub: 'Real-time event stream from events.jsonl plus live WebSocket refreshes.',
  render: renderLiveFeed
});

// ── page: alerts-guardrails ────────────────────────────────────────────────
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

function alertHtml(alert) {
  return '<div class="alert-card ' + esc(alert.level || 'info') + '"><div class="agent-head"><div><div class="strong">' + esc(alert.title || alert.type || 'Alert') + '</div><div class="muted">' + esc(alert.detail || '') + '</div><div class="feed-meta"><span>' + esc(alert.type || '') + '</span><span>' + esc(alert.runId || '') + '</span></div></div>' + pill(alert.level || 'info') + '</div></div>';
}

registerPage('alerts-guardrails', {
  errLabel: 'alerts',
  sub: 'Threshold alerts, blocked gates, guardrails, stalled work and spend risks.',
  unscoped: true,
  render: renderAlertsGuardrails
});

// ── page: team-layers ────────────────────────────────────────────────
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

registerPage('team-layers', {
  errLabel: 'team layers',
  sub: 'Stack layers and framework health across harness, tracker, alerts, hooks, memory and observers.',
  render: renderTeamLayers
});

// ── page: diagnostics ────────────────────────────────────────────────
function renderDiagnostics(s) {
  var d = s.diagnostics || {};
  var rows = [
    ['Runs', d.runCount || 0],
    ['Tasks', d.taskCount || 0],
    ['Events', d.eventCount || 0],
    ['Evidence records', d.evidenceCount || 0],
    ['Missing builder contracts', d.missingBuilderCount || 0],
    ['Missing validation contracts', d.missingValidationCount || 0],
    ['Data integrity errors', d.integrityErrorCount || 0]
  ];
  setHTML('diagnostics-health', rows.map(function(row) {
    return '<div class="feed-row"><div class="feed-icon info">i</div><div><div class="feed-summary">' + esc(row[0]) + '</div></div><div class="feed-ts">' + esc(row[1]) + '</div></div>';
  }).join(''));
  var integrity = d.integrity || [];
  var configIssues = d.configIssues || [];
  var problems = integrity.map(function(issue) {
    return '<div class="feed-row"><div class="feed-icon warn">!</div><div><div class="feed-summary">' + esc(issue.file) + '</div><div class="feed-meta"><span>' + esc(issue.runId || '') + '</span><span>' + esc(issue.error) + '</span></div></div></div>';
  }).concat(configIssues.map(function(issue) {
    return '<div class="feed-row"><div class="feed-icon warn">!</div><div><div class="feed-summary">' + esc(issue.file) + '</div><div class="feed-meta"><span>' + esc(issue.field || 'config') + '</span><span>' + esc(issue.problem) + '</span></div></div></div>';
  }));
  setHTML('diagnostics-integrity', problems.join('') || emptyHtml('No data integrity or config problems', 'Damaged run files and invalid .rstack config values appear here.'));
  setHTML('diagnostics-roots', (d.sourceRoots || s.sourceRoots || []).map(function(root) {
    return '<div class="project-card"><div class="strong">' + esc(shortName(root)) + '</div><div class="project-path mono">' + esc(root) + '</div></div>';
  }).join('') || emptyHtml('No source roots', ''));
}

registerPage('diagnostics', {
  errLabel: 'diagnostics',
  sub: 'Source roots, missing builder contracts, validation coverage and raw .rstack data health.',
  unscoped: true,
  render: renderDiagnostics
});

updateFreshness();
// Heartbeat: re-evaluate freshness every second so the chip ages from "live"
// to "stale"/"disconnected" on its own, even when no new snapshot arrives.
FRESHNESS_TIMER = setInterval(updateFreshness, 1000);
fetchState();
connectWS();
`;
}
