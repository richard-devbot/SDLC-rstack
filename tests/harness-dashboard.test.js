import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { updateRunMetrics, startDashboardServer } from '../src/index.js';

// owner: RStack developed by Richardson Gunde

test('updateRunMetrics writes metrics.json cleanly and accumulates values', async () => {
  const runDir = mkdtempSync(join(tmpdir(), 'rstack-metrics-'));
  try {
    const first = await updateRunMetrics(runDir, {
      cumulative_duration_ms: 1000,
      cumulative_cost_usd: 0.02,
      cumulative_tool_calls: 5,
      stage_status: { '00-environment': 'PASS' },
    });

    assert.equal(first.cumulative_duration_ms, 1000);
    assert.equal(first.cumulative_cost_usd, 0.02);
    assert.equal(first.cumulative_tool_calls, 5);
    assert.equal(first.stage_status['00-environment'], 'PASS');

    const metricsFile = join(runDir, 'metrics.json');
    assert.ok(existsSync(metricsFile), 'metrics.json file must exist');

    const second = await updateRunMetrics(runDir, {
      cumulative_duration_ms: 2500,
      cumulative_cost_usd: 0.05,
      cumulative_tool_calls: 12,
      stage_status: { '01-transcript': 'PASS' },
    });

    assert.equal(second.cumulative_duration_ms, 2500, 'cumulative duration should overwrite');
    assert.equal(second.cumulative_cost_usd, 0.05);
    assert.equal(second.cumulative_tool_calls, 12);
    assert.equal(second.stage_status['00-environment'], 'PASS', 'original status should be preserved');
    assert.equal(second.stage_status['01-transcript'], 'PASS');
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

test('startDashboardServer spins up a local server and answers metrics API queries', async () => {
  const runDir = mkdtempSync(join(tmpdir(), 'rstack-dashboard-'));
  try {
    const runId = 'run-123';
    const projectRoot = join(runDir, 'project');
    const dbRunDir = join(projectRoot, '.rstack', 'runs', runId);
    
    // Setup mock run files
    const fs = await import('node:fs/promises');
    await fs.mkdir(dbRunDir, { recursive: true });
    await fs.writeFile(join(dbRunDir, 'manifest.json'), JSON.stringify({ run_id: runId }));
    await fs.writeFile(join(dbRunDir, 'metrics.json'), JSON.stringify({ cumulative_tool_calls: 10 }));
    await fs.writeFile(join(dbRunDir, 'tasks.json'), JSON.stringify({ tasks: [] }));

    const { server, port } = startDashboardServer(projectRoot, runId, 3009);
    assert.ok(server, 'Server must spin up');
    assert.equal(port, 3009);

    // query api
    const res = await fetch(`http://localhost:${port}/api/metrics`);
    const data = await res.json();
    assert.equal(data.metrics.cumulative_tool_calls, 10);
    assert.equal(data.manifest.run_id, 'run-123');

    server.close();
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});
