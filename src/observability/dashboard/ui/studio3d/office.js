/**
 * CPU-first living office environment for Agent Force Studio.
 *
 * Furniture is instanced while semantic desk anchors stay as lightweight
 * Object3D groups. Runtime occupancy is therefore truthful without paying a
 * draw-call cost for every empty workstation.
 *
 * owner: RStack developed by Richardson Gunde
 */
import * as THREE from 'three';
import { STUDIO_TOPOLOGY } from './topology.js';

function place(object, slot) {
  object.position.fromArray(slot.position);
  object.rotation.fromArray(slot.rotation ?? [0, 0, 0]);
}

function facility(name, slot) {
  const group = new THREE.Group();
  group.name = name;
  place(group, slot);
  return group;
}

function addSlab(parent, pool, material, scale, position = [0, 0, 0], name = '') {
  const object = new THREE.Mesh(pool.geometries.slab, material);
  object.name = name;
  object.scale.set(...scale);
  object.position.set(...position);
  parent.add(object);
  return object;
}

function authoredDesk(slot, kind) {
  const object = new THREE.Group();
  object.name = `${kind === 'validator' ? 'Validator' : 'Builder'} workstation · ${slot.id}`;
  place(object, slot);

  const anchor = (name, position) => {
    const child = new THREE.Object3D();
    child.name = name;
    child.position.set(...position);
    object.add(child);
    return child;
  };

  return {
    id: slot.id,
    kind,
    object,
    seat: anchor('seat', [0, 0.78, -0.72]),
    keyboard: anchor('keyboard', [0, 1.12, -0.18]),
    screen: anchor('screen', [0, 1.72, 0.16]),
    handoff: anchor('handoff', [0.82, 1.18, -0.08]),
    occupant: null,
  };
}

function createFurnitureInstances(pool, desks) {
  const builderCount = desks.builder.length;
  const allDesks = [...desks.builder, ...desks.validator];
  const builderTops = new THREE.InstancedMesh(pool.geometries.slab, pool.materials.workSurface, builderCount);
  builderTops.name = 'Builder desk tops';
  const validatorTops = new THREE.InstancedMesh(pool.geometries.slab, pool.materials.validator, desks.validator.length);
  validatorTops.name = 'Validator desk tops';
  const chairs = new THREE.InstancedMesh(pool.geometries.slab, pool.materials.chair, allDesks.length);
  chairs.name = 'Office chairs';
  const monitors = new THREE.InstancedMesh(pool.geometries.slab, pool.materials.monitor, allDesks.length);
  monitors.name = 'Office monitors';
  const keyboards = new THREE.InstancedMesh(pool.geometries.slab, pool.materials.graphiteLight, allDesks.length);
  keyboards.name = 'Office keyboards';
  const transform = new THREE.Object3D();

  const writeInstance = (mesh, index, desk, position, scale) => {
    transform.position.copy(desk.object.position);
    transform.position.add(new THREE.Vector3(...position).applyEuler(desk.object.rotation));
    transform.rotation.copy(desk.object.rotation);
    transform.scale.set(...scale);
    transform.updateMatrix();
    mesh.setMatrixAt(index, transform.matrix);
  };

  desks.builder.forEach((desk, index) => writeInstance(builderTops, index, desk, [0, 1.02, 0], [1.12, 0.08, 0.64]));
  desks.validator.forEach((desk, index) => writeInstance(validatorTops, index, desk, [0, 1.02, 0], [1.12, 0.08, 0.64]));
  allDesks.forEach((desk, index) => {
    writeInstance(chairs, index, desk, [0, 0.52, -0.72], [0.54, 0.52, 0.5]);
    writeInstance(monitors, index, desk, [0, 1.55, 0.18], [0.56, 0.38, 0.06]);
    writeInstance(keyboards, index, desk, [0, 1.11, -0.18], [0.5, 0.025, 0.2]);
  });

  for (const mesh of [builderTops, validatorTops, chairs, monitors, keyboards]) {
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  }
  return [builderTops, validatorTops, chairs, monitors, keyboards];
}

