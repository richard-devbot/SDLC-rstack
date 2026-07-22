/**
 * Historical taxonomy snapshotting (#447): a run renders through the stage
 * taxonomy it was STARTED under (frozen in manifest.stage_taxonomy), not
 * whatever stages.js says today. Renaming/adding/removing a canonical stage
 * later cannot retro-hallucinate a past run. Pre-#447 runs (no snapshot) fall
 * back to the current canonical list.
 *
 * owner: RStack developed by Richardson Gunde
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildPipelineState } from '../src/core/harness/pipeline-state.js';
import { CANONICAL_SDLC_STAGES } from '../src/core/harness/stages.js';

function seedRun(runId, manifestExtra) {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-taxonomy-'));
  const runDir = join(projectRoot, '.rstack', 'runs', runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, 'manifest.json'), JSON.stringify({ run_id: runId, status: 'DONE', ...manifestExtra }));
  writeFileSync(join(runDir, 'tasks.json'), JSON.stringify({ tasks: [] }));
  return { projectRoot };
}

test('a run renders through its OWN frozen taxonomy, not the current canonical list', async (t) => {
  const runId = '2026-07-22T00-00-00-000Z-taxo';
  const { projectRoot } = seedRun(runId, {
    stage_taxonomy: [
      { id: '00-environment', title: 'Environment', agent: 'agent.00', artifact: 'env.json' },
      { id: '99-legacy-only', title: 'Legacy-Only Stage', agent: 'agent.99', artifact: 'legacy.json' },
    ],
  });
  t.after(() => rmSync(projectRoot, { recursive: true, force: true }));

  const state = await buildPipelineState(projectRoot, runId);
  assert.equal(state.stages.length, 2, 'exactly the snapshot stages, not the 15 canonical');
  assert.deepEqual(state.stages.map((s) => s.id), ['00-environment', '99-legacy-only']);
  assert.equal(state.stages[1].title, 'Legacy-Only Stage', 'the past run keeps its own stage title');
  assert.ok(!state.stages.some((s) => s.id === '07-code'), 'a stage absent from the snapshot does not appear');
});

test('a pre-#447 run (no snapshot) falls back to the current canonical taxonomy', async (t) => {
  const runId = '2026-07-22T00-00-01-000Z-legacy';
  const { projectRoot } = seedRun(runId, {}); // no stage_taxonomy
  t.after(() => rmSync(projectRoot, { recursive: true, force: true }));

  const state = await buildPipelineState(projectRoot, runId);
  assert.equal(state.stages.length, CANONICAL_SDLC_STAGES.length, 'legacy runs use canonical');
  assert.deepEqual(state.stages.map((s) => s.id), CANONICAL_SDLC_STAGES.map((s) => s.id));
});
