// owner: RStack developed by Richardson Gunde
// Professional light-theme dashboard HTML for the Business Hub.

export function dashboardHtml(port) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>RStack — Business Hub</title>
<style>
/* ── Reset & tokens ───────────────────────────────────────────────────────── */
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;overflow:hidden}
:root{
  --bg:#f1f5f9;
  --surface:#ffffff;
  --surface2:#f8fafc;
  --border:#e2e8f0;
  --border2:#cbd5e1;
  --text:#0f172a;
  --muted:#64748b;
  --subtle:#94a3b8;
  --accent:#f97316;
  --accent-light:#fff7ed;
  --accent-border:#fed7aa;
  --green:#10b981;
  --green-bg:#f0fdf4;
  --green-border:#bbf7d0;
  --red:#ef4444;
  --red-bg:#fef2f2;
  --red-border:#fecaca;
  --amber:#f59e0b;
  --amber-bg:#fffbeb;
  --amber-border:#fde68a;
  --blue:#3b82f6;
  --blue-bg:#eff6ff;
  --blue-border:#bfdbfe;
  --violet:#8b5cf6;
  --violet-bg:#f5f3ff;
  --sidebar:#0f172a;
  --sidebar2:#1e293b;
  --sidebar-text:#e2e8f0;
  --sidebar-muted:#94a3b8;
  --sidebar-active:rgba(249,115,22,.18);
  --sidebar-w:220px;
  --f:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;
  --m:'JetBrains Mono','Fira Code','Cascadia Code',monospace;
  --shadow:0 1px 3px rgba(0,0,0,.08),0 1px 2px rgba(0,0,0,.06);
  --shadow-md:0 4px 6px rgba(0,0,0,.06),0 2px 4px rgba(0,0,0,.04);
}
body{font-family:var(--f);background:var(--bg);color:var(--text);font-size:13.5px;line-height:1.5;display:flex;flex-direction:column}

/* ── App shell ────────────────────────────────────────────────────────────── */
#app{display:flex;height:100vh;overflow:hidden}

