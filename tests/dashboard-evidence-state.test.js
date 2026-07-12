import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEvidenceProjection } from '../src/observability/dashboard/state/evidence.js';
import { buildReadinessProjection } from '../src/observability/dashboard/state/readiness.js';

function run(overrides = {}) {
  return {
    runId: 'run-a',
    projectRoot: '/project-a',
    requirements: [{ id: 'REQ-1', description: 'Protect account access', priority: 'must' }],
    stageReports: ['02-requirements', '07-code', '08-testing'],
    artifactIndex: [
      { path: 'artifacts/stages/07-code/implementation-report.json', stageId: '07-code' },
    ],
    tasks: [{
      id: '08-testing', title: 'Test access', status: 'PASS', stageId: '08-testing',
      validation: { status: 'PASS', checks: [{ name: 'REQ-1 integration', status: 'PASS', evidence: 'tests/access.test.js' }] },
    }],
    evidence: [
      { ts: '2026-07-12T08:00:00.000Z', task_id: '07-code', kind: 'implementation', status: 'PASS', evidence: 'src/access.js', requirement_id: 'REQ-1' },
      { ts: '2026-07-12T08:10:00.000Z', task_id: '08-testing', kind: 'test', status: 'PASS', evidence: 'tests/access.test.js', requirement_id: 'REQ-1' },
    ],
    approvals: [], integrity: [], manifest: { goal: 'Secure access' },
    ...overrides,
  };
}

test('evidence projection uses explicit tri-state cells and real source references', () => {
  const projection = buildEvidenceProjection({ runs: [run()] }, { evaluatedAt: '2026-07-12T09:00:00.000Z' });
  assert.equal(projection.rows.length, 1);
  assert.equal(projection.rows[0].cells.implementation.status, 'verified');
  assert.equal(projection.rows[0].cells.test.status, 'verified');
  assert.equal(projection.rows[0].cells.security.status, 'unknown');
  assert.ok(projection.rows[0].cells.implementation.sourceRefs[0].path);
  assert.equal(projection.summary.verified, 2);
  assert.equal(projection.summary.unknown, 3);
  assert.equal(projection.summary.coveragePercent, 40);
});

test('negative proof fails while missing and damaged proof stays unknown and unavailable', () => {
  const damaged = run({
    evidence: [{ ts: '2026-07-12T08:10:00.000Z', task_id: '08-testing', kind: 'test', status: 'FAIL', evidence: 'tests/access.test.js', requirement_id: 'REQ-1' }],
    integrity: [{ file: '.rstack/runs/run-a/evidence.jsonl', error: 'malformed JSONL' }],
  });
  const projection = buildEvidenceProjection({ runs: [damaged] });
  assert.equal(projection.rows[0].cells.test.status, 'failed');
  assert.equal(projection.rows[0].cells.implementation.status, 'unknown');
  assert.equal(projection.rows[0].cells.implementation.availability, 'inaccessible');
  assert.equal(projection.summary.failed, 1);
});

test('projection never leaks another project into a scoped matrix', () => {
  const projection = buildEvidenceProjection({ runs: [run(), run({ runId: 'run-b', projectRoot: '/project-b' })] }, { projectRoot: '/project-a' });
  assert.deepEqual(projection.rows.map((row) => row.projectRoot), ['/project-a']);
  assert.ok(projection.sources.every((source) => source.projectRoot === '/project-a'));
});

test('readiness consumes the exact evidence projection and does not promote unknown to pass', () => {
  const runs = [run()];
  const evidenceCenter = buildEvidenceProjection({ runs });
  const readiness = buildReadinessProjection({ runs, evidenceCenter, pendingApprovals: [], blockedGates: [], alerts: [] });
  const evidenceCheck = readiness.checks.find((check) => check.id === 'evidence');
  assert.equal(evidenceCheck.status, 'unknown');
  assert.ok(evidenceCheck.sourceRefs.length > 0);
  assert.ok(evidenceCheck.sourceRefs.every((source) => evidenceCenter.sources.some((candidate) => candidate.path === source.path)));
});
