/**
 * Pure browser contracts and semantic shell for Agent Force Studio.
 *
 * owner: RStack developed by Richardson Gunde
 */
import test from 'node:test';
import assert from 'node:assert/strict';

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

test('Studio shell is semantic-first, local, and independent of a fixed port', () => {
  const html = studio3dHtml();

  assert.match(html, /<main id="studio-app"/);
  assert.match(html, /<canvas id="studio-canvas" aria-hidden="true"/);
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
