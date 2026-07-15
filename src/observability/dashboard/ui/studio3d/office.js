/**
 * CPU-first cutaway office environment for Agent Force Studio.
 *
 * One continuous dollhouse building: full-height far walls, lowered near
 * walls, authored partitions with door openings, a central corridor, and
 * architecturally separate rooms for Orchestrator HQ, the Skills Library,
 * the Builder Bullpen, the glass Validator Lab, Governance, the Evidence
 * Vault, and reception/dispatch. Repeated architecture and furniture are
 * instanced; semantic desk anchors stay as lightweight Object3D groups so
 * runtime occupancy is truthful without paying a draw-call cost for every
 * empty workstation. The canvas carries no text — room identity comes from
 * architecture, furnishings, and restrained material accents.
 *
 * owner: RStack developed by Richardson Gunde
 */
import * as THREE from 'three';
import { pipelineStageX, STUDIO_TOPOLOGY } from './topology.js';

const WALL_HEIGHT = 2.7;
const PARTITION_HEIGHT = 2.2;
const LOW_WALL_HEIGHT = 0.55;
const GLASS_HEIGHT = 2.2;

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

/** Wall segment along the x axis. */
function wallX(x1, x2, z, height, thickness) {
  return { center: [(x1 + x2) / 2, height / 2, z], scale: [Math.abs(x2 - x1), height, thickness] };
}

/** Wall segment along the z axis. */
function wallZ(z1, z2, x, height, thickness) {
  return { center: [x, height / 2, (z1 + z2) / 2], scale: [thickness, height, Math.abs(z2 - z1)] };
}

function writeSegments(mesh, segments) {
  const transform = new THREE.Object3D();
  const color = new THREE.Color();
  segments.forEach((segment, index) => {
    transform.position.set(...segment.center);
    transform.rotation.set(0, segment.yaw ?? 0, 0);
    transform.scale.set(...segment.scale);
    transform.updateMatrix();
    mesh.setMatrixAt(index, transform.matrix);
    if (segment.color !== undefined) mesh.setColorAt(index, color.set(segment.color));
  });
  mesh.count = segments.length;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return mesh;
}

function createWalls(pool) {
  const { bounds, corridor, doors } = STUDIO_TOPOLOGY;
  const P = 0.4; // perimeter thickness
  const I = 0.26; // interior partition thickness
  const solid = [
    // Perimeter: far walls full height, near walls lowered for the cutaway.
    wallX(bounds.west - P / 2, bounds.east + P / 2, bounds.north, WALL_HEIGHT, P),
    wallZ(bounds.north, 9.4, bounds.west, WALL_HEIGHT, P), // dispatch entrance gap 9.4..11
    wallZ(11, bounds.south, bounds.west, WALL_HEIGHT, P),
    wallX(bounds.west - P / 2, bounds.east + P / 2, bounds.south, LOW_WALL_HEIGHT, P),
    wallZ(bounds.north, bounds.south, bounds.east, LOW_WALL_HEIGHT, P),
    // North-wing dividers (Library | HQ · Governance | Vault).
    wallZ(bounds.north, corridor.north, -7, PARTITION_HEIGHT, I),
    wallZ(bounds.north, corridor.north, 12, PARTITION_HEIGHT, I),
    // Corridor north wall with four door openings.
    wallX(bounds.west, doors.library - 0.8, corridor.north, PARTITION_HEIGHT, I),
    wallX(doors.library + 0.8, doors.hq - 0.8, corridor.north, PARTITION_HEIGHT, I),
    wallX(doors.hq + 0.8, doors.governance - 0.8, corridor.north, PARTITION_HEIGHT, I),
    wallX(doors.governance + 0.8, doors.vault - 0.8, corridor.north, PARTITION_HEIGHT, I),
    wallX(doors.vault + 0.8, bounds.east, corridor.north, PARTITION_HEIGHT, I),
    // Corridor south wall with the bullpen door; the lab section is glass.
    wallX(bounds.west, doors.bullpen - 0.8, corridor.south, PARTITION_HEIGHT, I),
    wallX(doors.bullpen + 0.8, 6, corridor.south, PARTITION_HEIGHT, I),
    wallX(14, bounds.east, corridor.south, PARTITION_HEIGHT, I),
  ];
  const glass = [
    // Glass Validator Lab: corridor door, evidence hatch gap on the west side.
    wallX(6, doors.lab - 0.8, corridor.south, GLASS_HEIGHT, 0.08),
    wallX(doors.lab + 0.8, 14, corridor.south, GLASS_HEIGHT, 0.08),
    wallZ(corridor.south, 1.4, 6, GLASS_HEIGHT, 0.08),
    wallZ(2.6, 9, 6, GLASS_HEIGHT, 0.08),
    wallX(6, 14, 9, GLASS_HEIGHT, 0.08),
    wallZ(corridor.south, 9, 14, GLASS_HEIGHT, 0.08),
    // Orchestrator HQ glass side toward Governance.
    wallZ(bounds.north, corridor.north, 3, PARTITION_HEIGHT, 0.08),
  ];
  const walls = new THREE.InstancedMesh(pool.geometries.slab, pool.materials.wall, solid.length);
  walls.name = 'Office walls';
  walls.receiveShadow = true;
  const glassMesh = new THREE.InstancedMesh(pool.geometries.slab, pool.materials.governanceGlass, glass.length);
  glassMesh.name = 'Glass partitions';
  return [writeSegments(walls, solid), writeSegments(glassMesh, glass)];
}