/* ── Sidebar ──────────────────────────────────────────────────────────────── */
#sidebar{
  width:var(--sidebar-w);flex-shrink:0;background:var(--sidebar);
  display:flex;flex-direction:column;overflow:hidden;z-index:20;
}
.sb-brand{
  padding:18px 16px 14px;border-bottom:1px solid rgba(255,255,255,.07);
  display:flex;align-items:center;gap:10px;flex-shrink:0;
}
.sb-logo{
  width:28px;height:28px;border-radius:8px;background:var(--accent);
  display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:800;color:#fff;flex-shrink:0;
}
.sb-title{font-size:13px;font-weight:700;color:var(--sidebar-text);letter-spacing:-.01em}
.sb-sub{font-size:10px;color:var(--sidebar-muted);margin-top:1px}
.sb-ws{width:6px;height:6px;border-radius:50%;background:#374151;transition:background .3s;margin-left:auto;flex-shrink:0}
.sb-ws.live{background:var(--green);box-shadow:0 0 6px var(--green)}

.sb-section{padding:14px 10px 4px;font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.09em;color:var(--sidebar-muted)}
.sb-nav{padding:0 8px;flex:1;overflow-y:auto}
.sb-link{
  display:flex;align-items:center;gap:9px;padding:8px 10px;border-radius:7px;
  cursor:pointer;transition:background .12s,color .12s;font-size:12.5px;font-weight:500;
  color:var(--sidebar-muted);border:none;background:none;width:100%;text-align:left;margin-bottom:1px;
}
.sb-link:hover{background:rgba(255,255,255,.07);color:var(--sidebar-text)}
.sb-link.active{background:var(--sidebar-active);color:var(--accent)}
.sb-link .icon{font-size:14px;flex-shrink:0;width:16px;text-align:center}
.sb-link .badge{
  margin-left:auto;min-width:18px;height:18px;border-radius:9px;
  background:var(--red);color:#fff;font-size:9px;font-weight:800;
  display:flex;align-items:center;justify-content:center;padding:0 5px;
}
.sb-footer{padding:12px 10px;border-top:1px solid rgba(255,255,255,.07);flex-shrink:0}
.sb-kpi-row{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.sb-kpi{background:var(--sidebar2);border-radius:7px;padding:8px 10px}
.sb-kpi-val{font-size:16px;font-weight:800;color:var(--sidebar-text);font-family:var(--m);line-height:1}
.sb-kpi-lbl{font-size:9px;color:var(--sidebar-muted);text-transform:uppercase;letter-spacing:.07em;margin-top:2px}

/* ── Main area ────────────────────────────────────────────────────────────── */
#main{flex:1;display:flex;flex-direction:column;overflow:hidden;min-width:0}

/* ── Top bar ──────────────────────────────────────────────────────────────── */
#topbar{
  background:var(--surface);border-bottom:1px solid var(--border);
  padding:0 20px;height:52px;display:flex;align-items:center;gap:16px;
  flex-shrink:0;box-shadow:var(--shadow);z-index:10;
}
.tb-title{font-size:14px;font-weight:700;color:var(--text);letter-spacing:-.01em}
.tb-crumb{font-size:12px;color:var(--muted)}
.tb-sep{width:1px;height:20px;background:var(--border);flex-shrink:0}
.tb-stat{display:flex;align-items:center;gap:5px;font-size:12px}
.tb-stat .dot{width:7px;height:7px;border-radius:50%;flex-shrink:0}
.tb-right{margin-left:auto;display:flex;align-items:center;gap:10px}
.tb-alert-btn{
  display:flex;align-items:center;gap:5px;padding:5px 10px;border-radius:6px;
  border:1px solid var(--border);background:var(--surface2);font-size:12px;
  cursor:pointer;color:var(--muted);transition:all .15s;
}
.tb-alert-btn:hover{border-color:var(--amber-border);background:var(--amber-bg);color:var(--amber)}
.tb-alert-btn.has-alerts{border-color:var(--red-border);background:var(--red-bg);color:var(--red)}

/* ── Page ─────────────────────────────────────────────────────────────────── */
.page{display:none;flex:1;overflow-y:auto;padding:20px}
.page.active{display:block}
.page-title{font-size:18px;font-weight:800;margin-bottom:4px;letter-spacing:-.02em}
.page-sub{font-size:13px;color:var(--muted);margin-bottom:20px}

/* ── Cards ────────────────────────────────────────────────────────────────── */
.card{background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden;box-shadow:var(--shadow)}
.card-hdr{
  padding:12px 16px;font-size:10.5px;font-weight:700;text-transform:uppercase;
  letter-spacing:.07em;color:var(--muted);border-bottom:1px solid var(--border);
  display:flex;align-items:center;justify-content:space-between;
}
.card-hdr .live-dot{width:6px;height:6px;border-radius:50%;background:var(--green);animation:pulse-g 1.8s infinite;flex-shrink:0}
@keyframes pulse-g{0%,100%{box-shadow:0 0 0 0 rgba(16,185,129,.4)}70%{box-shadow:0 0 0 4px rgba(16,185,129,0)}}
.card-body{padding:14px 16px}

/* ── KPI strip ────────────────────────────────────────────────────────────── */
.kpi-strip{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:20px}
.kpi-card{
  background:var(--surface);border:1px solid var(--border);border-radius:12px;
  padding:16px 18px;box-shadow:var(--shadow);transition:box-shadow .15s;
}
.kpi-card:hover{box-shadow:var(--shadow-md)}
.kpi-card.orange{border-left:3px solid var(--accent)}
.kpi-card.green{border-left:3px solid var(--green)}
.kpi-card.red{border-left:3px solid var(--red)}
.kpi-card.blue{border-left:3px solid var(--blue)}
.kpi-card.amber{border-left:3px solid var(--amber)}
.kpi-val{font-size:26px;font-weight:800;font-family:var(--m);line-height:1;margin-bottom:4px}
.kpi-card.orange .kpi-val{color:var(--accent)}
.kpi-card.green  .kpi-val{color:var(--green)}
.kpi-card.red    .kpi-val{color:var(--red)}
.kpi-card.blue   .kpi-val{color:var(--blue)}
.kpi-card.amber  .kpi-val{color:var(--amber)}
.kpi-lbl{font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
.kpi-sub{font-size:11px;color:var(--subtle);margin-top:3px}

/* ── Two-column layout ────────────────────────────────────────────────────── */
.two-col{display:grid;grid-template-columns:1fr 340px;gap:16px;align-items:start}
.three-col{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;align-items:start}
@media(max-width:1200px){.two-col{grid-template-columns:1fr}.three-col{grid-template-columns:1fr 1fr}}

/* ── Pills ────────────────────────────────────────────────────────────────── */
.pill{
  display:inline-flex;align-items:center;gap:3px;font-size:10px;font-weight:700;
  padding:2px 8px;border-radius:20px;text-transform:uppercase;letter-spacing:.04em;white-space:nowrap;
}
.pill.pass,.pill.done{background:var(--green-bg);color:var(--green);border:1px solid var(--green-border)}
.pill.fail{background:var(--red-bg);color:var(--red);border:1px solid var(--red-border)}
.pill.active{background:var(--accent-light);color:var(--accent);border:1px solid var(--accent-border)}
.pill.stalled,.pill.warn{background:var(--amber-bg);color:var(--amber);border:1px solid var(--amber-border)}
.pill.idle,.pill.ended{background:var(--surface2);color:var(--muted);border:1px solid var(--border)}
.pill.info,.pill.blue{background:var(--blue-bg);color:var(--blue);border:1px solid var(--blue-border)}
.pill.violet{background:var(--violet-bg);color:var(--violet);border:1px solid #ddd6fe}
.pill-dot{width:5px;height:5px;border-radius:50%;background:currentColor}

/* ── Table ────────────────────────────────────────────────────────────────── */
.data-table{width:100%;border-collapse:collapse}
.data-table th{
  font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;
  color:var(--muted);padding:8px 12px;text-align:left;border-bottom:1px solid var(--border);
  background:var(--surface2);
}
.data-table td{padding:11px 12px;border-bottom:1px solid var(--border);font-size:12.5px;vertical-align:middle}
.data-table tr:last-child td{border-bottom:none}
.data-table tr.clickable:hover td{background:var(--surface2);cursor:pointer}

/* ── Feed list ────────────────────────────────────────────────────────────── */
.feed-row{display:flex;gap:10px;align-items:flex-start;padding:10px 0;border-bottom:1px solid var(--border)}
.feed-row:last-child{border-bottom:none}
.feed-icon{width:24px;height:24px;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:11px;flex-shrink:0;margin-top:1px}
.feed-icon.pass{background:var(--green-bg);color:var(--green)}
.feed-icon.fail{background:var(--red-bg);color:var(--red)}
.feed-icon.warn{background:var(--amber-bg);color:var(--amber)}
.feed-icon.info{background:var(--blue-bg);color:var(--blue)}
.feed-icon.tool{background:var(--surface2);color:var(--muted)}
.feed-icon.dim{background:var(--surface2);color:var(--subtle)}
.feed-text{flex:1;min-width:0}
.feed-summary{font-size:12.5px;color:var(--text);line-height:1.4}
.feed-meta{font-size:11px;color:var(--muted);margin-top:2px;display:flex;gap:8px;flex-wrap:wrap}
.feed-ts{font-size:11px;color:var(--subtle);white-space:nowrap;flex-shrink:0}

/* ── Sparkline ────────────────────────────────────────────────────────────── */
.sparkline-wrap{margin-top:6px}

/* ── Stage grid ───────────────────────────────────────────────────────────── */
.stage-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;padding:16px}
@media(max-width:1400px){.stage-grid{grid-template-columns:repeat(3,1fr)}}
.stage-tile{background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:12px;transition:box-shadow .15s}
.stage-tile:hover{box-shadow:var(--shadow-md)}
.stage-tile-id{font-family:var(--m);font-size:9px;color:var(--subtle);margin-bottom:3px}
.stage-tile-name{font-size:12px;font-weight:700;margin-bottom:8px}
.stage-tile-stats{display:flex;gap:5px;flex-wrap:wrap;margin-bottom:8px}
.stage-dots{display:flex;gap:3px;flex-wrap:wrap}
.run-dot{width:8px;height:8px;border-radius:50%;background:var(--border2);cursor:default}
.run-dot.pass{background:var(--green)}.run-dot.fail{background:var(--red)}
.run-dot.active{background:var(--accent)}.run-dot.ready{background:var(--blue)}

/* ── Agent cards ──────────────────────────────────────────────────────────── */
.agent-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;padding:16px}
.agent-tile{
  background:var(--surface2);border:1px solid var(--border);border-radius:10px;
  padding:14px;cursor:pointer;transition:all .15s;
}
.agent-tile:hover{border-color:var(--blue-border);box-shadow:var(--shadow-md)}
.agent-tile-head{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:8px}
.agent-name{font-size:12.5px;font-weight:700}
.agent-task{font-size:11px;color:var(--muted);margin-top:1px;font-family:var(--m)}
.agent-summary{font-size:12px;color:var(--muted);line-height:1.4;margin-bottom:10px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.agent-chips{display:flex;gap:5px;flex-wrap:wrap}
.chip{
  font-size:10px;font-weight:600;padding:2px 7px;border-radius:4px;
  background:var(--blue-bg);color:var(--blue);border:1px solid var(--blue-border);
}

/* ── Approval cards ───────────────────────────────────────────────────────── */
.approval-card{
  border:1px solid var(--border);border-radius:10px;padding:14px 16px;
  margin-bottom:10px;transition:box-shadow .15s;
}
.approval-card.pending{border-left:3px solid var(--amber)}
.approval-card.approved{border-left:3px solid var(--green);opacity:.7}
.approval-card.rejected{border-left:3px solid var(--red);opacity:.7}
.approval-card:hover{box-shadow:var(--shadow-md)}
.approval-title{font-size:13px;font-weight:700;margin-bottom:4px}
.approval-detail{font-size:12px;color:var(--muted);margin-bottom:8px}
.approval-meta{font-size:11px;color:var(--subtle);margin-bottom:10px;font-family:var(--m)}
.approval-actions{display:flex;gap:8px}
.btn{
  padding:6px 14px;border-radius:7px;border:1px solid var(--border);font-size:12px;
  font-weight:700;cursor:pointer;transition:all .12s;background:var(--surface);
}
.btn-approve{background:var(--green);color:#fff;border-color:var(--green)}
.btn-approve:hover{filter:brightness(1.08)}
.btn-reject{background:var(--surface);color:var(--red);border-color:var(--red-border)}
.btn-reject:hover{background:var(--red);color:#fff}

/* ── Alert rows ───────────────────────────────────────────────────────────── */
.alert-row{display:flex;gap:12px;padding:12px 14px;border-radius:8px;margin-bottom:8px;border:1px solid transparent;align-items:flex-start}
.alert-row.warn{background:var(--amber-bg);border-color:var(--amber-border)}
.alert-row.critical{background:var(--red-bg);border-color:var(--red-border)}
.alert-row.info{background:var(--blue-bg);border-color:var(--blue-border)}
.alert-icon{font-size:18px;flex-shrink:0;line-height:1;margin-top:1px}
.alert-title{font-size:12.5px;font-weight:700;margin-bottom:2px}
.alert-detail{font-size:12px;color:var(--muted)}

/* ── Progress bar ─────────────────────────────────────────────────────────── */
.pbar-row{margin-bottom:12px}
.pbar-label{display:flex;justify-content:space-between;font-size:11.5px;color:var(--muted);margin-bottom:5px}
.pbar{height:6px;background:var(--border);border-radius:3px;overflow:hidden}
.pbar-fill{height:100%;border-radius:3px;transition:width .4s ease}
.pbar-fill.safe{background:var(--green)}.pbar-fill.warn{background:var(--amber)}.pbar-fill.danger{background:var(--red)}

/* ── Run detail drawer ────────────────────────────────────────────────────── */
#detail-drawer{
  position:fixed;right:0;top:0;bottom:0;width:520px;background:var(--surface);
  border-left:1px solid var(--border);z-index:100;transform:translateX(100%);
  transition:transform .25s cubic-bezier(.4,0,.2,1);display:flex;flex-direction:column;
  box-shadow:-4px 0 20px rgba(0,0,0,.08);
}
#detail-drawer.open{transform:translateX(0)}
.drawer-hdr{
  padding:16px 20px;border-bottom:1px solid var(--border);
  display:flex;align-items:center;gap:12px;flex-shrink:0;background:var(--surface);
}
.drawer-hdr h2{font-size:14px;font-weight:700;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.drawer-close{background:none;border:none;font-size:20px;cursor:pointer;color:var(--muted);line-height:1;padding:2px}
.drawer-close:hover{color:var(--text)}
.drawer-body{flex:1;overflow-y:auto;padding:18px 20px;display:flex;flex-direction:column;gap:18px}
.drawer-section{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin-bottom:10px}
.drawer-kpi-row{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
.drawer-kpi{background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:10px 12px;text-align:center}
.drawer-kpi-val{font-size:20px;font-weight:800;font-family:var(--m);line-height:1;margin-bottom:3px}
.drawer-kpi-lbl{font-size:9.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
.timeline-svg{width:100%;display:block}
.min-row{display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--border);font-size:11.5px}
.min-row:last-child{border-bottom:none}
.min-time{font-family:var(--m);font-size:10px;color:var(--muted);width:48px;flex-shrink:0}
.min-bar-wrap{flex:1;background:var(--border);border-radius:3px;height:6px;overflow:hidden}
.min-bar{height:100%;border-radius:3px;background:var(--blue);transition:width .3s}
.min-count{font-size:10px;color:var(--muted);font-family:var(--m);width:36px;flex-shrink:0;text-align:right}
.min-tags{display:flex;gap:4px;flex-wrap:wrap}
.quality-row{display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px}
.quality-row:last-child{border-bottom:none}
.quality-bar{height:3px;border-radius:2px;background:var(--green);margin-top:3px}

/* ── Traceability ─────────────────────────────────────────────────────────── */
.trace-run{margin-bottom:16px}
.trace-stage-chips{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0 12px}
.trace-stage-chip{
  display:flex;align-items:center;gap:4px;padding:4px 10px;border-radius:6px;
  font-size:11px;font-weight:600;
}
.trace-stage-chip.done{background:var(--green-bg);color:var(--green);border:1px solid var(--green-border)}
.trace-stage-chip.pending{background:var(--surface2);color:var(--muted);border:1px solid var(--border)}
.trace-req{
  padding:6px 10px;background:var(--surface2);border-radius:6px;font-size:12px;
  margin-bottom:4px;border-left:2px solid var(--blue);
}
.trace-req-id{font-family:var(--m);font-size:9.5px;color:var(--muted);margin-bottom:1px}
.trace-task-row{display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--border);font-size:12px}
.trace-task-row:last-child{border-bottom:none}

/* ── Empty states ─────────────────────────────────────────────────────────── */
.empty-state{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:48px 20px;gap:10px;text-align:center}
.empty-icon{font-size:36px;opacity:.35}
.empty-title{font-size:15px;font-weight:700}
.empty-sub{font-size:13px;color:var(--muted);max-width:320px;line-height:1.5}

/* ── Scrollbar ────────────────────────────────────────────────────────────── */
::-webkit-scrollbar{width:5px;height:5px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:var(--border2);border-radius:3px}
::-webkit-scrollbar-thumb:hover{background:var(--muted)}

/* ── Overlay ──────────────────────────────────────────────────────────────── */
#drawer-overlay{
  display:none;position:fixed;inset:0;background:rgba(15,23,42,.3);z-index:99;
  backdrop-filter:blur(1px);
}
#drawer-overlay.open{display:block}

/* ── Project cards (Command Center) ──────────────────────────────────────── */
.project-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px;padding:16px}
.project-card{
  background:var(--surface2);border:1px solid var(--border);border-radius:10px;
  padding:14px;transition:box-shadow .15s;
}
.project-card:hover{box-shadow:var(--shadow-md)}
.project-card-name{font-size:13px;font-weight:700;margin-bottom:4px}
.project-card-path{font-size:10px;color:var(--subtle);font-family:var(--m);margin-bottom:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.project-card-stats{display:flex;gap:8px;align-items:center;margin-bottom:8px;font-size:12px;color:var(--muted)}
</style>
</head>
<body>
<div id="app">

  <!-- ── Sidebar ─────────────────────────────────────────────────────────── -->
  <div id="sidebar">
    <div class="sb-brand">
      <div class="sb-logo">R</div>
      <div>
        <div class="sb-title">RStack</div>
        <div class="sb-sub">Business Hub</div>
      </div>
      <div class="sb-ws offline" id="ws-dot"></div>
    </div>

    <div class="sb-nav">
      <div class="sb-section">Views</div>
      <button class="sb-link active" data-page="command"><span class="icon">⌘</span> Command Center</button>
      <button class="sb-link" data-page="feed"><span class="icon">⚡</span> Live Feed</button>
      <button class="sb-link" data-page="runs"><span class="icon">▦</span> All Runs</button>
      <button class="sb-link" data-page="pipeline"><span class="icon">⬡</span> Pipeline Stages</button>
      <button class="sb-link" data-page="agents"><span class="icon">◈</span> Agent Work</button>
      <div class="sb-section">Actions</div>
      <button class="sb-link" data-page="approvals"><span class="icon">✓</span> Approvals <span class="badge" id="badge-approvals" style="display:none">0</span></button>
      <button class="sb-link" data-page="alerts"><span class="icon">△</span> Alerts <span class="badge" id="badge-alerts" style="display:none">0</span></button>
      <div class="sb-section">Insights</div>
      <button class="sb-link" data-page="traceability"><span class="icon">→</span> Traceability</button>
      <button class="sb-link" data-page="team"><span class="icon">◉</span> Team</button>
    </div>

    <div class="sb-footer">
      <div class="sb-kpi-row">
        <div class="sb-kpi"><div class="sb-kpi-val" id="sb-runs">—</div><div class="sb-kpi-lbl">Runs</div></div>
        <div class="sb-kpi"><div class="sb-kpi-val" id="sb-cost">—</div><div class="sb-kpi-lbl">Cost</div></div>
        <div class="sb-kpi"><div class="sb-kpi-val" id="sb-active">—</div><div class="sb-kpi-lbl">Active</div></div>
        <div class="sb-kpi"><div class="sb-kpi-val" id="sb-agents">—</div><div class="sb-kpi-lbl">Agents</div></div>
      </div>
    </div>
  </div>

  <!-- ── Main ────────────────────────────────────────────────────────────── -->
  <div id="main">

    <!-- Top bar -->
    <div id="topbar">
      <div class="tb-title" id="tb-title">Command Center</div>
      <div class="tb-sep"></div>
      <div class="tb-stat"><div class="dot" style="background:var(--green)" id="tb-status-dot"></div><span id="tb-status">Connecting…</span></div>
      <div class="tb-right">
        <button class="tb-alert-btn" id="tb-alert-btn" onclick="nav('alerts')">
          <span>△</span> <span id="tb-alert-count">0 alerts</span>
        </button>
        <button class="tb-alert-btn" onclick="nav('approvals')" id="tb-approval-btn">
          <span>✓</span> <span id="tb-approval-count">0 pending</span>
        </button>
      </div>
    </div>

    <!-- ── COMMAND CENTER ─────────────────────────────────────────────────── -->
    <div class="page active" id="page-command">
      <div style="padding:20px">
        <div class="page-title">Command Center</div>
        <div class="page-sub">Live view of every project, run, and agent across your stack</div>

        <div class="kpi-strip">
          <div class="kpi-card orange"><div class="kpi-val" id="kpi-runs">—</div><div class="kpi-lbl">Total Runs</div><div class="kpi-sub" id="kpi-runs-sub">—</div></div>
          <div class="kpi-card green"><div class="kpi-val" id="kpi-active">—</div><div class="kpi-lbl">Active</div><div class="kpi-sub" id="kpi-active-sub">—</div></div>
          <div class="kpi-card blue"><div class="kpi-val" id="kpi-tasks">—</div><div class="kpi-lbl">Tasks Passed</div><div class="kpi-sub" id="kpi-tasks-sub">—</div></div>
          <div class="kpi-card amber"><div class="kpi-val" id="kpi-cost">—</div><div class="kpi-lbl">Total Cost</div><div class="kpi-sub" id="kpi-cost-sub">—</div></div>
          <div class="kpi-card red"><div class="kpi-val" id="kpi-alerts">—</div><div class="kpi-lbl">Active Alerts</div><div class="kpi-sub" id="kpi-alerts-sub">—</div></div>
        </div>

        <div class="two-col">
          <div style="display:flex;flex-direction:column;gap:16px">
            <div class="card">
              <div class="card-hdr"><div class="live-dot"></div> Recent Activity</div>
              <div class="card-body" style="max-height:320px;overflow-y:auto" id="cc-feed"></div>
            </div>
            <div class="card">
              <div class="card-hdr">Projects <span id="cc-proj-count" style="background:var(--surface2);border:1px solid var(--border);border-radius:20px;padding:1px 8px;font-size:10px"></span></div>
              <div class="project-grid" id="cc-projects"></div>
            </div>
          </div>
          <div style="display:flex;flex-direction:column;gap:16px">
            <div class="card">
              <div class="card-hdr">Guardrail Health</div>
              <div class="card-body" id="cc-guardrails"></div>
            </div>
            <div class="card">
              <div class="card-hdr">Active Runs</div>
              <div class="card-body" id="cc-active-runs" style="max-height:300px;overflow-y:auto"></div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ── LIVE FEED ──────────────────────────────────────────────────────── -->
    <div class="page" id="page-feed">
      <div style="padding:20px">
        <div class="page-title">Live Feed</div>
        <div class="page-sub">Every event across all runs — plain language, real time</div>
        <div class="card">
          <div class="card-hdr"><div class="live-dot"></div> Activity Stream <span id="feed-count" style="color:var(--subtle);font-weight:400;text-transform:none;letter-spacing:0;font-size:12px"></span></div>
          <div class="card-body" style="max-height:calc(100vh - 200px);overflow-y:auto" id="feed-list"></div>
        </div>
      </div>
    </div>

    <!-- ── ALL RUNS ───────────────────────────────────────────────────────── -->
    <div class="page" id="page-runs">
      <div style="padding:20px">
        <div class="page-title">All Runs</div>
        <div class="page-sub">Every SDLC run across all registered projects — click any row for the full timeline</div>
        <div class="card">
          <div class="card-hdr">Run History <span id="runs-count" style="color:var(--subtle);font-weight:400;text-transform:none;letter-spacing:0;font-size:12px"></span></div>
          <table class="data-table" id="runs-table" style="table-layout:fixed">
            <colgroup>
              <col style="width:110px"><col style="width:auto"><col style="width:90px">
              <col style="width:130px"><col style="width:120px"><col style="width:60px">
            </colgroup>
            <thead><tr>
              <th>Status</th><th>Goal</th><th>Project</th>
              <th>Activity</th><th>Tasks</th><th>Cost</th>
            </tr></thead>
            <tbody id="runs-body"></tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- ── PIPELINE STAGES ────────────────────────────────────────────────── -->
    <div class="page" id="page-pipeline">
      <div style="padding:20px">
        <div class="page-title">Pipeline Stages</div>
        <div class="page-sub">15-stage SDLC pipeline — pass/fail/active status across all runs</div>
        <div class="card">
          <div class="card-hdr">Stage Matrix</div>
          <div class="stage-grid" id="stage-grid"></div>
        </div>
      </div>
    </div>

    <!-- ── AGENT WORK ─────────────────────────────────────────────────────── -->
    <div class="page" id="page-agents">
      <div style="padding:20px">
        <div class="page-title">Agent Work</div>
        <div class="page-sub">Every builder contract — agent, task, evidence count, decisions</div>
        <div class="card">
          <div class="card-hdr">Agent Work Stream <span id="agents-count" style="color:var(--subtle);font-weight:400;text-transform:none;letter-spacing:0;font-size:12px"></span></div>
          <div class="agent-grid" id="agent-grid"></div>
        </div>
      </div>
    </div>

    <!-- ── APPROVALS ──────────────────────────────────────────────────────── -->
    <div class="page" id="page-approvals">
      <div style="padding:20px">
        <div class="page-title">Approvals</div>
        <div class="page-sub">Human-in-loop gates — approve or reject blocked actions</div>
        <div style="max-width:700px" id="approvals-list"></div>
      </div>
    </div>

    <!-- ── ALERTS ─────────────────────────────────────────────────────────── -->
    <div class="page" id="page-alerts">
      <div style="padding:20px">
        <div class="page-title">Alerts</div>
        <div class="page-sub">Threshold violations across cost, failure rate, guardrail hits, and stalled runs</div>
        <div style="max-width:700px" id="alerts-list"></div>
      </div>
    </div>

    <!-- ── TRACEABILITY ───────────────────────────────────────────────────── -->
    <div class="page" id="page-traceability">
      <div style="padding:20px">
        <div class="page-title">Traceability</div>
        <div class="page-sub">Requirements → architecture → code tasks → test evidence, per run</div>
        <div id="trace-list"></div>
      </div>
    </div>

    <!-- ── TEAM ───────────────────────────────────────────────────────────── -->
    <div class="page" id="page-team">
      <div style="padding:20px">
        <div class="page-title">Team</div>
        <div class="page-sub">Framework and runtime breakdown — pass rates, cost, run counts</div>
        <div class="card">
          <div class="card-hdr">Framework Breakdown</div>
          <div class="card-body" id="team-table"></div>
        </div>
      </div>
    </div>

  </div><!-- /main -->
</div><!-- /app -->

<!-- Run detail drawer -->
<div id="drawer-overlay" onclick="closeDrawer()"></div>
<div id="detail-drawer">
  <div class="drawer-hdr">
    <div style="flex:1;min-width:0">
      <div style="font-size:10px;color:var(--muted);font-family:var(--m);margin-bottom:2px" id="drawer-run-id"></div>
      <h2 id="drawer-goal"></h2>
    </div>
    <button class="drawer-close" onclick="closeDrawer()">✕</button>
  </div>
  <div class="drawer-body">
    <div>
      <div class="drawer-section">Overview</div>
      <div class="drawer-kpi-row" id="drawer-kpis"></div>
    </div>
    <div>
      <div class="drawer-section">Activity timeline — tool calls per minute</div>
      <svg class="timeline-svg" id="drawer-timeline" style="height:60px"></svg>
      <div style="font-size:10px;color:var(--subtle);margin-top:4px">Blue = tool calls · Green = stage done · Red = guardrail</div>
    </div>
    <div>
      <div class="drawer-section">Minute breakdown</div>
      <div id="drawer-minutes"></div>
    </div>
    <div id="drawer-quality-wrap" style="display:none">
      <div class="drawer-section">Quality scores</div>
      <div id="drawer-quality"></div>
    </div>
    <div>
      <div class="drawer-section">Stage completions</div>
      <div id="drawer-stages"></div>
    </div>
  </div>
</div>

<script>
// ── State ──────────────────────────────────────────────────────────────────
let STATE = null;
const WS_PORT = ${port};

// ── Navigation ──────────────────────────────────────────────────────────────
const PAGE_TITLES = {
  command:'Command Center', feed:'Live Feed', runs:'All Runs',
  pipeline:'Pipeline Stages', agents:'Agent Work', approvals:'Approvals',
  alerts:'Alerts', traceability:'Traceability', team:'Team'
};

function nav(id) {
  document.querySelectorAll('.sb-link').forEach(b => b.classList.toggle('active', b.dataset.page === id));
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === 'page-' + id));
  document.getElementById('tb-title').textContent = PAGE_TITLES[id] ?? id;
}

document.querySelectorAll('.sb-link').forEach(btn => {
  btn.addEventListener('click', () => nav(btn.dataset.page));
});

// ── WebSocket ──────────────────────────────────────────────────────────────
const wsDot = document.getElementById('ws-dot');
let ws, reconnTimer;

function connect() {
  ws = new WebSocket('ws://localhost:' + WS_PORT);
  ws.onopen = () => {
    wsDot.className = 'sb-ws live';
    document.getElementById('tb-status').textContent = 'Live';
    document.getElementById('tb-status-dot').style.background = 'var(--green)';
    clearTimeout(reconnTimer);
  };
  ws.onmessage = e => { try { applyState(JSON.parse(e.data)); } catch {} };
  ws.onclose = ws.onerror = () => {
    wsDot.className = 'sb-ws offline';
    document.getElementById('tb-status').textContent = 'Reconnecting…';
    document.getElementById('tb-status-dot').style.background = 'var(--amber)';
    reconnTimer = setTimeout(connect, 2500);
  };
}

// ── Apply state ────────────────────────────────────────────────────────────
function applyState(s) {
  STATE = s;
  updateSidebar();
  updateTopbar();
  renderCommand();
  renderFeed();
  renderRuns();
  renderPipeline();
  renderAgents();
  renderApprovals();
  renderAlerts();
  renderTraceability();
  renderTeam();
}

// ── Sidebar footer KPIs ────────────────────────────────────────────────────
function updateSidebar() {
  const s = STATE;
  const allTasks = (s.runs ?? []).flatMap(r => r.tasks ?? []);
  setText('sb-runs',   s.totalRuns ?? 0);
  setText('sb-cost',   '$' + (s.totalCost ?? 0).toFixed(2));
  setText('sb-active', (s.activeRuns ?? []).length);
  setText('sb-agents', (s.agentWork ?? []).length);

  // Badges
  const pa = s.approvalStats?.pending ?? 0;
  const ab = document.getElementById('badge-approvals');
  ab.style.display = pa > 0 ? '' : 'none'; ab.textContent = pa;

  const al = (s.alerts ?? []).length;
  const alb = document.getElementById('badge-alerts');
  alb.style.display = al > 0 ? '' : 'none'; alb.textContent = al;
}

function updateTopbar() {
  const s = STATE;
  const al = (s.alerts ?? []).length;
  const pa = s.approvalStats?.pending ?? 0;

  const btn = document.getElementById('tb-alert-btn');
  setText('tb-alert-count', al + ' alert' + (al !== 1 ? 's' : ''));
  btn.className = 'tb-alert-btn' + (al > 0 ? ' has-alerts' : '');

  setText('tb-approval-count', pa + ' pending');
  document.getElementById('tb-approval-btn').className = 'tb-alert-btn' + (pa > 0 ? ' has-alerts' : '');
}

// ── Command Center ─────────────────────────────────────────────────────────
function renderCommand() {
  const s = STATE;
  const allTasks = (s.runs ?? []).flatMap(r => r.tasks ?? []);
  const passed = allTasks.filter(t => t.status === 'PASS').length;
  const failed = allTasks.filter(t => t.status === 'FAIL').length;

  setText('kpi-runs',     s.totalRuns ?? 0);
  setText('kpi-runs-sub', s.todayCount + ' today');
  setText('kpi-active',   (s.activeRuns ?? []).length);
  setText('kpi-active-sub', (s.runs ?? []).filter(r => r.derivedStatus === 'stalled').length + ' stalled');
  setText('kpi-tasks',    passed);
  setText('kpi-tasks-sub', failed + ' failed');
  setText('kpi-cost',     '$' + (s.totalCost ?? 0).toFixed(4));
  setText('kpi-cost-sub', (s.frameworks ? Object.keys(s.frameworks).join(', ') : '—'));
  setText('kpi-alerts',   (s.alerts ?? []).length);
  setText('kpi-alerts-sub', (s.approvalStats?.pending ?? 0) + ' approvals pending');

  // Recent activity feed (top 12)
  const feed = (s.feed ?? []).slice(0, 12);
  const feedEl = document.getElementById('cc-feed');
  feedEl.innerHTML = feed.length
    ? feed.map(f => feedRowHtml(f)).join('')
    : '<div class="empty-state"><div class="empty-icon">📡</div><div class="empty-sub">No activity yet</div></div>';

  // Projects
  const projects = {};
  for (const run of s.runs ?? []) {
    const key = run.projectRoot ?? 'unknown';
    const name = key.split('/').filter(Boolean).pop() || key;
    const b = projects[key] ??= { name, path: key, runs: 0, active: 0, cost: 0, pass: 0, fail: 0, last: '' };
    b.runs++; b.cost += Number(run.metrics?.cumulative_cost_usd ?? 0) || 0;
    b.last = b.last > run.runId ? b.last : run.runId;
    if ((s.activeRuns ?? []).includes(run.runId)) b.active++;
    for (const t of run.tasks ?? []) { if (t.status === 'PASS') b.pass++; if (t.status === 'FAIL') b.fail++; }
  }
  const projRows = Object.values(projects).sort((a, b) => b.last.localeCompare(a.last));
  setText('cc-proj-count', projRows.length);
  document.getElementById('cc-projects').innerHTML = projRows.map(p =>
    '<div class="project-card">' +
    '<div class="project-card-name">' + esc(p.name) + '</div>' +
    '<div class="project-card-path">' + esc(p.path) + '</div>' +
    '<div class="project-card-stats">' + p.runs + ' runs · ' + p.active + ' active · $' + p.cost.toFixed(3) + '</div>' +
    '<div style="display:flex;gap:5px">' +
    '<span class="pill pass"><span class="pill-dot"></span>' + p.pass + ' pass</span>' +
    '<span class="pill fail"><span class="pill-dot"></span>' + p.fail + ' fail</span>' +
    '</div></div>'
  ).join('') || '<div style="padding:16px;color:var(--muted);font-size:12px">No projects registered</div>';

  // Guardrails
  const allEvs = (s.runs ?? []).flatMap(r => r.activityTimeline ?? []);
  const toolCalls = allEvs.reduce((n, m) => n + m.toolCalls, 0);
  const guardrailHits = allEvs.reduce((n, m) => n + (m.guardrails ?? 0), 0);
  document.getElementById('cc-guardrails').innerHTML =
    pbar('Tool Calls (all runs)', toolCalls, Math.max(200, toolCalls)) +
    pbar('Guardrail Hits', guardrailHits, Math.max(10, guardrailHits)) +
    pbar('Total Cost ($)', s.totalCost ?? 0, 10, '$', 4);

  // Active runs
  const activeRuns = (s.runs ?? []).filter(r => (s.activeRuns ?? []).includes(r.runId));
  const activeEl = document.getElementById('cc-active-runs');
  if (!activeRuns.length) {
    activeEl.innerHTML = '<div style="padding:8px;color:var(--muted);font-size:12px;font-style:italic">No active runs</div>';
  } else {
    activeEl.innerHTML = activeRuns.map(r => {
      const tasks = r.tasks ?? [];
      const done = tasks.filter(t => t.status === 'PASS' || t.status === 'FAIL').length;
      const pct  = tasks.length ? Math.round(done / tasks.length * 100) : 0;
      return '<div style="padding:10px 0;border-bottom:1px solid var(--border)">' +
        '<div style="font-size:12.5px;font-weight:600;margin-bottom:4px">' + esc((r.manifest?.goal ?? '—').slice(0, 55)) + '</div>' +
        '<div style="height:4px;background:var(--border);border-radius:2px;overflow:hidden;margin-bottom:4px"><div style="width:' + pct + '%;height:100%;background:var(--accent);border-radius:2px"></div></div>' +
        '<div style="font-size:11px;color:var(--muted)">' + done + '/' + tasks.length + ' tasks · ' + pct + '%</div>' +
        '</div>';
    }).join('');
  }
}

// ── Feed ───────────────────────────────────────────────────────────────────
function renderFeed() {
  const feed = STATE.feed ?? [];
  setText('feed-count', feed.length + ' events');
  document.getElementById('feed-list').innerHTML =
    feed.length ? feed.map(f => feedRowHtml(f)).join('') : emptyState('⚡','No events yet','Events appear here as runs execute');
}

function feedRowHtml(f) {
  const ts   = f.ts ? f.ts.replace('T', ' ').slice(0, 16) : '';
  const proj = f.projectRoot ? f.projectRoot.split('/').filter(Boolean).pop() : '';
  const iconMap = { pass:'✓', fail:'✗', warn:'!', info:'i', tool:'·', dim:'·' };
  return '<div class="feed-row">' +
    '<div class="feed-icon ' + (f.level ?? 'info') + '">' + (iconMap[f.level ?? 'info'] ?? 'i') + '</div>' +
    '<div class="feed-text">' +
    '<div class="feed-summary">' + esc(f.summary) + '</div>' +
    '<div class="feed-meta">' +
    (f.runId ? '<span>' + esc(f.runId.slice(-12)) + '</span>' : '') +
    (proj ? '<span style="color:var(--blue)">' + esc(proj) + '</span>' : '') +
    (f.goal ? '<span>' + esc(f.goal.slice(0, 40)) + '</span>' : '') +
    '</div></div>' +
    '<div class="feed-ts">' + ts + '</div>' +
    '</div>';
}

// ── All Runs ───────────────────────────────────────────────────────────────
function renderRuns() {
  const runs = STATE.runs ?? [];
  setText('runs-count', runs.length + ' runs');
  document.getElementById('runs-body').innerHTML = runs.map(r => {
    const tasks   = r.tasks ?? [];
    const passed  = tasks.filter(t => t.status === 'PASS').length;
    const failed  = tasks.filter(t => t.status === 'FAIL').length;
    const cost    = (r.metrics?.cumulative_cost_usd ?? 0).toFixed(4);
    const created = r.manifest?.created_at ? r.manifest.created_at.slice(0, 16).replace('T', ' ') : '—';
    const proj    = (r.projectRoot ?? '').split('/').filter(Boolean).pop() ?? '—';
    const spark   = sparklineSvg(r.activityTimeline ?? [], 110, 18);
    const totalTc = (r.activityTimeline ?? []).reduce((n, m) => n + m.toolCalls, 0);
    return '<tr class="clickable" onclick="openDrawer(\'' + esc(r.runId) + '\')">' +
      '<td>' + statusPill(r.derivedStatus) + '</td>' +
      '<td style="max-width:0"><div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;font-size:12.5px">' + esc(r.manifest?.goal ?? '—') + '</div>' +
      '<div style="font-size:10.5px;color:var(--muted);margin-top:1px">' + created + '</div></td>' +
      '<td><span style="font-family:var(--m);font-size:10.5px;color:var(--blue)">' + esc(proj) + '</span></td>' +
      '<td>' + (spark || '') + (totalTc ? '<div style="font-size:10px;color:var(--muted);margin-top:2px">' + totalTc + ' calls</div>' : '') + '</td>' +
      '<td><span style="color:var(--green);font-weight:700">' + passed + '</span><span style="color:var(--muted)"> / </span>' +
      '<span style="color:' + (failed ? 'var(--red)' : 'var(--muted)') + '">' + (tasks.length - passed) + '</span>' +
      '<span style="color:var(--muted);font-size:10.5px"> of ' + tasks.length + '</span></td>' +
      '<td style="font-family:var(--m);font-size:11.5px;color:var(--muted)">$' + cost + '</td>' +
      '</tr>';
  }).join('') || '<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--muted)">No runs yet</td></tr>';
}

// ── Pipeline ───────────────────────────────────────────────────────────────
function renderPipeline() {
  const stages = STATE.stageMatrix ?? [];
  document.getElementById('stage-grid').innerHTML = stages.map(stage => {
    const dots = (stage.runs ?? []).slice(0, 24).map(r =>
      '<span title="' + esc(r.runId) + '" class="run-dot ' + dotClass(r.status) + '"></span>'
    ).join('');
    return '<div class="stage-tile">' +
      '<div class="stage-tile-id">' + esc(stage.id) + '</div>' +
      '<div class="stage-tile-name">' + esc(stage.title) + '</div>' +
      '<div class="stage-tile-stats">' +
      (stage.pass  ? '<span class="pill pass">'   + stage.pass  + ' pass</span>'   : '') +
      (stage.fail  ? '<span class="pill fail">'   + stage.fail  + ' fail</span>'   : '') +
      (stage.active? '<span class="pill active">' + stage.active + ' active</span>' : '') +
      '</div>' +
      '<div class="stage-dots">' + (dots || '<span style="color:var(--subtle);font-size:11px">No runs</span>') + '</div>' +
      '</div>';
  }).join('') || '<div style="padding:20px;color:var(--muted)">No stage data</div>';
}

// ── Agents ─────────────────────────────────────────────────────────────────
function renderAgents() {
  const work = STATE.agentWork ?? [];
  setText('agents-count', work.length + ' items');
  document.getElementById('agent-grid').innerHTML = work.length
    ? work.map((w, i) =>
      '<div class="agent-tile" onclick="openAgentDrawer(' + i + ')">' +
      '<div class="agent-tile-head">' +
      '<div><div class="agent-name">' + esc(w.agent || 'builder') + '</div><div class="agent-task">' + esc(w.taskId || '') + '</div></div>' +
      statusPill(w.status) +
      '</div>' +
      '<div class="agent-summary">' + esc(w.summary || w.promptPreview || 'No summary') + '</div>' +
      '<div class="agent-chips">' +
      '<span class="chip">builder.json</span>' +
      '<span class="chip">validation.json</span>' +
      (w.evidenceCount ? '<span class="chip">' + w.evidenceCount + ' checks</span>' : '') +
      (w.host && w.host !== 'unknown' ? '<span class="chip">' + esc(w.host) + '</span>' : '') +
      '</div></div>'
    ).join('')
    : emptyState('◈', 'No agent work yet', 'Agent contracts appear here once runs have builder tasks');
}

// ── Approvals ──────────────────────────────────────────────────────────────
function renderApprovals() {
  const approvals = STATE.approvals ?? [];
  const pending   = approvals.filter(a => !a.status || a.status === 'pending');
  const resolved  = approvals.filter(a => a.status && a.status !== 'pending');

  if (!approvals.length) {
    document.getElementById('approvals-list').innerHTML =
      emptyState('✓', 'No approval requests', 'Blocked actions will appear here for your review');
    return;
  }

  document.getElementById('approvals-list').innerHTML =
    (pending.length ? '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);margin-bottom:10px">Pending (' + pending.length + ')</div>' + pending.map(a => approvalCardHtml(a, true)).join('') : '') +
    (resolved.length ? '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);margin:16px 0 10px">Resolved</div>' + resolved.slice(0, 20).map(a => approvalCardHtml(a, false)).join('') : '');
}

function approvalCardHtml(a, canAct) {
  const s = a.status ?? 'pending';
  const pill = s === 'approved' ? '<span class="pill pass">Approved</span>'
             : s === 'rejected' ? '<span class="pill fail">Rejected</span>'
             : '<span class="pill warn">Pending</span>';
  return '<div class="approval-card ' + s + '">' +
    '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:6px">' +
    '<div class="approval-title">' + esc(a.title ?? a.type ?? 'Approval required') + '</div>' + pill + '</div>' +
    '<div class="approval-detail">' + esc(a.detail ?? a.reason ?? '') + '</div>' +
    '<div class="approval-meta">' + esc(a.runId?.slice(-14) ?? '—') + ' · ' + esc(a.ts?.replace('T', ' ').slice(0, 16) ?? '') + '</div>' +
    (canAct ? '<div class="approval-actions"><button class="btn btn-approve" onclick="doApprove(\'' + esc(a.id) + '\')">Approve</button><button class="btn btn-reject" onclick="doReject(\'' + esc(a.id) + '\')">Reject</button></div>' : '') +
    '</div>';
}

async function doApprove(id) { await fetch('/api/approve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})}); }
async function doReject(id)  { await fetch('/api/reject', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})}); }

