/**
 * Three.js runtime for the Agent Force company floor.
 *
 * owner: RStack developed by Richardson Gunde
 */
/* global ResizeObserver, performance, devicePixelRatio */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  createCapabilityInstances,
  createEntityFactories,
  createFloorFoundation,
  createMissionRoutes,
  createResourcePool,
  createSupportFacilities,
  createWorkCapsule,
} from './geometry.js';
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
  renderer.toneMappingExposure = 1.08;
  renderer.setClearColor(0x080b10, 1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x080b10, 0.022);
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 120);
  camera.position.fromArray(STUDIO_TOPOLOGY.overviewCamera);
  const controls = new OrbitControls(camera, canvas);
  controls.target.fromArray(STUDIO_TOPOLOGY.overviewTarget);
  controls.enableDamping = true;
  controls.dampingFactor = 0.075;
  controls.minDistance = 11;
  controls.maxDistance = 48;
  controls.maxPolarAngle = Math.PI * 0.47;
  controls.minPolarAngle = Math.PI * 0.16;
  controls.enablePan = false;

  const ambient = new THREE.HemisphereLight(0xc8ddff, 0x16100a, 1.45);
  const key = new THREE.DirectionalLight(0xffe0a3, 2.2);
  key.position.set(8, 19, 11);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -20;
  key.shadow.camera.right = 20;
  key.shadow.camera.top = 20;
  key.shadow.camera.bottom = -20;
  const rim = new THREE.DirectionalLight(0x5a89cf, 1.25);
  rim.position.set(-16, 9, -11);
  scene.add(ambient, key, rim);

  const pool = createResourcePool();
  const foundation = createFloorFoundation(pool);
  const facilities = createSupportFacilities(pool);
  scene.add(foundation, facilities);
  const reconciler = createEntityReconciler({
    scene,
    factories: createEntityFactories(pool),
  });

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const pauseReasons = new Set();
  let projection = null;
  let selectedRef = null;
  let capabilityInstances = null;
  let missionRoutes = null;
  let motionMode = motion;
  let qualityTier = 'high';
  let frameCount = 0;
  let frameCost = 0;
  let previousFrame = performance.now();
  let lastTierChange = 0;
  let cameraTween = null;
  let destroyed = false;
  let firstTimeline = true;
  const activeTransitions = [];

  function missionPosition(taskId) {
    const index = Math.max(0, (projection?.missions ?? []).findIndex((mission) => mission.id === taskId));
    return new THREE.Vector3(...STUDIO_TOPOLOGY.missions[index].position);
  }

  function sessionObject(event) {
    const sessionId = event?.session_id ?? event?.entity_id;
    return sessionId ? reconciler.get({ kind: 'session', id: sessionId })?.object : null;
  }

  function objectPosition(object, fallback) {
    return object?.getWorldPosition(new THREE.Vector3()) ?? fallback.clone();
  }

  function pulseEntity(transition, object) {
    if (!object) return;
    if (transition.duration_ms === 0) return;
    activeTransitions.push({
      kind: 'scale',
      object,
      fromScale: object.scale.clone(),
      startedAt: transition.started_at_ms,
      duration: transition.duration_ms,
    });
  }

  function moveCapsule(transition, from, to) {
    if (transition.duration_ms === 0) return;
    const capsule = createWorkCapsule(pool, transition.kind === 'artifact' ? 'artifact' : 'delegation');
    capsule.position.copy(from);
    capsule.position.y += 1.15;
    capsule.visible = true;
    scene.add(capsule);
    activeTransitions.push({
      kind: 'capsule',
      object: capsule,
      from: capsule.position.clone(),
      to: to.clone().add(new THREE.Vector3(0, 1.15, 0)),
      startedAt: transition.started_at_ms,
      duration: transition.duration_ms,
    });
  }

  function playTransition(transition) {
    const event = transition.event;
    const hq = new THREE.Vector3(...STUDIO_TOPOLOGY.orchestrator.position);
    const mission = missionPosition(event?.task_id);
    const session = sessionObject(event);
    const sessionPosition = objectPosition(session, mission);

    if (transition.kind === 'dispatch' || transition.kind === 'retry') {
      moveCapsule(transition, hq, mission);
    } else if (transition.kind === 'materialize') {
      const origin = new THREE.Vector3(...(event?.role === 'validator'
        ? STUDIO_TOPOLOGY.validator.position
        : STUDIO_TOPOLOGY.builderPool.position));
      moveCapsule(transition, origin, sessionPosition);
      pulseEntity(transition, session);
    } else if (transition.kind === 'governance') {
      moveCapsule(transition, sessionPosition, new THREE.Vector3(...STUDIO_TOPOLOGY.governance.position));
    } else if (transition.kind === 'handoff') {
      moveCapsule(transition, sessionPosition, new THREE.Vector3(...STUDIO_TOPOLOGY.validator.position));
    } else if (transition.kind === 'artifact') {
      moveCapsule(transition, sessionPosition, new THREE.Vector3(...STUDIO_TOPOLOGY.evidence.position));
    } else {
      pulseEntity(transition, session);
    }
  }

  let transitionStorage = null;
  try { transitionStorage = globalThis.sessionStorage ?? null; } catch { /* storage is optional */ }
  const transitions = createTransitionScheduler({ apply: playTransition, storage: transitionStorage });

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
    if (!cameraTween) return;
    const progress = Math.min(1, (now - cameraTween.startedAt) / cameraTween.duration);
    const eased = easeInOut(progress);
    camera.position.lerpVectors(cameraTween.fromPosition, cameraTween.toPosition, eased);
    controls.target.lerpVectors(cameraTween.fromTarget, cameraTween.toTarget, eased);
    if (progress >= 1) cameraTween = null;
  }

  function updateActiveTransitions(now) {
    for (let index = activeTransitions.length - 1; index >= 0; index -= 1) {
      const transition = activeTransitions[index];
      const progress = Math.min(1, Math.max(0, (now - transition.startedAt) / transition.duration));
      const eased = easeInOut(progress);
      if (transition.kind === 'capsule') {
        transition.object.position.lerpVectors(transition.from, transition.to, eased);
      } else {
        const pulse = 1 + Math.sin(progress * Math.PI) * 0.22;
        transition.object.scale.copy(transition.fromScale).multiplyScalar(pulse);
      }
      if (progress < 1) continue;
      if (transition.kind === 'capsule') scene.remove(transition.object);
      else transition.object.scale.copy(transition.fromScale);
      activeTransitions.splice(index, 1);
    }
  }

  function renderFrame(now) {
    if (destroyed || pauseReasons.size) return;
    transitions.tick(now);
    updateActiveTransitions(now);
    updateCameraTween(now);
    controls.update();
    renderer.render(scene, camera);
    samplePerformance(now);
  }

  function startLoop() {
    if (!destroyed && pauseReasons.size === 0) {
      previousFrame = performance.now();
      renderer.setAnimationLoop(renderFrame);
    }
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width || canvas.clientWidth || 1));
    const height = Math.max(1, Math.floor(rect.height || canvas.clientHeight || 1));
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  }

  function focusObject(object, { overview = false } = {}) {
    const target = overview
      ? new THREE.Vector3(...STUDIO_TOPOLOGY.overviewTarget)
      : new THREE.Box3().setFromObject(object).getCenter(new THREE.Vector3());
    const position = overview
      ? new THREE.Vector3(...STUDIO_TOPOLOGY.overviewCamera)
      : target.clone().add(new THREE.Vector3(6.5, 6, 8.5));
    if (motionMode === 'reduced') {
      camera.position.copy(position);
      controls.target.copy(target);
      controls.update();
      return;
    }
    cameraTween = {
      fromPosition: camera.position.clone(),
      toPosition: position,
      fromTarget: controls.target.clone(),
      toTarget: target,
      startedAt: performance.now(),
      duration: 560,
    };
  }

  function select(ref, options = {}) {
    if (options.overview) {
      selectedRef = null;
      focusObject(foundation, { overview: true });
      return true;
    }
    const handle = reconciler.get(ref);
    if (!handle) return false;
    selectedRef = ref;
    focusObject(handle.object, options);
    return true;
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

  function reconcile(nextProjection) {
    projection = nextProjection;
    reconciler.apply(projection);
    refreshProjectionGeometry();
    transitions.ingest(projection.timeline, { prime: firstTimeline });
    firstTimeline = false;
    if (selectedRef && !reconciler.get(selectedRef)) selectedRef = null;
  }

  function setMotion(nextMotion) {
    motionMode = nextMotion === 'reduced' ? 'reduced' : 'full';
    transitions.setMotion(motionMode);
    if (motionMode === 'reduced') cameraTween = null;
  }

  function pause(reason = 'manual') {
    pauseReasons.add(reason);
    transitions.pause(reason);
    renderer.setAnimationLoop(null);
  }

  function resume(reason = 'manual') {
    pauseReasons.delete(reason);
    transitions.resume(reason);
    startLoop();
  }

  function diagnostics() {
    return {
      qualityTier,
      drawCalls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      geometries: renderer.info.memory.geometries,
      textures: renderer.info.memory.textures,
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

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    renderer.setAnimationLoop(null);
    resizeObserver.disconnect();
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('webglcontextlost', onContextLost);
    canvas.removeEventListener('webglcontextrestored', onContextRestored);
    reconciler.clear();
    transitions.clear();
    activeTransitions.splice(0).forEach((transition) => {
      if (transition.kind === 'capsule') scene.remove(transition.object);
      else transition.object.scale.copy(transition.fromScale);
    });
    disposeDynamic(capabilityInstances);
    disposeDynamic(missionRoutes);
    foundation.userData.dispose?.();
    scene.remove(foundation, facilities);
    controls.dispose();
    pool.dispose();
    renderer.dispose();
  }

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('webglcontextlost', onContextLost, false);
  canvas.addEventListener('webglcontextrestored', onContextRestored, false);
  applyQuality('high');
  resize();
  controls.update();
  startLoop();
  onRendererState('ready');

  return {
    reconcile,
    select,
    setMotion,
    diagnostics,
    pause,
    resume,
    destroy,
  };
}
