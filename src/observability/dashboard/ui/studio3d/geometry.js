/**
 * Low-draw-call geometry and material factories for Agent Force Studio.
 *
 * Mission boards, stage work cells, the Governance beacon, and the Vault
 * status light are physical fixtures of the cutaway office. The entity
 * factories adopt those fixtures instead of spawning freestanding pylons,
 * so the scene reads as one furnished company floor rather than a topology
 * diagram, and each projected status has exactly one visual owner.
 *
 * owner: RStack developed by Richardson Gunde
 */
import * as THREE from 'three';
import { STUDIO_TOPOLOGY, workstationSlot } from './topology.js';
import { createCastAgent, createCastProp } from './assets.js';
import { createHumanoidRobot } from './robot.js';

const STATUS_COLORS = Object.freeze({
  unknown: 0x5d6878,
  queued: 0x5790e6,
  starting: 0xd7a64e,
  active: 0xe5b860,
  waiting: 0x9e82ed,
  blocked: 0xe56e66,
  failed: 0xff5f57,
  completed: 0x58bd86,
  stopped: 0x77808c,
});

function material(color, { metalness = 0.3, roughness = 0.55, emissive = 0x000000, emissiveIntensity = 0 } = {}) {
  return new THREE.MeshStandardMaterial({ color, metalness, roughness, emissive, emissiveIntensity });
}

export function createResourcePool() {
  const geometries = {
    slab: new THREE.BoxGeometry(1, 1, 1),
    cylinder: new THREE.CylinderGeometry(1, 1, 1, 20),
    sphere: new THREE.SphereGeometry(1, 12, 8),
    cone: new THREE.CylinderGeometry(0.02, 0.5, 1, 7),
    beacon: new THREE.IcosahedronGeometry(0.5, 1),
    ring: new THREE.TorusGeometry(1, 0.08, 8, 32),
    capsule: new THREE.SphereGeometry(0.18, 12, 8),
  };
  const materials = {
    graphite: material(0x151c26, { metalness: 0.48, roughness: 0.48 }),
    graphiteLight: material(0x283341, { metalness: 0.42, roughness: 0.5 }),
    wall: material(0xe9e4d8, { metalness: 0.05, roughness: 0.9 }),
    // Per-instance colors arrive via InstancedMesh.setColorAt; vertexColors
    // must stay OFF because the shared geometry has no color attribute (a
    // missing attribute samples black).
    floorFinish: material(0xffffff, { metalness: 0.06, roughness: 0.86 }),
    casework: material(0xffffff, { metalness: 0.18, roughness: 0.62 }),
    capability: material(0xffffff, { metalness: 0.35, roughness: 0.4 }),
    plantPot: material(0x8a5a44, { metalness: 0.1, roughness: 0.8 }),
    // White base so per-instance foliage greens read true (instance colors
    // multiply with the material color).
    plantFoliage: material(0xffffff, { metalness: 0.05, roughness: 0.85 }),
    amber: material(0xe5b860, { metalness: 0.55, roughness: 0.34, emissive: 0x704c12, emissiveIntensity: 0.42 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x8cb8e8, transparent: true, opacity: 0.2, roughness: 0.08, metalness: 0.1, depthWrite: false }),
    validator: material(0x71a7ff, { metalness: 0.4, roughness: 0.36, emissive: 0x173c78, emissiveIntensity: 0.36 }),
    evidence: material(0x58bd86, { metalness: 0.45, roughness: 0.4, emissive: 0x123f29, emissiveIntensity: 0.32 }),
    governance: material(0xff7d74, { metalness: 0.35, roughness: 0.42, emissive: 0x611b18, emissiveIntensity: 0.38 }),
    robotShell: material(0xe8e6df, { metalness: 0.35, roughness: 0.48 }),
    robotJoint: material(0x3d434b, { metalness: 0.55, roughness: 0.42 }),
    robotScreen: material(0x20262d, { metalness: 0.42, roughness: 0.28 }),
    robotFace: material(0x8b96a6, { metalness: 0.2, roughness: 0.34, emissive: 0x8b96a6, emissiveIntensity: 0.72 }),
    workSurface: material(0xb9c2c5, { metalness: 0.28, roughness: 0.5 }),
    chair: material(0x5e7880, { metalness: 0.18, roughness: 0.72 }),
    monitor: material(0x27363b, { metalness: 0.34, roughness: 0.3, emissive: 0x12242a, emissiveIntensity: 0.22 }),
    screenGlow: material(0xbfe8ff, { metalness: 0, roughness: 0.3, emissive: 0x9fd8ff, emissiveIntensity: 0.95 }),
    rackLed: new THREE.MeshBasicMaterial({ color: 0xffffff }),
    stream: new THREE.LineBasicMaterial({ color: 0x36b6e8, transparent: true, opacity: 0.85 }),
    streamPulse: material(0x9fe8ff, { metalness: 0.1, roughness: 0.2, emissive: 0x7fdcff, emissiveIntensity: 1.4 }),
    library: material(0x9aa8a4, { metalness: 0.2, roughness: 0.64 }),
    governanceGlass: new THREE.MeshPhysicalMaterial({ color: 0xc7e7e7, transparent: true, opacity: 0.26, roughness: 0.12, metalness: 0.05, depthWrite: false }),
    floorLight: material(0xe3ded2, { metalness: 0.08, roughness: 0.45 }),
    statuses: Object.fromEntries(Object.entries(STATUS_COLORS).map(([status, color]) => [
      status,
      material(color, {
        metalness: 0.42,
        roughness: 0.38,
        emissive: color,
        emissiveIntensity: ['active', 'starting', 'blocked', 'failed'].includes(status) ? 0.42 : 0.18,
      }),
    ])),
  };
  return {
    geometries,
    materials,
    statusMaterial(status) { return materials.statuses[status] ?? materials.statuses.unknown; },
    dispose() {
      Object.values(geometries).forEach((geometry) => geometry.dispose());
      Object.values(materials.statuses).forEach((entry) => entry.dispose());
      Object.entries(materials).forEach(([name, entry]) => {
        if (name !== 'statuses') entry.dispose();
      });
    },
  };
}

