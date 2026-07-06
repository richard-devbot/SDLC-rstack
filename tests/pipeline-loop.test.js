import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { runGoalLoop, formatLoopReport, loadGoalDefinition } from '../src/commands/pipeline-loop.js';
import {
  DEFAULT_LOOP_BOUNDS,
  LOOP_HARD_CAP,
  computeProgressFingerprint,
  planLoopDecision,
  resetStagesForRetry,
  resolveLoopBounds,
} from '../src/core/harness/goal-loop.js';

const execFileAsync = promisify(execFile);
const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'rstack-agents.js');

function seedRun(projectRoot, runId, { tasks = [], approvals = [], events = [], goal = null, feedback = null, metrics = null } = {}) {
  const runDir = path.join(projectRoot, '.rstack', 'runs', runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(path.join(runDir, 'manifest.json'), JSON.stringify({ run_id: runId, goal: 'Loop fixture', status: 'IN_PROGRESS' }));
  writeFileSync(path.join(runDir, 'tasks.json'), JSON.stringify({ tasks }));
  writeFileSync(path.join(runDir, 'approvals.json'), JSON.stringify(approvals));
  writeFileSync(path.join(runDir, 'events.jsonl'), events.map((event) => JSON.stringify(event)).join('\n') + (events.length ? '\n' : ''));
  if (goal) writeFileSync(path.join(runDir, 'goal.json'), JSON.stringify(goal));
  if (metrics) writeFileSync(path.join(runDir, 'metrics.json'), JSON.stringify(metrics));
  if (feedback) {
    const stageDir = path.join(runDir, 'artifacts', 'stages', '11-feedback-loop');
    mkdirSync(stageDir, { recursive: true });
    writeFileSync(path.join(stageDir, 'feedback.json'), JSON.stringify(feedback));
  }
  return runDir;
}

const task = (id, status, stageId = '07-code') => ({ id, title: id, status, stage_artifacts: [{ stage_id: stageId }] });

function readEvents(runDir) {
  return readFileSync(path.join(runDir, 'events.jsonl'), 'utf8')
    .split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

// ── Pure planner ─────────────────────────────────────────────────────────────

test('planLoopDecision: PASS stops complete, ASK_USER and BLOCK stop with human reasons', () => {
  assert.equal(planLoopDecision({ evaluation: { status: 'PASS' }, iteration: 1, maxIterations: 3 }).stopped_on, 'complete');
  assert.equal(planLoopDecision({ evaluation: { status: 'ASK_USER' }, iteration: 1, maxIterations: 3 }).stopped_on, 'ask_user');
  assert.equal(planLoopDecision({ evaluation: { status: 'BLOCK' }, iteration: 1, maxIterations: 3 }).stopped_on, 'blocked');
});

test('planLoopDecision: RETRY at the iteration bound stops max_iterations; under it resets stages', () => {
  const evaluation = { status: 'RETRY', recommended_rerun_stages: ['07-code'], failing_stages: [] };
  assert.equal(planLoopDecision({ evaluation, iteration: 3, maxIterations: 3 }).stopped_on, 'max_iterations');
  const go = planLoopDecision({ evaluation, iteration: 1, maxIterations: 3 });
  assert.equal(go.action, 'retry_stages');
  assert.deepEqual(go.stages, ['07-code']);
});

test('planLoopDecision: identical fingerprints or an empty rerun set stop as no_progress', () => {
  const evaluation = { status: 'RETRY', recommended_rerun_stages: ['07-code'], failing_stages: [] };
  const stuck = planLoopDecision({ evaluation, iteration: 1, maxIterations: 3, progressFingerprint: 'same', previousFingerprint: 'same' });
  assert.equal(stuck.stopped_on, 'no_progress');
  const nothing = planLoopDecision({ evaluation: { status: 'RETRY', recommended_rerun_stages: [], failing_stages: [] }, iteration: 1, maxIterations: 3 });
  assert.equal(nothing.stopped_on, 'no_progress');
});

test('planLoopDecision: budget, human gates, and junk evaluations always stop', () => {
  assert.equal(planLoopDecision({ evaluation: { status: 'PASS' }, iteration: 1, maxIterations: 3, budget: { ok: false, reason: 'spent' } }).stopped_on, 'budget_exhausted');
  assert.equal(planLoopDecision({ evaluation: { status: 'RETRY' }, iteration: 1, maxIterations: 3, pipelineStoppedOn: 'pending_approval' }).stopped_on, 'pending_approval');
  assert.equal(planLoopDecision({ evaluation: null, iteration: 1, maxIterations: 3 }).stopped_on, 'evaluation_error');
  assert.equal(planLoopDecision({}).stopped_on, 'evaluation_error');
});

test('planLoopDecision: max_steps mid-work continues without resetting stages', () => {
  const decision = planLoopDecision({
    evaluation: { status: 'RETRY', recommended_rerun_stages: [], failing_stages: [] },
    iteration: 1, maxIterations: 3, pipelineStoppedOn: 'max_steps',
  });
  assert.equal(decision.action, 'continue');
});

// ── Bounds ───────────────────────────────────────────────────────────────────

test('resolveLoopBounds clamps to the hard cap and ignores junk', () => {
  assert.equal(resolveLoopBounds().maxIterations, DEFAULT_LOOP_BOUNDS.maxIterations);
  assert.equal(resolveLoopBounds({ maxIterations: 50 }).maxIterations, LOOP_HARD_CAP);
  assert.equal(resolveLoopBounds({ maxIterations: 0 }).maxIterations, DEFAULT_LOOP_BOUNDS.maxIterations);
  assert.equal(resolveLoopBounds({ maxIterations: 'lots' }).maxIterations, DEFAULT_LOOP_BOUNDS.maxIterations);
  assert.equal(resolveLoopBounds({ unknown: 99 }).maxIterations, DEFAULT_LOOP_BOUNDS.maxIterations);
});

test('computeProgressFingerprint ignores event growth but tracks task and evaluation changes', () => {
  const a = computeProgressFingerprint({ tasks: [task('001', 'PASS')], evaluation: { status: 'RETRY', score: 80, failing_stages: [], recommended_rerun_stages: ['07-code'], criteria: [] } });
  const b = computeProgressFingerprint({ tasks: [task('001', 'PASS')], evaluation: { status: 'RETRY', score: 80, failing_stages: [], recommended_rerun_stages: ['07-code'], criteria: [] } });
  const c = computeProgressFingerprint({ tasks: [task('001', 'FAIL')], evaluation: { status: 'RETRY', score: 80, failing_stages: [], recommended_rerun_stages: ['07-code'], criteria: [] } });
  assert.equal(a, b);
  assert.notEqual(a, c);
});

// ── Stage reset ──────────────────────────────────────────────────────────────

test('resetStagesForRetry resets only selected-stage tasks, atomically, preserving gates', async () => {
  const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'rstack-loop-'));
  const runDir = seedRun(projectRoot, 'run-a', {
    tasks: [
      task('001', 'PASS', '06-architecture'),
      task('002', 'PASS', '07-code'),
      task('003', 'BLOCKED', '07-code'),
      task('004', 'NEEDS_CONTEXT', '07-code'),
    ],
    metrics: null,
  });
  const reset = await resetStagesForRetry(projectRoot, 'run-a', ['07-code']);
  assert.deepEqual(reset, ['002'], 'only resettable tasks in the selected stage are touched');
  const tasks = JSON.parse(readFileSync(path.join(runDir, 'tasks.json'), 'utf8')).tasks;
  assert.equal(tasks.find((item) => item.id === '001').status, 'PASS', 'other stages untouched');
  assert.equal(tasks.find((item) => item.id === '002').status, 'PENDING');
  assert.equal(tasks.find((item) => item.id === '003').status, 'BLOCKED', 'guardrail gate preserved');
  assert.equal(tasks.find((item) => item.id === '004').status, 'NEEDS_CONTEXT', 'human gate preserved');
  const metrics = JSON.parse(readFileSync(path.join(runDir, 'metrics.json'), 'utf8'));
  assert.equal(metrics.stage_status['07-code'], 'PENDING', 'stale stage status cleared');
});

