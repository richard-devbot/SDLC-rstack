import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendEvidenceEvent, readEvidenceEvents, validateEvidenceEvent } from '../src/core/harness/evidence.js';

test('evidence events require task_id, kind, status, and evidence', () => {
  const valid = validateEvidenceEvent({
    task_id: '004-implementation',
    kind: 'command',
    status: 'PASS',
    evidence: 'npm test: 22 pass, 0 fail',
  });
  assert.equal(valid.ok, true);

  const invalid = validateEvidenceEvent({ kind: 'command', status: 'PASS' });
  assert.equal(invalid.ok, false);
  assert.ok(invalid.issues.some((issue) => issue.name === 'evidence_has_task_id'));
  assert.ok(invalid.issues.some((issue) => issue.name === 'evidence_has_evidence'));
});

test('appendEvidenceEvent writes JSONL evidence under the run ledger', async () => {
  const runDir = mkdtempSync(join(tmpdir(), 'rstack-evidence-'));
  try {
    const path = await appendEvidenceEvent(runDir, {
      task_id: '004-implementation',
      kind: 'file_write',
      status: 'PASS',
      evidence: 'src/harness/evidence.js',
    });
    assert.ok(existsSync(path));

    const events = await readEvidenceEvents(runDir);
    assert.equal(events.length, 1);
    assert.equal(events[0].task_id, '004-implementation');
    assert.equal(events[0].kind, 'file_write');
    assert.equal(events[0].status, 'PASS');
    assert.equal(events[0].evidence, 'src/harness/evidence.js');
    assert.ok(events[0].ts);
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

test('appendEvidenceEvent rejects missing evidence fields', async () => {
  const runDir = mkdtempSync(join(tmpdir(), 'rstack-evidence-invalid-'));
  try {
    await assert.rejects(
      () => appendEvidenceEvent(runDir, { task_id: '004-implementation', kind: 'command', status: 'PASS' }),
      /Invalid evidence event/,
    );
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});