// ── Alerts ─────────────────────────────────────────────────────────────────
function renderAlerts() {
  const alerts = STATE.alerts ?? [];
  document.getElementById('alerts-list').innerHTML = alerts.length
    ? alerts.map(a => {
      const icons = { warn:'⚠️', critical:'🔴', info:'ℹ️' };
      return '<div class="alert-row ' + (a.level ?? 'info') + '">' +
        '<div class="alert-icon">' + (icons[a.level] ?? 'ℹ️') + '</div>' +
        '<div><div class="alert-title">' + esc(a.title) + '</div><div class="alert-detail">' + esc(a.detail) + '</div></div>' +
        '</div>';
    }).join('')
    : emptyState('△', 'All clear', 'No thresholds breached — system healthy');
}

// ── Traceability ───────────────────────────────────────────────────────────
function renderTraceability() {
  const traceMap = STATE.traceMap ?? [];
  document.getElementById('trace-list').innerHTML = traceMap.length
    ? traceMap.map(t => {
      const stagesHtml = [
        ['Requirements', t.stages?.requirements], ['Architecture', t.stages?.architecture],
        ['Code', t.stages?.code], ['Testing', t.stages?.testing]
      ].map(([l, done]) =>
        '<div class="trace-stage-chip ' + (done ? 'done' : 'pending') + '">' + (done ? '✓' : '○') + ' ' + l + '</div>'
      ).join('');
      const reqs = (t.requirements ?? []).slice(0, 8).map(r =>
        '<div class="trace-req"><div class="trace-req-id">' + esc(r.id ?? r.req_id ?? '') + '</div>' + esc((r.description ?? r.text ?? r.title ?? '').slice(0, 100)) + '</div>'
      ).join('');
      const tasks2 = (t.passTasks ?? []).slice(0, 6).map(task =>
        '<div class="trace-task-row"><span class="pill pass">PASS</span><span style="flex:1">' + esc(task.title) + '</span></div>'
      ).join('');
      return '<div class="card trace-run" style="margin-bottom:16px">' +
        '<div class="card-hdr">' + esc(t.runId.slice(-20)) + '</div>' +
        '<div class="card-body">' +
        '<div style="font-size:14px;font-weight:700;margin-bottom:8px">' + esc(t.goal) + '</div>' +
        '<div class="trace-stage-chips">' + stagesHtml + '</div>' +
        (reqs ? '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);margin-bottom:6px">Requirements (' + t.requirements.length + ')</div>' + reqs : '') +
        (tasks2 ? '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);margin:10px 0 6px">Verified tasks</div>' + tasks2 : '') +
        '</div></div>';
    }).join('')
    : emptyState('→', 'No traceability data yet', 'Complete runs with requirements (stage 02) and architecture (stage 06) to see maps here');
}