test('resetStagesForRetry only overrides stage_status for stages where a task was actually reset', async () => {
  const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'rstack-loop-'));
  const runDir = seedRun(projectRoot, 'run-a', {
    tasks: [
      task('001', 'BLOCKED', '06-architecture'), // gated — nothing resettable in this stage
      task('002', 'PASS', '07-code'),
    ],
    metrics: { stage_status: { '06-architecture': 'FAILED', '07-code': 'PASS' } },
  });
  const reset = await resetStagesForRetry(projectRoot, 'run-a', ['06-architecture', '07-code']);
  assert.deepEqual(reset, ['002']);
  const metrics = JSON.parse(readFileSync(path.join(runDir, 'metrics.json'), 'utf8'));
  assert.equal(metrics.stage_status['07-code'], 'PENDING');
  assert.equal(metrics.stage_status['06-architecture'], 'FAILED', 'a stage with only gated tasks keeps its real status');
});

// ── The loop ─────────────────────────────────────────────────────────────────

test('retry then pass: loop resets the recommended stage, reruns it, and completes with the full event trail', async () => {
  const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'rstack-loop-'));
  const artifact = path.join(projectRoot, 'built.md');
  const runDir = seedRun(projectRoot, 'run-a', {
    tasks: [task('001', 'PASS', '07-code')],
    goal: { goal_id: 'artifact-exists', criteria: [{ id: 'built', kind: 'file_exists', path: 'built.md', rerun_stages: ['07-code'] }] },
  });

  // Fake host agent: when the loop re-claims the reset task, "build" the file.
  const invokeTool = async (tool) => {
    if (tool !== 'sdlc_build_next') return;
    writeFileSync(artifact, 'built');
    writeFileSync(path.join(runDir, 'tasks.json'), JSON.stringify({ tasks: [task('001', 'PASS', '07-code')] }));
  };

  const report = await runGoalLoop(projectRoot, { runId: 'run-a', invokeTool });
  assert.equal(report.stopped_on, 'complete');
  assert.equal(report.iterations.length, 2);
  assert.equal(report.iterations[0].decision.action, 'retry_stages');
  assert.deepEqual(report.iterations[0].decision.stages, ['07-code']);
  assert.equal(report.iterations[1].evaluation.status, 'PASS');

  const types = readEvents(runDir).map((event) => event.type);
  assert.deepEqual(types, [
    'loop_iteration_started', 'goal_evaluated', 'loop_iteration_retrying_stages',
    'loop_iteration_started', 'goal_evaluated', 'loop_completed',
  ]);
  const evaluated = readEvents(runDir).find((event) => event.type === 'goal_evaluated');
  assert.equal(evaluated.status, 'RETRY');
  assert.ok(Array.isArray(evaluated.recommended_rerun_stages));
  assert.ok(evaluated.reason, 'goal_evaluated events carry an operator-readable reason');
});