export function createProceduralHumanApprover(pool) {
  const object = new THREE.Group();
  object.name = 'Human approver fallback';
  const part = (geometry, materialEntry, position, scale, rotation = [0, 0, 0]) => {
    const child = new THREE.Mesh(geometry, materialEntry);
    child.position.set(...position);
    child.scale.set(...scale);
    child.rotation.set(...rotation);
    child.castShadow = true;
    object.add(child);
    return child;
  };
  part(pool.geometries.sphere, pool.materials.robotShell, [0, 1.08, 0], [0.42, 0.7, 0.28]);
  part(pool.geometries.sphere, pool.materials.wall, [0, 1.62, 0], [0.28, 0.3, 0.28]);
  part(pool.geometries.cylinder, pool.materials.graphite, [-0.2, 0.67, 0.22], [0.12, 0.38, 0.12], [Math.PI / 2, 0, 0]);
  part(pool.geometries.cylinder, pool.materials.graphite, [0.2, 0.67, 0.22], [0.12, 0.38, 0.12], [Math.PI / 2, 0, 0]);
  part(pool.geometries.cylinder, pool.materials.graphite, [-0.2, 0.35, 0.5], [0.12, 0.32, 0.12]);
  part(pool.geometries.cylinder, pool.materials.graphite, [0.2, 0.35, 0.5], [0.12, 0.32, 0.12]);
  part(pool.geometries.cylinder, pool.materials.robotShell, [-0.38, 1.05, 0.22], [0.09, 0.34, 0.09], [Math.PI / 2, 0, 0]);
  part(pool.geometries.cylinder, pool.materials.robotShell, [0.38, 1.05, 0.22], [0.09, 0.34, 0.09], [Math.PI / 2, 0, 0]);
  return {
    object,
    height: 1.66,
    walkable: false,
    setMode(mode) { object.userData.mode = mode; },
    setPose(mode) { object.userData.mode = mode; },
    dispose() { object.removeFromParent(); },
  };
}

