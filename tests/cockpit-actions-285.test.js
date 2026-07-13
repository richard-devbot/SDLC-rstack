/**
 * Cockpit controls — pure contract + ledger (#285).
 *
 * Covers the harness module (feature flag, eligibility, idempotency-key shape,
 * artifact naming, the append-only idempotency/audit ledger) and the
 * server-owned projection (only server-declared actions, fail-closed when the
 * feature is off or the snapshot is stale).
 *
 * owner: RStack developed by Richardson Gunde
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  COCKPIT_ACTION_TYPES,
  cockpitControlsEnabled,
  cockpitControlsEnabledFromEnv,
  isKnownCockpitAction,
  isValidIdempotencyKey,
  checkpointRestoreArtifact,
  isCanonicalStageId,
  evaluateResumeEligibility,
  evaluateCheckpointEligibility,
  claimIdempotencyKey,
  completeLedgerEntry,
  summarizeLedgerForKey,
  COCKPIT_LEDGER_FILE,
} from '../src/core/harness/cockpit-actions.js';
import { isSafeArtifactName } from '../src/core/harness/approval-audit.js';
import { buildCockpitProjection } from '../src/observability/dashboard/state/cockpit.js';

// ── Feature flag: OFF by default, fails closed ──────────────────────────────

test('feature flag is OFF by default and enabled by env OR policy', () => {
  assert.equal(cockpitControlsEnabledFromEnv({}), false);
  assert.equal(cockpitControlsEnabled({}, {}), false);
  assert.equal(cockpitControlsEnabled(null, {}), false);
  assert.equal(cockpitControlsEnabled({ cockpit_controls: {} }, {}), false);
  assert.equal(cockpitControlsEnabled({ cockpit_controls: { enabled: false } }, {}), false);
  // env enables globally
  assert.equal(cockpitControlsEnabledFromEnv({ RSTACK_COCKPIT_CONTROLS: '1' }), true);
  assert.equal(cockpitControlsEnabled({}, { RSTACK_COCKPIT_CONTROLS: 'true' }), true);
  // policy enables per-project
  assert.equal(cockpitControlsEnabled({ cockpit_controls: { enabled: true } }, {}), true);
  // a truthy-looking non-boolean does NOT enable via policy (only literal true)
  assert.equal(cockpitControlsEnabled({ cockpit_controls: { enabled: 'yes' } }, {}), false);
});

test('known actions and idempotency-key / artifact / stage validators', () => {
  assert.ok(isKnownCockpitAction('resume-run'));
  assert.ok(isKnownCockpitAction('restore-checkpoint'));
  assert.ok(!isKnownCockpitAction('start-run'));
  assert.ok(!isKnownCockpitAction('rm -rf'));

  assert.ok(isValidIdempotencyKey('abc12345'));
  assert.ok(isValidIdempotencyKey('run-2026:resume:01HZ.abc-1'));
  assert.ok(!isValidIdempotencyKey('short'));            // < 8
  assert.ok(!isValidIdempotencyKey('has space here'));
  assert.ok(!isValidIdempotencyKey('has/slash/xxxx'));
  assert.ok(!isValidIdempotencyKey('../traversal-key'));
  assert.ok(!isValidIdempotencyKey('x'.repeat(200)));
  assert.ok(!isValidIdempotencyKey(42));

  // The restore artifact never contains a path separator, so it always passes
  // the canonical artifact validator the gate uses.
  const artifact = checkpointRestoreArtifact('run-2026-07-13', '06-architecture');
  assert.equal(artifact, 'destructive-action:checkpoint-restore:run-2026-07-13:06-architecture');
  assert.ok(isSafeArtifactName(artifact));

  assert.ok(isCanonicalStageId('06-architecture'));
  assert.ok(!isCanonicalStageId('007-code'));   // plan task id, NOT a stage id
  assert.ok(!isCanonicalStageId('../etc'));
});

// ── Eligibility (pure) ──────────────────────────────────────────────────────

test('resume eligibility mirrors the rollup next_action.kind, fails closed', () => {
  for (const kind of ['active', 'pending', 'retry', 'failed']) {
    assert.equal(evaluateResumeEligibility({ next_action: { kind } }).eligible, true, kind);
  }
  for (const kind of ['approval', 'guardrail_blocked', 'complete', 'unknown']) {
    const elig = evaluateResumeEligibility({ next_action: { kind } });
    assert.equal(elig.eligible, false, kind);
    assert.ok(elig.reason, `${kind} carries a reason`);
  }
  // no rollup, or a stale rollup, is never eligible
  assert.equal(evaluateResumeEligibility(null).eligible, false);
  assert.equal(evaluateResumeEligibility({ stale: true, next_action: { kind: 'pending' } }).eligible, false);
});

test('checkpoint eligibility: restorable=true only; corrupt/legacy disabled with reason', () => {
  assert.equal(evaluateCheckpointEligibility({ id: '07-code', restorable: true }).eligible, true);
  const corrupt = evaluateCheckpointEligibility({ id: '07-code', restorable: false, reason: 'corrupt_hash_mismatch' });
  assert.equal(corrupt.eligible, false);
  assert.match(corrupt.reason, /sha-256|refused/i);
  const legacy = evaluateCheckpointEligibility({ id: '07-code', restorable: false, reason: 'legacy_unverified' });
  assert.equal(legacy.eligible, false);
  // stale run disables even a restorable checkpoint
  assert.equal(evaluateCheckpointEligibility({ id: '07-code', restorable: true }, { stale: true }).eligible, false);
});

// ── Projection: server declares, fails closed ──────────────────────────────

const RUN = {
  runId: 'run-285', projectRoot: '/tmp/proj', project: { id: 'proj' },
  pipelineRollup: {
    stale: false,
    next_action: { kind: 'pending' },
    checkpoints: { stages: [
      { id: '07-code', restorable: true, reason: null },
      { id: '06-architecture', restorable: false, reason: 'corrupt_hash_mismatch' },
    ] },
  },
};

test('projection is empty and enabled:false when the feature is disabled', () => {
  const projection = buildCockpitProjection({ runs: [RUN] }, { enabled: false, enabledRoots: new Set() });
  assert.equal(projection.enabled, false);
  assert.deepEqual(projection.runs, []);
  assert.match(projection.reason, /OFF/);
});

test('projection declares resume + per-checkpoint restore, enabled/disabled with reasons', () => {
  const projection = buildCockpitProjection({ runs: [RUN] }, { enabled: true });
  assert.equal(projection.enabled, true);
  assert.equal(projection.runs.length, 1);
  const actions = projection.runs[0].allowedActions;
  const resume = actions.find((a) => a.type === COCKPIT_ACTION_TYPES.RESUME_RUN);
  assert.ok(resume);
  assert.equal(resume.enabled, true);
  assert.equal(resume.requiresApproval, false);
  assert.equal(resume.risk, 'low');
  assert.equal(resume.target.runId, 'run-285');
  assert.ok(resume.confirm.consequence.includes('stopping at every human gate'));

  const restores = actions.filter((a) => a.type === COCKPIT_ACTION_TYPES.RESTORE_CHECKPOINT);
  assert.equal(restores.length, 2);
  const good = restores.find((a) => a.target.stageId === '07-code');
  assert.equal(good.enabled, true);
  assert.equal(good.requiresApproval, true);
  assert.equal(good.risk, 'high');
  const bad = restores.find((a) => a.target.stageId === '06-architecture');
  assert.equal(bad.enabled, false);
  assert.ok(bad.disabledReason);
});

test('projection disables every action of a stale run (fail closed)', () => {
  const staleRun = { ...RUN, pipelineRollup: { ...RUN.pipelineRollup, stale: true } };
  const projection = buildCockpitProjection({ runs: [staleRun] }, { enabled: true });
  const actions = projection.runs[0].allowedActions;
  assert.ok(actions.every((a) => a.enabled === false), 'no action is enabled on a stale run');
  assert.ok(actions.every((a) => /stale/.test(a.disabledReason)));
});

test('projection only surfaces runs whose root opted in (per-root policy)', () => {
  const projection = buildCockpitProjection({ runs: [RUN] }, { enabled: false, enabledRoots: new Set(['/tmp/proj']) });
  assert.equal(projection.enabled, true);
  assert.equal(projection.runs.length, 1);
  const none = buildCockpitProjection({ runs: [RUN] }, { enabled: false, enabledRoots: new Set(['/other']) });
  assert.equal(none.runs.length, 0);
});

// ── Idempotency ledger + audit trail (disk) ─────────────────────────────────

function tmpRoot() {
  return mkdtempSync(join(tmpdir(), 'rstack-cockpit-'));
}

test('idempotency ledger: fresh → in_progress → completed replay', async () => {
  const root = tmpRoot();
  try {
    const key = 'idem-key-0001';
    const meta = { action: 'resume-run', runId: 'run-1', actor: 'rich' };
    // First claim is fresh (records a `started` entry).
    assert.equal((await claimIdempotencyKey(root, key, meta)).status, 'fresh');
    // A second claim BEFORE completion is a duplicate in-flight request.
    assert.equal((await claimIdempotencyKey(root, key, meta)).status, 'in_progress');
    // Record completion with a stored result.
    await completeLedgerEntry(root, key, { phase: 'completed', meta, result: { ok: true, x: 1 }, outcome: 'accepted' });
    // A later claim replays the stored result without re-executing.
    const replay = await claimIdempotencyKey(root, key, meta);
    assert.equal(replay.status, 'completed');
    assert.deepEqual(replay.result, { ok: true, x: 1 });

    // The ledger is append-only: started + completed lines both present.
    const path = join(root, COCKPIT_LEDGER_FILE);
    assert.ok(existsSync(path));
    const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    assert.deepEqual(lines.map((l) => l.phase), ['started', 'completed']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a FAILED key can be retried (fresh again); a completed key cannot', async () => {
  const root = tmpRoot();
  try {
    const meta = { action: 'restore-checkpoint', runId: 'run-1', stageId: '07-code', actor: 'rich' };
    const key = 'idem-key-retry-01';
    assert.equal((await claimIdempotencyKey(root, key, meta)).status, 'fresh');
    await completeLedgerEntry(root, key, { phase: 'failed', meta, outcome: 'approval_required', detail: 'needs approval' });
    // After a failed terminal, the same key is claimable again (operator retries
    // after approving).
    assert.equal((await claimIdempotencyKey(root, key, meta)).status, 'fresh');
    await completeLedgerEntry(root, key, { phase: 'completed', meta, result: { ok: true }, outcome: 'accepted' });
    assert.equal((await claimIdempotencyKey(root, key, meta)).status, 'completed');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('summarizeLedgerForKey isolates entries by key', () => {
  const entries = [
    { idempotencyKey: 'a', phase: 'started', ts: '1' },
    { idempotencyKey: 'b', phase: 'started', ts: '2' },
    { idempotencyKey: 'a', phase: 'completed', ts: '3', result: { ok: true } },
  ];
  const a = summarizeLedgerForKey(entries, 'a');
  assert.ok(a.completed);
  assert.equal(a.inProgress, false);
  const b = summarizeLedgerForKey(entries, 'b');
  assert.equal(b.completed, null);
  assert.equal(b.inProgress, true);
});
