// Critical-stage checkpoints (#132, BLE-5.2) — harness unit tests.
//
// Covers: the pinned checkpoint event contract, critical-stage set
// resolution (defaults + config overrides, canonical ids only), disk-verified
// restorability (no best-effort claims), the checkpoint → mutate → rollback
// round-trip, pinned rollback statuses (SUCCESS | NO_CHECKPOINT |
// INVALID_STAGE — non-canonical stage ids are never accepted), config
// validation warnings, and the pipeline-state rollup surface.
//
// owner: RStack developed by Richardson Gunde

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  CHECKPOINT_EVENT_TYPES,
  DEFAULT_CRITICAL_STAGE_IDS,
  checkpointEvent,
  isCriticalStage,
  loadProjectCriticalStages,
  resolveCriticalStages,
  rollbackToCheckpoint,
  saveStageCheckpoint,
  verifyStageCheckpoint,
} from '../src/core/harness/checkpoints.js';
import { validateRstackConfig } from '../src/core/harness/config-validation.js';
import { resetStagesForRetry } from '../src/core/harness/goal-loop.js';
import { buildPipelineState } from '../src/core/harness/pipeline-state.js';
import { createStageCheckpoint } from '../src/core/harness/run-state.js';
import { formatPipelineStatus } from '../src/commands/pipeline.js';

function tempDir(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

function makeStage(runDir, stageId, files = { 'artifact.json': '{"v":1}' }) {
  const stageDir = join(runDir, 'artifacts', 'stages', stageId);
  mkdirSync(stageDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(stageDir, name), content);
  }
  return stageDir;
}

test('checkpoint event contract is pinned', async (t) => {
  await t.test('the three issue-#132 event types are pinned', () => {
    assert.deepEqual([...CHECKPOINT_EVENT_TYPES], [
      'stage_checkpoint_before_saved',
      'stage_checkpoint_after_saved',
      'stage_checkpoint_reverted',
    ]);
  });

  await t.test('unknown event types throw', () => {
    assert.throws(() => checkpointEvent('stage_checkpoint_maybe_saved', { stage_id: '07-code' }), /Unknown checkpoint event type/);
  });

  await t.test('non-canonical stage ids throw — plan task ids are not stage ids', () => {
    assert.throws(() => checkpointEvent('stage_checkpoint_before_saved', { stage_id: '007-code' }), /canonical stage_id/);
    assert.throws(() => checkpointEvent('stage_checkpoint_before_saved', {}), /canonical stage_id/);
  });

  await t.test('valid events pass fields through', () => {
    const event = checkpointEvent('stage_checkpoint_after_saved', { stage_id: '07-code', task_id: '004-code', verified: true });
    assert.deepEqual(event, { type: 'stage_checkpoint_after_saved', stage_id: '07-code', task_id: '004-code', verified: true });
  });
});