function place(object, slot) {
  object.position.fromArray(slot.position);
  object.rotation.fromArray(slot.rotation ?? [0, 0, 0]);
}

function bindStatus(mesh, data, pool) {
  mesh.material = pool.statusMaterial(data.status);
  mesh.userData.status = data.status ?? 'unknown';
  mesh.userData.count = data.count ?? data.counts?.sessions ?? 0;
  mesh.userData.data = data;
}

/**
 * Adopt an authored office fixture as the entity's one visual owner. The
 * fixture keeps its architectural position; only status and visibility follow
 * the projection.
 */
function adoptedFixture(mesh, pool) {
  return {
    object: mesh,
    update(data) {
      mesh.visible = true;
      bindStatus(mesh, data, pool);
    },
    dispose() { mesh.visible = false; },
  };
}

/** Fallback status marker for callers composing factories without an office. */
function statusMarker(data, slot, pool, name) {
  const mesh = new THREE.Mesh(pool.geometries.beacon, pool.statusMaterial(data.status));
  mesh.name = name;
  mesh.scale.setScalar(0.2);
  place(mesh, slot);
  return {
    object: mesh,
    update(next, nextSlot) {
      place(mesh, nextSlot);
      bindStatus(mesh, next, pool);
    },
    dispose() {},
  };
}

function createRobotEntity(data, slot, pool, kind) {
  const role = kind === 'orchestrator' ? 'orchestrator' : data.role;
  const robot = createHumanoidRobot(pool, { ...data, kind, role });
  place(robot.object, slot);
  return {
    object: robot.object,
    robot,
    update(next, nextSlot) {
      place(robot.object, nextSlot);
      robot.update({ ...next, kind, role: kind === 'orchestrator' ? 'orchestrator' : next.role });
    },
    setPose(name, weight) { robot.setPose(name, weight); },
    setFace(state) { robot.setFace(state); },
    reset() { robot.reset(); },
    dispose() { robot.dispose(); },
  };
}

/**
 * GLB-bodied agent from the Richardson-supplied cast. Same handle contract
 * as the procedural robot. The body WALKS: the animator moves the handle
 * along corridor routes while the locomotion driver swings the skeleton;
 * seated states snap to the desk origin and hand the skeleton back to the
 * typing/idle clip. Session bodies park a cast desk at their workstation
 * slot; the man travels, the desk stays. Status lives in the orb above the
 * body; the floor ring is the role band.
 */
