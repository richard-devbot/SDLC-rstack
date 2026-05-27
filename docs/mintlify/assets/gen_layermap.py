# RStack SDLC — 9-Layer Map SVG  (complete — all layers including Observability, Notifications, CLI)

W = 1320
PAD = 50
GAP = 18
lx = PAD
lw = W - 2*PAD   # 1220

lines = []

def esc(s): return s.replace('&','&amp;').replace('<','&lt;').replace('>','&gt;')

def layer_rect(x, y, w, h, lbl, label_size=12):
    lines.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" '
                 f'fill="#ffffff" stroke="#374151" stroke-width="1.5" rx="12"/>')
    lw2 = len(lbl) * label_size * 0.62 + 24
    nx = x + w/2 - lw2/2
    lines.append(f'<rect x="{nx:.1f}" y="{y-10}" width="{lw2:.1f}" height="22" fill="#f9fafb"/>')
    lines.append(f'<text x="{x + w/2:.1f}" y="{y+8}" '
                 f'font-size="{label_size}" font-family="Inter,Helvetica Neue,Arial,sans-serif" '
                 f'fill="#111827" text-anchor="middle" font-weight="700">{esc(lbl)}</text>')

def sub_box(x, y, w, h, lbl, label_size=10):
    lines.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" '
                 f'fill="transparent" stroke="#9ca3af" stroke-width="1" '
                 f'stroke-dasharray="4,3" rx="6"/>')
    if lbl:
        lines.append(f'<text x="{x + w/2:.1f}" y="{y+14}" '
                     f'font-size="{label_size}" font-family="Inter,Helvetica Neue,Arial,sans-serif" '
                     f'fill="#374151" text-anchor="middle" font-weight="600">{esc(lbl)}</text>')

def chip(x, y, w, h, text_val, bg, border, tc, size=10, bold=False):
    fw = 'bold' if bold else 'normal'
    lines.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" '
                 f'fill="{bg}" stroke="{border}" stroke-width="1" rx="5"/>')
    lines.append(f'<text x="{x+w/2:.1f}" y="{y+h/2+4:.1f}" '
                 f'font-size="{size}" font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,monospace" '
                 f'fill="{tc}" text-anchor="middle" font-weight="{fw}">{esc(text_val)}</text>')

def lbl(x, y, s, size=11, color='#1f2937', anchor='middle', bold=False, italic=False):
    fw = 'bold' if bold else 'normal'
    fs = 'italic' if italic else 'normal'
    lines.append(f'<text x="{x}" y="{y}" font-size="{size}" '
                 f'font-family="Inter,Helvetica Neue,Arial,sans-serif" '
                 f'fill="{color}" text-anchor="{anchor}" font-weight="{fw}" font-style="{fs}">'
                 f'{esc(s)}</text>')

def arr(x1, y1, x2, y2, color='#6b7280', sw=1.5):
    cid = color.replace('#','')
    lines.append(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" '
                 f'stroke="{color}" stroke-width="{sw}" '
                 f'marker-end="url(#a_{cid})"/>')

# ── SVG open + defs ──────────────────────────────────────────────────────────
H = 1720
lines.append(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" '
             f'width="{W}" height="{H}" style="background:#f9fafb">')
lines.append('<defs>')
for c in ['374151','7c3aed','ca8a04','15803d','1e40af','dc2626','6d28d9','0284c7','6b7280','0891b2','059669','d97706']:
    lines.append(f'<marker id="a_{c}" markerWidth="7" markerHeight="5" refX="7" refY="2.5" orient="auto">'
                 f'<polygon points="0 0,7 2.5,0 5" fill="#{c}"/></marker>')
lines.append('</defs>')