function createFloorFinishes(pool) {
  const { bounds, corridor } = STUDIO_TOPOLOGY;
  const finish = (x1, x2, z1, z2, color) => ({
    center: [(x1 + x2) / 2, 0.03, (z1 + z2) / 2],
    scale: [x2 - x1, 0.05, z2 - z1],
    color,
  });
  const finishes = [
    finish(bounds.west, -7, bounds.north, corridor.north, 0xb9c4ae), // Library sage
    finish(-7, 3, bounds.north, corridor.north, 0xc9a276), // HQ warm wood
    finish(3, 12, bounds.north, corridor.north, 0xd8c9c2), // Governance blush
    finish(12, bounds.east, bounds.north, corridor.north, 0xb7cec2), // Vault mint
    finish(bounds.west, bounds.east, corridor.north, corridor.south, 0x8f959c), // corridor
    finish(bounds.west, 6, corridor.south, bounds.south, 0xd9d2c0), // Builder Bullpen
    finish(6, 14, corridor.south, 9, 0xb4c4d8), // Validator Lab cool
    finish(14, bounds.east, corridor.south, bounds.south, 0xdad3c4), // east lounge
    finish(6, 14, 9, bounds.south, 0xdad3c4), // south of the lab
    finish(-17.8, -13, 8, 12.8, 0xd9a860), // Dispatch rug
    finish(-4.4, 0.4, -12.6, -7.6, 0xb5824e), // HQ area rug
  ];
  const mesh = new THREE.InstancedMesh(pool.geometries.slab, pool.materials.floorFinish, finishes.length);
  mesh.name = 'Room floor finishes';
  mesh.receiveShadow = true;
  return writeSegments(mesh, finishes);
}

function createPlants(pool) {
  const spots = [
    [-17.2, -3.3], [-17.2, -12.1], [2.2, -12.3], [11.1, -12.3], [17.1, -12.2],
    [5, 12.2], [-4.5, 12.4], [15.6, -0.5], [15.6, 5.5], [15.6, 11.5],
  ];
  // Potted office trees: trunk + three tapering foliage cones per spot, with
  // per-instance green variation — reads as a plant, not a lollipop.
  const greens = [0x557f52, 0x628f60, 0x4d7550];
  const pots = new THREE.InstancedMesh(pool.geometries.cylinder, pool.materials.plantPot, spots.length * 2);
  pots.name = 'Plant pots';
  const foliage = new THREE.InstancedMesh(pool.geometries.cone, pool.materials.plantFoliage, spots.length * 3);
  foliage.name = 'Plant foliage';
  writeSegments(pots, spots.flatMap(([x, z]) => [
    { center: [x, 0.2, z], scale: [0.34, 0.4, 0.34] },
    // Trunk shares the pot material — bark-brown, one instanced mesh.
    { center: [x, 0.62, z], scale: [0.07, 0.5, 0.07] },
  ]));
  writeSegments(foliage, spots.flatMap(([x, z], index) => [
    { center: [x, 1.02, z], scale: [0.62, 0.55, 0.62], color: greens[index % 3] },
    { center: [x, 1.38, z], scale: [0.48, 0.5, 0.48], color: greens[(index + 1) % 3] },
    { center: [x, 1.7, z], scale: [0.3, 0.44, 0.3], color: greens[(index + 2) % 3] },
  ]));
  return [pots, foliage];
}

