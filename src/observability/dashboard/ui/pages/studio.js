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
// STAGE_PERSONAS / STUDIO_STAGE_ORDER are generated from the canonical
// harness stage list by ui/stage-meta.js (shared with the 3D studio).
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

// ── Approval gates & checkpoints (#352) — real governance, not decoration ──
// Gate truth comes from the SAME records the claim gate enforces: run-level
// approvals (latest-record-wins, incl. #228 stage-approval:<stage> and
// one-shot overrides with their CONSUMED lifecycle) plus the pending queue
// cards. Checkpoints come from the disk-verified rollup block (#215).
function studioTaskStage(run, taskId) {
  var task = (run.tasks || []).find(function(candidate) { return candidate.id === taskId; });
  if (!task) return null;
  var fromArtifacts = (task.stage_artifacts || []).map(function(artifact) { return artifact.stage_id; })[0];
  return fromArtifacts || task.stageId || null;
}

function studioArtifactStage(run, artifact) {
  var name = String(artifact || '');
  if (name.indexOf('stage-approval:') === 0) {
    var target = name.slice('stage-approval:'.length);
    return STUDIO_STAGE_ORDER.indexOf(target) !== -1 ? target : studioTaskStage(run, target);
  }
  if (name.indexOf('guardrail-override:') === 0) return studioTaskStage(run, name.slice('guardrail-override:'.length));
  if (name.indexOf('destructive-action:') === 0) return studioTaskStage(run, name.slice('destructive-action:'.length));
  return null; // plan.md etc. belong to the human rail, not a single desk
}

function studioGateModel(s, run) {
  var gates = { byStage: {}, humans: {} };
  function human(name) {
    if (!gates.humans[name]) gates.humans[name] = { name: name, signed: [], holding: [] };
    return gates.humans[name];
  }
  // Latest record per artifact from the run's audited ledger.
  var latest = {};
  (run.approvals || []).forEach(function(record) {
    if (record && record.artifact) latest[record.artifact] = record;
  });
  Object.keys(latest).forEach(function(artifact) {
    var record = latest[artifact];
    var stageId = studioArtifactStage(run, artifact);
    var status = String(record.status || '').toUpperCase();
    var entry = { artifact: artifact, status: status, approver: record.approver || 'unknown' };
    if (status === 'APPROVED' || status === 'CONSUMED') human(entry.approver).signed.push(entry);
    if (stageId) {
      if (!gates.byStage[stageId]) gates.byStage[stageId] = [];
      gates.byStage[stageId].push(entry);
    }
  });
  // Pending queue cards for this run = gates that are CLOSED right now.
  (s.pendingApprovals || []).forEach(function(item) {
    if (item.runId !== run.runId || !item.artifact) return;
    var stageId = studioArtifactStage(run, item.artifact);
    var entry = { artifact: item.artifact, status: 'PENDING', approver: null };
    human('Awaiting a human').holding.push(entry);
    if (stageId) {
      if (!gates.byStage[stageId]) gates.byStage[stageId] = [];
      gates.byStage[stageId].push(entry);
    }
  });
  return gates;
}

function studioGateChip(entries) {
  if (!entries || !entries.length) return '';
  var pending = entries.filter(function(entry) { return entry.status === 'PENDING'; });
  if (pending.length) {
    return '<div class="ws-gate closed" title="' + esc(pending.map(function(entry) { return entry.artifact; }).join(', ')) + '">⛔ GATE CLOSED — awaiting human sign-off</div>';
  }
  var consumed = entries.filter(function(entry) { return entry.status === 'CONSUMED'; });
  var approved = entries.filter(function(entry) { return entry.status === 'APPROVED'; });
  if (approved.length) {
    return '<div class="ws-gate open" title="' + esc(approved.map(function(entry) { return entry.artifact; }).join(', ')) + '">🔓 gate opened by ' + esc(approved[0].approver) + '</div>';
  }
  if (consumed.length) return '<div class="ws-gate spent">🎫 one-shot override consumed</div>';
  return '';
}

function studioCheckpointChip(run, stageId) {
  var stages = (run.checkpoints && run.checkpoints.stages) || [];
  var checkpoint = stages.find(function(stage) { return stage.id === stageId; });
  if (!checkpoint) return '';
  if (checkpoint.restorable) {
    return '<div class="ws-checkpoint ok" title="disk-verified restore point">💾 restore point' + (checkpoint.reason === 'legacy_unverified' ? ' (legacy)' : '') + '</div>';
  }
  if (String(checkpoint.reason || '').indexOf('corrupt') === 0) {
    return '<div class="ws-checkpoint corrupt" title="' + esc(checkpoint.reason) + '">💾 CORRUPT — restore refused</div>';
  }
  return '';
}

