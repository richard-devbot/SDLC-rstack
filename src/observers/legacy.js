import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// owner: RStack developed by Richardson Gunde

/**
 * Starts a lightweight local HTTP server to host the live RStack dashboard.
 */
export function startDashboardServer(projectRoot, runId, port = 3005) {
  const runDir = join(projectRoot, '.rstack', 'runs', runId);

  const server = createServer(async (req, res) => {
    if (req.url === '/api/memory-health') {
      try {
        const { runMemoryDiagnostics } = await import('../memory/diagnostics.js');
        const report = await runMemoryDiagnostics(projectRoot, runId);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify(report));
      } catch (_err) {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ episode_count: 0, store_size_kb: 0, signature_failures: [], recall_hit_rate: null }));
      }
      return;
    }

    // API endpoint for metrics
    if (req.url === '/api/metrics') {
      const metricsPath = join(runDir, 'metrics.json');
      const tasksPath = join(runDir, 'tasks.json');
      const manifestPath = join(runDir, 'manifest.json');

      let metrics = {};
      let tasks = [];
      let manifest = {};

      if (existsSync(metricsPath)) {
        try { metrics = JSON.parse(await readFile(metricsPath, 'utf8')); } catch { metrics = {}; }
      }
      if (existsSync(tasksPath)) {
        try { tasks = JSON.parse(await readFile(tasksPath, 'utf8')).tasks; } catch { tasks = []; }
      }
      if (existsSync(manifestPath)) {
        try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')); } catch { manifest = {}; }
      }

      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ metrics, tasks, manifest }));
      return;
    }

    // Serve HTML page
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<!DOCTYPE html>
<html>
<head>
  <title>RStack SDLC — Observability Hub</title>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #0b0f19;
      --panel: rgba(17, 24, 39, 0.7);
      --border: rgba(255, 255, 255, 0.08);
      --text: #f3f4f6;
      --text-muted: #9ca3af;
      --primary: #ea580c;
      --primary-glow: rgba(234, 88, 12, 0.15);
      --success: #22c55e;
      --success-glow: rgba(34, 197, 94, 0.15);
      --fail: #ef4444;
      --fail-glow: rgba(239, 68, 68, 0.15);
      --pending: #8b5cf6;
    }
    
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    
    body {
      font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      background-image: 
        radial-gradient(at 0% 0%, rgba(234, 88, 12, 0.1) 0px, transparent 50%),
        radial-gradient(at 100% 100%, rgba(139, 92, 246, 0.1) 0px, transparent 50%);
      padding: 40px;
    }
    
    header {
      margin-bottom: 40px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    
    h1 {
      font-size: 24px;
      font-weight: 700;
      letter-spacing: -0.02em;
      background: linear-gradient(135deg, #ffffff 0%, #a5b4fc 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    
    .run-badge {
      font-family: monospace;
      background: var(--panel);
      border: 1px solid var(--border);
      padding: 6px 12px;
      border-radius: 99px;
      font-size: 12px;
      color: var(--text-muted);
    }
    
    .grid {
      display: grid;
      grid-template-columns: 2fr 1fr;
      gap: 30px;
    }
    
    @media (max-width: 1024px) {
      .grid {
        grid-template-columns: 1fr;
      }
    }
    
    .card {
      background: var(--panel);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 24px;
      box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.37);
      margin-bottom: 30px;
    }
    
    .card-title {
      font-size: 16px;
      font-weight: 600;
      margin-bottom: 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    
    /* Stage Execution Timeline */
    .timeline {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    
    .timeline-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid var(--border);
      padding: 14px 20px;
      border-radius: 12px;
      transition: all 0.2s ease;
    }
    
    .timeline-item:hover {
      background: rgba(255, 255, 255, 0.04);
      border-color: rgba(255, 255, 255, 0.12);
      transform: translateY(-1px);
    }
    
    .stage-name {
      font-weight: 500;
      font-size: 13.5px;
    }
    
    .stage-artifact {
      font-family: monospace;
      font-size: 11px;
      color: var(--text-muted);
      margin-top: 4px;
    }
    
    .status-pill {
      font-size: 10.5px;
      font-weight: 700;
      padding: 4px 10px;
      border-radius: 6px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    
    .status-ready { background: var(--border); color: var(--text-muted); }
    .status-pending { background: rgba(139, 92, 246, 0.15); color: #c084fc; border: 1px solid rgba(139, 92, 246, 0.3); }
    .status-pass { background: var(--success-glow); color: var(--success); border: 1px solid rgba(34, 197, 94, 0.3); }
    .status-fail { background: var(--fail-glow); color: var(--fail); border: 1px solid rgba(239, 68, 68, 0.3); }
    
    /* Metrics Row */
    .metrics-row {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 20px;
      margin-bottom: 30px;
    }
    
    .metric-card {
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 18px;
      text-align: center;
    }
    
    .metric-val {
      font-size: 24px;
      font-weight: 700;
      color: var(--primary);
      margin-top: 8px;
    }
    
    .metric-lbl {
      font-size: 11.5px;
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
  </style>
  <script>
    async function updateDashboard() {
      try {
        const res = await fetch('/api/metrics');
        const data = await res.json();
        
        document.getElementById('run-id').innerText = 'Run: ' + (data.manifest.run_id || '${runId}');
        
        const metrics = data.metrics || {};
        document.getElementById('m-duration').innerText = ((metrics.cumulative_duration_ms || 0) / 1000).toFixed(1) + 's';
        document.getElementById('m-cost').innerText = '$' + (metrics.cumulative_cost_usd || 0.00).toFixed(4);
        document.getElementById('m-tools').innerText = (metrics.cumulative_tool_calls || 0) + ' / 40';
        
        const tasks = data.tasks || [];
        const container = document.getElementById('timeline-container');
        container.innerHTML = '';
        
        const stagesList = [
          { id: '00-environment', art: 'environment_report.json' },
          { id: '01-transcript', art: 'transcript.json' },
          { id: '02-requirements', art: 'requirements.json' },
          { id: '03-documentation', art: 'documentation.json' },
          { id: '04-planning', art: 'plan.json' },
          { id: '05-jira', art: 'jira_tickets.json' },
          { id: '06-architecture', art: 'system_design.json' },
          { id: '07-code', art: 'code_report.json' },
          { id: '08-testing', art: 'test_report.json' },
          { id: '09-deployment', art: 'deployment_report.json' },
          { id: '10-summary', art: 'summary.json' },
          { id: '11-feedback-loop', art: 'feedback.json' },
          { id: '12-security-threat-model', art: 'threat_model.json' },
          { id: '13-compliance-checker', art: 'compliance_report.json' },
          { id: '14-cost-estimation', art: 'cost_estimate.json' }
        ];
        
        stagesList.forEach(s => {
          const matchTask = tasks.find(t => t.stage_artifacts?.some(a => a.stage_id === s.id) || t.id === s.id);
          const taskStatus = matchTask ? matchTask.status : 'READY';
          
          let statusClass = 'status-ready';
          if (taskStatus === 'IN_PROGRESS') statusClass = 'status-pending';
          if (taskStatus === 'PASS') statusClass = 'status-pass';
          if (taskStatus === 'FAIL') statusClass = 'status-fail';
          
          container.innerHTML += \`
            <div class="timeline-item">
              <div>
                <div class="stage-name">\${s.id}</div>
                <div class="stage-artifact">➔ \${s.art}</div>
              </div>
              <span class="status-pill \${statusClass}">\${taskStatus}</span>
            </div>
          \`;
        });

        try {
          const memRes = await fetch('/api/memory-health');
          const memData = await memRes.json();
          document.getElementById('mem-count').innerText = memData.episode_count ?? '—';
          document.getElementById('mem-size').innerText = (memData.store_size_kb ?? 0) + ' KB';
          document.getElementById('mem-sigfail').innerText = memData.signature_failures?.length ?? 0;
          document.getElementById('mem-hitrate').innerText = memData.recall_hit_rate !== null ? memData.recall_hit_rate + '%' : '—';
        } catch {}
      } catch (err) {
        console.error('Failed to load live metrics', err);
      }
    }
    
    setInterval(updateDashboard, 2000);
    window.onload = updateDashboard;
  </script>
</head>
<body>
  <header>
    <h1>RStack SDLC — Observability Hub</h1>
    <div id="run-id" class="run-badge">Run: Loading...</div>
  </header>
  
  <div class="grid">
    <div>
      <div class="metrics-row">
        <div class="metric-card">
          <div class="metric-lbl">Cumulative Time</div>
          <div id="m-duration" class="metric-val">0.0s</div>
        </div>
        <div class="metric-card">
          <div class="metric-lbl">API Cost Cap</div>
          <div id="m-cost" class="metric-val">$0.0000</div>
        </div>
        <div class="metric-card">
          <div class="metric-lbl">Tool Call Buffer</div>
          <div id="m-tools" class="metric-val">0 / 40</div>
        </div>
      </div>
      
      <div class="card">
        <div class="card-title">Stage Execution Timeline</div>
        <div id="timeline-container" class="timeline">
          <!-- Timelines populated dynamically -->
        </div>
      </div>
    </div>
    
    <div>
      <div class="card">
        <div class="card-title">Traceability Explorer</div>
        <p style="font-size: 13px; color: var(--text-muted); line-height: 1.6;">
          An automated map connecting product specifications directly to code changes and validation reports. Open <code style="color:var(--text); background:rgba(255,255,255,0.05); padding:2px 4px; border-radius:4px;">traceability.json</code> in your run state to inspect fully.
        </p>
      </div>
      
      <div class="card">
        <div class="card-title">Harness Guardrail Limits</div>
        <ul style="font-size: 13px; color: var(--text-muted); list-style: none; display: flex; flex-direction: column; gap: 10px;">
          <li>🔒 <strong>maxTaskAttempts:</strong> 2</li>
          <li>🚧 <strong>maxToolCallsPerTask:</strong> 40</li>
          <li>🛡️ <strong>requireEvidenceForPass:</strong> true</li>
          <li>🙋 <strong>requireHumanApproval:</strong> true</li>
        </ul>
      </div>

      <div class="card">
        <div class="card-title">Memory Health</div>
        <div id="mem-health" style="font-size: 13px; color: var(--text-muted); display: flex; flex-direction: column; gap: 8px;">
          <div>🧠 <strong>Episodes:</strong> <span id="mem-count">—</span></div>
          <div>💾 <strong>Store size:</strong> <span id="mem-size">—</span></div>
          <div>⚠️ <strong>Signature Failures:</strong> <span id="mem-sigfail">—</span></div>
          <div>📈 <strong>Recall Hit Rate:</strong> <span id="mem-hitrate">—</span></div>
        </div>
      </div>
    </div>
  </div>
</body>
</html>
`);
  });

  server.listen(port);
  console.log(`[RStack Dashboard] Live observability server listening at http://localhost:${port}`);
  return { server, port };
}