test('loop never exceeds max iterations and records loop_blocked when the goal stays unmet', async () => {
  const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'rstack-loop-'));
  const runDir = seedRun(projectRoot, 'run-a', {
    tasks: [task('001', 'PASS', '07-code')],
    goal: { goal_id: 'never-met', criteria: [{ id: 'ghost', kind: 'file_exists', path: 'never.md', rerun_stages: ['07-code'] }] },
  });
  let claims = 0;
  const invokeTool = async (tool) => {
    if (tool !== 'sdlc_build_next') return;
    claims += 1;
    // The "agent" finishes the task but never produces the goal artifact.
    writeFileSync(path.join(runDir, 'tasks.json'), JSON.stringify({ tasks: [task('001', 'PASS', '07-code')] }));
  };

  const report = await runGoalLoop(projectRoot, { runId: 'run-a', maxIterations: 2, invokeTool });
  assert.equal(report.stopped_on, 'max_iterations');
  assert.equal(report.iterations.length, 2);
  assert.ok(claims <= 2);
  const blocked = readEvents(runDir).filter((event) => event.type === 'loop_blocked');
  assert.equal(blocked.length, 1);
  assert.equal(blocked[0].stopped_on, 'max_iterations');
});

test('no-progress: an iteration that changes nothing stops the loop and says why', async () => {
  const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'rstack-loop-'));
  const runDir = seedRun(projectRoot, 'run-a', {
    tasks: [task('001', 'PASS', '07-code')],
    goal: { goal_id: 'never-met', criteria: [{ id: 'ghost', kind: 'file_exists', path: 'never.md', rerun_stages: ['07-code'] }] },
  });
  const invokeTool = async (tool) => {
    if (tool !== 'sdlc_build_next') return;
    writeFileSync(path.join(runDir, 'tasks.json'), JSON.stringify({ tasks: [task('001', 'PASS', '07-code')] }));
  };

  const report = await runGoalLoop(projectRoot, { runId: 'run-a', maxIterations: 5, invokeTool });
  assert.equal(report.stopped_on, 'no_progress');
  assert.equal(report.iterations.length, 2, 'iteration 2 repeats iteration 1 exactly — stop there, not at the bound');
  assert.match(report.detail, /no state change/i);
});

