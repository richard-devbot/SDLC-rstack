// owner: RStack developed by Richardson Gunde

export const pages = [
  ['command', '00', 'Command Center', 'Deliver'],
  ['projects', '02', 'Projects & Runs', 'Deliver'],
  ['workflow', '01', 'Workflow Map', 'Deliver'],
  ['run-analytics', '10', 'Run Analytics', 'Deliver'],
  ['studio', '12', 'Studio', 'Deliver'],
  ['business-flex', '15', 'Business Flex', 'Deliver'],
  ['traceability', '07', 'Requirements & Traceability', 'Quality'],
  ['run-report', '13', 'Run Report', 'Quality'],
  ['release-readiness', '17', 'Release Readiness', 'Quality'],
  ['agent-work', '03', 'Agent Work', 'Quality'],
  ['approvals', '05', 'Approvals', 'Govern'],
  ['decisions', '16', 'Decisions / Readiness', 'Govern'],
  ['security', '18', 'Security', 'Govern'],
  ['compliance', '19', 'Compliance', 'Govern'],
  ['cost-budget', '20', 'Cost & Budget', 'Govern'],
  ['live-feed', '04', 'Live Feed', 'Operate'],
  ['alerts-guardrails', '06', 'Alerts & Guardrails', 'Operate'],
  ['team', '11', 'Team & Presence', 'Operate'],
  ['team-layers', '08', 'Team & Layers', 'Operate'],
  ['diagnostics', '09', 'Diagnostics', 'Operate'],
];

