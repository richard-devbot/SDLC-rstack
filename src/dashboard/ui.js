// owner: RStack developed by Richardson Gunde
// Professional dashboard — design language from rstack-workspace-v8
// Fonts: DM Sans + JetBrains Mono | Accent: amber #D97706

export function dashboardHtml(port) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>rstack · business hub</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=DM+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
:root {
  --accent:       #D97706;
  --accent-bg:    rgba(217,119,6,.08);
  --accent-border:rgba(217,119,6,.25);
  --accent-deep:  #92400E;
  --bg:           #FAFAFA;
  --surface:      #FFFFFF;
  --elevated:     #F4F4F5;
  --border:       #E4E4E7;
  --border-strong:#D4D4D8;
  --text:         #18181B;
  --text-2:       #52525B;
  --text-3:       #A1A1AA;
  --success:      #16A34A;
  --success-bg:   rgba(22,163,74,.08);
  --success-border:rgba(22,163,74,.25);
  --error:        #DC2626;
  --error-bg:     rgba(220,38,38,.08);
  --error-border: rgba(220,38,38,.25);
  --info:         #2563EB;
  --info-bg:      rgba(37,99,235,.08);
  --info-border:  rgba(37,99,235,.25);
  --warn:         #D97706;
  --sidebar-w:    220px;
  --topbar-h:     52px;
  --f: 'DM Sans', system-ui, sans-serif;
  --m: 'JetBrains Mono', 'Cascadia Code', monospace;
  --shadow: 0 1px 3px rgba(0,0,0,.06), 0 1px 2px rgba(0,0,0,.04);
  --shadow-md: 0 4px 12px rgba(0,0,0,.08), 0 2px 4px rgba(0,0,0,.04);
  --shadow-lg: 0 20px 40px rgba(0,0,0,.1), 0 4px 12px rgba(0,0,0,.06);
}
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;overflow:hidden}
body{font-family:var(--f);background:var(--bg);color:var(--text);font-size:13.5px;line-height:1.55}

/* ── Shell ── */
#app{display:flex;height:100vh;overflow:hidden}