test('budget exhaustion stops the loop before any pipeline pass', async () => {
  const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'rstack-loop-'));
  mkdirSync(path.join(projectRoot, '.rstack'), { recursive: true });
  writeFileSync(path.join(projectRoot, '.rstack', 'budget.json'), JSON.stringify({ run_budget_usd: 1 }));
  const runDir = seedRun(projectRoot, 'run-a', {
    tasks: [task('001', 'PENDING')],
    metrics: { cumulative_cost_usd: 2.5 },
  });

  const report = await runGoalLoop(projectRoot, {
    runId: 'run-a',
    invokeTool: async () => assert.fail('a budget-exhausted loop must not invoke tools'),
  });
  assert.equal(report.stopped_on, 'budget_exhausted');
  assert.match(report.detail, /\$2\.50 spent .* \$1\.00/);
  const blocked = readEvents(runDir).filter((event) => event.type === 'loop_blocked');
  assert.equal(blocked.length, 1);
  assert.equal(blocked[0].stopped_on, 'budget_exhausted');
});

test('human gates propagate: a pending approval stops the loop without invoking tools', async () => {
  const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'rstack-loop-'));
  seedRun(projectRoot, 'run-a', {
    tasks: [task('001', 'PENDING')],
    approvals: [{ artifact: 'plan.md', status: 'PENDING' }],
  });
  const report = await runGoalLoop(projectRoot, {
    runId: 'run-a',
    invokeTool: async () => assert.fail('must not invoke behind an approval gate'),
  });
  assert.equal(report.stopped_on, 'pending_approval');
  assert.equal(report.iterations.length, 1);
});

test('dry-run reports evaluation and decision and persists nothing at all', async () => {
  const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'rstack-loop-'));
  const runDir = seedRun(projectRoot, 'run-a', {
    tasks: [task('001', 'PASS', '07-code')],
    goal: { goal_id: 'never-met', criteria: [{ id: 'ghost', kind: 'file_exists', path: 'never.md', rerun_stages: ['07-code'] }] },
  });
  const before = readFileSync(path.join(runDir, 'tasks.json'), 'utf8');

  const report = await runGoalLoop(projectRoot, {
    runId: 'run-a', dryRun: true,
    invokeTool: async () => assert.fail('dry-run must not invoke tools'),
  });
  assert.equal(report.stopped_on, 'dry_run');
  assert.equal(report.iterations[0].evaluation.status, 'RETRY');
  assert.equal(report.iterations[0].decision.action, 'retry_stages');
  assert.equal(readEvents(runDir).length, 0, 'dry-run must not append loop events');
  assert.equal(readFileSync(path.join(runDir, 'tasks.json'), 'utf8'), before, 'dry-run must not reset tasks');
  assert.ok(!existsSync(path.join(runDir, 'pipeline-state.json')), 'dry-run must not even persist the rollup');
});

test('the hard cap can never be exceeded from options or config', async () => {
  const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'rstack-loop-'));
  mkdirSync(path.join(projectRoot, '.rstack'), { recursive: true });
  writeFileSync(path.join(projectRoot, '.rstack', 'rstack.config.json'), JSON.stringify({ loop: { maxIterations: 99 } }));
  seedRun(projectRoot, 'run-a', { tasks: [task('001', 'PASS')] });

  const report = await runGoalLoop(projectRoot, { runId: 'run-a', maxIterations: 500, invokeTool: async () => {} });
  assert.equal(report.max_iterations, LOOP_HARD_CAP);
  assert.equal(report.stopped_on, 'complete', 'goal met on iteration 1 — the cap is a bound, not a target');
});

test('config loop.maxIterations applies when no CLI override is given', async () => {
  const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'rstack-loop-'));
  mkdirSync(path.join(projectRoot, '.rstack'), { recursive: true });
  writeFileSync(path.join(projectRoot, '.rstack', 'rstack.config.json'), JSON.stringify({ loop: { maxIterations: 7 } }));
  seedRun(projectRoot, 'run-a', { tasks: [task('001', 'PASS')] });
  const report = await runGoalLoop(projectRoot, { runId: 'run-a', invokeTool: async () => {} });
  assert.equal(report.max_iterations, 7);
});