function createCasework(pool) {
  const pieces = [
    // Library shelving units and pickup counter.
    { center: [-15.6, 0.88, -11.7], scale: [2.4, 1.72, 0.45], color: 0x9aa89f },
    { center: [-12.6, 0.88, -11.7], scale: [2.4, 1.72, 0.45], color: 0x9aa89f },
    { center: [-16.4, 0.88, -8.4], scale: [0.45, 1.72, 2.4], color: 0x9aa89f },
    { center: [-13.2, 0.7, -8.6], scale: [2.1, 1.36, 0.45], color: 0x9aa89f },
    { center: [-9.2, 0.53, -8.6], scale: [1.6, 1.02, 0.55], color: 0xb9c2c5 },
    // Orchestrator HQ strategy table — against the north wall so the
    // orchestrator's standing slot at (-2, -10) stays clear.
    { center: [-2, 0.92, -11.5], scale: [2.6, 0.1, 1.1], color: 0x9a6b42 },
    { center: [-2, 0.45, -11.5], scale: [0.5, 0.86, 0.5], color: 0x7a5433 },
    // Governance review table and waiting benches.
    { center: [7.5, 0.86, -10.2], scale: [1.9, 0.09, 0.95], color: 0xb9c2c5 },
    { center: [7.5, 0.42, -10.2], scale: [0.45, 0.8, 0.45], color: 0x8f959c },
    { center: [5.1, 0.32, -11.9], scale: [1.7, 0.55, 0.5], color: 0xc4a494 },
    { center: [9.9, 0.32, -11.9], scale: [1.7, 0.55, 0.5], color: 0xc4a494 },
    // Evidence Vault cabinet.
    { center: [15.5, 0.9, -11.6], scale: [2.3, 1.76, 1.15], color: 0x77a98d },
    // Reception counter at Dispatch.
    { center: [-15.4, 0.55, 9.6], scale: [2.3, 1.06, 0.6], color: 0xb9c2c5 },
    // Evidence transfer hatch on the Validator Lab boundary.
    { center: [6, 0.58, 2], scale: [0.6, 1.1, 1.1], color: 0x8f959c },
  ];
  const mesh = new THREE.InstancedMesh(pool.geometries.slab, pool.materials.casework, pieces.length);
  mesh.name = 'Office casework';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return writeSegments(mesh, pieces);
}

function createLibraryStock(pool) {
  // Shape-coded capability forms on the library shelves — room identity, not
  // runtime state. Runtime attachments dock at the owning session's desk.
  const colors = [0xac8cff, 0xe5b860, 0x71a7ff, 0x58bd86];
  const stock = [];
  [[-15.6, -11.55], [-12.6, -11.55], [-13.2, -8.45], [-16.25, -8.4]].forEach(([x, z], shelfIndex) => {
    const vertical = shelfIndex === 3;
    for (let level = 0; level < 2; level += 1) {
      for (let i = 0; i < 5; i += 1) {
        stock.push({
          center: vertical
            ? [x, 0.6 + level * 0.62, z - 0.9 + i * 0.45]
            : [x - 0.8 + i * 0.4, (shelfIndex === 2 ? 0.9 : 1.24) + level * 0.62, z],
          scale: [0.24, 0.24, 0.24],
          color: colors[(i + shelfIndex + level) % colors.length],
        });
      }
    }
  });
  const mesh = new THREE.InstancedMesh(pool.geometries.slab, pool.materials.capability, stock.length);
  mesh.name = 'Library capability stock';
  return writeSegments(mesh, stock);
}

