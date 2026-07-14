/**
 * Three.js runtime for the Agent Force living company floor.
 *
 * owner: RStack developed by Richardson Gunde
 */
/* global ResizeObserver, performance, devicePixelRatio, document */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createAgentAnimator } from './animator.js';
import {
  createCastProp,
  createPosedProp,
  disposeStudioCast,
  loadStudioCast,
  setCastMotion,
  updateCastMixers,
} from './assets.js';
import { restingBehavior } from './behavior.js';
import {
  createCapabilityInstances,
  createEntityFactories,
  createResourcePool,
  createWorkPacket,
} from './geometry.js';
import { assignOfficeProjection, createOfficeEnvironment } from './office.js';
import { createEntityReconciler } from './reconciler.js';
import { createRobotFleetRenderer, ROBOT_PELVIS_HEIGHT } from './robot.js';
import { STUDIO_TOPOLOGY } from './topology.js';
import { createTransitionScheduler } from './transitions.js';

const QUALITY = Object.freeze({
  high: { pixelRatio: 1.5, shadows: true, frameInterval: 0 },
  balanced: { pixelRatio: 1.25, shadows: false, frameInterval: 0 },
  low: { pixelRatio: 1, shadows: false, frameInterval: 1000 / 15 },
});
const QUALITY_ORDER = ['high', 'balanced', 'low'];
const MAX_DETAILED_RIGS = 16;
// Raised from 90 for the Richardson-supplied GLB cast: the HQ battlestation
// alone carries 26 textured materials (26 draws), each occupied desk pod ~4,
// plus the 15-panel pipeline wall and two team-lead fixtures. Measured
// full-cast overview with 8 live sessions: 177 calls / 169k triangles. The
// quality loop still degrades tiers above these ceilings.
const DRAW_CALL_CEILING = 200;
const TRIANGLE_CEILING = 200_000;

function easeInOut(value) {
  return value < 0.5 ? 2 * value * value : 1 - Math.pow(-2 * value + 2, 2) / 2;
}

