/**
 * Observer-safe reactive refresh (#449). The dashboard is a read-only observer,
 * so it must never WRITE run state — but it should not serve a stale rollup
 * either. When a locally-owned run's persisted pipeline-state lags the live
 * event stream, the observer recomputes the projection IN MEMORY
 * (buildPipelineState never writes) so the next-action is live. Foreign/
 * index-served runs stay labeled-stale (no rebuild).
 *
 * owner: RStack developed by Richardson Gunde
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { pipelineStateEventsBehind, compactPipelineRollup } from '../src/observability/dashboard/state/pipeline-rollup.js';
import { buildPipelineState } from '../src/core/harness/pipeline-state.js';

test('pipelineStateEventsBehind counts only events newer than the state was computed', () => {
  const state = { generated_at: '2026-07-20T00:00:00.000Z' };
  assert.equal(pipelineStateEventsBehind(state, []), 0);
  assert.equal(pipelineStateEventsBehind(state, [{ ts: '2026-07-19T23:59:59.000Z' }]), 0, 'older event does not count');
  assert.equal(pipelineStateEventsBehind(state, [
    { ts: '2026-07-20T00:00:01.000Z' },
    { timestamp: '2026-07-21T00:00:00.000Z' },
    { ts: '2026-07-19T00:00:00.000Z' },
  ]), 2, 'two newer events, one older');
  // No generated_at → cannot judge lag → treated as not-behind (no false rebuild).
  assert.equal(pipelineStateEventsBehind({}, [{ ts: '2026-07-20T00:00:01.000Z' }]), 0);
});

test('a stale persisted rollup reads as stale; an in-memory rebuild clears it', async (t) => {
  const runId = '2026-07-22T00-00-00-000Z-refresh';
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-observer-'));
  const runDir = join(projectRoot, '.rstack', 'runs', runId);
  mkdirSync(runDir, { recursive: true });
  t.after(() => rmSync(projectRoot, { recursive: true, force: true }));

  writeFileSync(join(runDir, 'manifest.json'), JSON.stringify({ run_id: runId, status: 'IN_PROGRESS' }));
  writeFileSync(join(runDir, 'tasks.json'), JSON.stringify({ tasks: [{ id: '07-code', stage_id: '07-code', status: 'IN_PROGRESS' }] }));
  // A newer event than the stale persisted state below.
  writeFileSync(join(runDir, 'events.jsonl'), `${JSON.stringify({ ts: '2026-07-21T12:00:00.000Z', type: 'task_started', task_id: '07-code' })}\n`);

  // The persisted (stale) pipeline-state — computed BEFORE the event above.
  const stale = { schema_version: 1, generated_at: '2026-07-20T00:00:00.000Z', pipeline: { status: 'IN_PROGRESS' }, stages: [], approval_blockers: [] };
  const events = [{ ts: '2026-07-21T12:00:00.000Z', type: 'task_started', task_id: '07-code' }];

  // Observer would flag the persisted rollup as stale…
  assert.ok(pipelineStateEventsBehind(stale, events) > 0, 'persisted state lags the live stream');
  assert.equal(compactPipelineRollup(stale, events).stale, true, 'served as-is it reads stale');

  // …so it rebuilds in memory (no write): the fresh state is not behind.
  const rebuilt = await buildPipelineState(projectRoot, runId);
  assert.equal(pipelineStateEventsBehind(rebuilt, events), 0, 'rebuilt state is current with the event stream');
  assert.equal(compactPipelineRollup(rebuilt, events).stale, false, 'the reactive-refreshed rollup is live, not stale');
});

test('the observer never writes during a rebuild (read-only contract holds)', async (t) => {
  const runId = '2026-07-22T00-00-01-000Z-readonly';
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-observer-ro-'));
  const runDir = join(projectRoot, '.rstack', 'runs', runId);
  mkdirSync(runDir, { recursive: true });
  t.after(() => rmSync(projectRoot, { recursive: true, force: true }));
  writeFileSync(join(runDir, 'manifest.json'), JSON.stringify({ run_id: runId, status: 'IN_PROGRESS' }));
  writeFileSync(join(runDir, 'tasks.json'), JSON.stringify({ tasks: [] }));

  const { existsSync } = await import('node:fs');
  await buildPipelineState(projectRoot, runId);
  assert.equal(existsSync(join(runDir, 'pipeline-state.json')), false, 'buildPipelineState (the observer path) writes nothing');
});