test('critical-stage set resolution', async (t) => {
  await t.test('defaults to the five issue-#132 stages', () => {
    assert.deepEqual([...DEFAULT_CRITICAL_STAGE_IDS], [
      '06-architecture',
      '07-code',
      '08-testing',
      '09-deployment',
      '12-security-threat-model',
    ]);
    assert.deepEqual(resolveCriticalStages(undefined), [...DEFAULT_CRITICAL_STAGE_IDS]);
  });

  await t.test('overrides keep only canonical stage ids, deduped', () => {
    assert.deepEqual(
      resolveCriticalStages(['07-code', '007-code', 42, '07-code', '02-requirements']),
      ['07-code', '02-requirements'],
    );
  });

  await t.test('an explicitly empty list disables critical-stage checkpoints', () => {
    assert.deepEqual(resolveCriticalStages([]), []);
  });

  await t.test('isCriticalStage answers against the resolved set', () => {
    assert.equal(isCriticalStage('07-code'), true);
    assert.equal(isCriticalStage('02-requirements'), false);
    assert.equal(isCriticalStage('02-requirements', ['02-requirements']), true);
  });

  await t.test('loadProjectCriticalStages reads rstack.config.json overrides', async () => {
    const projectRoot = tempDir('rstack-cp-config-');
    const previousStateDir = process.env.RSTACK_STATE_DIR;
    delete process.env.RSTACK_STATE_DIR;
    try {
      assert.deepEqual(await loadProjectCriticalStages(projectRoot), [...DEFAULT_CRITICAL_STAGE_IDS]);

      mkdirSync(join(projectRoot, '.rstack'), { recursive: true });
      writeFileSync(join(projectRoot, '.rstack', 'rstack.config.json'), JSON.stringify({
        checkpoints: { critical_stages: ['07-code', 'not-a-stage', '13-compliance-checker'] },
      }));
      assert.deepEqual(await loadProjectCriticalStages(projectRoot), ['07-code', '13-compliance-checker']);

      writeFileSync(join(projectRoot, '.rstack', 'rstack.config.json'), '{malformed');
      assert.deepEqual(await loadProjectCriticalStages(projectRoot), [...DEFAULT_CRITICAL_STAGE_IDS]);
    } finally {
      if (previousStateDir) process.env.RSTACK_STATE_DIR = previousStateDir;
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});

test('rstack.config.json checkpoints block is validated field-by-field', () => {
  assert.deepEqual(validateRstackConfig({ checkpoints: { critical_stages: ['07-code', '08-testing'] } }), []);

  const notObject = validateRstackConfig({ checkpoints: 'yes' });
  assert.ok(notObject.some((issue) => issue.field === 'checkpoints'));

  const unknownKey = validateRstackConfig({ checkpoints: { criticalStages: ['07-code'] } });
  assert.ok(unknownKey.some((issue) => issue.field === 'checkpoints.criticalStages' && /unknown checkpoint key/.test(issue.problem)));

  const notArray = validateRstackConfig({ checkpoints: { critical_stages: '07-code' } });
  assert.ok(notArray.some((issue) => issue.field === 'checkpoints.critical_stages' && /must be an array/.test(issue.problem)));

  const badEntry = validateRstackConfig({ checkpoints: { critical_stages: ['07-code', '007-code'] } });
  assert.ok(badEntry.some((issue) => issue.field === 'checkpoints.critical_stages' && /not a canonical stage id/.test(issue.problem)));
});

test('verifyStageCheckpoint answers from disk, never on faith', async (t) => {
  const runDir = tempDir('rstack-cp-verify-');

  await t.test('non-canonical stage id is not restorable', () => {
    const verdict = verifyStageCheckpoint(runDir, '007-code');
    assert.equal(verdict.restorable, false);
    assert.equal(verdict.reason, 'invalid_stage');
  });

  await t.test('missing checkpoint directory is not restorable', () => {
    const verdict = verifyStageCheckpoint(runDir, '07-code');
    assert.equal(verdict.restorable, false);
    assert.equal(verdict.reason, 'no_checkpoint');
  });

  await t.test('a file squatting on the checkpoint path is not restorable', () => {
    mkdirSync(join(runDir, 'checkpoints'), { recursive: true });
    writeFileSync(join(runDir, 'checkpoints', '08-testing'), 'not a directory');
    const verdict = verifyStageCheckpoint(runDir, '08-testing');
    assert.equal(verdict.restorable, false);
    assert.equal(verdict.reason, 'not_a_directory');
  });

  await t.test('a real checkpoint directory is restorable', async () => {
    makeStage(runDir, '07-code');
    await saveStageCheckpoint(runDir, '07-code', 'before');
    const verdict = verifyStageCheckpoint(runDir, '07-code');
    assert.equal(verdict.restorable, true);
    assert.equal(verdict.reason, null);
  });

  rmSync(runDir, { recursive: true, force: true });
});

test('saveStageCheckpoint verifies the checkpoint landed and pins the phase', async (t) => {
  const runDir = tempDir('rstack-cp-save-');

  await t.test('phase and stage id are validated', async () => {
    await assert.rejects(() => saveStageCheckpoint(runDir, '07-code', 'during'), /Unknown checkpoint phase/);
    await assert.rejects(() => saveStageCheckpoint(runDir, '007-code', 'before'), /Unknown canonical SDLC stage/);
  });

  await t.test('no stage directory means saved:false — nothing is claimed', async () => {
    const result = await saveStageCheckpoint(runDir, '09-deployment', 'before');
    assert.equal(result.saved, false);
    assert.equal(result.verified, false);
  });

  await t.test('a saved checkpoint is verified on disk and names its event type', async () => {
    makeStage(runDir, '07-code', { 'code_report.json': '{"attempt":1}' });
    const before = await saveStageCheckpoint(runDir, '07-code', 'before');
    assert.equal(before.saved, true);
    assert.equal(before.verified, true);
    assert.equal(before.event_type, 'stage_checkpoint_before_saved');
    assert.ok(existsSync(join(runDir, 'checkpoints', '07-code', 'code_report.json')));

    const after = await saveStageCheckpoint(runDir, '07-code', 'after');
    assert.equal(after.event_type, 'stage_checkpoint_after_saved');
  });

  rmSync(runDir, { recursive: true, force: true });
});

test('checkpoint → mutate → rollback round-trip restores stage artifacts', async (t) => {
  const runDir = tempDir('rstack-cp-roundtrip-');
  const stageDir = makeStage(runDir, '07-code', { 'code_report.json': '{"status":"PASS"}' });

  await t.test('rollback restores the checkpointed content and removes junk', async () => {
    await saveStageCheckpoint(runDir, '07-code', 'before');

    // Mutate: rewrite an artifact AND add a stray file the checkpoint never had.
    writeFileSync(join(stageDir, 'code_report.json'), '{"status":"TAMPERED"}');
    writeFileSync(join(stageDir, 'stray.log'), 'junk from a failed retry');

    const result = await rollbackToCheckpoint(runDir, '07-code');
    assert.equal(result.status, 'SUCCESS');
    assert.equal(readFileSync(join(stageDir, 'code_report.json'), 'utf8'), '{"status":"PASS"}');
    assert.equal(existsSync(join(stageDir, 'stray.log')), false, 'files added after the checkpoint must not survive rollback');
  });

  await t.test('rollback never accepts non-canonical stage ids', async () => {
    const result = await rollbackToCheckpoint(runDir, '007-code');
    assert.equal(result.status, 'INVALID_STAGE');
    assert.match(result.detail, /canonical/);
  });

  await t.test('rollback without a checkpoint reports NO_CHECKPOINT and touches nothing', async () => {
    makeStage(runDir, '08-testing', { 'test_report.json': '{"kept":true}' });
    const result = await rollbackToCheckpoint(runDir, '08-testing');
    assert.equal(result.status, 'NO_CHECKPOINT');
    assert.equal(readFileSync(join(runDir, 'artifacts', 'stages', '08-testing', 'test_report.json'), 'utf8'), '{"kept":true}');
  });

  rmSync(runDir, { recursive: true, force: true });
});

test('corrupt checkpoints fail closed — never restored, live artifacts never touched', async (t) => {
  const LIVE = '{"status":"LIVE"}';

  // Fresh fixture per subtest: a saved + manifest-verified checkpoint whose
  // live stage dir has since moved on, so any restore would be observable.
  async function corruptFixture(stageId) {
    const runDir = tempDir('rstack-cp-corrupt-');
    const stageDir = makeStage(runDir, stageId, { 'artifact.json': '{"status":"GOOD"}' });
    const saved = await saveStageCheckpoint(runDir, stageId, 'after');
    assert.equal(saved.saved, true);
    assert.equal(saved.verified, true);
    writeFileSync(join(stageDir, 'artifact.json'), LIVE);
    return { runDir, stageDir, checkpointDir: join(runDir, 'checkpoints', stageId), manifestPath: join(runDir, 'checkpoints', `${stageId}.manifest.json`) };
  }

  function assertFailedClosed(result, stageDir, reason) {
    assert.equal(result.status, 'CORRUPT');
    assert.equal(result.reason, reason);
    assert.match(result.detail, /nothing was restored/);
    assert.equal(readFileSync(join(stageDir, 'artifact.json'), 'utf8'), LIVE, 'the live stage artifacts must be untouched');
  }

  await t.test('every save stamps a schema-versioned integrity manifest', async () => {
    const { runDir, manifestPath } = await corruptFixture('07-code');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    assert.equal(manifest.schema_version, 1);
    assert.equal(manifest.stage_id, '07-code');
    assert.equal(manifest.phase, 'after');
    assert.equal(manifest.file_count, 1);
    assert.equal(manifest.files[0].path, 'artifact.json');
    assert.match(manifest.files[0].sha256, /^[0-9a-f]{64}$/);
    rmSync(runDir, { recursive: true, force: true });
  });

  await t.test('tampered checkpoint content (same size) is caught by sha-256 and refused', async () => {
    const { runDir, stageDir, checkpointDir } = await corruptFixture('07-code');
    // Same byte length as the checkpointed content — only the hash can tell.
    writeFileSync(join(checkpointDir, 'artifact.json'), '{"status":"EVIL"}');
    const verdict = verifyStageCheckpoint(runDir, '07-code', { deep: true });
    assert.equal(verdict.restorable, false);
    assert.equal(verdict.reason, 'corrupt_content');
    assertFailedClosed(await rollbackToCheckpoint(runDir, '07-code'), stageDir, 'corrupt_content');
    rmSync(runDir, { recursive: true, force: true });
  });

  await t.test('a checkpoint file missing against the manifest is refused', async () => {
    const { runDir, stageDir, checkpointDir } = await corruptFixture('08-testing');
    rmSync(join(checkpointDir, 'artifact.json'));
    assertFailedClosed(await rollbackToCheckpoint(runDir, '08-testing'), stageDir, 'corrupt_file_set');
    rmSync(runDir, { recursive: true, force: true });
  });

  await t.test('an extra file smuggled into the checkpoint is refused', async () => {
    const { runDir, stageDir, checkpointDir } = await corruptFixture('06-architecture');
    writeFileSync(join(checkpointDir, 'smuggled.json'), '{"payload":true}');
    assertFailedClosed(await rollbackToCheckpoint(runDir, '06-architecture'), stageDir, 'corrupt_file_set');
    rmSync(runDir, { recursive: true, force: true });
  });

  await t.test('an unparseable manifest is refused', async () => {
    const { runDir, stageDir, manifestPath } = await corruptFixture('09-deployment');
    writeFileSync(manifestPath, '{truncated');
    assertFailedClosed(await rollbackToCheckpoint(runDir, '09-deployment'), stageDir, 'corrupt_manifest');
    rmSync(runDir, { recursive: true, force: true });
  });

  await t.test('an unknown manifest schema_version is refused — no guessing at future semantics', async () => {
    const { runDir, stageDir, manifestPath } = await corruptFixture('12-security-threat-model');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.schema_version = 99;
    writeFileSync(manifestPath, JSON.stringify(manifest));
    assertFailedClosed(await rollbackToCheckpoint(runDir, '12-security-threat-model'), stageDir, 'corrupt_manifest');
    rmSync(runDir, { recursive: true, force: true });
  });

  await t.test('a corrupt slot is repaired by the next successful save', async () => {
    const { runDir, stageDir, checkpointDir } = await corruptFixture('07-code');
    writeFileSync(join(checkpointDir, 'smuggled.json'), '{"payload":true}');
    assert.equal((await rollbackToCheckpoint(runDir, '07-code')).status, 'CORRUPT');
    // The next claim/PASS overwrites the slot and re-stamps the manifest.
    const saved = await saveStageCheckpoint(runDir, '07-code', 'before');
    assert.equal(saved.verified, true);
    writeFileSync(join(stageDir, 'artifact.json'), '{"status":"TAMPERED"}');
    const result = await rollbackToCheckpoint(runDir, '07-code');
    assert.equal(result.status, 'SUCCESS');
    assert.equal(readFileSync(join(stageDir, 'artifact.json'), 'utf8'), LIVE);
    rmSync(runDir, { recursive: true, force: true });
  });

  await t.test('pre-manifest legacy checkpoints stay restorable but are honestly unverified', async () => {
    const runDir = tempDir('rstack-cp-legacy-');
    const stageDir = makeStage(runDir, '07-code', { 'artifact.json': '{"era":"legacy"}' });
    // The legacy API (pre-#132) copies the directory without a manifest.
    await createStageCheckpoint(runDir, '07-code');
    const verdict = verifyStageCheckpoint(runDir, '07-code', { deep: true });
    assert.equal(verdict.restorable, true);
    assert.equal(verdict.verified, false);
    assert.equal(verdict.reason, 'legacy_unverified');

    writeFileSync(join(stageDir, 'artifact.json'), '{"era":"tampered"}');
    const result = await rollbackToCheckpoint(runDir, '07-code');
    assert.equal(result.status, 'SUCCESS');
    assert.equal(result.verified, false, 'a legacy restore must not claim verified integrity');
    assert.equal(readFileSync(join(stageDir, 'artifact.json'), 'utf8'), '{"era":"legacy"}');
    rmSync(runDir, { recursive: true, force: true });
  });
});

test('checkpoints survive and compose with loop-iteration stage resets (BLE-4)', async () => {
  const projectRoot = tempDir('rstack-cp-loop-');
  const previousStateDir = process.env.RSTACK_STATE_DIR;
  delete process.env.RSTACK_STATE_DIR;
  const runId = 'run-loop-cp';
  const runDir = join(projectRoot, '.rstack', 'runs', runId);
  try {
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, 'tasks.json'), JSON.stringify({
      tasks: [{ id: '004-implementation', status: 'PASS', stage_artifacts: [{ stage_id: '07-code' }] }],
    }, null, 2));
    const stageDir = makeStage(runDir, '07-code', { 'code_report.json': '{"iteration":1}' });
    const saved = await saveStageCheckpoint(runDir, '07-code', 'after', { taskId: '004-implementation' });
    assert.equal(saved.verified, true);

    // The goal loop decides to rerun 07-code: in-lock stage reset (#129).
    const resetIds = await resetStagesForRetry(projectRoot, runId, ['07-code']);
    assert.deepEqual(resetIds, ['004-implementation']);
    assert.equal(JSON.parse(readFileSync(join(runDir, 'tasks.json'), 'utf8')).tasks[0].status, 'PENDING');

    // The reset must not orphan or corrupt the checkpoint slot: it resets
    // task statuses, never checkpoint state.
    const verdict = verifyStageCheckpoint(runDir, '07-code', { deep: true });
    assert.equal(verdict.restorable, true);
    assert.equal(verdict.verified, true);

    // Next iteration re-claims the task: the fresh 'before' save snapshots
    // the state this attempt starts from, re-stamping the manifest.
    writeFileSync(join(stageDir, 'code_report.json'), '{"iteration":2}');
    const before = await saveStageCheckpoint(runDir, '07-code', 'before', { taskId: '004-implementation' });
    assert.equal(before.verified, true);
    const manifest = JSON.parse(readFileSync(join(runDir, 'checkpoints', '07-code.manifest.json'), 'utf8'));
    assert.equal(manifest.phase, 'before');
    assert.equal(manifest.task_id, '004-implementation');

    // The iteration's builder wrecks the artifacts; rollback restores the
    // pre-attempt state — exactly the restore point BLE-4 retries rely on.
    writeFileSync(join(stageDir, 'code_report.json'), '{"iteration":"BROKEN"}');
    const result = await rollbackToCheckpoint(runDir, '07-code');
    assert.equal(result.status, 'SUCCESS');
    assert.equal(result.verified, true);
    assert.equal(readFileSync(join(stageDir, 'code_report.json'), 'utf8'), '{"iteration":2}');
  } finally {
    if (previousStateDir) process.env.RSTACK_STATE_DIR = previousStateDir;
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('pipeline-state rollup counts pinned checkpoint events and verifies restorability on disk', async () => {
  const projectRoot = tempDir('rstack-cp-rollup-');
  const previousStateDir = process.env.RSTACK_STATE_DIR;
  delete process.env.RSTACK_STATE_DIR;
  const runId = 'run-cp-rollup';
  const runDir = join(projectRoot, '.rstack', 'runs', runId);
  try {
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, 'manifest.json'), JSON.stringify({ run_id: runId, goal: 'Checkpoint rollup', status: 'RUNNING' }));
    writeFileSync(join(runDir, 'tasks.json'), JSON.stringify({
      tasks: [{ id: '004-implementation', status: 'PASS', stage_artifacts: [{ stage_id: '07-code' }] }],
    }));
    makeStage(runDir, '07-code', { 'code_report.json': '{"v":1}' });
    await saveStageCheckpoint(runDir, '07-code', 'before');
    writeFileSync(join(runDir, 'events.jsonl'), [
      { type: 'stage_checkpoint_before_saved', stage_id: '07-code', task_id: '004-implementation', verified: true },
      { type: 'stage_checkpoint_after_saved', stage_id: '07-code', task_id: '004-implementation', verified: true },
      { type: 'stage_checkpoint_reverted', stage_id: '07-code' },
      // Legacy all-stages event: existing consumers key on it, but the pinned
      // checkpoint rollup must not count it.
      { type: 'stage_checkpoint_saved', stage_id: '07-code', task_id: '004-implementation' },
    ].map((event) => JSON.stringify(event)).join('\n') + '\n');

    const state = await buildPipelineState(projectRoot, runId);
    assert.deepEqual(state.checkpoints, { total: 3, before_saved: 1, after_saved: 1, reverted: 1 });

    const codeStage = state.stages.find((stage) => stage.id === '07-code');
    assert.equal(codeStage.checkpoint_restorable, true, 'the checkpointed stage is restorable — verified on disk');
    const testingStage = state.stages.find((stage) => stage.id === '08-testing');
    assert.equal(testingStage.checkpoint_restorable, false, 'stages without a checkpoint directory never claim restorability');

    const text = formatPipelineStatus(state);
    assert.match(text, /Checkpoints: 1 before \/ 1 after \/ 1 reverted/);
    assert.match(text, /restorable stages: 07-code/);
  } finally {
    if (previousStateDir) process.env.RSTACK_STATE_DIR = previousStateDir;
    rmSync(projectRoot, { recursive: true, force: true });
  }
});