function createPipelineWall(pool) {
  // The REAL fifteen-stage pipeline spans the shared corridor west-to-east.
  // Panels remain the adopted department fixtures while a single suspended
  // truss keeps every walking route clear below y=2.6.
  const group = new THREE.Group();
  group.name = 'Fifteen-stage pipeline gantry';
  const gantry = STUDIO_TOPOLOGY.pipelineGantry;
  const count = STUDIO_TOPOLOGY.departments.length;
  const span = gantry.endX - gantry.startX;
  const segments = [
    { center: [0, gantry.frameY + 0.25, gantry.z - 0.34], scale: [span + 1, 0.14, 0.16] },
    { center: [0, gantry.frameY + 0.25, gantry.z + 0.34], scale: [span + 1, 0.14, 0.16] },
    { center: [gantry.startX - 0.35, gantry.frameY + 0.68, gantry.z], scale: [0.14, 1, 0.82] },
    { center: [gantry.endX + 0.35, gantry.frameY + 0.68, gantry.z], scale: [0.14, 1, 0.82] },
  ];
  const stageSignals = new Map();
  STUDIO_TOPOLOGY.departments.forEach((slot, index) => {
    const x = pipelineStageX(index, count);
    segments.push({ center: [x, gantry.frameY, gantry.z], scale: [1.78, 0.12, 0.78] });
    segments.push({ center: [x, gantry.panelY - 0.37, gantry.z], scale: [0.08, 0.12, 0.92] });
    const panel = new THREE.Mesh(pool.geometries.slab, pool.statusMaterial('unknown'));
    panel.name = `Stage signal · ${slot.id}`;
    panel.scale.set(0.86, 0.42, 0.08);
    panel.position.set(x, gantry.panelY, gantry.z + 0.1);
    // Face south and pitch toward the authored overview camera.
    panel.rotation.x = gantry.panelTiltX;
    group.add(panel);
    stageSignals.set(slot.id, panel);
  });
  const frames = new THREE.InstancedMesh(
    pool.geometries.slab,
    pool.materials.graphite,
    segments.length,
  );
  frames.name = 'Pipeline gantry rollers';
  group.add(writeSegments(frames, segments));
  return { group, stageSignals };
}