// ── Team ───────────────────────────────────────────────────────────────────
function renderTeam() {
  const fw = STATE.frameworks ?? {};
  const entries = Object.entries(fw);
  if (!entries.length) { document.getElementById('team-table').innerHTML = emptyState('◉', 'No team data', 'Framework usage appears here once runs have completed'); return; }
  document.getElementById('team-table').innerHTML =
    '<table class="data-table" style="width:100%"><thead><tr>' +
    '<th>Framework</th><th>Runs</th><th>Tasks Pass</th><th>Tasks Fail</th><th>Total Cost</th><th>Pass Rate</th>' +
    '</tr></thead><tbody>' +
    entries.map(([name, d]) => {
      const total = d.pass + d.fail;
      const rate  = total ? Math.round(d.pass / total * 100) : 0;
      return '<tr><td style="font-weight:700">' + esc(name) + '</td>' +
        '<td>' + d.runs + '</td>' +
        '<td style="color:var(--green);font-weight:600">' + d.pass + '</td>' +
        '<td style="color:' + (d.fail ? 'var(--red)' : 'var(--muted)') + ';font-weight:600">' + d.fail + '</td>' +
        '<td style="font-family:var(--m)">$' + d.cost.toFixed(4) + '</td>' +
        '<td>' + statusPill(rate >= 80 ? 'pass' : rate >= 50 ? 'warn' : 'fail', rate + '%') + '</td>' +
        '</tr>';
    }).join('') + '</tbody></table>';
}

