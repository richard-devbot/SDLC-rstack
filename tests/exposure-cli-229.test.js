import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveStageCheckpoint } from '../src/core/harness/checkpoints.js';
import {
  runConfigValidate, runPipelineRollback, runCheckpointStatus,
  runApprovalsAudit, runMemoryInspect,
} from '../src/commands/exposure.js';

// owner: RStack developed by Richardson Gunde
//
// #229: exposure CLI verbs are thin wrappers over existing harness functions.
// These pins exercise the wrapper logic (result shapes + exit-worthy fields)
// in-process, independent of the commander/bin wiring.

function writeJson(p, v) { writeFileSync(p, JSON.stringify(v, null, 2)); }

function setupRun() {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-229-'));
  const runId = '2026-07-07T00-00-00-exposure';
  const runDir = join(projectRoot, '.rstack', 'runs', runId);
  mkdirSync(runDir, { recursive: true });
  writeJson(join(runDir, 'manifest.json'), { run_id: runId, goal: 'exposure verbs', created_at: '2026-07-07T00:00:00.000Z', framework: 'pi' });
  return { projectRoot, runId, runDir };
}

test('#229 config validate reports clean vs malformed configs', async () => {
  const { projectRoot } = setupRun();
  try {
    const clean = await runConfigValidate(projectRoot);
    assert.equal(clean.ok, true);
    assert.equal(clean.problem_count, 0);

    writeFileSync(join(projectRoot, '.rstack', 'budget.json'), '{ not json');
    const bad = await runConfigValidate(projectRoot);
    assert.equal(bad.ok, false);
    assert.ok(bad.problems.some((p) => p.file.includes('budget.json')));
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('#229 pipeline rollback restores a stage and fails closed on a tampered checkpoint', async () => {
  const { projectRoot, runId, runDir } = setupRun();
  try {
    const stageDir = join(runDir, 'artifacts', 'stages', '07-code');
    mkdirSync(stageDir, { recursive: true });
    writeFileSync(join(stageDir, 'code.txt'), 'ORIGINAL');
    const saved = await saveStageCheckpoint(runDir, '07-code', 'after', { taskId: 't1' });
    assert.ok(saved.saved && saved.verified);

    // Mutate the live stage, then roll back via the verb.
    writeFileSync(join(stageDir, 'code.txt'), 'MUTATED');
    const ok = await runPipelineRollback(projectRoot, { runId, stageId: '07-code' });
    assert.equal(ok.status, 'SUCCESS');
    assert.equal(readFileSync(join(stageDir, 'code.txt'), 'utf8'), 'ORIGINAL');

    // Same-size tamper of the checkpoint → deep verify fails → CORRUPT.
    writeFileSync(join(runDir, 'checkpoints', '07-code', 'code.txt'), 'TAMPERED'); // 8 bytes == 'ORIGINAL'
    const corrupt = await runPipelineRollback(projectRoot, { runId, stageId: '07-code' });
    assert.equal(corrupt.status, 'CORRUPT');

    // An unknown stage is rejected before touching disk.
    const invalid = await runPipelineRollback(projectRoot, { runId, stageId: 'not-a-stage' });
    assert.equal(invalid.status, 'INVALID_STAGE');
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('#229 checkpoint-status lists restorable stages (deep) and flags corruption', async () => {
  const { projectRoot, runId, runDir } = setupRun();
  try {
    const stageDir = join(runDir, 'artifacts', 'stages', '06-architecture');
    mkdirSync(stageDir, { recursive: true });
    writeFileSync(join(stageDir, 'design.txt'), 'AAAAA');
    await saveStageCheckpoint(runDir, '06-architecture', 'after', { taskId: 't1' });

    let status = await runCheckpointStatus(projectRoot, { runId });
    assert.equal(status.checkpoints, 1);
    assert.equal(status.stages[0].stage_id, '06-architecture');
    assert.equal(status.stages[0].restorable, true);

    // Same-size tamper flips it to non-restorable under the deep check.
    writeFileSync(join(runDir, 'checkpoints', '06-architecture', 'design.txt'), 'BBBBB');
    status = await runCheckpointStatus(projectRoot, { runId });
    assert.equal(status.stages[0].restorable, false);
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('#229 approvals audit surfaces valid vs rejected records with reasons', async () => {
  const { projectRoot, runId, runDir } = setupRun();
  try {
    writeJson(join(runDir, 'approvals.json'), [
      { id: 'app-1', artifact: 'plan.md', status: 'APPROVED', approver: 'richardson', timestamp: '2026-07-07T00:00:01.000Z' },
      // Malformed: lowercase status is not a valid run-level status casing.
      { id: 'app-2', artifact: 'requirements.json', status: 'approved', approver: 'richardson', timestamp: '2026-07-07T00:00:02.000Z' },
    ]);
    const audit = await runApprovalsAudit(projectRoot, { runId });
    assert.equal(audit.total, 2);
    assert.equal(audit.valid, 1);
    assert.equal(audit.rejected.length, 1);
    assert.equal(audit.rejected[0].artifact, 'requirements.json');
    assert.ok(audit.rejected[0].reasons.some((r) => r.toLowerCase().includes('status')));
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('#229 memory inspect returns a structured diagnostics report', async () => {
  const { projectRoot, runId } = setupRun();
  const prev = process.env.RSTACK_MEMORY_DIR;
  process.env.RSTACK_MEMORY_DIR = join(projectRoot, 'mem');
  try {
    const d = await runMemoryInspect(projectRoot, { runId });
    assert.equal(typeof d.episode_count, 'number');
    assert.ok(Array.isArray(d.diagnostics));
    assert.equal(typeof d.healthy, 'boolean');
  } finally {
    if (prev === undefined) delete process.env.RSTACK_MEMORY_DIR; else process.env.RSTACK_MEMORY_DIR = prev;
    rmSync(projectRoot, { recursive: true, force: true });
  }
});
