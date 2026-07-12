import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildFullState } from '../src/observability/dashboard/state/index.js';

// owner: RStack developed by Richardson Gunde
//
// #221: attachPipelineRollups called readPipelineState() for EVERY run on EVERY
// ~3s poll, including completed/index-served runs whose rollup never changes —
// defeating the rollup index's "zero-fs-per-poll for completed runs" invariant.
// The fix persists the compact pipeline_rollup into the index entry at index
// time; index-served runs are then summarized from memory. These pins prove the
// rollup survives into an index-served run and is authoritative even when the
// run's source files are subsequently corrupted (i.e. it was NOT re-derived).

async function writeJson(filePath, value) { await writeFile(filePath, JSON.stringify(value, null, 2)); }
function isoDaysAgo(days) { return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString(); }

async function writeCompletedRun(projectRoot, runId) {
  const runDir = join(projectRoot, '.rstack', 'runs', runId);
  await mkdir(runDir, { recursive: true });
  await writeJson(join(runDir, 'manifest.json'), {
    run_id: runId, goal: `Goal for ${runId}`,
    created_at: isoDaysAgo(9), completed_at: isoDaysAgo(8), framework: 'pi',
  });
  await writeJson(join(runDir, 'tasks.json'), {
    tasks: [{ id: '02-requirements', title: 'Requirements', status: 'PASS', stage_id: '02-requirements' }],
  });
  await writeFile(join(runDir, 'events.jsonl'), [
    { ts: isoDaysAgo(9), type: 'task_started', task_id: '02-requirements' },
    { ts: isoDaysAgo(8), type: 'task_validated', task_id: '02-requirements', status: 'PASS' },
  ].map((e) => JSON.stringify(e)).join('\n') + '\n');
  return runDir;
}

test('#221 index-served runs carry a persisted pipeline rollup and never re-derive it', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-persist-rollup-221-'));
  try {
    const runId = '2026-07-03T10-00-00-rollup';
    const runDir = await writeCompletedRun(projectRoot, runId);

    // Cycle 1: fully parses + indexes; the rollup is computed once and stored.
    const first = await buildFullState(projectRoot, { includeRegistry: false });
    const firstRun = first.runs.find((r) => r.runId === runId);
    assert.ok(firstRun.pipelineRollup, 'a rollup is attached on the first (full-parse) cycle');
    const firstStatus = firstRun.pipelineRollup.status;
    assert.ok(firstRun.pipelineRollup.next_action, 'rollup carries a next_action');

    // Corrupt the source events — a completed run is served from the index and
    // must NOT be re-parsed/re-derived. If the rollup were rebuilt per poll from
    // these events, it would now be wrong/null.
    await writeFile(join(runDir, 'events.jsonl'), 'NOT-JSON\n');

    // Cycle 2: served from the index.
    const second = await buildFullState(projectRoot, { includeRegistry: false });
    const run = second.runs.find((r) => r.runId === runId);
    assert.ok(run.fromIndex, 'completed run is index-served on the second cycle');
    assert.ok(run.pipelineRollup, 'the persisted rollup survives into the index-served run (was null before #221)');
    assert.equal(run.pipelineRollup.status, firstStatus,
      'the index-served rollup matches the first cycle — served from the entry, not re-derived from the now-corrupt events');
    assert.ok(run.pipelineRollup.next_action, 'the persisted rollup keeps its next_action');
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});