// ── Run detail drawer ──────────────────────────────────────────────────────
function openDrawer(runId) {
  const r = (STATE.runs ?? []).find(x => x.runId === runId);
  if (!r) return;
  const tl     = r.activityTimeline ?? [];
  const tasks  = r.tasks ?? [];
  const passed = tasks.filter(t => t.status === 'PASS').length;
  const failed = tasks.filter(t => t.status === 'FAIL').length;
  const totalTc = tl.reduce((n, m) => n + m.toolCalls, 0);

  document.getElementById('drawer-run-id').textContent = runId.slice(0, 55);
  document.getElementById('drawer-goal').textContent   = r.manifest?.goal ?? '—';

  // KPIs
  document.getElementById('drawer-kpis').innerHTML = [
    [totalTc, 'Tool Calls', 'var(--blue)'],
    [tl.length, 'Minutes', 'var(--accent)'],
    [passed, 'Passed', 'var(--green)'],
    [failed, 'Failed', failed > 0 ? 'var(--red)' : 'var(--muted)'],
  ].map(([v, l, c]) =>
    '<div class="drawer-kpi"><div class="drawer-kpi-val" style="color:' + c + '">' + v + '</div><div class="drawer-kpi-lbl">' + l + '</div></div>'
  ).join('');

  // SVG timeline
  const svgEl = document.getElementById('drawer-timeline');
  if (tl.length) {
    const W = 480, H = 50;
    const maxTc = Math.max(1, ...tl.map(m => m.toolCalls));
    const bw = Math.max(3, Math.floor(W / tl.length) - 1);
    svgEl.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svgEl.setAttribute('style', 'width:100%;height:54px');
    svgEl.innerHTML = tl.map((m, i) => {
      const bh  = Math.max(2, Math.round((m.toolCalls / maxTc) * H));
      const x   = i * (bw + 1), y = H - bh;
      const col = m.stagesDone?.length ? '#10b981' : m.guardrails ? '#ef4444' : '#3b82f6';
      return '<rect x="' + x + '" y="' + y + '" width="' + bw + '" height="' + bh + '" fill="' + col + '" rx="1" opacity=".8"><title>' + esc(m.minute) + ' · ' + m.toolCalls + ' calls' + (m.stagesDone?.length ? ' · ✓ ' + m.stagesDone[0] : '') + '</title></rect>';
    }).join('');
  } else {
    svgEl.innerHTML = '<text x="10" y="24" font-size="12" fill="#94a3b8">No timeline data</text>';
  }

  // Minutes
  const maxTc2 = Math.max(1, ...tl.map(m => m.toolCalls));
  document.getElementById('drawer-minutes').innerHTML = tl.length
    ? tl.map(m => {
      const pct = Math.round((m.toolCalls / maxTc2) * 100);
      const tags = [
        ...(m.tasksPassed ? ['<span class="pill pass">' + m.tasksPassed + ' pass</span>'] : []),
        ...(m.tasksFailed ? ['<span class="pill fail">' + m.tasksFailed + ' fail</span>'] : []),
        ...(m.stagesDone?.length ? ['<span class="pill info">stage: ' + m.stagesDone[0] + '</span>'] : []),
        ...(m.guardrails ? ['<span class="pill warn">guardrail</span>'] : []),
      ].join('');
      return '<div class="min-row"><span class="min-time">' + m.minute.slice(11, 16) + '</span>' +
        '<div class="min-bar-wrap"><div class="min-bar" style="width:' + pct + '%"></div></div>' +
        '<span class="min-count">' + m.toolCalls + '</span>' +
        (tags ? '<div class="min-tags">' + tags + '</div>' : '') + '</div>';
    }).join('')
    : '<div style="color:var(--muted);font-size:12px;padding:8px 0">No minute data</div>';

  // Quality
  const allQ = tl.flatMap(m => m.quality ?? []);
  const qWrap = document.getElementById('drawer-quality-wrap');
  if (allQ.length) {
    qWrap.style.display = '';
    document.getElementById('drawer-quality').innerHTML = allQ.map(q => {
      const pct = q.total > 0 ? Math.round((q.pass / q.total) * 100) : 0;
      return '<div class="quality-row"><div style="flex:1"><div style="font-size:12px;font-weight:600">' + esc(q.task ?? '—') + '</div><div class="quality-bar" style="width:' + pct + '%"></div></div><span class="pill ' + (pct === 100 ? 'pass' : pct >= 80 ? 'info' : 'warn') + '">' + pct + '%</span></div>';
    }).join('');
  } else { qWrap.style.display = 'none'; }

  // Stages
  const stages2 = tl.flatMap(m => (m.stagesDone ?? []).map(s => ({ s, min: m.minute })));
  document.getElementById('drawer-stages').innerHTML = stages2.length
    ? stages2.map(x => '<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border);font-size:12px"><span>' + esc(x.s) + '</span><span style="font-family:var(--m);font-size:10px;color:var(--muted)">' + x.min.slice(11, 16) + '</span></div>').join('')
    : '<div style="color:var(--muted);font-size:12px;padding:8px 0">No stage completions recorded</div>';

  document.getElementById('drawer-overlay').classList.add('open');
  document.getElementById('detail-drawer').classList.add('open');
}