function createCastRobotEntity(data, slot, pool, kind, castEntry, deskEntry = null, parkingLot = null) {
  const role = kind === 'orchestrator' ? 'orchestrator' : data.role === 'validator' ? 'validator' : 'builder';
  const roleLabel = role === 'orchestrator' ? 'Orchestrator' : role === 'validator' ? 'Validator' : 'Builder';
  const body = createCastAgent(castEntry);
  const object = new THREE.Group();
  object.name = `${roleLabel} agent · ${data.agent_id ?? data.id ?? 'unassigned'}`;
  object.add(body.object);

  const orb = new THREE.Mesh(pool.geometries.beacon, pool.statusMaterial(data.status));
  orb.name = 'statusOrb';
  orb.scale.setScalar(0.12);
  orb.position.set(0, body.height + 0.34, 0);
  object.add(orb);

  if (kind !== 'orchestrator') {
    const ring = new THREE.Mesh(
      pool.geometries.ring,
      role === 'validator' ? pool.materials.validator : pool.materials.amber,
    );
    ring.name = 'roleRing';
    ring.rotation.x = -Math.PI / 2;
    ring.scale.setScalar(0.8);
    ring.position.y = 0.04;
    object.add(ring);
  }

  // The session's own desk stays parked at the workstation slot while the
  // man walks; only real workstation slots earn a desk.
  let desk = null;
  const parkDesk = (deskSlot) => {
    const isWorkstation = String(deskSlot?.id ?? '').includes('-desk-');
    if (!deskEntry || !parkingLot || !isWorkstation) {
      desk?.removeFromParent();
      desk = null;
      return;
    }
    if (!desk) {
      desk = createCastProp(deskEntry);
      desk.name = `${roleLabel} desk · ${data.id ?? 'unassigned'}`;
      parkingLot.add(desk);
    }
    place(desk, deskSlot);
  };
  parkDesk(slot);

  place(object, slot);
  const handle = {
    object,
    robot: body,
    seatedAtOrigin: true,
    joints: {},
    anchors: Object.freeze({}),
    faceMaterial: null,
    pose: 'standing',
    setPose(name) {
      handle.pose = name;
      if (name === 'sitting') body.setMode('sitting');
      else body.setMode(name === 'seated_work' || name === 'validating' ? 'seated' : 'standing');
    },
    setWalking(phase) {
      handle.pose = 'walking';
      body.setMode('walking', phase);
    },
    setFace() {},
    update(next, nextSlot) {
      if (nextSlot) {
        place(object, nextSlot);
        parkDesk(nextSlot);
      }
      object.userData.data = next;
      object.userData.status = next.status ?? 'unknown';
      object.userData.role = role;
      object.userData.entityRef = { kind: next.kind ?? kind, id: next.id ?? null };
      orb.material = pool.statusMaterial(next.status);
    },
    reset() {
      object.position.set(0, 0, 0);
      object.rotation.set(0, 0, 0);
      handle.setPose('standing');
    },
    dispose() {
      desk?.removeFromParent();
      body.dispose();
      object.removeFromParent();
    },
  };
  object.userData.robotHandle = handle;
  handle.update({ ...data, kind }, null);
  return handle;
}

function createAggregate(data, slot, pool) {
  // Overflow queue board at Dispatch — an honest aggregate, never an
  // invented worker. The exact count lives in the semantic view.
  const group = new THREE.Group();
  group.name = 'Additional active agents';
  const stand = new THREE.Mesh(pool.geometries.slab, pool.materials.graphiteLight);
  stand.scale.set(0.14, 1.1, 0.14);
  stand.position.y = 0.55;
  const board = new THREE.Mesh(pool.geometries.slab, pool.materials.monitor);
  board.scale.set(1.05, 0.7, 0.07);
  board.position.y = 1.35;
  const signal = new THREE.Mesh(pool.geometries.beacon, pool.statusMaterial(data.status));
  signal.scale.setScalar(0.12);
  signal.position.set(0.42, 1.62, 0.06);
  group.add(stand, board, signal);
  place(group, slot);
  group.position.x += 2.2;
  return {
    object: group,
    update(next) { bindStatus(signal, next, pool); group.userData.data = next; group.userData.count = next.count ?? 0; },
    dispose() {},
  };
}

