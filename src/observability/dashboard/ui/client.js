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

// ── page: run-report ────────────────────────────────────────────────
// ── Stage report infographics (issue #60) — shared by Run Report + Studio 3D ─
var REPORT_CACHE = {};            // runId → { stages, deliverables }
var REPORT_RUN_ID = null;

var STAGE_CARD_META = {
  '00-environment': { icon: '🧰', title: 'Environment', persona: 'DevOps' },
  '01-transcript': { icon: '🎙', title: 'Transcript', persona: 'Business Analyst' },
  '02-requirements': { icon: '📋', title: 'Requirements', persona: 'Product Manager' },
  '03-documentation': { icon: '📝', title: 'Documentation', persona: 'Technical Writer' },
  '04-planning': { icon: '🗺', title: 'Planning', persona: 'Delivery Manager' },
  '05-jira': { icon: '🎫', title: 'Tickets', persona: 'Scrum Master' },
  '06-architecture': { icon: '🏛', title: 'Architecture', persona: 'Solution Architect' },
  '07-code': { icon: '⚙️', title: 'Code', persona: 'Senior Developer' },
  '08-testing': { icon: '🧪', title: 'Testing', persona: 'QA Engineer' },
  '09-deployment': { icon: '🚀', title: 'Deployment', persona: 'Release Engineer' },
  '10-summary': { icon: '📊', title: 'Summary', persona: 'Program Manager' },
  '11-feedback-loop': { icon: '🔄', title: 'Feedback Loop', persona: 'Quality Coach' },
  '12-security-threat-model': { icon: '🛡', title: 'Security', persona: 'Security Engineer' },
  '13-compliance-checker': { icon: '⚖️', title: 'Compliance', persona: 'Compliance Officer' },
  '14-cost-estimation': { icon: '💰', title: 'Cost', persona: 'FinOps Analyst' },
};
var STAGE_CARD_ORDER = Object.keys(STAGE_CARD_META);

function fetchRunReport(runId) {
  if (REPORT_CACHE[runId]) return Promise.resolve(REPORT_CACHE[runId]);
  return authAwareFetch('/api/run-report?run=' + encodeURIComponent(runId))
    .then(function(r) { return r.json(); })
    .then(function(data) { if (!data.error) REPORT_CACHE[runId] = data; return data; });
}

function svgDonut(segments) {
  // Arcs start collapsed (dashoffset = full) and fill in when animateReport
  // sets each arc's data-dashoffset → triggers the CSS transition.
  var total = segments.reduce(function(s, x) { return s + x.value; }, 0) || 1;
  var R = 34, C = 2 * Math.PI * R, off = 0;
  var arcs = segments.filter(function(s) { return s.value > 0; }).map(function(s) {
    var len = (s.value / total) * C;
    var seg = '<circle class="donut-arc" cx="44" cy="44" r="' + R + '" fill="none" stroke="' + s.color +
      '" stroke-width="12" stroke-dasharray="' + len.toFixed(2) + ' ' + (C - len).toFixed(2) +
      '" stroke-dashoffset="' + (len - off).toFixed(2) + '" data-dashoffset="' + (-off).toFixed(2) +
      '" transform="rotate(-90 44 44)"></circle>';
    off += len; return seg;
  }).join('');
  return '<svg class="donut" viewBox="0 0 88 88" width="88" height="88">' +
    '<circle cx="44" cy="44" r="' + R + '" fill="none" stroke="var(--soft)" stroke-width="12"></circle>' +
    arcs + '<text class="donut-center" x="44" y="49" text-anchor="middle">' + total + '</text></svg>';
}

function svgGauge(score, color) {
  var pct = Math.max(0, Math.min(100, Number(score) || 0));
  var R = 34, C = Math.PI * R;
  var fill = (pct / 100) * C;
  // Starts empty (dasharray 0) and fills to target via animateReport.
  return '<svg class="gauge" viewBox="0 0 88 52" width="120" height="70">' +
    '<path d="M10 46 A34 34 0 0 1 78 46" fill="none" stroke="var(--soft)" stroke-width="10" stroke-linecap="round"></path>' +
    '<path class="gauge-fill" d="M10 46 A34 34 0 0 1 78 46" fill="none" stroke="' + color + '" stroke-width="10" stroke-linecap="round" ' +
    'stroke-dasharray="0 ' + C.toFixed(2) + '" data-dash="' + fill.toFixed(2) + ' ' + (C - fill).toFixed(2) + '"></path>' +
    '<text class="gauge-center" x="44" y="44" text-anchor="middle">' + pct + '</text></svg>';
}