function openAgentDrawer(idx) {
  const w = (STATE.agentWork ?? [])[idx];
  if (!w) return;
  const r = (STATE.runs ?? []).find(x => x.runId === w.runId);
  if (r) openDrawer(r.runId);
}

function closeDrawer() {
  document.getElementById('detail-drawer').classList.remove('open');
  document.getElementById('drawer-overlay').classList.remove('open');
}

// ── Utilities ──────────────────────────────────────────────────────────────
function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function statusPill(status, label) {
  const l = label ?? (status ?? '—').toUpperCase();
  const cls = { active:'active', done:'done', pass:'pass', fail:'fail', stalled:'stalled', warn:'warn', idle:'idle', ended:'ended', info:'info' }[status] ?? 'idle';
  return '<span class="pill ' + cls + '">' + l + '</span>';
}

function dotClass(s) { return { PASS:'pass', FAIL:'fail', IN_PROGRESS:'active', READY:'ready' }[s] ?? 'ready'; }

function pbar(label, val, max, prefix = '', dp = 0) {
  const pct = Math.min(100, max > 0 ? (val / max) * 100 : 0);
  const cls = pct < 60 ? 'safe' : pct < 85 ? 'warn' : 'danger';
  const fmt = v => prefix + (dp ? Number(v).toFixed(dp) : v);
  return '<div class="pbar-row"><div class="pbar-label"><span>' + label + '</span><span>' + fmt(val) + ' / ' + fmt(max) + '</span></div>' +
    '<div class="pbar"><div class="pbar-fill ' + cls + '" style="width:' + pct.toFixed(1) + '%"></div></div></div>';
}

function emptyState(icon, title, sub) {
  return '<div class="empty-state"><div class="empty-icon">' + icon + '</div><div class="empty-title">' + title + '</div><div class="empty-sub">' + sub + '</div></div>';
}

function sparklineSvg(timeline, width, height) {
  if (!timeline?.length) return '';
  const maxTc = Math.max(1, ...timeline.map(m => m.toolCalls));
  const bw = Math.max(1, Math.floor(width / timeline.length) - 1);
  const bars = timeline.map((m, i) => {
    const bh  = Math.max(1, Math.round((m.toolCalls / maxTc) * height));
    const x   = i * (bw + 1), y = height - bh;
    const col = m.stagesDone?.length ? '#10b981' : m.guardrails ? '#ef4444' : '#3b82f6';
    return '<rect x="' + x + '" y="' + y + '" width="' + bw + '" height="' + bh + '" fill="' + col + '" rx="1"/>';
  }).join('');
  return '<svg width="' + width + '" height="' + height + '" style="display:block;opacity:.75">' + bars + '</svg>';
}

// ── Boot ───────────────────────────────────────────────────────────────────
connect();
</script>
</body>
</html>`;
}
