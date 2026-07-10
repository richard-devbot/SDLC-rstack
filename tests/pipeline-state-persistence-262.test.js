import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import extension from '../extensions/rstack-sdlc.ts';
import { loadPipelineStatus } from '../src/commands/pipeline.js';

// owner: RStack developed by Richardson Gunde
//
// #262: a run driven purely through the bridge tools never had a persisted
// pipeline-state.json (only pipeline run / status --regenerate wrote it), so
// the documented quick-start golden path broke at `pipeline status`. Two
// fixes pinned here: state-mutating tools persist the rollup as they go, and
// plain `pipeline status` falls back to an in-memory build instead of erroring.

const mockPi = {
  tools: {},
  commands: {},
  on: () => {},
  registerTool(tool) {
    this.tools[tool.name] = tool;
  },
  registerCommand(cmd, opts) {
    this.commands[cmd] = opts;
  }
};

test('state-mutating sdlc_* tools persist pipeline-state.json as the run advances', async (t) => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-state-persist-'));
  process.env.RSTACK_PROJECT_ROOT = projectRoot;
  t.after(() => {
    delete process.env.RSTACK_PROJECT_ROOT;
    rmSync(projectRoot, { recursive: true, force: true });
  });

  extension(mockPi);

  const start = await mockPi.tools.sdlc_start.execute('1', { goal: 'Quick-start golden path state check' });
  const runId = start.details.run_id;
  const statePath = join(projectRoot, '.rstack', 'runs', runId, 'pipeline-state.json');
  assert.ok(existsSync(statePath), 'sdlc_start persists an initial pipeline-state.json');

  await mockPi.tools.sdlc_plan.execute('2', { run_id: runId });
  await mockPi.tools.sdlc_approve.execute('3', { run_id: runId, artifact: 'plan.md', status: 'APPROVED' });
  await mockPi.tools.sdlc_build_next.execute('4', { run_id: runId });
  assert.ok(existsSync(statePath), 'state file survives the plan/approve/claim flow');

  // The exact quick-start "Minute 4" payoff: plain status, no --regenerate.
  const { state, source } = await loadPipelineStatus(projectRoot, { runId });
  assert.equal(source, 'persisted', 'status is served from the persisted rollup, no regenerate step needed');
  assert.ok(Array.isArray(state.stages) && state.stages.length > 0);
  assert.ok(state.current?.task_id, 'the claimed task is visible in persisted state');
});

test('plain pipeline status falls back to an in-memory build when no state file exists', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-state-fallback-'));
  try {
    const runId = '2026-07-10T10-00-00-bridge';
    const runDir = join(projectRoot, '.rstack', 'runs', runId);
    await mkdir(runDir, { recursive: true });
    await writeFile(join(runDir, 'manifest.json'), JSON.stringify({
      run_id: runId,
      goal: 'Bridge-driven run with no persisted state',
      created_at: new Date().toISOString(),
      framework: 'claude-code',
    }));
    await writeFile(join(runDir, 'tasks.json'), JSON.stringify({
      tasks: [{ id: '001-clarify', title: 'Clarify', status: 'PENDING', stage_id: '01-transcript' }],
    }));
    await writeFile(join(runDir, 'events.jsonl'), `${JSON.stringify({ ts: new Date().toISOString(), type: 'run_started' })}\n`);

    const { state, source } = await loadPipelineStatus(projectRoot, { runId });
    assert.equal(source, 'in-memory', 'missing state file degrades to a live build, not an error');
    assert.ok(Array.isArray(state.stages), 'in-memory build returns a real rollup');
    assert.ok(!existsSync(join(runDir, 'pipeline-state.json')),
      'the read path stays read-only — only --regenerate persists');

    const regenerated = await loadPipelineStatus(projectRoot, { runId, regenerate: true });
    assert.equal(regenerated.source, 'regenerated');
    assert.ok(existsSync(join(runDir, 'pipeline-state.json')), '--regenerate still persists explicitly');
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});
