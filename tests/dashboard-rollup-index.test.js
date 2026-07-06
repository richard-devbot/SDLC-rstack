import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { stat as statAsync } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildFullState } from '../src/observability/dashboard/state/index.js';
import { INDEX_VERSION, resolveRetentionDays, statusFromEntry } from '../src/observability/dashboard/state/rollup-index.js';

// owner: RStack developed by Richardson Gunde

async function writeJson(filePath, value) {
  await writeFile(filePath, JSON.stringify(value, null, 2));
}

async function writeCompletedRun(projectRoot, runId, { createdAt, completedAt, cost = 0.5 }) {
  const runDir = join(projectRoot, '.rstack', 'runs', runId);
  await mkdir(runDir, { recursive: true });
  await writeJson(join(runDir, 'manifest.json'), {
    run_id: runId,
    goal: `Goal for ${runId}`,
    created_at: createdAt,
    completed_at: completedAt,
    framework: 'pi',
  });
  await writeJson(join(runDir, 'tasks.json'), {
    tasks: [{ id: '02-requirements', title: 'Requirements', status: 'PASS' }],
  });
  await writeFile(join(runDir, 'events.jsonl'), [
    { ts: createdAt, type: 'task_started', task_id: '02-requirements' },
    { ts: completedAt, type: 'cost_recorded', usd: cost, tokens: 100 },
    { ts: completedAt, type: 'task_validated', task_id: '02-requirements', status: 'PASS' },
  ].map((event) => JSON.stringify(event)).join('\n') + '\n');
  return runDir;
}

function isoDaysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