function statChips(items) {
  return '<div class="stat-chips">' + items.map(function(it) {
    return '<div class="stat-chip"><span class="stat-n" data-count="' + (it.n || 0) + '">' + (it.n || 0) + '</span><span class="stat-l">' + esc(it.l) + '</span></div>';
  }).join('') + '</div>';
}

function gateBadge(gate) {
  if (!gate) return '';
  var ready = gate.ready === true;
  var reason = gate.reason || (gate.blockers ? gate.blockers.join(', ') : '');
  return '<div class="gate ' + (ready ? 'ok' : 'blocked') + '">' +
    '<span class="gate-dot"></span>' + (ready ? 'Release gate: READY' : 'Release gate: BLOCKED') +
    (reason ? '<div class="gate-reason">' + esc(String(reason).slice(0, 160)) + '</div>' : '') + '</div>';
}

function miniList(title, arr, fmt) {
  if (!arr || !arr.length) return '';
  return '<div class="mini-list"><div class="mini-list-h">' + esc(title) + '</div>' +
    arr.slice(0, 5).map(function(x) { return '<div class="mini-list-i">' + esc((fmt ? fmt(x) : x)).slice(0, 120) + '</div>'; }).join('') + '</div>';
}

function scoreColor(score) {
  var s = Number(score) || 0;
  return s >= 80 ? '#16a34a' : s >= 50 ? '#d97706' : '#dc2626';
}

