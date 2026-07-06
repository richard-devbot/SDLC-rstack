/**
 * Command Center + Decisions page wave (#94 / #156 / #215 slice).
 *
 * Pins three contracts:
 *  1. State layer: every run in the snapshot carries `pipelineRollup` — a
 *     compact pipeline-state summary whose next-action TEXT comes from
 *     recommendPipelineAction (the `pipeline status` CLI brain), never a
 *     client-side re-implementation. Missing/unbuildable state yields null,
 *     not a broken snapshot.
 *  2. Client modules: the Command Center renders the next-action card, the
 *     executive rollup strip (with schema-version badge) and the new
 *     context-pressure / goal-loop attention signals; the Decisions page
 *     renders the resolved/waived Decision Log. All inside the compiled
 *     bundle (no-build-step stance).
 *  3. Honest empty states: no fabricated data when the rollup or decisions
 *     are absent.
 *
 * owner: RStack developed by Richardson Gunde
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildFullState, toClientState } from '../src/observability/dashboard/state/index.js';
import { recommendPipelineAction } from '../src/commands/pipeline.js';
import { readPipelineState } from '../src/core/harness/pipeline-state.js';
import { clientScript } from '../src/observability/dashboard/ui/client.js';
import { commandCenterScript } from '../src/observability/dashboard/ui/pages/command-center.js';
import { decisionsScript } from '../src/observability/dashboard/ui/pages/decisions.js';

const RUN_ID = '2026-07-06T12-00-00-000Z-command-fixture';

function jsonl(events) {
  return events.map((event) => JSON.stringify(event)).join('\n') + '\n';
}

// Fixture-shaped run: goal loop iteration 1 with a RETRY verdict, one
// context_pressure_warning, a BLOCKED testing task with guardrail_triggered,
// checkpoints, and a schema_version 2 manifest — the July harness signals.
function seedProject() {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-command-pages-'));
  const runDir = join(projectRoot, '.rstack', 'runs', RUN_ID);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, 'manifest.json'), JSON.stringify({
    run_id: RUN_ID,
    schema_version: 2,
    goal: 'Command pages fixture',
    status: 'IN_PROGRESS',
    created_at: '2026-07-06T12:00:00.000Z',
  }));
  writeFileSync(join(runDir, 'tasks.json'), JSON.stringify({
    tasks: [
      { id: '003-architecture', status: 'PASS', stage_artifacts: [{ stage_id: '06-architecture' }] },
      { id: '004-implementation', status: 'IN_PROGRESS', stage_artifacts: [{ stage_id: '07-code' }] },
      { id: '005-testing', status: 'BLOCKED', stage_artifacts: [{ stage_id: '08-testing' }] },
    ],
  }));
  writeFileSync(join(runDir, 'metrics.json'), JSON.stringify({
    cumulative_cost_usd: 4.87,
    cumulative_tokens: { input: 1420000, output: 312000, total: 1732000 },
    stage_status: { '06-architecture': 'PASS', '07-code': 'IN_PROGRESS', '08-testing': 'BLOCKED' },
  }));
  writeFileSync(join(runDir, 'events.jsonl'), jsonl([
    { ts: '2026-07-06T12:01:00.000Z', type: 'task_started', task_id: '003-architecture' },
    { ts: '2026-07-06T12:01:05.000Z', type: 'stage_checkpoint_before_saved', stage_id: '06-architecture', task_id: '003-architecture' },
    { ts: '2026-07-06T12:10:00.000Z', type: 'task_validated', task_id: '003-architecture', status: 'PASS' },
    { ts: '2026-07-06T12:11:00.000Z', type: 'loop_iteration_started', iteration: 1, goal_id: 'fixture-goal' },
    { ts: '2026-07-06T12:13:00.000Z', type: 'context_pressure_warning', source: 'memory_summary', metric: 'chars', size: 61000, threshold: 40000, task_id: '004-implementation' },
    { ts: '2026-07-06T12:31:00.000Z', type: 'task_retry_scheduled', task_id: '005-testing', attempt: 1 },
    { ts: '2026-07-06T12:35:01.000Z', type: 'guardrail_triggered', task_id: '005-testing', limit_name: 'maxTaskAttempts' },
    { ts: '2026-07-06T12:40:00.000Z', type: 'goal_evaluated', iteration: 1, recommendation: 'RETRY', criteria_met: 1, criteria_total: 2 },
  ]));
  writeFileSync(join(runDir, 'decisions.json'), JSON.stringify({
    run_id: RUN_ID,
    decisions: [
      { decision_id: 'DEC-001', question: 'Database choice?', impact: 'architecture', required_before_stage: '06-architecture', status: 'resolved', resolution: 'PostgreSQL 16', resolved_by: 'Richardson', resolved_at: '2026-07-06T12:04:00.000Z' },
      { decision_id: 'DEC-002', question: 'Require SSO for pilot?', impact: 'security', required_before_stage: '09-deployment', status: 'waived', resolved_by: 'Richardson', resolved_at: '2026-07-06T12:15:00.000Z' },
      { decision_id: 'DEC-003', question: 'Cloud region?', impact: 'budget', required_before_stage: '09-deployment', status: 'pending' },
    ],
  }));
  return projectRoot;
}

test('runs carry a pipelineRollup whose next-action text IS the CLI recommendation', async () => {
  const projectRoot = seedProject();
  const state = await buildFullState(projectRoot, { includeRegistry: false });
  const run = state.runs.find((entry) => entry.runId === RUN_ID);
  assert.ok(run, 'fixture run present in snapshot');
  const rollup = run.pipelineRollup;
  assert.ok(rollup, 'fully-parsed run gets a pipeline rollup even without a persisted pipeline-state.json');

  // The rollup schema version + status flow through for #156 visibility.
  assert.equal(rollup.schema_version, 1);
  assert.equal(run.manifest.schema_version, 2);
  assert.equal(rollup.status, 'IN_PROGRESS');

  // No second brain: the sentence must be exactly what `pipeline status`
  // would print for the same pipeline-state document.
  const pipelineState = await readPipelineState(projectRoot, RUN_ID, { regenerateIfMissing: true });
  assert.equal(rollup.next_action.text, recommendPipelineAction(pipelineState));
  // Priority classification mirrors the same order: the BLOCKED testing stage
  // with a scheduled retry classifies as 'retry' (what the CLI recommends).
  assert.equal(rollup.next_action.kind, 'retry');
  assert.equal(rollup.next_action.stage_id, '08-testing');
  assert.equal(rollup.next_action.task_id, '005-testing');

  // July signals (#215): context pressure + active goal loop with the BLE-4
  // recommendation as the verdict (goal_evaluated emits `recommendation`).
  assert.equal(rollup.context_pressure.total, 1);
  assert.deepEqual(rollup.context_pressure.by_source, { memory_summary: 1 });
  assert.equal(rollup.goal_loop.active, true);
  assert.equal(rollup.goal_loop.iterations, 1);
  assert.equal(rollup.goal_loop.last_verdict, 'RETRY');
  assert.equal(rollup.goal_loop.criteria_met, 1);
  assert.equal(rollup.goal_loop.criteria_total, 2);
  assert.equal(rollup.checkpoints.before_saved, 1);

  // The rollup survives into the client payload (the page renders from it).
  const client = toClientState(state);
  const clientRun = client.runs.find((entry) => entry.runId === RUN_ID);
  assert.ok(clientRun.pipelineRollup, 'pipelineRollup reaches the client snapshot');
  assert.equal(clientRun.pipelineRollup.next_action.text, rollup.next_action.text);
});

test('a pending approval outranks everything in the next-action classification', async () => {
  const projectRoot = seedProject();
  const runDir = join(projectRoot, '.rstack', 'runs', RUN_ID);
  writeFileSync(join(runDir, 'approvals.json'), JSON.stringify([
    { id: 'app-1', artifact: 'deploy-approval.md', stage_id: '09-deployment', status: 'PENDING' },
  ]));
  const state = await buildFullState(projectRoot, { includeRegistry: false });
  const rollup = state.runs.find((entry) => entry.runId === RUN_ID).pipelineRollup;
  assert.equal(rollup.next_action.kind, 'approval');
  assert.equal(rollup.next_action.artifact, 'deploy-approval.md');
  assert.match(rollup.next_action.text, /Resolve the pending approval for deploy-approval\.md/);
  assert.equal(rollup.approval_blockers, 1);
});

test('index-served lite runs keep the persisted rollup and manifest schema_version', async () => {
  const projectRoot = seedProject();
  // Persist the rollup first (the operator flow: pipeline status --regenerate),
  // THEN let the rollup index cache the run — writing afterwards would change
  // the run-dir signature and force a re-parse, hiding the lite-run path.
  await readPipelineState(projectRoot, RUN_ID, { regenerateIfMissing: true });
  await buildFullState(projectRoot, { includeRegistry: false }); // parses + writes .rstack/index.json
  const second = await buildFullState(projectRoot, { includeRegistry: false });
  const run = second.runs.find((entry) => entry.runId === RUN_ID);
  assert.equal(run.fromIndex, true, 'stalled fixture run is index-served on the second snapshot');
  assert.ok(run.pipelineRollup, 'lite run reads the persisted pipeline-state.json');
  assert.equal(run.pipelineRollup.schema_version, 1);
  assert.equal(run.pipelineRollup.next_action.kind, 'retry');
  assert.equal(run.manifest.schema_version, 2, 'manifest schema_version restored for lite runs (#156)');
});

test('a run without usable pipeline state gets pipelineRollup null, never a fabricated one', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-command-empty-'));
  const runDir = join(projectRoot, '.rstack', 'runs', 'run-bare');
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, 'manifest.json'), JSON.stringify({ run_id: 'run-bare', goal: 'Bare run', status: 'IN_PROGRESS' }));
  // Corrupt persisted rollup: readPipelineState tolerates it as fallback null,
  // and the in-memory build still summarizes from the run artifacts — the
  // snapshot must never throw either way.
  writeFileSync(join(runDir, 'pipeline-state.json'), '{ truncated');
  const state = await buildFullState(projectRoot, { includeRegistry: false });
  const run = state.runs.find((entry) => entry.runId === 'run-bare');
  assert.ok(run, 'bare run still in snapshot');
  // Either an honest in-memory rollup (all-pending stages) or null — but the
  // corrupt file must not leak garbage into next_action.
  if (run.pipelineRollup) {
    assert.equal(typeof run.pipelineRollup.next_action.text, 'string');
    assert.equal(run.pipelineRollup.context_pressure.total, 0);
    assert.equal(run.pipelineRollup.goal_loop.active, false);
  }
});

test('command-center module renders next-action card, exec rollup and new attention signals', () => {
  // The page module owns its injected DOM — ids the renderer targets.
  for (const id of ['command-next-action-panel', 'command-next-action', 'command-exec-rollup', 'command-schema-version']) {
    assert.ok(commandCenterScript.includes(id), `command-center module carries #${id}`);
  }
  // Next-action chip routes to the tab that holds the action.
  assert.match(commandCenterScript, /nextActionChip/);
  assert.match(commandCenterScript, /'approvals'/);
  assert.match(commandCenterScript, /'alerts-guardrails'/);
  // #215 attention rows: context pressure with the long-loop wording; goal
  // loop with iteration + last verdict.
  assert.match(commandCenterScript, /long-loop quality risk/);
  assert.match(commandCenterScript, /Goal loop running — iteration/);
  assert.match(commandCenterScript, /last_verdict/);
  // Schema-version badge (#156) and honest empty states.
  assert.match(commandCenterScript, /rollup v/);
  assert.match(commandCenterScript, /No pipeline state recorded for this run/);
  assert.match(commandCenterScript, /pipeline status --regenerate/);
  assert.match(commandCenterScript, /No runs loaded yet/);
});

test('decisions module renders the resolved/waived Decision Log with who/when/impact', () => {
  assert.ok(decisionsScript.includes('decisions-log-panel'), 'log panel injected by the module');
  assert.match(decisionsScript, /Decision Log/);
  assert.match(decisionsScript, /resolved.*waived|waived.*resolved/s);
  assert.match(decisionsScript, /resolved_by/);
  assert.match(decisionsScript, /resolved_at/);
  assert.match(decisionsScript, /impact: /);
  assert.match(decisionsScript, /openDrawerRow\(this\)/);
  assert.match(decisionsScript, /No resolved decisions yet/);
});

test('wave additions keep the assembled bundle compiling and inline-script safe', () => {
  const bundle = clientScript(3008);
  assert.doesNotThrow(() => new Function(bundle), 'bundle with wave:command additions must compile');
  assert.ok(!bundle.includes('</script'), 'no literal </script sequence');
  // Both page modules still self-register exactly once.
  assert.equal([...bundle.matchAll(/registerPage\('command',/g)].length, 1);
  assert.equal([...bundle.matchAll(/registerPage\('decisions',/g)].length, 1);
});
