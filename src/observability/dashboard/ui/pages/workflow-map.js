// owner: RStack developed by Richardson Gunde
//
// Workflow Map page module — renders into #page-workflow. Plain client JS
// concatenated into the served bundle by ui/client.js; self-registers its
// renderer with the page registry (ui/lib.js).

export const workflowMapScript = `
// ── page: workflow ────────────────────────────────────────────────
var WORKFLOW_SELECTED_STAGE_ID = null;

// WORKFLOW_STAGE_META is generated from the canonical harness stage list
// by ui/stage-meta.js and emitted ahead of this module in the bundle.

function renderWorkflow(s) {
  var stages = s.stageMatrix || [];
  var runs = s.runs || [];
  var activeStages = stages.filter(function(stage) { return (stage.active || 0) > 0; }).length;
  var validations = stages.reduce(function(total, stage) {
    return total + (stage.runs || []).filter(function(run) { return !!run.validationStatus; }).length;
  }, 0);

  setText('workflow-count', stages.length);
  setText('workflow-runs', runs.length);
  setText('workflow-active-stages', activeStages);
  setText('workflow-validations', validations);

  if (!WORKFLOW_SELECTED_STAGE_ID || !stages.some(function(stage) { return stage.id === WORKFLOW_SELECTED_STAGE_ID; })) {
    var focused = stages.filter(function(stage) { return (stage.fail || 0) > 0; })[0] ||
      stages.filter(function(stage) { return (stage.active || 0) > 0; })[0] ||
      stages.filter(function(stage) { return (stage.pass || 0) > 0; })[0] ||
      stages[0];
    WORKFLOW_SELECTED_STAGE_ID = focused && focused.id;
  }

  setHTML('workflow-rail', workflowRailHtml(stages));
  setHTML('workflow-grid', stages.length ? stages.map(workflowStageCardHtml).join('') : emptyHtml('No workflow data', 'Stage data appears once runs are loaded.'));
  setHTML('workflow-inspector', workflowInspectorHtml(stages.filter(function(stage) { return stage.id === WORKFLOW_SELECTED_STAGE_ID; })[0], s));
}

function workflowRailHtml(stages) {
  if (!stages.length) return '';
  return stages.map(function(stage, index) {
    var status = workflowStageStatus(stage);
    return '<button type="button" class="rail-step ' + esc(status) + (stage.id === WORKFLOW_SELECTED_STAGE_ID ? ' selected' : '') + '" data-stageid="' + esc(stage.id) + '" onclick="openWorkflowStageButton(this)">' +
      '<span>' + esc(String(index).padStart(2, '0')) + '</span>' +
      '<b>' + esc((stage.title || '').split(' ')[0] || stage.id) + '</b>' +
    '</button>';
  }).join('');
}

function workflowStageCardHtml(stage, index) {
  var meta = workflowStageMeta(stage);
  var status = workflowStageStatus(stage);
  var runs = stage.runs || [];
  var riskCount = runs.reduce(function(total, run) { return total + (run.riskCount || 0); }, 0);
  var evidenceCount = runs.reduce(function(total, run) { return total + (run.evidenceCount || 0); }, 0);
  var validationCount = runs.filter(function(run) { return !!run.validationStatus; }).length;
  var done = stage.pass || 0;
  var fail = stage.fail || 0;
  var active = stage.active || 0;
  var ready = stage.ready || 0;
  var total = Math.max(1, runs.length || done + fail + active + ready);
  var passWidth = Math.round(done / total * 100);
  var failWidth = Math.round(fail / total * 100);
  var activeWidth = Math.round(active / total * 100);
  var readyWidth = Math.max(0, 100 - passWidth - failWidth - activeWidth);

  return '<button type="button" class="workspace-stage-card ' + esc(status) + (stage.id === WORKFLOW_SELECTED_STAGE_ID ? ' selected' : '') + '" data-stageid="' + esc(stage.id) + '" onclick="openWorkflowStageButton(this)">' +
    '<div class="workspace-stage-top"><span class="workspace-stage-id">' + esc(String(index).padStart(2, '0')) + '</span>' + pill(status === 'fail' ? 'fail' : status === 'running' ? 'running' : status === 'pass' ? 'pass' : 'ready', status === 'fail' ? 'review' : status) + '</div>' +
    '<div class="workspace-agent">' +
      '<div class="agent-avatar">' + esc(String(index).padStart(2, '0')) + '</div>' +
      '<div><div class="agent-persona">' + esc(meta.persona) + '</div><div class="agent-role">' + esc(meta.role) + '</div></div>' +
    '</div>' +
    '<div class="workspace-stage-title">' + esc(stage.title || stage.id || 'Stage') + '</div>' +
    '<div class="workspace-stage-business">' + esc(meta.business) + '</div>' +
    '<div class="workspace-contract"><span>' + esc(stage.agent || 'agent') + '</span><span>' + esc(stage.artifact || 'artifact') + '</span></div>' +
    '<div class="stage-stack-bar" aria-hidden="true">' +
      '<i class="pass" style="width:' + passWidth + '%"></i>' +
      '<i class="fail" style="width:' + failWidth + '%"></i>' +
      '<i class="running" style="width:' + activeWidth + '%"></i>' +
      '<i class="ready" style="width:' + readyWidth + '%"></i>' +
    '</div>' +
    '<div class="workspace-stage-metrics">' +
      '<span><b>' + esc(done) + '</b> pass</span>' +
      '<span><b>' + esc(fail) + '</b> fail</span>' +
      '<span><b>' + esc(active) + '</b> active</span>' +
      '<span><b>' + esc(ready) + '</b> ready</span>' +
    '</div>' +
    '<div class="run-dot-row">' + runs.slice(0, 22).map(runDotHtml).join('') + (runs.length > 22 ? '<span class="run-more">+' + esc(runs.length - 22) + '</span>' : '') + '</div>' +
    '<div class="workspace-stage-foot">' + chip(evidenceCount + ' checks') + chip(validationCount + ' validations') + chip(riskCount + ' risks') + '</div>' +
  '</button>';
}

function workflowInspectorHtml(stage, s) {
  if (!stage) return emptyHtml('No stage selected', 'Pick a stage to inspect its run-level tracking.');
  var meta = workflowStageMeta(stage);
  var runs = stage.runs || [];
  var riskCount = runs.reduce(function(total, run) { return total + (run.riskCount || 0); }, 0);
  var evidenceCount = runs.reduce(function(total, run) { return total + (run.evidenceCount || 0); }, 0);
  var validationCount = runs.filter(function(run) { return !!run.validationStatus; }).length;
  var runRows = runs.map(function(run) {
    return '<div class="inspector-run">' +
      '<div><div class="strong">' + esc(shortName(run.projectRoot)) + '</div><div class="mono faint">' + esc((run.runId || '').slice(-24)) + '</div></div>' +
      '<div class="inspector-run-meta">' +
        pill(run.status || 'ready') +
        chip((run.evidenceCount || 0) + ' checks') +
        chip((run.validationStatus || 'no validation')) +
        chip((run.riskCount || 0) + ' risks') +
      '</div>' +
      '<div class="mono muted">' + esc(run.taskId || stage.id || '') + '</div>' +
    '</div>';
  }).join('');

  return '<div class="inspector-card">' +
    '<div class="inspector-eyebrow">Selected stage</div>' +
    '<div class="inspector-title">' + esc(stage.title || stage.id || 'Stage') + '</div>' +
    '<div class="inspector-subtitle">' + esc(meta.business) + ' / ' + esc(meta.persona) + '</div>' +
    '<p>' + esc(meta.desc) + '</p>' +
    '<div class="inspector-io">' +
      '<div><span>Reads</span><b>' + esc(meta.reads) + '</b></div>' +
      '<div><span>Writes</span><b>' + esc(meta.writes) + '</b></div>' +
      '<div><span>Agent</span><b>' + esc(stage.agent || 'agent') + '</b></div>' +
      '<div><span>Artifact</span><b>' + esc(stage.artifact || 'artifact') + '</b></div>' +
    '</div>' +
    '<div class="inspector-stats">' +
      '<div><b>' + esc(runs.length) + '</b><span>runs</span></div>' +
      '<div><b>' + esc(evidenceCount) + '</b><span>checks</span></div>' +
      '<div><b>' + esc(validationCount) + '</b><span>validations</span></div>' +
      '<div><b>' + esc(riskCount) + '</b><span>risks</span></div>' +
    '</div>' +
    '<div class="inspector-section-title">Run tracking</div>' +
    '<div class="inspector-run-list">' + (runRows || emptyHtml('No run rows', 'This stage is defined but no run data has been loaded yet.')) + '</div>' +
  '</div>';
}

function workflowStageMeta(stage) {
  var fallback = {
    business: stage.title || 'Stage work',
    persona: stage.agent || 'RStack Agent',
    role: 'Owns this SDLC layer',
    desc: 'Tracks status, evidence, validations and risks for this stage from the run state.',
    reads: 'previous stage output',
    writes: stage.artifact || 'stage artifact'
  };
  var meta = WORKFLOW_STAGE_META[stage.id] || {};
  return {
    business: meta.business || fallback.business,
    persona: meta.persona || fallback.persona,
    role: meta.role || fallback.role,
    desc: meta.desc || fallback.desc,
    reads: meta.reads || fallback.reads,
    writes: meta.writes || fallback.writes
  };
}

function workflowStageStatus(stage) {
  if ((stage.fail || 0) > 0) return 'fail';
  if ((stage.active || 0) > 0) return 'running';
  if ((stage.pass || 0) > 0) return 'pass';
  return 'ready';
}

function runDotHtml(run) {
  var status = String(run.status || 'READY').toUpperCase();
  var cls = status === 'PASS' ? 'pass' : status === 'FAIL' ? 'fail' : status === 'IN_PROGRESS' ? 'running' : 'ready';
  return '<span class="run-dot ' + cls + '" title="' + esc(shortName(run.projectRoot) + ' / ' + (run.runId || '') + ' / ' + status) + '"></span>';
}

function openWorkflowStageButton(btn) {
  openWorkflowStage(btn.getAttribute('data-stageid'));
}

function openWorkflowStage(stageId) {
  WORKFLOW_SELECTED_STAGE_ID = stageId;
  if (STATE) renderWorkflow(STATE);
}

registerPage('workflow', {
  errLabel: 'workflow',
  sub: 'The canonical SDLC flow, grouped by stage with pass, fail, active and ready counts from real run tasks.',
  render: renderWorkflow
});
`;
