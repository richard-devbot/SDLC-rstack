// owner: RStack developed by Richardson Gunde
//
// Run Analytics page module — renders into #page-run-analytics. Plain client JS
// concatenated into the served bundle by ui/client.js; self-registers its
// renderer with the page registry (ui/lib.js).
//
// [wave:money] #215 slices rendered here: cumulative token totals (#83/#199)
// as a headline KPI, per-stage cost + tokens from metrics.json stage maps
// (#135), and the parallel benchmark artifact (#159/#207) as a SEQ-vs-PAR
// panel with an honest mock-vs-real badge. Absent data renders as an
// explanatory empty state — never a fabricated $0.00.

export const runAnalyticsScript = `
// ── page: run-analytics ────────────────────────────────────────────────
var ANALYTICS_RUN_ID = null;
var BENCH_CACHE = {}; // runId → { state: 'ok'|'missing'|'error', data?, detail? }

// 1732000 → "1.73M"; 451000 → "451k". Display-only compaction.
function fmtTokensCompact(n) {
  n = Number(n) || 0;
  if (n >= 1e9) return (n / 1e9).toFixed(2).replace(/\\.00$/, '') + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2).replace(/\\.00$/, '') + 'M';
  if (n >= 1e3) return Math.round(n / 1e3) + 'k';
  return String(n);
}

// Provenance pill (#83): persisted metrics.json totals vs event recompute.
// 'none' means there is no telemetry at all — the UI must not show $0.00.
function moneySourcePill(source) {
  if (source === 'persisted') return pill('pass', 'persisted metrics');
  if (source === 'events') return pill('info', 'recomputed from events');
  return pill('ready', 'no telemetry');
}

function analyticsKpisHtml(run) {
  var totals = (run && run.totals) || {};
  var tokens = (run && run.tokenTotals) || null;
  var source = (run && run.metricsSource) || (tokens ? 'persisted' : 'none');
  var hasCost = source !== 'none' && (Number(totals.cost_usd) > 0 || tokens);
  var tokenTotal = tokens ? tokens.total : Number(totals.tokens) || 0;
  var tokenSub = tokens
    ? fmtTokensCompact(tokens.input) + ' in / ' + fmtTokensCompact(tokens.output) + ' out'
    : (tokenTotal ? 'recomputed from events' : 'appears when builder contracts report cost');
  return '<div class="kpi blue"><div class="kpi-v">' + fmtDur(totals.duration_ms) + '</div><div class="kpi-l">Run Duration</div></div>' +
    '<div class="kpi blue"><div class="kpi-v">' + (totals.tool_calls || 0) + '</div><div class="kpi-l">Tool Calls</div></div>' +
    '<div class="kpi green"><div class="kpi-v">' + (totals.tasks_passed || 0) + '</div><div class="kpi-l">Passed</div></div>' +
    '<div class="kpi red"><div class="kpi-v">' + (totals.tasks_failed || 0) + '</div><div class="kpi-l">Failed</div></div>' +
    '<div class="kpi amber"><div class="kpi-v">' + (totals.quality_avg !== null && totals.quality_avg !== undefined ? Math.round(totals.quality_avg * 100) + '%' : '-') + '</div><div class="kpi-l">Avg Quality</div></div>' +
    '<div class="kpi amber"><div class="kpi-v">' + (hasCost ? '$' + Number(totals.cost_usd || 0).toFixed(4) : '—') + '</div><div class="kpi-l">Cost</div><div class="kpi-s">' + (hasCost ? moneySourcePill(source) : 'no cost telemetry yet') + '</div></div>' +
    '<div class="kpi blue"><div class="kpi-v">' + (tokenTotal ? fmtTokensCompact(tokenTotal) : '—') + '</div><div class="kpi-l">Tokens</div><div class="kpi-s">' + esc(tokenSub) + '</div></div>';
}

// Per-stage cost + tokens (#135) from the persisted metrics.json stage maps.
function stageMoneyHtml(run) {
  var cost = (run && run.stageCost) || {};
  var toks = (run && run.stageTokens) || {};
  var seen = {};
  Object.keys(cost).forEach(function(id) { seen[id] = true; });
  Object.keys(toks).forEach(function(id) { seen[id] = true; });
  var ids = Object.keys(seen).sort();
  if (!ids.length) {
    return emptyHtml('No per-stage cost telemetry yet',
      'Per-stage cost and tokens are persisted to metrics.json when each builder contract reports cost at validate. Stages appear here as they complete — nothing is estimated.');
  }
  var max = Math.max.apply(null, ids.map(function(id) { return Number(cost[id]) || 0; })) || 1;
  return ids.map(function(id) {
    var usd = Number(cost[id]) || 0;
    var t = toks[id] && typeof toks[id] === 'object' ? toks[id] : null;
    var width = Math.max(2, (usd / max) * 100);
    var value = (cost[id] === undefined ? 'cost n/a' : '$' + usd.toFixed(2)) +
      (t ? ' · ' + fmtTokensCompact(t.total) + ' tok' : '');
    return '<div class="stage-bar-row">' +
      '<div class="stage-bar-label mono">' + esc(id) + '</div>' +
      '<div class="stage-bar-track"><div class="stage-bar-fill money" style="width:' + width.toFixed(1) + '%"></div></div>' +
      '<div class="stage-bar-value mono" title="' + esc(t ? fmtTokensCompact(t.input) + ' in / ' + fmtTokensCompact(t.output) + ' out' : '') + '">' + esc(value) + '</div>' +
    '</div>';
  }).join('');
}

// Parallel benchmark artifact (#159): SEQ vs PAR with an honest badge — a
// mock (modelled) measurement must never look like a live-agent one.
function benchmarkPanelHtml(entry) {
  if (!entry || entry.state === 'missing') {
    return emptyHtml('No parallel benchmark for this run',
      'Run scripts/bench-parallel.mjs to time the data-independent stage group sequentially vs in parallel. The result lands at artifacts/parallel-benchmark.json and renders here, including whether the measured gain clears the 40% evidence gate.');
  }
  if (entry.state === 'error') {
    return emptyHtml('Benchmark artifact unreadable', entry.detail || 'The artifact exists but could not be parsed.');
  }
  var d = entry.data || {};
  var seq = Number(d.seq_time_ms);
  var par = Number(d.par_time_ms);
  if (!isFinite(seq) || !isFinite(par) || seq < 0 || par < 0) {
    return emptyHtml('Benchmark artifact incomplete', 'seq_time_ms / par_time_ms are missing or not numbers — re-run the benchmark to get a trustworthy result.');
  }
  var max = Math.max(seq, par) || 1;
  var improvement = isFinite(Number(d.improvement)) ? Math.round(Number(d.improvement) * 100) : null;
  var target = isFinite(Number(d.target)) ? Math.round(Number(d.target) * 100) : 40;
  var enabled = String(d.gate || '').indexOf('enabled') === 0;
  var isReal = d.mode === 'real';
  var modeBadge = isReal ? pill('pass', 'measured — real stages') : pill('warn', 'modelled — mock workload');
  var bar = function(label, ms, cls) {
    return '<div class="stage-bar-row">' +
      '<div class="stage-bar-label mono">' + label + '</div>' +
      '<div class="stage-bar-track"><div class="stage-bar-fill ' + cls + '" style="width:' + Math.max(2, (ms / max) * 100).toFixed(1) + '%"></div></div>' +
      '<div class="stage-bar-value mono">' + fmtDur(ms) + '</div>' +
    '</div>';
  };
  return '<div class="bench-head">' + modeBadge + ' ' +
      (improvement === null ? pill('ready', 'improvement not recorded')
        : pill(enabled ? 'pass' : 'warn', improvement + '% faster — ' + (enabled ? 'clears' : 'below') + ' the ' + target + '% gate')) +
    '</div>' +
    bar('Sequential', seq, 'bench-seq') + bar('Parallel', par, 'bench-par') +
    '<div class="chips">' + (Array.isArray(d.group) ? d.group.map(chip).join('') : '') + '</div>' +
    '<div class="kv-note">' + esc(d.measurement || '') + (enabled
      ? ' Parallel groups are recommended for this stage group; execution wiring stays sequential until enabled.'
      : ' Below-gate results fail safe: parallel execution stays disabled.') + '</div>';
}

// Panels owned by this module are attached client-side so the shared page
// shell (ui/pages/index.js) stays untouched by the parallel page wave.
function ensureAnalyticsMoneyPanels() {
  if (document.getElementById('analytics-money-grid')) return;
  var page = document.getElementById('page-run-analytics');
  if (!page) return;
  var grid = document.createElement('div');
  grid.className = 'grid-2';
  grid.id = 'analytics-money-grid';
  grid.innerHTML =
    '<div class="panel"><div class="panel-head"><span class="panel-title">Cost &amp; Tokens by Stage</span><span class="panel-note" id="analytics-money-note"></span></div><div class="panel-body"><div class="stage-bars" id="analytics-stage-money"></div></div></div>' +
    '<div class="panel"><div class="panel-head"><span class="panel-title">Parallel Benchmark</span><span class="panel-note" id="analytics-bench-note"></span></div><div class="panel-body" id="analytics-benchmark"></div></div>';
  page.appendChild(grid);
}

function fetchParallelBenchmark(runId) {
  var cached = BENCH_CACHE[runId];
  // Hits cache for the session; misses re-check after 60s so a benchmark
  // produced mid-run shows up without a reload.
  if (cached && (cached.state === 'ok' || (Date.now() - (cached.at || 0)) < 60000)) return Promise.resolve(cached);
  return authAwareFetch('/api/artifact?run=' + encodeURIComponent(runId) + '&path=' + encodeURIComponent('artifacts/parallel-benchmark.json'))
    .then(function(r) { return r.json().then(function(body) { return { status: r.status, body: body }; }); })
    .then(function(res) {
      var entry;
      if (res.status === 200 && res.body && typeof res.body.content === 'string') {
        try { entry = { state: 'ok', data: JSON.parse(res.body.content) }; }
        catch (err) { entry = { state: 'error', detail: 'artifacts/parallel-benchmark.json is not valid JSON' }; }
      } else if (res.status === 404) {
        entry = { state: 'missing' };
      } else {
        entry = { state: 'error', detail: (res.body && res.body.error) || ('HTTP ' + res.status) };
      }
      entry.at = Date.now();
      BENCH_CACHE[runId] = entry; // misses are cached too (with a TTL) — no refetch storm on the 3s poll
      return entry;
    })
    .catch(function(err) { return { state: 'error', detail: err.message }; }); // network errors are NOT cached
}

function renderRunAnalytics(s) {
  var runs = s.runs || [];
  var select = document.getElementById('analytics-run-select');
  if (select) {
    if (!ANALYTICS_RUN_ID || !runs.some(function(run) { return run.runId === ANALYTICS_RUN_ID; })) {
      ANALYTICS_RUN_ID = runs.length ? runs[0].runId : null;
    }
    select.innerHTML = runs.map(function(run) {
      var label = ((run.manifest && run.manifest.goal) || run.runId).slice(0, 70);
      return '<option value="' + esc(run.runId) + '"' + (run.runId === ANALYTICS_RUN_ID ? ' selected' : '') + '>' + esc(label) + '</option>';
    }).join('');
  }
  renderAnalyticsRun(ANALYTICS_RUN_ID);
  renderStageBars(s);
  renderTrendTable(s);
}

function renderAnalyticsRun(runId) {
  ANALYTICS_RUN_ID = runId;
  ensureAnalyticsMoneyPanels();
  var run = ((STATE && STATE.runs) || []).filter(function(item) { return item.runId === runId; })[0];
  if (!run) {
    setHTML('analytics-kpis', '');
    setHTML('analytics-gantt', emptyHtml('No runs yet', 'Run timelines appear once a run records task events.'));
    setHTML('analytics-stage-money', emptyHtml('No runs yet', 'Per-stage cost and tokens appear once a run persists metrics.'));
    setHTML('analytics-benchmark', emptyHtml('No runs yet', 'Benchmark results appear once a run produces artifacts/parallel-benchmark.json.'));
    setText('analytics-money-note', '');
    setText('analytics-bench-note', '');
    return;
  }
  setHTML('analytics-kpis', analyticsKpisHtml(run));
  setHTML('analytics-gantt', ganttHtml(run.timeline || []));
  setHTML('analytics-stage-money', stageMoneyHtml(run));
  setText('analytics-money-note', Object.keys(run.stageCost || {}).length + ' stages with cost data');
  var cached = BENCH_CACHE[runId];
  if (cached) {
    setHTML('analytics-benchmark', benchmarkPanelHtml(cached));
    setText('analytics-bench-note', cached.state === 'ok' ? 'artifacts/parallel-benchmark.json' : '');
  } else {
    setHTML('analytics-benchmark', emptyHtml('Checking for a benchmark artifact…', ''));
    fetchParallelBenchmark(runId).then(function(entry) {
      if (ANALYTICS_RUN_ID !== runId) return; // user switched runs mid-fetch
      setHTML('analytics-benchmark', benchmarkPanelHtml(entry));
      setText('analytics-bench-note', entry.state === 'ok' ? 'artifacts/parallel-benchmark.json' : '');
    });
  }
}

function renderStageBars(s) {
  var stages = (s.trends && s.trends.stages) || {};
  var ids = Object.keys(stages).sort();
  setText('analytics-stage-count', ids.length + ' stages');
  if (!ids.length) {
    setHTML('analytics-stage-bars', emptyHtml('No stage durations yet', 'stage_completed events populate this view.'));
    return;
  }
  var max = Math.max.apply(null, ids.map(function(id) { return stages[id].avg_elapsed_ms || 0; })) || 1;
  setHTML('analytics-stage-bars', ids.map(function(id) {
    var stage = stages[id];
    var width = Math.max(2, ((stage.avg_elapsed_ms || 0) / max) * 100);
    return '<div class="stage-bar-row">' +
      '<div class="stage-bar-label mono">' + esc(id) + '</div>' +
      '<div class="stage-bar-track"><div class="stage-bar-fill" style="width:' + width.toFixed(1) + '%"></div></div>' +
      '<div class="stage-bar-value mono">' + fmtDur(stage.avg_elapsed_ms) + ' <span class="faint">x' + stage.runs + '</span></div>' +
    '</div>';
  }).join(''));
}

function renderTrendTable(s) {
  var rows = (s.trends && s.trends.runs) || [];
  setText('analytics-trend-count', rows.length + ' runs');
  setHTML('analytics-trend-table', rows.map(function(row) {
    return '<tr class="clickable" tabindex="0" role="button" data-runid="' + esc(row.runId) + '" onclick="openDrawerRow(this)" aria-label="Open run details">' +
      '<td><div class="strong">' + esc((row.goal || row.runId).slice(0, 60)) + '</div><div class="faint mono">' + esc(String(row.created_at || '').slice(0, 16)) + '</div></td>' +
      '<td class="mono">' + fmtDur(row.duration_ms) + '</td>' +
      '<td class="mono">' + (row.tool_calls || 0) + '</td>' +
      '<td><span class="strong">' + (row.tasks_passed || 0) + '</span><span class="muted">/' + ((row.tasks_passed || 0) + (row.tasks_failed || 0)) + '</span></td>' +
      '<td class="mono">' + (row.quality_avg !== null && row.quality_avg !== undefined ? Math.round(row.quality_avg * 100) + '%' : '-') + '</td>' +
      '<td class="mono muted">$' + Number(row.cost_usd || 0).toFixed(4) + '</td>' +
    '</tr>';
  }).join('') || '<tr><td colspan="6" class="empty">No runs yet</td></tr>');
}

registerPage('run-analytics', {
  errLabel: 'run analytics',
  sub: 'Wall-clock run timelines, per-stage durations, cost and token telemetry, and the parallel-execution benchmark for each run.',
  render: renderRunAnalytics
});
`;