function renderStudioHumans(gates) {
  var names = Object.keys(gates.humans);
  var cards = names.map(function(name) {
    var person = gates.humans[name];
    var waiting = person.holding.length > 0;
    return '<div class="studio-human' + (waiting ? ' waiting' : '') + '">' +
      '<div class="studio-human-avatar" aria-hidden="true">' + (waiting ? '🧑‍💼' : '🧑‍💻') + '</div>' +
      '<div><div class="strong">' + esc(name) + '</div>' +
      (waiting
        ? '<div class="muted">holding ' + person.holding.length + ' gate(s): ' + esc(person.holding.map(function(entry) { return entry.artifact; }).slice(0, 3).join(', ')) + '</div>'
        : '<div class="muted">signed ' + person.signed.length + ': ' + esc(person.signed.map(function(entry) { return entry.artifact; }).slice(0, 3).join(', ')) + '</div>') +
      '</div></div>';
  });
  setHTML('studio-humans', cards.length
    ? '<div class="studio-humans-title mono">HUMANS AT THE GATES — agents build, people decide</div>' + cards.join('')
    : '');
}

function renderStudio(s) {
  var run = studioRun(s);
  var grid = document.getElementById('studio-grid');
  if (!grid) return;
  if (!run) {
    setHTML('studio-grid', emptyHtml('The studio is empty', 'Start a run and the agents take their desks.'));
    setHTML('studio-humans', '');
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
  var gates = studioGateModel(s, run);
  renderStudioHumans(gates);
  setHTML('studio-grid', STUDIO_STAGE_ORDER.map(function(stageId) {
    var persona = STAGE_PERSONAS[stageId];
    var entry = model[stageId];
    var voice = entry.voice ? '“' + entry.voice.slice(0, 110) + (entry.voice.length > 110 ? '…' : '') + '”' : '';
    var badge = entry.status === 'running' ? '● WORKING NOW' : entry.status === 'done' ? '✓ COMPLETE' : entry.status === 'fail' ? '✗ NEEDS REVIEW' : '○ QUEUED';
    var gateEntries = gates.byStage[stageId];
    var gateClosed = (gateEntries || []).some(function(gate) { return gate.status === 'PENDING'; });
    return '<div class="workstation ' + entry.status + (gateClosed ? ' gated' : '') + (stageId === STUDIO_SELECTED_STAGE ? ' selected' : '') + '" role="button" tabindex="0" data-stage="' + esc(stageId) + '" onclick="openStudioStage(this)">' +
      '<div class="ws-head"><span class="ws-id mono">' + esc(stageId.slice(0, 2)) + '</span><span class="ws-status-dot"></span></div>' +
      '<div class="ws-business">' + esc(persona[1]) + '</div>' +
      '<div class="ws-persona mono">' + esc(persona[0]) + '</div>' +
      '<div class="ws-badge mono">' + badge + '</div>' +
      studioGateChip(gateEntries) +
      studioCheckpointChip(run, stageId) +
      (voice ? '<div class="ws-voice">' + esc(voice) + '</div>' : '') +
    '</div>';
  }).join(''));
  if (STUDIO_SELECTED_STAGE) renderStudioInspector(run, model, STUDIO_SELECTED_STAGE, gates);
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

function renderStudioInspector(run, model, stageId, gates) {
  var panel = document.getElementById('studio-inspector');
  if (!panel) return;
  var persona = STAGE_PERSONAS[stageId] || ['Agent', stageId];
  var entry = model[stageId] || { status: 'queued', task: null };
  var task = entry.task;
  var gateEntries = (gates && gates.byStage[stageId]) || [];
  var gateDetail = gateEntries.length
    ? '<div class="ws-inspector-gates">' + gateEntries.map(function(gate) {
        return pill(gate.status === 'PENDING' ? 'warn' : gate.status === 'CONSUMED' ? 'consumed' : 'pass',
          gate.artifact + (gate.approver ? ' · ' + gate.approver : ''));
      }).join(' ') + '</div>'
    : '';
  panel.style.display = 'block';
  var checks = task && task.validation
    ? '<div class="metric-row">' + pill('pass', task.validation.pass_checks + '/' + task.validation.total_checks + ' checks') +
      (task.validation.failed_checks || []).slice(0, 3).map(function(name) { return pill('fail', name); }).join('') + '</div>'
    : '';
  panel.innerHTML =
    '<div class="panel-head"><span class="panel-title">' + esc(persona[0]) + ' — ' + esc(persona[1]) + '</span>' +
    '<button class="drawer-close" onclick="closeStudioInspector()" aria-label="Close stage inspector">x</button></div>' +
    '<div class="panel-body">' +
      (task
        ? '<div class="strong">' + esc(task.title || task.id) + '</div>' +
          '<div class="muted">' + esc(task.description || '') + '</div>' +
          (task.builder && task.builder.work_done ? '<div class="ws-voice">“' + esc(task.builder.work_done) + '”</div>' : '') +
          checks + gateDetail + studioCheckpointChip(run, stageId) +
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
