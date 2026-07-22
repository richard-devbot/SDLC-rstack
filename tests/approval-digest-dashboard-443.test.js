/**
 * Dashboard approval content binding (#443): the Business Hub approve path
 * (resolveApproval → appendRunApproval) must capture the SHA-256 of the exact
 * artifact bytes the reviewer signed off — until now only the bridge's
 * sdlc_approve did, so a UI approval was content-unbound and an
 * approve-then-mutate (VULN-1 TOCTOU) stayed green. With the digest captured,
 * the claim gate's invalidateApprovalsWithChangedArtifact re-blocks on change.
 *
 * owner: RStack developed by Richardson Gunde
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { approvalQueueId, resolveApproval } from '../src/core/tracker/approvals.js';
import { computeApprovalArtifactDigest } from '../src/core/harness/approval-audit.js';

function seedRun(runId) {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-approval-digest-dash-'));
  const runDir = join(projectRoot, '.rstack', 'runs', runId);
  mkdirSync(join(runDir, 'specs'), { recursive: true });
  writeFileSync(join(runDir, 'manifest.json'), JSON.stringify({ run_id: runId }));
  return { projectRoot, runDir };
}

function readRunApprovals(runDir) {
  return JSON.parse(readFileSync(join(runDir, 'approvals.json'), 'utf8'));
}

const sha256 = (text) => createHash('sha256').update(Buffer.from(text)).digest('hex');

test('dashboard approve binds the artifact digest; a later edit no longer matches (VULN-1)', async (t) => {
  const runId = '2026-07-22T00-00-00-000Z-digest';
  const { projectRoot, runDir } = seedRun(runId);
  t.after(() => rmSync(projectRoot, { recursive: true, force: true }));

  const specPath = join(runDir, 'specs', 'plan.md');
  writeFileSync(specPath, '# Plan v1\nApproved content.\n');
  const approvedBytes = readFileSync(specPath, 'utf8');

  const id = approvalQueueId({ runId, taskId: '07-code', artifact: 'plan.md' });
  const ok = await resolveApproval(projectRoot, id, 'approved', 'Maya', { env: {}, actor: { name: 'Maya', via: 'dashboard', tokenVerified: true, ts: new Date().toISOString() } });
  assert.equal(ok, true, 'dashboard approval resolves');

  const [record] = readRunApprovals(runDir).filter((r) => r.artifact === 'plan.md' && r.status === 'APPROVED');
  assert.ok(record, 'an APPROVED run record was written');
  assert.equal(record.artifact_sha256, sha256(approvedBytes), 'the approval is bound to the approved bytes');
  // The gate re-check (invalidateApprovalsWithChangedArtifact) keys on exactly this comparison.
  assert.equal(computeApprovalArtifactDigest(runDir, 'plan.md'), record.artifact_sha256, 'digest matches while unchanged');

  // The agent mutates the artifact after sign-off (the TOCTOU attack).
  writeFileSync(specPath, '# Plan v2\nMALICIOUS swapped content.\n');
  assert.notEqual(
    computeApprovalArtifactDigest(runDir, 'plan.md'),
    record.artifact_sha256,
    'after the edit, the current digest no longer matches the approved digest — the gate re-blocks',
  );
});

test('a non-file-backed (virtual) approval carries no digest', async (t) => {
  const runId = '2026-07-22T00-00-01-000Z-virtual';
  const { projectRoot, runDir } = seedRun(runId);
  t.after(() => rmSync(projectRoot, { recursive: true, force: true }));

  const artifact = 'guardrail-override:07-code';
  const id = approvalQueueId({ runId, taskId: '07-code', artifact });
  const ok = await resolveApproval(projectRoot, id, 'approved', 'Maya', { env: {}, actor: { name: 'Maya', via: 'dashboard', tokenVerified: true, ts: new Date().toISOString() } });
  assert.equal(ok, true);

  const [record] = readRunApprovals(runDir).filter((r) => r.artifact === artifact && r.status === 'APPROVED');
  assert.ok(record, 'virtual approval recorded');
  assert.equal(record.artifact_sha256, undefined, 'virtual gate keys have no bytes to bind');
});