test('rollup index is created and self-heals when deleted', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-rollup-heal-'));
  try {
    await writeCompletedRun(projectRoot, '2026-06-01T10-00-00-alpha', {
      createdAt: isoDaysAgo(9),
      completedAt: isoDaysAgo(8),
    });
    await writeCompletedRun(projectRoot, '2026-06-02T10-00-00-beta', {
      createdAt: isoDaysAgo(8),
      completedAt: isoDaysAgo(7),
    });

    const indexPath = join(projectRoot, '.rstack', 'index.json');
    await buildFullState(projectRoot, { includeRegistry: false });
    assert.ok(existsSync(indexPath), 'first cycle writes .rstack/index.json');

    await rm(indexPath);
    const state = await buildFullState(projectRoot, { includeRegistry: false });
    assert.ok(existsSync(indexPath), 'deleted index is rebuilt on the next cycle');

    const index = JSON.parse(await readFile(indexPath, 'utf8'));
    assert.equal(Object.keys(index.runs).length, 2);
    assert.equal(index.version, INDEX_VERSION);
    assert.equal(state.runs.length, 2);
    assert.equal(state.totalCost, 1);
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('second cycle serves ~50 completed runs from the index without re-reading events.jsonl', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-rollup-cold-'));
  try {
    const runIds = [];
    for (let i = 0; i < 50; i++) {
      const runId = `2026-05-01T00-00-${String(i).padStart(2, '0')}-fixture`;
      runIds.push(runId);
      await writeCompletedRun(projectRoot, runId, {
        createdAt: isoDaysAgo(20),
        completedAt: isoDaysAgo(19),
        cost: 0.5,
      });
    }

    const first = await buildFullState(projectRoot, { includeRegistry: false });
    assert.equal(first.runs.length, 50);
    assert.equal(Math.round(first.totalCost * 100) / 100, 25);

    // Corrupt every events.jsonl: if any completed run were re-parsed, its
    // totals would collapse to zero and the assertions below would fail.
    for (const runId of runIds) {
      await writeFile(join(projectRoot, '.rstack', 'runs', runId, 'events.jsonl'), 'NOT-JSON\n');
    }

    // Instrument fs through the injectable reader: completed entries must be
    // served without a single stat/read against their run files.
    const statted = [];
    const readPaths = [];
    const second = await buildFullState(projectRoot, {
      includeRegistry: false,
      indexIo: {
        stat: async (path, ...args) => { statted.push(String(path)); return statAsync(path, ...args); },
        readFile: async (path, ...args) => { readPaths.push(String(path)); return readFile(path, ...args); },
      },
    });

    assert.equal(statted.filter((path) => path.includes('events.jsonl')).length, 0,
      'completed runs are never stat-checked again');
    assert.equal(readPaths.filter((path) => path.includes('events.jsonl')).length, 0,
      'completed runs never have events.jsonl re-read');
    assert.equal(second.runs.length, 50);
    assert.equal(Math.round(second.totalCost * 100) / 100, 25,
      'totals survive from the index even though events.jsonl is now garbage');
    assert.ok(second.runs.every((run) => run.fromIndex && run.derivedStatus === 'done'));
    assert.equal(second.trends.runs.length, 50);
    assert.ok(second.trends.runs.every((row) => row.cost_usd === 0.5),
      'trend rows come from the precomputed rollup, not re-derived events');
    assert.equal(second.diagnostics.index.indexServedRuns, 50);
    assert.equal(second.diagnostics.index.fullyParsedRuns, 0);
    assert.ok(Number.isFinite(second.diagnostics.index.freshnessMs));
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('retention archives expired completed runs (move-only) and the move is reversible', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-rollup-retain-'));
  const previousEnv = process.env.RSTACK_RETENTION_DAYS;
  try {
    process.env.RSTACK_RETENTION_DAYS = '90';
    const oldRunId = '2025-11-01T00-00-00-ancient';
    const freshRunId = '2026-06-01T00-00-00-fresh';
    await writeCompletedRun(projectRoot, oldRunId, {
      createdAt: isoDaysAgo(201),
      completedAt: isoDaysAgo(200),
    });
    await writeCompletedRun(projectRoot, freshRunId, {
      createdAt: isoDaysAgo(10),
      completedAt: isoDaysAgo(9),
    });

    const state = await buildFullState(projectRoot, { includeRegistry: false });
    const runDir = join(projectRoot, '.rstack', 'runs', oldRunId);
    const archiveDir = join(projectRoot, '.rstack', 'archive', oldRunId);

    assert.ok(!existsSync(runDir), 'expired run leaves .rstack/runs');
    assert.ok(existsSync(join(archiveDir, 'manifest.json')), 'expired run is moved intact to .rstack/archive');
    assert.ok(existsSync(join(archiveDir, 'events.jsonl')), 'nothing inside the run is deleted');
    assert.ok(!state.runs.some((run) => run.runId === oldRunId));
    assert.ok(state.runs.some((run) => run.runId === freshRunId), 'recent completed run is retained');
    assert.equal(state.diagnostics.index.archivedRuns, 1);
    assert.equal(state.diagnostics.index.retentionDays, 90);

    // Reversible: move the directory back and the run reappears next cycle.
    await rename(archiveDir, runDir);
    const restored = await buildFullState(projectRoot, { includeRegistry: false, retentionDays: 0 });
    assert.ok(restored.runs.some((run) => run.runId === oldRunId), 'restored run is indexed again');
  } finally {
    if (previousEnv === undefined) delete process.env.RSTACK_RETENTION_DAYS;
    else process.env.RSTACK_RETENTION_DAYS = previousEnv;
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('RSTACK_RETENTION_DAYS=0 never archives', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-rollup-never-'));
  const previousEnv = process.env.RSTACK_RETENTION_DAYS;
  try {
    process.env.RSTACK_RETENTION_DAYS = '0';
    const oldRunId = '2024-01-01T00-00-00-vintage';
    await writeCompletedRun(projectRoot, oldRunId, {
      createdAt: isoDaysAgo(800),
      completedAt: isoDaysAgo(799),
    });

    const state = await buildFullState(projectRoot, { includeRegistry: false });

    assert.ok(existsSync(join(projectRoot, '.rstack', 'runs', oldRunId)), 'run stays in place');
    assert.ok(!existsSync(join(projectRoot, '.rstack', 'archive')), 'no archive directory is created');
    assert.ok(state.runs.some((run) => run.runId === oldRunId));
    assert.equal(state.diagnostics.index.archivedRuns, 0);
    assert.equal(state.diagnostics.index.retentionDays, 0);
  } finally {
    if (previousEnv === undefined) delete process.env.RSTACK_RETENTION_DAYS;
    else process.env.RSTACK_RETENTION_DAYS = previousEnv;
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('active runs are still fully parsed and a changed run dir invalidates its entry', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-rollup-hot-'));
  try {
    const runId = '2026-06-10T09-00-00-live';
    const runDir = join(projectRoot, '.rstack', 'runs', runId);
    await mkdir(runDir, { recursive: true });
    const nowIso = new Date().toISOString();
    await writeJson(join(runDir, 'manifest.json'), {
      run_id: runId, goal: 'Live run', created_at: nowIso, framework: 'pi',
    });
    await writeJson(join(runDir, 'tasks.json'), { tasks: [{ id: '02-requirements', title: 'Reqs', status: 'IN_PROGRESS' }] });
    await writeFile(join(runDir, 'events.jsonl'),
      JSON.stringify({ ts: nowIso, type: 'task_started', task_id: '02-requirements' }) + '\n');

    const first = await buildFullState(projectRoot, { includeRegistry: false });
    const liveRun = first.runs.find((run) => run.runId === runId);
    assert.equal(liveRun.derivedStatus, 'active');
    assert.ok(!liveRun.fromIndex, 'active runs bypass the index and are fully parsed');
    assert.equal(first.diagnostics.index.fullyParsedRuns, 1);

    // Append an event — the signature change must surface in the next cycle.
    await writeFile(join(runDir, 'events.jsonl'),
      JSON.stringify({ ts: nowIso, type: 'task_started', task_id: '02-requirements' }) + '\n' +
      JSON.stringify({ ts: new Date().toISOString(), type: 'task_validated', task_id: '02-requirements', status: 'PASS' }) + '\n');
    const second = await buildFullState(projectRoot, { includeRegistry: false });
    const updated = second.runs.find((run) => run.runId === runId);
    assert.equal(updated.totals.tasks_passed, 1, 'new events are picked up on the next cycle');
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('statusFromEntry and resolveRetentionDays cover the gating contract directly', () => {
  const now = Date.parse('2026-06-10T12:00:00.000Z');
  assert.equal(statusFromEntry({ completed_at: '2026-06-01T00:00:00.000Z' }, now), 'done');
  assert.equal(statusFromEntry({ event_count: 0 }, now), 'idle');
  assert.equal(statusFromEntry({
    event_count: 3, last_event_ts: '2026-06-10T11:59:00.000Z', last_event_type: 'tool_call',
  }, now), 'active');
  assert.equal(statusFromEntry({
    event_count: 3, last_event_ts: '2026-06-10T10:00:00.000Z', last_event_type: 'tool_call',
  }, now), 'stalled');
  assert.equal(statusFromEntry({
    event_count: 3, last_event_ts: '2026-06-10T11:59:00.000Z', last_event_type: 'session_shutdown',
  }, now), 'ended');

  assert.equal(resolveRetentionDays(undefined), 90);
  assert.equal(resolveRetentionDays(''), 90);
  assert.equal(resolveRetentionDays('0'), 0);
  assert.equal(resolveRetentionDays('30'), 30);
  assert.equal(resolveRetentionDays('not-a-number'), 90);
  assert.equal(resolveRetentionDays('-5'), 90);
});