function createFurnitureInstances(pool, desks) {
  const builderCount = desks.builder.length;
  const allDesks = [...desks.builder, ...desks.validator];
  // Pod mode: an occupied desk's procedural furniture collapses because the
  // occupying GLB workstation pod brings its own desk, chair, and laptop.
  let podMode = false;
  const HIDDEN = [0.0001, 0.0001, 0.0001];
  const unlessPod = (desk, scale) => (podMode && desk.occupant ? HIDDEN : scale);
  const builderTops = new THREE.InstancedMesh(pool.geometries.slab, pool.materials.workSurface, builderCount);
  builderTops.name = 'Builder desk tops';
  const validatorTops = new THREE.InstancedMesh(pool.geometries.slab, pool.materials.validator, desks.validator.length);
  validatorTops.name = 'Validator desk tops';
  const chairs = new THREE.InstancedMesh(pool.geometries.slab, pool.materials.chair, allDesks.length);
  chairs.name = 'Office chairs';
  const chairBacks = new THREE.InstancedMesh(pool.geometries.slab, pool.materials.chair, allDesks.length);
  chairBacks.name = 'Office chair backs';
  const monitors = new THREE.InstancedMesh(pool.geometries.slab, pool.materials.monitor, allDesks.length);
  monitors.name = 'Office monitors';
  const keyboards = new THREE.InstancedMesh(pool.geometries.slab, pool.materials.graphiteLight, allDesks.length);
  keyboards.name = 'Office keyboards';
  const legs = new THREE.InstancedMesh(pool.geometries.slab, pool.materials.graphiteLight, allDesks.length * 2);
  legs.name = 'Desk legs';
  const screenGlow = new THREE.InstancedMesh(pool.geometries.slab, pool.materials.screenGlow, allDesks.length);
  screenGlow.name = 'Occupied screen glow';
  const transform = new THREE.Object3D();

  const writeInstance = (mesh, index, desk, position, scale) => {
    transform.position.copy(desk.object.position);
    transform.position.add(new THREE.Vector3(...position).applyEuler(desk.object.rotation));
    transform.rotation.copy(desk.object.rotation);
    transform.scale.set(...scale);
    transform.updateMatrix();
    mesh.setMatrixAt(index, transform.matrix);
  };

  // One layout pass writes every desk's furniture and the occupancy glow, so
  // pod-mode changes and occupancy changes share the same source of truth.
  const layoutFurniture = () => {
    desks.builder.forEach((desk, index) => writeInstance(builderTops, index, desk, [0, 1.02, 0], unlessPod(desk, [1.12, 0.08, 0.64])));
    desks.validator.forEach((desk, index) => writeInstance(validatorTops, index, desk, [0, 1.02, 0], unlessPod(desk, [1.12, 0.08, 0.64])));
    allDesks.forEach((desk, index) => {
      writeInstance(chairs, index, desk, [0, 0.52, -0.72], unlessPod(desk, [0.54, 0.1, 0.5]));
      writeInstance(chairBacks, index, desk, [0, 0.86, -0.95], unlessPod(desk, [0.54, 0.62, 0.09]));
      writeInstance(monitors, index, desk, [0, 1.55, 0.18], unlessPod(desk, [0.56, 0.38, 0.06]));
      writeInstance(keyboards, index, desk, [0, 1.11, -0.18], unlessPod(desk, [0.5, 0.025, 0.2]));
      writeInstance(legs, index * 2, desk, [-0.5, 0.51, 0], unlessPod(desk, [0.07, 0.94, 0.55]));
      writeInstance(legs, index * 2 + 1, desk, [0.5, 0.51, 0], unlessPod(desk, [0.07, 0.94, 0.55]));
      // A desk screen lights only while a real observed session occupies it —
      // and never in pod mode, where the pod's own laptop is the screen.
      writeInstance(
        screenGlow,
        index,
        desk,
        [0, 1.55, 0.215],
        desk.occupant && !podMode ? [0.5, 0.32, 0.02] : HIDDEN,
      );
    });
    for (const mesh of [builderTops, validatorTops, chairs, chairBacks, monitors, keyboards, legs, screenGlow]) {
      mesh.instanceMatrix.needsUpdate = true;
    }
  };
  layoutFurniture();

  for (const mesh of [builderTops, validatorTops, chairs, chairBacks, monitors, keyboards, legs]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  }
  return {
    meshes: [builderTops, validatorTops, chairs, chairBacks, monitors, keyboards, legs, screenGlow],
    refreshScreenGlow: layoutFurniture,
    setPodMode(next) {
      podMode = Boolean(next);
      layoutFurniture();
    },
  };
}

function createStageCells(pool) {
  // Work-cell docks along the bullpen/lab rails stay as furniture; the
  // fifteen stage STATUS fixtures live on the corridor gantry.
  const docks = new THREE.InstancedMesh(
    pool.geometries.slab,
    pool.materials.graphiteLight,
    STUDIO_TOPOLOGY.departments.length,
  );
  docks.name = 'Stage work-cell docks';
  writeSegments(docks, STUDIO_TOPOLOGY.departments.map((slot) => ({
    center: [slot.position[0], 0.3, slot.position[2]],
    scale: [0.68, 0.6, 0.5],
  })));
  return { docks };
}

function createMissionBoards(pool) {
  const missionBoards = new Map();
  const group = new THREE.Group();
  group.name = 'Mission boards';
  for (const slot of STUDIO_TOPOLOGY.missions) {
    const board = new THREE.Mesh(pool.geometries.slab, pool.statusMaterial('unknown'));
    board.name = `Mission board · ${slot.id}`;
    board.scale.set(1.55, 0.92, 0.07);
    place(board, slot);
    board.position.y = 1.5;
    group.add(board);
    missionBoards.set(slot.id, board);
  }
  return { group, missionBoards };
}

