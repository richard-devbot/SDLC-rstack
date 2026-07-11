// owner: RStack developed by Richardson Gunde
//
// Shared client helpers used across page modules: the page registry, DOM
// setters, formatting, HTML fragments (pills/chips/feed rows), scoped-state
// helpers and the read-token-aware fetch. Plain client JS concatenated into
// the served bundle by ui/client.js — no build step, no framework.

export const libScript = `
// ── shared lib ─────────────────────────────────────────────
// ── Page registry ──────────────────────────────────────────
// Every page module self-registers its renderer here. Registration order =
// concatenation order in ui/client.js = render order. applyState dispatches
// through this list, so adding a page never touches the core loop.
var PAGE_RENDERERS = [];

function registerPage(id, opts) {
  PAGE_RENDERERS.push({
    id: id,
    sub: opts.sub || '',
    errLabel: opts.errLabel || id,
    render: opts.render,
    // Unscoped pages receive the raw snapshot: approvals, alerts and
    // diagnostics intentionally ignore the project/run scope filter.
    unscoped: !!opts.unscoped
  });
}

function allTasks(s) {
  return (s.runs || []).reduce(function(items, run) { return items.concat(run.tasks || []); }, []);
}

function taskStatusCounts(tasks) {
  var counts = { PASS: 0, FAIL: 0, IN_PROGRESS: 0, PENDING: 0, READY: 0, QUEUED: 0 };
  (tasks || []).forEach(function(task) {
    var status = String(task.status || 'READY').toUpperCase();
    if (status === 'RUNNING') status = 'IN_PROGRESS';
    if (status === 'DONE') status = 'PASS';
    if (!counts[status]) counts[status] = 0;
    counts[status] += 1;
  });
  return counts;
}

function pill(status, label) {
  var value = label || String(status || 'ready');
  var cls = String(status || 'ready').toLowerCase();
  if (cls === 'pass' || cls === 'passed') cls = 'pass';
  if (cls === 'fail' || cls === 'failed') cls = 'fail';
  if (cls === 'in_progress') cls = 'running';
  return '<span class="pill ' + esc(cls) + '">' + esc(value) + '</span>';
}

function chip(label) {
  return '<span class="chip">' + esc(label || '') + '</span>';
}

function emptyHtml(title, detail) {
  return '<div class="empty"><div class="empty-title">' + esc(title || 'Empty') + '</div>' + (detail ? '<div>' + esc(detail) + '</div>' : '') + '</div>';
}

function shortName(path) {
  return String(path || '-').split('/').filter(Boolean).pop() || '-';
}

function timeModel(value) {
  if (!value) return { valid: false, iso: '', label: 'Time unavailable' };
  var date = new Date(value);
  if (isNaN(date.getTime())) return { valid: false, iso: '', label: 'Invalid time' };
  var iso = date.toISOString();
  var label = new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  }).format(date);
  return { valid: true, iso: iso, label: label };
}

function fmtTime(value) {
  return timeModel(value).label;
}

function timeHtml(value) {
  var model = timeModel(value);
  if (!model.valid) return '<span class="time-unavailable">' + esc(model.label) + '</span>';
  return '<time datetime="' + esc(model.iso) + '" title="' + esc(model.iso) + '">' +
    esc(model.label) + '</time>';
}

function fmtDur(ms) {
  ms = Number(ms) || 0;
  if (ms < 1000) return ms + 'ms';
  var sec = Math.round(ms / 1000);
  if (sec < 60) return sec + 's';
  var min = Math.floor(sec / 60);
  if (min < 60) return min + 'm ' + (sec % 60) + 's';
  return Math.floor(min / 60) + 'h ' + (min % 60) + 'm';
}

function fmtAgo(seconds) {
  if (seconds < 60) return seconds + 's ago';
  var minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes + 'm ago';
  return Math.floor(minutes / 60) + 'h ago';
}

function setText(id, value) {
  var el = document.getElementById(id);
  if (el) el.textContent = value;
}

function setHTML(id, value) {
  var el = document.getElementById(id);
  if (el) el.innerHTML = value;
}

function setClass(id, value) {
  var el = document.getElementById(id);
  if (el) el.className = value;
}

function setBadge(id, value, ariaLabel) {
  var el = document.getElementById(id);
  if (!el) return;
  el.textContent = value;
  if (ariaLabel) el.setAttribute('aria-label', value + ' ' + ariaLabel);
  el.style.display = value > 0 ? 'inline-block' : 'none';
}

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showErr(message) {
  var el = document.getElementById('err');
  if (!el) return;
  el.textContent = 'Error: ' + message;
  el.style.display = 'block';
  console.error('[rstack-business]', message);
}

function feedRowHtml(item) {
  var level = item.level || 'info';
  var icon = level === 'pass' ? 'OK' : level === 'fail' ? 'NO' : level === 'blocked' ? 'BL' : level === 'warn' ? '!' : 'i';
  return '<div class="feed-row"><div class="feed-icon ' + esc(level) + '">' + icon + '</div><div><div class="feed-summary">' + esc(item.summary || '') + '</div><div class="feed-meta">' + (item.runId ? '<span>' + esc(item.runId.slice(-14)) + '</span>' : '') + (item.projectRoot ? '<span>' + esc(shortName(item.projectRoot)) + '</span>' : '') + (item.type ? '<span>' + esc(item.type) + '</span>' : '') + '</div></div><div class="feed-ts">' + timeHtml(item.ts) + '</div></div>';
}

function agentItemHtml(work) {
  var total = work.totalChecks || 0;
  var rate = total ? Math.round((work.passChecks || 0) / total * 100) : 0;
  return '<div class="agent-item"><div class="agent-head"><div><div class="strong">' + esc(work.title || work.taskId) + '</div><div class="muted mono">' + esc(work.stageId || work.taskId || '') + ' / ' + esc(work.agent || '') + '</div></div>' + pill(work.status || 'ready') + '</div>' +
    '<div class="agent-summary">' + esc(work.summary || work.workDone || 'No builder summary yet.') + '</div>' +
    (total ? '<div class="progress" style="margin-top:8px"><div class="progress-fill" style="width:' + rate + '%"></div></div>' : '') +
    '<div class="chips">' + chip((work.passChecks || 0) + '/' + total + ' checks') + chip((work.riskCount || 0) + ' risks') + (work.filesModified || []).slice(0, 2).map(chip).join('') + '</div></div>';
}

function groupAgentWork(work) {
  var groups = {};
  (work || []).forEach(function(item) {
    var key = (item.projectRoot || 'unknown') + '::' + item.runId;
    if (!groups[key]) groups[key] = { projectRoot: item.projectRoot, runId: item.runId, goal: item.goal, total: 0, passed: 0, failed: 0, evidence: 0, risks: 0, agents: {}, items: [] };
    var group = groups[key];
    group.total += 1;
    if (item.status === 'PASS') group.passed += 1;
    if (item.status === 'FAIL') group.failed += 1;
    group.evidence += item.evidenceCount || 0;
    group.risks += item.riskCount || 0;
    group.agents[item.agent || 'agent'] = (group.agents[item.agent || 'agent'] || 0) + 1;
    group.items.push(item);
  });
  return Object.keys(groups).map(function(key) { return groups[key]; });
}

function businessFlexModel(s) {
  if (s.businessFlex && ((s.businessFlex.profiles || []).length || (s.businessFlex.routingSignals || []).length)) return s.businessFlex;
  var profiles = {};
  var routingSignals = [];
  var budget = { runBudgetTotal: 0, estimatedTaskBudget: 0, tasksWithBudget: 0 };
  (s.runs || []).forEach(function(run) {
    var profile = run.profile || {};
    var id = profile.profile || (run.manifest && run.manifest.profile) || 'unprofiled';
    if (!profiles[id]) profiles[id] = { profile: id, name: profile.name || id, workflow: run.workflow || profile.workflow || '', runs: 0, enabledDomains: [], enabledAgents: [], enabledPlugins: [], dashboardPages: [] };
    profiles[id].runs += 1;
    ['enabledDomains', 'enabledAgents', 'enabledPlugins', 'dashboardPages'].forEach(function(key) {
      var sourceKey = key.replace(/[A-Z]/g, function(c) { return '_' + c.toLowerCase(); });
      (profile[sourceKey] || profile[key] || []).forEach(function(value) {
        if (profiles[id][key].indexOf(value) === -1) profiles[id][key].push(value);
      });
    });
    budget.runBudgetTotal += Number((run.budgetPolicy && run.budgetPolicy.run_budget_usd) || 0);
    (run.tasks || []).forEach(function(task) {
      if (task.budget_envelope) {
        budget.tasksWithBudget += 1;
        budget.estimatedTaskBudget += Number(task.budget_envelope.estimated_ai_cost_usd || 0);
      }
      if (task.routing) routingSignals.push({ runId: run.runId, projectRoot: run.projectRoot, taskId: task.id, title: task.title, profile: task.profile || id, selectedBy: task.routing.selected_by, explanation: task.routing.explanation || [], specialists: task.specialists || [], budget: task.budget_envelope || null });
    });
  });
  return { profiles: Object.keys(profiles).map(function(k) { return profiles[k]; }), budget: budget, routingSignals: routingSignals };
}

function ganttHtml(segments) {
  var timed = segments.filter(function(seg) { return seg.started_at; });
  if (!timed.length) return emptyHtml('No timeline segments', 'task_started / task_validated events build this view.');
  var start = Math.min.apply(null, timed.map(function(seg) { return Date.parse(seg.started_at); }));
  var end = Math.max.apply(null, timed.map(function(seg) {
    return seg.ended_at ? Date.parse(seg.ended_at) : Date.parse(seg.started_at);
  }));
  var span = Math.max(1, end - start);
  return timed.map(function(seg) {
    var s0 = Date.parse(seg.started_at);
    var s1 = seg.ended_at ? Date.parse(seg.ended_at) : end;
    var left = ((s0 - start) / span) * 100;
    var width = Math.max(0.8, ((s1 - s0) / span) * 100);
    var cls = seg.status === 'PASS' ? 'pass' : seg.status === 'FAIL' ? 'fail' : 'running';
    var label = seg.task_id + (seg.attempt > 1 ? ' (attempt ' + seg.attempt + ')' : '');
    var stages = (seg.stage_ids || []).join(', ');
    return '<div class="gantt-row">' +
      '<div class="gantt-label" title="' + esc(stages) + '">' + esc(label) + '</div>' +
      '<div class="gantt-track">' +
        '<div class="gantt-bar ' + cls + '" style="left:' + left.toFixed(2) + '%;width:' + width.toFixed(2) + '%" title="' + esc(label + ' — ' + fmtDur(seg.elapsed_ms) + (stages ? ' — ' + stages : '')) + '"></div>' +
      '</div>' +
      '<div class="gantt-dur mono">' + (seg.ended_at ? fmtDur(seg.elapsed_ms) : 'running') + '</div>' +
    '</div>';
  }).join('');
}

// Read token (#164): kept in sessionStorage only — never persisted across
// browser sessions. Prompted once on the first 401 from a read endpoint.
function readToken() {
  return sessionStorage.getItem('rstack-read-token') || '';
}

function promptReadToken() {
  if (typeof window.prompt !== 'function') return '';
  var token = window.prompt('Dashboard read token (RSTACK_DASHBOARD_READ_TOKEN set on the hub)') || '';
  if (token) sessionStorage.setItem('rstack-read-token', token);
  return token;
}

function readHeaders(extra) {
  var headers = extra || {};
  var token = readToken();
  if (token) headers['x-rstack-read-token'] = token;
  return headers;
}

function authAwareFetch(url, opts) {
  opts = opts || {};
  opts.headers = readHeaders(opts.headers);
  return fetch(url, opts).then(function(response) {
    if (response.status === 401 && !readToken()) {
      var token = promptReadToken();
      if (token) {
        opts.headers = readHeaders(opts.headers);
        return fetch(url, opts);
      }
    }
    return response;
  });
}
`;
