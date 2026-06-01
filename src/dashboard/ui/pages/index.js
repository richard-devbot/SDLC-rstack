// owner: RStack developed by Richardson Gunde

export const pages = [
  ['command', '00', 'Command Center', 'Observe'],
  ['workflow', '01', 'Workflow Map', 'Observe'],
  ['projects', '02', 'Projects & Runs', 'Observe'],
  ['agent-work', '03', 'Agent Work', 'Observe'],
  ['live-feed', '04', 'Live Feed', 'Observe'],
  ['approvals', '05', 'Approvals', 'Manage'],
  ['alerts-guardrails', '06', 'Alerts & Guardrails', 'Manage'],
  ['traceability', '07', 'Traceability', 'Explore'],
  ['team-layers', '08', 'Team & Layers', 'Explore'],
  ['diagnostics', '09', 'Diagnostics', 'Explore'],
];

export function sidebarMarkup() {
  const grouped = pages.reduce((acc, page) => {
    const section = page[3];
    if (!acc[section]) acc[section] = [];
    acc[section].push(page);
    return acc;
  }, {});

  return Object.entries(grouped).map(([section, items]) =>
    `<div class="nav-section">${section}</div>` +
    items.map(([id, icon, label]) =>
      `<button class="nav-link${id === 'command' ? ' active' : ''}" data-page="${id}">` +
        `<span class="nav-icon">${icon}</span><span>${label}</span>` +
        badgeFor(id) +
      '</button>',
    ).join(''),
  ).join('');
}

export function pageMarkup() {
  return pages.map(([id, , label]) =>
    `<section class="page${id === 'command' ? ' active' : ''}" id="page-${id}">` +
      `<div class="page-head"><div><div class="eyebrow">RStack Business Hub</div><h1 class="page-title">${label}</h1><div class="page-sub" id="${id}-sub"></div></div><div class="last-updated" id="${id}-updated"></div></div>` +
      pageBody(id) +
    '</section>',
  ).join('');
}

function badgeFor(id) {
  if (id === 'approvals') return '<span class="badge" id="badge-approvals">0</span>';
  if (id === 'alerts-guardrails') return '<span class="badge" id="badge-alerts">0</span>';
  return '';
}

