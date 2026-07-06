// owner: RStack developed by Richardson Gunde
//
// Studio page module — renders into #page-studio. Plain client JS
// concatenated into the served bundle by ui/client.js; self-registers its
// renderer with the page registry (ui/lib.js).

export const studioScript = `
// ── page: studio ────────────────────────────────────────────────
// ── Studio: Jarvis-style live agent workspace (issue #44) ───────────────────
// Personas translate stage ids into people a manager recognizes — straight
// from the workspace-v8 concept: agents introduce themselves.
var STAGE_PERSONAS = {
  '00-environment': ['DevOps Engineer', 'Prepare the Workshop'],
  '01-transcript': ['Business Analyst', 'Listen to the Customer'],
  '02-requirements': ['Product Manager', 'Define What to Build'],
  '03-documentation': ['Technical Writer', 'Write It Down'],
  '04-planning': ['Delivery Manager', 'Plan the Work'],
  '05-jira': ['Scrum Master', 'Create the Tickets'],
  '06-architecture': ['Solution Architect', 'Design the System'],
  '07-code': ['Senior Developer', 'Build the Software'],
  '08-testing': ['QA Engineer', 'Prove It Works'],
  '09-deployment': ['Release Engineer', 'Ship It'],
  '10-summary': ['Program Manager', 'Report the Outcome'],
  '11-feedback-loop': ['Quality Coach', 'Close the Loop'],
  '12-security-threat-model': ['Security Engineer', 'Find the Threats'],
  '13-compliance-checker': ['Compliance Officer', 'Check the Rules'],
  '14-cost-estimation': ['FinOps Analyst', 'Count the Cost'],
};
var STUDIO_STAGE_ORDER = Object.keys(STAGE_PERSONAS);
var STUDIO_NARRATION = { text: '', shown: 0, timer: null };
var STUDIO_SELECTED_STAGE = null;

function studioRun(s) {
  var runs = s.runs || [];
  if (!runs.length) return null;
  var active = runs.filter(function(run) { return run.derivedStatus === 'active'; });
  return active[0] || runs[0];
}

function studioStageModel(run) {
  // stage → { status, task, voice } from the run's tasks + stage timings.
  var model = {};
  STUDIO_STAGE_ORDER.forEach(function(stageId) { model[stageId] = { status: 'queued', task: null, voice: '' }; });
  (run.tasks || []).forEach(function(task) {
    var stageIds = (task.stage_artifacts || []).map(function(artifact) { return artifact.stage_id; });
    if (!stageIds.length && task.stageId) stageIds = [task.stageId];
    stageIds.forEach(function(stageId) {
      if (!model[stageId]) return;
      var entry = model[stageId];
      var status = String(task.status || '').toUpperCase();
      var mapped = status === 'PASS' ? 'done' : status === 'IN_PROGRESS' ? 'running' : status === 'FAIL' ? 'fail' : 'queued';
      // Strongest signal wins: running > fail > done > queued.
      var rank = { running: 3, fail: 2, done: 1, queued: 0 };
      if (rank[mapped] >= rank[entry.status]) {
        entry.status = mapped;
        entry.task = task;
        entry.voice = (task.builder && (task.builder.work_done || task.builder.summary)) ||
          (mapped === 'queued' ? 'Waiting for the conveyor…' : '') || '';
      }
    });
  });
  // Stage elapsed from derived metrics marks completion even without tasks.
  Object.keys(run.stageElapsed || {}).forEach(function(stageId) {
    if (model[stageId] && model[stageId].status === 'queued') model[stageId].status = 'done';
  });
  return model;
}

function renderStudio(s) {
  var run = studioRun(s);
  var grid = document.getElementById('studio-grid');
  if (!grid) return;
  if (!run) {
    setHTML('studio-grid', emptyHtml('The studio is empty', 'Start a run and the agents take their desks.'));
    setText('studio-narration', 'No runs yet. The studio opens with the first sdlc_start.');
    return;
  }
  var totals = run.totals || {};
  var isActive = run.derivedStatus === 'active';
  setText('studio-run-label', (run.startedBy ? run.startedBy + ' · ' : '') + run.runId.slice(0, 40));
  var visor = document.getElementById('studio-visor');
  if (visor) visor.className = 'studio-visor' + (isActive ? ' live' : '');
  setHTML('studio-hud',
    '<div><span>' + fmtDur(totals.duration_ms) + '</span><label>elapsed</label></div>' +
    '<div><span>' + (totals.tasks_passed || 0) + '</span><label>passed</label></div>' +
    '<div><span>' + (totals.tool_calls || 0) + '</span><label>tool calls</label></div>' +
    '<div><span>' + (totals.quality_avg !== null && totals.quality_avg !== undefined ? Math.round(totals.quality_avg * 100) + '%' : '—') + '</span><label>quality</label></div>');

  // The Manager narrates the newest event for this run.
  var latest = (s.feed || []).filter(function(item) { return item.runId === run.runId; })[0];
  var narration = latest
    ? latest.summary + (isActive ? ' — the studio is live.' : '')
    : 'Studio idle. Last run: ' + ((run.manifest && run.manifest.goal) || run.runId).slice(0, 80);
  typeNarration(narration);

  var model = studioStageModel(run);
  setHTML('studio-grid', STUDIO_STAGE_ORDER.map(function(stageId) {
    var persona = STAGE_PERSONAS[stageId];
    var entry = model[stageId];
    var voice = entry.voice ? '“' + entry.voice.slice(0, 110) + (entry.voice.length > 110 ? '…' : '') + '”' : '';
    var badge = entry.status === 'running' ? '● WORKING NOW' : entry.status === 'done' ? '✓ COMPLETE' : entry.status === 'fail' ? '✗ NEEDS REVIEW' : '○ QUEUED';
    return '<div class="workstation ' + entry.status + (stageId === STUDIO_SELECTED_STAGE ? ' selected' : '') + '" data-stage="' + esc(stageId) + '" onclick="openStudioStage(this)">' +
      '<div class="ws-head"><span class="ws-id mono">' + esc(stageId.slice(0, 2)) + '</span><span class="ws-status-dot"></span></div>' +
      '<div class="ws-business">' + esc(persona[1]) + '</div>' +
      '<div class="ws-persona mono">' + esc(persona[0]) + '</div>' +
      '<div class="ws-badge mono">' + badge + '</div>' +
      (voice ? '<div class="ws-voice">' + esc(voice) + '</div>' : '') +
    '</div>';
  }).join(''));
  if (STUDIO_SELECTED_STAGE) renderStudioInspector(run, model, STUDIO_SELECTED_STAGE);
}

function typeNarration(text) {
  if (text === STUDIO_NARRATION.text) return;
  STUDIO_NARRATION.text = text;
  STUDIO_NARRATION.shown = 0;
  clearInterval(STUDIO_NARRATION.timer);
  STUDIO_NARRATION.timer = setInterval(function() {
    STUDIO_NARRATION.shown += 3;
    var el = document.getElementById('studio-narration');
    if (!el) { clearInterval(STUDIO_NARRATION.timer); return; }
    el.textContent = STUDIO_NARRATION.text.slice(0, STUDIO_NARRATION.shown) + (STUDIO_NARRATION.shown < STUDIO_NARRATION.text.length ? '▌' : '');
    if (STUDIO_NARRATION.shown >= STUDIO_NARRATION.text.length) clearInterval(STUDIO_NARRATION.timer);
  }, 30);
}

function openStudioStage(el) {
  STUDIO_SELECTED_STAGE = el.getAttribute('data-stage');
  if (STATE) applyState(STATE);
}

function renderStudioInspector(run, model, stageId) {
  var panel = document.getElementById('studio-inspector');
  if (!panel) return;
  var persona = STAGE_PERSONAS[stageId] || ['Agent', stageId];
  var entry = model[stageId] || { status: 'queued', task: null };
  var task = entry.task;
  panel.style.display = 'block';
  var checks = task && task.validation
    ? '<div class="metric-row">' + pill('pass', task.validation.pass_checks + '/' + task.validation.total_checks + ' checks') +
      (task.validation.failed_checks || []).slice(0, 3).map(function(name) { return pill('fail', name); }).join('') + '</div>'
    : '';
  panel.innerHTML =
    '<div class="panel-head"><span class="panel-title">' + esc(persona[0]) + ' — ' + esc(persona[1]) + '</span>' +
    '<button class="drawer-close" onclick="closeStudioInspector()">x</button></div>' +
    '<div class="panel-body">' +
      (task
        ? '<div class="strong">' + esc(task.title || task.id) + '</div>' +
          '<div class="muted">' + esc(task.description || '') + '</div>' +
          (task.builder && task.builder.work_done ? '<div class="ws-voice">“' + esc(task.builder.work_done) + '”</div>' : '') +
          checks +
          '<div class="chips">' + (task.specialists || []).map(function(name) { return chip(name); }).join('') + '</div>' +
          '<button class="tb-chip" data-runid="' + esc(run.runId) + '" onclick="openDrawerRow(this)">Open full run</button>'
        : '<div class="muted">No task routed to this stage yet — ' + esc(persona[0]) + ' is ' + (entry.status === 'done' ? 'finished.' : 'waiting at their desk.') + '</div>') +
    '</div>';
}

function closeStudioInspector() {
  STUDIO_SELECTED_STAGE = null;
  var panel = document.getElementById('studio-inspector');
  if (panel) panel.style.display = 'none';
}

registerPage('studio', {
  errLabel: 'studio',
  sub: 'The live agent studio — every stage as a workstation, the Manager narrating progress, status as glow. Click an agent for their report.',
  render: renderStudio
});
`;
