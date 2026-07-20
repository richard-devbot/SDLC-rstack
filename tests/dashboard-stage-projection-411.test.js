/**
 * Dashboard authoritative per-stage projection (#411): compactPipelineRollup
 * must carry the per-stage truth (status, validation_status, attempts,
 * retry_state, cost/tokens, checkpoint restorability) instead of dropping the
 * stages[] array, and buildStageMatrix must render from that projection rather
 * than reconstructing from bundled task records — closing the false-green gap.
 *
 * owner: RStack developed by Richardson Gunde
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { compactPipelineRollup } from '../src/observability/dashboard/state/pipeline-rollup.js';
import { buildStageMatrix } from '../src/observability/dashboard/state/stage-matrix.js';

// A hand-built pipeline-state.json shape (what buildPipelineState produces) —
// no filesystem needed; the projection is a pure transform.
function stateFixture() {
  return {
    schema_version: 1,
    generated_at: '2026-07-20T00:00:00.000Z',
    pipeline: { status: 'RUNNING', stages_total: 15, stages_passed: 6, stages_failed: 1 },
    current: { stage_id: '07-code', task_id: '07-code' },
    approval_blockers: [{ artifact: 'architecture.md', stage_id: '06-architecture', status: 'PENDING' }],
    context_pressure: { total: 1, by_source: { builder_prompt: 1 }, warnings: [{ stage_id: '07-code', source: 'builder_prompt' }] },
    retries: { total: 2, scheduled: 1, exhausted: 1, human_required: 0 },
    checkpoints: { total: 3, before_saved: 2, after_saved: 1, reverted: 0 },
    goal_loop: {},
    stages: [
      { id: '06-architecture', title: 'Architecture', status: 'PASS', validation_status: 'FAIL', attempts: 1, retry_state: null, cost_usd: 0.12, tokens: 4200, checkpoint_restorable: true, checkpoint_reason: null, task_ids: ['06-architecture'] },
      { id: '07-code', title: 'Code', status: 'BLOCKED', validation_status: 'FAIL', attempts: 2, retry_state: 'exhausted', cost_usd: 0.5, tokens: 15000, checkpoint_restorable: false, checkpoint_reason: 'corrupt_manifest_mismatch', task_ids: ['07-code'] },
      { id: '08-testing', title: 'Testing', status: 'PENDING', validation_status: null, attempts: 0, retry_state: null, cost_usd: null, tokens: null, checkpoint_restorable: false, checkpoint_reason: 'no_checkpoint', task_ids: [] },
    ],
  };
}

test('#411: compactPipelineRollup projects the authoritative per-stage array', () => {
  const rollup = compactPipelineRollup(stateFixture(), []);
  assert.ok(Array.isArray(rollup.stages), 'rollup now carries a stages[] array');
  assert.equal(rollup.stages.length, 3);
  const code = rollup.stages.find((s) => s.id === '07-code');
  assert.equal(code.status, 'BLOCKED');
  assert.equal(code.validation_status, 'FAIL');
  assert.equal(code.attempts, 2);
  assert.equal(code.retry_state, 'exhausted');
  assert.equal(code.cost_usd, 0.5);
  assert.equal(code.checkpoint_restorable, false);
  assert.equal(code.checkpoint_reason, 'corrupt_manifest_mismatch');
  // Per-stage blocker + pressure detail (not just counts).
  assert.deepEqual(rollup.approval_blocker_items, [{ artifact: 'architecture.md', stage_id: '06-architecture', status: 'PENDING' }]);
  assert.ok(rollup.context_pressure_items.some((item) => item.stage_id === '07-code'));
});

test('#411: buildStageMatrix renders from the authoritative projection, not task reconstruction', () => {
  const run = {
    runId: 'r1',
    projectRoot: '/p',
    tasks: [
      // The task record says 07-code is still PASS (the stale, false-green view).
      { id: '07-code', status: 'PASS', validation: { status: 'PASS' } },
    ],
    pipelineRollup: compactPipelineRollup(stateFixture(), []),
  };
  const matrix = buildStageMatrix([run]);
  const code = matrix.find((s) => s.id === '07-code');
  const cell = code.runs[0];
  // The authoritative projection wins over the stale task record.
  assert.equal(cell.status, 'BLOCKED', 'harness status overrides the task record');
  assert.equal(cell.retryState, 'exhausted');
  assert.equal(cell.attempts, 2);
  assert.equal(cell.checkpointRestorable, false);
  assert.equal(cell.checkpointReason, 'corrupt_manifest_mismatch');
  assert.equal(cell.authoritative, true);
  assert.equal(code.severity, 'exhausted', 'stage severity reflects the exhausted retry');

  // A build-PASS-but-validation-FAIL stage surfaces distinctly.
  const arch = matrix.find((s) => s.id === '06-architecture');
  assert.equal(arch.severity, 'validation_fail');
  assert.equal(arch.runs[0].approvalBlocker.artifact, 'architecture.md');
  assert.equal(arch.approvalBlocked, 1);
});

test('#411: matrix falls back to the task record when no projection exists (lite runs)', () => {
  const run = {
    runId: 'r2',
    projectRoot: '/p',
    tasks: [{ id: '02-requirements', status: 'PASS', validation: { status: 'PASS' } }],
    // no pipelineRollup (index-served lite run)
  };
  const matrix = buildStageMatrix([run]);
  const req = matrix.find((s) => s.id === '02-requirements');
  assert.equal(req.runs[0].status, 'PASS');
  assert.equal(req.runs[0].authoritative, false, 'flagged as reconstructed, not authoritative');
  assert.equal(req.runs[0].retryState, null);
});