function pageBody(id) {
  const bodies = {
    command: `
      <div class="command-brief">
        <div>
          <div class="command-kicker">Live portfolio status</div>
          <h2 id="command-summary-title">Loading .rstack data...</h2>
          <p id="command-summary-sub">The dashboard will show real project, stage, agent, approval and alert data once the snapshot loads.</p>
        </div>
        <div class="command-status" id="command-status-chip">Loading</div>
      </div>

      <div class="kpi-grid command-kpi-grid">
        <div class="kpi blue"><div class="kpi-v" id="kpi-projects">-</div><div class="kpi-l">Projects Watched</div><div class="kpi-s" id="kpi-projects-s"></div></div>
        <div class="kpi blue"><div class="kpi-v" id="kpi-runs">-</div><div class="kpi-l">Run Sessions</div><div class="kpi-s" id="kpi-runs-s"></div></div>
        <div class="kpi green"><div class="kpi-v" id="kpi-pass">-</div><div class="kpi-l">Tasks Passed</div><div class="kpi-s" id="kpi-pass-s"></div></div>
        <div class="kpi amber"><div class="kpi-v" id="kpi-progress">-</div><div class="kpi-l">In Progress</div><div class="kpi-s" id="kpi-progress-s"></div></div>
        <div class="kpi red"><div class="kpi-v" id="kpi-pending">-</div><div class="kpi-l">Pending Work</div><div class="kpi-s" id="kpi-pending-s"></div></div>
        <div class="kpi green"><div class="kpi-v" id="kpi-evidence">-</div><div class="kpi-l">Evidence Records</div><div class="kpi-s" id="kpi-evidence-s"></div></div>
      </div>

      <div class="command-grid">
        <div class="panel command-attention-panel">
          <div class="panel-head"><span class="panel-title">Needs Attention</span><span class="panel-note" id="command-attention-count"></span></div>
          <div class="panel-body"><div class="attention-list" id="command-attention"></div></div>
        </div>
        <div class="panel command-stage-panel">
          <div class="panel-head"><span class="panel-title">SDLC Stage Health</span><span class="panel-note" id="command-stage-count"></span></div>
          <div class="panel-body"><div class="command-stage-strip" id="command-stage-strip"></div></div>
        </div>
      </div>

      <div class="command-grid-3">
        <div class="panel"><div class="panel-head"><span class="panel-title">Active Delivery</span><span class="panel-note" id="command-project-count"></span></div><div class="panel-body"><div class="stack-list" id="command-projects"></div></div></div>
        <div class="panel"><div class="panel-head"><span class="panel-title">Agent Work & Proof</span><span class="panel-note" id="command-agent-count"></span></div><div class="panel-body" id="command-agent-proof"></div></div>
        <div class="panel"><div class="panel-head"><span class="panel-title">Stack Layer Health</span><span class="panel-note" id="command-layer-count"></span></div><div class="panel-body"><div class="stack-list" id="command-layers"></div></div></div>
      </div>

      <div class="panel command-feed-panel">
        <div class="panel-head"><span class="panel-title">Recent Live Activity</span><span class="panel-note" id="command-feed-count"></span></div>
        <div class="panel-body"><div class="feed-list command-feed-list" id="command-feed"></div></div>
      </div>
    `,
    workflow: `
      <div class="workflow-studio">
        <div class="workflow-hero">
          <div>
            <div class="workflow-kicker">Agent workspace map</div>
            <h2>Every SDLC stage, every agent handoff, every run state</h2>
            <p>Inspired by the RStack workspace tour, but rendered from live .rstack stage data so managers can see what each agent is doing without losing the underlying proof.</p>
          </div>
          <div class="workflow-hud">
            <div><span id="workflow-count">-</span><label>Stages</label></div>
            <div><span id="workflow-runs">-</span><label>Runs tracked</label></div>
            <div><span id="workflow-active-stages">-</span><label>Active stages</label></div>
            <div><span id="workflow-validations">-</span><label>Validations</label></div>
          </div>
        </div>

        <div class="workflow-legend">
          <span><i class="legend-dot pass"></i>Finished</span>
          <span><i class="legend-dot running"></i>In progress</span>
          <span><i class="legend-dot ready"></i>Up next</span>
          <span><i class="legend-dot fail"></i>Needs review</span>
        </div>

        <div class="workflow-map-layout">
          <div class="workflow-map-main">
            <div class="workflow-rail" id="workflow-rail"></div>
            <div class="workflow-stage-grid" id="workflow-grid"></div>
          </div>
          <aside class="workflow-inspector" id="workflow-inspector"></aside>
        </div>
      </div>
    `,
    projects: '<div class="grid-2"><div class="panel"><div class="panel-head"><span class="panel-title">Known Projects</span><span class="panel-note" id="projects-count"></span></div><div class="panel-body"><div class="grid-3" id="projects-grid"></div></div></div><div class="panel"><div class="panel-head"><span class="panel-title">Run Sessions</span><span class="panel-note" id="runs-count"></span></div><div class="table-wrap"><table><thead><tr><th>Status</th><th>Run</th><th>Project</th><th>Tasks</th><th>Cost</th></tr></thead><tbody id="runs-table"></tbody></table></div></div></div>',
    'agent-work': '<div class="panel"><div class="panel-head"><span class="panel-title">Agent Work by Run</span><span class="panel-note" id="agent-work-count"></span></div><div class="panel-body" id="agent-work-list"></div></div>',
    'live-feed': '<div class="panel"><div class="panel-head"><span class="panel-title">Event Stream</span><span class="panel-note" id="live-feed-count"></span></div><div class="panel-body"><div class="feed-list" id="live-feed-list"></div></div></div>',
    approvals: '<div class="grid-2"><div class="panel"><div class="panel-head"><span class="panel-title">Actionable Queue</span><span class="panel-note" id="approvals-count"></span></div><div class="panel-body"><div class="stack-list" id="approvals-list"></div></div></div><div class="panel"><div class="panel-head"><span class="panel-title">Resolved</span></div><div class="panel-body"><div class="stack-list" id="approvals-resolved"></div></div></div></div>',
    'alerts-guardrails': '<div class="grid-2"><div class="panel"><div class="panel-head"><span class="panel-title">Alerts</span><span class="panel-note" id="alerts-count"></span></div><div class="panel-body"><div class="stack-list" id="alerts-list"></div></div></div><div class="panel"><div class="panel-head"><span class="panel-title">Blocked Gates</span><span class="panel-note" id="blocked-count"></span></div><div class="panel-body"><div class="stack-list" id="blocked-list"></div></div></div></div>',
    traceability: '<div id="traceability-list"></div>',
    'team-layers': '<div class="grid-2"><div class="panel"><div class="panel-head"><span class="panel-title">Stack Layers</span></div><div class="panel-body"><div class="grid-3" id="layers-grid"></div></div></div><div class="panel"><div class="panel-head"><span class="panel-title">Framework Breakdown</span></div><div class="table-wrap"><table><thead><tr><th>Framework</th><th>Runs</th><th>Pass</th><th>Fail</th><th>Cost</th></tr></thead><tbody id="framework-table"></tbody></table></div></div></div>',
    diagnostics: '<div class="grid-2"><div class="panel"><div class="panel-head"><span class="panel-title">Data Health</span></div><div class="panel-body" id="diagnostics-health"></div></div><div class="panel"><div class="panel-head"><span class="panel-title">Source Roots</span></div><div class="panel-body"><div class="stack-list" id="diagnostics-roots"></div></div></div></div>',
  };
  return bodies[id] ?? '';
}
