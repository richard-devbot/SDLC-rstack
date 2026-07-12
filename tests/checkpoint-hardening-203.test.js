import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveStageCheckpoint, verifyStageCheckpoint, rollbackToCheckpoint } from '../src/core/harness/checkpoints.js';
import { rollbackStage } from '../src/core/harness/run-state.js';
import { buildPipelineState } from '../src/core/harness/pipeline-state.js';

// owner: RStack developed by Richardson Gunde
//
// #203: (1) rollbackStage did rm(dest) then cp(src) — a crash between the two
// destroyed the live stage dir; the restore is now copy-to-temp + atomic swap.
// (2) the pipeline-state rollup called verifyStageCheckpoint WITHOUT deep, so a
// same-size-tampered checkpoint read checkpoint_restorable:true while an actual
// sdlc_rollback returned CORRUPT — status over-promised. The rollup now verifies
// deep (sha-256), matching the action.

function writeJson(p, v) { writeFileSync(p, JSON.stringify(v, null, 2)); }

function setupRun() {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-cp-203-'));
  const runId = '2026-07-06T00-00-00-cp';
  const runDir = join(projectRoot, '.rstack', 'runs', runId);
  mkdirSync(runDir, { recursive: true });
  writeJson(join(runDir, 'manifest.json'), { run_id: runId, goal: 'checkpoint hardening', created_at: '2026-07-06T00:00:00.000Z', framework: 'pi' });
  writeJson(join(runDir, 'tasks.json'), { tasks: [] });
  return { projectRoot, runId, runDir };
}

async function makeCheckpoint(runDir, stageId, contents) {
  const stageDir = join(runDir, 'artifacts', 'stages', stageId);
  mkdirSync(stageDir, { recursive: true });
  writeFileSync(join(stageDir, 'artifact.txt'), contents);
  const saved = await saveStageCheckpoint(runDir, stageId, 'after', { taskId: `t-${stageId}` });
  assert.ok(saved.saved && saved.verified, `checkpoint for ${stageId} must save + verify`);
  return join(runDir, 'checkpoints', stageId, 'artifact.txt');
}

test('#203(2) a same-size-tampered checkpoint is restorable only under shallow, not deep', async () => {
  const { projectRoot, runId, runDir } = setupRun();
  try {
    // Clean checkpoint on 06-architecture; tampered (same byte length) on 07-code.
    await makeCheckpoint(runDir, '06-architecture', 'AAAAA');
    const codeCp = await makeCheckpoint(runDir, '07-code', 'AAAAA');
    writeFileSync(codeCp, 'BBBBB'); // identical size (5 bytes), different sha-256

    // Shallow (old behaviour) still says restorable — size matches the manifest.
    assert.equal(verifyStageCheckpoint(runDir, '07-code').restorable, true, 'shallow size-only check is fooled by the same-size tamper');
    // Deep (the fix) catches it.
    assert.equal(verifyStageCheckpoint(runDir, '07-code', { deep: true }).restorable, false, 'deep sha-256 check rejects the tamper');
    assert.equal(verifyStageCheckpoint(runDir, '06-architecture', { deep: true }).restorable, true, 'a clean checkpoint stays deep-restorable');

    // The pipeline-state rollup now uses deep — status matches the action.
    const state = await buildPipelineState(projectRoot, runId);
    const code = state.stages.find((s) => s.id === '07-code');
    const arch = state.stages.find((s) => s.id === '06-architecture');
    assert.equal(code.checkpoint_restorable, false, 'rollup no longer over-promises restorable for a tampered checkpoint (#203)');
    assert.equal(arch.checkpoint_restorable, true, 'rollup still reports a clean checkpoint restorable');

    // The action was already fail-closed; assert the alignment.
    const result = await rollbackToCheckpoint(runDir, '07-code');
    assert.equal(result.status, 'CORRUPT', 'rollback refuses the tampered checkpoint — now matching the status');
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('#203(1) rollbackStage restores content atomically and leaves no temp dir behind', async () => {
  const { runDir } = setupRun();
  const projectRoot = join(runDir, '..', '..', '..'); // for cleanup
  try {
    const stageId = '07-code';
    const stageDir = join(runDir, 'artifacts', 'stages', stageId);
    await makeCheckpoint(runDir, stageId, 'console.log("hello");');

    // Mutate the live stage, then restore from the checkpoint.
    writeFileSync(join(stageDir, 'artifact.txt'), 'console.log("tampered");');
    const ok = await rollbackStage(runDir, stageId);
    assert.equal(ok, true);
    assert.equal(readFileSync(join(stageDir, 'artifact.txt'), 'utf8'), 'console.log("hello");', 'live stage is restored from the checkpoint');

    // The atomic swap must not leave a `.tmp.` sibling in the stages dir.
    const siblings = readdirSync(join(runDir, 'artifacts', 'stages'));
    assert.ok(!siblings.some((n) => n.includes('.tmp.')), 'no temp restore directory is left behind');
  } finally {
    rmSync(join(runDir, '..', '..'), { recursive: true, force: true });
  }
});
