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
  createCastAgent,
  createCastProp,
  disposeStudioCast,
  loadStudioCast,
  setCastMotion,
  updateCastMixers,
} from './assets.js';
import { restingBehavior } from './behavior.js';
import {
  approvalCaptionFacts,
  MAX_CAPTIONS,
  selectCaptionFacts,
  transitionCaptionFact,
  waitingCaptionFacts,
} from './captions.js';
import {
  createCapabilityInstances,
  createEntityFactories,
  createProceduralHumanApprover,
  createResourcePool,
  createWorkPacket,
} from './geometry.js';
import { assignOfficeProjection, createOfficeEnvironment } from './office.js';
import { createEntityReconciler } from './reconciler.js';
import { createRobotFleetRenderer, ROBOT_PELVIS_HEIGHT } from './robot.js';
import { pipelineStageX, STUDIO_TOPOLOGY } from './topology.js';
import { createTransitionScheduler } from './transitions.js';

const QUALITY = Object.freeze({
  high: { pixelRatio: 1.5, shadows: true, frameInterval: 0 },
  balanced: { pixelRatio: 1.25, shadows: false, frameInterval: 0 },
  low: { pixelRatio: 1, shadows: false, frameInterval: 1000 / 15 },
});
const QUALITY_ORDER = ['high', 'balanced', 'low'];
const MAX_DETAILED_RIGS = 16;
const FIXED_DETAILED_RIGS = 2;
const MAX_DETAILED_SESSIONS = MAX_DETAILED_RIGS - FIXED_DETAILED_RIGS;
// Raised from 90 for the Richardson-supplied GLB cast: the HQ battlestation
// alone carries 26 textured materials (26 draws), each occupied desk pod ~4,
// plus the 15-panel delivery spine and two team-lead fixtures. Measured
// full-cast overview with 8 live sessions: 177 calls / 169k triangles. The
// quality loop still degrades tiers above these ceilings.
const DRAW_CALL_CEILING = 200;
const TRIANGLE_CEILING = 200_000;

function easeInOut(value) {
  return value < 0.5 ? 2 * value * value : 1 - Math.pow(-2 * value + 2, 2) / 2;
}