export function sidebarMarkup() {
  const grouped = pages.reduce((acc, page) => {
    const section = page[3];
    if (!acc[section]) acc[section] = [];
    acc[section].push(page);
    return acc;
  }, {});

  return Object.entries(grouped).map(([section, items]) =>
    `<div class="nav-section">${section.toUpperCase()}</div>` +
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
      <div class="mission-brief" id="executive-mission-brief">
        <div class="mission-main">
          <div class="command-kicker">Executive mission brief</div>
          <h2 id="command-summary-title">Loading .rstack data...</h2>
          <p id="command-summary-sub">The dashboard will show real project, stage, agent, approval and alert data once the snapshot loads.</p>
          <div class="mission-actions">
            <button class="tb-chip danger" onclick="showPage('alerts-guardrails')">Open blockers</button>
            <button class="tb-chip" onclick="showPage('release-readiness')">Release readiness</button>
            <button class="tb-chip" onclick="showPage('traceability')">Traceability matrix</button>
          </div>
        </div>
        <div class="mission-side">
          <div class="command-status" id="command-status-chip">Loading</div>
          <div class="mission-verdict" id="executive-readiness-verdict">—</div>
          <div class="mission-next" id="executive-next-action">Waiting for snapshot…</div>
        </div>
      </div>

      <div class="executive-grid">
        <div class="executive-card"><div class="kpi-l">Ship readiness</div><div class="kpi-v" id="executive-governance-score">—</div><div class="kpi-s">computed from gates, alerts and evidence</div></div>
        <div class="executive-card"><div class="kpi-l">Top risks</div><div class="risk-strip" id="executive-risk-strip"></div></div>
        <div class="executive-card"><div class="kpi-l">Manager decision</div><div class="strong" id="executive-decision-summary">—</div><div class="kpi-s">approvals, DoR and readiness queue</div></div>
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
    'business-flex': `
      <div class="command-brief">
        <div>
          <div class="command-kicker">Business-team flexibility</div>
          <h2 id="business-flex-title">Loading profiles, budget, and routing...</h2>
          <p id="business-flex-subcopy">This page reads real .rstack profile, budget, task routing, and run metadata.</p>
        </div>
        <div class="command-status" id="business-flex-status-chip">Loading</div>
      </div>
      <div class="kpi-grid command-kpi-grid">
        <div class="kpi blue"><div class="kpi-v" id="business-flex-profiles">-</div><div class="kpi-l">Active Profiles</div><div class="kpi-s" id="business-flex-profiles-s"></div></div>
        <div class="kpi green"><div class="kpi-v" id="business-flex-domains">-</div><div class="kpi-l">Enabled Domains</div><div class="kpi-s" id="business-flex-domains-s"></div></div>
        <div class="kpi amber"><div class="kpi-v" id="business-flex-budget">-</div><div class="kpi-l">Run Budget</div><div class="kpi-s" id="business-flex-budget-s"></div></div>
        <div class="kpi blue"><div class="kpi-v" id="business-flex-routing">-</div><div class="kpi-l">Routed Tasks</div><div class="kpi-s" id="business-flex-routing-s"></div></div>
      </div>
      <div class="grid-2">
        <div class="panel"><div class="panel-head"><span class="panel-title">Profile Packs</span><span class="panel-note" id="business-flex-profile-count"></span></div><div class="panel-body"><div class="stack-list" id="business-flex-profiles-list"></div></div></div>
        <div class="panel"><div class="panel-head"><span class="panel-title">Budget Guardrails</span><span class="panel-note" id="business-flex-budget-count"></span></div><div class="panel-body" id="business-flex-budget-list"></div></div>
      </div>
      <div class="panel"><div class="panel-head"><span class="panel-title">Agent Routing Proof</span><span class="panel-note" id="business-flex-routing-count"></span></div><div class="panel-body"><div class="stack-list" id="business-flex-routing-list"></div></div></div>
    `,
    studio: `
      <div class="studio-orchestrator panel">
        <div class="studio-manager">
          <div class="studio-manager-avatar"><span class="studio-visor" id="studio-visor"></span></div>
          <div class="studio-manager-text">
            <div class="studio-manager-name">THE MANAGER <span class="studio-run-label mono" id="studio-run-label"></span></div>
            <div class="studio-narration mono" id="studio-narration">Waiting for the studio to wake up…</div>
          </div>
          <div class="studio-hud" id="studio-hud"></div>
          <a class="tb-chip" href="/studio3d" target="_blank" rel="noopener" title="three.js live workspace">Enter the 3D Studio →</a>
        </div>
      </div>
      <div class="studio-grid" id="studio-grid"></div>
      <div class="panel studio-inspector" id="studio-inspector" style="display:none"></div>
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
    projects: '<div class="grid-2"><div class="panel"><div class="panel-head"><span class="panel-title">Known Projects</span><span class="panel-note" id="projects-count"></span></div><div class="panel-body"><div class="grid-3" id="projects-grid"></div></div></div><div class="panel"><div class="panel-head"><span class="panel-title">Run Sessions</span><span class="panel-note" id="runs-count"></span></div><div class="table-wrap"><table><thead><tr><th>Status</th><th>Run</th><th>Project</th><th>Tasks</th><th>Duration</th><th>Cost</th></tr></thead><tbody id="runs-table"></tbody></table></div></div></div>',
    'run-report': `
      <div class="panel">
        <div class="panel-head">
          <span class="panel-title">Run Report</span>
          <select class="run-select" id="report-run-select" onchange="loadRunReport(this.value)"></select>
        </div>
        <div class="panel-body">
          <div class="report-kpis" id="report-kpis"></div>
          <div class="report-grid" id="report-grid"></div>
        </div>
      </div>
    `,
    'run-analytics': `
      <div class="panel">
        <div class="panel-head">
          <span class="panel-title">Run Timeline</span>
          <select class="run-select" id="analytics-run-select" onchange="renderAnalyticsRun(this.value)"></select>
        </div>
        <div class="panel-body">
          <div class="kpi-grid" id="analytics-kpis"></div>
          <div class="gantt" id="analytics-gantt"></div>
        </div>
      </div>
      <div class="grid-2">
        <div class="panel">
          <div class="panel-head"><span class="panel-title">Avg Stage Duration (all runs)</span><span class="panel-note" id="analytics-stage-count"></span></div>
          <div class="panel-body"><div class="stage-bars" id="analytics-stage-bars"></div></div>
        </div>
        <div class="panel">
          <div class="panel-head"><span class="panel-title">Run-over-Run Trends</span><span class="panel-note" id="analytics-trend-count"></span></div>
          <div class="table-wrap"><table><thead><tr><th>Run</th><th>Duration</th><th>Tools</th><th>Pass/Fail</th><th>Quality</th><th>Cost</th></tr></thead><tbody id="analytics-trend-table"></tbody></table></div>
        </div>
      </div>
    `,
    'agent-work': '<div class="panel"><div class="panel-head"><span class="panel-title">Agent Work by Run</span><span class="panel-note" id="agent-work-count"></span></div><div class="panel-body" id="agent-work-list"></div></div>',
    'live-feed': '<div class="panel"><div class="panel-head"><span class="panel-title">Event Stream</span><span class="panel-note" id="live-feed-count"></span></div><div class="panel-body"><div class="feed-list" id="live-feed-list"></div></div></div>',
    team: `
      <div class="panel">
        <div class="panel-head"><span class="panel-title">Live Now</span><span class="panel-note" id="team-live-count"></span></div>
        <div class="panel-body"><div class="stack-list" id="team-live"></div></div>
      </div>
      <div class="grid-2">
        <div class="panel">
          <div class="panel-head"><span class="panel-title">People</span><span class="panel-note" id="team-people-count"></span></div>
          <div class="table-wrap"><table><thead><tr><th>Person</th><th>Runs</th><th>Approvals</th><th>Guidance</th><th>Last seen</th></tr></thead><tbody id="team-people-table"></tbody></table></div>
        </div>
        <div class="panel">
          <div class="panel-head"><span class="panel-title">Manager View — Projects</span><span class="panel-note" id="team-manager-count"></span></div>
          <div class="table-wrap"><table><thead><tr><th>Project</th><th>Runs</th><th>Avg duration</th><th>Pass rate</th><th>Pending gates</th></tr></thead><tbody id="team-manager-table"></tbody></table></div>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><span class="panel-title">Human Guidance Log</span><span class="panel-note" id="team-guidance-count"></span></div>
        <div class="panel-body"><div class="stack-list" id="team-guidance"></div></div>
      </div>
    `,
    approvals: '<div class="grid-2"><div class="panel"><div class="panel-head"><span class="panel-title">Actionable Queue</span><span class="panel-note" id="approvals-count"></span></div><div class="panel-body"><div class="stack-list" id="approvals-list"></div></div></div><div class="panel"><div class="panel-head"><span class="panel-title">Resolved</span></div><div class="panel-body"><div class="stack-list" id="approvals-resolved"></div></div></div></div>',
    decisions: '<div class="grid-2"><div class="panel"><div class="panel-head"><span class="panel-title">Decision Queue</span><span class="panel-note" id="decisions-count"></span></div><div class="panel-body"><div class="stack-list" id="decisions-list"></div></div></div><div class="panel"><div class="panel-head"><span class="panel-title">Definition of Ready</span><span class="panel-note" id="readiness-count"></span></div><div class="panel-body"><div class="stack-list" id="readiness-list"></div></div></div></div>',
    'release-readiness': '<div class="command-brief"><div><div class="command-kicker">Ship / no-ship control</div><h2 id="release-readiness-verdict">Computing release readiness…</h2><p id="release-readiness-sub">Conservative verdict derived from tests, blocked gates, approvals, security, compliance, and evidence completeness.</p></div><div class="command-status" id="release-readiness-chip">Loading</div></div><div class="grid-2"><div class="panel"><div class="panel-head"><span class="panel-title">Readiness Checklist</span><span class="panel-note" id="release-readiness-count"></span></div><div class="panel-body"><div class="stack-list" id="release-readiness-checklist"></div></div></div><div class="panel"><div class="panel-head"><span class="panel-title">Blocking Actions</span></div><div class="panel-body"><div class="stack-list" id="release-readiness-blockers"></div></div></div></div>',
    security: '<div class="grid-2"><div class="panel"><div class="panel-head"><span class="panel-title">Threat Severity Heatmap</span><span class="panel-note" id="security-threat-count"></span></div><div class="panel-body" id="security-threat-heatmap"></div></div><div class="panel"><div class="panel-head"><span class="panel-title">Release Gate</span></div><div class="panel-body" id="security-release-gate"></div></div></div><div class="panel"><div class="panel-head"><span class="panel-title">Security Threat Registry</span></div><div class="table-wrap"><table><thead><tr><th>Severity</th><th>Risk</th><th>Run</th><th>Mitigation</th></tr></thead><tbody id="security-threat-registry"></tbody></table></div></div>',
    compliance: '<div class="grid-2"><div class="panel"><div class="panel-head"><span class="panel-title">Compliance Scorecards</span><span class="panel-note" id="compliance-score-count"></span></div><div class="panel-body"><div class="stack-list" id="compliance-scorecards"></div></div></div><div class="panel"><div class="panel-head"><span class="panel-title">Control Coverage</span></div><div class="panel-body" id="compliance-controls"></div></div></div>',
    'cost-budget': '<div class="grid-2"><div class="panel"><div class="panel-head"><span class="panel-title">Cost & Budget Summary</span><span class="panel-note" id="cost-budget-count"></span></div><div class="panel-body" id="cost-budget-summary"></div></div><div class="panel"><div class="panel-head"><span class="panel-title">Cost Drivers & Assumptions</span></div><div class="panel-body"><div class="stack-list" id="cost-budget-drivers"></div></div></div></div>',
    'alerts-guardrails': '<div class="grid-2"><div class="panel"><div class="panel-head"><span class="panel-title">Alerts</span><span class="panel-note" id="alerts-count"></span></div><div class="panel-body"><div class="stack-list" id="alerts-list"></div></div></div><div class="panel"><div class="panel-head"><span class="panel-title">Blocked Gates</span><span class="panel-note" id="blocked-count"></span></div><div class="panel-body"><div class="stack-list" id="blocked-list"></div></div></div></div>',
    traceability: '<div id="traceability-list"></div>',
    'team-layers': '<div class="grid-2"><div class="panel"><div class="panel-head"><span class="panel-title">Stack Layers</span></div><div class="panel-body"><div class="grid-3" id="layers-grid"></div></div></div><div class="panel"><div class="panel-head"><span class="panel-title">Framework Breakdown</span></div><div class="table-wrap"><table><thead><tr><th>Framework</th><th>Runs</th><th>Pass</th><th>Fail</th><th>Cost</th></tr></thead><tbody id="framework-table"></tbody></table></div></div></div>',
    diagnostics: '<div class="grid-2"><div class="panel"><div class="panel-head"><span class="panel-title">Data Health</span></div><div class="panel-body" id="diagnostics-health"></div></div><div class="panel"><div class="panel-head"><span class="panel-title">Source Roots</span></div><div class="panel-body"><div class="stack-list" id="diagnostics-roots"></div></div></div></div><div class="panel" style="margin-top:16px"><div class="panel-head"><span class="panel-title">Data Integrity &amp; Config Validation</span></div><div class="panel-body" id="diagnostics-integrity"></div></div>',
  };
  return bodies[id] ?? '';
}