function stageBody(stageId, d) {
  if (!d) return '<div class="muted">No report produced for this stage.</div>';
  if (d._truncated) return '<div class="muted">Report too large to inline (' + Math.ceil(d._bytes / 1024) + ' KB).</div>';
  switch (stageId) {
    case '02-requirements':
      return statChips([
        { n: (d.functional || []).length, l: 'functional' },
        { n: (d.non_functional || []).length, l: 'non-functional' },
        { n: (d.user_stories || []).length, l: 'user stories' },
        { n: (d.out_of_scope || []).length, l: 'out of scope' },
      ]) + miniList('Functional', d.functional, function(r) { return (r.id ? r.id + ' — ' : '') + (r.description || r.area || ''); });
    case '04-planning':
      return statChips([
        { n: (d.milestones || []).length, l: 'milestones' },
        { n: (d.tasks || []).length, l: 'tasks' },
        { n: (d.risks || []).length, l: 'risks' },
      ]) + miniList('Milestones', d.milestones, function(m) { return (m.name || m.id) + (m.target ? ' · ' + m.target : ''); });
    case '06-architecture':
      var routes = (d.live_api_evidence && d.live_api_evidence.routes) || [];
      return statChips([
        { n: (d.components || []).length, l: 'components' },
        { n: routes.length, l: 'API routes' },
        { n: (d.trade_offs || []).length, l: 'trade-offs' },
      ]) + miniList('Components', d.components, function(c) { return c.name + (c.responsibility ? ' — ' + c.responsibility : ''); });
    case '07-code':
      return statChips([
        { n: (d.files_modified || []).length, l: 'files changed' },
        { n: (d.verification || []).length, l: 'verifications' },
        { n: (d.known_concerns || []).length, l: 'concerns' },
      ]) + miniList('Files', d.files_modified);
    case '08-testing': {
      var res = d.results || {};
      var passed = 0, failed = 0;
      Object.keys(res).forEach(function(k) { if (res[k] && typeof res[k] === 'object') { passed += Number(res[k].passed) || 0; failed += Number(res[k].failed) || 0; } });
      var tot = passed + failed || 1;
      return '<div class="bars"><div class="bar-row"><span class="bar-lab">passed</span><div class="bar-track"><div class="bar-fill pass" style="--w:' + (passed / tot * 100) + '%"></div></div><span class="bar-n">' + passed + '</span></div>' +
        '<div class="bar-row"><span class="bar-lab">failed</span><div class="bar-track"><div class="bar-fill fail" style="--w:' + (failed / tot * 100) + '%"></div></div><span class="bar-n">' + failed + '</span></div></div>' +
        miniList('Coverage gaps', d.coverage_gaps);
    }
    case '09-deployment':
      return '<div class="kv"><span>Status</span><b>' + esc(d.status || '-') + '</b></div>' + miniList('Blockers', d.blockers || d.release_constraints);
    case '10-summary':
      return statChips([
        { n: (d.open_risks || []).length, l: 'open risks' },
        { n: (d.not_built_or_not_done || []).length, l: 'not done' },
        { n: (d.next_steps || []).length, l: 'next steps' },
      ]) + gateBadge(d.release_gate) + miniList('Open risks', d.open_risks, function(r) { return (r.severity ? '[' + r.severity + '] ' : '') + (r.summary || r.id || ''); });
    case '11-feedback-loop':
      return '<div class="gauge-wrap">' + svgGauge(d.consistency_score, scoreColor(d.consistency_score)) + '<span class="gauge-lab">consistency</span></div>' +
        miniList('Findings', d.traceability_findings, function(f) { return (f.requirement || '') + ' — ' + (f.status || ''); });
    case '12-security-threat-model': {
      var th = d.threats || [];
      var by = { HIGH: 0, MEDIUM: 0, LOW: 0 };
      th.forEach(function(t) { var sv = String(t.severity || '').toUpperCase(); if (by[sv] != null) by[sv]++; });
      return '<div class="donut-wrap">' + svgDonut([
        { value: by.HIGH, color: '#dc2626' }, { value: by.MEDIUM, color: '#d97706' }, { value: by.LOW, color: '#16a34a' },
      ]) + '<div class="donut-legend"><span><i style="background:#dc2626"></i>' + by.HIGH + ' high</span><span><i style="background:#d97706"></i>' + by.MEDIUM + ' med</span><span><i style="background:#16a34a"></i>' + by.LOW + ' low</span></div></div>' +
        gateBadge(d.release_gate);
    }
    case '13-compliance-checker': {
      var blocked = (d.controls || []).filter(function(c) { return c.status && c.status !== 'PASS' && c.status !== 'MET'; });
      return '<div class="gauge-wrap">' + svgGauge(d.overall_score, scoreColor(d.overall_score)) + '<span class="gauge-lab">/ 100</span></div>' +
        gateBadge(d.release_gate) + miniList('Action needed', blocked, function(c) { return (c.id || c.name) + ' — ' + (c.required_action || c.status || ''); });
    }
    case '14-cost-estimation':
      return '<div class="flashcard"><span class="flash-n" data-count="' + (Number(d.monthly_cost_usd) || 0) + '">$' + (Number(d.monthly_cost_usd) || 0) + '</span><span class="flash-l">/ month</span></div>' +
        miniList('Cost drivers', d.cost_drivers) + (d.recommendation ? '<div class="kv-note">' + esc(String(d.recommendation).slice(0, 180)) + '</div>' : '');
    case '00-environment': {
      var tools = d.tools || {};
      var names = Object.keys(tools);
      var avail = names.filter(function(n) { return tools[n] && tools[n].available; }).length;
      return statChips([{ n: avail, l: 'tools ready' }, { n: names.length, l: 'detected' }]) +
        '<div class="kv"><span>Pipeline ready</span><b>' + (d.pipeline_ready ? 'Yes' : 'No') + '</b></div>';
    }
    case '01-transcript':
      return statChips([
        { n: (d.goals || []).length, l: 'goals' },
        { n: (d.stakeholders || []).length, l: 'stakeholders' },
        { n: (d.open_questions || []).length, l: 'open questions' },
      ]) + miniList('Goals', d.goals);
    case '03-documentation':
      return statChips([{ n: (d.documents_written || []).length, l: 'docs written' }, { n: (d.known_limitations_documented || []).length, l: 'limitations' }]) +
        miniList('Documents', d.documents_written);
    case '05-jira':
      return statChips([{ n: (d.epics || []).length, l: 'epics' }, { n: (d.issues || []).length, l: 'issues' }]) +
        miniList('Epics', d.epics, function(e) { return e.title || e.id; });
    default:
      return '<div class="muted mono">' + esc(JSON.stringify(d).slice(0, 200)) + '…</div>';
  }
}

