/**
 * Canonical mission topology for Agent Force Studio.
 *
 * owner: RStack developed by Richardson Gunde
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { CANONICAL_SDLC_STAGES } from '../src/core/harness/stages.js';
import {
  MISSION_STAGE_IDS,
  RSTACK_MISSIONS,
  getRstackMission,
} from '../src/core/harness/missions.js';

test('eight missions reuse all fifteen canonical departments without copies', () => {
  assert.equal(RSTACK_MISSIONS.length, 8);
  assert.deepEqual(RSTACK_MISSIONS.map((mission) => mission.id), [
    '001-product-clarification',
    '002-requirements',
    '003-architecture',
    '004-implementation',
    '005-testing',
    '006-security-review',
    '007-documentation',
    '008-release-readiness',
  ]);

  const canonical = new Set(CANONICAL_SDLC_STAGES.map((stage) => stage.id));
  const used = new Set(RSTACK_MISSIONS.flatMap((mission) => mission.stageIds));

  assert.deepEqual(used, canonical);
  assert.deepEqual(MISSION_STAGE_IDS['003-architecture'], [
    '06-architecture',
    '12-security-threat-model',
    '14-cost-estimation',
  ]);
  assert.deepEqual(MISSION_STAGE_IDS['006-security-review'], [
    '12-security-threat-model',
    '13-compliance-checker',
  ]);
  assert.equal(getRstackMission('missing'), null);
});

test('mission and stage arrays are immutable shared metadata', () => {
  assert.equal(Object.isFrozen(RSTACK_MISSIONS), true);
  assert.equal(Object.isFrozen(RSTACK_MISSIONS[0]), true);
  assert.equal(Object.isFrozen(RSTACK_MISSIONS[0].domains), true);
  assert.equal(Object.isFrozen(RSTACK_MISSIONS[0].stageIds), true);
  assert.equal(Object.isFrozen(MISSION_STAGE_IDS), true);
});