export function createStudioScene(canvas, {
  motion = 'full',
  onSelect = () => {},
  onDiagnostics = () => {},
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
  renderer.toneMappingExposure = 1.06;
  renderer.setClearColor(0xcbd2cf, 1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

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
  const robotFleet = createRobotFleetRenderer(pool, { maxRobots: MAX_DETAILED_RIGS + 1 });
  scene.add(robotFleet.object);
  let cast = null;
  const reconciler = createEntityReconciler({
    scene,
    factories: createEntityFactories(pool, office, () => cast),
  });
  const workstationBySession = new Map();

  // Richardson-supplied GLB cast: executive HQ set (battlestation + chair),
  // the Skills Library attendant, and the manager/worker agent bodies. Loads
  // asynchronously; until then (and on any failure) the procedural bodies
  // and furniture render, so the Studio never blanks while models stream in.
  const castProps = new THREE.Group();
  castProps.name = 'Executive cast props';
  scene.add(castProps);

  function placeCastProps() {
    if (cast?.station) {
      const station = createCastProp(cast.station);
      station.name = 'Orchestrator HQ battlestation';
      station.position.set(-5.2, 0, -10.4);
      station.rotation.y = Math.PI / 2;
      castProps.add(station);
    }
    if (cast?.chair) {
      const chair = createCastProp(cast.chair);
      chair.name = 'Orchestrator HQ chair';
      chair.position.set(-4, 0, -10.4);
      chair.rotation.y = -Math.PI / 2;
      castProps.add(chair);
    }
    if (cast?.librarian) {
      const librarian = createCastProp(cast.librarian);
      librarian.name = 'Skills Library attendant';
      librarian.position.set(-9.2, 0, -9.6);
      castProps.add(librarian);
    }
    if (cast?.worker) {
      // Richardson-directed resident team leads: one posed fixture per wing.
      // Scenery like the librarian — frozen mid-clip, no status panel, so
      // they never claim work the run didn't observe.
      const builderLead = createPosedProp(cast.worker);
      builderLead.name = 'Builder team lead desk';
      builderLead.position.set(-11.2, 0, 10.2);
      builderLead.rotation.y = Math.PI;
      castProps.add(builderLead);
      const validatorLead = createPosedProp(cast.worker);
      validatorLead.name = 'Validator team lead desk';
      validatorLead.position.set(10, 0, 7.6);
      validatorLead.rotation.y = Math.PI;
      castProps.add(validatorLead);
    }
  }

  loadStudioCast().then((loaded) => {
    if (destroyed || !loaded) return;
    cast = loaded;
    office.setPodMode?.(Boolean(cast.worker));
    placeCastProps();
    // Rebuild live entities so orchestrator/session bodies pick up the cast.
    if (projection) {
      reconciler.clear();
      reconcile(projection);
    } else {
      startLoop();
    }
  }).catch(() => { /* procedural fallback stays on screen */ });

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const pauseReasons = new Set();
  let projection = null;
  let selectedRef = null;
  let capabilityInstances = null;
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
  let lastRenderedAt = 0;

  const animator = createAgentAnimator({
    scene,
    getHandle: (sessionId) => reconciler.get({ kind: 'session', id: sessionId }),
    getOrchestrator: () => (projection?.orchestrator?.id
      ? reconciler.get({ kind: 'orchestrator', id: projection.orchestrator.id })
      : null),
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

  // ── Holographic layer ────────────────────────────────────────────────
  // Every panel, label, stream, and timeline bar below renders only
  // source-backed facts from the server projection. Robots are never
  // decorative; infrastructure and architecture carry the density.

  const STATUS_UI = Object.freeze({
    active: ['#e5b860', 'ACTIVE'],
    starting: ['#5790e6', 'STARTING'],
    queued: ['#5790e6', 'QUEUED'],
    waiting: ['#9e82ed', 'WAITING'],
    blocked: ['#e56e66', 'BLOCKED'],
    failed: ['#ff5f57', 'FAILED'],
    completed: ['#58bd86', 'COMPLETE'],
    stopped: ['#8a9097', 'STOPPED'],
    unknown: ['#8a9097', 'OBSERVED'],
  });

  function makeCanvas(width, height) {
    const canvasEl = document.createElement('canvas');
    canvasEl.width = width;
    canvasEl.height = height;
    return canvasEl;
  }

  function canvasSprite(canvasEl, { depthTest = false } = {}) {
    const texture = new THREE.CanvasTexture(canvasEl);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest });
    return new THREE.Sprite(material);
  }

  // Authored room identity labels — the floor plan itself, not runtime state.
  const ROOM_LABELS = [
    ['BUILDER TEAM', -11, 3.4, 4.5],
    ['VALIDATOR TEAM', 10, 3.4, 4],
    ['SKILL LIBRARY', -13, 3.6, -10],
    ['ORCHESTRATION CENTER', -2, 3.8, -10],
    ['GOVERNANCE', 7.5, 3.6, -10],
    ['EVIDENCE VAULT', 15.5, 3.6, -10],
    ['15-STAGE PIPELINE', 16.1, 3.6, 4],
    ['DISPATCH', -16, 2.6, 10],
  ];
  const roomLabelGroup = new THREE.Group();
  roomLabelGroup.name = 'Room labels';
  for (const [text, x, y, z] of ROOM_LABELS) {
    const canvasEl = makeCanvas(512, 84);
    const context = canvasEl.getContext('2d');
    context.fillStyle = 'rgba(18, 24, 30, 0.66)';
    const width = Math.min(500, 44 + text.length * 21);
    context.beginPath();
    context.roundRect((512 - width) / 2, 10, width, 64, 14);
    context.fill();
    context.font = '700 34px Inter, ui-sans-serif, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = '#f4f6f8';
    context.fillText(text, 256, 44);
    const sprite = canvasSprite(canvasEl, { depthTest: true });
    sprite.scale.set(4.6, 0.75, 1);
    sprite.position.set(x, y, z);
    sprite.renderOrder = 20;
    roomLabelGroup.add(sprite);
  }
  scene.add(roomLabelGroup);

  // Holographic status panels above each observed agent: goal, current
  // skill, status, and canonical stage progress (n of 15).
  const panelCache = new Map();

  function panelMaterial(key, lines) {
    if (panelCache.has(key)) {
      const entry = panelCache.get(key);
      entry.used = true;
      return entry.material;
    }
    const canvasEl = makeCanvas(512, 236);
    const context = canvasEl.getContext('2d');
    const [statusColor, statusWord] = STATUS_UI[lines.status] ?? STATUS_UI.unknown;
    context.fillStyle = 'rgba(9, 18, 26, 0.82)';
    context.beginPath();
    context.roundRect(6, 6, 500, 224, 20);
    context.fill();
    context.lineWidth = 3;
    context.strokeStyle = 'rgba(127, 220, 255, 0.65)';
    context.stroke();
    context.textBaseline = 'middle';
    context.textAlign = 'left';
    context.font = '700 36px ui-monospace, SFMono-Regular, monospace';
    context.fillStyle = '#f4f8fb';
    context.fillText(lines.title, 28, 44);
    context.font = '400 26px ui-monospace, monospace';
    context.fillStyle = '#9fb3c8';
    context.fillText(lines.goal, 28, 88);
    context.fillStyle = '#7fdcff';
    context.fillText(lines.skill, 28, 126);
    context.beginPath();
    context.arc(38, 168, 9, 0, Math.PI * 2);
    context.fillStyle = statusColor;
    context.fill();
    context.font = '700 26px ui-monospace, monospace';
    context.fillText(statusWord, 58, 168);
    context.textAlign = 'right';
    context.fillStyle = '#f4f8fb';
    context.fillText(lines.progressText, 484, 168);
    context.fillStyle = 'rgba(127, 220, 255, 0.18)';
    context.fillRect(28, 196, 456, 14);
    context.fillStyle = statusColor;
    context.fillRect(28, 196, Math.round(456 * lines.progress), 14);
    const texture = new THREE.CanvasTexture(canvasEl);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
    panelCache.set(key, { material, used: true });
    return material;
  }

  function truncate(value, length) {
    const text = String(value ?? '');
    return text.length > length ? `${text.slice(0, length - 1)}…` : text;
  }

  function syncAgentPanels() {
    const sessionById = new Map((projection.sessions ?? []).map((session) => [session.id, session]));
    const skillBySession = new Map();
    for (const attachment of projection.capability_attachments ?? []) {
      if (!skillBySession.has(attachment.session_id)) skillBySession.set(attachment.session_id, attachment.capability_id);
    }
    const departments = projection.departments ?? [];
    const total = departments.length || 15;
    for (const entry of panelCache.values()) entry.used = false;
    for (const [key, handle] of reconciler.entries()) {
      if (!handle.robot) continue;
      let panel = handle.object.getObjectByName('agentPanel');
      const isOrchestrator = key.startsWith('orchestrator:');
      const session = sessionById.get(handle.object.userData.entityRef?.id) ?? null;
      const status = handle.object.userData.status ?? 'unknown';
      const stageId = session?.stage_ids?.[0] ?? null;
      const stageIndex = stageId ? departments.findIndex((department) => department.id === stageId) : -1;
      const lines = isOrchestrator ? {
        title: 'ORCHESTRATOR',
        goal: truncate(projection.orchestrator?.goal ?? 'No goal observed', 30),
        skill: `missions ${(projection.missions ?? []).filter((mission) => mission.status !== 'unknown').length}/8`,
        status,
        progress: total ? departments.filter((department) => department.status === 'completed').length / total : 0,
        progressText: `${departments.filter((department) => department.status === 'completed').length}/${total}`,
      } : {
        title: truncate(session?.agent_id ?? handle.object.userData.entityRef?.id ?? 'agent', 22),
        goal: truncate(`goal · ${session?.task_id ?? 'unscoped'}`, 30),
        skill: truncate(`skill · ${skillBySession.get(session?.id) ?? 'none attached'}`, 30),
        status,
        progress: stageIndex >= 0 ? (stageIndex + 1) / total : 0,
        progressText: stageIndex >= 0 ? `${stageIndex + 1}/${total}` : '–/15',
      };
      const cacheKey = JSON.stringify(lines);
      if (!panel) {
        panel = canvasSprite(makeCanvas(2, 2));
        panel.name = 'agentPanel';
        panel.scale.set(2.9, 1.34, 1);
        panel.renderOrder = 30;
        handle.object.add(panel);
      }
      panel.material = panelMaterial(cacheKey, lines);
      // GLB bodies are shorter than the procedural rig envelope.
      const panelHeight = handle.seatedAtOrigin ? (isOrchestrator ? 3 : 2.5) : (isOrchestrator ? 4 : 3.85);
      panel.position.set(0, panelHeight, 0);
      panel.visible = isOrchestrator ? Boolean(projection.orchestrator) : Boolean(session);
    }
    for (const [key, entry] of panelCache) {
      if (entry.used) continue;
      entry.material.map?.dispose();
      entry.material.dispose();
      panelCache.delete(key);
    }
  }

  // Light-trail data streams: Orchestration Center → each ACTIVE session's
  // workstation. A stream exists only while its session is observed live;
  // pulses freeze on stale, disconnect, and reduced motion.
  const streamState = { object: null, pulses: null, curves: [] };

  function clearStreams() {
    if (streamState.object) {
      scene.remove(streamState.object);
      streamState.object.geometry.dispose();
      streamState.object = null;
    }
    if (streamState.pulses) {
      scene.remove(streamState.pulses);
      streamState.pulses.dispose();
      streamState.pulses = null;
    }
    streamState.curves = [];
  }

  function rebuildStreams() {
    clearStreams();
    const source = new THREE.Vector3(-2, 1.9, -10);
    const curves = [];
    (projection.sessions ?? []).slice(-MAX_DETAILED_RIGS).forEach((session) => {
      if (!['active', 'starting'].includes(session.status)) return;
      const workstation = workstationBySession.get(session.id);
      if (!workstation) return;
      const target = workstation.seat.getWorldPosition(new THREE.Vector3());
      target.y = 1.7;
      const middle = source.clone().add(target).multiplyScalar(0.5);
      middle.y = 5.4;
      curves.push(new THREE.QuadraticBezierCurve3(source.clone(), middle, target));
    });
    if (!curves.length) return;
    const positions = [];
    for (const curve of curves) {
      const points = curve.getPoints(28);
      for (let index = 0; index < points.length - 1; index += 1) {
        positions.push(
          points[index].x, points[index].y, points[index].z,
          points[index + 1].x, points[index + 1].y, points[index + 1].z,
        );
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    streamState.object = new THREE.LineSegments(geometry, pool.materials.stream);
    streamState.object.name = 'Delegation data streams';
    const pulses = new THREE.InstancedMesh(pool.geometries.sphere, pool.materials.streamPulse, curves.length * 2);
    pulses.name = 'Data stream pulses';
    pulses.frustumCulled = false;
    streamState.pulses = pulses;
    streamState.curves = curves;
    scene.add(streamState.object, pulses);
    updateStreamPulses(performance.now());
  }

  function updateStreamPulses(now) {
    if (!streamState.curves.length || !streamState.pulses) return false;
    const transform = new THREE.Object3D();
    streamState.curves.forEach((curve, index) => {
      for (let pulse = 0; pulse < 2; pulse += 1) {
        const t = motionMode === 'reduced'
          ? (index * 0.37 + pulse * 0.5) % 1
          : ((now / 2600) + index * 0.37 + pulse * 0.5) % 1;
        transform.position.copy(curve.getPoint(t));
        transform.scale.setScalar(0.13);
        transform.updateMatrix();
        streamState.pulses.setMatrixAt(index * 2 + pulse, transform.matrix);
      }
    });
    streamState.pulses.instanceMatrix.needsUpdate = true;
    return motionMode !== 'reduced';
  }

  // The Orchestration Center wall screen paints the REAL fifteen-stage
  // rollup from the projection — a live global project timeline.
  let timelineMaterial = null;

  function paintGlobalTimeline() {
    const departments = projection.departments ?? [];
    const canvasEl = makeCanvas(512, 236);
    const context = canvasEl.getContext('2d');
    context.fillStyle = '#0b141c';
    context.fillRect(0, 0, 512, 236);
    departments.slice(0, 15).forEach((department, index) => {
      const [statusColor] = STATUS_UI[department.status] ?? STATUS_UI.unknown;
      const y = 12 + index * 14.6;
      context.fillStyle = 'rgba(127, 220, 255, 0.12)';
      context.fillRect(16, y, 480, 9);
      const width = department.status === 'completed' ? 480
        : ['active', 'starting', 'waiting', 'blocked', 'failed'].includes(department.status) ? 250 : 56;
      context.fillStyle = department.status === 'unknown' ? 'rgba(138, 144, 151, 0.35)' : statusColor;
      context.fillRect(16 + index * 6, y, Math.min(width, 480 - index * 6), 9);
    });
    const texture = new THREE.CanvasTexture(canvasEl);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.MeshBasicMaterial({ map: texture });
    if (timelineMaterial) {
      timelineMaterial.map?.dispose();
      timelineMaterial.dispose();
    }
    timelineMaterial = material;
    office.timelineScreen.material = material;
  }

  function disposeDynamic(object) {
    if (!object) return;
    scene.remove(object);
    object.userData.dispose?.();
  }

  function refreshProjectionGeometry() {
    disposeDynamic(capabilityInstances);
    capabilityInstances = createCapabilityInstances(projection, pool);
    scene.add(capabilityInstances);
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

  function enforceQualityCeilings(now) {
    const overGeometryBudget = renderer.info.render.calls > DRAW_CALL_CEILING
      || renderer.info.render.triangles > TRIANGLE_CEILING;
    const overCpuBudget = transitionCostMs > 4;
    if ((!overGeometryBudget && !overCpuBudget) || now - lastTierChange < 2_000) return;
    const index = QUALITY_ORDER.indexOf(qualityTier);
    if (index < QUALITY_ORDER.length - 1) {
      applyQuality(QUALITY_ORDER[index + 1]);
      lastTierChange = now;
    }
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
    const frameInterval = QUALITY[qualityTier].frameInterval;
    if (frameInterval && now - lastRenderedAt < frameInterval) return;
    lastRenderedAt = now;
    transitions.tick(now);
    const transitionStarted = performance.now();
    const workforceActive = animator.update(now);
    transitionCostMs = performance.now() - transitionStarted;
    const castAnimating = updateCastMixers(now);
    const streamsFlowing = updateStreamPulses(now);
    robotFleet.update();
    updateCameraTween(now);
    controls.update();
    renderer.render(scene, camera);
    samplePerformance(now);
    enforceQualityCeilings(now);
    onDiagnostics(diagnostics());
    if (!workforceActive && !castAnimating && transitions.pending() === 0 && !cameraTween && !controlsActive && !streamsFlowing) {
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
    const level = options.level ?? (ref.kind === 'session' ? 'agent' : 'mission');
    return focus(ref, level);
  }

  function onPointerUp(event) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(scene.children, true);
    const hit = hits.find((entry) => entry.object.userData.interactive && (
      entry.object.userData.entityRef || entry.object.userData.entityRefs?.[entry.instanceId]
    ));
    if (!hit) return;
    const ref = hit.object.userData.entityRef ?? hit.object.userData.entityRefs?.[hit.instanceId];
    if (select(ref)) onSelect(ref);
  }

  function applyRestingStates() {
    (projection.sessions ?? []).slice(-MAX_DETAILED_RIGS).forEach((session) => {
      const handle = reconciler.get({ kind: 'session', id: session.id });
      if (!handle) return;
      const workstation = workstationBySession.get(session.id);
      if (handle.seatedAtOrigin) {
        // Cast bodies sit via their own clip, authored at the desk origin.
        const pose = restingBehavior(session);
        if ((pose === 'seated_work' || pose === 'validating') && workstation) {
          handle.object.position.copy(workstation.object.position);
          handle.object.rotation.copy(workstation.object.rotation);
        }
        handle.setPose(pose);
      } else if (workstation) {
        const seat = workstation.seat.getWorldPosition(new THREE.Vector3());
        const pose = restingBehavior(session);
        const seated = pose === 'seated_work' || pose === 'validating';
        // Seated origins drop so the pelvis lands on the chair anchor;
        // standing poses (waiting, failed, complete) stay on the floor.
        handle.object.position.set(seat.x, seated ? seat.y - ROBOT_PELVIS_HEIGHT : 0, seat.z);
        handle.setPose(pose);
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
    robotFleet.reconcile(reconciler.entries());
    applyRestingStates();
    syncAgentPanels();
    rebuildStreams();
    paintGlobalTimeline();
    robotFleet.update();
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
    setCastMotion(motionMode);
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
    robotFleet.dispose();
    reconciler.clear();
    transitions.clear();
    animator.clear();
    workstationBySession.clear();
    [...office.desks.builder, ...office.desks.validator].forEach((desk) => { desk.occupant = null; });
    disposeDynamic(capabilityInstances);
    for (const entry of panelCache.values()) {
      entry.material.map?.dispose();
      entry.material.dispose();
    }
    panelCache.clear();
    clearStreams();
    roomLabelGroup.traverse((child) => {
      if (child.isSprite) {
        child.material.map?.dispose();
        child.material.dispose();
      }
    });
    scene.remove(roomLabelGroup);
    if (timelineMaterial) {
      timelineMaterial.map?.dispose();
      timelineMaterial.dispose();
    }
    scene.remove(castProps);
    disposeStudioCast();
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