export function createEntityFactories(pool, office = null, getCast = () => null) {
  const adoptOr = (mesh, data, slot, name) => (
    mesh ? adoptedFixture(mesh, pool) : statusMarker(data, slot, pool, name)
  );
  return {
    orchestrator: (data, slot) => {
      const cast = getCast();
      return cast?.manager
        ? createCastRobotEntity(data, slot, pool, 'orchestrator', cast.manager)
        : createRobotEntity(data, slot, pool, 'orchestrator');
    },
    mission: (data, slot) => adoptOr(office?.missionBoards?.get(slot.id), data, slot, `Mission · ${data.title ?? data.id}`),
    department: (data, slot) => adoptOr(office?.stageSignals?.get(slot.id), data, slot, `Department · ${data.title ?? data.id}`),
    session: (data, slot) => {
      const cast = getCast();
      // Prefer the split walkable man with his parked desk; fall back to the
      // whole pod, then to the procedural robot.
      if (cast?.workerMan) {
        return createCastRobotEntity(data, slot, pool, 'session', cast.workerMan, cast.workerDesk, office?.object ?? null);
      }
      return cast?.worker
        ? createCastRobotEntity(data, slot, pool, 'session', cast.worker)
        : createRobotEntity(data, slot, pool, 'session');
    },
    aggregate: (data, slot) => createAggregate(data, slot, pool),
    governance: (data, slot) => adoptOr(office?.governanceBeacon, data, slot, 'Human governance beacon'),
    evidence: (data, slot) => adoptOr(office?.vaultLight, data, slot, 'Evidence vault light'),
  };
}

export function createCapabilityInstances(projection, _pool) {
  const attachments = (projection.capability_attachments ?? []).slice(0, 64);
  const geometry = new THREE.BoxGeometry(0.18, 0.18, 0.18);
  const instanceMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.35, roughness: 0.4 });
  const mesh = new THREE.InstancedMesh(geometry, instanceMaterial, Math.max(attachments.length, 1));
  mesh.name = 'Attached specialist, skill, and plugin modules';
  mesh.count = attachments.length;
  const sessionById = new Map((projection.sessions ?? []).map((session) => [session.id, session]));
  const sessionSlots = new Map();
  const workstationIndexes = { builder: 0, validator: 0 };
  let dispatchIndex = 0;
  (projection.sessions ?? []).slice(-16).forEach((session) => {
    const role = session.role === 'validator' ? 'validator' : 'builder';
    const workstation = workstationSlot(session, projection, workstationIndexes[role]);
    workstationIndexes[role] += 1;
    sessionSlots.set(
      session.id,
      workstation ?? STUDIO_TOPOLOGY.dispatchQueue[dispatchIndex++ % STUDIO_TOPOLOGY.dispatchQueue.length],
    );
  });
  const transform = new THREE.Object3D();
  const color = new THREE.Color();
  const offset = new THREE.Vector3();
  const stackHeights = new Map();
  attachments.forEach((attachment, index) => {
    const session = sessionById.get(attachment.session_id);
    const slot = sessionSlots.get(session?.id) ?? STUDIO_TOPOLOGY.dispatch;
    // Dock collected capability blocks in a tidy stack at the desk's handoff
    // corner instead of orbiting them over the robot.
    const level = stackHeights.get(slot.id) ?? 0;
    stackHeights.set(slot.id, level + 1);
    offset.set(0.82, 0, -0.08).applyEuler(new THREE.Euler(...(slot.rotation ?? [0, 0, 0])));
    transform.position.set(
      slot.position[0] + offset.x,
      1.1 + level * 0.2,
      slot.position[2] + offset.z,
    );
    transform.rotation.set(0, slot.rotation?.[1] ?? 0, 0);
    transform.updateMatrix();
    mesh.setMatrixAt(index, transform.matrix);
    mesh.setColorAt(index, color.set(attachment.kind === 'specialist' ? 0xe5b860 : attachment.kind === 'skill' ? 0x71a7ff : 0xac8cff));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.userData.dispose = () => { geometry.dispose(); instanceMaterial.dispose(); };
  return mesh;
}

export function createWorkPacket(pool, kind = 'task') {
  const selectedKind = kind === 'artifact' ? 'artifact' : 'task';
  const mesh = new THREE.Mesh(
    pool.geometries.slab,
    selectedKind === 'artifact' ? pool.materials.evidence : pool.materials.amber,
  );
  mesh.name = `${selectedKind} work packet`;
  mesh.scale.set(0.22, 0.08, 0.32);
  mesh.userData.kind = selectedKind;
  return mesh;
}
