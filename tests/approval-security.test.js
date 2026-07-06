/**
 * Security regression tests for the approval gate (issue #54):
 *   1. approval-id path traversal cannot write outside .rstack/runs
 *   2. manager identity / unsafe queue entries are rejected
 *
 * owner: RStack developed by Richardson Gunde
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  isSafeRunId,
  parseApprovalQueueId,
  approvalQueueId,
  appendRunApproval,
  resolveApproval,
} from '../src/core/tracker/approvals.js';

function realRun(projectRoot, runId) {
  mkdirSync(join(projectRoot, '.rstack', 'runs', runId), { recursive: true });
  writeFileSync(join(projectRoot, '.rstack', 'runs', runId, 'manifest.json'), JSON.stringify({ run_id: runId }));
}

test('isSafeRunId rejects traversal and separators', () => {
  assert.equal(isSafeRunId('2026-06-02T05-35-04-500Z-build-thing'), true);
  assert.equal(isSafeRunId('../../etc'), false);
  assert.equal(isSafeRunId('a/b'), false);
  assert.equal(isSafeRunId('..'), false);
  assert.equal(isSafeRunId(''), false);
  assert.equal(isSafeRunId(null), false);
});

test('parseApprovalQueueId rejects ids that decode to a traversal runId', () => {
  const evil = 'gate:' + encodeURIComponent('../../../../tmp/evil') + '::' + encodeURIComponent('plan.md');
  assert.equal(parseApprovalQueueId(evil), null);
  const evilArtifact = 'gate:' + encodeURIComponent('run-1') + '::' + encodeURIComponent('../../escape');
  assert.equal(parseApprovalQueueId(evilArtifact), null);
  // A legitimate id still round-trips.
  const good = approvalQueueId({ runId: 'run-1', taskId: '004-impl', artifact: 'plan.md' });
  assert.deepEqual(parseApprovalQueueId(good), { runId: 'run-1', taskId: '004-impl', artifact: 'plan.md' });
});

test('appendRunApproval refuses to write outside .rstack/runs', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-sec-'));
  const outside = mkdtempSync(join(tmpdir(), 'rstack-outside-'));
  const traversal = '..' + '/'.repeat(1) + '..' + '/' + outside.split('/').pop();

  const result = await appendRunApproval(projectRoot, traversal, { artifact: 'plan.md', status: 'APPROVED', approver: 'x' });
  assert.equal(result, null, 'unsafe runId writes nothing');
  // Nothing landed in the sibling temp dir.
  assert.equal(existsSync(join(outside, 'approvals.json')), false);

  // A real run still works. Dashboard-sourced records (the default source)
  // must carry token-verified actor evidence to pass the #133 write audit.
  realRun(projectRoot, 'good-run');
  const ok = await appendRunApproval(projectRoot, 'good-run', {
    artifact: 'plan.md', status: 'APPROVED', approver: 'x',
    actor: { name: 'x', via: 'dashboard', tokenVerified: true },
  });
  assert.ok(ok && existsSync(join(projectRoot, '.rstack', 'runs', 'good-run', 'approvals.json')));

  rmSync(projectRoot, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

test('resolveApproval rejects a traversal gate id and requires a real run', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-sec-'));
  const evil = approvalQueueId({ runId: '../../../../tmp/pwn', taskId: 't', artifact: 'plan.md' });
  assert.equal(await resolveApproval(projectRoot, evil, 'approved', 'Manager'), false, 'traversal id refused');

  // Safe shape but no such run (no manifest) → refused, no file created.
  const ghost = approvalQueueId({ runId: 'ghost-run', taskId: 't', artifact: 'plan.md' });
  assert.equal(await resolveApproval(projectRoot, ghost, 'approved', 'Manager'), false);
  assert.equal(existsSync(join(projectRoot, '.rstack', 'runs', 'ghost-run')), false);
  rmSync(projectRoot, { recursive: true, force: true });
});

test('manager allow-list blocks names outside policy', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-sec-'));
  realRun(projectRoot, 'run-x');
  mkdirSync(join(projectRoot, '.rstack'), { recursive: true });
  writeFileSync(join(projectRoot, '.rstack', 'policy.json'), JSON.stringify({ managers: ['Maya'] }));
  const id = approvalQueueId({ runId: 'run-x', taskId: 't', artifact: 'plan.md' });

  await assert.rejects(
    () => resolveApproval(projectRoot, id, 'approved', 'Imposter', { env: {} }),
    /not allowed by manager policy/,
  );
  // The configured manager succeeds and records token-verified actor evidence.
  const ok = await resolveApproval(projectRoot, id, 'approved', 'Maya', {
    env: {}, skipRunWrite: true, actor: { name: 'Maya', via: 'dashboard', tokenVerified: true, ts: 'now' },
  });
  assert.equal(ok, true);
  rmSync(projectRoot, { recursive: true, force: true });
});
