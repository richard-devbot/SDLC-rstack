import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planParallelGroup, planNextAction, runPipeline } from '../src/commands/pipeline-run.js';

// owner: RStack developed by Richardson Gunde
//
// #208: when the parallel_groups gate is enabled and the fresh PENDING frontier
// is one data-independent group, the model-free runner prepares the whole group
// (a claim_group action) so the host runs their builders concurrently — each
// still claimed/checkpointed/validated per stage. Gate off, a straggler, or a
// non-independent group falls back to a single sequential claim.

const GROUP = { enabled: true, groups: [['13-compliance-checker', '14-cost-estimation']] };
const twoMembers = () => ([
  { id: 'A', status: 'PENDING', stage_id: '13-compliance-checker' },
  { id: 'B', status: 'PENDING', stage_id: '14-cost-estimation' },
]);

test('#208 planParallelGroup forms a group only for a clean, gate-enabled, independent frontier', () => {
  // Enabled + both members independent → group.
  const g = planParallelGroup({ tasks: twoMembers(), parallelGroups: GROUP });
  assert.deepEqual(g?.taskIds, ['A', 'B']);
  assert.deepEqual(g?.stages.sort(), ['13-compliance-checker', '14-cost-estimation']);

  // Gate off → sequential (null).
  assert.equal(planParallelGroup({ tasks: twoMembers(), parallelGroups: { enabled: false, groups: GROUP.groups } }), null);
  assert.equal(planParallelGroup({ tasks: twoMembers(), parallelGroups: null }), null);

  // A straggler PENDING task outside the group → frontier isn't cleanly the
  // group → null (build_next could serve the straggler first, so sequential).
  const withStraggler = [...twoMembers(), { id: 'C', status: 'PENDING', stage_id: '07-code' }];
  assert.equal(planParallelGroup({ tasks: withStraggler, parallelGroups: GROUP }), null);

  // Fewer than two claimable → null.
  assert.equal(planParallelGroup({ tasks: [twoMembers()[0]], parallelGroups: GROUP }), null);
});

test('#208 planNextAction emits claim_group only for the fresh frontier, never for retries', () => {
  const base = { state: { approval_blockers: [] }, events: [], approvals: [], guardrails: {}, taskContext: {} };

  const grouped = planNextAction({ ...base, tasks: twoMembers(), parallelGroups: GROUP });
  assert.equal(grouped.action, 'claim_group');
  assert.deepEqual(grouped.task_ids, ['A', 'B']);

  // Gate off → single sequential claim.
  const seq = planNextAction({ ...base, tasks: twoMembers(), parallelGroups: { enabled: false, groups: [] } });
  assert.equal(seq.action, 'claim');
  assert.equal(seq.task_id, 'A');

  // A FAIL task is claimable first (point-of-failure retry, #265) — retries
  // never group; the group branch is unreachable while a FAIL/BLOCKED exists.
  const withFail = [{ id: 'F', status: 'FAIL', stage_id: '13-compliance-checker' }, ...twoMembers()];
  const retry = planNextAction({ ...base, tasks: withFail, parallelGroups: GROUP });
  assert.equal(retry.action, 'claim');
  assert.equal(retry.task_id, 'F');
  assert.equal(retry.retry, true);
});

test('#208 runPipeline prepares the whole group in one step (claim_group)', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-208-'));
  const runId = '2026-07-08T00-00-00-parallel';
  const runDir = join(projectRoot, '.rstack', 'runs', runId);
  mkdirSync(runDir, { recursive: true });
  const writeJson = (p, v) => writeFileSync(p, JSON.stringify(v, null, 2));
  writeJson(join(runDir, 'manifest.json'), { run_id: runId, goal: 'parallel', created_at: '2026-07-08T00:00:00.000Z', framework: 'pi' });
  writeJson(join(runDir, 'tasks.json'), { tasks: twoMembers() });
  writeFileSync(join(runDir, 'events.jsonl'), '');
  mkdirSync(join(projectRoot, '.rstack'), { recursive: true });
  writeJson(join(projectRoot, '.rstack', 'rstack.config.json'), { parallel_groups: GROUP });

  // Mock invoker: sdlc_build_next flips the first PENDING task to IN_PROGRESS,
  // exactly as the real claim would — so loadRunSnapshot sees each member land.
  const invokeTool = async (toolName) => {
    if (toolName !== 'sdlc_build_next') return '';
    const state = JSON.parse(readFileSync(join(runDir, 'tasks.json'), 'utf8'));
    const next = state.tasks.find((t) => t.status === 'PENDING');
    if (next) { next.status = 'IN_PROGRESS'; writeJson(join(runDir, 'tasks.json'), state); }
    return '{}';
  };

  try {
    const report = await runPipeline(projectRoot, { runId, maxSteps: 1, invokeTool });
    const step = report.steps[0];
    assert.equal(step.action, 'claim_group', 'the gate-enabled independent frontier prepares as a group');
    assert.deepEqual(step.task_ids, ['A', 'B']);
    assert.deepEqual(step.claimed_group, ['A', 'B'], 'both members were claimed/prepared');
    // Both tasks are now IN_PROGRESS (prepared for concurrent host execution).
    const after = JSON.parse(readFileSync(join(runDir, 'tasks.json'), 'utf8'));
    assert.ok(after.tasks.every((t) => t.status === 'IN_PROGRESS'));
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('#208 runPipeline falls back to a single sequential claim when the gate is off', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-208-seq-'));
  const runId = '2026-07-08T00-00-00-seq';
  const runDir = join(projectRoot, '.rstack', 'runs', runId);
  mkdirSync(runDir, { recursive: true });
  const writeJson = (p, v) => writeFileSync(p, JSON.stringify(v, null, 2));
  writeJson(join(runDir, 'manifest.json'), { run_id: runId, goal: 'seq', created_at: '2026-07-08T00:00:00.000Z', framework: 'pi' });
  writeJson(join(runDir, 'tasks.json'), { tasks: twoMembers() });
  writeFileSync(join(runDir, 'events.jsonl'), '');
  // No parallel_groups config → gate off.
  writeJson(join(projectRoot, '.rstack', 'rstack.config.json'), {});

  let calls = 0;
  const invokeTool = async (toolName) => { if (toolName === 'sdlc_build_next') calls += 1; return '{}'; };
  try {
    const report = await runPipeline(projectRoot, { runId, maxSteps: 1, invokeTool });
    assert.equal(report.steps[0].action, 'claim', 'gate off → single sequential claim, not a group');
    assert.equal(calls, 1, 'exactly one task is claimed');
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});