function createNamedFacilities(pool) {
  const facilities = [];

  const hq = facility('Orchestrator HQ', STUDIO_TOPOLOGY.orchestrator);
  const goalToken = new THREE.Mesh(pool.geometries.beacon, pool.statusMaterial('unknown'));
  goalToken.name = 'Goal token';
  goalToken.scale.setScalar(0.28);
  goalToken.position.set(0, 1.22, -0.1);
  hq.add(goalToken);
  // Global project timeline: a wall screen the scene paints with the REAL
  // fifteen-stage rollup from the server projection.
  const timelineScreen = new THREE.Mesh(pool.geometries.slab, pool.materials.monitor);
  timelineScreen.name = 'Global project timeline screen';
  timelineScreen.scale.set(3.4, 1.6, 0.08);
  timelineScreen.position.set(0, 1.85, -2.6);
  hq.add(timelineScreen);
  facilities.push(hq);

  facilities.push(facility('Skills and Plugin Library', STUDIO_TOPOLOGY.library));
  facilities.push(facility('Glass Validator Lab', STUDIO_TOPOLOGY.validator));

  const governance = facility('Governance Room', STUDIO_TOPOLOGY.governance);
  const governanceBeacon = new THREE.Mesh(pool.geometries.beacon, pool.materials.governance);
  governanceBeacon.name = 'Governance beacon';
  governanceBeacon.scale.setScalar(0.2);
  governanceBeacon.position.set(0, 2.05, -2.5);
  governanceBeacon.visible = false;
  governance.add(governanceBeacon);
  facilities.push(governance);

  facilities.push(facility('Dispatch', STUDIO_TOPOLOGY.dispatch));

  const evidence = facility('Evidence Vault', STUDIO_TOPOLOGY.evidence);
  const vaultLight = new THREE.Mesh(pool.geometries.beacon, pool.materials.evidence);
  vaultLight.name = 'Vault status light';
  vaultLight.scale.setScalar(0.16);
  vaultLight.position.set(0, 1.35, -1);
  vaultLight.visible = false;
  evidence.add(vaultLight);
  facilities.push(evidence);

  return { facilities, goalToken, governanceBeacon, vaultLight, timelineScreen };
}

export function createOfficeEnvironment(pool) {
  const object = new THREE.Group();
  object.name = 'Agent Force cutaway office';

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 30), pool.materials.floorLight);
  floor.name = 'Precision workshop floor';
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  object.add(floor);

  object.add(createFloorFinishes(pool), ...createWalls(pool), ...createPlants(pool));
  const pipeline = createPipelineWall(pool);
  object.add(createCasework(pool), createLibraryStock(pool), pipeline.group);

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
  const furniture = createFurnitureInstances(pool, desks);
  object.add(builderWorkstations, validatorWorkstations, ...furniture.meshes);

  const boards = createMissionBoards(pool);
  const cells = createStageCells(pool);
  const named = createNamedFacilities(pool);
  object.add(boards.group, cells.docks, ...named.facilities);

  return {
    object,
    desks,
    stageSignals: pipeline.stageSignals,
    missionBoards: boards.missionBoards,
    goalToken: named.goalToken,
    governanceBeacon: named.governanceBeacon,
    vaultLight: named.vaultLight,
    timelineScreen: named.timelineScreen,
    refreshScreenGlow: furniture.refreshScreenGlow,
    setPodMode: furniture.setPodMode,
    dispose() {
      object.removeFromParent();
      floor.geometry.dispose();
    },
  };
}

export function assignOfficeProjection(office, projection, pool, maxDetailedSessions = 16) {
  const workstationBySession = new Map();
  const allDesks = [...office.desks.builder, ...office.desks.validator];
  allDesks.forEach((desk) => { desk.occupant = null; });

  const indexes = { builder: 0, validator: 0 };
  (projection.sessions ?? []).slice(-maxDetailedSessions).forEach((session) => {
    const role = session.role === 'validator' ? 'validator' : 'builder';
    const desk = office.desks[role][indexes[role]] ?? null;
    indexes[role] += 1;
    if (!desk) return;
    desk.occupant = session.id;
    workstationBySession.set(session.id, desk);
  });

  // The goal token illuminates only from the projected orchestrator state,
  // and desk screens light only for their occupying session.
  office.goalToken.material = pool.statusMaterial(projection.orchestrator?.status);
  office.refreshScreenGlow?.();
  return workstationBySession;
}
