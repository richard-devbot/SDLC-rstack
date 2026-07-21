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
  onDirectorMode = () => {},
} = {}) {
  // WebGPU tier (Move D · #435): which renderer exists is decided by the
  // importmap — the node-based build exports WebGPURenderer, the classic
  // build does not. The classic WebGLRenderer path is byte-identical to the
  // Move A–C studio; the node renderer self-falls-back to a WebGL2 backend
  // when the adapter is unavailable, so the TSL pipeline is testable anywhere.
  const isNodeRenderer = typeof THREE.WebGPURenderer === 'function';
  const renderer = isNodeRenderer
    ? new THREE.WebGPURenderer({ canvas, antialias: true, alpha: false })
    : new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false,
    });
  // The node renderer throws on render() before init(); frames hold until the
  // async init resolves (the classic path is ready immediately).
  let rendererReady = !isNodeRenderer;
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
  // Screen-space panning + zoom-to-cursor free the camera from the ground
  // plane: panning follows the screen at any viewing angle instead of sliding
  // along the floor axes, and zoom heads toward the pointer rather than the
  // fixed orbit target — the two behaviors that made navigation feel "stuck".
  controls.screenSpacePanning = true;
  controls.zoomToCursor = true;
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
  applyStudioTheme(theme, {
    renderer, scene, ambient, key, rim, materials: pool.materials, gpu: isNodeRenderer,
  });

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
        // +14% over the original 2.9×1.34 so panels stay legible from the
        // authored overview distance (Move A follow-up, #434).
        panel.scale.set(3.3, 1.52, 1);
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

  // Work lights: a cool spotlight cone over each ACTIVE session's workstation —
  // the "this desk is live right now" signal readable from any camera angle.
  // Same honesty contract as the streams: a light exists only while its session
  // is observed live. Shadowless and capped, so the cost stays negligible.
  const WORK_LIGHT_LIMIT = 4;
  const workLights = [];
  const workLightRig = new THREE.Group();
  workLightRig.name = 'Active session work lights';
  scene.add(workLightRig);

  function rebuildWorkLights() {
    const targets = [];
    (projection.sessions ?? []).slice(-MAX_DETAILED_SESSIONS).forEach((session) => {
      if (!['active', 'starting'].includes(session.status)) return;
      const workstation = workstationBySession.get(session.id);
      if (!workstation) return;
      if (targets.length >= WORK_LIGHT_LIMIT) return;
      targets.push(workstation.seat.getWorldPosition(new THREE.Vector3()));
    });
    while (workLights.length < targets.length) {
      const light = new THREE.SpotLight(0xbfe8ff, 0, 9, Math.PI / 7, 0.45, 1.4);
      light.castShadow = false;
      workLightRig.add(light, light.target);
      workLights.push(light);
    }
    workLights.forEach((light, index) => {
      const target = targets[index];
      if (target) {
        light.position.set(target.x, target.y + 4.4, target.z + 0.5);
        light.target.position.copy(target);
        light.intensity = 30;
        light.visible = true;
      } else {
        light.visible = false;
        light.intensity = 0;
      }
    });
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
    // Mission wall (#440): everything painted here is projection truth — the
    // run goal, live session count, pending approvals, and the 15-stage strip.
    const departments = projection.departments ?? [];
    const canvasEl = makeCanvas(768, 360);
    const context = canvasEl.getContext('2d');
    context.fillStyle = '#0b141c';
    context.fillRect(0, 0, 768, 360);
    context.fillStyle = 'rgba(56, 225, 214, 0.85)';
    context.font = '700 22px ui-monospace, Menlo, monospace';
    const goal = (projection.goal ?? projection.orchestrator?.goal ?? 'No scoped run').slice(0, 52);
    context.fillText(goal, 24, 40);
    const liveSessions = (projection.sessions ?? [])
      .filter((session) => ['active', 'starting'].includes(session.status)).length;
    const pending = Number(projection.approval_summary?.pending_count) || 0;
    context.font = '600 18px ui-monospace, Menlo, monospace';
    context.fillStyle = 'rgba(230, 237, 242, 0.9)';
    context.fillText(`live sessions · ${liveSessions}`, 24, 74);
    context.fillStyle = pending > 0 ? 'rgba(251, 113, 133, 0.95)' : 'rgba(155, 167, 182, 0.8)';
    context.fillText(pending > 0 ? `pending approvals · ${pending}` : 'no pending approvals', 280, 74);
    departments.slice(0, 15).forEach((department, index) => {
      const [statusColor] = STATUS_UI[department.status] ?? STATUS_UI.unknown;
      const y = 100 + index * 16.6;
      context.fillStyle = 'rgba(127, 220, 255, 0.12)';
      context.fillRect(24, y, 720, 10);
      const width = department.status === 'completed' ? 720
        : ['active', 'starting', 'waiting', 'blocked', 'failed'].includes(department.status) ? 380 : 84;
      context.fillStyle = department.status === 'unknown' ? 'rgba(138, 144, 151, 0.35)' : statusColor;
      context.fillRect(24 + index * 9, y, Math.min(width, 720 - index * 9), 10);
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
    const following = updateFollowCamera();
    controls.update();
    if (postState.pipeline && qualityTier === 'high') postState.pipeline.render();
    else renderer.render(scene, camera);
    samplePerformance(now);
    enforceQualityCeilings(now);
    onDiagnostics(diagnostics());
    if (!workforceActive && !castAnimating && transitions.pending() === 0 && !cameraTween
      && !controlsActive && !streamsFlowing && !conveyorFlowing && !ambienceActive
      && !captionsAnimating && !following) {
      renderer.setAnimationLoop(null);
    }
  }

  function startLoop() {
    if (destroyed || pauseReasons.size || !rendererReady) return;
    previousFrame = performance.now();
    renderer.setAnimationLoop(renderFrame);
  }

  // Selective bloom (Move D · #435): the scene pass renders color and emissive
  // to separate targets (MRT), only the emissive layer blooms, and the two are
  // recombined — so work lights, data streams, gate signals, and screen glow
  // radiate without bleaching bright-but-inert surfaces. Node renderer only;
  // built after init; the high quality tier renders through it each frame.
  const postState = { pipeline: null };

  async function setupPostPipeline() {
    if (!isNodeRenderer || postState.pipeline) return;
    const [{ pass, mrt, output, emissive }, { bloom }] = await Promise.all([
      import('three/tsl'),
      import('three/addons/tsl/display/BloomNode.js'),
    ]);
    // destroy() may have raced the dynamic imports — creating the pipeline
    // after teardown would leak GPU resources nothing disposes.
    if (destroyed) return;
    const scenePass = pass(scene, camera);
    scenePass.setMRT(mrt({ output, emissive }));
    const scenePassColor = scenePass.getTextureNode('output');
    const bloomPass = bloom(scenePass.getTextureNode('emissive'), 0.6, 0.35, 0);
    const Pipeline = THREE.RenderPipeline ?? THREE.PostProcessing;
    postState.pipeline = new Pipeline(renderer);
    postState.pipeline.outputNode = scenePassColor.add(bloomPass);
  }

  // Telemetry motes (Move D · #435): a GPU-animated drift of tiny emissive
  // particles over the floor — pure TSL vertex nodes (position is a function
  // of time + per-instance hash; no compute pass, no per-frame JS). Density
  // follows the OBSERVED live-session count through a uniform, so a quiet
  // floor carries zero motes — set dressing that still obeys the iron rule.
  const moteState = { mesh: null, intensity: null, sessions: 0 };

  async function setupMotes() {
    if (!isNodeRenderer || moteState.mesh) return;
    const { float, vec3, time, hash, instanceIndex, sin, uniform, positionLocal } = await import('three/tsl');
    if (destroyed) return; // same teardown race as the post pipeline
    const intensity = uniform(0);
    const hx = hash(instanceIndex);
    const hy = hash(instanceIndex.add(1));
    const hz = hash(instanceIndex.add(2));
    const hs = hash(instanceIndex.add(3));
    const sway = sin(time.mul(hs.add(0.3)).add(hx.mul(6.28))).mul(0.4);
    const rise = hy.mul(4.2).add(time.mul(hs.mul(0.12).add(0.04))).mod(4.2).add(0.4);
    const material = new THREE.MeshStandardNodeMaterial();
    material.colorNode = vec3(0.0, 0.0, 0.0);
    material.emissiveNode = vec3(0.16, 0.66, 0.62).mul(intensity);
    material.opacityNode = float(0.5).mul(intensity);
    material.transparent = true;
    material.depthWrite = false;
    material.positionNode = positionLocal.add(vec3(
      hx.mul(34).sub(17).add(sway),
      rise,
      hz.mul(24).sub(12),
    ));
    const mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.04, 6, 4), material, 420);
    mesh.name = 'Telemetry motes';
    mesh.frustumCulled = false;
    mesh.visible = false;
    scene.add(mesh);
    moteState.mesh = mesh;
    moteState.intensity = intensity;
    syncMotes();
  }

  function syncMotes() {
    if (!moteState.mesh) return;
    const live = moteState.sessions;
    const value = live > 0 && motionMode !== 'reduced'
      ? Math.min(1, 0.35 + live * 0.15)
      : 0;
    moteState.intensity.value = value;
    moteState.mesh.visible = value > 0;
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
    // Any explicit selection is manual intent — the cinema director yields.
    setDirectorMode('explore');
    hideRoomRing();
    leaveInterior();
    if (options.overview) {
      selectedRef = null;
      return focus(null, 'company');
    }
    if (ref?.kind === 'room') return selectRoom(ref);
    if (!reconciler.get(ref)) return false;
    selectedRef = ref;
    const level = options.level ?? (ref.kind === 'session' ? 'agent' : 'mission');
    return focus(ref, level);
  }

  // ── Room selection (Move C · #434) ──────────────────────────────────────
  // Clicking a room focuses its authored anchor and drops a glowing ring so
  // the selection reads in-world; the semantic room panel opens via onSelect.
  const roomRing = new THREE.Mesh(
    pool.geometries.ring,
    new THREE.MeshStandardMaterial({
      color: 0x9fe8ff, emissive: 0x38e1d6, emissiveIntensity: 1.3,
      metalness: 0.2, roughness: 0.35,
    }),
  );
  roomRing.name = 'Room selection ring';
  roomRing.rotation.x = -Math.PI / 2;
  roomRing.scale.set(2.6, 2.6, 1);
  roomRing.position.y = 0.09;
  roomRing.visible = false;
  scene.add(roomRing);

  function hideRoomRing() {
    roomRing.visible = false;
  }

  function deskWingAnchor(desks) {
    if (!desks?.length) return null;
    const sum = desks.reduce((acc, desk) => {
      acc.x += desk.object.position.x;
      acc.z += desk.object.position.z;
      return acc;
    }, { x: 0, z: 0 });
    return [sum.x / desks.length, 0, sum.z / desks.length];
  }

  function roomAnchor(id) {
    if (id === 'hq') return [...STUDIO_TOPOLOGY.managerSeat.position];
    if (id === 'library') return [...STUDIO_TOPOLOGY.library.position];
    if (id === 'governance') return [...STUDIO_TOPOLOGY.governance.position];
    if (id === 'evidence') return [...STUDIO_TOPOLOGY.evidence.position];
    if (id === 'dispatch') return [...STUDIO_TOPOLOGY.dispatch.position];
    if (id === 'builder') return deskWingAnchor(office.desks.builder);
    if (id === 'validator') return deskWingAnchor(office.desks.validator);
    return null;
  }

  function selectRoom(ref) {
    const anchor = roomAnchor(ref?.id);
    if (!anchor) return false;
    setDirectorMode('explore');
    leaveInterior();
    selectedRef = ref;
    roomRing.position.set(anchor[0], 0.09, anchor[2]);
    roomRing.visible = true;
    const target = new THREE.Vector3(anchor[0], 1, anchor[2]);
    moveCameraTo(target.clone().add(new THREE.Vector3(6.5, 6, 8)), target);
    return true;
  }

  // Step inside (#440): glide through the room's door to a human-height
  // viewpoint framing its live contents — gate cards, evidence stacks, the
  // mission wall — up close. OrbitControls' overview minDistance would shove
  // the camera back out of a small room, so interiors relax it and every
  // exit path (re-framing a room, Overview, a director cut) restores it.
  const OVERVIEW_MIN_DISTANCE = 4;
  let interiorMode = false;
  // Rooms carry no ceiling fixtures; a visitor brings their own light so the
  // interior reads. On only while inside — zero cost from the overview.
  const interiorLight = new THREE.PointLight(0xcfe2ff, 0, 10);
  scene.add(interiorLight);

  function leaveInterior() {
    if (!interiorMode) return;
    interiorMode = false;
    interiorLight.intensity = 0;
    controls.minDistance = OVERVIEW_MIN_DISTANCE;
  }

  function roomDoor(id) {
    const { doors, corridor, bounds } = STUDIO_TOPOLOGY;
    if (id === 'library') return [doors.library, 0, corridor.north];
    if (id === 'hq') return [doors.hq, 0, corridor.north];
    if (id === 'governance') return [doors.governance, 0, corridor.north];
    if (id === 'evidence') return [doors.vault, 0, corridor.north];
    if (id === 'builder') return [doors.bullpen, 0, corridor.south];
    if (id === 'validator') return [doors.lab, 0, corridor.south];
    if (id === 'dispatch') return [bounds.west + 0.6, 0, 10.2];
    return null;
  }

  function enterRoom(ref) {
    const anchor = roomAnchor(ref?.id);
    const door = roomDoor(ref?.id);
    if (!anchor || !door) return false;
    setDirectorMode('explore');
    selectedRef = ref;
    roomRing.position.set(anchor[0], 0.09, anchor[2]);
    roomRing.visible = true;
    interiorMode = true;
    controls.minDistance = 1.2;
    interiorLight.position.set(anchor[0], 3.1, anchor[2]);
    interiorLight.intensity = 26;
    // Stand just inside the doorway at eye height, looking into the room.
    const doorway = new THREE.Vector3(door[0], 1.65, door[2]);
    const target = new THREE.Vector3(anchor[0], 1.3, anchor[2]);
    const inward = target.clone().sub(doorway).setY(0);
    const eye = doorway.add(inward.normalize().multiplyScalar(1.4)).setY(1.65);
    moveCameraTo(eye, target);
    return true;
  }

  // ── Cinema director (Move B · #433) ─────────────────────────────────────
  // Hands-free mode: the camera frames whatever the RUN is actually doing —
  // a pending human gate wins, then a round-robin tour of live sessions,
  // else the authored overview. Shots key off the same projection the
  // semantic DOM renders, so the director can never invent activity. A user
  // grab (drag, click, Overview) always takes the camera back instantly.
  const DIRECTOR_HOLD_MS = 9000;
  const director = { mode: 'explore', timer: null, tourIndex: 0, lastKey: null, followRef: null };

  // Follow mode (Move C · #434): ride along with one agent — the camera keeps
  // its current offset and glides after the body every frame, so walks (desk
  // trips, library runs) stay in frame. Falls back to explore if the entity
  // leaves the floor.
  function updateFollowCamera() {
    if (director.mode !== 'follow') return false;
    const handle = director.followRef ? reconciler.get(director.followRef) : null;
    if (!handle) {
      setDirectorMode('explore');
      return false;
    }
    const position = handle.object.position;
    const desired = new THREE.Vector3(position.x, 1.2, position.z);
    const offset = camera.position.clone().sub(controls.target);
    if (motionMode === 'reduced') {
      // Reduced motion: track by stepping, never by continuous glide.
      controls.target.copy(desired);
      camera.position.copy(controls.target).add(offset);
      return false;
    }
    controls.target.lerp(desired, 0.08);
    camera.position.copy(controls.target).add(offset);
    return true;
  }

  function directorShot() {
    if (motionMode === 'reduced') {
      // Reduced motion: hold the calm wide shot instead of touring.
      return { key: 'overview' };
    }
    if (projection?.approval_summary?.pending_count) {
      const room = STUDIO_TOPOLOGY.governance.position;
      return {
        key: 'governance',
        position: new THREE.Vector3(room[0] + 5.2, 4.4, room[2] + 7),
        target: new THREE.Vector3(room[0], 1.1, room[2]),
      };
    }
    const live = (projection?.sessions ?? [])
      .filter((session) => ['active', 'starting'].includes(session.status))
      .filter((session) => workstationBySession.has(session.id));
    if (live.length) {
      const session = live[director.tourIndex % live.length];
      const seat = workstationBySession.get(session.id).seat.getWorldPosition(new THREE.Vector3());
      return {
        key: `session:${session.id}`,
        position: seat.clone().add(new THREE.Vector3(3.8, 3.1, 5.2)),
        target: seat.clone().setY(1.1),
      };
    }
    return { key: 'overview' };
  }

  function directorCut({ advance = false } = {}) {
    if (director.mode !== 'cinema' || destroyed) return;
    if (advance) director.tourIndex += 1;
    const shot = directorShot();
    if (shot.key === director.lastKey) return;
    director.lastKey = shot.key;
    if (shot.key === 'overview') {
      moveCameraTo(
        new THREE.Vector3(...STUDIO_TOPOLOGY.overviewCamera),
        new THREE.Vector3(...STUDIO_TOPOLOGY.overviewTarget),
      );
      return;
    }
    moveCameraTo(shot.position, shot.target);
  }

  function setDirectorMode(mode, followRef = null) {
    if (destroyed) return;
    if (director.mode === mode && (mode !== 'follow' || director.followRef === followRef)) return;
    director.mode = mode;
    director.followRef = mode === 'follow' ? followRef : null;
    if (director.timer) {
      clearInterval(director.timer);
      director.timer = null;
    }
    if (mode === 'cinema') {
      leaveInterior();
      director.lastKey = null;
      directorCut();
      director.timer = setInterval(() => directorCut({ advance: true }), DIRECTOR_HOLD_MS);
    }
    if (mode === 'follow') startLoop();
    onDirectorMode(mode);
  }

  // A raycast hit resolves to a room when the mesh (or an instanced pad slot)
  // names one, or when any ancestor facility group carries a roomRef.
  function roomRefFromHit(entry) {
    const direct = entry.object.userData.roomRefs?.[entry.instanceId]
      ?? entry.object.userData.roomRef;
    if (direct) return direct;
    let node = entry.object.parent;
    while (node) {
      if (node.userData?.roomRef) return node.userData.roomRef;
      node = node.parent;
    }
    return null;
  }

  function onPointerUp(event) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(scene.children, true);
    // Agents and entities keep priority over the room they stand in.
    const entityHit = hits.find((entry) => entry.object.userData.interactive && (
      entry.object.userData.entityRef || entry.object.userData.entityRefs?.[entry.instanceId]
    ));
    if (entityHit) {
      const ref = entityHit.object.userData.entityRef
        ?? entityHit.object.userData.entityRefs?.[entityHit.instanceId];
      if (select(ref)) onSelect(ref);
      return;
    }
    for (const entry of hits) {
      const roomRef = roomRefFromHit(entry);
      if (roomRef) {
        if (selectRoom(roomRef)) onSelect(roomRef);
        return;
      }
    }
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
    rebuildWorkLights();
    rebuildConveyor();
    moteState.sessions = (projection.sessions ?? [])
      .filter((session) => ['active', 'starting'].includes(session.status)).length;
    syncMotes();
    directorCut();
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
    syncMotes();
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
      gpuTier: !isNodeRenderer ? 'webgl'
        : renderer.backend?.isWebGPUBackend ? 'webgpu' : 'webgpu-node:webgl2',
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
    // Grabbing the camera is manual intent — cinema hands control over.
    setDirectorMode('explore');
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
    if (director.timer) {
      clearInterval(director.timer);
      director.timer = null;
    }
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
    // Room selection ring: geometry is pooled, but the material is owned here.
    scene.remove(roomRing);
    roomRing.material.dispose();
    postState.pipeline?.dispose?.();
    postState.pipeline = null;
    if (moteState.mesh) {
      scene.remove(moteState.mesh);
      moteState.mesh.geometry.dispose();
      moteState.mesh.material.dispose();
      moteState.mesh = null;
    }
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
  if (isNodeRenderer) {
    // Frames hold until the async backend init resolves; a refused adapter
    // degrades to the semantic mirror instead of a broken canvas. WebGPU has
    // no webglcontextlost event — device loss arrives via the lost promise
    // (never awaited directly; it may never settle).
    renderer.init().then(() => {
      if (destroyed) return;
      rendererReady = true;
      renderer.backend?.device?.lost?.then((info) => {
        if (destroyed || info?.reason === 'destroyed') return;
        pause('context-lost');
        onRendererState('context-lost');
      });
      return Promise.allSettled([
        setupPostPipeline().catch(() => { postState.pipeline = null; }),
        setupMotes().catch(() => { moteState.mesh = null; }),
      ]);
    }).then(() => {
      if (destroyed) return;
      startLoop();
      onRendererState('ready');
    }).catch(() => {
      if (destroyed) return;
      pause('context-lost');
      onRendererState('semantic-fallback');
    });
  } else {
    startLoop();
    onRendererState('ready');
  }

  return {
    reconcile,
    select,
    focus,
    enterRoom,
    setMotion,
    setDirectorMode,
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
function applyStudioTheme(theme, { renderer, scene, ambient, key, rim, materials, gpu = false }) {
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

  // Dark glassy shell + floor. floorFinish multiplies the per-room instance
  // tints, so it sits a little lighter than the base floor for the team pads
  // to stay distinguishable in the dark.
  set(materials.wall, 0x141d2e, { metalness: 0.4, roughness: 0.42 });
  set(materials.floorFinish, 0x33415c, { metalness: 0.3, roughness: 0.5 });
  set(materials.floorLight, 0x111a2c, { metalness: 0.3, roughness: 0.45 });
  if (gpu) {
    // Node renderer: real physical transmission — refractive glass instead of
    // simple transparency. Modest values keep the interiors readable.
    set(materials.glass, 0xbfeef5, { opacity: 0.5, transmission: 0.55, thickness: 0.12, ior: 1.45, roughness: 0.08 });
    set(materials.governanceGlass, 0xc8f0f2, { opacity: 0.5, transmission: 0.5, thickness: 0.12, ior: 1.45, roughness: 0.1 });
  } else {
    set(materials.glass, 0x8fd8ea, { opacity: 0.14 });
    set(materials.governanceGlass, 0x9fdce8, { opacity: 0.16 });
  }
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