test('loop events are visible in pipeline status: goal_loop rollup + status line', async () => {
  const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'rstack-loop-'));
  const runDir = seedRun(projectRoot, 'run-a', {
    tasks: [task('001', 'PASS', '07-code')],
    goal: { goal_id: 'never-met', criteria: [{ id: 'ghost', kind: 'file_exists', path: 'never.md', rerun_stages: ['07-code'] }] },
  });
  const invokeTool = async (tool) => {
    if (tool !== 'sdlc_build_next') return;
    writeFileSync(path.join(runDir, 'tasks.json'), JSON.stringify({ tasks: [task('001', 'PASS', '07-code')] }));
  };
  await runGoalLoop(projectRoot, { runId: 'run-a', maxIterations: 2, invokeTool });

  const { buildPipelineState } = await import('../src/core/harness/pipeline-state.js');
  const state = await buildPipelineState(projectRoot, 'run-a');
  assert.ok(state.goal_loop.total > 0, 'rollup carries a goal_loop summary');
  assert.equal(state.goal_loop.iterations, 2);
  assert.equal(state.goal_loop.last_evaluation.status, 'RETRY');
  assert.equal(state.goal_loop.stopped_on, 'max_iterations');
  assert.equal(state.retries.total, 0, 'goal-loop events must not inflate the task-retry counts');

  const { formatPipelineStatus } = await import('../src/commands/pipeline.js');
  const text = formatPipelineStatus(state);
  assert.match(text, /Goal loop: iteration 2 \| last evaluation RETRY .* \| stopped on max_iterations/);
});

test('formatLoopReport renders iterations and the closing line', async () => {
  const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'rstack-loop-'));
  seedRun(projectRoot, 'run-a', { tasks: [task('001', 'PASS')] });
  const report = await runGoalLoop(projectRoot, { runId: 'run-a', invokeTool: async () => {} });
  const text = formatLoopReport(report);
  assert.match(text, /Iteration 1:/);
  assert.match(text, /\[PASS\]/);
  assert.match(text, /Loop complete — goal met/);
});

test('loadGoalDefinition fails loudly on a missing or malformed file', async () => {
  await assert.rejects(() => loadGoalDefinition('/nonexistent/goal.json'), /Cannot read goal definition/);
  const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'rstack-loop-'));
  const bad = path.join(projectRoot, 'bad.json');
  writeFileSync(bad, '{not json');
  await assert.rejects(() => loadGoalDefinition(bad), /not valid JSON/);
});

test('CLI: pipeline loop --dry-run --json emits the structured report and exits 0', async () => {
  const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'rstack-loop-cli-'));
  seedRun(projectRoot, 'run-a', { tasks: [task('001', 'PASS')] });
  const goalPath = path.join(projectRoot, 'recipe.json');
  writeFileSync(goalPath, JSON.stringify({ goal_id: 'recipe', criteria: [{ id: 'doc', kind: 'file_exists', path: 'missing.md', rerun_stages: ['03-documentation'] }] }));

  const { stdout } = await execFileAsync(process.execPath, [BIN, 'pipeline', 'loop', '--project', projectRoot, '--goal', goalPath, '--dry-run', '--json']);
  const report = JSON.parse(stdout);
  assert.equal(report.stopped_on, 'dry_run');
  assert.equal(report.goal_id, 'recipe');
  assert.equal(report.iterations[0].evaluation.status, 'RETRY');
  assert.deepEqual(report.iterations[0].decision.stages, ['03-documentation']);
});

test('CLI: an unmet goal exits non-zero so CI can tell', async () => {
  const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'rstack-loop-cli-'));
  seedRun(projectRoot, 'run-a', {
    tasks: [task('001', 'PASS')],
    goal: { goal_id: 'never-met', criteria: [{ id: 'ghost', kind: 'file_exists', path: 'never.md', rerun_stages: ['07-code'] }] },
  });
  await assert.rejects(
    () => execFileAsync(process.execPath, [BIN, 'pipeline', 'loop', '--project', projectRoot, '--max-iterations', '1', '--json']),
    (error) => {
      assert.equal(error.code, 1);
      const report = JSON.parse(error.stdout);
      assert.equal(report.stopped_on, 'max_iterations');
      return true;
    },
  );
});
