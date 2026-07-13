/**
 * Three.js runtime for the Agent Force living company floor.
 *
 * owner: RStack developed by Richardson Gunde
 */
/* global ResizeObserver, performance, devicePixelRatio */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createAgentAnimator } from './animator.js';
import { restingBehavior } from './behavior.js';
import {
  createCapabilityInstances,
  createEntityFactories,
  createMissionRoutes,
  createResourcePool,
  createWorkPacket,
} from './geometry.js';
import { assignOfficeProjection, createOfficeEnvironment } from './office.js';
import { createStudioOverlays } from './overlays.js';
import { createEntityReconciler } from './reconciler.js';
import { STUDIO_TOPOLOGY } from './topology.js';
import { createTransitionScheduler } from './transitions.js';

const QUALITY = Object.freeze({
  high: { pixelRatio: 1.5, shadows: true },
  balanced: { pixelRatio: 1.25, shadows: false },
  low: { pixelRatio: 1, shadows: false },
});
const QUALITY_ORDER = ['high', 'balanced', 'low'];

function easeInOut(value) {
  return value < 0.5 ? 2 * value * value : 1 - Math.pow(-2 * value + 2, 2) / 2;
}

export function createStudioScene(canvas, {
  motion = 'full',
  overlayRoot = null,
  onSelect = () => {},
  onRendererState = () => {},
} = {}) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
    alpha: false,
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.98;
  renderer.setClearColor(0xcbd2cf, 1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0xcbd2cf, 0.012);
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 120);
  camera.position.fromArray(STUDIO_TOPOLOGY.overviewCamera);
  const controls = new OrbitControls(camera, canvas);
  controls.target.fromArray(STUDIO_TOPOLOGY.overviewTarget);
  controls.enableDamping = true;
  controls.dampingFactor = 0.075;
  controls.minDistance = 5;
  controls.maxDistance = 52;
  controls.maxPolarAngle = Math.PI * 0.48;
  controls.minPolarAngle = Math.PI * 0.12;
  controls.enablePan = false;

  const ambient = new THREE.HemisphereLight(0xf6fbff, 0x73736a, 2.05);
  const key = new THREE.DirectionalLight(0xfff1d1, 2.4);
  key.position.set(8, 19, 11);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -20;
  key.shadow.camera.right = 20;
  key.shadow.camera.top = 20;
  key.shadow.camera.bottom = -20;
  const rim = new THREE.DirectionalLight(0x9ed9e5, 1.1);
  rim.position.set(-16, 9, -11);
  scene.add(ambient, key, rim);

  const pool = createResourcePool();
  const office = createOfficeEnvironment(pool);
  scene.add(office.object);
  const reconciler = createEntityReconciler({
    scene,
    factories: createEntityFactories(pool),
  });
  const workstationBySession = new Map();
  let overlays = null;

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const pauseReasons = new Set();
  let projection = null;
  let selectedRef = null;
  let capabilityInstances = null;
  let missionRoutes = null;
  let motionMode = motion === 'reduced' ? 'reduced' : 'full';
  let qualityTier = 'high';
  let frameCount = 0;
  let frameCost = 0;
  let previousFrame = performance.now();
  let lastTierChange = 0;
  let cameraTween = null;
  let destroyed = false;
  let firstTimeline = true;
  let controlsActive = false;
  let transitionCostMs = 0;

  const animator = createAgentAnimator({
    scene,
    getHandle: (sessionId) => reconciler.get({ kind: 'session', id: sessionId }),
    getWorkstation: (sessionId) => workstationBySession.get(sessionId) ?? null,
    createPacket: (kind) => createWorkPacket(pool, kind),
  });

  let transitionStorage = null;
  try { transitionStorage = globalThis.sessionStorage ?? null; } catch { /* storage is optional */ }
  const transitions = createTransitionScheduler({
    apply: (transition) => animator.play(transition),
    storage: transitionStorage,
  });
  transitions.setMotion(motionMode);
  animator.setMotion(motionMode);

  if (overlayRoot) {
    overlays = createStudioOverlays(overlayRoot, {
      onSelect: (ref) => {
        if (select(ref)) onSelect(ref);
      },
    });
  }

  function disposeDynamic(object) {
    if (!object) return;
    scene.remove(object);
    object.userData.dispose?.();
  }

  function refreshProjectionGeometry() {
    disposeDynamic(capabilityInstances);
    disposeDynamic(missionRoutes);
    capabilityInstances = createCapabilityInstances(projection, pool);
    missionRoutes = createMissionRoutes(projection);
    scene.add(capabilityInstances, missionRoutes);
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width || canvas.clientWidth || 1));
    const height = Math.max(1, Math.floor(rect.height || canvas.clientHeight || 1));
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  }

  function applyQuality(tier) {
    qualityTier = tier;
    const quality = QUALITY[tier];
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, quality.pixelRatio));
    renderer.shadowMap.enabled = quality.shadows;
    key.castShadow = quality.shadows;
    resize();
  }

  function samplePerformance(now) {
    const elapsed = Math.max(0, now - previousFrame);
    previousFrame = now;
    frameCount += 1;
    frameCost += elapsed;
    if (frameCount < 120) return;
    const average = frameCost / frameCount;
    frameCount = 0;
    frameCost = 0;
    if (average <= 24 || now - lastTierChange < 30_000) return;
    const index = QUALITY_ORDER.indexOf(qualityTier);
    if (index < QUALITY_ORDER.length - 1) {
      applyQuality(QUALITY_ORDER[index + 1]);
      lastTierChange = now;
    }
  }

  function updateCameraTween(now) {
    if (!cameraTween) return false;
    const progress = Math.min(1, Math.max(0, (now - cameraTween.startedAt) / cameraTween.duration));
    const eased = easeInOut(progress);
    camera.position.lerpVectors(cameraTween.fromPosition, cameraTween.toPosition, eased);
    controls.target.lerpVectors(cameraTween.fromTarget, cameraTween.toTarget, eased);
    if (progress >= 1) cameraTween = null;
    return Boolean(cameraTween);
  }

  function renderFrame(now) {
    if (destroyed || pauseReasons.size) return;
    transitions.tick(now);
    const transitionStarted = performance.now();
    const workforceActive = animator.update(now);
    transitionCostMs = performance.now() - transitionStarted;
    updateCameraTween(now);
    controls.update();
    overlays?.update(camera, reconciler.entries(), canvas.getBoundingClientRect());
    renderer.render(scene, camera);
    samplePerformance(now);
    if (!workforceActive && transitions.pending() === 0 && !cameraTween && !controlsActive) {
      renderer.setAnimationLoop(null);
    }
  }

  function startLoop() {
    if (destroyed || pauseReasons.size) return;
    previousFrame = performance.now();
    renderer.setAnimationLoop(renderFrame);
  }

  function moveCameraTo(position, target) {
    if (motionMode === 'reduced') {
      camera.position.copy(position);
      controls.target.copy(target);
      controls.update();
    } else {
      cameraTween = {
        fromPosition: camera.position.clone(),
        toPosition: position,
        fromTarget: controls.target.clone(),
        toTarget: target,
        startedAt: performance.now(),
        duration: 560,
      };
    }
    startLoop();
    return true;
  }

  function focus(ref, level = 'agent') {
    if (level === 'company' || !ref) {
      return moveCameraTo(
        new THREE.Vector3(...STUDIO_TOPOLOGY.overviewCamera),
        new THREE.Vector3(...STUDIO_TOPOLOGY.overviewTarget),
      );
    }
    const handle = reconciler.get(ref);
    if (!handle) return false;
    const target = new THREE.Box3().setFromObject(handle.object).getCenter(new THREE.Vector3());
    const offset = level === 'mission'
      ? new THREE.Vector3(8.5, 8, 10.5)
      : new THREE.Vector3(3.8, 3.1, 5.2);
    return moveCameraTo(target.clone().add(offset), target);
  }

  function select(ref, options = {}) {
    if (options.overview) {
      selectedRef = null;
      return focus(null, 'company');
    }
    if (!reconciler.get(ref)) return false;
    selectedRef = ref;
    overlays?.select(ref);
    const level = options.level ?? (ref.kind === 'session' ? 'agent' : 'mission');
    return focus(ref, level);
  }

  function onPointerUp(event) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(scene.children, true);
    const hit = hits.find((entry) => entry.object.userData.interactive && entry.object.userData.entityRef);
    if (!hit) return;
    const ref = hit.object.userData.entityRef;
    if (select(ref)) onSelect(ref);
  }

  function applyRestingStates() {
    (projection.sessions ?? []).slice(-16).forEach((session) => {
      const handle = reconciler.get({ kind: 'session', id: session.id });
      if (!handle) return;
      const workstation = workstationBySession.get(session.id);
      if (workstation) {
        handle.object.position.copy(workstation.seat.getWorldPosition(new THREE.Vector3()));
        handle.setPose(restingBehavior(session));
      } else {
        const observedPose = restingBehavior(session);
        handle.setPose(observedPose === 'seated_work' || observedPose === 'validating' ? 'standing' : observedPose);
      }
    });
  }

  function reconcile(nextProjection) {
    projection = nextProjection;
    const assigned = assignOfficeProjection(office, projection, pool);
    workstationBySession.clear();
    assigned.forEach((desk, sessionId) => workstationBySession.set(sessionId, desk));
    reconciler.apply(projection);
    applyRestingStates();
    overlays?.reconcile(projection, reconciler.entries());
    refreshProjectionGeometry();
    transitions.ingest(projection.timeline, { prime: firstTimeline });
    firstTimeline = false;
    if (selectedRef && !reconciler.get(selectedRef)) selectedRef = null;
    startLoop();
  }

  function setMotion(nextMotion) {
    motionMode = nextMotion === 'reduced' ? 'reduced' : 'full';
    transitions.setMotion(motionMode);
    animator.setMotion(motionMode);
    if (motionMode === 'reduced') cameraTween = null;
    startLoop();
  }

  function pause(reason = 'manual') {
    pauseReasons.add(reason);
    transitions.pause(reason);
    animator.freeze();
    renderer.setAnimationLoop(null);
  }

  function resume(reason = 'manual') {
    pauseReasons.delete(reason);
    transitions.resume(reason);
    if (pauseReasons.size) return;
    animator.resume();
    startLoop();
  }

  function diagnostics() {
    return {
      qualityTier,
      drawCalls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      geometries: renderer.info.memory.geometries,
      textures: renderer.info.memory.textures,
      activeRigs: reconciler.entries().filter(([entry]) => entry.startsWith('session:')).length,
      activeTransitions: animator.activeCount(),
      transitionCostMs,
    };
  }

  function onContextLost(event) {
    event.preventDefault();
    pause('context-lost');
    onRendererState('context-lost');
  }

  function onContextRestored() {
    try {
      renderer.resetState();
      if (projection) reconcile(projection);
      resume('context-lost');
      onRendererState('ready');
    } catch {
      pause('context-lost');
      onRendererState('semantic-fallback');
    }
  }

  function onControlsStart() {
    controlsActive = true;
    startLoop();
  }

  function onControlsEnd() {
    controlsActive = false;
    startLoop();
  }

  function onResize() {
    resize();
    startLoop();
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    renderer.setAnimationLoop(null);
    resizeObserver.disconnect();
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('webglcontextlost', onContextLost);
    canvas.removeEventListener('webglcontextrestored', onContextRestored);
    controls.removeEventListener('start', onControlsStart);
    controls.removeEventListener('end', onControlsEnd);
    reconciler.clear();
    transitions.clear();
    animator.clear();
    overlays?.clear();
    workstationBySession.clear();
    [...office.desks.builder, ...office.desks.validator].forEach((desk) => { desk.occupant = null; });
    disposeDynamic(capabilityInstances);
    disposeDynamic(missionRoutes);
    office.dispose();
    controls.dispose();
    pool.dispose();
    renderer.dispose();
  }

  const resizeObserver = new ResizeObserver(onResize);
  resizeObserver.observe(canvas);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('webglcontextlost', onContextLost, false);
  canvas.addEventListener('webglcontextrestored', onContextRestored, false);
  controls.addEventListener('start', onControlsStart);
  controls.addEventListener('end', onControlsEnd);
  applyQuality('high');
  resize();
  controls.update();
  startLoop();
  onRendererState('ready');

  return {
    reconcile,
    select,
    focus,
    setMotion,
    diagnostics,
    pause,
    resume,
    destroy,
  };
}