function createNamedFacilities(pool) {
  const facilities = [];

  const hq = facility('Orchestrator HQ', STUDIO_TOPOLOGY.orchestrator);
  addSlab(hq, pool, pool.materials.workSurface, [2.6, 0.14, 1.35], [0, 0.14, 0]);
  addSlab(hq, pool, pool.materials.amber, [1.7, 0.035, 0.58], [0, 1.42, 0.58]);
  facilities.push(hq);

  const library = facility('Skills and Plugin Library', STUDIO_TOPOLOGY.library);
  addSlab(library, pool, pool.materials.library, [1.8, 1.75, 0.42], [0, 1.78, -1]);
  addSlab(library, pool, pool.materials.library, [1.8, 1.75, 0.42], [0, 1.78, 1]);
  facilities.push(library);

  const validatorLab = facility('Glass Validator Lab', STUDIO_TOPOLOGY.validator);
  addSlab(validatorLab, pool, pool.materials.governanceGlass, [6.9, 1.65, 0.08], [0, 1.65, -1.35]);
  facilities.push(validatorLab);

  const governance = facility('Governance Room', STUDIO_TOPOLOGY.governance);
  addSlab(governance, pool, pool.materials.governanceGlass, [2.2, 1.7, 1.7], [0, 1.72, 0]);
  addSlab(governance, pool, pool.materials.governance, [1.2, 0.08, 0.74], [0, 0.82, 0]);
  facilities.push(governance);

  const dispatch = facility('Dispatch', STUDIO_TOPOLOGY.dispatch);
  addSlab(dispatch, pool, pool.materials.amber, [1.55, 0.12, 1.55], [0, 0.14, 0]);
  facilities.push(dispatch);

  const evidence = facility('Evidence Vault', STUDIO_TOPOLOGY.evidence);
  addSlab(evidence, pool, pool.materials.evidence, [1.75, 1.55, 1.45], [0, 1.55, 0]);
  addSlab(evidence, pool, pool.materials.monitor, [0.48, 0.72, 0.06], [0, 1.32, 1.47]);
  facilities.push(evidence);

  return facilities;
}

export function createOfficeEnvironment(pool) {
  const object = new THREE.Group();
  object.name = 'Agent Force living office';

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(38, 30), pool.materials.floorLight);
  floor.name = 'Precision workshop floor';
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  object.add(floor);

  const desks = {
    builder: STUDIO_TOPOLOGY.builderDesks.map((slot) => authoredDesk(slot, 'builder')),
    validator: STUDIO_TOPOLOGY.validatorDesks.map((slot) => authoredDesk(slot, 'validator')),
  };
  const builderWorkstations = new THREE.Group();
  builderWorkstations.name = 'Builder workstations';
  desks.builder.forEach((desk) => builderWorkstations.add(desk.object));
  const validatorWorkstations = new THREE.Group();
  validatorWorkstations.name = 'Validator workstations';
  desks.validator.forEach((desk) => validatorWorkstations.add(desk.object));
  object.add(builderWorkstations, validatorWorkstations, ...createFurnitureInstances(pool, desks));

  const missionBoards = new THREE.Group();
  missionBoards.name = 'Mission boards';
  for (const slot of STUDIO_TOPOLOGY.missions) {
    const board = addSlab(missionBoards, pool, pool.materials.monitor, [1.15, 0.68, 0.08], [0, 1.25, 0], `Mission board · ${slot.id}`);
    place(board, slot);
    board.position.y = 1.25;
  }
  object.add(missionBoards, ...createNamedFacilities(pool));

  const stageSignals = new Map();
  const signalGroup = new THREE.Group();
  signalGroup.name = 'Fifteen stage signals';
  STUDIO_TOPOLOGY.departments.forEach((slot) => {
    const signal = new THREE.Mesh(pool.geometries.beacon, pool.statusMaterial('unknown'));
    signal.name = `Stage signal · ${slot.id}`;
    signal.scale.setScalar(0.24);
    place(signal, slot);
    signal.position.y = 0.35;
    signalGroup.add(signal);
    stageSignals.set(slot.id, signal);
  });
  object.add(signalGroup);

  return {
    object,
    desks,
    stageSignals,
    dispose() {
      object.removeFromParent();
      floor.geometry.dispose();
    },
  };
}

export function assignOfficeProjection(office, projection, pool) {
  const workstationBySession = new Map();
  const allDesks = [...office.desks.builder, ...office.desks.validator];
  allDesks.forEach((desk) => { desk.occupant = null; });

  const indexes = { builder: 0, validator: 0 };
  (projection.sessions ?? []).slice(-16).forEach((session) => {
    const role = session.role === 'validator' ? 'validator' : 'builder';
    const desk = office.desks[role][indexes[role]] ?? null;
    indexes[role] += 1;
    if (!desk) return;
    desk.occupant = session.id;
    workstationBySession.set(session.id, desk);
  });

  const signals = [...office.stageSignals.values()];
  signals.forEach((signal, index) => {
    const department = projection.departments?.[index] ?? null;
    signal.material = pool.statusMaterial(department?.status);
    signal.userData.data = department;
    signal.userData.entityRef = department
      ? { kind: 'department', id: department.id }
      : null;
    signal.userData.interactive = Boolean(department);
  });
  return workstationBySession;
}