/* ── Sidebar ── */
#sb{
  width:var(--sidebar-w);flex-shrink:0;background:var(--text);
  display:flex;flex-direction:column;overflow:hidden;
}
.sb-brand{
  padding:16px;border-bottom:1px solid rgba(255,255,255,.07);
  display:flex;align-items:center;gap:10px;flex-shrink:0;
}
.sb-logo{
  width:30px;height:30px;border-radius:8px;background:var(--accent);
  display:flex;align-items:center;justify-content:center;
  font-family:var(--m);font-size:13px;font-weight:700;color:#fff;flex-shrink:0;
}
.sb-name{font-size:13.5px;font-weight:700;color:#F4F4F5;letter-spacing:-.01em}
.sb-sub{font-size:10px;color:rgba(255,255,255,.35);font-family:var(--m);letter-spacing:.05em;margin-top:1px}
.sb-live{width:6px;height:6px;border-radius:50%;background:#374151;margin-left:auto;flex-shrink:0;transition:background .3s}
.sb-live.on{background:var(--success);box-shadow:0 0 6px var(--success)}

.sb-nav{padding:10px 8px;flex:1;overflow-y:auto}
.sb-cat{font-family:var(--m);font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:.12em;
  color:rgba(255,255,255,.25);padding:10px 10px 4px}
.sb-btn{
  width:100%;display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:7px;
  border:none;background:none;color:rgba(255,255,255,.45);font-size:12.5px;font-weight:500;
  cursor:pointer;text-align:left;transition:all .12s;margin-bottom:1px;font-family:var(--f);
}
.sb-btn:hover{background:rgba(255,255,255,.07);color:rgba(255,255,255,.8)}
.sb-btn.active{background:var(--accent-bg);color:var(--accent);border:1px solid var(--accent-border)}
.sb-btn .ic{font-size:13px;width:16px;text-align:center;flex-shrink:0}
.sb-badge{
  margin-left:auto;min-width:18px;height:18px;padding:0 5px;border-radius:9px;
  background:var(--error);color:#fff;font-size:9px;font-weight:700;
  display:none;align-items:center;justify-content:center;font-family:var(--m);
}

.sb-foot{padding:12px;border-top:1px solid rgba(255,255,255,.07);flex-shrink:0}
.sb-kpis{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.sb-kpi{background:rgba(255,255,255,.05);border-radius:7px;padding:8px 10px}
.sb-kpi-v{font-family:var(--m);font-size:15px;font-weight:700;color:#F4F4F5;line-height:1}
.sb-kpi-l{font-size:9px;color:rgba(255,255,255,.3);text-transform:uppercase;letter-spacing:.07em;margin-top:2px}

/* ── Main ── */
#main{flex:1;display:flex;flex-direction:column;min-width:0;overflow:hidden}

/* ── Topbar ── */
#tb{
  height:var(--topbar-h);background:var(--surface);border-bottom:1px solid var(--border);
  padding:0 20px;display:flex;align-items:center;gap:12px;flex-shrink:0;box-shadow:var(--shadow);z-index:10;
}
.tb-title{font-size:14px;font-weight:700;color:var(--text)}
.tb-div{width:1px;height:18px;background:var(--border);flex-shrink:0}
.tb-stat{display:flex;align-items:center;gap:5px;font-size:12px;color:var(--text-2)}
.tb-dot{width:7px;height:7px;border-radius:50%}
.tb-right{margin-left:auto;display:flex;gap:8px}
.tb-chip{
  display:flex;align-items:center;gap:5px;padding:5px 10px;border-radius:6px;
  border:1px solid var(--border);background:var(--elevated);
  font-size:11.5px;cursor:pointer;transition:all .12s;color:var(--text-2);font-family:var(--f);
}
.tb-chip:hover{border-color:var(--accent);background:var(--accent-bg);color:var(--accent)}
.tb-chip.alert{border-color:var(--error-border);background:var(--error-bg);color:var(--error)}
.tb-chip.warn{border-color:var(--accent-border);background:var(--accent-bg);color:var(--accent)}

/* ── Pages ── */
.page{display:none;flex:1;overflow-y:auto;padding:20px}
.page.active{display:block}
.pg-head{margin-bottom:20px}
.pg-title{font-size:20px;font-weight:800;letter-spacing:-.02em;margin-bottom:3px}
.pg-sub{font-size:13px;color:var(--text-2)}

/* ── Card ── */
.card{background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden;box-shadow:var(--shadow)}
.card.accent-left{border-left:3px solid var(--accent)}
.card-hdr{
  padding:11px 16px;font-family:var(--m);font-size:10px;font-weight:600;text-transform:uppercase;
  letter-spacing:.1em;color:var(--text-3);border-bottom:1px solid var(--border);
  display:flex;align-items:center;justify-content:space-between;
}
.card-hdr .live{width:5px;height:5px;border-radius:50%;background:var(--success);animation:pulse-g 2s infinite}
@keyframes pulse-g{0%,100%{opacity:1}50%{opacity:.3}}
.card-body{padding:14px 16px}

/* ── KPI strip ── */
.kpi-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:20px}
.kpi{
  background:var(--surface);border:1px solid var(--border);border-radius:10px;
  padding:14px 16px;box-shadow:var(--shadow);
}
.kpi-v{font-family:var(--m);font-size:24px;font-weight:700;line-height:1;margin-bottom:4px}
.kpi-l{font-size:10.5px;font-weight:600;text-transform:uppercase;letter-spacing:.07em;color:var(--text-3)}
.kpi-s{font-size:11px;color:var(--text-3);margin-top:3px}
.kpi.orange .kpi-v{color:var(--accent)}
.kpi.green  .kpi-v{color:var(--success)}
.kpi.blue   .kpi-v{color:var(--info)}
.kpi.red    .kpi-v{color:var(--error)}
.kpi.orange{border-left:3px solid var(--accent)}
.kpi.green{border-left:3px solid var(--success)}
.kpi.blue{border-left:3px solid var(--info)}
.kpi.red{border-left:3px solid var(--error)}

/* ── Two-col ── */
.two-col{display:grid;grid-template-columns:1fr 360px;gap:16px;align-items:start}
@media(max-width:1200px){.two-col{grid-template-columns:1fr}}

/* ── Agent card ── */
.agent-card{
  background:var(--surface);border:1px solid var(--border);border-left:3px solid var(--accent);
  border-radius:10px;padding:16px;margin-bottom:10px;cursor:pointer;
  transition:box-shadow .15s;
}
.agent-card:hover{box-shadow:var(--shadow-md)}
.agent-card.pass{border-left-color:var(--success)}
.agent-card.fail{border-left-color:var(--error)}
.agent-card.running{border-left-color:var(--accent)}
.agent-hdr{display:flex;align-items:flex-start;gap:10px;margin-bottom:8px}
.agent-persona{
  font-family:var(--m);font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:.12em;
  color:var(--accent);margin-bottom:3px;
}
.agent-title{font-size:13.5px;font-weight:700;color:var(--text);margin-bottom:2px}
.agent-id{font-family:var(--m);font-size:10px;color:var(--text-3)}
.agent-summary{font-size:12.5px;color:var(--text-2);line-height:1.5;margin-bottom:10px}
.agent-sections{display:flex;flex-direction:column;gap:8px}
.agent-sec-label{
  font-family:var(--m);font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:.1em;
  color:var(--text-3);margin-bottom:4px;
}
.agent-sec-body{font-size:12px;color:var(--text-2);line-height:1.4}
.agent-chips{display:flex;gap:5px;flex-wrap:wrap;margin-top:8px}
.chip{
  font-family:var(--m);font-size:10px;padding:3px 8px;border-radius:4px;
  background:var(--elevated);border:1px solid var(--border);color:var(--text-2);
}
.chip.accent{background:var(--accent-bg);border-color:var(--accent-border);color:var(--accent-deep)}
.chip.green{background:var(--success-bg);border-color:var(--success-border);color:var(--success)}
.chip.blue{background:var(--info-bg);border-color:var(--info-border);color:var(--info)}
.chip.red{background:var(--error-bg);border-color:var(--error-border);color:var(--error)}

/* ── Evidence bar ── */
.evidence-bar{
  display:flex;align-items:center;gap:8px;padding:8px 10px;
  background:var(--elevated);border-radius:6px;font-size:11.5px;
}
.evidence-fill{height:4px;border-radius:2px;background:var(--success)}
.evidence-wrap{flex:1;background:var(--border);border-radius:2px;height:4px;overflow:hidden}

/* ── Pill ── */
.pill{
  display:inline-flex;align-items:center;gap:3px;
  font-size:9.5px;font-weight:700;padding:2px 8px;border-radius:20px;
  text-transform:uppercase;letter-spacing:.04em;white-space:nowrap;
  font-family:var(--m);
}
.pill-dot{width:5px;height:5px;border-radius:50%;background:currentColor}
.pill.pass,.pill.done{background:var(--success-bg);color:var(--success);border:1px solid var(--success-border)}
.pill.fail{background:var(--error-bg);color:var(--error);border:1px solid var(--error-border)}
.pill.running,.pill.active{background:var(--accent-bg);color:var(--accent);border:1px solid var(--accent-border)}
.pill.queued,.pill.idle,.pill.ready{background:var(--info-bg);color:var(--info);border:1px solid var(--info-border)}
.pill.stalled,.pill.warn{background:var(--accent-bg);color:var(--accent);border:1px solid var(--accent-border)}
.pill.ended{background:var(--elevated);color:var(--text-3);border:1px solid var(--border)}

/* ── Pipeline stage timeline ── */
.pipeline-row{
  display:flex;align-items:stretch;gap:0;margin-bottom:16px;
  overflow-x:auto;padding-bottom:4px;
}
.stage-node{
  flex-shrink:0;background:var(--surface);border:1px solid var(--border);
  border-radius:8px;padding:10px 12px;min-width:110px;text-align:center;
  position:relative;transition:box-shadow .15s;cursor:pointer;
}
.stage-node:not(:last-child)::after{
  content:'→';position:absolute;right:-14px;top:50%;transform:translateY(-50%);
  color:var(--text-3);font-size:11px;z-index:1;
}
.stage-node:not(:last-child){margin-right:16px}
.stage-node.done{border-color:var(--success-border);background:var(--success-bg)}
.stage-node.running{border-color:var(--accent-border);background:var(--accent-bg);
  animation:pulse-border 2s infinite}
@keyframes pulse-border{0%,100%{box-shadow:0 0 0 0 rgba(217,119,6,.2)}50%{box-shadow:0 0 0 4px rgba(217,119,6,.1)}}
.stage-node.queued{border-color:var(--info-border)}
.stage-node.fail{border-color:var(--error-border);background:var(--error-bg)}
.stage-id{font-family:var(--m);font-size:9px;color:var(--text-3);margin-bottom:3px}
.stage-name{font-size:11px;font-weight:700;margin-bottom:5px;line-height:1.2}
.stage-status-dot{width:8px;height:8px;border-radius:50%;margin:0 auto;background:var(--border)}
.stage-node.done .stage-status-dot{background:var(--success)}
.stage-node.running .stage-status-dot{background:var(--accent)}
.stage-node.fail .stage-status-dot{background:var(--error)}
.stage-node.queued .stage-status-dot{background:var(--info)}

/* ── Feed ── */
.feed-row{display:flex;gap:10px;padding:10px 0;border-bottom:1px solid var(--border);align-items:flex-start}
.feed-row:last-child{border-bottom:none}
.feed-icon{
  width:22px;height:22px;border-radius:5px;display:flex;align-items:center;justify-content:center;
  font-size:10px;flex-shrink:0;margin-top:1px;font-family:var(--m);font-weight:700;
}
.feed-icon.pass{background:var(--success-bg);color:var(--success)}
.feed-icon.fail{background:var(--error-bg);color:var(--error)}
.feed-icon.warn{background:var(--accent-bg);color:var(--accent)}
.feed-icon.info{background:var(--info-bg);color:var(--info)}
.feed-icon.tool{background:var(--elevated);color:var(--text-3)}
.feed-icon.dim{background:var(--elevated);color:var(--text-3)}
.feed-txt{flex:1;min-width:0}
.feed-summary{font-size:12.5px;color:var(--text);line-height:1.4}
.feed-meta{font-family:var(--m);font-size:10px;color:var(--text-3);margin-top:2px;display:flex;gap:8px}
.feed-ts{font-family:var(--m);font-size:10px;color:var(--text-3);white-space:nowrap;flex-shrink:0}

/* ── Run table ── */
.rtable{width:100%;border-collapse:collapse}
.rtable th{
  font-family:var(--m);font-size:9.5px;font-weight:600;text-transform:uppercase;letter-spacing:.09em;
  color:var(--text-3);padding:8px 12px;text-align:left;border-bottom:1px solid var(--border);
  background:var(--elevated);
}
.rtable td{padding:11px 12px;border-bottom:1px solid var(--border);vertical-align:middle;font-size:12.5px}
.rtable tr.row:hover td{background:var(--elevated);cursor:pointer}
.rtable tr:last-child td{border-bottom:none}

/* ── Stage matrix grid ── */
.stage-matrix{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;padding:16px}
@media(max-width:1400px){.stage-matrix{grid-template-columns:repeat(3,1fr)}}
.stage-tile{background:var(--elevated);border:1px solid var(--border);border-radius:10px;padding:12px}
.stage-tile.has-pass{border-left:3px solid var(--success)}
.stage-tile.has-fail{border-left:3px solid var(--error)}
.stage-tile.has-active{border-left:3px solid var(--accent)}
.stage-tid{font-family:var(--m);font-size:9px;color:var(--text-3);margin-bottom:3px}
.stage-tname{font-size:12px;font-weight:700;margin-bottom:8px}
.stage-tdots{display:flex;gap:3px;flex-wrap:wrap}
.rdot{width:8px;height:8px;border-radius:50%;background:var(--border)}
.rdot.pass{background:var(--success)}.rdot.fail{background:var(--error)}
.rdot.active{background:var(--accent)}.rdot.ready{background:var(--info)}

/* ── Approval / Alert ── */
.approval{
  background:var(--surface);border:1px solid var(--border);border-radius:10px;
  padding:16px;margin-bottom:10px;
}
.approval.pending{border-left:3px solid var(--accent)}
.approval.approved{border-left:3px solid var(--success);opacity:.7}
.approval.rejected{border-left:3px solid var(--error);opacity:.7}
.alert-row{padding:12px 14px;border-radius:8px;margin-bottom:8px;border:1px solid transparent;display:flex;gap:12px}
.alert-row.warn{background:var(--accent-bg);border-color:var(--accent-border)}
.alert-row.critical{background:var(--error-bg);border-color:var(--error-border)}
.alert-row.info{background:var(--info-bg);border-color:var(--info-border)}

/* ── Detail panel (slide-out) ── */
#panel-overlay{display:none;position:fixed;inset:0;background:rgba(24,24,27,.4);z-index:99;backdrop-filter:blur(2px)}
#panel-overlay.open{display:block}
#detail-panel{
  position:fixed;right:0;top:0;bottom:0;width:540px;background:var(--surface);
  border-left:1px solid var(--border);z-index:100;transform:translateX(100%);
  transition:transform .25s cubic-bezier(.4,0,.2,1);display:flex;flex-direction:column;
  box-shadow:var(--shadow-lg);
}
#detail-panel.open{transform:translateX(0)}
.dp-hdr{
  padding:18px 20px;border-bottom:1px solid var(--border);
  display:flex;align-items:flex-start;gap:12px;flex-shrink:0;
}
.dp-hdr-main{flex:1;min-width:0}
.dp-eyebrow{font-family:var(--m);font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:.12em;color:var(--accent);margin-bottom:4px}
.dp-title{font-size:15px;font-weight:800;letter-spacing:-.01em;line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dp-sub{font-size:11.5px;color:var(--text-2);margin-top:3px;font-family:var(--m)}
.dp-close{background:none;border:none;font-size:18px;cursor:pointer;color:var(--text-3);flex-shrink:0;padding:2px;line-height:1}
.dp-close:hover{color:var(--text)}
.dp-body{flex:1;overflow-y:auto;padding:18px 20px;display:flex;flex-direction:column;gap:18px}
.dp-section{font-family:var(--m);font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:.1em;color:var(--text-3);margin-bottom:8px}
.dp-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
.dp-kpi{background:var(--elevated);border-radius:7px;padding:9px 10px;text-align:center}
.dp-kpi-v{font-family:var(--m);font-size:18px;font-weight:700;line-height:1;margin-bottom:3px}
.dp-kpi-l{font-size:9px;color:var(--text-3);text-transform:uppercase;letter-spacing:.07em}
.dp-item{
  display:flex;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);
  font-size:12px;line-height:1.4;align-items:baseline;
}
.dp-item:last-child{border-bottom:none}
.dp-item-ic{font-family:var(--m);font-size:9px;width:14px;flex-shrink:0;color:var(--accent);font-weight:700}
.dp-io{
  font-family:var(--m);font-size:10.5px;padding:8px 10px;
  background:var(--elevated);border-radius:6px;border:1px solid var(--border);
  display:grid;grid-template-columns:auto 1fr;gap:5px 10px;
}
.dp-io-k{color:var(--text-3)}
.dp-io-v{color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* ── Empty state ── */
.empty{display:flex;flex-direction:column;align-items:center;justify-content:center;
  padding:48px 20px;gap:10px;text-align:center;color:var(--text-3)}
.empty-ic{font-size:32px;opacity:.4;margin-bottom:4px}
.empty-t{font-size:15px;font-weight:700;color:var(--text-2)}
.empty-s{font-size:13px;max-width:300px;line-height:1.5}

/* ── Project card ── */
.proj-card{
  background:var(--elevated);border:1px solid var(--border);border-radius:8px;padding:12px 14px;
  margin-bottom:8px;
}
.proj-name{font-size:13px;font-weight:700;margin-bottom:2px}
.proj-path{font-family:var(--m);font-size:10px;color:var(--text-3);margin-bottom:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* ── Sparkline ── */
.spark{display:inline-block;vertical-align:middle}

/* ── Scrollbar ── */
::-webkit-scrollbar{width:5px;height:5px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:var(--border-strong,#D4D4D8);border-radius:3px}
</style>
</head>
<body>
<div id="app">

  <!-- sidebar -->
  <div id="sb">
    <div class="sb-brand">
      <div class="sb-logo">R</div>
      <div>
        <div class="sb-name">rstack</div>
        <div class="sb-sub">business hub</div>
      </div>
      <div class="sb-live" id="live-dot"></div>
    </div>
    <div class="sb-nav">
      <div class="sb-cat">Observe</div>
      <button class="sb-btn active" data-pg="command"><span class="ic">⌘</span>Command Center</button>
      <button class="sb-btn" data-pg="feed"><span class="ic">⚡</span>Live Feed</button>
      <button class="sb-btn" data-pg="pipeline"><span class="ic">→</span>Pipeline</button>
      <button class="sb-btn" data-pg="agents"><span class="ic">◈</span>Agent Actions</button>
      <div class="sb-cat">Manage</div>
      <button class="sb-btn" data-pg="approvals"><span class="ic">✓</span>Approvals<span class="sb-badge" id="badge-a">0</span></button>
      <button class="sb-btn" data-pg="alerts"><span class="ic">△</span>Alerts<span class="sb-badge" id="badge-al">0</span></button>
      <div class="sb-cat">Explore</div>
      <button class="sb-btn" data-pg="runs"><span class="ic">▦</span>All Runs</button>
      <button class="sb-btn" data-pg="traceability"><span class="ic">◉</span>Traceability</button>
      <button class="sb-btn" data-pg="team"><span class="ic">≡</span>Team</button>
    </div>
    <div class="sb-foot">
      <div class="sb-kpis">
        <div class="sb-kpi"><div class="sb-kpi-v" id="sk-runs">—</div><div class="sb-kpi-l">Runs</div></div>
        <div class="sb-kpi"><div class="sb-kpi-v" id="sk-cost">—</div><div class="sb-kpi-l">Cost</div></div>
        <div class="sb-kpi"><div class="sb-kpi-v" id="sk-active">—</div><div class="sb-kpi-l">Active</div></div>
        <div class="sb-kpi"><div class="sb-kpi-v" id="sk-agents">—</div><div class="sb-kpi-l">Agents</div></div>
      </div>
    </div>
  </div>

  <!-- main -->
  <div id="main">
    <div id="tb">
      <span class="tb-title" id="tb-title">Command Center</span>
      <div class="tb-div"></div>
      <div class="tb-stat"><div class="tb-dot" id="tb-dot" style="background:var(--text-3)"></div><span id="tb-status">Connecting…</span></div>
      <div class="tb-right">
        <button class="tb-chip" id="tb-alerts" onclick="nav('alerts')">△ <span id="tb-alert-txt">0 alerts</span></button>
        <button class="tb-chip" id="tb-approvals" onclick="nav('approvals')">✓ <span id="tb-appr-txt">0 pending</span></button>
      </div>
    </div>

    <!-- COMMAND CENTER -->
    <div class="page active" id="page-command">
      <div class="pg-head"><div class="pg-title">Command Center</div><div class="pg-sub">Live view across all projects, runs, and agent actions</div></div>
      <div class="kpi-row">
        <div class="kpi orange"><div class="kpi-v" id="k-runs">—</div><div class="kpi-l">Total Runs</div><div class="kpi-s" id="k-runs-s">— today</div></div>
        <div class="kpi green"><div class="kpi-v" id="k-pass">—</div><div class="kpi-l">Tasks Passed</div><div class="kpi-s" id="k-pass-s">— failed</div></div>
        <div class="kpi blue"><div class="kpi-v" id="k-agents">—</div><div class="kpi-l">Agent Actions</div><div class="kpi-s" id="k-agents-s">— with evidence</div></div>
        <div class="kpi red"><div class="kpi-v" id="k-cost">—</div><div class="kpi-l">Total Cost</div><div class="kpi-s" id="k-cost-s">— frameworks</div></div>
      </div>
      <div class="two-col">
        <div style="display:flex;flex-direction:column;gap:14px">
          <div class="card">
            <div class="card-hdr"><span><div class="live" style="display:inline-block;width:5px;height:5px;border-radius:50%;background:var(--success);margin-right:6px;animation:pulse-g 2s infinite"></div>Recent Activity</span><span id="cmd-feed-count" style="font-size:11px;color:var(--text-3);font-weight:400;text-transform:none;letter-spacing:0"></span></div>
            <div class="card-body" style="max-height:260px;overflow-y:auto" id="cmd-feed"></div>
          </div>
          <div class="card">
            <div class="card-hdr">Projects <span id="cmd-proj-count" style="font-weight:400;text-transform:none;letter-spacing:0;font-size:11px;color:var(--text-3)"></span></div>
            <div class="card-body" id="cmd-projects"></div>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:14px">
          <div class="card">
            <div class="card-hdr">Active Runs</div>
            <div class="card-body" id="cmd-active"></div>
          </div>
          <div class="card">
            <div class="card-hdr">Guardrail Health</div>
            <div class="card-body" id="cmd-guardrails"></div>
          </div>
          <div class="card">
            <div class="card-hdr">Alerts</div>
            <div class="card-body" id="cmd-alerts"></div>
          </div>
        </div>
      </div>
    </div>

    <!-- LIVE FEED -->
    <div class="page" id="page-feed">
      <div class="pg-head"><div class="pg-title">Live Feed</div><div class="pg-sub">Every agent event in plain language — real time</div></div>
      <div class="card">
        <div class="card-hdr"><span>Activity Stream</span><span id="feed-cnt" style="font-weight:400;text-transform:none;letter-spacing:0;font-size:11px;color:var(--text-3)"></span></div>
        <div class="card-body" style="max-height:calc(100vh - 180px);overflow-y:auto" id="feed-list"></div>
      </div>
    </div>

    <!-- PIPELINE -->
    <div class="page" id="page-pipeline">
      <div class="pg-head"><div class="pg-title">Pipeline</div><div class="pg-sub">15-stage SDLC — per-run stage status</div></div>
      <div id="pipeline-runs"></div>
    </div>

    <!-- AGENT ACTIONS -->
    <div class="page" id="page-agents">
      <div class="pg-head"><div class="pg-title">Agent Actions</div><div class="pg-sub">What every builder did — decisions, evidence, risks, tests run</div></div>
      <div id="agent-list"></div>
    </div>

    <!-- APPROVALS -->
    <div class="page" id="page-approvals">
      <div class="pg-head"><div class="pg-title">Approvals</div><div class="pg-sub">Human-in-loop gates</div></div>
      <div style="max-width:700px" id="approvals-list"></div>
    </div>

    <!-- ALERTS -->
    <div class="page" id="page-alerts">
      <div class="pg-head"><div class="pg-title">Alerts</div><div class="pg-sub">Threshold violations</div></div>
      <div style="max-width:700px" id="alerts-list"></div>
    </div>

    <!-- ALL RUNS -->
    <div class="page" id="page-runs">
      <div class="pg-head"><div class="pg-title">All Runs</div><div class="pg-sub">Every SDLC run — click for the full timeline and agent work</div></div>
      <div class="card">
        <div class="card-hdr">Runs <span id="runs-cnt" style="font-weight:400;text-transform:none;letter-spacing:0;font-size:11px;color:var(--text-3)"></span></div>
        <table class="rtable">
          <colgroup><col style="width:100px"><col style="width:auto"><col style="width:80px"><col style="width:100px"><col style="width:120px"><col style="width:55px"></colgroup>
          <thead><tr><th>Status</th><th>Goal</th><th>Project</th><th>Activity</th><th>Tasks</th><th>Cost</th></tr></thead>
          <tbody id="runs-body"></tbody>
        </table>
      </div>
    </div>

    <!-- TRACEABILITY -->
    <div class="page" id="page-traceability">
      <div class="pg-head"><div class="pg-title">Traceability</div><div class="pg-sub">Requirements → Architecture → Code → Test evidence</div></div>
      <div id="trace-list"></div>
    </div>

    <!-- TEAM -->
    <div class="page" id="page-team">
      <div class="pg-head"><div class="pg-title">Team</div><div class="pg-sub">Framework and runtime breakdown</div></div>
      <div class="card"><div class="card-hdr">Framework Breakdown</div><div class="card-body" id="team-body"></div></div>
    </div>
  </div>
</div>

<!-- Detail panel -->
<div id="panel-overlay" onclick="closePanel()"></div>
<div id="detail-panel">
  <div class="dp-hdr">
    <div class="dp-hdr-main">
      <div class="dp-eyebrow" id="dp-eyebrow">◆ run detail</div>
      <div class="dp-title" id="dp-title">—</div>
      <div class="dp-sub" id="dp-sub">—</div>
    </div>
    <button class="dp-close" onclick="closePanel()">✕</button>
  </div>
  <div class="dp-body" id="dp-body"></div>
</div>

<script>
// ── Globals ──────────────────────────────────────────────────────────────────
let S = null;
const PORT = ${port};

const STAGE_NAMES = {
  '00-environment':'Environment','01-transcript':'Transcript','02-requirements':'Requirements',
  '03-documentation':'Documentation','04-planning':'Planning','05-jira':'Jira Tickets',
  '06-architecture':'Architecture','07-code':'Code Gen','08-testing':'Testing',
  '09-deployment':'Deployment','10-summary':'Summary','11-feedback-loop':'Feedback',
  '12-security-threat-model':'Security','13-compliance-checker':'Compliance',
  '14-cost-estimation':'Cost Estimate',
  // Pi-style IDs
  '001-product-clarification':'Clarification','002-requirements':'Requirements',
  '003-architecture':'Architecture','004-implementation':'Code','005-testing':'Testing',
};

// ── Nav ───────────────────────────────────────────────────────────────────────
const PAGE_NAMES = {
  command:'Command Center',feed:'Live Feed',pipeline:'Pipeline',
  agents:'Agent Actions',approvals:'Approvals',alerts:'Alerts',
  runs:'All Runs',traceability:'Traceability',team:'Team',
};

function nav(id) {
  document.querySelectorAll('.sb-btn').forEach(b => b.classList.toggle('active', b.dataset.pg === id));
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === 'page-' + id));
  document.getElementById('tb-title').textContent = PAGE_NAMES[id] ?? id;
}
document.querySelectorAll('.sb-btn').forEach(b => b.addEventListener('click', () => nav(b.dataset.pg)));

// ── WebSocket ─────────────────────────────────────────────────────────────────
let ws, reconnTimer;
function connect() {
  ws = new WebSocket('ws://localhost:' + PORT);
  ws.onopen = () => {
    document.getElementById('live-dot').className = 'sb-live on';
    document.getElementById('tb-dot').style.background = 'var(--success)';
    document.getElementById('tb-status').textContent = 'Live';
    clearTimeout(reconnTimer);
  };
  ws.onmessage = e => { try { apply(JSON.parse(e.data)); } catch {} };
  ws.onclose = ws.onerror = () => {
    document.getElementById('live-dot').className = 'sb-live';
    document.getElementById('tb-dot').style.background = 'var(--accent)';
    document.getElementById('tb-status').textContent = 'Reconnecting…';
    reconnTimer = setTimeout(connect, 2500);
  };
}

// ── Apply state ───────────────────────────────────────────────────────────────
function apply(s) {
  S = s;
  renderSidebar();
  renderTopbar();
  renderCommand();
  renderFeed();
  renderPipeline();
  renderAgents();
  renderApprovals();
  renderAlerts();
  renderRuns();
  renderTraceability();
  renderTeam();
}

// ── Sidebar ───────────────────────────────────────────────────────────────────
function renderSidebar() {
  const allTasks = (S.runs ?? []).flatMap(r => r.tasks ?? []);
  set('sk-runs',   S.totalRuns ?? 0);
  set('sk-cost',   '$' + (S.totalCost ?? 0).toFixed(2));
  set('sk-active', (S.activeRuns ?? []).length);
  set('sk-agents', (S.agentWork ?? []).length);
  const pa = S.approvalStats?.pending ?? 0;
  const al = (S.alerts ?? []).length;
  const ba = document.getElementById('badge-a');
  const bal = document.getElementById('badge-al');
  ba.style.display = pa > 0 ? 'flex' : 'none'; ba.textContent = pa;
  bal.style.display = al > 0 ? 'flex' : 'none'; bal.textContent = al;
}

// ── Topbar ────────────────────────────────────────────────────────────────────
function renderTopbar() {
  const al = (S.alerts ?? []).length;
  const pa = S.approvalStats?.pending ?? 0;
  set('tb-alert-txt', al + ' alert' + (al !== 1 ? 's' : ''));
  set('tb-appr-txt',  pa + ' pending');
  document.getElementById('tb-alerts').className = 'tb-chip' + (al > 0 ? ' alert' : '');
  document.getElementById('tb-approvals').className = 'tb-chip' + (pa > 0 ? ' warn' : '');
}

// ── Command Center ─────────────────────────────────────────────────────────────
function renderCommand() {
  const allTasks = (S.runs ?? []).flatMap(r => r.tasks ?? []);
  const passed = allTasks.filter(t => t.status === 'PASS').length;
  const failed = allTasks.filter(t => t.status === 'FAIL').length;
  const withEvidence = (S.agentWork ?? []).filter(w => (w.evidenceCount ?? 0) > 0).length;

  set('k-runs',    S.totalRuns ?? 0);
  set('k-runs-s',  (S.todayCount ?? 0) + ' today');
  set('k-pass',    passed);
  set('k-pass-s',  failed + ' failed');
  set('k-agents',  (S.agentWork ?? []).length);
  set('k-agents-s',withEvidence + ' with evidence');
  set('k-cost',    '$' + (S.totalCost ?? 0).toFixed(4));
  set('k-cost-s',  Object.keys(S.frameworks ?? {}).join(', ') || '—');

  // Feed
  const feed = (S.feed ?? []).slice(0, 15);
  set('cmd-feed-count', feed.length + ' events');
  document.getElementById('cmd-feed').innerHTML =
    feed.length ? feed.map(f => feedRow(f)).join('') : empty('⚡','No events yet','Events stream here as agents run');

  // Projects
  const projs = buildProjects();
  set('cmd-proj-count', Object.keys(projs).length + ' projects');
  document.getElementById('cmd-projects').innerHTML = Object.values(projs)
    .sort((a, b) => b.last.localeCompare(a.last))
    .map(p => '<div class="proj-card">' +
      '<div class="proj-name">' + esc(p.name) + '</div>' +
      '<div class="proj-path">' + esc(p.path) + '</div>' +
      '<div style="display:flex;gap:6px;align-items:center;font-size:12px;color:var(--text-2);margin-bottom:6px">' +
        p.runs + ' runs · ' + p.active + ' active · $' + p.cost.toFixed(3) +
      '</div>' +
      '<div style="display:flex;gap:5px">' +
        pill('pass', p.pass + ' pass') + pill('fail', p.fail + ' fail') +
      '</div></div>'
    ).join('') || '<div style="padding:8px;color:var(--text-3);font-size:12px">No projects found</div>';

  // Active runs
  const active = (S.runs ?? []).filter(r => (S.activeRuns ?? []).includes(r.runId));
  document.getElementById('cmd-active').innerHTML = active.length
    ? active.map(r => {
        const tasks = r.tasks ?? [];
        const done = tasks.filter(t => t.status === 'PASS' || t.status === 'FAIL').length;
        const pct = tasks.length ? Math.round(done / tasks.length * 100) : 0;
        return '<div style="padding:8px 0;border-bottom:1px solid var(--border)">' +
          '<div style="font-size:12.5px;font-weight:600;margin-bottom:6px">' + esc((r.manifest?.goal ?? '—').slice(0,55)) + '</div>' +
          '<div style="height:3px;background:var(--border);border-radius:2px;overflow:hidden;margin-bottom:4px">' +
            '<div style="width:' + pct + '%;height:100%;background:var(--accent);border-radius:2px"></div>' +
          '</div>' +
          '<div style="font-size:11px;color:var(--text-3)">' + done + '/' + tasks.length + ' tasks · ' + pct + '% · ' + esc(r.derivedStatus) + '</div>' +
          '</div>';
      }).join('')
    : '<div style="padding:8px;color:var(--text-3);font-size:12px;font-style:italic">No active runs</div>';

  // Guardrails
  const tl = (S.runs ?? []).flatMap(r => r.activityTimeline ?? []);
  const tc = tl.reduce((n, m) => n + m.toolCalls, 0);
  const gh = tl.reduce((n, m) => n + (m.guardrails ?? 0), 0);
  document.getElementById('cmd-guardrails').innerHTML =
    pbar('Tool Calls', tc, Math.max(200, tc)) +
    pbar('Guardrail Hits', gh, Math.max(10, gh)) +
    pbar('Cost ($)', S.totalCost ?? 0, 10, '$', 4);

  // Alerts summary
  const alts = (S.alerts ?? []).slice(0, 3);
  document.getElementById('cmd-alerts').innerHTML = alts.length
    ? alts.map(a => '<div class="alert-row ' + (a.level ?? 'info') + '">' +
        '<span>' + ({warn:'⚠️',critical:'🔴',info:'ℹ️'}[a.level] ?? 'ℹ️') + '</span>' +
        '<div><div style="font-weight:700;font-size:12px">' + esc(a.title) + '</div>' +
        '<div style="font-size:11px;color:var(--text-2)">' + esc(a.detail) + '</div></div></div>'
      ).join('')
    : '<div style="padding:4px;color:var(--text-3);font-size:12px">All clear</div>';
}

// ── Feed ──────────────────────────────────────────────────────────────────────
function renderFeed() {
  const feed = S.feed ?? [];
  set('feed-cnt', feed.length + ' events');
  document.getElementById('feed-list').innerHTML =
    feed.length ? feed.map(f => feedRow(f)).join('') : empty('⚡','No events yet','Events appear here as runs execute');
}

function feedRow(f) {
  const ts = f.ts ? f.ts.replace('T',' ').slice(0,16) : '';
  const proj = f.projectRoot ? f.projectRoot.split('/').filter(Boolean).pop() : '';
  const ICONS = {pass:'✓',fail:'✗',warn:'!',info:'i',tool:'·',dim:'·'};
  return '<div class="feed-row">' +
    '<div class="feed-icon ' + (f.level ?? 'info') + '">' + (ICONS[f.level ?? 'info'] ?? 'i') + '</div>' +
    '<div class="feed-txt">' +
      '<div class="feed-summary">' + esc(f.summary) + '</div>' +
      '<div class="feed-meta">' +
        (f.runId ? '<span>' + esc(f.runId.slice(-10)) + '</span>' : '') +
        (proj ? '<span style="color:var(--info)">' + esc(proj) + '</span>' : '') +
        (f.goal ? '<span>' + esc(f.goal.slice(0,38)) + '</span>' : '') +
      '</div></div>' +
    '<div class="feed-ts">' + ts + '</div></div>';
}

// ── Pipeline ──────────────────────────────────────────────────────────────────
function renderPipeline() {
  const stages = S.stageMatrix ?? [];
  const runs = (S.runs ?? []).slice(0, 6);

  if (!runs.length) {
    document.getElementById('pipeline-runs').innerHTML = empty('→','No runs yet','Pipeline stages appear once runs execute');
    return;
  }

  document.getElementById('pipeline-runs').innerHTML = runs.map(r => {
    const tasks = r.tasks ?? [];
    const stageMap = {};
    for (const t of tasks) {
      for (const sa of t.stage_artifacts ?? []) {
        stageMap[sa.stage_id] = t.status === 'PASS' ? 'done' : t.status === 'FAIL' ? 'fail' :
          t.status === 'IN_PROGRESS' ? 'running' : 'queued';
      }
    }
    const proj = (r.projectRoot ?? '').split('/').filter(Boolean).pop() ?? '—';
    const tl = r.activityTimeline ?? [];
    const totalTc = tl.reduce((n, m) => n + m.toolCalls, 0);
    const stagesHtml = stages.slice(0, 10).map(s => {
      const st = stageMap[s.id] ?? 'queued';
      return '<div class="stage-node ' + st + '" title="' + esc(s.id) + '">' +
        '<div class="stage-id">' + esc(s.id.slice(0,2)) + '</div>' +
        '<div class="stage-name">' + esc(s.title.slice(0,10)) + '</div>' +
        '<div class="stage-status-dot"></div></div>';
    }).join('');

    return '<div style="margin-bottom:20px">' +
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">' +
        pill(r.derivedStatus) +
        '<span style="font-size:13px;font-weight:700;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(r.manifest?.goal ?? '—') + '</span>' +
        '<span style="font-family:var(--m);font-size:10.5px;color:var(--info)">' + esc(proj) + '</span>' +
        (totalTc ? '<span style="font-family:var(--m);font-size:10px;color:var(--text-3)">' + totalTc + ' calls</span>' : '') +
      '</div>' +
      '<div class="pipeline-row">' + stagesHtml + '</div>' +
      '</div>';
  }).join('');
}

// ── Agent Actions ─────────────────────────────────────────────────────────────
function renderAgents() {
  // Build agent action cards from actual task.builder data
  const allAgentTasks = [];
  for (const run of S.runs ?? []) {
    for (const task of run.tasks ?? []) {
      if (task.builder) {
        allAgentTasks.push({ run, task });
      }
    }
  }
  allAgentTasks.sort((a, b) => (b.task.builder?.status === 'PASS' ? 1 : 0) - (a.task.builder?.status === 'PASS' ? 1 : 0));

  if (!allAgentTasks.length) {
    document.getElementById('agent-list').innerHTML = empty('◈','No agent actions yet','builder.json contracts appear here once agents complete tasks');
    return;
  }

  document.getElementById('agent-list').innerHTML = allAgentTasks.slice(0, 40).map(({run, task}) => {
    const b = task.builder;
    const v = task.validation;
    const proj = (run.projectRoot ?? '').split('/').filter(Boolean).pop() ?? '—';
    const evPct = v ? Math.round(v.pass_checks / Math.max(1, v.total_checks) * 100) : 0;

    const decisionsHtml = (b.decisions ?? []).length
      ? '<div class="agent-sec-label">Decisions</div>' +
        (b.decisions ?? []).map(d => '<div class="dp-item"><span class="dp-item-ic">◆</span><span>' + esc(d) + '</span></div>').join('')
      : '';
    const risksHtml = (b.risks ?? []).length
      ? '<div class="agent-sec-label" style="margin-top:8px">Risks</div>' +
        (b.risks ?? []).map(r => '<div class="dp-item"><span class="dp-item-ic" style="color:var(--error)">▲</span><span>' + esc(r) + '</span></div>').join('')
      : '';
    const testsHtml = (b.tests_run ?? []).length
      ? '<div class="agent-sec-label" style="margin-top:8px">Evidence (tests run)</div>' +
        (b.tests_run ?? []).map(t => '<div class="dp-item"><span class="dp-item-ic" style="color:var(--success)">✓</span><span style="font-family:var(--m);font-size:10.5px">' + esc(t) + '</span></div>').join('')
      : '';
    const filesHtml = (b.files_modified ?? []).length
      ? '<div class="dp-io" style="margin-top:8px">' +
        (b.files_modified ?? []).map(f => '<span class="dp-io-k">→</span><span class="dp-io-v">' + esc(f) + '</span>').join('') +
        '</div>'
      : '';

    return '<div class="agent-card ' + (task.status ?? 'idle').toLowerCase() + '">' +
      '<div class="agent-hdr">' +
        '<div style="flex:1">' +
          '<div class="agent-persona">◆ ' + esc(b.status ?? 'builder') + ' · ' + esc(proj) + '</div>' +
          '<div class="agent-title">' + esc(task.title ?? task.id) + '</div>' +
          '<div class="agent-id">' + esc(task.id) + ' · ' + esc(run.runId.slice(-14)) + '</div>' +
        '</div>' +
        pill(task.status?.toLowerCase() ?? 'idle') +
      '</div>' +
      '<div class="agent-summary">' + esc(b.summary ?? b.work_done ?? '—') + '</div>' +
      (v ? '<div class="evidence-bar">' +
        '<div class="evidence-wrap"><div class="evidence-fill" style="width:' + evPct + '%"></div></div>' +
        '<span style="font-family:var(--m);font-size:11px;color:var(--success);font-weight:600">' + v.pass_checks + '/' + v.total_checks + ' checks</span>' +
        (v.failed_checks?.length ? '<span style="font-family:var(--m);font-size:10px;color:var(--error)">' + v.failed_checks.length + ' failed</span>' : '') +
      '</div>' : '') +
      '<div class="agent-sections">' + decisionsHtml + risksHtml + testsHtml + '</div>' +
      filesHtml +
      '<div class="agent-chips">' +
        chip('builder.json', 'accent') +
        (v ? chip('validation.json', 'green') : '') +
        (task.specialists?.slice(0,3).map(s => chip(s.replace('agent.',''), 'blue')).join('') ?? '') +
      '</div>' +
    '</div>';
  }).join('');
}

// ── Approvals ─────────────────────────────────────────────────────────────────
function renderApprovals() {
  const approvals = S.approvals ?? [];
  if (!approvals.length) {
    document.getElementById('approvals-list').innerHTML = empty('✓','No approvals yet','Blocked actions appear here for review');
    return;
  }
  const pending = approvals.filter(a => !a.status || a.status === 'pending');
  const resolved = approvals.filter(a => a.status && a.status !== 'pending');
  document.getElementById('approvals-list').innerHTML =
    (pending.length ? '<div style="font-family:var(--m);font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:.1em;color:var(--text-3);margin-bottom:8px">Pending (' + pending.length + ')</div>' +
      pending.map(a => approvalCard(a, true)).join('') : '') +
    (resolved.length ? '<div style="font-family:var(--m);font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:.1em;color:var(--text-3);margin:16px 0 8px">Resolved</div>' +
      resolved.slice(0, 20).map(a => approvalCard(a, false)).join('') : '');
}

function approvalCard(a, canAct) {
  const s = a.status ?? 'pending';
  return '<div class="approval ' + s + '">' +
    '<div style="display:flex;justify-content:space-between;gap:8px;margin-bottom:6px">' +
      '<div style="font-size:13px;font-weight:700">' + esc(a.title ?? a.type ?? 'Approval required') + '</div>' +
      pill(s === 'approved' ? 'pass' : s === 'rejected' ? 'fail' : 'running', s.toUpperCase()) +
    '</div>' +
    '<div style="font-size:12px;color:var(--text-2);margin-bottom:6px">' + esc(a.detail ?? a.reason ?? '') + '</div>' +
    '<div style="font-family:var(--m);font-size:10px;color:var(--text-3);margin-bottom:' + (canAct ? '10px' : '0') + '">' + esc(a.runId?.slice(-14) ?? '—') + ' · ' + esc(a.ts?.replace('T',' ').slice(0,16) ?? '') + '</div>' +
    (canAct ? '<div style="display:flex;gap:8px">' +
      '<button onclick="doApprove(\'' + esc(a.id) + '\')" style="padding:6px 14px;border-radius:6px;border:none;background:var(--success);color:#fff;font-size:12px;font-weight:700;cursor:pointer">Approve</button>' +
      '<button onclick="doReject(\'' + esc(a.id) + '\')" style="padding:6px 14px;border-radius:6px;border:1px solid var(--error-border);background:var(--error-bg);color:var(--error);font-size:12px;font-weight:700;cursor:pointer">Reject</button>' +
    '</div>' : '') +
  '</div>';
}

async function doApprove(id) { await fetch('/api/approve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})}); }
async function doReject(id)  { await fetch('/api/reject', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})}); }

// ── Alerts ────────────────────────────────────────────────────────────────────
function renderAlerts() {
  const alerts = S.alerts ?? [];
  document.getElementById('alerts-list').innerHTML = alerts.length
    ? alerts.map(a => '<div class="alert-row ' + (a.level ?? 'info') + '">' +
        '<div style="font-size:18px">' + ({warn:'⚠️',critical:'🔴',info:'ℹ️'}[a.level] ?? 'ℹ️') + '</div>' +
        '<div><div style="font-weight:700;font-size:12.5px;margin-bottom:2px">' + esc(a.title) + '</div>' +
        '<div style="font-size:12px;color:var(--text-2)">' + esc(a.detail) + '</div></div></div>'
      ).join('')
    : empty('△','All clear','No thresholds breached');
}

// ── Runs ──────────────────────────────────────────────────────────────────────
function renderRuns() {
  const runs = S.runs ?? [];
  set('runs-cnt', runs.length + ' runs');
  document.getElementById('runs-body').innerHTML = runs.map(r => {
    const tasks = r.tasks ?? [];
    const passed = tasks.filter(t => t.status === 'PASS').length;
    const tl = r.activityTimeline ?? [];
    const totalTc = tl.reduce((n, m) => n + m.toolCalls, 0);
    const proj = (r.projectRoot ?? '').split('/').filter(Boolean).pop() ?? '—';
    const created = r.manifest?.created_at ? r.manifest.created_at.slice(0,16).replace('T',' ') : '—';
    const cost = (r.metrics?.cumulative_cost_usd ?? 0).toFixed(4);

    return '<tr class="row" onclick="openRunPanel(\'' + esc(r.runId) + '\')">' +
      '<td>' + pill(r.derivedStatus) + '</td>' +
      '<td style="max-width:0"><div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600">' + esc(r.manifest?.goal ?? '—') + '</div>' +
        '<div style="font-family:var(--m);font-size:10px;color:var(--text-3);margin-top:2px">' + created + '</div></td>' +
      '<td><span style="font-family:var(--m);font-size:10.5px;color:var(--info)">' + esc(proj) + '</span></td>' +
      '<td>' + sparkSvg(tl, 100, 16) + (totalTc ? '<div style="font-family:var(--m);font-size:9.5px;color:var(--text-3)">' + totalTc + ' calls</div>' : '') + '</td>' +
      '<td><span style="color:var(--success);font-weight:700">' + passed + '</span><span style="color:var(--text-3)">/' + tasks.length + '</span></td>' +
      '<td style="font-family:var(--m);font-size:11px;color:var(--text-3)">$' + cost + '</td>' +
    '</tr>';
  }).join('') || '<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--text-3)">No runs yet</td></tr>';
}

// ── Run detail panel ───────────────────────────────────────────────────────────
function openRunPanel(runId) {
  const r = (S.runs ?? []).find(x => x.runId === runId);
  if (!r) return;
  const tl = r.activityTimeline ?? [];
  const tasks = r.tasks ?? [];
  const passed = tasks.filter(t => t.status === 'PASS').length;
  const failed = tasks.filter(t => t.status === 'FAIL').length;
  const totalTc = tl.reduce((n, m) => n + m.toolCalls, 0);

  document.getElementById('dp-eyebrow').textContent = '◆ ' + (r.host ?? r.manifest?.framework ?? 'run') + ' · ' + r.derivedStatus;
  document.getElementById('dp-title').textContent = r.manifest?.goal ?? runId;
  document.getElementById('dp-sub').textContent = runId.slice(0, 50);

  const svgW = 460, svgH = 48;
  const maxTc = Math.max(1, ...tl.map(m => m.toolCalls));
  const bw = tl.length ? Math.max(3, Math.floor(svgW / tl.length) - 1) : 0;
  const bars = tl.map((m, i) => {
    const bh = Math.max(2, Math.round((m.toolCalls / maxTc) * svgH));
    const col = m.stagesDone?.length ? '#16A34A' : m.guardrails ? '#DC2626' : '#2563EB';
    return '<rect x="' + (i*(bw+1)) + '" y="' + (svgH-bh) + '" width="' + bw + '" height="' + bh + '" fill="' + col + '" rx="1" opacity=".8"><title>' + esc(m.minute) + ' · ' + m.toolCalls + ' calls</title></rect>';
  }).join('');

  const minuteRows = tl.map(m => {
    const pct = Math.round((m.toolCalls / maxTc) * 100);
    const tags = [
      ...(m.tasksPassed ? ['<span class="pill pass">' + m.tasksPassed + ' pass</span>'] : []),
      ...(m.tasksFailed ? ['<span class="pill fail">' + m.tasksFailed + ' fail</span>'] : []),
      ...(m.stagesDone?.length ? ['<span class="pill queued">stage: ' + m.stagesDone[0] + '</span>'] : []),
      ...(m.guardrails ? ['<span class="pill fail">guardrail</span>'] : []),
    ].join('');
    return '<div class="dp-item">' +
      '<span style="font-family:var(--m);font-size:10px;color:var(--text-3);width:48px;flex-shrink:0">' + m.minute.slice(11,16) + '</span>' +
      '<div style="flex:1;background:var(--border);border-radius:2px;height:5px;overflow:hidden;margin:4px 0">' +
        '<div style="width:' + pct + '%;height:100%;background:var(--info);border-radius:2px"></div>' +
      '</div>' +
      '<span style="font-family:var(--m);font-size:10px;color:var(--text-3);width:32px;text-align:right;flex-shrink:0">' + m.toolCalls + '</span>' +
      (tags ? '<div style="display:flex;gap:3px;flex-wrap:wrap;margin-left:6px">' + tags + '</div>' : '') +
    '</div>';
  }).join('');

  const qualRows = tl.flatMap(m => m.quality ?? []).map(q => {
    const pct = q.total > 0 ? Math.round((q.pass / q.total) * 100) : 0;
    return '<div class="dp-item">' +
      '<span style="flex:1;font-weight:600">' + esc(q.task ?? '—') + '</span>' +
      pill(pct === 100 ? 'pass' : pct >= 80 ? 'running' : 'fail', pct + '%') +
    '</div>';
  }).join('');

  const stageRows = tl.flatMap(m => (m.stagesDone ?? []).map(s => ({s, min: m.minute}))).map(x =>
    '<div class="dp-item"><span style="flex:1">' + esc(STAGE_NAMES[x.s] ?? x.s) + '</span>' +
    '<span style="font-family:var(--m);font-size:10px;color:var(--text-3)">' + x.min.slice(11,16) + '</span></div>'
  ).join('');

  document.getElementById('dp-body').innerHTML =
    '<div><div class="dp-section">Run Overview</div>' +
    '<div class="dp-kpis">' +
      [['Tool Calls', totalTc, 'var(--info)'],['Minutes', tl.length, 'var(--accent)'],['Passed', passed, 'var(--success)'],['Failed', failed, failed > 0 ? 'var(--error)' : 'var(--text-3)']].map(([l,v,c]) =>
        '<div class="dp-kpi"><div class="dp-kpi-v" style="color:' + c + '">' + v + '</div><div class="dp-kpi-l">' + l + '</div></div>'
      ).join('') +
    '</div></div>' +
    (tl.length ? '<div><div class="dp-section">Activity Timeline</div><svg style="width:100%;height:' + svgH + 'px;display:block" viewBox="0 0 ' + svgW + ' ' + svgH + '">' + bars + '</svg><div style="font-family:var(--m);font-size:9px;color:var(--text-3);margin-top:4px">Blue = tool calls · Green = stage · Red = guardrail</div></div>' : '') +
    (minuteRows ? '<div><div class="dp-section">Minute Breakdown</div>' + minuteRows + '</div>' : '') +
    (qualRows ? '<div><div class="dp-section">Quality Scores</div>' + qualRows + '</div>' : '') +
    (stageRows ? '<div><div class="dp-section">Stage Completions</div>' + stageRows + '</div>' : '');

  document.getElementById('panel-overlay').classList.add('open');
  document.getElementById('detail-panel').classList.add('open');
}

function closePanel() {
  document.getElementById('panel-overlay').classList.remove('open');
  document.getElementById('detail-panel').classList.remove('open');
}

// ── Traceability ──────────────────────────────────────────────────────────────
function renderTraceability() {
  const traceMap = S.traceMap ?? [];
  document.getElementById('trace-list').innerHTML = traceMap.length
    ? traceMap.map(t => '<div class="card" style="margin-bottom:14px">' +
        '<div class="card-hdr">' + esc(t.runId.slice(-20)) + '</div>' +
        '<div class="card-body">' +
          '<div style="font-size:14px;font-weight:700;margin-bottom:10px">' + esc(t.goal) + '</div>' +
          '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">' +
            [['Requirements',t.stages?.requirements],['Architecture',t.stages?.architecture],['Code',t.stages?.code],['Testing',t.stages?.testing]]
              .map(([l,done]) => '<span style="display:flex;align-items:center;gap:4px;padding:4px 8px;border-radius:6px;font-size:11px;font-weight:600;' +
                (done ? 'background:var(--success-bg);color:var(--success);border:1px solid var(--success-border)' : 'background:var(--elevated);color:var(--text-3);border:1px solid var(--border)') + '">' +
                (done ? '✓' : '○') + ' ' + l + '</span>').join('') +
          '</div>' +
          (t.requirements?.length ? '<div style="font-family:var(--m);font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:.1em;color:var(--text-3);margin-bottom:6px">Requirements (' + t.requirements.length + ')</div>' +
            t.requirements.slice(0,6).map(r => '<div style="padding:5px 10px;background:var(--elevated);border-radius:5px;font-size:12px;margin-bottom:3px;border-left:2px solid var(--info)">' +
              '<div style="font-family:var(--m);font-size:9px;color:var(--text-3)">' + esc(r.id ?? r.req_id ?? '') + '</div>' +
              esc((r.description ?? r.text ?? r.title ?? '').slice(0,100)) + '</div>').join('') : '') +
        '</div></div>'
      ).join('')
    : empty('◉','No traceability data','Complete runs with stages 02 (requirements) and 06 (architecture) to see maps here');
}

// ── Team ──────────────────────────────────────────────────────────────────────
function renderTeam() {
  const fw = S.frameworks ?? {};
  const entries = Object.entries(fw);
  document.getElementById('team-body').innerHTML = entries.length
    ? '<table class="rtable" style="width:100%"><thead><tr><th>Framework</th><th>Runs</th><th>Pass</th><th>Fail</th><th>Cost</th><th>Rate</th></tr></thead><tbody>' +
      entries.map(([name, d]) => {
        const total = d.pass + d.fail;
        const rate = total ? Math.round(d.pass / total * 100) : 0;
        return '<tr><td style="font-weight:700">' + esc(name) + '</td>' +
          '<td>' + d.runs + '</td>' +
          '<td style="color:var(--success);font-weight:600">' + d.pass + '</td>' +
          '<td style="color:' + (d.fail ? 'var(--error)' : 'var(--text-3)') + '">' + d.fail + '</td>' +
          '<td style="font-family:var(--m);font-size:11px">$' + d.cost.toFixed(4) + '</td>' +
          '<td>' + pill(rate >= 80 ? 'pass' : rate >= 50 ? 'running' : 'fail', rate + '%') + '</td></tr>';
      }).join('') + '</tbody></table>'
    : empty('≡','No team data','Framework usage appears here once runs complete');
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function buildProjects() {
  const projs = {};
  for (const run of S.runs ?? []) {
    const key = run.projectRoot ?? 'unknown';
    const name = key.split('/').filter(Boolean).pop() || key;
    const b = projs[key] ??= {name, path: key, runs: 0, active: 0, cost: 0, pass: 0, fail: 0, last: ''};
    b.runs++; b.cost += Number(run.metrics?.cumulative_cost_usd ?? 0) || 0;
    b.last = b.last > run.runId ? b.last : run.runId;
    if ((S.activeRuns ?? []).includes(run.runId)) b.active++;
    for (const t of run.tasks ?? []) { if (t.status === 'PASS') b.pass++; if (t.status === 'FAIL') b.fail++; }
  }
  return projs;
}

function set(id, val) { const e = document.getElementById(id); if (e) e.textContent = val; }
function esc(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function pill(status, label) {
  const l = label ?? (status ?? '—').toUpperCase();
  const cls = {active:'running',done:'pass',pass:'pass',fail:'fail',running:'running',
    stalled:'running',warn:'running',idle:'idle',ended:'ended',queued:'queued',ready:'queued'}[status?.toLowerCase()] ?? 'idle';
  return '<span class="pill ' + cls + '"><span class="pill-dot"></span>' + esc(l) + '</span>';
}

function chip(label, style) {
  return '<span class="chip ' + (style ?? '') + '">' + esc(label) + '</span>';
}

function pbar(label, val, max, prefix, dp) {
  const pct = max > 0 ? Math.min(100, (val / max) * 100) : 0;
  const cls = pct < 60 ? 'var(--success)' : pct < 85 ? 'var(--accent)' : 'var(--error)';
  const fmt = v => (prefix ?? '') + (dp ? Number(v).toFixed(dp) : v);
  return '<div style="margin-bottom:10px">' +
    '<div style="display:flex;justify-content:space-between;font-size:11.5px;color:var(--text-2);margin-bottom:4px">' +
      '<span>' + label + '</span><span style="font-family:var(--m)">' + fmt(val) + ' / ' + fmt(max) + '</span>' +
    '</div>' +
    '<div style="height:5px;background:var(--border);border-radius:3px;overflow:hidden">' +
      '<div style="width:' + pct.toFixed(1) + '%;height:100%;background:' + cls + ';border-radius:3px;transition:width .4s"></div>' +
    '</div></div>';
}

function empty(ic, t, s) {
  return '<div class="empty"><div class="empty-ic">' + ic + '</div><div class="empty-t">' + t + '</div><div class="empty-s">' + s + '</div></div>';
}

function sparkSvg(tl, W, H) {
  if (!tl?.length) return '';
  const maxTc = Math.max(1, ...tl.map(m => m.toolCalls));
  const bw = Math.max(1, Math.floor(W / tl.length) - 1);
  const bars = tl.map((m, i) => {
    const bh = Math.max(1, Math.round((m.toolCalls / maxTc) * H));
    const col = m.stagesDone?.length ? '#16A34A' : m.guardrails ? '#DC2626' : '#2563EB';
    return '<rect x="' + (i*(bw+1)) + '" y="' + (H-bh) + '" width="' + bw + '" height="' + bh + '" fill="' + col + '" rx="1" opacity=".75"/>';
  }).join('');
  return '<svg width="' + W + '" height="' + H + '" class="spark">' + bars + '</svg>';
}

// ── Boot ──────────────────────────────────────────────────────────────────────
connect();
</script>
</body>
</html>`;
}
