/**
 * Operations Center (#284): server-owned operations projection with honest
 * truth semantics (silence is never healthy), the Run Workspace recovery
 * consumer repaired onto the shipped checkpoint contract, nav consolidation,
 * and an end-to-end pass over the #96 canonical fixtures.
 *
 * owner: RStack developed by Richardson Gunde
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildOperationsProjection } from '../src/observability/dashboard/state/operations.js';
import { buildRunWorkspace } from '../src/observability/dashboard/state/run-workspace.js';
import { buildFullState } from '../src/observability/dashboard/state/index.js';
import { destinations } from '../src/observability/dashboard/ui/navigation.js';
import { operationsScript } from '../src/observability/dashboard/ui/pages/operations.js';
import { fixtureBlockedRun, fixtureNoRunsProject } from './helpers/dashboard-fixtures.js';

test('operations projection: silence is never healthy', () => {
  const ops = buildOperationsProjection({});
  assert.equal(ops.status, 'unknown', 'no producers at all → unknown, not ok');
  assert.equal(ops.sections.health.status, 'unknown');
  assert.equal(ops.sections.health.availability, 'unavailable');
  assert.equal(ops.sections.recovery.status, 'unknown');
  assert.equal(ops.sections.contextMemory.status, 'unknown');
  assert.equal(ops.sections.integrations.status, 'unknown');
});

test('operations health reconciles with the Action Inbox — same records, no competing count', () => {
  const actions = [
    { id: 'a1', title: 'Approve override', status: 'pending', blocking: true, severity: 'critical' },
    { id: 'a2', title: 'Resolve decision', status: 'pending', blocking: false, severity: 'warning' },
    { id: 'a3', title: 'Old item', status: 'approved', blocking: true, severity: 'critical' },
  ];
  const ops = buildOperationsProjection({ actions });
  assert.equal(ops.sections.health.open, 2, 'closed inbox records are not open health items');
  assert.equal(ops.sections.health.blocking, 1);
  assert.equal(ops.sections.health.status, 'blocked');
  assert.equal(ops.sections.health.source, 'action-inbox');

  const allClosed = buildOperationsProjection({ actions: [actions[2]] });
  assert.equal(allClosed.sections.health.status, 'ok', 'inbox ran and found nothing open → ok');
});

test('operations recovery reads the shipped checkpoint contract, CORRUPT surfaces as warn', () => {
  const runs = [{
    runId: 'run-r1',
    pipelineRollup: {
      checkpoints: {
        total: 3, before_saved: 2, after_saved: 1, reverted: 1,
        stages: [
          { id: '07-code', restorable: true, reason: null },
          { id: '08-testing', restorable: false, reason: 'corrupt_content' },
        ],
      },
      retries: { total: 2, scheduled: 1, exhausted: 1, human_required: 0 },
      context_pressure: { total: 0, by_source: {} },
    },
  }];
  const ops = buildOperationsProjection({ runs });
  const recovery = ops.sections.recovery;
  assert.equal(recovery.availability, 'available');
  assert.equal(recovery.status, 'warn', 'corrupt checkpoint + exhausted retry = warn');
  assert.deepEqual(recovery.runs[0].restorable, ['07-code']);
  assert.deepEqual(recovery.runs[0].corrupt, ['08-testing']);
  assert.equal(recovery.runs[0].retries.exhausted, 1);
});

test('operations context/memory health counts pressure, skips, and drift', () => {
  const ops = buildOperationsProjection({
    runs: [{ runId: 'r', pipelineRollup: { context_pressure: { total: 2, by_source: { builder_prompt: 2 } }, checkpoints: { stages: [] }, retries: {} } }],
    feed: [
      { type: 'episode_memory_skipped_untrusted' },
      { type: 'metrics_write_failed' },
      { type: 'task_started' },
    ],
  });
  const section = ops.sections.contextMemory;
  assert.equal(section.contextPressureWarnings, 2);
  assert.equal(section.bySource.builder_prompt, 2);
  assert.equal(section.memoryWritesSkipped, 1);
  assert.equal(section.metricsDriftEvents, 1);
  assert.equal(section.status, 'warn');
});

test('run workspace recovery consumer reads checkpoints.stages — the field that actually exists', () => {
  const run = {
    runId: 'run-x',
    manifest: { goal: 'g' },
    tasks: [],
    events: [],
    timeline: [],
    activityTimeline: [],
    artifactIndex: [],
    stageReports: [],
    evidenceRecent: [],
    stageCost: {},
    stageTokens: {},
    metrics: {},
    pipelineRollup: {
      checkpoints: { stages: [{ id: '07-code', restorable: true, reason: null }, { id: '09-deployment', restorable: false, reason: 'corrupt_manifest' }] },
    },
  };
  const workspace = buildRunWorkspace(run);
  const recovery = workspace.sections.metrics.recovery;
  assert.equal(recovery.length, 2, 'recovery panel is no longer permanently empty');
  assert.deepEqual(recovery[0], { stageId: '07-code', restorable: true, reason: null, source: 'pipeline-state.json' });
  assert.equal(recovery[1].reason, 'corrupt_manifest', 'CORRUPT reason survives to the panel');
});

test('operations-center is the Operations destination default; legacy pages stay routable', () => {
  const operations = destinations.find((destination) => destination.id === 'operations');
  assert.equal(operations.defaultPage, 'operations-center');
  const childIds = operations.children.map((child) => child.id);
  for (const id of ['operations-center', 'live-feed', 'team', 'team-layers', 'environment', 'diagnostics']) {
    assert.ok(childIds.includes(id), `${id} stays routable`);
  }
  const liveFeed = operations.children.find((child) => child.id === 'live-feed');
  assert.ok(!liveFeed.hidden, 'raw feed remains visible secondary detail');
});

test('operations page renders honest unavailable states and one freshness formula', () => {
  assert.ok(operationsScript.includes('renderOperationsCenter'));
  assert.ok(operationsScript.includes('Unknown is not healthy'), 'unavailable sections say so');
  assert.ok(operationsScript.includes('classifyFreshness'), 'transport reuses the topbar freshness formula');
  assert.ok(operationsScript.includes('Showing last-known data'), 'stale banner preserves last-known data honestly');
  assert.ok(operationsScript.includes("data-page=\"action-inbox\""), 'health deep-links to the Action Inbox');
});

test('end-to-end: blocked fixture surfaces operational truth; empty scope stays unknown', async () => {
  const base = mkdtempSync(join(tmpdir(), 'rstack-284-'));
  const noisy = join(base, 'noisy');
  const empty = join(base, 'empty');
  mkdirSync(noisy, { recursive: true });
  mkdirSync(empty, { recursive: true });
  const previousRegistry = process.env.RSTACK_REGISTRY_DIR;
  process.env.RSTACK_REGISTRY_DIR = join(base, 'registry');
  mkdirSync(process.env.RSTACK_REGISTRY_DIR, { recursive: true });
  writeFileSync(join(process.env.RSTACK_REGISTRY_DIR, 'known-projects.json'), JSON.stringify([noisy, empty]));
  try {
    await fixtureBlockedRun(noisy);
    await fixtureNoRunsProject(empty);

    const state = await buildFullState(noisy);
    assert.ok(state.operations, 'operations projection served');
    assert.equal(state.operations.sections.recovery.availability, 'available', 'blocked fixture has a rollup');
    assert.ok(state.operations.sections.health.open >= 1, 'the pending override reaches actionable health');
    assert.notEqual(state.operations.status, 'ok', 'a blocked run is not a healthy operation');

    const descriptor = (state.scopeCatalog?.projects ?? []).find((project) => (
      (project.roots ?? []).some((entry) => String(entry.root ?? '').includes('empty'))
    ));
    assert.ok(descriptor, 'empty project has a scope id');
    const scoped = await buildFullState(noisy, { scope: { projectId: descriptor.id } });
    assert.equal(scoped.operations.sections.recovery.status, 'unknown', 'empty scope recovery is unknown, never healthy');
    assert.equal(scoped.operations.sections.health.open, 0, 'no leaked health items from the noisy project');
  } finally {
    if (previousRegistry) process.env.RSTACK_REGISTRY_DIR = previousRegistry;
    else delete process.env.RSTACK_REGISTRY_DIR;
    rmSync(base, { recursive: true, force: true });
  }
});
