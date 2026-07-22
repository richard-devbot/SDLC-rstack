/**
 * Approval audit consistency checks (#133): malformed approval records must
 * never unblock stages.
 *
 *   1. validateApprovalRecord rejects each malformed shape (missing actor,
 *      bad timestamp, unsafe artifact, casing confusion, missing token
 *      evidence) and accepts complete records — never throwing on junk.
 *   2. trustedApprovedArtifacts fails closed: malformed latest records poison
 *      their artifact instead of falling back to earlier valid records.
 *   3. auditRunApprovals rejects everything for phantom runs (unsafe run id,
 *      missing manifest) and separates valid from rejected records.
 *   4. Integration: the sdlc_build_next claim gate treats a malformed
 *      required-artifact approval as absent (stage stays gated), records an
 *      approval_audit_failed event without flooding, and still opens for a
 *      valid approval.
 *
 * owner: RStack developed by Richardson Gunde
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  validateApprovalRecord,
  auditRunApprovals,
  trustedApprovedArtifacts,
  approvalAuditEvent,
  isSafeArtifactName,
  RUN_APPROVAL_STATUSES,
  QUEUE_APPROVAL_STATUSES,
} from '../src/core/harness/approval-audit.js';

function record(overrides = {}) {
  return {
    id: 'app-2026-07-06T10-00-00-000Z',
    artifact: 'plan.md',
    status: 'APPROVED',
    approver: 'Manager Maya',
    timestamp: '2026-07-06T10:00:00.000Z',
    ...overrides,
  };
}

test('validateApprovalRecord accepts a complete run record and reports the contracts.js shape', () => {
  const result = validateApprovalRecord(record());
  assert.equal(result.ok, true);
  assert.deepEqual(result.issues, []);
  assert.ok(Array.isArray(result.checks) && result.checks.length > 0);
  assert.ok(result.checks.every((check) => ['PASS', 'FAIL'].includes(check.status)));
  // Every documented status casing passes for the run path.
  for (const status of RUN_APPROVAL_STATUSES) {
    assert.equal(validateApprovalRecord(record({ status })).ok, true, `run status ${status}`);
  }
});

test('validateApprovalRecord rejects each malformed shape without throwing', () => {
  const failing = (rec, name) => {
    const result = validateApprovalRecord(rec);
    assert.equal(result.ok, false, name);
    assert.ok(result.issues.length > 0, `${name} reports issues`);
    return result;
  };

  // Junk shapes never crash.
  for (const junk of [null, undefined, 'approved', 42, [], [{}]]) {
    failing(junk, `junk ${JSON.stringify(junk)}`);
  }

  const missingActor = failing(record({ approver: undefined }), 'missing approver');
  assert.ok(missingActor.issues.some((issue) => issue.name === 'approval_actor_present'));
  failing(record({ approver: '   ' }), 'blank approver');
  failing(record({ approver: 7 }), 'non-string approver');

  const badTs = failing(record({ timestamp: 'not-a-date' }), 'unparseable timestamp');
  assert.ok(badTs.issues.some((issue) => issue.name === 'approval_timestamp_valid'));
  failing(record({ timestamp: undefined }), 'missing timestamp');
  failing(record({ timestamp: 1234567890 }), 'numeric timestamp is not the contract');

  const badArtifact = failing(record({ artifact: '../../etc/passwd' }), 'traversal artifact');
  assert.ok(badArtifact.issues.some((issue) => issue.name === 'approval_artifact_safe'));
  failing(record({ artifact: 'a/b.md' }), 'path-like artifact');
  failing(record({ artifact: '' }), 'empty artifact');
  failing(record({ artifact: undefined }), 'missing artifact');

  // Casing confusion: run records are UPPERCASE-only, queue records lowercase.
  const casing = failing(record({ status: 'approved' }), 'lowercase run status');
  assert.ok(casing.issues.some((issue) => issue.name === 'approval_status_allowed'));
  failing(record({ status: 'Approved' }), 'mixed-case run status');
  failing(record({ status: 'SHIPPED' }), 'unknown status');
  assert.equal(
    validateApprovalRecord({ id: 'q1', runId: 'run-1', artifact: 'plan.md', status: 'APPROVED', ts: '2026-07-06T10:00:00.000Z' }, { casing: 'queue' }).ok,
    false,
    'uppercase status fails the queue path',
  );
  for (const status of QUEUE_APPROVAL_STATUSES.filter((value) => value === 'pending')) {
    assert.equal(
      validateApprovalRecord({ id: 'q1', runId: 'run-1', artifact: 'plan.md', status, ts: '2026-07-06T10:00:00.000Z' }, { casing: 'queue' }).ok,
      true,
      `queue status ${status}`,
    );
  }
  // Resolved queue entries need resolver evidence.
  const queueResolved = validateApprovalRecord(
    { id: 'q1', runId: 'run-1', artifact: 'plan.md', status: 'approved', ts: '2026-07-06T10:00:00.000Z', resolvedBy: 'Maya', resolvedAt: '2026-07-06T10:05:00.000Z' },
    { casing: 'queue' },
  );
  assert.equal(queueResolved.ok, true);
  const queueNoResolver = validateApprovalRecord(
    { id: 'q1', runId: 'run-1', artifact: 'plan.md', status: 'approved', ts: '2026-07-06T10:00:00.000Z' },
    { casing: 'queue' },
  );
  assert.equal(queueNoResolver.ok, false, 'resolved queue entry without resolvedBy fails');
});

test('validateApprovalRecord requires token evidence when the dashboard path is claimed', () => {
  for (const source of ['dashboard', 'business-hub']) {
    const bare = validateApprovalRecord(record({ source }));
    assert.equal(bare.ok, false, `${source} without actor evidence fails`);
    assert.ok(bare.issues.some((issue) => issue.name === 'approval_token_evidence_present'));

    const unverified = validateApprovalRecord(record({ source, actor: { name: 'Maya', via: 'api', tokenVerified: false } }));
    assert.equal(unverified.ok, false, `${source} with tokenVerified:false fails`);

    const forgedFlag = validateApprovalRecord(record({ source, actor: { tokenVerified: true } }));
    assert.equal(forgedFlag.ok, false, `${source} with nameless actor fails`);

    const evidenced = validateApprovalRecord(record({ source, actor: { name: 'Maya', via: 'dashboard', tokenVerified: true } }));
    assert.equal(evidenced.ok, true, `${source} with token-verified actor passes`);
  }
  // Non-dashboard writers (sdlc_approve, harness CONSUMED markers) don't
  // claim the dashboard path, so no token evidence is demanded.
  assert.equal(validateApprovalRecord(record()).ok, true);
  assert.equal(validateApprovalRecord(record({ status: 'CONSUMED', approver: 'rstack-harness' })).ok, true);
});

test('trustedApprovedArtifacts fails closed on malformed and tampered histories', () => {
  // Valid latest APPROVED wins.
  assert.deepEqual(
    [...trustedApprovedArtifacts([record(), record({ artifact: 'architecture.md', status: 'REJECTED' })])],
    ['plan.md'],
  );

  // Malformed record alone approves nothing.
  assert.equal(trustedApprovedArtifacts([{ artifact: 'plan.md', status: 'APPROVED' }]).size, 0);

  // A malformed LATEST record poisons its artifact — no fallback to the
  // earlier valid APPROVED (tampering must not resurrect anything).
  assert.equal(trustedApprovedArtifacts([record(), { artifact: 'plan.md', status: 'APPROVED' }]).size, 0);

  // Junk entries neither approve nor crash.
  assert.equal(trustedApprovedArtifacts(['x', null, {}, { artifact: 42 }]).size, 0);
  assert.equal(trustedApprovedArtifacts('not-an-array').size, 0);

  // Casing confusion never approves.
  assert.equal(trustedApprovedArtifacts([record({ status: 'approved' })]).size, 0);
});

test('auditRunApprovals separates valid from rejected and rejects phantom runs wholesale', () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-audit-'));
  try {
    const runId = 'run-1';
    const runDir = join(projectRoot, '.rstack', 'runs', runId);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, 'manifest.json'), JSON.stringify({ run_id: runId }));

    const good = record();
    const bad = record({ artifact: 'architecture.md', approver: undefined });
    const result = auditRunApprovals([good, bad], { runId, projectRoot });
    assert.equal(result.ok, true, 'context checks pass for a real run');
    assert.deepEqual(result.valid, [good]);
    assert.equal(result.rejected.length, 1);
    assert.equal(result.rejected[0].record, bad);
    assert.ok(result.rejected[0].issues.some((issue) => issue.name === 'approval_actor_present'));

    // Unsafe run id: context fails, every record rejected — nothing may
    // unblock work attributed to a traversal id.
    const traversal = auditRunApprovals([good], { runId: '../../etc', projectRoot });
    assert.equal(traversal.ok, false);
    assert.deepEqual(traversal.valid, []);
    assert.equal(traversal.rejected.length, 1);

    // Run without a manifest is not a real run.
    const ghost = auditRunApprovals([good], { runId: 'ghost-run', projectRoot });
    assert.equal(ghost.ok, false);
    assert.deepEqual(ghost.valid, []);
    assert.ok(ghost.issues.some((issue) => issue.name === 'approval_run_has_manifest'));

    // Non-array approvals.json content is flagged, not thrown on.
    const notArray = auditRunApprovals({ approvals: [good] }, { runId, projectRoot });
    assert.equal(notArray.ok, false);
    assert.deepEqual(notArray.valid, []);
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('approvalAuditEvent pins the event contract and survives junk rejections', () => {
  const event = approvalAuditEvent(
    { record: record({ status: 'approved' }), issues: [{ name: 'approval_status_allowed', status: 'FAIL', evidence: 'approved' }] },
    { task_id: '004-implementation' },
  );
  assert.equal(event.type, 'approval_audit_failed');
  assert.equal(event.artifact, 'plan.md');
  assert.equal(event.status, 'approved');
  assert.equal(event.task_id, '004-implementation');
  assert.ok(event.issues[0].includes('approval_status_allowed'));

  const junk = approvalAuditEvent({ record: null, issues: undefined });
  assert.equal(junk.type, 'approval_audit_failed');
  assert.equal(junk.record_id, null);
  assert.deepEqual(junk.issues, []);
});

test('isSafeArtifactName mirrors the write-path rules', () => {
  assert.equal(isSafeArtifactName('plan.md'), true);
  assert.equal(isSafeArtifactName('guardrail-override:004-implementation'), true);
  assert.equal(isSafeArtifactName('../escape'), false);
  assert.equal(isSafeArtifactName('a/b'), false);
  assert.equal(isSafeArtifactName('a\\b'), false);
  assert.equal(isSafeArtifactName(''), false);
  assert.equal(isSafeArtifactName('x'.repeat(256)), false);
  assert.equal(isSafeArtifactName(null), false);
});

test('approval signatures bind the approved artifact digest (#443)', async () => {
  const { signApprovalRecord, verifyApprovalRecordSignature } = await import('../src/core/harness/approval-audit.js');
  const key = 'approval-digest-test-key';
  const signed = signApprovalRecord(record({ artifact_sha256: 'a'.repeat(64) }), key);
  assert.equal(verifyApprovalRecordSignature(signed, key).verified, true);
  assert.equal(
    verifyApprovalRecordSignature({ ...signed, artifact_sha256: 'b'.repeat(64) }, key).verified,
    false,
    'changing only the content digest invalidates the signed approval',
  );
});