export function createStudioScene(canvas, {
  motion = 'full',
  theme = 'twin',
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
  controls.dampingFactor = 0.06;
  // Free navigation: pan across the floor, zoom close to a desk or out to
  // the whole campus, and orbit from near-top-down to eye level. The
  // Overview button always restores the authored framing. minDistance and a
  // slightly tighter maxPolarAngle keep the camera from diving into or grazing
  // the floor plane on zoom-in — the "stuck to the ground" feeling.
  controls.minDistance = 4;
  controls.maxDistance = 72;
  controls.maxPolarAngle = Math.PI * 0.46;
  controls.minPolarAngle = 0.02;
  controls.enablePan = true;
  controls.screenSpacePanning = false;
  controls.zoomSpeed = 0.9;

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
  const robotFleet = createRobotFleetRenderer(pool, { maxRobots: MAX_DETAILED_SESSIONS + 1 });
  scene.add(robotFleet.object);

  // Studio theme (Move A): 'twin' = Digital Twin palette (default), 'classic' =
  // the authored light look. Applied once at build; app.js toggles by rebuilding
  // the scene so there is no live-restore state to keep in sync.
  applyStudioTheme(theme, { renderer, scene, ambient, key, rim, materials: pool.materials });

  let cast = null;
  const reconciler = createEntityReconciler({
    scene,
    factories: createEntityFactories(pool, office, () => cast),
    maxDetailedSessions: MAX_DETAILED_SESSIONS,
  });
  const workstationBySession = new Map();

  // Richardson-supplied GLB cast: executive HQ set (battlestation + chair),
  // the Skills Library attendant, and the manager/worker agent bodies. Loads
  // asynchronously; until then (and on any failure) the procedural bodies
  // and furniture render, so the Studio never blanks while models stream in.
  const castProps = new THREE.Group();
  castProps.name = 'Executive cast props';
  scene.add(castProps);
  let librarianProp = null;
  let humanApprover = createProceduralHumanApprover(pool);

  function placeHumanApprover(handle) {
    const approval = STUDIO_TOPOLOGY.strategyApproval;
    handle.object.position.set(approval.humanSeat[0], 0, approval.humanSeat[2]);
    handle.object.rotation.y = approval.chairRotationY;
    handle.setMode?.('sitting');
    castProps.add(handle.object);
  }

  function replaceHumanApprover() {
    if (!cast?.human) return;
    humanApprover.dispose?.();
    humanApprover = createCastAgent(cast.human);
    humanApprover.object.name = 'Human approver';
    placeHumanApprover(humanApprover);
  }

  placeHumanApprover(humanApprover);

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
      chair.name = 'Human approver strategy chair';
      chair.position.fromArray(STUDIO_TOPOLOGY.strategyApproval.chairPosition);
      chair.rotation.y = STUDIO_TOPOLOGY.strategyApproval.chairRotationY;
      castProps.add(chair);
    }
    if (cast?.librarian) {
      const librarian = createCastProp(cast.librarian);
      librarian.name = 'Skills Library attendant';
      librarian.position.set(-9.2, 0, -9.6);
      castProps.add(librarian);
      librarianProp = librarian;
    }
    if (cast?.worker) {
      // Richardson-directed resident team leads: one living fixture per
      // wing. Ambience like the librarian — typing at their own desk, no
      // status panel, so they never claim work the run didn't observe.
      const builderLead = createCastAgent(cast.worker);
      builderLead.object.name = 'Builder team lead desk';
      builderLead.object.position.set(-11.2, 0, 10.2);
      builderLead.object.rotation.y = Math.PI;
      castProps.add(builderLead.object);
      const validatorLead = createCastAgent(cast.worker);
      validatorLead.object.name = 'Validator team lead desk';
      validatorLead.object.position.set(10, 0, 7.6);
      validatorLead.object.rotation.y = Math.PI;
      castProps.add(validatorLead.object);
    }
  }

  loadStudioCast().then((loaded) => {
    if (destroyed || !loaded) return;
    cast = loaded;
    office.setPodMode?.(Boolean(cast.worker));
    placeCastProps();
    replaceHumanApprover();
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
  let captionPausedAt = null;
  const transientCaptions = new Map();

  const animator = createAgentAnimator({
    scene,
    getHandle: (sessionId) => reconciler.get({ kind: 'session', id: sessionId }),
    getOrchestrator: () => (projection?.orchestrator?.id
      ? reconciler.get({ kind: 'orchestrator', id: projection.orchestrator.id })
      : null),
    getWorkstation: (sessionId) => workstationBySession.get(sessionId) ?? null,
    createPacket: (kind) => createWorkPacket(pool, kind),
    onTransitionStart,
    onTransitionComplete,
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
    ['15-STAGE DELIVERY PIPELINE', 0, 1.42, -2.85, 3.2, 0.48],
    ['DISPATCH', -16, 2.6, 10],
  ];
  const roomLabelGroup = new THREE.Group();
  roomLabelGroup.name = 'Room labels';
  for (const [text, x, y, z, scaleX = 4.6, scaleY = 0.75] of ROOM_LABELS) {
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
    sprite.scale.set(scaleX, scaleY, 1);
    sprite.position.set(x, y, z);
    sprite.renderOrder = 20;
    roomLabelGroup.add(sprite);
  }
  scene.add(roomLabelGroup);

  // A single transparent texture atlas makes all fifteen canonical stages
  // read as individual company delivery cards without spending fifteen more
  // sprite draw calls or rebuilding the removed black work-cell docks.
  let pipelineLegendMaterial = null;
  const pipelineLegend = new THREE.Mesh(pool.geometries.slab, pool.materials.graphite);
  pipelineLegend.name = 'Delivery spine stage legend';
  pipelineLegend.position.set(
    0,
    0.68,
    STUDIO_TOPOLOGY.pipelineSpine.z + 0.4,
  );
  pipelineLegend.scale.set(
    STUDIO_TOPOLOGY.pipelineSpine.endX - STUDIO_TOPOLOGY.pipelineSpine.startX,
    0.64,
    0.035,
  );
  scene.add(pipelineLegend);

  function paintPipelineLegend() {
    const canvasEl = makeCanvas(4096, 192);
    const context = canvasEl.getContext('2d');
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    (projection.departments ?? []).slice(0, 15).forEach((department, index) => {
      const width = canvasEl.width / 15;
      const left = index * width + 7;
      const [statusColor, statusWord] = STATUS_UI[department.status] ?? STATUS_UI.unknown;
      context.fillStyle = 'rgba(242, 239, 231, 0.97)';
      context.strokeStyle = statusColor;
      context.lineWidth = 7;
      context.beginPath();
      context.roundRect(left, 11, width - 14, 170, 15);
      context.fill();
      context.stroke();
      context.font = '800 40px ui-monospace, SFMono-Regular, monospace';
      context.fillStyle = statusColor;
      context.fillText(String(index + 1).padStart(2, '0'), left + width / 2 - 7, 48);
      context.font = '650 25px ui-sans-serif, system-ui, sans-serif';
      context.fillStyle = '#20252b';
      context.fillText(
        String(department.title ?? department.id).slice(0, 14),
        left + width / 2 - 7,
        102,
        width - 30,
      );
      context.font = '750 20px ui-monospace, SFMono-Regular, monospace';
      context.fillStyle = statusColor;
      context.fillText(statusWord, left + width / 2 - 7, 148, width - 30);
    });
    const texture = new THREE.CanvasTexture(canvasEl);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthTest: true,
    });
    pipelineLegendMaterial?.map?.dispose();
    pipelineLegendMaterial?.dispose();
    pipelineLegendMaterial = material;
    pipelineLegend.material = material;
  }

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

  // Quiet company-comms layer: approval dialogue, waiting thoughts, and
  // lifecycle-backed action captions share one bounded, non-interactive
  // sprite system. Materials follow the same mark/sweep discipline as the
  // agent panels so changing source text never leaks canvas textures.
  const captionMaterialCache = new Map();
  const captionSprites = new Map();
  const captionGroup = new THREE.Group();
  captionGroup.name = 'Source-backed company captions';
  scene.add(captionGroup);

  function drawCaptionShape(context, kind, width, height) {
    context.fillStyle = kind === 'action'
      ? 'rgba(12, 25, 35, 0.92)'
      : kind === 'speech' ? 'rgba(248, 245, 237, 0.97)' : 'rgba(239, 244, 247, 0.96)';
    context.strokeStyle = kind === 'speech'
      ? '#d6a85c' : kind === 'thought' ? '#8fa2b3' : '#5f7487';
    context.lineWidth = kind === 'action' ? 2 : 4;
    context.setLineDash(kind === 'thought' ? [12, 9] : []);
    context.beginPath();
    context.roundRect(8, 8, width - 16, height - 30, kind === 'action' ? 18 : 28);
    context.fill();
    context.stroke();
    if (kind !== 'speech') return;
    context.setLineDash([]);
    context.beginPath();
    context.moveTo(62, height - 24);
    context.lineTo(86, height - 2);
    context.lineTo(104, height - 24);
    context.closePath();
    context.fill();
    context.stroke();
  }

  function captionMaterial(fact, opacity = 1) {
    const opacityBucket = THREE.MathUtils.clamp(Math.round(opacity * 10), 0, 10);
    const key = JSON.stringify([fact.kind, fact.text, opacityBucket]);
    if (captionMaterialCache.has(key)) {
      const entry = captionMaterialCache.get(key);
      entry.used = true;
      return entry.material;
    }
    const height = fact.kind === 'action' ? 112 : 176;
    const canvasEl = makeCanvas(512, height);
    const context = canvasEl.getContext('2d');
    drawCaptionShape(context, fact.kind, 512, height);
    context.textBaseline = 'middle';
    context.textAlign = 'left';
    context.fillStyle = fact.kind === 'action' ? '#f5f7fb' : '#17202a';
    context.font = fact.kind === 'action'
      ? '600 28px ui-monospace, SFMono-Regular, monospace'
      : '600 30px ui-sans-serif, system-ui, sans-serif';
    context.fillText(fact.text, 28, fact.kind === 'action' ? 53 : 72, 456);
    const texture = new THREE.CanvasTexture(canvasEl);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      opacity: opacityBucket / 10,
    });
    captionMaterialCache.set(key, { material, used: true });
    return material;
  }

  function onTransitionStart(transition) {
    const fact = transitionCaptionFact(transition);
    if (!fact) return;
    transientCaptions.set(transition.id, {
      fact,
      completedAt: null,
      removeOnReconcile: false,
    });
  }

  function onTransitionComplete(transition, { reducedMotion = false } = {}) {
    const record = transientCaptions.get(transition.id);
    if (!record) return;
    if (reducedMotion) record.removeOnReconcile = true;
    else record.completedAt = performance.now();
  }

  function captionOwnerPosition(fact) {
    let handle = null;
    if (fact.ownerKind === 'orchestrator' && projection?.orchestrator?.id) {
      handle = reconciler.get({ kind: 'orchestrator', id: projection.orchestrator.id });
    } else if (fact.ownerKind === 'session') {
      handle = reconciler.get({ kind: 'session', id: fact.ownerId });
    }
    const source = fact.ownerKind === 'human' ? humanApprover?.object : handle?.object;
    if (!source) return null;
    const position = source.getWorldPosition(new THREE.Vector3());
    const isOrchestrator = fact.ownerKind === 'orchestrator';
    const castBody = fact.ownerKind === 'human' || handle?.seatedAtOrigin;
    const panelHeight = isOrchestrator
      ? (castBody ? 3 : 4)
      : (castBody ? 2.5 : 3.85);
    let height = fact.ownerKind === 'human'
      ? 2.55
      : panelHeight + (fact.kind === 'action' ? 1 : 1.4);
    if (fact.id === 'approval-manager-thought') height += 1.2;
    if (fact.ownerKind === 'human') position.x += 0.35;
    else if (fact.ownerKind === 'orchestrator' && fact.kind === 'speech') position.x -= 0.35;
    position.y += height;
    return position;
  }

  function purgeReducedCaptionCompletions() {
    for (const [id, record] of transientCaptions) {
      if (record.removeOnReconcile) transientCaptions.delete(id);
    }
  }

  function syncCaptionLayer(now = performance.now()) {
    const transitionFacts = [];
    let fading = false;
    for (const [id, record] of transientCaptions) {
      let opacity = 1;
      if (record.completedAt !== null) {
        const elapsed = Math.max(0, now - record.completedAt);
        if (elapsed >= 1_000) {
          transientCaptions.delete(id);
          continue;
        }
        opacity = 1 - elapsed / 1_000;
        fading = true;
      }
      transitionFacts.push({ ...record.fact, opacity });
    }

    const approvalFacts = animator.managerState() === 'approval'
      ? approvalCaptionFacts(projection?.approval_summary ?? null)
      : [];
    const candidates = [
      ...approvalFacts,
      ...waitingCaptionFacts(projection?.sessions ?? []),
      ...transitionFacts,
    ].map((fact) => {
      const ownerPosition = captionOwnerPosition(fact);
      if (!ownerPosition) return null;
      return {
        ...fact,
        ownerPosition,
        distance: ownerPosition.distanceTo(camera.position),
      };
    }).filter(Boolean);
    const selected = selectCaptionFacts(candidates, { limit: MAX_CAPTIONS });
    const usedSprites = new Set();
    for (const entry of captionMaterialCache.values()) entry.used = false;
    for (const fact of selected) {
      const material = captionMaterial(fact, fact.opacity ?? 1);
      let sprite = captionSprites.get(fact.id);
      if (!sprite) {
        sprite = new THREE.Sprite(material);
        sprite.name = `caption:${fact.id}`;
        sprite.renderOrder = 50;
        captionGroup.add(sprite);
        captionSprites.set(fact.id, sprite);
      } else {
        sprite.material = material;
      }
      sprite.position.copy(fact.ownerPosition);
      const width = THREE.MathUtils.clamp(2.4 + fact.text.length * 0.045, 2.8, 4.4);
      sprite.scale.set(width, fact.kind === 'action' ? 0.62 : 1.2, 1);
      sprite.visible = true;
      usedSprites.add(fact.id);
    }
    for (const [id, sprite] of captionSprites) {
      if (usedSprites.has(id)) continue;
      captionGroup.remove(sprite);
      captionSprites.delete(id);
    }
    for (const [key, entry] of captionMaterialCache) {
      if (entry.used) continue;
      entry.material.map?.dispose();
      entry.material.dispose();
      captionMaterialCache.delete(key);
    }
    return fading;
  }

  function clearCaptionLayer() {
    captionGroup.clear();
    captionSprites.clear();
    transientCaptions.clear();
    for (const entry of captionMaterialCache.values()) {
      entry.material.map?.dispose();
      entry.material.dispose();
    }
    captionMaterialCache.clear();
    scene.remove(captionGroup);
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
    (projection.sessions ?? []).slice(-MAX_DETAILED_SESSIONS).forEach((session) => {
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

  // Pipeline conveyor: work packets glide along the low delivery belt, but only
  // as far as the furthest stage the run has actually reached — the flow is
  // read from the same departments the spine panels render, so it can never
  // show progress the projection doesn't. Frozen in reduced motion.
  const CONVEYOR = Object.freeze({
    startX: STUDIO_TOPOLOGY.pipelineSpine.startX,
    y: STUDIO_TOPOLOGY.pipelineSpine.beltY + 0.16,
    z: STUDIO_TOPOLOGY.pipelineSpine.z,
    packets: 6,
  });
  const conveyorState = { mesh: null, endX: null };

  function clearConveyor() {
    if (!conveyorState.mesh) return;
    scene.remove(conveyorState.mesh);
    conveyorState.mesh.dispose();
    conveyorState.mesh = null;
  }

  function rebuildConveyor() {
    clearConveyor();
    let reached = -1;
    (projection.departments ?? []).slice(0, 15).forEach((department, index) => {
      if (department.status !== 'unknown') reached = index;
    });
    if (reached < 1) return;
    conveyorState.endX = pipelineStageX(reached);
    const mesh = new THREE.InstancedMesh(pool.geometries.slab, pool.materials.amber, CONVEYOR.packets);
    mesh.name = 'Pipeline conveyor packets';
    mesh.frustumCulled = false;
    conveyorState.mesh = mesh;
    scene.add(mesh);
    updateConveyor(performance.now());
  }

  function updateConveyor(now) {
    if (!conveyorState.mesh) return false;
    const transform = new THREE.Object3D();
    const span = conveyorState.endX - CONVEYOR.startX;
    for (let index = 0; index < CONVEYOR.packets; index += 1) {
      const t = motionMode === 'reduced'
        ? index / CONVEYOR.packets
        : ((now / 5200) + index / CONVEYOR.packets) % 1;
      transform.position.set(CONVEYOR.startX + t * span, CONVEYOR.y, CONVEYOR.z);
      transform.scale.set(0.4, 0.12, 0.26);
      transform.updateMatrix();
      conveyorState.mesh.setMatrixAt(index, transform.matrix);
    }
    conveyorState.mesh.instanceMatrix.needsUpdate = true;
    return motionMode !== 'reduced';
  }

  // Library ambience: the android attendant patrols the pickup counter with
  // a gentle hover-bob. Pure scenery — it renders no run state and freezes
  // under reduced motion, stale pauses, and the semantic-only view.
  function updateAmbience(now) {
    if (!librarianProp || motionMode === 'reduced') return false;
    const t = now / 1000;
    const sway = Math.sin(t * 0.4);
    librarianProp.position.x = -10.6 + sway * 1.9;
    librarianProp.position.y = Math.abs(Math.sin(t * 2.1)) * 0.05;
    const heading = Math.cos(t * 0.4) >= 0 ? Math.PI / 2 : -Math.PI / 2;
    librarianProp.rotation.y += (heading - librarianProp.rotation.y) * 0.08;
    return true;
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
    reconcileManagerProjection(now);
    const transitionStarted = performance.now();
    const workforceActive = animator.update(now);
    transitionCostMs = performance.now() - transitionStarted;
    const captionsAnimating = syncCaptionLayer(now);
    const castAnimating = updateCastMixers(now);
    const streamsFlowing = updateStreamPulses(now);
    const conveyorFlowing = updateConveyor(now);
    const ambienceActive = updateAmbience(now);
    robotFleet.update();
    updateCameraTween(now);
    controls.update();
    renderer.render(scene, camera);
    samplePerformance(now);
    enforceQualityCeilings(now);
    onDiagnostics(diagnostics());
    if (!workforceActive && !castAnimating && transitions.pending() === 0 && !cameraTween
      && !controlsActive && !streamsFlowing && !conveyorFlowing && !ambienceActive
      && !captionsAnimating) {
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

  function applyManagerSeat() {
    const managerId = projection.orchestrator?.id;
    const handle = managerId
      ? reconciler.get({ kind: 'orchestrator', id: managerId })
      : null;
    if (!handle) return;
    const [x, y, z] = STUDIO_TOPOLOGY.managerSeat.position;
    handle.object.position.set(x, handle.seatedAtOrigin ? 0 : y - ROBOT_PELVIS_HEIGHT, z);
    handle.object.rotation.set(0, STUDIO_TOPOLOGY.managerSeat.rotationY, 0);
    handle.setPose(handle.seatedAtOrigin ? 'sitting' : 'seated_work');
  }

  function applyRestingStates() {
    (projection.sessions ?? []).slice(-MAX_DETAILED_SESSIONS).forEach((session) => {
      if (animator.isSessionActive(session.id)) return;
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
    if (animator.managerState() === 'seated') applyManagerSeat();
  }

  function reconcileManagerProjection(now = performance.now()) {
    if (!projection || transitions.pending() > 0) return false;
    const approvalSummary = projection.approval_summary ?? null;
    return animator.reconcileManager({
      approvalActive: Number(approvalSummary?.pending_count) > 0,
      approvalSummary,
    }, now);
  }

  function reconcile(nextProjection) {
    projection = nextProjection;
    purgeReducedCaptionCompletions();
    const assigned = assignOfficeProjection(
      office,
      projection,
      pool,
      MAX_DETAILED_SESSIONS,
    );
    workstationBySession.clear();
    assigned.forEach((desk, sessionId) => workstationBySession.set(sessionId, desk));
    reconciler.apply(projection);
    robotFleet.reconcile(reconciler.entries());
    applyRestingStates();
    syncAgentPanels();
    rebuildStreams();
    rebuildConveyor();
    paintPipelineLegend();
    paintGlobalTimeline();
    robotFleet.update();
    refreshProjectionGeometry();
    transitions.ingest(projection.timeline, { prime: firstTimeline });
    firstTimeline = false;
    reconcileManagerProjection();
    syncCaptionLayer();
    if (selectedRef && !reconciler.get(selectedRef)) selectedRef = null;
    startLoop();
  }

  function setMotion(nextMotion) {
    motionMode = nextMotion === 'reduced' ? 'reduced' : 'full';
    transitions.setMotion(motionMode);
    animator.setMotion(motionMode);
    reconcileManagerProjection();
    syncCaptionLayer();
    setCastMotion(motionMode);
    if (motionMode === 'reduced') cameraTween = null;
    startLoop();
  }

  function pause(reason = 'manual') {
    const wasPaused = pauseReasons.size > 0;
    pauseReasons.add(reason);
    transitions.pause(reason);
    if (!wasPaused) {
      const now = performance.now();
      animator.freeze(now);
      captionPausedAt = now;
    }
    renderer.setAnimationLoop(null);
  }

  function resume(reason = 'manual') {
    pauseReasons.delete(reason);
    transitions.resume(reason);
    if (pauseReasons.size) return;
    const now = performance.now();
    animator.resume(now);
    if (captionPausedAt !== null) {
      const pausedFor = Math.max(0, now - captionPausedAt);
      for (const record of transientCaptions.values()) {
        if (record.completedAt !== null) record.completedAt += pausedFor;
      }
      captionPausedAt = null;
    }
    startLoop();
  }

  function diagnostics() {
    const managerId = projection?.orchestrator?.id;
    const managerHandle = managerId
      ? reconciler.get({ kind: 'orchestrator', id: managerId })
      : null;
    return {
      qualityTier,
      drawCalls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      geometries: renderer.info.memory.geometries,
      textures: renderer.info.memory.textures,
      activeRigs: Math.min(
        MAX_DETAILED_RIGS,
        FIXED_DETAILED_RIGS
          + reconciler.entries().filter(([entry]) => entry.startsWith('session:')).length,
      ),
      activeTransitions: animator.activeCount(),
      managerState: animator.managerState(),
      managerAction: animator.managerAction(),
      managerX: managerHandle?.object.position.x ?? null,
      managerZ: managerHandle?.object.position.z ?? null,
      activeCaptions: captionSprites.size,
      actionCaptions: [...captionSprites.keys()].filter((id) => id.startsWith('action:')).length,
      cameraMoving: Boolean(cameraTween),
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
    clearCaptionLayer();
    clearStreams();
    clearConveyor();
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
    if (pipelineLegendMaterial) {
      pipelineLegendMaterial.map?.dispose();
      pipelineLegendMaterial.dispose();
    }
    scene.remove(pipelineLegend);
    humanApprover.dispose?.();
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

// Studio themes (Move A · #432). 'twin' repaints the world into the Digital
// Twin palette — deep navy ground, cool high-contrast light with the rim eased
// down + a soft violet fill so the floor reads evenly (no single teal hotspot),
// dark glassy surfaces, and telemetry-bright accents. 'classic' is a no-op so
// the authored light look is preserved. Mutates shared lights + pooled
// materials in place; app.js switches themes by rebuilding the scene.
function applyStudioTheme(theme, { renderer, scene, ambient, key, rim, materials }) {
  if (theme !== 'twin') return;
  const GROUND = 0x0a0e17;
  renderer.setClearColor(GROUND, 1);
  renderer.toneMappingExposure = 1.15;
  scene.fog = new THREE.FogExp2(GROUND, 0.014);

  ambient.color.set(0x3a5580);
  ambient.groundColor.set(0x05070d);
  ambient.intensity = 0.9;
  key.color.set(0xcfe2ff);
  key.intensity = 1.6;
  rim.color.set(0x38e1d6);
  rim.intensity = 1.35;
  const fill = new THREE.DirectionalLight(0x7c6cff, 0.7);
  fill.position.set(2, 8, 16);
  scene.add(fill);

  const set = (m, hex, { emissive, ...patch } = {}) => {
    if (!m) return;
    if (hex != null && m.color) m.color.set(hex);
    if (emissive != null && m.emissive) m.emissive.set(emissive);
    Object.assign(m, patch);
    m.needsUpdate = true;
  };

  // Dark glassy shell + floor.
  set(materials.wall, 0x141d2e, { metalness: 0.4, roughness: 0.42 });
  set(materials.floorFinish, 0x0c1422, { metalness: 0.3, roughness: 0.5 });
  set(materials.floorLight, 0x111a2c, { metalness: 0.3, roughness: 0.45 });
  set(materials.casework, 0x1a2536, { metalness: 0.35, roughness: 0.5 });
  set(materials.workSurface, 0x1c2740, { metalness: 0.4, roughness: 0.45 });
  set(materials.library, 0x18324a);
  set(materials.chair, 0x27405c);

  // Telemetry accents (WebGL emissive; true bloom arrives in Move D).
  set(materials.stream, 0x38e1d6, { opacity: 0.95 });
  set(materials.streamPulse, 0xaef6ff, { emissive: 0x38e1d6, emissiveIntensity: 2.2, roughness: 0.15 });
  set(materials.screenGlow, 0xd6f6ff, { emissive: 0x38e1d6, emissiveIntensity: 1.35 });
  set(materials.robotFace, 0x9fe0ff, { emissive: 0x38e1d6, emissiveIntensity: 1.0 });

  // Run-state nodes keep their meaning but read as lit signals.
  set(materials.validator, 0x71a7ff, { emissive: 0x1e5cff, emissiveIntensity: 0.8 });
  set(materials.evidence, 0x4ade80, { emissive: 0x1f9d57, emissiveIntensity: 0.8 });
  set(materials.governance, 0xfb7185, { emissive: 0xd64560, emissiveIntensity: 0.9 });
  set(materials.amber, 0xfbbf24, { emissive: 0xc68417, emissiveIntensity: 0.7 });
}
