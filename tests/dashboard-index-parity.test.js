import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildFullState } from '../src/observability/dashboard/state/index.js';
import { entryFromRun, liteRunFromEntry } from '../src/observability/dashboard/state/rollup-index.js';
import { writePipelineState } from '../src/core/harness/pipeline-state.js';

// owner: RStack developed by Richardson Gunde
//
// Lite↔full parity guard (#296 follow-up, promised in the #268/#315 reviews):
// #264 and #296 were the SAME bug twice — a field existed on fully-parsed runs
// but the index entry never persisted it, so index-served runs silently
// rendered it empty. This test makes the third occurrence impossible to land
// silently: it compares a rich run fully parsed (cycle 1) against the same run
// served from the index (cycle 2) across EVERY key, and fails on any field
// that is populated on the full parse but empty on the lite path — unless the
// loss is consciously declared below.

// Fields where the lite path is ALLOWED to be lossy, each with the reason.
// Adding a key here is a deliberate product decision — never a default.
const KNOWN_LOSSY = new Set([
  'events',        // lite carries notable_events (high-volume types excluded, capped) — still non-empty for real runs
  'budgetPolicy',  // read from project config at full parse; lite runs resolve it lazily where needed
  'fromIndex',     // the marker itself differs by construction
  'sig',           // internal index bookkeeping
]);

async function writeJson(filePath, value) {
  await writeFile(filePath, JSON.stringify(value, null, 2));
}

function isoDaysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function isEmpty(value) {
  if (value == null) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  if (typeof value === 'string') return value.length === 0;
  return false;
}

test('index parity: every populated field on a fully-parsed run survives the lite path', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-index-parity-'));
  try {
    // A completed run exercising every per-run surface the dashboard consumes:
    // tasks, events, approvals, evidence, requirements, stage artifacts.
    const runId = '2026-07-03T10-00-00-parity';
    const runDir = join(projectRoot, '.rstack', 'runs', runId);
    const stagesDir = join(runDir, 'artifacts', 'stages');
    await mkdir(join(stagesDir, '02-requirements'), { recursive: true });
    await mkdir(join(stagesDir, '07-code'), { recursive: true });
    await writeJson(join(runDir, 'manifest.json'), {
      run_id: runId, goal: 'Parity fixture', created_at: isoDaysAgo(9), completed_at: isoDaysAgo(8), framework: 'pi', profile: 'business-flex',
    });
    await writeJson(join(runDir, 'tasks.json'), {
      tasks: [
        { id: '02-requirements', title: 'Requirements', status: 'PASS', stage_id: '02-requirements' },
        { id: '07-code', title: 'Code', status: 'PASS', stage_id: '07-code' },
      ],
    });
    await writeFile(join(runDir, 'events.jsonl'), [
      { ts: isoDaysAgo(9), type: 'task_started', task_id: '02-requirements' },
      { ts: isoDaysAgo(9), type: 'task_validated', task_id: '02-requirements', status: 'PASS' },
      { ts: isoDaysAgo(8), type: 'task_started', task_id: '07-code' },
      { ts: isoDaysAgo(8), type: 'task_validated', task_id: '07-code', status: 'PASS' },
      { ts: isoDaysAgo(8), type: 'cost_recorded', usd: 0.4, tokens: 120 },
    ].map((event) => JSON.stringify(event)).join('\n') + '\n');
    await writeJson(join(runDir, 'approvals.json'), [
      { id: 'app-1', artifact: 'plan.md', status: 'APPROVED', approver: 'richardson', timestamp: isoDaysAgo(9), run_id: runId },
    ]);
    await writeFile(join(runDir, 'evidence.jsonl'), [
      { ts: isoDaysAgo(9), task_id: '02-requirements', kind: 'validation', status: 'PASS', evidence: 'requirements.json' },
    ].map((event) => JSON.stringify(event)).join('\n') + '\n');
    await writeJson(join(stagesDir, '02-requirements', 'requirements.json'), [
      { id: 'R1', area: 'auth', priority: 'must', description: 'Users can log in' },
    ]);
    await writeJson(join(stagesDir, '07-code', 'code_report.json'), { status: 'PASS' });
    // Persisted pipeline state — every state-mutating tool writes it since
    // #262, so a realistic run has it and BOTH paths read the same file.
    // (Legacy runs without the file lose pipelineRollup on the lite path —
    // known residual; this guard covers the post-#262 world.)
    await writePipelineState(projectRoot, runId);

    const first = await buildFullState(projectRoot, { includeRegistry: false });
    const full = first.runs.find((run) => run.runId === runId);
    assert.ok(full && !full.fromIndex, 'cycle 1 parses the run fully');

    const second = await buildFullState(projectRoot, { includeRegistry: false });
    const lite = second.runs.find((run) => run.runId === runId);
    assert.ok(lite?.fromIndex, 'cycle 2 serves the run from the index');

    const dropped = [];
    for (const key of Object.keys(full)) {
      if (KNOWN_LOSSY.has(key)) continue;
      if (!isEmpty(full[key]) && isEmpty(lite[key])) dropped.push(key);
    }
    assert.deepEqual(dropped, [],
      `index-served run silently drops populated field(s): ${dropped.join(', ')} — persist them in entryFromRun/liteRunFromEntry (with an INDEX_VERSION bump) or consciously add to KNOWN_LOSSY with a reason`);

    // And the known-lossy exception must still be USEFUL, not empty.
    assert.ok((lite.events ?? []).length > 0, 'lite events carry the notable subset, never nothing');
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('the #82 data-damaged badge survives the index round-trip when TRUE', () => {
  // Found by the parity guard above (with a false-valued fixture): the entry
  // never persisted hasIntegrityErrors, so a damaged completed run lost its
  // badge on the lite path. Pin the truthy case directly.
  const entry = entryFromRun({ runId: 'run-x', hasIntegrityErrors: true, manifest: {}, events: [], tasks: [] });
  assert.equal(entry.has_integrity_errors, true);
  assert.equal(liteRunFromEntry('/tmp/p', entry).hasIntegrityErrors, true);
});
