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
const themeButton = document.getElementById('studio-theme');
const cameraButton = document.getElementById('studio-camera-mode');
const overviewButton = document.getElementById('studio-overview');
const semanticButton = document.getElementById('studio-semantic-toggle');
const systemMotion = matchMedia('(prefers-reduced-motion: reduce)');
let explicitMotion = null;
try { explicitMotion = localStorage.getItem('rstack.studio.motion'); } catch { /* storage is optional */ }
let currentMotion = motionMode(explicitMotion, systemMotion.matches);
// Studio look: 'twin' (Digital Twin, default) or 'classic' (authored light).
let currentTheme = 'twin';
try {
  const savedTheme = localStorage.getItem('rstack.studio.theme');
  if (savedTheme === 'twin' || savedTheme === 'classic') currentTheme = savedTheme;
} catch { /* storage is optional */ }
// Camera mode: 'cinema' (hands-free director, default) or 'explore' (manual).
let currentCamera = 'cinema';
try {
  const savedCamera = localStorage.getItem('rstack.studio.camera');
  if (savedCamera === 'cinema' || savedCamera === 'explore') currentCamera = savedCamera;
} catch { /* storage is optional */ }
let currentSnapshot = null;
let scene = null;

const dom = createStudioDom(app, {
  onRunSelect: (runKey) => transport.selectRun(runKey).catch((error) => dom.setConnection({ state: 'error', detail: error.message })),
  onSelect: (ref) => scene?.select(ref),
  onFollow: (ref) => scene?.setDirectorMode('follow', ref),
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

// The theme drives both the 3D palette (via scene rebuild) and the 2D chrome
// (via the data attribute the stylesheet keys on). Guard the optional button so
// the studio still works if the markup ever omits it. The label names the NEXT
// action, so this is a plain action button — no aria-pressed toggle state
// (CodeRabbit, PR #436).
function applyThemeChrome(theme) {
  app.dataset.studioTheme = theme;
  if (!themeButton) return;
  themeButton.textContent = theme === 'twin' ? 'Classic look' : 'Studio look';
}

// Camera-mode chrome. Like the theme button, the label names the NEXT action.
// The scene owns the actual director state and reports changes back through
// onDirectorMode (a camera grab or any selection exits cinema on its own).
function applyCameraChrome(mode) {
  currentCamera = mode;
  app.dataset.studioCamera = mode;
  // Follow rides a specific live entity — never restore it across reloads.
  if (mode !== 'follow') {
    try { localStorage.setItem('rstack.studio.camera', mode); } catch { /* storage is optional */ }
  }
  if (!cameraButton) return;
  cameraButton.textContent = mode === 'cinema' ? 'Take control'
    : mode === 'follow' ? 'Stop following'
    : 'Cinema mode';
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
      theme: currentTheme,
      onSelect: (ref) => dom.select(ref, { focus: false }),
      onDirectorMode: applyCameraChrome,
      onDiagnostics: (stats) => {
        app.dataset.studioQualityTier = stats.qualityTier;
        app.dataset.studioGpu = stats.gpuTier;
        app.dataset.studioDrawCalls = String(stats.drawCalls);
        app.dataset.studioTriangles = String(stats.triangles);
        app.dataset.studioActiveRigs = String(stats.activeRigs);
        app.dataset.studioActiveTransitions = String(stats.activeTransitions);
        app.dataset.studioManagerState = stats.managerState;
        app.dataset.studioManagerAction = stats.managerAction ?? '';
        app.dataset.studioManagerX = stats.managerX === null ? '' : String(stats.managerX);
        app.dataset.studioManagerZ = stats.managerZ === null ? '' : String(stats.managerZ);
        app.dataset.studioActiveCaptions = String(stats.activeCaptions);
        app.dataset.studioActionCaptions = String(stats.actionCaptions);
        app.dataset.studioCameraMoving = String(stats.cameraMoving);
        app.dataset.studioTransitionCostMs = stats.transitionCostMs.toFixed(3);
      },
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
    scene.setDirectorMode(currentCamera);
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
cameraButton?.addEventListener('click', () => {
  // cinema → take control (explore) · follow → stop (explore) · explore → cinema
  const next = currentCamera === 'explore' ? 'cinema' : 'explore';
  applyCameraChrome(next);
  scene?.setDirectorMode(next);
});
themeButton?.addEventListener('click', () => {
  currentTheme = currentTheme === 'twin' ? 'classic' : 'twin';
  try { localStorage.setItem('rstack.studio.theme', currentTheme); } catch { /* storage is optional */ }
  applyThemeChrome(currentTheme);
  // Rebuild the 3D scene with the new palette. Cheap and rare; avoids keeping a
  // live material-restore path in sync. Semantic-only view has no scene to swap.
  if (scene) {
    scene.destroy();
    scene = null;
    if (currentSnapshot && app.dataset.renderer !== 'semantic-only') {
      const validated = validateStudioSnapshot(currentSnapshot);
      if (validated.ok) ensureScene(validated.studio);
    }
  }
});
overviewButton.addEventListener('click', () => scene?.select({ kind: 'orchestrator', id: currentSnapshot?.studio?.orchestrator?.id }, { overview: true }));
semanticButton.addEventListener('click', () => {
  const semanticOnly = app.dataset.renderer !== 'semantic-only';
  app.dataset.renderer = semanticOnly ? 'semantic-only' : (scene ? 'three' : 'semantic');
  semanticButton.setAttribute('aria-pressed', String(semanticOnly));
  semanticButton.textContent = semanticOnly ? 'Show 3D view' : 'Semantic view';
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
applyThemeChrome(currentTheme);
applyCameraChrome(currentCamera);
transport.start();
