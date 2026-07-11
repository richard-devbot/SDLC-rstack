import { styles } from './styles.js';
import { clientScript } from './client.js';
import { artifactRenderScript } from './artifact-render.js';
import { freshnessScript } from './freshness.js';
import { pageMarkup, sidebarMarkup } from './pages/index.js';

// owner: RStack developed by Richardson Gunde

export function dashboardHtml(port) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>RStack Business Hub</title>
<style>${styles}</style>
</head>
<body>
<div id="shell">
  <aside id="sidebar">
    <div class="brand">
      <div class="brand-row">
        <div class="brand-mark">R</div>
        <div>
          <div class="brand-name">rstack</div>
          <div class="brand-sub">business observability</div>
        </div>
        <div class="ws-dot" id="ws-dot" style="margin-left:auto"></div>
      </div>
    </div>
    <nav class="nav" aria-label="Dashboard pages">${sidebarMarkup()}</nav>
    <div class="side-kpis">
      <div class="side-kpi"><div class="side-v" id="side-runs">-</div><div class="side-l">Runs</div></div>
      <div class="side-kpi"><div class="side-v" id="side-cost">-</div><div class="side-l">Spend</div></div>
      <div class="side-kpi"><div class="side-v" id="side-pass">-</div><div class="side-l">Passed</div></div>
      <div class="side-kpi"><div class="side-v" id="side-agents">-</div><div class="side-l">Agents</div></div>
    </div>
  </aside>
  <main id="main">
    <header id="topbar">
      <div class="tb-title" id="page-title">Command Center</div>
      <div class="tb-scope" role="group" aria-label="Dashboard data scope">
        <label class="scope-control"><span class="scope-label">Project</span>
          <select class="run-select" id="scope-project" onchange="setScopeProject(this.value)" title="Project scope" aria-label="Project scope"><option value="">All projects</option></select>
        </label>
        <label class="scope-control"><span class="scope-label">Run</span>
          <select class="run-select" id="scope-run" onchange="setScopeRun(this.value)" title="Run scope" aria-label="Run scope"><option value="">All runs</option></select>
        </label>
        <div class="scope-context" id="scope-context">All project evidence</div>
      </div>
      <div id="scope-live" role="status" aria-live="polite" class="sr-only"></div>
      <div class="tb-status" title="Data freshness — live, stale, or disconnected"><span class="status-dot status-connecting" id="status-dot"></span><span id="status-text">Loading...</span></div>
      <div id="conn-live" role="status" aria-live="polite" class="sr-only"></div>
      <div class="tb-actions">
        <button class="tb-chip" id="btn-alerts" onclick="showPage('alerts-guardrails')">Alerts <span id="alert-count">-</span></button>
        <button class="tb-chip" id="btn-approvals" onclick="showPage('approvals')">Approvals <span id="approval-count">-</span></button>
      </div>
    </header>
    <div id="content">
      <div id="err" role="alert"></div>
      ${pageMarkup()}
    </div>
  </main>
</div>
<div id="signal-toast-region" role="status" aria-live="polite" aria-atomic="true"></div>
<div id="drawer-overlay" onclick="closeDrawer()" aria-hidden="true"></div>
<aside id="drawer-panel" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
  <div class="drawer-head">
    <div>
      <div class="drawer-title" id="drawer-title">Run</div>
      <div class="drawer-sub" id="drawer-sub">-</div>
    </div>
    <button class="drawer-close" onclick="closeDrawer()" aria-label="Close run details">x</button>
  </div>
  <div class="drawer-body" id="drawer-body"></div>
</aside>
<script>${artifactRenderScript}</script>
<script>${freshnessScript}</script>
<script>${clientScript(port)}</script>
</body>
</html>`;
}
