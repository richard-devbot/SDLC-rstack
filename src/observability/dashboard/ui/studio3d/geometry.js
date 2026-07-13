/**
 * Low-draw-call geometry and material factories for Agent Force Studio.
 *
 * owner: RStack developed by Richardson Gunde
 */
import * as THREE from 'three';
import { STUDIO_TOPOLOGY, sessionPosition, topologySlot } from './topology.js';

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
    beacon: new THREE.IcosahedronGeometry(0.5, 1),
    ring: new THREE.TorusGeometry(1, 0.08, 8, 32),
    capsule: new THREE.SphereGeometry(0.18, 12, 8),
  };
  const materials = {
    graphite: material(0x151c26, { metalness: 0.48, roughness: 0.48 }),
    graphiteLight: material(0x283341, { metalness: 0.42, roughness: 0.5 }),
    floor: material(0x0d1219, { metalness: 0.25, roughness: 0.8 }),
    amber: material(0xe5b860, { metalness: 0.55, roughness: 0.34, emissive: 0x704c12, emissiveIntensity: 0.42 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x8cb8e8, transparent: true, opacity: 0.2, roughness: 0.08, metalness: 0.1, depthWrite: false }),
    validator: material(0x71a7ff, { metalness: 0.4, roughness: 0.36, emissive: 0x173c78, emissiveIntensity: 0.36 }),
    evidence: material(0x58bd86, { metalness: 0.45, roughness: 0.4, emissive: 0x123f29, emissiveIntensity: 0.32 }),
    governance: material(0xff7d74, { metalness: 0.35, roughness: 0.42, emissive: 0x611b18, emissiveIntensity: 0.38 }),
    robotShell: material(0xe8e6df, { metalness: 0.35, roughness: 0.48 }),
    robotJoint: material(0x3d434b, { metalness: 0.55, roughness: 0.42 }),
    robotScreen: material(0x20262d, { metalness: 0.42, roughness: 0.28 }),
    robotFace: material(0x8b96a6, { metalness: 0.2, roughness: 0.34, emissive: 0x8b96a6, emissiveIntensity: 0.72 }),
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

function place(object, slot) {
  object.position.fromArray(slot.position);
  object.rotation.fromArray(slot.rotation ?? [0, 0, 0]);
}

function entityHandle(object, signalMesh, pool) {
  return {
    object,
    update(data, slot) {
      place(object, slot);
      signalMesh.material = pool.statusMaterial(data.status);
      object.userData.status = data.status ?? 'unknown';
      object.userData.count = data.count ?? data.counts?.sessions ?? 0;
    },
    dispose() {},
  };
}

function createOrchestrator(data, slot, pool) {
  const group = new THREE.Group();
  group.name = 'Orchestrator HQ';
  const base = new THREE.Mesh(pool.geometries.cylinder, pool.materials.graphiteLight);
  base.scale.set(2.25, 0.42, 2.25);
  base.position.y = 0.2;
  const core = new THREE.Mesh(pool.geometries.cylinder, pool.statusMaterial(data.status));
  core.scale.set(0.9, 2.7, 0.9);
  core.position.y = 1.72;
  const ring = new THREE.Mesh(pool.geometries.ring, pool.materials.amber);
  ring.rotation.x = Math.PI / 2;
  ring.scale.setScalar(1.8);
  ring.position.y = 2.45;
  group.add(base, core, ring);
  place(group, slot);
  return entityHandle(group, core, pool);
}

function createMission(data, slot, pool) {
  const group = new THREE.Group();
  group.name = `Mission · ${data.title ?? data.id}`;
  const bay = new THREE.Mesh(pool.geometries.cylinder, pool.materials.graphiteLight);
  bay.scale.set(1.7, 0.18, 1.7);
  bay.position.y = 0.16;
  const signal = new THREE.Mesh(pool.geometries.beacon, pool.statusMaterial(data.status));
  signal.scale.setScalar(0.52);
  signal.position.y = 1.15;
  group.add(bay, signal);
  place(group, slot);
  return entityHandle(group, signal, pool);
}

function createDepartment(data, slot, pool) {
  const group = new THREE.Group();
  group.name = `Department · ${data.title ?? data.id}`;
  const pylon = new THREE.Mesh(pool.geometries.slab, pool.statusMaterial(data.status));
  pylon.scale.set(0.72, 1.35, 0.72);
  pylon.position.y = 0.72;
  group.add(pylon);
  place(group, slot);
  return entityHandle(group, pylon, pool);
}

function createSession(data, slot, pool) {
  const group = new THREE.Group();
  group.name = `${data.role === 'validator' ? 'Validator' : 'Builder'} · ${data.agent_id ?? data.id}`;
  const pod = new THREE.Mesh(pool.geometries.slab, data.role === 'validator' ? pool.materials.validator : pool.materials.graphiteLight);
  pod.scale.set(0.82, 0.18, 0.82);
  pod.position.y = 0.12;
  const worker = new THREE.Mesh(pool.geometries.cylinder, pool.statusMaterial(data.status));
  worker.scale.set(0.34, 1.25, 0.34);
  worker.position.y = 0.82;
  group.add(pod, worker);
  place(group, slot);
  return entityHandle(group, worker, pool);
}

function createGovernance(data, slot, pool) {
  const group = new THREE.Group();
  group.name = 'Human Governance Deck';
  const deck = new THREE.Mesh(pool.geometries.slab, pool.materials.graphiteLight);
  deck.scale.set(3.4, 0.18, 1.7);
  const signal = new THREE.Mesh(pool.geometries.beacon, pool.materials.governance);
  signal.scale.setScalar(0.72);
  signal.position.y = 0.9;
  group.add(deck, signal);
  place(group, slot);
  return entityHandle(group, signal, pool);
}

function createEvidence(data, slot, pool) {
  const group = new THREE.Group();
  group.name = 'Evidence and Delivery Vault';
  const vault = new THREE.Mesh(pool.geometries.slab, pool.materials.evidence);
  vault.scale.set(2.4, 1.6, 2.1);
  vault.position.y = 0.85;
  const door = new THREE.Mesh(pool.geometries.slab, pool.statusMaterial(data.status));
  door.scale.set(0.72, 0.9, 0.1);
  door.position.set(0, 0.72, 1.08);
  group.add(vault, door);
  place(group, slot);
  return entityHandle(group, door, pool);
}

export function createEntityFactories(pool) {
  return {
    orchestrator: (data, slot) => createOrchestrator(data, slot, pool),
    mission: (data, slot) => createMission(data, slot, pool),
    department: (data, slot) => createDepartment(data, slot, pool),
    session: (data, slot) => createSession(data, slot, pool),
    governance: (data, slot) => createGovernance(data, slot, pool),
    evidence: (data, slot) => createEvidence(data, slot, pool),
  };
}

export function createFloorFoundation(pool) {
  const group = new THREE.Group();
  group.name = 'Agent Force company floor';
  const floor = new THREE.Mesh(new THREE.CircleGeometry(19.5, 64), pool.materials.floor);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  const markerGeometry = new THREE.BoxGeometry(0.09, 0.03, 0.72);
  const markerMaterial = new THREE.MeshBasicMaterial({ color: 0x384454, transparent: true, opacity: 0.42 });
  const markers = new THREE.InstancedMesh(markerGeometry, markerMaterial, 64);
  const transform = new THREE.Object3D();
  for (let index = 0; index < 64; index += 1) {
    const angle = (index / 64) * Math.PI * 2;
    transform.position.set(Math.cos(angle) * 18.2, 0.025, Math.sin(angle) * 18.2);
    transform.rotation.set(0, -angle, 0);
    transform.updateMatrix();
    markers.setMatrixAt(index, transform.matrix);
  }
  markers.instanceMatrix.needsUpdate = true;
  group.add(markers);
  group.userData.dispose = () => {
    floor.geometry.dispose();
    markerGeometry.dispose();
    markerMaterial.dispose();
  };
  return group;
}

export function createSupportFacilities(pool) {
  const group = new THREE.Group();
  group.name = 'Builder pool and Validator Lab';

  const builder = new THREE.Mesh(pool.geometries.slab, pool.materials.graphiteLight);
  builder.name = 'Builder Pod Pool';
  builder.scale.set(2.5, 0.35, 1.7);
  builder.position.fromArray(STUDIO_TOPOLOGY.builderPool.position);

  const validatorBase = new THREE.Mesh(pool.geometries.slab, pool.materials.graphiteLight);
  validatorBase.name = 'Validator Lab';
  validatorBase.scale.set(2.7, 0.35, 1.8);
  validatorBase.position.fromArray(STUDIO_TOPOLOGY.validator.position);
  const validatorGlass = new THREE.Mesh(pool.geometries.slab, pool.materials.glass);
  validatorGlass.scale.set(2.45, 1.7, 1.55);
  validatorGlass.position.fromArray(STUDIO_TOPOLOGY.validator.position);
  validatorGlass.position.y += 1.05;
  group.add(builder, validatorBase, validatorGlass);
  return group;
}

export function createCapabilityInstances(projection, _pool) {
  const attachments = (projection.capability_attachments ?? []).slice(0, 64);
  const geometry = new THREE.BoxGeometry(0.18, 0.18, 0.18);
  const instanceMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, metalness: 0.35, roughness: 0.4 });
  const mesh = new THREE.InstancedMesh(geometry, instanceMaterial, Math.max(attachments.length, 1));
  mesh.name = 'Attached specialist, skill, and plugin modules';
  mesh.count = attachments.length;
  const sessionById = new Map((projection.sessions ?? []).map((session) => [session.id, session]));
  const transform = new THREE.Object3D();
  const color = new THREE.Color();
  attachments.forEach((attachment, index) => {
    const session = sessionById.get(attachment.session_id);
    const sessionIndex = Math.max(0, projection.sessions.indexOf(session));
    const position = sessionPosition(session, projection, sessionIndex);
    const angle = (index % 6) / 6 * Math.PI * 2;
    transform.position.set(position[0] + Math.cos(angle) * 0.65, position[1] + 1.5 + Math.floor(index / 6) * 0.22, position[2] + Math.sin(angle) * 0.65);
    transform.rotation.set(angle, angle, 0);
    transform.updateMatrix();
    mesh.setMatrixAt(index, transform.matrix);
    mesh.setColorAt(index, color.set(attachment.kind === 'specialist' ? 0xe5b860 : attachment.kind === 'skill' ? 0x71a7ff : 0xac8cff));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.userData.dispose = () => { geometry.dispose(); instanceMaterial.dispose(); };
  return mesh;
}

export function createMissionRoutes(projection) {
  const points = [];
  const colors = [];
  const source = new THREE.Vector3(...STUDIO_TOPOLOGY.orchestrator.position);
  projection.missions.forEach((mission, index) => {
    if (mission.status === 'unknown') return;
    const target = new THREE.Vector3(...topologySlot('mission', index).position);
    points.push(source.x, source.y, source.z, target.x, target.y, target.z);
    const color = new THREE.Color(STATUS_COLORS[mission.status] ?? STATUS_COLORS.unknown);
    colors.push(color.r, color.g, color.b, color.r, color.g, color.b);
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const routeMaterial = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.58 });
  const routes = new THREE.LineSegments(geometry, routeMaterial);
  routes.name = 'Source-backed mission routes';
  routes.userData.dispose = () => { geometry.dispose(); routeMaterial.dispose(); };
  return routes;
}

export function createWorkCapsule(pool, kind = 'delegation') {
  const mesh = new THREE.Mesh(pool.geometries.capsule, kind === 'artifact' ? pool.materials.evidence : pool.materials.amber);
  mesh.name = `${kind} work capsule`;
  mesh.visible = false;
  return mesh;
}
