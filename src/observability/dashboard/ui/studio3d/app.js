/**
 * Agent Force Studio browser composition root.
 *
 * owner: RStack developed by Richardson Gunde
 */
/* global document, window, localStorage, matchMedia */
import { createStudioDom } from './dom.js';
import { motionMode, validateStudioSnapshot } from './model.js';
import { createStudioTransport } from './transport.js';

const app = document.getElementById('studio-app');
const canvas = document.getElementById('studio-canvas');
const fallback = document.getElementById('studio-fallback');
const banner = document.getElementById('studio-renderer-banner');
const motionButton = document.getElementById('studio-motion');
const overviewButton = document.getElementById('studio-overview');
const semanticButton = document.getElementById('studio-semantic-toggle');
const systemMotion = matchMedia('(prefers-reduced-motion: reduce)');
let explicitMotion = null;
try { explicitMotion = localStorage.getItem('rstack.studio.motion'); } catch { /* storage is optional */ }
let currentMotion = motionMode(explicitMotion, systemMotion.matches);
let currentSnapshot = null;
let scene = null;

const dom = createStudioDom(app, {
  onRunSelect: (runKey) => transport.selectRun(runKey).catch((error) => dom.setConnection({ state: 'error', detail: error.message })),
  onSelect: (ref) => scene?.select(ref),
});

function supportsWebGL2() {
  try {
    const probe = document.createElement('canvas');
    return Boolean(probe.getContext('webgl2', { failIfMajorPerformanceCaveat: true }));
  } catch {
    return false;
  }
}

function applyMotion(mode) {
  currentMotion = mode;
  app.dataset.motion = mode;
  motionButton.setAttribute('aria-pressed', String(mode === 'reduced'));
  motionButton.textContent = mode === 'reduced' ? 'Use full motion' : 'Reduce motion';
  scene?.setMotion(mode);
}

async function ensureScene(studio) {
  if (scene || app.dataset.renderer === 'semantic-only') {
    scene?.reconcile(studio);
    return;
  }
  if (!supportsWebGL2()) {
    fallback.hidden = false;
    app.dataset.renderer = 'semantic';
    return;
  }
  try {
    const { createStudioScene } = await import('./scene.js');
    scene = createStudioScene(canvas, {
      motion: currentMotion,
      onSelect: (ref) => dom.select(ref, { focus: false }),
      onRendererState: (state) => {
        banner.hidden = state === 'ready';
        banner.textContent = state === 'context-lost'
          ? '3D context paused. Restoring the semantic mirror remains current.'
          : state === 'semantic-fallback' ? '3D recovery failed. Semantic Studio remains live.' : '';
        if (state === 'semantic-fallback') app.dataset.renderer = 'semantic';
      },
    });
    app.dataset.renderer = 'three';
    fallback.hidden = true;
    scene.reconcile(studio);
  } catch (error) {
    app.dataset.renderer = 'semantic';
    fallback.hidden = false;
    banner.hidden = false;
    banner.textContent = `3D module unavailable: ${error?.message ?? 'unknown error'}`;
  }
}

function acceptSnapshot(snapshot) {
  const validated = validateStudioSnapshot(snapshot);
  if (!validated.ok) {
    dom.renderUnavailable(validated.error);
    app.dataset.renderer = 'semantic';
    fallback.hidden = false;
    return;
  }
  currentSnapshot = snapshot;
  dom.render(snapshot);
  ensureScene(validated.studio);
}

const transport = createStudioTransport({
  onSnapshot: acceptSnapshot,
  onConnection: (state) => {
    dom.setConnection(state);
    if (['stale', 'disconnected', 'error'].includes(state.state)) scene?.pause(state.state);
    else if (state.state === 'live') {
      scene?.resume('stale');
      scene?.resume('disconnected');
      scene?.resume('error');
    }
  },
});

motionButton.addEventListener('click', () => {
  const next = currentMotion === 'reduced' ? 'full' : 'reduced';
  explicitMotion = next;
  try { localStorage.setItem('rstack.studio.motion', next); } catch { /* storage is optional */ }
  applyMotion(next);
});
systemMotion.addEventListener('change', () => {
  if (!explicitMotion) applyMotion(motionMode(null, systemMotion.matches));
});
overviewButton.addEventListener('click', () => scene?.select({ kind: 'orchestrator', id: currentSnapshot?.studio?.orchestrator?.id }, { overview: true }));
semanticButton.addEventListener('click', () => {
  const semanticOnly = app.dataset.renderer !== 'semantic-only';
  app.dataset.renderer = semanticOnly ? 'semantic-only' : (scene ? 'three' : 'semantic');
  semanticButton.setAttribute('aria-pressed', String(semanticOnly));
  if (semanticOnly) scene?.pause('semantic-only');
  else scene?.resume('semantic-only');
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) scene?.pause('hidden');
  else scene?.resume('hidden');
});
window.addEventListener('pagehide', () => {
  transport.stop();
  dom.destroy();
  scene?.destroy();
}, { once: true });

applyMotion(currentMotion);
transport.start();
