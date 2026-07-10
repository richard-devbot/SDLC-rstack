/**
 * Single stage-meta source (#95) — every stage table the dashboard serves is
 * generated from src/core/harness/stages.js. These tests pin that contract:
 * the generated client tables cover the canonical stages exactly (same ids,
 * same order), no page module keeps its own copy, and the stage-report
 * artifact map is derived rather than hand-mirrored.
 *
 * owner: RStack developed by Richardson Gunde
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { CANONICAL_SDLC_STAGES } from '../src/core/harness/stages.js';
import { STAGE_IDS, STUDIO_PERSONAS, stageMetaScript } from '../src/observability/dashboard/ui/stage-meta.js';
import { STAGE_ARTIFACTS } from '../src/observability/dashboard/state/stage-reports.js';
import { clientScript } from '../src/observability/dashboard/ui/client.js';
import { studio3dHtml } from '../src/observability/dashboard/ui/studio3d.js';

const CANONICAL_IDS = CANONICAL_SDLC_STAGES.map((stage) => stage.id);

// Evaluate the emitted client script to inspect the actual generated tables.
function evalStageMeta() {
  return new Function(`${stageMetaScript}
    return { STAGE_IDS, WORKFLOW_STAGE_META, STAGE_PERSONAS, STUDIO_STAGE_ORDER, STAGE_CARD_META, STAGE_CARD_ORDER };`)();
}

test('stage-meta ids come from the canonical harness list, in order', () => {
  assert.deepEqual([...STAGE_IDS], CANONICAL_IDS);
  const meta = evalStageMeta();
  assert.deepEqual(meta.STAGE_IDS, CANONICAL_IDS);
  assert.deepEqual(Object.keys(meta.WORKFLOW_STAGE_META), CANONICAL_IDS);
  assert.deepEqual(Object.keys(meta.STAGE_PERSONAS), CANONICAL_IDS);
  assert.deepEqual(Object.keys(meta.STAGE_CARD_META), CANONICAL_IDS);
  assert.deepEqual(meta.STUDIO_STAGE_ORDER, CANONICAL_IDS);
  assert.deepEqual(meta.STAGE_CARD_ORDER, CANONICAL_IDS);
});

test('generated tables keep the exact pre-split decoration values', () => {
  const meta = evalStageMeta();
  // Spot-check one entry per table against the values the monolith shipped.
  assert.deepEqual(meta.WORKFLOW_STAGE_META['00-environment'], {
    business: 'System Check',
    persona: 'IT Setup Specialist',
    role: 'Gets the studio ready',
    desc: 'Checks that every tool, folder and runtime needed for a run is available before work starts.',
    reads: 'kickoff context',
    writes: 'readiness report',
  });
  assert.deepEqual(meta.STAGE_PERSONAS['07-code'], ['Senior Developer', 'Build the Software']);
  assert.deepEqual(meta.STAGE_CARD_META['14-cost-estimation'], { icon: '💰', title: 'Cost', persona: 'FinOps Analyst' });
  // Every workflow entry ships the full six-field shape the Workflow Map reads.
  for (const id of CANONICAL_IDS) {
    assert.deepEqual(
      Object.keys(meta.WORKFLOW_STAGE_META[id]).sort(),
      ['business', 'desc', 'persona', 'reads', 'role', 'writes'],
      `workflow decor for ${id}`,
    );
    assert.equal(meta.STAGE_PERSONAS[id].length, 2, `studio persona pair for ${id}`);
  }
});

test('stage metadata exists in exactly one source in the served bundle', () => {
  const bundle = clientScript(3008);
  for (const name of ['WORKFLOW_STAGE_META', 'STAGE_PERSONAS', 'STAGE_CARD_META']) {
    const declarations = [...bundle.matchAll(new RegExp(`var ${name} =`, 'g'))];
    assert.equal(declarations.length, 1, `${name} declared exactly once (in the generated stage-meta section)`);
  }
  assert.match(bundle, /generated at process start from src\/core\/harness\/stages\.js/);
});

test('Studio 3D personas are injected from the same stage-meta source', () => {
  assert.deepEqual(Object.keys(STUDIO_PERSONAS), CANONICAL_IDS);
  const html = studio3dHtml(3008);
  for (const id of CANONICAL_IDS) {
    assert.match(html, new RegExp(`"${id}":`), `studio3d personas include ${id}`);
  }
  assert.match(html, /const PERSONAS = \{"00-environment":\["DevOps Engineer","Prepare the Workshop"\]/);
});

test('stage-report artifact map is derived from the canonical stages', () => {
  assert.deepEqual(
    STAGE_ARTIFACTS,
    Object.fromEntries(CANONICAL_SDLC_STAGES.map((stage) => [stage.id, stage.artifact])),
  );
});
