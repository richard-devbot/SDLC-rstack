/**
 * Pure browser contracts and semantic shell for Agent Force Studio.
 *
 * owner: RStack developed by Richardson Gunde
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { studio3dHtml } from '../src/observability/dashboard/ui/studio3d.js';
import {
  motionMode,
  validateStudioSnapshot,
} from '../src/observability/dashboard/ui/studio3d/model.js';
import {
  stateUrl,
  webSocketUrl,
} from '../src/observability/dashboard/ui/studio3d/transport.js';
import { createStudioDom } from '../src/observability/dashboard/ui/studio3d/dom.js';
import { STUDIO_TOPOLOGY } from '../src/observability/dashboard/ui/studio3d/topology.js';
import { createEntityReconciler } from '../src/observability/dashboard/ui/studio3d/reconciler.js';
import { createTransitionScheduler } from '../src/observability/dashboard/ui/studio3d/transitions.js';

test('Studio shell is semantic-first, local, and independent of a fixed port', () => {
  const html = studio3dHtml();

  assert.match(html, /<main id="studio-app"/);
  assert.match(html, /<canvas id="studio-canvas" aria-hidden="true"/);
  assert.match(html, /<div id="studio-overlays" class="studio-overlays" aria-hidden="true"><\/div>/);
  assert.match(html, /<section id="semantic-studio"/);
  assert.match(html, /<div id="studio-announcer"[^>]+aria-live="polite"/);
  assert.match(html, /<link rel="stylesheet" href="\/studio3d\/assets\/styles\.css">/);
  assert.match(html, /<script type="module" src="\/studio3d\/assets\/app\.js"><\/script>/);
  assert.doesNotMatch(html, /localhost|unpkg|jsdelivr|new WebSocket\('ws:/);
  assert.doesNotMatch(html, /const PERSONAS|const PORT/);
});

test('snapshot validator fails closed and accepts only schema version one', () => {
  assert.deepEqual(validateStudioSnapshot({}), {
    ok: false,
    studio: null,
    error: 'Studio projection unavailable',
  });
  assert.deepEqual(validateStudioSnapshot({ studio: { schema_version: 2 } }), {
    ok: false,
    studio: null,
    error: 'Unsupported Studio projection version',
  });
  const studio = {
    schema_version: 1,
    missions: [],
    departments: [],
    sessions: [],
    timeline: [],
    limitations: [],
  };
  assert.deepEqual(validateStudioSnapshot({ studio }), { ok: true, studio, error: null });
});

test('motion mode honors explicit choice before the operating-system preference', () => {
  assert.equal(motionMode('reduced', false), 'reduced');
  assert.equal(motionMode('full', true), 'full');
  assert.equal(motionMode(null, true), 'reduced');
  assert.equal(motionMode(null, false), 'full');
});

test('transport derives secure same-origin URLs and preserves read authentication', () => {
  assert.equal(webSocketUrl({
    protocol: 'https:',
    host: 'hub.example',
    search: '?token=read%20token&run=ignored',
  }), 'wss://hub.example/?token=read%20token');
  assert.equal(webSocketUrl({
    protocol: 'http:',
    host: '127.0.0.1:3008',
    search: '',
  }), 'ws://127.0.0.1:3008/');
  assert.equal(stateUrl({ search: '?token=read%20token' }, 'opaque::run/key'), '/api/state?run=opaque%3A%3Arun%2Fkey&token=read+token');
  assert.equal(stateUrl({ search: '' }, null), '/api/state');
});

test('semantic renderer is available without constructing WebGL', () => {
  assert.equal(typeof createStudioDom, 'function');
});

test('topology has one HQ, eight mission bays, and fifteen unique departments', () => {
  assert.equal(STUDIO_TOPOLOGY.orchestrator.id, 'orchestrator-hq');
  assert.equal(STUDIO_TOPOLOGY.missions.length, 8);
  assert.equal(new Set(STUDIO_TOPOLOGY.missions.map((item) => item.id)).size, 8);
  assert.equal(STUDIO_TOPOLOGY.departments.length, 15);
  assert.equal(new Set(STUDIO_TOPOLOGY.departments.map((item) => item.id)).size, 15);
  assert.notDeepEqual(STUDIO_TOPOLOGY.validator.position, STUDIO_TOPOLOGY.builderPool.position);
  assert.equal(Object.isFrozen(STUDIO_TOPOLOGY), true);
});

test('scene modules expose stable reconciliation, selection, diagnostics, and cleanup', () => {
  assert.equal(typeof createEntityReconciler, 'function');
  const scenePath = join(process.cwd(), 'src', 'observability', 'dashboard', 'ui', 'studio3d', 'scene.js');
  const geometryPath = join(process.cwd(), 'src', 'observability', 'dashboard', 'ui', 'studio3d', 'geometry.js');
  const overlaysPath = join(process.cwd(), 'src', 'observability', 'dashboard', 'ui', 'studio3d', 'overlays.js');
  const sceneSource = readFileSync(scenePath, 'utf8');
  const geometrySource = readFileSync(geometryPath, 'utf8');
  const overlaysSource = readFileSync(overlaysPath, 'utf8');
  for (const name of ['reconcile', 'select', 'focus', 'setMotion', 'diagnostics', 'pause', 'resume', 'destroy']) {
    assert.match(sceneSource, new RegExp(`${name}\\b`));
  }
  for (const field of ['activeRigs', 'activeTransitions', 'transitionCostMs']) {
    assert.match(sceneSource, new RegExp(`${field}\\b`));
  }
  assert.match(sceneSource, /createOfficeEnvironment/);
  assert.match(sceneSource, /createAgentAnimator/);
  assert.match(sceneSource, /createStudioOverlays/);
  assert.doesNotMatch(sceneSource, /pulseEntity|moveCapsule/);
  assert.match(sceneSource, /webglcontextlost/);
  assert.match(sceneSource, /webglcontextrestored/);
  assert.match(sceneSource, /setAnimationLoop/);
  assert.match(geometrySource, /InstancedMesh/);
  assert.match(overlaysSource, /textContent/);
  assert.match(overlaysSource, /HIGH_VALUE/);
  assert.doesNotMatch(overlaysSource, /innerHTML\s*=/);
});

test('transition scheduler animates unseen source events once and respects reduced motion', () => {
  const applied = [];
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
  const scheduler = createTransitionScheduler({ apply: (transition) => applied.push(transition), storage });
  const event = {
    id: 'event-1',
    type: 'delegation_requested',
    timestamp: '2026-07-13T10:00:00.000Z',
    source: 'events.jsonl',
    entity_id: 'session-1',
    task_id: '004-implementation',
  };

  scheduler.ingest([event]);
  scheduler.tick(0);
  scheduler.ingest([event]);
  scheduler.tick(16);
  assert.equal(applied.length, 1);
  assert.equal(applied[0].intent.action, 'delegate');
  assert.equal(applied[0].intent.sessionId, 'session-1');
  assert.equal(applied[0].duration_ms, 700);

  scheduler.setMotion('reduced');
  scheduler.ingest([{ ...event, id: 'event-2', type: 'artifact_emitted' }]);
  scheduler.tick(32);
  assert.equal(applied.length, 2);
  assert.equal(applied[1].intent.action, 'return_evidence');
  assert.equal(applied[1].duration_ms, 0);
});

test('transition scheduler can prime historical events without replaying them', () => {
  const applied = [];
  const scheduler = createTransitionScheduler({ apply: (transition) => applied.push(transition), storage: null });
  scheduler.ingest([{ id: 'historical', type: 'agent_session_started', timestamp: '2026-07-13T09:00:00.000Z', source: 'events.jsonl' }], { prime: true });
  scheduler.tick(0);
  assert.deepEqual(applied, []);
});