function stageCardHtml(stageId, d, compact) {
  var meta = STAGE_CARD_META[stageId] || { icon: '•', title: stageId, persona: '' };
  var status = d && d.status ? d.status : '';
  var statusCls = /FAIL|BLOCK|NOT_/.test(status) ? 'fail' : /CONCERN|PARTIAL|WARN/.test(status) ? 'warn' : d ? 'pass' : 'idle';
  return '<div class="stage-card ' + statusCls + (compact ? ' compact' : '') + '">' +
    '<div class="stage-card-h"><span class="stage-card-icon">' + meta.icon + '</span>' +
    '<div><div class="stage-card-title">' + esc(meta.title) + '</div><div class="stage-card-persona mono">' + esc(stageId) + '</div></div>' +
    (status ? '<span class="stage-card-status ' + statusCls + '">' + esc(String(status).replace(/_/g, ' ')) + '</span>' : '') + '</div>' +
    '<div class="stage-card-body">' + stageBody(stageId, d) + '</div></div>';
}

function animateReport(container) {
  if (!container) return;
  requestAnimationFrame(function() {
    container.classList.add('report-animate');
    // Fill donut arcs and gauges from their collapsed start to the target.
    Array.prototype.forEach.call(container.querySelectorAll('.donut-arc[data-dashoffset]'), function(arc) {
      arc.setAttribute('stroke-dashoffset', arc.getAttribute('data-dashoffset'));
    });
    Array.prototype.forEach.call(container.querySelectorAll('.gauge-fill[data-dash]'), function(g) {
      g.setAttribute('stroke-dasharray', g.getAttribute('data-dash'));
    });
  });
  Array.prototype.forEach.call(container.querySelectorAll('[data-count]'), function(el) {
    var target = Number(el.getAttribute('data-count')) || 0;
    if (target <= 0) return;
    var isMoney = el.textContent.indexOf('$') === 0;
    var start = null, dur = 700;
    function step(ts) {
      if (start === null) start = ts;
      var p = Math.min(1, (ts - start) / dur);
      var val = Math.round(target * (0.5 - Math.cos(p * Math.PI) / 2));
      el.textContent = (isMoney ? '$' : '') + val;
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  });
}

function renderRunReport(s) {
  var runs = s.runs || [];
  var select = document.getElementById('report-run-select');
  if (!select) return;
  if (!REPORT_RUN_ID || !runs.some(function(r) { return r.runId === REPORT_RUN_ID; })) {
    REPORT_RUN_ID = runs.length ? runs[0].runId : null;
  }
  select.innerHTML = runs.map(function(run) {
    var label = ((run.manifest && run.manifest.goal) || run.runId).slice(0, 70);
    return '<option value="' + esc(run.runId) + '"' + (run.runId === REPORT_RUN_ID ? ' selected' : '') + '>' + esc(label) + '</option>';
  }).join('');
  if (REPORT_RUN_ID) loadRunReport(REPORT_RUN_ID);
}

function loadRunReport(runId) {
  REPORT_RUN_ID = runId;
  var run = ((STATE && STATE.runs) || []).filter(function(r) { return r.runId === runId; })[0];
  var grid = document.getElementById('report-grid');
  var kpis = document.getElementById('report-kpis');
  if (!grid || !run) return;
  var totals = run.totals || {};
  var produced = run.stageReports || [];
  kpis.innerHTML =
    reportKpi('Status', (run.manifest && run.manifest.status) || '-', 'blue') +
    reportKpi('Stages reported', produced.length + '/15', 'blue') +
    reportKpi('Tasks passed', (totals.tasks_passed || 0) + '/' + ((totals.tasks_passed || 0) + (totals.tasks_failed || 0)), 'green') +
    reportKpi('Quality', totals.quality_avg != null ? Math.round(totals.quality_avg * 100) + '%' : '—', 'amber') +
    reportKpi('Duration', fmtDur(totals.duration_ms), 'blue');
  grid.innerHTML = '<div class="muted" style="padding:20px">Loading run report…</div>';
  fetchRunReport(runId).then(function(report) {
    if (!report || report.error) { grid.innerHTML = emptyHtml('No report', report && report.error); return; }
    grid.innerHTML = STAGE_CARD_ORDER.map(function(stageId) {
      return stageCardHtml(stageId, report.stages[stageId], false);
    }).join('');
    animateReport(grid);
  });
}

function reportKpi(label, value, tone) {
  return '<div class="report-kpi ' + tone + '"><div class="report-kpi-v">' + esc(String(value)) + '</div><div class="report-kpi-l">' + esc(label) + '</div></div>';
}

registerPage('run-report', {
  errLabel: 'run report',
  sub: 'Every stage report as an infographic — requirements, architecture, tests, security, compliance, cost, release gate — for the selected run.',
  render: renderRunReport
});

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

// ── page: agent-work ────────────────────────────────────────────────
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

registerPage('agent-work', {
  errLabel: 'agent work',
  sub: 'Builder and validator work grouped by project, run, stage and agent contract.',
  render: renderAgentWork
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

// ── page: approvals ────────────────────────────────────────────────
function renderApprovals(s) {
  var approvals = s.approvals || [];
  var pending = approvals.filter(function(item) { return !item.status || item.status === 'pending'; });
  var resolved = approvals.filter(function(item) { return item.status && item.status !== 'pending'; });
  setText('approvals-count', pending.length + ' pending');
  setHTML('approvals-list', pending.map(function(item) { return approvalHtml(item, true); }).join('') || emptyHtml('No pending approvals', 'Only queue-backed approvals appear here.'));
  setHTML('approvals-resolved', resolved.slice(0, 20).map(function(item) { return approvalHtml(item, false); }).join('') || emptyHtml('No resolved approvals', 'Approved and rejected queue entries appear here.'));
}

function approvalHtml(item, canAct) {
  var status = item.status || 'pending';
  // Guardrail overrides are one-shot credentials, not standing approvals —
  // say so on the card so the manager knows exactly what they are granting.
  var isOverride = String(item.artifact || '').indexOf('guardrail-override:') === 0;
  var overrideNote = isOverride
    ? '<div class="muted" style="margin-top:6px">🛡 One-shot override: approving grants exactly <span class="strong">one</span> more attempt for this task, then the override is consumed and further attempts block again.</div>'
    : '';
  return '<div class="approval-card ' + esc(status) + '"><div class="agent-head"><div><div class="strong">' + esc(item.title || item.type || 'Approval required') + '</div><div class="muted">' + esc(item.detail || item.reason || '') + '</div>' + overrideNote + '<div class="feed-meta"><span>' + esc(shortName(item.projectRoot)) + '</span><span>' + esc((item.runId || '').slice(-16)) + '</span><span>' + esc(fmtTime(item.ts)) + '</span></div></div>' + pill(status, status) + '</div>' +
    (canAct ? '<div class="approval-actions"><button class="btn primary" data-id="' + esc(item.id) + '" onclick="approveFromButton(this)">Approve</button><button class="btn danger" data-id="' + esc(item.id) + '" onclick="rejectFromButton(this)">Reject</button></div>' : '') +
    '</div>';
}

function approveFromButton(btn) {
  resolveApproval(btn.getAttribute('data-id'), 'approve');
}

function rejectFromButton(btn) {
  resolveApproval(btn.getAttribute('data-id'), 'reject');
}

function resolveApproval(id, action) {
  var resolvedBy = localStorage.getItem('rstack-approver-name') || '';
  if (!resolvedBy && typeof window.prompt === 'function') {
    resolvedBy = window.prompt('Manager name for this approval decision') || '';
    if (resolvedBy) localStorage.setItem('rstack-approver-name', resolvedBy);
  }
  // Approvals require the signed token (RSTACK_APPROVAL_TOKEN) so identity
  // can't be spoofed from a bare request. Stored locally after first entry.
  var token = sessionStorage.getItem('rstack-approval-token') || '';
  if (!token && typeof window.prompt === 'function') {
    token = window.prompt('Approval token (RSTACK_APPROVAL_TOKEN set on the hub)') || '';
    if (token) sessionStorage.setItem('rstack-approval-token', token);
  }
  fetch('/api/' + action, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-rstack-approval-token': token },
    body: JSON.stringify({ id: id, resolvedBy: resolvedBy || 'dashboard' })
  }).then(function(response) {
    if (!response.ok) {
      return response.json().then(function(body) {
        throw new Error(body.error || ('HTTP ' + response.status));
      });
    }
    return fetchState();
  }).catch(function(err) { showErr('approval: ' + err.message); });
}

registerPage('approvals', {
  errLabel: 'approvals',
  sub: 'Human-in-loop actions from the approval queue only.',
  unscoped: true,
  render: renderApprovals
});

// ── page: decisions ────────────────────────────────────────────────
function renderDecisions(s) {
  var state = s.decisions || { runs: [], totals: {} };
  var runs = state.runs || [];
  var decisions = [];
  runs.forEach(function(run) {
    (run.decisions || []).forEach(function(decision) {
      decisions.push({ run: run, decision: decision });
    });
  });
  var pending = decisions.filter(function(item) { return item.decision.status === 'pending'; });
  setText('decisions-count', pending.length + ' pending / ' + decisions.length + ' total');
  setText('readiness-count', runs.length + ' runs');
  setHTML('decisions-list', decisions.slice(0, 40).map(function(item) {
    var d = item.decision;
    return '<div class="approval-card ' + esc(d.status || 'pending') + '"><div class="agent-head"><div><div class="strong">' + esc(d.decision_id + ' — ' + d.question) + '</div><div class="muted">' + esc(d.recommendation ? 'Recommendation: ' + d.recommendation : 'No recommendation recorded') + '</div><div class="feed-meta"><span>' + esc(d.impact) + '</span><span>before ' + esc(d.required_before_stage) + '</span><span>' + esc((item.run.runId || '').slice(-16)) + '</span></div></div>' + pill(d.status || 'pending', d.status || 'pending') + '</div></div>';
  }).join('') || emptyHtml('No decisions recorded', 'Use sdlc_decisions or rstack-agents decisions to add Decision Queue items.'));
  setHTML('readiness-list', runs.map(function(run) {
    var r = run.readiness || {};
    return '<div class="alert-card ' + (r.status === 'FAIL' ? 'fail' : r.status === 'WARN' ? 'warn' : 'pass') + '"><div class="agent-head"><div><div class="strong">' + esc(run.goal || run.runId) + '</div><div class="muted">' + esc(r.message || 'Definition-of-Ready status') + '</div><div class="feed-meta"><span>' + esc(run.profile || '') + '</span><span>' + esc(r.mode || '') + '</span><span>score ' + esc(r.score || 0) + '</span></div></div>' + pill(r.status || 'PASS') + '</div></div>';
  }).join('') || emptyHtml('No readiness data', 'Run sdlc_dor_check or rstack-agents dor after starting an RStack run.'));
}

registerPage('decisions', {
  errLabel: 'decisions',
  sub: 'Decision Queue and Definition-of-Ready status from decisions.json, dor-report.json and readiness.json.',
  render: renderDecisions
});

// ── page: release-readiness ────────────────────────────────────────────────
function renderReleaseReadiness(s) {
  var tasks = allTasks(s);
  var counts = taskStatusCounts(tasks);
  var blocked = (s.blockedGates || []).length;
  var alerts = (s.alerts || []).length;
  var pending = (s.pendingApprovals || []).length;
  var missingValidation = (s.diagnostics && s.diagnostics.missingValidationCount) || 0;
  var passEvidence = (s.diagnostics && s.diagnostics.evidenceCount) || 0;
  var checks = [
    { name: 'Tests passing', ok: counts.FAIL === 0, detail: counts.PASS + ' passed / ' + counts.FAIL + ' failed' },
    { name: 'Approval gates resolved', ok: blocked === 0 && pending === 0, detail: blocked + ' blocked gates, ' + pending + ' pending approvals' },
    { name: 'Validation evidence attached', ok: missingValidation === 0, detail: passEvidence + ' evidence records, ' + missingValidation + ' missing validations' },
    { name: 'Operational alerts clear', ok: alerts === 0, detail: alerts + ' active alerts' }
  ];
  var blockedCount = checks.filter(function(c) { return !c.ok; }).length;
  var verdict = blockedCount ? 'BLOCKED — ' + blockedCount + ' release condition' + (blockedCount === 1 ? '' : 's') + ' need work' : 'READY TO SHIP';
  setText('release-readiness-verdict', verdict);
  setText('release-readiness-chip', blockedCount ? 'Blocked' : 'Ready');
  setClass('release-readiness-chip', 'command-status ' + (blockedCount ? 'warn' : 'ok'));
  setText('release-readiness-count', checks.filter(function(c) { return c.ok; }).length + '/' + checks.length + ' passed');
  setHTML('release-readiness-checklist', checks.map(function(check) {
    return '<div class="command-row"><div><div class="strong">' + esc(check.name) + '</div><div class="muted">' + esc(check.detail) + '</div></div>' + pill(check.ok ? 'pass' : 'warn', check.ok ? 'PASS' : 'BLOCK') + '</div>';
  }).join(''));
  setHTML('release-readiness-blockers', checks.filter(function(c) { return !c.ok; }).map(function(check) {
    return '<div class="attention-item warn"><div class="attention-value">!</div><div><div class="attention-title">' + esc(check.name) + '</div><div class="attention-detail">' + esc(check.detail) + '</div></div><span class="pill warn">ACTION</span></div>';
  }).join('') || emptyHtml('No release blockers', 'This scoped data is ready by the conservative dashboard checks.'));
}

registerPage('release-readiness', {
  errLabel: 'release readiness',
  sub: 'The conservative ship/no-ship view: blockers, test status, unresolved gates, evidence completeness, and manager actions.',
  render: renderReleaseReadiness
});

// ── page: security ────────────────────────────────────────────────
function renderSecurity(s) {
  var runs = s.runs || [];
  var securityRuns = runs.filter(function(run) { return (run.stageReports || []).indexOf('12-security-threat-model') !== -1; });
  var alertRisks = (s.alerts || []).filter(function(alert) { return /security|threat|risk|gate/i.test(String(alert.title || alert.type || alert.detail || '')); });
  var high = alertRisks.length;
  // First-pass heuristic: all blocked gates are treated as medium-severity
  // security signals. Not every blocked gate is security-related (deployment
  // or architecture approvals also block), so this over-counts until #91 adds
  // a dedicated STRIDE/DREAD registry sourced from threat_model.json.
  var medium = Math.max(0, ((s.blockedGates || []).length));
  var low = securityRuns.length;
  setText('security-threat-count', (high + medium + low) + ' signals');
  setHTML('security-threat-heatmap', '<div class="heatmap"><div class="heat high"><b>' + high + '</b><span>high security/risk alerts</span></div><div class="heat med"><b>' + medium + '</b><span>blocked gates to review</span></div><div class="heat low"><b>' + low + '</b><span>runs with security stage</span></div></div>');
  setHTML('security-release-gate', high || medium ? '<div class="alert-card warn"><div class="strong">Security release gate needs review</div><div class="muted">Resolve open security/risk alerts and blocked gates before shipment.</div></div>' : '<div class="alert-card pass"><div class="strong">No security blocker detected</div><div class="muted">Threat model artifacts are present where the run produced them.</div></div>');
  var rows = (alertRisks.length ? alertRisks : securityRuns.slice(0, 20).map(function(run) { return { level: 'info', title: 'Security threat model produced', detail: 'Stage 12 artifact present', runId: run.runId }; })).slice(0, 30);
  setHTML('security-threat-registry', rows.map(function(item) {
    return '<tr><td>' + pill(item.level || 'info', item.level || 'info') + '</td><td><div class="strong">' + esc(item.title || item.type || 'Security signal') + '</div><div class="muted">' + esc(item.detail || '') + '</div></td><td class="mono muted">' + esc((item.runId || '').slice(-24)) + '</td><td>Review / mitigate</td></tr>';
  }).join('') || '<tr><td colspan="4" class="empty">No security stage artifacts or security alerts in scope.</td></tr>');
}

registerPage('security', {
  errLabel: 'security',
  sub: 'Threat registry and release-gate status from threat-model artifacts, open risks, and security-stage findings.',
  render: renderSecurity
});

// ── page: compliance ────────────────────────────────────────────────
function renderCompliance(s) {
  var runs = s.runs || [];
  var complianceRuns = runs.filter(function(run) { return (run.stageReports || []).indexOf('13-compliance-checker') !== -1; });
  var evidence = (s.diagnostics && s.diagnostics.evidenceCount) || 0;
  var tasks = (s.diagnostics && s.diagnostics.taskCount) || allTasks(s).length;
  var coverage = tasks ? Math.min(100, Math.round((evidence / tasks) * 100)) : 0;
  setText('compliance-score-count', complianceRuns.length + ' compliance runs');
  setHTML('compliance-scorecards', [
    { name: 'Audit evidence coverage', value: coverage + '%', detail: evidence + ' evidence records / ' + tasks + ' tasks' },
    { name: 'Compliance stage coverage', value: complianceRuns.length, detail: 'runs with 13-compliance-checker output' },
    { name: 'Validation gaps', value: (s.diagnostics && s.diagnostics.missingValidationCount) || 0, detail: 'missing validation contracts' }
  ].map(function(card) { return '<div class="command-row"><div><div class="strong">' + esc(card.name) + '</div><div class="muted">' + esc(card.detail) + '</div></div><div class="side-v mini">' + esc(card.value) + '</div></div>'; }).join(''));
  setHTML('compliance-controls', complianceRuns.length ? '<div class="stack-list">' + complianceRuns.slice(0, 12).map(function(run) { return '<div class="command-row"><div><div class="strong">Compliance report available</div><div class="muted mono">' + esc(run.runId) + '</div></div>' + pill('pass', 'report') + '</div>'; }).join('') + '</div>' : emptyHtml('Compliance stage not run in this scope', 'Run stage 13 or select a run that produced compliance_report.json.'));
}

registerPage('compliance', {
  errLabel: 'compliance',
  sub: 'Control coverage, audit gaps, evidence status, and compliance readiness across SDLC runs.',
  render: renderCompliance
});

// ── page: cost-budget ────────────────────────────────────────────────
function renderCostBudget(s) {
  var model = businessFlexModel(s);
  var budget = model.budget || {};
  var totalCost = Number(s.totalCost || 0);
  var avgCost = (s.totalRuns || 0) ? totalCost / s.totalRuns : 0;
  setText('cost-budget-count', (s.totalRuns || 0) + ' runs');
  setHTML('cost-budget-summary', '<div class="proof-grid"><div><div class="proof-value">$' + totalCost.toFixed(4) + '</div><div class="proof-label">actual tracked spend</div></div><div><div class="proof-value">$' + avgCost.toFixed(4) + '</div><div class="proof-label">avg / run</div></div><div><div class="proof-value">$' + Number(budget.runBudgetTotal || 0).toFixed(2) + '</div><div class="proof-label">profile run budget</div></div><div><div class="proof-value">$' + Number(budget.estimatedTaskBudget || 0).toFixed(2) + '</div><div class="proof-label">estimated task budget</div></div></div>');
  var drivers = [];
  (s.runs || []).forEach(function(run) {
    (run.tasks || []).forEach(function(task) {
      if (task.budget_envelope) drivers.push({ task: task.title || task.id, runId: run.runId, cost: task.budget_envelope.estimated_ai_cost_usd || 0 });
    });
  });
  setHTML('cost-budget-drivers', drivers.slice(0, 20).map(function(driver) {
    return '<div class="command-row"><div><div class="strong">' + esc(driver.task) + '</div><div class="muted mono">' + esc(driver.runId) + '</div></div><div class="side-v mini">$' + Number(driver.cost || 0).toFixed(2) + '</div></div>';
  }).join('') || emptyHtml('No task budget envelopes', 'Business Flex budgets appear after init/profile and task routing metadata are written.'));
}

registerPage('cost-budget', {
  errLabel: 'cost budget',
  sub: 'Estimated cost, run spend, budget envelopes, and cost drivers for business governance.',
  render: renderCostBudget
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

// ── page: traceability ────────────────────────────────────────────────
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

registerPage('traceability', {
  errLabel: 'traceability',
  sub: 'FR/NFR requirements, stage artifacts, verified tasks and evidence connected by run.',
  render: renderTraceability
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
