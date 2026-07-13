/**
 * Studio v2 (#352): visible again in the nav, and the workspace renders the
 * REAL governance surfaces — approval gates from the same records the claim
 * gate enforces (incl. #228 stage approvals and the CONSUMED override
 * lifecycle) and disk-verified checkpoint markers — never decoration.
 *
 * owner: RStack developed by Richardson Gunde
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { destinations } from '../src/observability/dashboard/ui/navigation.js';
import { studioScript } from '../src/observability/dashboard/ui/pages/studio.js';

test('Studio is a visible child of the Runs destination again', () => {
  const runs = destinations.find((destination) => destination.id === 'runs');
  const studio = runs.children.find((child) => child.id === 'studio');
  assert.ok(studio, 'studio stays routable');
  assert.equal(studio.hidden, false, 'studio is no longer hidden — it read as removed');
});

test('studio renders approval gates from the audited records, not invented state', () => {
  assert.ok(studioScript.includes('studioGateModel'), 'gate model exists');
  assert.ok(studioScript.includes("indexOf('stage-approval:')"), 'the #228 blanket gate artifacts map to their stage desk');
  assert.ok(studioScript.includes("indexOf('guardrail-override:')"), 'override artifacts map via their task');
  assert.ok(studioScript.includes('GATE CLOSED — awaiting human sign-off'), 'a pending queue card closes the gate visually');
  assert.ok(studioScript.includes('gate opened by'), 'an APPROVED record names the human who opened the gate');
  assert.ok(studioScript.includes('one-shot override consumed'), 'the CONSUMED lifecycle renders as spent, not approved');
});

test('studio renders checkpoints from the disk-verified rollup block', () => {
  assert.ok(studioScript.includes('run.checkpoints && run.checkpoints.stages'), 'reads the #215 contract');
  assert.ok(studioScript.includes('restore point'), 'restorable marker');
  assert.ok(studioScript.includes('CORRUPT — restore refused'), 'corrupt is refused honestly, never softened');
});

test('studio human rail shows who signed and who is holding gates', () => {
  assert.ok(studioScript.includes('renderStudioHumans'));
  assert.ok(studioScript.includes('HUMANS AT THE GATES'), 'the rail states the division of labor');
  assert.ok(studioScript.includes('holding'), 'pending gates show as held by a human');
  assert.ok(studioScript.includes('signed'), 'approvals credit the approver by name');
});
