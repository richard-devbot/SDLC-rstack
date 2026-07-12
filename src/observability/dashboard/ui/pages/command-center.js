// owner: RStack developed by Richardson Gunde
//
// Command Center page module — renders into #page-command. Plain client JS
// concatenated into the served bundle by ui/client.js; self-registers its
// renderer with the page registry (ui/lib.js).

export const commandCenterScript = `
// ── page: command ────────────────────────────────────────────────
function renderCommand(s) {
  var tasks = allTasks(s);
  var counts = taskStatusCounts(tasks);
  var diagnostics = s.diagnostics || {};
  var projects = s.projectSummaries || [];
  var agentWork = s.agentWork || [];
  var activeRunCount = (s.activeRuns || []).length;
  var pendingWork = counts.PENDING + counts.READY + counts.QUEUED;
  var evidenceActions = agentWork.filter(function(work) { return (work.evidenceCount || 0) > 0; }).length;
  var attentionItems = commandAttentionItems(s, counts);
  var hasAttention = attentionItems.length > 0;

  setText('command-summary-title', commandSummaryTitle(s, attentionItems, counts));
  setText('command-summary-sub', commandSummarySub(s, attentionItems, counts));
  setText('command-status-chip', hasAttention ? 'Needs review' : activeRunCount ? 'Live work running' : 'All clear');
  setClass('command-status-chip', 'command-status ' + (hasAttention ? 'warn' : activeRunCount ? 'active' : 'ok'));
  renderExecutiveMissionBrief(s);
  renderOverviewDecisionSurface(s);
  renderOverviewProofRail(s);
  ensureCommandWavePanels();
  renderCommandExecRollup(s);
  renderCommandNextAction(s);

  setText('kpi-projects', projects.length);
  setText('kpi-projects-s', (s.sourceRoots || []).length + ' source roots tracked');
  setText('kpi-runs', s.totalRuns || 0);
  setText('kpi-runs-s', (s.todayCount || 0) + ' today, ' + activeRunCount + ' active');
  setText('kpi-pass', counts.PASS);
  setText('kpi-pass-s', counts.FAIL + ' failed, ' + tasks.length + ' total tasks');
  setText('kpi-progress', counts.IN_PROGRESS);
  setText('kpi-progress-s', activeRunCount + ' active runs now');
  setText('kpi-pending', pendingWork);
  setText('kpi-pending-s', (diagnostics.missingValidationCount || 0) + ' missing validations');
  setText('kpi-evidence', diagnostics.evidenceCount || 0);
  setText('kpi-evidence-s', evidenceActions + ' agent actions with checks');

  setText('command-attention-count', attentionItems.length ? attentionItems.length + ' signals' : 'clear');
  setHTML('command-attention', attentionItems.length ? attentionItems.map(attentionItemHtml).join('') : emptyHtml('No open attention signals', 'Approvals, alerts, blocked gates and validation gaps will appear here.'));

  setText('command-stage-count', (s.stageMatrix || []).length + ' canonical stages');
  setHTML('command-stage-strip', commandStageStripHtml(s));

  setText('command-project-count', projects.length + ' projects');
  setHTML('command-projects', commandProjectsHtml(s));

  setText('command-agent-count', agentWork.length + ' actions');
  setHTML('command-agent-proof', commandAgentProofHtml(s));

  setText('command-layer-count', (s.layers || []).length + ' layers');
  setHTML('command-layers', commandLayersHtml(s));

  var feed = (s.feed || []).slice(0, 12);
  setText('command-feed-count', feed.length + ' events');
  setHTML('command-feed', feed.length ? feed.map(feedRowHtml).join('') : emptyHtml('No activity yet', 'Events appear as runs execute.'));
}

function overviewStateLabel(status) {
  return ({ blocked: 'Blocked', at_risk: 'At risk', ready: 'Ready', unknown: 'Unknown' })[status] || 'Unknown';
}

function overviewCoverageText(coverage) {
  if (!coverage || coverage.percent === null || coverage.percent === undefined) return 'Not evaluated';
  var evaluated = coverage.evaluated;
  var expected = coverage.expected;
  return coverage.percent + '%' + (evaluated !== undefined && expected !== undefined ? ' · ' + evaluated + '/' + expected + ' checks' : '');
}

function overviewTime(value) {
  if (!value) return 'Not evaluated';
  var date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function overviewActionRoute(action) {
  if (!action) return { page: 'diagnostics', label: 'Open diagnostics' };
  if (action.kind === 'approval') return { page: 'approvals', label: 'Review approval' };
  if (action.kind === 'decision') return { page: 'action-inbox', label: 'Review decision' };
  if (action.kind === 'configuration') return { page: 'diagnostics', label: 'Open diagnostics' };
  if (action.kind === 'failure' || action.kind === 'audit') return { page: 'action-inbox', label: 'Open Action Inbox' };
  if (action.kind === 'alert') return { page: 'live-feed', label: 'Open Operations' };
  if (action.kind === 'guardrail_blocked' || action.kind === 'failed') return { page: 'alerts-guardrails', label: 'Open blocker' };
  if (action.kind === 'complete') return { page: 'release-readiness', label: 'Review readiness' };
  if (action.kind === 'setup') return { page: 'operations', label: 'Open setup diagnostics' };
  return { page: 'workflow', label: 'Open run workspace' };
}

function renderOverviewDecisionSurface(s) {
  var overview = s.overview || {};
  var readiness = s.readiness || { status: 'unknown', coverage: {} };
  var status = readiness.status || overview.outcome || 'unknown';
  var noRun = !overview.focusRunId;
  var title = noRun ? 'No delivery run has been evaluated.' : (overview.title || readiness.summary || 'Delivery outcome is not available.');
  var action = overview.nextAction || { text: 'Start an RStack run to evaluate delivery readiness.', kind: 'setup', source: null };
  var route = overviewActionRoute(action);

  setText('overview-state', overviewStateLabel(status));
  setClass('overview-state', 'overview-state ' + status);
  setText('overview-goal', overview.goal || (noRun ? 'No active run' : 'Goal unavailable'));
  setText('overview-outcome-title', title);
  setText('overview-rationale', readiness.summary || title);
  setText('overview-coverage', overviewCoverageText(readiness.coverage || overview.coverage));
  setText('overview-evaluated-at', overviewTime(overview.evaluatedAt || readiness.evaluatedAt));
  setText('overview-action-count', String(overview.actionCount || 0));
  setHTML('overview-next-action',
    '<div><span class="overview-next-label">Next action</span><strong>' + esc(action.text || 'No action is available from this snapshot.') + '</strong>' +
      '<span class="overview-source">' + (action.source && action.source.path ? esc(action.source.path) : 'Source unavailable') + '</span></div>' +
    '<button class="tb-chip" data-page="' + esc(route.page) + '" onclick="showPageFromChip(this)">' + esc(route.label) + '</button>');

  setHTML('overview-freshness', overview.stale
    ? '<strong>Saved snapshot is stale.</strong> ' + esc(overview.eventsBehind || 0) + ' newer event' + ((overview.eventsBehind || 0) === 1 ? '' : 's') + ' exist. The last-known outcome remains visible; regenerate pipeline state for a current recommendation.'
    : '');
}

function overviewProofText(proof) {
  if (!proof) return 'Proof unavailable';
  if (proof.expected !== null && proof.expected !== undefined) return proof.attached + '/' + proof.expected + ' proof attached';
  if (proof.attached > 0) return proof.attached + ' attached · expected coverage unknown';
  return proof.availability === 'unknown' ? 'Proof expectation unknown' : 'No proof attached';
}

function overviewStageIcon(state) {
  return ({ passed: '✓', failed: '!', blocked: '×', in_progress: '→', not_started: '○', unknown: '?' })[state] || '?';
}

function renderOverviewProofRail(s) {
  var stages = (s.overview && s.overview.stages) || [];
  if (!stages.length) {
    setHTML('overview-proof-rail', '<li class="overview-proof-empty"><strong>No stage proof yet.</strong><span>Start a run and canonical stage evidence will appear here.</span></li>');
    return;
  }
  setHTML('overview-proof-rail', stages.map(function(stage) {
    var source = stage.source && stage.source.path ? stage.source.path : 'Source unavailable';
    var meta = [stage.owner || 'Owner unavailable'];
    if (stage.elapsed !== null && stage.elapsed !== undefined) meta.push(Math.round(stage.elapsed / 1000) + 's elapsed');
    return '<li class="overview-proof-step ' + esc(stage.state) + '" tabindex="0" aria-label="' +
      esc(stage.label + ': ' + stage.state.replace('_', ' ') + '. ' + overviewProofText(stage.proof) + '. ' + source) + '">' +
      '<span class="overview-proof-mark" aria-hidden="true">' + esc(overviewStageIcon(stage.state)) + '</span>' +
      '<div class="overview-proof-copy"><span class="overview-proof-stage">' + esc(stage.label) + '</span>' +
      '<strong>' + esc(stage.state.replace('_', ' ')) + '</strong>' +
      '<span>' + esc(overviewProofText(stage.proof)) + '</span>' +
      '<span>' + esc(meta.join(' · ')) + '</span>' +
      '<span class="overview-source">' + esc(source) + '</span>' +
      (stage.primaryBlocker ? '<span class="overview-proof-blocker">' + esc(stage.primaryBlocker) + '</span>' : '') +
      '</div></li>';
  }).join(''));
}

function renderExecutiveMissionBrief(s) {
  var readiness = s.readiness || { status: 'unknown', coverage: { percent: null }, checks: [], blockers: [] };
  var pendingApprovals = (s.pendingApprovals || []).length;
  var openDecisionCount = (((s.decisions || {}).runs || []).reduce(function(sum, run) {
    return sum + ((run.decisions || []).filter(function(d) { return (d.status || 'pending') === 'pending'; }).length);
  }, 0));
  var verdicts = { blocked: 'BLOCKED', at_risk: 'AT RISK', ready: 'READY', unknown: 'NOT EVALUATED' };
  var firstBlocker = (readiness.blockers || [])[0];
  var firstConcern = (readiness.checks || []).find(function(item) { return item.status !== 'pass'; });
  var nextAction = firstBlocker
    ? (firstBlocker.label || 'Resolve release blocker') + ': ' + (firstBlocker.detail || 'review the linked source before shipment.')
    : readiness.status === 'unknown'
      ? ((readiness.coverage && readiness.coverage.runs && readiness.coverage.runs.total === 0)
        ? 'Start an RStack run to evaluate release readiness.'
        : 'Attach task validation and pipeline proof before making a release decision.')
      : readiness.status === 'at_risk' && firstConcern
        ? (firstConcern.label || 'Review readiness concern') + ': ' + (firstConcern.summary || 'review this signal before shipment.')
        : openDecisionCount
          ? 'Review ' + openDecisionCount + ' pending architecture/product decision' + (openDecisionCount === 1 ? '' : 's') + '.'
          : 'No manager-blocking action detected in the current scope.';
  var verdict = verdicts[readiness.status] || 'NOT EVALUATED';
  setText('executive-readiness-verdict', verdict);
  setText('executive-next-action', nextAction);
  setText('executive-governance-score', readiness.coverage && readiness.coverage.percent !== null && readiness.coverage.percent !== undefined ? readiness.coverage.percent + '%' : '—');
  setText('executive-decision-summary', pendingApprovals ? pendingApprovals + ' approval' + (pendingApprovals === 1 ? '' : 's') + ' pending' : openDecisionCount ? openDecisionCount + ' decision' + (openDecisionCount === 1 ? '' : 's') + ' pending' : 'No pending manager decision');
  var risks = (readiness.checks || []).filter(function(item) {
    return ['tasks', 'approvals', 'validation', 'pipeline'].indexOf(item.id) >= 0;
  }).map(function(item) {
    return {
      label: item.label,
      value: item.status === 'pass' ? '✓' : item.status === 'fail' ? '!' : item.status === 'warning' ? '~' : '?',
      tone: item.status === 'pass' ? 'ok' : item.status === 'fail' ? 'danger' : item.status === 'warning' ? 'warn' : 'info'
    };
  });
  setHTML('executive-risk-strip', risks.map(function(risk) {
    return '<div class="risk-chip ' + risk.tone + '"><b>' + esc(risk.value) + '</b><span>' + esc(risk.label) + '</span></div>';
  }).join(''));
}

// ── [wave:command] Executive rollup + pipeline next action (#94 / #156) ──
// The page skeleton (ui/pages/index.js) is shared across parallel page work,
// so this module owns its new DOM: panels are injected once, then re-rendered
// on every snapshot like everything else.
function ensureCommandWavePanels() {
  if (document.getElementById('command-exec-rollup-panel')) return;
  var page = document.getElementById('page-command');
  if (!page) return;
  var anchor = page.querySelector('.executive-grid');
  if (!anchor) return;
  anchor.insertAdjacentHTML('afterend',
    '<div class="panel next-action-panel" id="command-next-action-panel">' +
      '<div class="panel-head"><span class="panel-title">Pipeline Next Action</span><span class="panel-note mono" id="command-next-action-run"></span></div>' +
      '<div class="panel-body" id="command-next-action"></div>' +
    '</div>' +
    '<div class="panel exec-rollup-panel" id="command-exec-rollup-panel">' +
      '<div class="panel-head"><span class="panel-title">Executive Rollup</span><span class="panel-note" id="command-exec-rollup-note"></span></div>' +
      '<div class="panel-body"><div class="exec-rollup-strip" id="command-exec-rollup"></div></div>' +
    '</div>');
}

function fmtCompactCount(value) {
  value = Number(value) || 0;
  if (value >= 1000000) return (Math.round(value / 100000) / 10) + 'M';
  if (value >= 1000) return (Math.round(value / 100) / 10) + 'k';
  return String(value);
}

function runSpend(run) {
  return Number((run.totals && run.totals.cost_usd) || (run.metrics && run.metrics.cumulative_cost_usd) || 0);
}

function runTokens(run) {
  if (run.totals && run.totals.tokens) return Number(run.totals.tokens) || 0;
  var metricTokens = run.metrics && run.metrics.cumulative_tokens;
  if (metricTokens && typeof metricTokens === 'object') return Number(metricTokens.total) || 0;
  return Number(metricTokens) || 0;
}

// The 30-second global-exec read (#94): runs by status, spend, tokens,
// task pass-rate, open decisions — computed from the SCOPED snapshot so the
// strip follows the project/run selector. Plus schema-version visibility
// (#156): rollup + manifest schema versions for the selected run.
function renderCommandExecRollup(s) {
  var runs = s.runs || [];
  var statusCounts = { active: 0, done: 0, stalled: 0, ended: 0, idle: 0 };
  var spend = 0;
  var tokens = 0;
  runs.forEach(function(run) {
    var status = run.derivedStatus || 'idle';
    if (statusCounts[status] === undefined) statusCounts[status] = 0;
    statusCounts[status] += 1;
    spend += runSpend(run);
    tokens += runTokens(run);
  });
  var counts = taskStatusCounts(allTasks(s));
  var finished = counts.PASS + counts.FAIL;
  var passRate = finished ? Math.round(counts.PASS / finished * 100) + '%' : '—';
  var openDecisions = (s.decisions && s.decisions.totals && s.decisions.totals.pending) || 0;

  setText('command-exec-rollup-note', runs.length + ' run' + (runs.length === 1 ? '' : 's') + ' in scope');

  var runsDetail = statusCounts.active + ' active · ' + statusCounts.done + ' done' +
    (statusCounts.stalled ? ' · ' + statusCounts.stalled + ' stalled' : '');
  var stats = [
    { value: runs.length, label: 'Runs', detail: runsDetail },
    { value: '$' + spend.toFixed(2), label: 'Spend so far', detail: 'AI cost across runs in scope' },
    { value: tokens ? fmtCompactCount(tokens) : '—', label: 'Tokens', detail: tokens ? 'input + output, all runs' : 'no token telemetry recorded' },
    { value: passRate, label: 'Task pass rate', detail: finished ? counts.PASS + ' of ' + finished + ' finished tasks passed' : 'no finished tasks yet' },
    { value: openDecisions, label: 'Open decisions', detail: openDecisions ? 'waiting in the Decision Queue' : 'nothing waiting on a human call' }
  ];
  var schema = execSchemaBadge(runs);
  var html = stats.map(function(stat) {
    return '<div class="exec-stat"><div class="exec-stat-v">' + esc(stat.value) + '</div>' +
      '<div class="exec-stat-l">' + esc(stat.label) + '</div>' +
      '<div class="exec-stat-s">' + esc(stat.detail) + '</div></div>';
  }).join('') +
    '<div class="exec-stat"><div class="exec-stat-v schema-badge mono" id="command-schema-version">' + esc(schema.value) + '</div>' +
    '<div class="exec-stat-l">State schema</div>' +
    '<div class="exec-stat-s">' + esc(schema.detail) + '</div></div>';
  setHTML('command-exec-rollup', html);
}

function execSchemaBadge(runs) {
  if (runs.length !== 1) {
    return { value: '—', detail: 'select a single run to see its schema versions' };
  }
  var run = runs[0];
  var rollupVersion = (run.pipelineRollup && run.pipelineRollup.schema_version) || null;
  var manifestVersion = (run.manifest && run.manifest.schema_version) || null;
  return {
    value: 'rollup v' + (rollupVersion || '?') + ' · manifest v' + (manifestVersion || '?'),
    detail: (rollupVersion && manifestVersion) ? 'pipeline-state.json + manifest.json schema versions' : 'unstamped files show v?'
  };
}

// Which run does the exec care about right now? The scoped run if one is
// selected; otherwise the newest active run; otherwise the newest run that
// has pipeline state at all. Runs arrive newest-first from the state layer.
function commandFocusRun(s) {
  var runs = s.runs || [];
  if (!runs.length) return null;
  if (runs.length === 1) return runs[0];
  var withRollup = runs.filter(function(run) { return run.pipelineRollup; });
  var active = withRollup.filter(function(run) { return run.derivedStatus === 'active'; });
  return active[0] || withRollup[0] || runs[0];
}

function showPageFromChip(el) {
  showPage(el.getAttribute('data-page'));
}

function nextActionChip(kind) {
  if (kind === 'approval') return { page: 'approvals', label: 'Review in Approvals', cls: 'warn' };
  if (kind === 'guardrail_blocked' || kind === 'failed') return { page: 'alerts-guardrails', label: 'Open Alerts & Guardrails', cls: 'danger' };
  if (kind === 'retry') return { page: 'alerts-guardrails', label: 'Watch in Alerts & Guardrails', cls: 'warn' };
  if (kind === 'complete') return { page: 'run-report', label: 'Open Run Report', cls: '' };
  if (kind === 'active' || kind === 'pending') return { page: 'workflow', label: 'View Workflow Map', cls: '' };
  return { page: 'diagnostics', label: 'Open Diagnostics', cls: '' };
}

// #156: the deterministic next-action from the pipeline-state rollup — the
// exact sentence the "rstack-agents pipeline status" CLI prints, rendered for
// the selected run scope with a chip that jumps to the tab holding the action.
function renderCommandNextAction(s) {
  var run = commandFocusRun(s);
  if (!run) {
    setText('command-next-action-run', '');
    setHTML('command-next-action', emptyHtml('No runs loaded yet', 'Start an RStack run and the pipeline recommendation appears here.'));
    return;
  }
  setText('command-next-action-run', (run.runId || '').slice(-24));
  var rollup = run.pipelineRollup;
  if (!rollup || !rollup.next_action) {
    setHTML('command-next-action', emptyHtml('No pipeline state recorded for this run',
      'Run "rstack-agents pipeline status --regenerate" to build pipeline-state.json from the run artifacts.'));
    return;
  }
  var next = rollup.next_action;
  var chipInfo = nextActionChip(next.kind);
  var tone = next.kind === 'guardrail_blocked' || next.kind === 'failed' ? 'danger'
    : next.kind === 'approval' || next.kind === 'retry' ? 'warn'
    : next.kind === 'complete' ? 'ok' : 'info';
  var meta = [];
  if (next.stage_id) meta.push('stage ' + next.stage_id);
  if (next.task_id) meta.push('task ' + next.task_id);
  if (next.artifact) meta.push(next.artifact);
  meta.push('pipeline ' + (rollup.status || 'UNKNOWN'));
  meta.push(rollup.stages_passed + '/' + rollup.stages_total + ' stages passed');
  setHTML('command-next-action',
    '<div class="next-action">' +
      '<div class="next-action-icon ' + esc(tone) + '" aria-hidden="true">&#8594;</div>' +
      '<div class="next-action-main">' +
        '<div class="next-action-text">' + esc(next.text || 'No recommendation available.') + '</div>' +
        '<div class="feed-meta">' + meta.map(function(part) { return '<span>' + esc(part) + '</span>'; }).join('') + '</div>' +
      '</div>' +
      '<button class="tb-chip ' + esc(chipInfo.cls) + '" data-page="' + esc(chipInfo.page) + '" onclick="showPageFromChip(this)">' + esc(chipInfo.label) + '</button>' +
    '</div>' +
    nextActionSourceHtml(rollup));
}

// The hero states ITS OWN freshness, not the page's global "updated" chip: a
// persisted pipeline-state.json that lags the live event stream must not be
// presented as the current recommendation (#218 review — never let stale data
// look live). Fresh → CLI-parity line; stale → an honest regenerate hint.
function nextActionSourceHtml(rollup) {
  if (rollup && rollup.stale) {
    var behind = rollup.events_behind || 0;
    return '<div class="next-action-source stale">&#9888; From the last saved pipeline-state.json — ' +
      behind + ' newer event' + (behind === 1 ? '' : 's') + ' since it was computed. ' +
      'Run "rstack-agents pipeline status --regenerate" for the live recommendation.</div>';
  }
  return '<div class="next-action-source">Same recommendation the rstack-agents pipeline status CLI computes.</div>';
}
// ── end [wave:command] ────────────────────────────────────────────

function commandSummaryTitle(s, attentionItems, counts) {
  var activeRunCount = (s.activeRuns || []).length;
  if (attentionItems.length) {
    return 'Delivery is active with ' + attentionItems.length + ' attention signals';
  }
  if (activeRunCount) {
    return activeRunCount + ' run session' + (activeRunCount === 1 ? ' is' : 's are') + ' moving now';
  }
  if ((s.totalRuns || 0) > 0) {
    return 'No active runs right now, history is ready for review';
  }
  return 'No .rstack run sessions loaded yet';
}

function commandSummarySub(s, attentionItems, counts) {
  var blocked = (s.blockedGates || []).length;
  var pendingApprovals = (s.pendingApprovals || []).length;
  var diagnostics = s.diagnostics || {};
  var pendingWork = counts.PENDING + counts.READY + counts.QUEUED;
  if (attentionItems.length) {
    return blocked + ' blocked gates, ' + pendingApprovals + ' pending approvals, ' + pendingWork + ' pending tasks and ' + (diagnostics.missingValidationCount || 0) + ' missing validations are being shown from live .rstack data.';
  }
  return (s.totalRuns || 0) + ' runs, ' + (s.projectSummaries || []).length + ' projects, ' + (s.agentWork || []).length + ' agent actions and ' + (s.alerts || []).length + ' alerts are loaded from .rstack.';
}

function commandAttentionItems(s, counts) {
  var runs = s.runs || [];
  var diagnostics = s.diagnostics || {};
  var stalled = runs.filter(function(run) { return run.derivedStatus === 'stalled'; }).length;
  var blocked = (s.blockedGates || []).length;
  var pendingApprovals = (s.pendingApprovals || []).length;
  var alerts = (s.alerts || []).length;
  var missingValidation = diagnostics.missingValidationCount || 0;
  var missingBuilder = diagnostics.missingBuilderCount || 0;
  var items = [];

  if (pendingApprovals) {
    items.push({ level: 'warn', value: pendingApprovals, title: 'Human approval needed', detail: 'Queue-backed approvals waiting for a manager decision.', meta: 'Approvals' });
  }
  if (blocked) {
    items.push({ level: 'danger', value: blocked, title: 'Blocked guardrail gates', detail: 'Historical gate blocks that can slow release confidence.', meta: 'Guardrails' });
  }
  if (stalled) {
    items.push({ level: 'warn', value: stalled, title: 'Stalled run sessions', detail: 'Run sessions with no recent movement in the tracked .rstack data.', meta: 'Runs' });
  }
  if (counts.FAIL) {
    items.push({ level: 'danger', value: counts.FAIL, title: 'Failed tasks', detail: 'Tasks marked FAIL by the underlying run state.', meta: 'Workflow' });
  }
  if (counts.BLOCKED) {
    items.push({ level: 'danger', value: counts.BLOCKED, title: 'Guardrail-blocked tasks', detail: 'Attempt budget exhausted. Approve the guardrail-override entry in Approvals to allow exactly one more attempt.', meta: 'Guardrails' });
  }
  // [wave:command] July harness signals (#215): context pressure + goal loop
  // from the per-run pipeline-state rollup. Runs without a rollup contribute
  // nothing — no fabricated zeros.
  var pressureTotal = 0;
  var goalLoops = [];
  runs.forEach(function(run) {
    var rollup = run.pipelineRollup;
    if (!rollup) return;
    pressureTotal += (rollup.context_pressure && rollup.context_pressure.total) || 0;
    if (rollup.goal_loop && rollup.goal_loop.active) goalLoops.push({ runId: run.runId, loop: rollup.goal_loop });
  });
  if (pressureTotal) {
    items.push({
      level: 'warn',
      value: pressureTotal,
      title: 'Context pressure: ' + pressureTotal + ' warning' + (pressureTotal === 1 ? '' : 's') + ' — long-loop quality risk',
      detail: 'Prompts or memory blocks crossed configured size thresholds. Detect-only signal: nothing was pruned or truncated.',
      meta: 'Context'
    });
  }
  goalLoops.slice(0, 3).forEach(function(entry) {
    var loop = entry.loop;
    var verdict = loop.last_verdict ? 'last verdict ' + loop.last_verdict : 'no verdict yet';
    var criteria = loop.criteria_total ? ', ' + loop.criteria_met + '/' + loop.criteria_total + ' criteria met' : '';
    items.push({
      level: 'info',
      value: loop.iterations,
      title: 'Goal loop running — iteration ' + loop.iterations,
      detail: verdict + criteria + ' (' + entry.runId.slice(-24) + ').',
      meta: 'Goal loop'
    });
  });
  // end [wave:command]
  if (missingValidation) {
    items.push({ level: 'warn', value: missingValidation, title: 'Missing validations', detail: 'Agent work that does not yet have validation.json proof attached.', meta: 'Proof' });
  }
  if (missingBuilder) {
    items.push({ level: 'warn', value: missingBuilder, title: 'Missing builder contracts', detail: 'Tasks without builder.json summaries, decisions and file evidence.', meta: 'Agent work' });
  }
  if (alerts && !blocked && !stalled && !counts.FAIL) {
    items.push({ level: 'info', value: alerts, title: 'Alerts available', detail: 'Threshold signals are available in Alerts & Guardrails.', meta: 'Alerts' });
  }

  return items;
}

function attentionItemHtml(item) {
  return '<div class="attention-item ' + esc(item.level || 'info') + '">' +
    '<div class="attention-value">' + esc(item.value) + '</div>' +
    '<div><div class="attention-title">' + esc(item.title) + '</div><div class="attention-detail">' + esc(item.detail) + '</div></div>' +
    pill(item.level === 'danger' ? 'fail' : item.level === 'warn' ? 'warn' : 'info', item.meta || 'Review') +
  '</div>';
}

function commandStageStripHtml(s) {
  var stages = s.stageMatrix || [];
  return stages.length ? stages.map(stageMiniHtml).join('') : emptyHtml('No SDLC stage data', 'The 15-stage map appears when run tasks are loaded.');
}

function stageMiniHtml(stage) {
  var runs = stage.runs || [];
  var riskCount = runs.reduce(function(total, run) { return total + (run.riskCount || 0); }, 0);
  var evidenceCount = runs.reduce(function(total, run) { return total + (run.evidenceCount || 0); }, 0);
  var validationCount = runs.filter(function(run) { return !!run.validationStatus; }).length;
  var status = (stage.fail || 0) > 0 ? 'danger' : (stage.active || 0) > 0 ? 'active' : (stage.pass || 0) > 0 ? 'pass' : 'ready';
  var index = String(stage.id || '').slice(0, 2);
  return '<div class="stage-mini ' + esc(status) + '">' +
    '<div class="stage-mini-top"><span class="stage-index">' + esc(index || '--') + '</span>' + pill(status === 'danger' ? 'fail' : status === 'active' ? 'running' : status === 'pass' ? 'pass' : 'ready', status === 'danger' ? 'risk' : status) + '</div>' +
    '<div class="stage-mini-name">' + esc(stage.title || stage.id || 'Stage') + '</div>' +
    '<div class="stage-mini-agent">' + esc(stage.agent || 'agent') + '</div>' +
    '<div class="stage-mini-artifact">' + esc(stage.artifact || 'artifact') + '</div>' +
    '<div class="stage-mini-metrics">' +
      '<span><b>' + esc(stage.pass || 0) + '</b> pass</span>' +
      '<span><b>' + esc(stage.fail || 0) + '</b> fail</span>' +
      '<span><b>' + esc(stage.active || 0) + '</b> active</span>' +
      '<span><b>' + esc(stage.ready || 0) + '</b> ready</span>' +
    '</div>' +
    '<div class="stage-mini-foot">' + chip(evidenceCount + ' checks') + chip(validationCount + ' validations') + chip(riskCount + ' risks') + '</div>' +
  '</div>';
}

function commandProjectsHtml(s) {
  var projects = s.projectSummaries || [];
  if (!projects.length) return emptyHtml('No registered projects', 'Known project roots appear after the registry or run folders are loaded.');
  return projects.map(function(project) {
    var total = project.passed + project.failed;
    var rate = total ? Math.round(project.passed / total * 100) : 0;
    var state = project.active ? 'active' : project.stalled ? 'warn' : project.runs ? 'pass' : 'ready';
    return '<div class="command-row">' +
      '<div><div class="strong">' + esc(project.name) + '</div><div class="feed-meta"><span>' + esc(project.runs) + ' runs</span><span>' + esc(project.tasks) + ' tasks</span><span>' + esc(project.stalled) + ' stalled</span></div></div>' +
      '<div class="command-row-side">' + pill(state, project.active ? project.active + ' active' : state) + '<div class="progress"><div class="progress-fill" style="width:' + rate + '%"></div></div></div>' +
    '</div>';
  }).join('');
}

function commandAgentProofHtml(s) {
  var work = s.agentWork || [];
  var diagnostics = s.diagnostics || {};
  var evidenceActions = work.filter(function(item) { return (item.evidenceCount || 0) > 0; }).length;
  var risks = work.reduce(function(total, item) { return total + (item.riskCount || 0); }, 0);
  var recent = work.slice(0, 4);
  var summary = '<div class="proof-grid">' +
    '<div><div class="proof-value">' + esc(work.length) + '</div><div class="proof-label">agent actions</div></div>' +
    '<div><div class="proof-value">' + esc(evidenceActions) + '</div><div class="proof-label">with checks</div></div>' +
    '<div><div class="proof-value">' + esc(risks) + '</div><div class="proof-label">reported risks</div></div>' +
    '<div><div class="proof-value">' + esc(diagnostics.missingValidationCount || 0) + '</div><div class="proof-label">missing validations</div></div>' +
  '</div>';
  if (!recent.length) return summary + emptyHtml('No agent work yet', 'builder.json and validation.json data appears here.');
  return summary + '<div class="proof-list">' + recent.map(function(item) {
    return '<div class="proof-item"><div><div class="strong">' + esc(item.title || item.taskId) + '</div><div class="feed-meta"><span>' + esc(shortName(item.projectRoot)) + '</span><span>' + esc(item.stageId || item.taskId || '') + '</span></div></div>' +
      '<div class="metric-row">' + pill(item.status || 'ready') + chip((item.evidenceCount || 0) + ' checks') + chip((item.riskCount || 0) + ' risks') + '</div></div>';
  }).join('') + '</div>';
}

function commandLayersHtml(s) {
  var layers = s.layers || [];
  if (!layers.length) return emptyHtml('No layer data', 'Stack layer health appears once the snapshot is loaded.');
  return layers.map(function(layer) {
    return '<div class="command-row layer-row-mini">' +
      '<div><div class="strong">' + esc(layer.name) + '</div><div class="attention-detail">' + esc(layer.detail) + '</div></div>' +
      '<div class="command-row-side">' + pill(layer.health, layer.health) + '<div class="side-v mini">' + esc(layer.count) + '</div></div>' +
    '</div>';
  }).join('');
}

registerPage('command', {
  errLabel: 'command',
  sub: 'Operational overview across every known .rstack project, run, agent action, approval and alert.',
  render: renderCommand
});
`;
