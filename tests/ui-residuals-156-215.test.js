/**
 * #156/#215 residuals: per-stage checkpoint restore-point status (with the
 * CORRUPT distinction) flowing harness → rollup → index → client, manifest
 * schema_version surfaced through the index, and the CONSUMED lifecycle on
 * one-shot guardrail-override approval cards.
 *
 * owner: RStack developed by Richardson Gunde
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildPipelineState } from '../src/core/harness/pipeline-state.js';
import { saveStageCheckpoint } from '../src/core/harness/checkpoints.js';
import { compactPipelineRollup } from '../src/observability/dashboard/state/pipeline-rollup.js';
import { annotateApprovalLifecycle } from '../src/observability/dashboard/state/approvals.js';
import { entryFromRun, liteRunFromEntry } from '../src/observability/dashboard/state/rollup-index.js';
import { buildFullState } from '../src/observability/dashboard/state/index.js';
import { diagnosticsScript } from '../src/observability/dashboard/ui/pages/diagnostics.js';
import { approvalsScript } from '../src/observability/dashboard/ui/pages/approvals.js';

async function writeJson(filePath, value) {
  await writeFile(filePath, JSON.stringify(value, null, 2));
}

test('pipeline state carries checkpoint_reason — CORRUPT is distinguishable from no-checkpoint', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-cpreason-'));
  try {
    const runId = '2026-07-12T00-00-00-cp';
    const runDir = join(projectRoot, '.rstack', 'runs', runId);
    const stageDir = join(runDir, 'artifacts', 'stages', '07-code');
    await mkdir(stageDir, { recursive: true });
    await writeJson(join(runDir, 'manifest.json'), { run_id: runId, goal: 'cp fixture', created_at: '2026-07-12T00:00:00.000Z' });
    await writeJson(join(runDir, 'tasks.json'), { tasks: [] });
    await writeJson(join(stageDir, 'code_report.json'), { stage: '07-code', ok: true });

    const saved = await saveStageCheckpoint(runDir, '07-code', 'before');
    assert.ok(saved.saved && saved.verified, 'fixture checkpoint saved and verified');

    let state = await buildPipelineState(projectRoot, runId);
    const codeStage = state.stages.find((stage) => stage.id === '07-code');
    const untouched = state.stages.find((stage) => stage.id === '08-testing');
    assert.equal(codeStage.checkpoint_restorable, true);
    assert.equal(codeStage.checkpoint_reason, null);
    assert.equal(untouched.checkpoint_restorable, false);
    assert.equal(untouched.checkpoint_reason, 'no_checkpoint');

    // Corrupt the checkpoint (a file the manifest never inventoried) — the
    // deep verify must now say WHY restore is refused, not just false.
    await writeFile(join(runDir, 'checkpoints', '07-code', 'injected.txt'), 'tampered');
    state = await buildPipelineState(projectRoot, runId);
    const corrupt = state.stages.find((stage) => stage.id === '07-code');
    assert.equal(corrupt.checkpoint_restorable, false);
    assert.ok(String(corrupt.checkpoint_reason).startsWith('corrupt'), `expected corrupt_* reason, got ${corrupt.checkpoint_reason}`);
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('compactPipelineRollup exposes per-stage checkpoint status, omitting silent no-checkpoint stages', () => {
  const rollup = compactPipelineRollup({
    schema_version: 1,
    pipeline: { status: 'RUNNING', stages_total: 4, stages_passed: 1, stages_failed: 0 },
    stages: [
      { id: '06-architecture', status: 'PASS', checkpoint_restorable: true, checkpoint_reason: 'legacy_unverified' },
      { id: '07-code', status: 'PASS', checkpoint_restorable: true, checkpoint_reason: null },
      { id: '08-testing', status: 'PENDING', checkpoint_restorable: false, checkpoint_reason: 'no_checkpoint' },
      { id: '09-deployment', status: 'PENDING', checkpoint_restorable: false, checkpoint_reason: 'corrupt_content' },
    ],
    approval_blockers: [],
    checkpoints: { total: 2, before_saved: 2, after_saved: 0, reverted: 0 },
  }, []);
  assert.deepEqual(rollup.checkpoints.stages, [
    { id: '06-architecture', restorable: true, reason: 'legacy_unverified' },
    { id: '07-code', restorable: true, reason: null },
    { id: '09-deployment', restorable: false, reason: 'corrupt_content' },
  ]);
  assert.equal(rollup.checkpoints.total, 2, 'counts preserved alongside the per-stage list');
});

test('annotateApprovalLifecycle marks spent overrides consumed from run-level history', () => {
  const queue = [
    { id: 'q1', artifact: 'guardrail-override:004-implementation', status: 'approved', runId: 'run-a' },
    { id: 'q2', artifact: 'plan.md', status: 'approved', runId: 'run-a' },
    { id: 'q3', artifact: 'guardrail-override:004-implementation', status: 'approved', runId: 'run-b' },
    { id: 'q4', artifact: null, status: 'pending' },
  ];
  const runs = [
    {
      runId: 'run-a',
      approvals: [
        { artifact: 'guardrail-override:004-implementation', status: 'APPROVED', timestamp: '2026-07-12T01:00:00Z' },
        { artifact: 'guardrail-override:004-implementation', status: 'CONSUMED', timestamp: '2026-07-12T02:00:00Z' },
        { artifact: 'plan.md', status: 'APPROVED', timestamp: '2026-07-12T01:00:00Z' },
      ],
    },
    { runId: 'run-b', approvals: [{ artifact: 'guardrail-override:004-implementation', status: 'APPROVED', timestamp: '2026-07-12T01:00:00Z' }] },
  ];
  const annotated = annotateApprovalLifecycle(queue, runs);
  assert.equal(annotated[0].lifecycle, 'consumed', 'spent override marked consumed');
  assert.equal(annotated[0].consumedAt, '2026-07-12T02:00:00Z');
  assert.equal(annotated[1].lifecycle, undefined, 'standing approval untouched');
  assert.equal(annotated[2].lifecycle, undefined, 'same artifact on another run untouched');
  assert.equal(annotated[3].lifecycle, undefined, 'malformed queue entry tolerated');
  // Hostile shapes never throw.
  assert.deepEqual(annotateApprovalLifecycle(null, null), []);
});

test('manifest schema_version survives the index round-trip', () => {
  const run = {
    runId: 'run-schema',
    projectRoot: '/tmp/x',
    manifest: { run_id: 'run-schema', goal: 'g', created_at: '2026-07-12T00:00:00Z', schema_version: 2 },
    tasks: [],
    events: [],
    approvals: [],
    pipelineRollup: { checkpoints: { total: 0, stages: [] } },
  };
  const entry = entryFromRun(run);
  assert.equal(entry.schema_version, 2);
  const lite = liteRunFromEntry('/tmp/x', entry);
  assert.equal(lite.manifest.schema_version, 2, 'index-served manifest keeps schema_version');
  assert.deepEqual(lite.pipelineRollup.checkpoints, { total: 0, stages: [] }, 'rollup checkpoint block rides the persisted rollup');
  // Legacy manifests (no stamp) stay honestly null — the UI renders that as v1 legacy.
  const legacy = entryFromRun({ ...run, manifest: { ...run.manifest, schema_version: undefined } });
  assert.equal(legacy.schema_version, null);
});

test('buildFullState annotates a consumed override end-to-end and projects run diagnostics fields', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-156-e2e-'));
  try {
    const runId = '2026-07-12T00-00-00-e2e';
    const runDir = join(projectRoot, '.rstack', 'runs', runId);
    await mkdir(runDir, { recursive: true });
    await writeJson(join(runDir, 'manifest.json'), { schema_version: 2, run_id: runId, goal: 'lifecycle fixture', created_at: '2026-07-12T00:00:00.000Z' });
    await writeJson(join(runDir, 'tasks.json'), { tasks: [{ id: '004-implementation', title: 'Implementation', status: 'IN_PROGRESS' }] });
    await writeJson(join(runDir, 'approvals.json'), [
      { id: 'a1', artifact: 'guardrail-override:004-implementation', status: 'APPROVED', approver: 'Lead Lena', timestamp: '2026-07-12T01:00:00.000Z', run_id: runId },
      { id: 'a2', artifact: 'guardrail-override:004-implementation', status: 'CONSUMED', approver: 'rstack-harness', timestamp: '2026-07-12T02:00:00.000Z', run_id: runId },
    ]);
    await appendFile(join(projectRoot, '.rstack', 'approvals.jsonl'), `${JSON.stringify({
      id: 'q-1', title: 'Override guardrail for 004-implementation', status: 'approved',
      artifact: 'guardrail-override:004-implementation', runId, taskId: '004-implementation', ts: '2026-07-12T00:59:00.000Z',
    })}\n`);

    const state = await buildFullState(projectRoot);
    const card = state.approvals.find((item) => item.artifact === 'guardrail-override:004-implementation');
    assert.ok(card, 'queue card present');
    assert.equal(card.lifecycle, 'consumed', 'server-owned lifecycle says consumed');
    assert.equal(card.consumedAt, '2026-07-12T02:00:00.000Z');

    const run = state.runs.find((candidate) => candidate.runId === runId);
    assert.ok(run.pipelineRollup, 'rollup attached');
    assert.ok(Array.isArray(run.pipelineRollup.checkpoints.stages), 'per-stage checkpoint status served');
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('page scripts render the new surfaces', () => {
  assert.ok(diagnosticsScript.includes('renderDiagnosticsRuns'), 'diagnostics renders the run-data panel');
  assert.ok(diagnosticsScript.includes('diagnostics-runs'), 'diagnostics targets the panel container');
  assert.ok(diagnosticsScript.includes('CORRUPT'), 'corrupt checkpoints get the honest badge');
  assert.ok(diagnosticsScript.includes('v1 legacy'), 'unstamped manifests read as v1 legacy');
  assert.ok(approvalsScript.includes("lifecycle === 'consumed'"), 'approval card consumes the server lifecycle');
  assert.ok(approvalsScript.includes('Override consumed'), 'consumed override explains itself');
});