# ── TITLE ────────────────────────────────────────────────────────────────────
lbl(W//2, 35, 'RStack SDLC  —  Full Ecosystem Layer Map', size=20, color='#111827', bold=True)
lbl(W//2, 56, 'Governed AI software-delivery harness  ·  v1.0.1 / Pi Extension v0.3.0', size=11, color='#6b7280', italic=True)

# ═══════════════════════════════════════════════════════════════════════════════
# LAYER 1 — Developer / Product Owner
# ═══════════════════════════════════════════════════════════════════════════════
y1 = 72
h1 = 68
layer_rect(lx, y1, lw, h1, 'Developer  /  Product Owner', label_size=12)
sw3 = (lw - 4*20) // 3
for i, (t, d) in enumerate([
    ('Requirements Brief', 'goals · constraints · context'),
    ('Approval Decisions', 'gate reviews · interactive mode'),
    ('Goal Input', 'sdlc_start · sdlc_clarify tools'),
]):
    bx = lx + 20 + i*(sw3+20)
    sub_box(bx, y1+18, sw3, 42, '')
    lbl(bx+sw3//2, y1+33, t, size=11, color='#111827', bold=True)
    lbl(bx+sw3//2, y1+49, d, size=9, color='#6b7280')
arr(W//2, y1+h1, W//2, y1+h1+GAP-2, color='#374151')

# ═══════════════════════════════════════════════════════════════════════════════
# LAYER 2 — CLI Interface
# ═══════════════════════════════════════════════════════════════════════════════
y2 = y1 + h1 + GAP
h2 = 90
layer_rect(lx, y2, lw, h2, 'CLI Interface  ·  bin/rstack-agents.js  ·  src/utils/logger.js', label_size=12)
lbl(W//2, y2+26, 'Command-line entry point for agent management  ·  chalk-based structured logger  [rstack] prefix',
    size=10, color='#6b7280', italic=True)

# CLI sub-boxes
cbw = (lw - 3*16) // 2
# rstack-agents
sub_box(lx+16, y2+34, cbw, 48, 'rstack-agents CLI  (commander)')
cli_cmds = ['list agents / skills / plugins', 'add plugin <name>', 'validate']
for ci, cmd in enumerate(cli_cmds):
    chip(lx+20+ci*(cbw//3-4), y2+50, cbw//3-8, 20,
         cmd, '#f0f9ff', '#0891b2', '#0369a1', size=9)

# logger
lbx = lx + 16 + cbw + 16
sub_box(lbx, y2+34, cbw, 48, 'Logger  ·  src/utils/logger.js')
log_methods = ['log.info()', 'log.success()', 'log.warn()', 'log.error()']
for ci, m in enumerate(log_methods):
    chip(lbx+8+ci*(cbw//4-4), y2+50, cbw//4-8, 20,
         m, '#f0fdf4', '#059669', '#065f46', size=9)

arr(W//2, y2+h2, W//2, y2+h2+GAP-2, color='#374151')

# ═══════════════════════════════════════════════════════════════════════════════
# LAYER 3 — Pi Extension
# ═══════════════════════════════════════════════════════════════════════════════
y3 = y2 + h2 + GAP
h3 = 250
layer_rect(lx, y3, lw, h3, 'Pi Extension Layer  ·  extensions/rstack-sdlc.ts  ·  v0.3.0', label_size=12)
lbl(W//2, y3+26, '@earendil-works/pi-coding-agent  ·  Binds RStack to the Pi runtime via 6 lifecycle hooks and 13 registered tools',
    size=10, color='#6b7280', italic=True)

hbw = (lw - 3*20) // 2

# Lifecycle Hooks sub-box
sub_box(lx+20, y3+36, hbw, 198, 'Lifecycle Hooks')
hooks = ['resources_discover','session_start','before_agent_start','tool_call','tool_result','session_shutdown']
hcols = [hooks[:3], hooks[3:]]
for ci, col in enumerate(hcols):
    for ri, h in enumerate(col):
        chip(lx+28+ci*(hbw//2-4), y3+56+ri*58,
             hbw//2-12, 46, h, '#ede9fe', '#7c3aed', '#5b21b6', size=9, bold=False)

# SDLC Tools sub-box — 13 tools
tbx = lx + 20 + hbw + 20
sub_box(tbx, y3+36, hbw, 198, '13 SDLC Tools')
tools13 = ['sdlc_orchestrate','sdlc_start','sdlc_clarify','sdlc_plan',
           'sdlc_build_next','sdlc_validate','sdlc_agents',
           'sdlc_delegate','sdlc_approve','sdlc_spec',
           'sdlc_status','sdlc_memory','sdlc_dashboard']
tcols = [tools13[:7], tools13[7:]]   # 7 + 6
for ci, col in enumerate(tcols):
    for ri, t in enumerate(col):
        chip(tbx+8+ci*(hbw//2-4), y3+56+ri*26,
             hbw//2-12, 22, t, '#f5f3ff', '#7c3aed', '#6d28d9', size=9)

arr(W//2, y3+h3, W//2, y3+h3+GAP-2, color='#7c3aed')

# ═══════════════════════════════════════════════════════════════════════════════
# LAYER 4 — Harness Core  (7 modules)
# ═══════════════════════════════════════════════════════════════════════════════
y4 = y3 + h3 + GAP
h4 = 130
layer_rect(lx, y4, lw, h4, 'Harness Core  ·  src/harness/  (7 modules)', label_size=12)
lbl(W//2, y4+26, 'Governance + enforcement layer — contracts, stages, guardrails, evidence, run state, memory, notifications',
    size=10, color='#6b7280', italic=True)

mods = [
    ('contracts.js', 'Builder & Validator\ncontract validation'),
    ('stages.js', '15 canonical stages\nlocked order'),
    ('guardrails.js', 'maxAttempts:2\nmaxToolCalls:40'),
    ('evidence.js', 'Append-only\nevents.jsonl ledger'),
    ('run-state.js', 'prepareRunState\ncheckpoint · rollback'),
    ('memory.js', 'recall · append\nsanitise episodes'),
    ('notifications.js', 'Slack/Discord/Teams\nwebhook dispatch'),
]
mw = (lw - 8*12) // 7
for i, (name, desc) in enumerate(mods):
    mx = lx + 12 + i*(mw+12)
    my = y4 + 36
    mh = 78
    lines.append(f'<rect x="{mx}" y="{my}" width="{mw}" height="{mh}" '
                 f'fill="#fef9c3" stroke="#ca8a04" stroke-width="1" rx="6"/>')
    lbl(mx+mw//2, my+17, name, size=10, color='#78350f', bold=True)
    for j, line in enumerate(desc.split('\n')):
        lbl(mx+mw//2, my+33+j*16, line, size=9, color='#92400e')

arr(W//2, y4+h4, W//2, y4+h4+GAP-2, color='#ca8a04')

# ═══════════════════════════════════════════════════════════════════════════════
# LAYER 5 — 15-Stage Pipeline
# ═══════════════════════════════════════════════════════════════════════════════
y5 = y4 + h4 + GAP
h5 = 160
layer_rect(lx, y5, lw, h5, '15-Stage Canonical Pipeline  ·  assertCanonicalStages() enforced', label_size=12)
lbl(W//2, y5+26, 'Stage order is immutable — locked by test suite  ·  each stage produces a typed JSON artifact',
    size=10, color='#6b7280', italic=True)

stages_grouped = [
    ('Discovery', ['00·Environ', '01·Transcript', '02·Require', '03·Docs'],
     '#bbf7d0', '#15803d', '#14532d'),
    ('Design', ['04·Planning', '05·Jira', '06·Arch'],
     '#bbf7d0', '#15803d', '#14532d'),
    ('Build', ['07·Code', '08·Testing', '09·Deploy'],
     '#86efac', '#16a34a', '#14532d'),
    ('Review', ['10·Summary', '11·Feedback', '12·Security', '13·Comply', '14·Cost'],
     '#4ade80', '#15803d', '#14532d'),
]
total_stages = sum(len(g[1]) for g in stages_grouped)
avail5 = lw - 5*14
gx = lx + 14
for gname, gstages, gbg, gborder, gtc in stages_grouped:
    gw = int(avail5 * len(gstages) / total_stages)
    sub_box(gx, y5+36, gw, 110, gname)
    sw4 = (gw - (len(gstages)+1)*6) // len(gstages)
    for si, s in enumerate(gstages):
        sx = gx + 6 + si*(sw4+6)
        lines.append(f'<rect x="{sx}" y="{y5+52}" width="{sw4}" height="80" '
                     f'fill="{gbg}" stroke="{gborder}" stroke-width="1" rx="5"/>')
        num, name = s.split('·')
        lbl(sx+sw4//2, y5+72, num, size=9, color=gtc, bold=True)
        lbl(sx+sw4//2, y5+86, name, size=8, color='#166534')
    gx += gw + 14

arr(W//2, y5+h5, W//2, y5+h5+GAP-2, color='#15803d')

# ═══════════════════════════════════════════════════════════════════════════════
# LAYER 6 — Governance, Security & Memory
# ═══════════════════════════════════════════════════════════════════════════════
y6 = y5 + h5 + GAP
h6 = 210
layer_rect(lx, y6, lw, h6, 'Governance, Security & Episodic Memory', label_size=12)
lbl(W//2, y6+26, 'Cross-cutting concerns active throughout every pipeline stage',
    size=10, color='#6b7280', italic=True)

zones6 = [
    ('Governance', '#dbeafe', '#1e40af', '#1e3a8a',
     ['Approval Gates (interactive mode)',
      'Express Mode — bypasses all gates',
      'Protected Actions Registry (20+)',
      'Evidence required for stage PASS',
      '4-eye review for destructive ops']),
    ('Security Layer', '#fee2e2', '#dc2626', '#991b1b',
     ['Secret Scanner — 10 regex patterns',
      'Prompt Injection Detector (15)',
      'Protected Paths Guard',
      'sanitiseSecrets() on all episodes',
      'Validator-only episode writes']),
    ('Episodic Memory', '#ede9fe', '#6d28d9', '#5b21b6',
     ['Episode Store — memory/episodes.jsonl',
      'Lexical Retrieval via recallEpisodes()',
      'Validator-gated writes — appendEpisode()',
      '4096-token context window cap',
      'Injection + secret scan before write']),
]
zw = (lw - 4*16) // 3
for i, (ztitle, zbg, zborder, ztc, zitems) in enumerate(zones6):
    zx = lx + 16 + i*(zw+16)
    zy = y6 + 36
    zh = 162
    lines.append(f'<rect x="{zx}" y="{zy}" width="{zw}" height="{zh}" '
                 f'fill="{zbg}" stroke="{zborder}" stroke-width="1.5" rx="8"/>')
    lbl(zx+zw//2, zy+18, ztitle, size=12, color=ztc, bold=True)
    for j, item in enumerate(zitems):
        lbl(zx+12, zy+36+j*24, '·  '+item, size=10, color=ztc, anchor='start')

arr(W//2, y6+h6, W//2, y6+h6+GAP-2, color='#6b7280')

# ═══════════════════════════════════════════════════════════════════════════════
# LAYER 7 — Observability
# ═══════════════════════════════════════════════════════════════════════════════
y7 = y6 + h6 + GAP
h7 = 155
layer_rect(lx, y7, lw, h7, 'Observability Layer  ·  src/harness/dashboard.js  +  reporter.js', label_size=12)
lbl(W//2, y7+26, 'Live HTTP server + run report generation  ·  19 tracked event types  ·  HTML dashboard + trace views',
    size=10, color='#6b7280', italic=True)

obw = (lw - 3*16) // 2

# Dashboard Server
sub_box(lx+16, y7+36, obw, 108, 'Dashboard Server  ·  dashboard.js')
dash_items = [
    'startDashboardServer(projectRoot, runId, port=3005)',
    'GET /api/metrics  →  metrics.json + tasks.json + manifest.json',
    '"RStack SDLC — Observability Hub"  (full HTML)',
    'Real-time stage progress  ·  task ledger  ·  cost tracking',
]
for j, item in enumerate(dash_items):
    lbl(lx+24, y7+54+j*20, '·  '+item, size=9.5, color='#0369a1', anchor='start')

# Run Reporter
rbx = lx + 16 + obw + 16
sub_box(rbx, y7+36, obw, 108, 'Run Reporter  ·  reporter.js')
rep_items = [
    'buildRunReport(runDir)  ·  generateRunReport(projectRoot, runId)',
    'renderDashboardHtml(report)  ·  renderTraceHtml(trace, runId)',
    'Reads: events.jsonl · evidence.jsonl · tasks.json · approvals.json',
    '19 event types: run_started, task_started, tool_call, approval_gate …',
]
for j, item in enumerate(rep_items):
    lbl(rbx+8, y7+54+j*20, '·  '+item, size=9.5, color='#0369a1', anchor='start')

arr(W//2, y7+h7, W//2, y7+h7+GAP-2, color='#0891b2')

# ═══════════════════════════════════════════════════════════════════════════════
# LAYER 8 — Notifications & Handoff
# ═══════════════════════════════════════════════════════════════════════════════
y8 = y7 + h7 + GAP
h8 = 155
layer_rect(lx, y8, lw, h8, 'Notifications & Agent Handoff  ·  src/harness/notifications.js  +  handoff.md', label_size=12)
lbl(W//2, y8+26, 'Webhook alerts on key lifecycle events  ·  structured agent-to-agent context pass-through per stage',
    size=10, color='#6b7280', italic=True)

nbw = (lw - 3*16) // 2

# Notifications
sub_box(lx+16, y8+36, nbw, 108, 'Notifications  ·  Slack / Discord / Teams')
notif_items = [
    'sendSlackNotification(webhookUrl, payload)',
    'formatSlackStageMessage(runId, stageId, status, details)',
    'formatSlackTaskReportMessage(runId, taskId, trace)',
    'Triggered: run start · approval gate · validation complete',
    'Env: RSTACK_SLACK_WEBHOOK  ·  auto-converts to Discord/Teams',
]
for j, item in enumerate(notif_items):
    lbl(lx+24, y8+54+j*19, '·  '+item, size=9.5, color='#059669', anchor='start')

# Handoff
hbx = lx + 16 + nbw + 16
sub_box(hbx, y8+36, nbw, 108, 'Agent Handoff  ·  per-stage context relay')
handoff_items = [
    'handoff.md  artifact written at stage close',
    'memory_summary.next_agent_hints  (builder contract)',
    'stage_summaries[]  — accumulated across run',
    'Run manifest status "DONE" → triggers release handoff',
    'Next agent inherits context without re-reading full history',
]
for j, item in enumerate(handoff_items):
    lbl(hbx+8, y8+54+j*19, '·  '+item, size=9.5, color='#059669', anchor='start')

arr(W//2, y8+h8, W//2, y8+h8+GAP-2, color='#6b7280')

# ═══════════════════════════════════════════════════════════════════════════════
# LAYER 9 — Asset Registry & Run State
# ═══════════════════════════════════════════════════════════════════════════════
y9 = y8 + h8 + GAP
h9 = 180
layer_rect(lx, y9, lw, h9, 'Asset Registry  &  Run State', label_size=12)
lbl(W//2, y9+26, 'Agents, skills and plugins invoked per stage  ·  All outputs persisted in .rstack/runs/<run_id>/',
    size=10, color='#6b7280', italic=True)

abw = int(lw*0.38)
sub_box(lx+16, y9+36, abw, 130, 'Asset Registry  ·  agents/  prompts/')
asset_items = [('196','Agents'),('156','Skills'),('72','Plugins'),('36','Prompts')]
cw2 = (abw - 5*8) // 4
for i, (num, al) in enumerate(asset_items):
    cx2 = lx+16+8+i*(cw2+8)
    lines.append(f'<rect x="{cx2}" y="{y9+56}" width="{cw2}" height="50" '
                 f'fill="#e0f2fe" stroke="#0284c7" stroke-width="1" rx="6"/>')
    lbl(cx2+cw2//2, y9+78, num, size=18, color='#0369a1', bold=True)
    lbl(cx2+cw2//2, y9+96, al, size=9, color='#0284c7')
lbl(lx+16+abw//2, y9+124, 'Orchestrator → Builder → Validator  ·  agent.00-environment … agent.14-cost-estimation',
    size=9, color='#0369a1')
lbl(lx+16+abw//2, y9+142, 'Operating standard: OPERATING-STANDARD.md  ·  Core agents: builder.md  validator.md',
    size=9, color='#0284c7')

rbw = lw - abw - 3*16
rbx = lx + 16 + abw + 16
sub_box(rbx, y9+36, rbw, 130, 'Run State  ·  .rstack/runs/<run_id>/')
rs_items = [
    'artifacts/stages/<stage_id>/<artifact.json>',
    'evidence/events.jsonl  ·  memory/episodes.jsonl',
    'stageArtifactRelativePath(runId, stageId)',
    'createStageCheckpoint(runDir, stageId)  ·  rollbackStage(runDir, stageId)',
    'updateRunMetrics(runDir, metricsUpdate)  ·  resumable from any stage',
    'maxTaskAttempts:2  ·  maxToolCalls:40  ·  maxMessages:25',
]
for j, item in enumerate(rs_items):
    lbl(rbx+12, y9+54+j*19, '·  '+item, size=9.5, color='#15803d', anchor='start')

# ── FOOTER ───────────────────────────────────────────────────────────────────
fy = y9 + h9 + 32
lbl(W//2, fy, 'rstack-agents  ·  npm install rstack-agents  ·  github.com/richard-devbot/SDLC-rstack',
    size=10, color='#9ca3af', italic=True)

lines.append('</svg>')

out = '\n'.join(lines)
dest = '/sessions/zealous-magical-feynman/mnt/SDLC-rstack/docs/mintlify/assets/rstack-ecosystem-architecture.svg'
with open(dest, 'w') as f:
    f.write(out)
print(f'Done — {len(out):,} bytes  (H={H})')
# verify footer fits within canvas
last_y = fy
print(f'Footer y={last_y}, canvas H={H}, margin={H-last_y}px')
