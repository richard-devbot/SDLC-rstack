import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import extension from '../extensions/rstack-sdlc.ts';

// owner: RStack developed by Richardson Gunde
//
// Integration coverage for #83/#135: sdlc_validate extracts cost/context
// telemetry from the builder contract, appends the pinned cost_recorded /
// context_recorded events, and accumulates the totals in metrics.json.

function createMockPi() {
  return {
    tools: {},
    commands: {},
    on: () => {},
    registerTool(tool) {
      this.tools[tool.name] = tool;
    },
    registerCommand(cmd, opts) {
      this.commands[cmd] = opts;
    },
  };
}

function builderContract(taskId, stageIds) {
  return {
    task_id: taskId,
    agent: 'builder',
    status: 'PASS',
    summary: 'Implemented telemetry smoke test with cost and context data.',
    files_modified: [],
    tests_run: ['npm test (telemetry smoke)'],
    risks: [],
    next_steps: [],
    execution: { tools_used: ['read_file', 'patch'], events: [], artifacts_written: [] },
    cost: { currency: 'USD', estimated_usd: 0.5, actual_usd: 0.42, input_tokens: 12000, output_tokens: 3000 },
    context: { profile: 'business-flex', workflow: 'feature', injected_sources: ['requirements'], tokens_used: 42000, tokens_available: 200000 },
    memory_summary: {
      work_done: 'Recorded telemetry smoke-test context for cost/context capture.',
      decisions: ['Report cost telemetry in the builder contract.'],
      evidence: ['builder.json'],
      context_to_keep: [],
      context_to_drop: [],
      next_agent_hints: [],
    },
    stage_summaries: stageIds.map((stageId) => ({
      stage_id: stageId,
      agent_id: `agent.${stageId}`,
      work_done: `Completed ${stageId} for the telemetry smoke test.`,
      evidence: ['builder.json'],
      context_to_keep: [],
      context_to_drop: [],
    })),
  };
}

test('sdlc_validate persists builder cost/context telemetry into events and metrics.json', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-telemetry-'));
  const memoryRoot = mkdtempSync(join(tmpdir(), 'rstack-telemetry-mem-'));
  const previousProjectRoot = process.env.RSTACK_PROJECT_ROOT;
  const previousMemoryDir = process.env.RSTACK_MEMORY_DIR;
  process.env.RSTACK_PROJECT_ROOT = projectRoot;
  process.env.RSTACK_MEMORY_DIR = memoryRoot;

  try {
    const pi = createMockPi();
    extension(pi);
    const start = await pi.tools.sdlc_start.execute('start', { goal: 'Build cost telemetry smoke test', mode: 'express' });
    const runId = start.details.run_id;
    await pi.tools.sdlc_plan.execute('plan', { run_id: runId });
    const build = await pi.tools.sdlc_build_next.execute('build', { run_id: runId });
    const taskId = build.details.task.id;
    const stageIds = [...new Set(
      (build.details.task.stage_artifacts ?? []).map((artifact) => artifact?.stage_id).filter(Boolean),
    )];

    const runDir = join(projectRoot, '.rstack', 'runs', runId);
    writeFileSync(
      join(runDir, 'tasks', taskId, 'builder.json'),
      JSON.stringify(builderContract(taskId, stageIds), null, 2),
    );

    await pi.tools.sdlc_validate.execute('validate', { run_id: runId, task_id: taskId });

    const events = readFileSync(join(runDir, 'events.jsonl'), 'utf8')
      .split('\n').filter(Boolean).map((line) => JSON.parse(line));

    const costEvent = events.find((event) => event.type === 'cost_recorded');
    assert.ok(costEvent, 'cost_recorded event should be appended');
    assert.equal(costEvent.task_id, taskId);
    assert.equal(costEvent.usd, 0.42);
    assert.equal(costEvent.cost, 0.42);
    assert.equal(costEvent.estimated_usd, 0.5);
    assert.equal(costEvent.actual_usd, 0.42);
    assert.equal(costEvent.tokens, 15000);
    assert.equal(costEvent.input_tokens, 12000);
    assert.equal(costEvent.output_tokens, 3000);
    assert.equal(costEvent.source, 'builder_contract');

    const contextEvent = events.find((event) => event.type === 'context_recorded');
    assert.ok(contextEvent, 'context_recorded event should be appended');
    assert.equal(contextEvent.task_id, taskId);
    assert.equal(contextEvent.profile, 'business-flex');
    assert.equal(contextEvent.workflow, 'feature');
    assert.equal(contextEvent.injected_sources, 1);
    assert.equal(contextEvent.tokens_used, 42000);
    assert.equal(contextEvent.tokens_available, 200000);

    const metrics = JSON.parse(readFileSync(join(runDir, 'metrics.json'), 'utf8'));
    assert.equal(metrics.cumulative_cost_usd, 0.42);
    assert.deepEqual(metrics.cumulative_tokens, { input: 12000, output: 3000, total: 15000 });
    assert.equal(metrics.context_tokens_used, 42000);
    assert.equal(metrics.context_tokens_available, 200000);
    if (stageIds.length > 0) {
      const stageCostTotal = Object.values(metrics.stage_cost_usd ?? {}).reduce((sum, usd) => sum + usd, 0);
      assert.ok(Math.abs(stageCostTotal - 0.42) < 1e-9, 'per-stage cost shares should sum to the task cost');
      const stageTokenTotal = Object.values(metrics.stage_tokens ?? {}).reduce((sum, tokens) => sum + tokens.total, 0);
      // Per-stage token shares are rounded, so the sum may drift by at most
      // one token per stage.
      assert.ok(Math.abs(stageTokenTotal - 15000) <= stageIds.length, `stage token shares (${stageTokenTotal}) should sum to ~15000`);
    }
  } finally {
    if (previousProjectRoot === undefined) delete process.env.RSTACK_PROJECT_ROOT;
    else process.env.RSTACK_PROJECT_ROOT = previousProjectRoot;
    if (previousMemoryDir === undefined) delete process.env.RSTACK_MEMORY_DIR;
    else process.env.RSTACK_MEMORY_DIR = previousMemoryDir;
    rmSync(projectRoot, { recursive: true, force: true });
    rmSync(memoryRoot, { recursive: true, force: true });
  }
});
