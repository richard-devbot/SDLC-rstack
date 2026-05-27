import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateRunReport } from '../src/harness/reporter.js';
import extension from '../extensions/rstack-sdlc.ts';

// Mock Pi Extension API
const mockPi = {
  tools: {},
  commands: {},
  registerTool(tool) {
    this.tools[tool.name] = tool;
  },
  registerCommand(name, command) {
    this.commands[name] = command;
  },
  on() {},
  ui: {
    notify() {},
  },
};

test('RStack Observability Hub - Reporter & Commands E2E', async (t) => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-obs-'));
  process.env.RSTACK_PROJECT_ROOT = projectRoot;

  // Initialize extension
  extension(mockPi);

  let runId = '';

  await t.test('Bootstrapping run and generating events', async () => {
    const result = await mockPi.tools.sdlc_start.execute('1', { goal: 'Test harness observability' });
    runId = result.details.run_id;
    assert.ok(runId);

    // Mock active stage progress events in events.jsonl
    const runDir = join(projectRoot, '.rstack', 'runs', runId);
    const eventsPath = join(runDir, 'events.jsonl');
    const evidencePath = join(runDir, 'evidence.jsonl');
    const tasksPath = join(runDir, 'tasks.json');

    const mockEvents = [
      { ts: new Date(Date.now() - 5000).toISOString(), type: 'run_started', goal: 'Test harness observability' },
      { ts: new Date(Date.now() - 4000).toISOString(), type: 'task_started', task_id: '00-environment' },
      { ts: new Date(Date.now() - 3500).toISOString(), type: 'tool_call', tool: 'system_info', input: {} },
      { ts: new Date(Date.now() - 3000).toISOString(), type: 'tool_result', tool: 'system_info', isError: false, summary: 'OS: macOS' },
      { ts: new Date(Date.now() - 2500).toISOString(), type: 'cost_recorded', task_id: '00-environment', cost: 0.0015 },
      { ts: new Date(Date.now() - 2000).toISOString(), type: 'quality_score_recorded', task_id: '00-environment', score: 0.95 },
      { ts: new Date(Date.now() - 1500).toISOString(), type: 'stage_completed', stage_id: '00-environment', elapsed_ms: 2500 },
      { ts: new Date(Date.now() - 1000).toISOString(), type: 'guardrail_triggered', limit: 'maxTaskAttempts', value: 1 },
    ];

    const fs = await import('node:fs/promises');
    await fs.writeFile(eventsPath, mockEvents.map(e => JSON.stringify(e)).join('\n') + '\n');

    const mockTasks = {
      tasks: [
        { id: '00-environment', status: 'PASS', stage_artifacts: [{ artifact_path: 'environment_report.json' }] }
      ]
    };
    await fs.writeFile(tasksPath, JSON.stringify(mockTasks, null, 2));

    const mockEvidence = {
      task_id: '00-environment',
      kind: 'validation',
      status: 'PASS',
      evidence: {
        checks: [
          { name: 'env_check', status: 'PASS', evidence: 'Environment has Node >= 18' }
        ]
      }
    };
    await fs.writeFile(evidencePath, JSON.stringify(mockEvidence) + '\n');
  });

  await t.test('Reporter generateRunReport compiles typed RunReport', async () => {
    const report = await generateRunReport(projectRoot, runId);
    
    assert.equal(report.run_id, runId);
    assert.equal(report.goal, 'Test harness observability');
    assert.equal(report.status, 'STARTED');
    assert.ok(report.duration_ms >= 0);
    assert.equal(report.cost_usd, 0.0015);
    assert.equal(report.tool_calls, 1);
    assert.equal(report.guardrails_triggered.length, 1);
    assert.equal(report.guardrails_triggered[0].limit, 'maxTaskAttempts');
    assert.equal(report.stages.length, 1);
    
    const envStage = report.stages.find((s) => s.stage_id === '00-environment');
    assert.ok(envStage);
    assert.equal(envStage.status, 'PASS');
    assert.equal(envStage.elapsed_ms, 2500);
    assert.equal(envStage.evidence.length, 1);
    assert.equal(envStage.evidence[0].checks[0].name, 'env_check');
  });

  await t.test('sdlc_dashboard tool creates dashboard.html', async () => {
    const res = await mockPi.tools.sdlc_dashboard.execute('2', { run_id: runId });
    
    assert.ok(res.content[0].text.includes('Generated static HTML dashboard'));
    
    const runDir = join(projectRoot, '.rstack', 'runs', runId);
    const dashboardPath = join(runDir, 'dashboard.html');
    assert.ok(existsSync(dashboardPath), 'dashboard.html should be created');
    
    const html = readFileSync(dashboardPath, 'utf8');
    assert.ok(html.includes('RStack Run Observability'));
    assert.ok(html.includes('Test harness observability'));
    assert.ok(html.includes('00-environment'));
  });

  await t.test('sdlc_trace tool prints gorgeous trace stream', async () => {
    const res = await mockPi.tools.sdlc_trace.execute('3', { task_id: '00-environment', run_id: runId });
    const text = res.content[0].text;
    
    assert.ok(text.includes('RSTACK SDLC TASK TRACE'));
    assert.ok(text.includes('00-environment'));
    assert.ok(text.includes('Tool Call: system_info'));
    assert.ok(text.includes('Result [✅]: OS: macOS'));
    assert.ok(text.includes('Cost Recorded: $0.0015'));
    assert.ok(text.includes('Quality Score: 0.95'));
    assert.ok(text.includes('Guardrail Triggered: maxTaskAttempts = 1'));
    assert.ok(text.includes('[VALIDATION] status: PASS'));
    assert.ok(text.includes('env_check'));
  });

  // Cleanup
  rmSync(projectRoot, { recursive: true, force: true });
});
