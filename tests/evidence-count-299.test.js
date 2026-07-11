import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { entryFromRun, liteRunFromEntry } from '../src/observability/dashboard/state/rollup-index.js';
import { buildFullState } from '../src/observability/dashboard/state/index.js';
import { addDecision, readDecisions } from '../src/core/harness/decisions.js';

// owner: RStack developed by Richardson Gunde
//
// #299 residuals: (item 8) the index entry caps the evidence LIST at 100, and
// counts derived from `.length` of that capped array silently undercounted
// 100+-evidence runs to exactly 100 — persist the true evidence_count and
// make consumers prefer it. (item 5, second half) the decisions store used a
// divergent mkdir-based lock — converged onto safe-write's withFileLock so it
// carries the #287 heartbeat + owner-checked release.

test('evidence_count survives the cap: 150 records count as 150, not 100 (#299 item 8)', () => {
  const evidence = Array.from({ length: 150 }, (_, index) => ({ ts: `t${index}`, task_id: 't1', kind: 'validation', status: 'PASS', evidence: `proof-${index}` }));
  const entry = entryFromRun({ runId: 'run-x', manifest: {}, events: [], tasks: [], evidence });
  assert.equal(entry.evidence.length, 100, 'the list stays capped (index size discipline)');
  assert.equal(entry.evidence_count, 150, 'the count is the truth');
  const lite = liteRunFromEntry('/tmp/p', entry);
  assert.equal(lite.evidenceCount, 150);
  assert.equal(lite.evidence.length, 100);
});

test('the true count flows through the full state pipeline for index-served runs', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-evcount-'));
  try {
    const runId = '2026-07-04T10-00-00-heavy';
    const runDir = join(projectRoot, '.rstack', 'runs', runId);
    await mkdir(runDir, { recursive: true });
    await writeFile(join(runDir, 'manifest.json'), JSON.stringify({ run_id: runId, goal: 'Heavy evidence', created_at: '2026-07-01T00:00:00.000Z', completed_at: '2026-07-02T00:00:00.000Z' }));
    await writeFile(join(runDir, 'tasks.json'), JSON.stringify({ tasks: [{ id: '02-requirements', title: 'Req', status: 'PASS' }] }));
    await writeFile(join(runDir, 'events.jsonl'), `${JSON.stringify({ ts: '2026-07-01T00:00:01.000Z', type: 'task_started', task_id: '02-requirements' })}\n`);
    await writeFile(join(runDir, 'evidence.jsonl'),
      Array.from({ length: 120 }, (_, index) => JSON.stringify({ ts: `2026-07-01T00:00:0${index % 10}.000Z`, task_id: '02-requirements', kind: 'validation', status: 'PASS', evidence: `proof-${index}` })).join('\n') + '\n');

    await buildFullState(projectRoot, { includeRegistry: false });
    const second = await buildFullState(projectRoot, { includeRegistry: false });
    const run = second.runs.find((candidate) => candidate.runId === runId);
    assert.ok(run.fromIndex, 'served from the index on cycle 2');
    assert.equal(run.evidenceCount, 120, 'the aggregate consumers see the true total');
    assert.equal(run.evidence.length, 100, 'the detail list stays capped');
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('decisions lock converged onto withFileLock: concurrent adds both land, no legacy lock dir (#299 item 5)', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-declock-'));
  try {
    const runId = 'run-decisions';
    const runDir = join(projectRoot, '.rstack', 'runs', runId);
    await mkdir(runDir, { recursive: true });
    await writeFile(join(runDir, 'manifest.json'), JSON.stringify({ run_id: runId, goal: 'Decision lock', created_at: new Date().toISOString() }));

    await Promise.all([
      addDecision(projectRoot, runId, { question: 'Pick the database', impact: 'architecture', required_before_stage: '06-architecture' }),
      addDecision(projectRoot, runId, { question: 'Pick the queue', impact: 'architecture', required_before_stage: '06-architecture' }),
    ]);
    const decisions = await readDecisions(projectRoot, runId);
    assert.equal(decisions.length, 2, 'concurrent adds both land under the shared lock');
    assert.ok(!existsSync(join(runDir, '.decisions.lock')), 'the legacy mkdir lock dir is gone');
    assert.ok(!existsSync(join(runDir, 'decisions.json.lock')), 'the safe-write lock is released after the section');
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});
