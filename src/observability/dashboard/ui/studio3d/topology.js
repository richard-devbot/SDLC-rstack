/**
 * Authored spatial anchors for the Agent Force cutaway company office.
 *
 * The building is one rectangular cutaway floor: a north wing of four rooms
 * (Skills Library, Orchestrator HQ, Governance, Evidence Vault), a central
 * east-west corridor, and a south wing holding the Builder Bullpen, the glass
 * Validator Lab, and the reception/dispatch nook. Semantic mission and
 * department IDs arrive from state.studio. This module owns positions,
 * door openings, and deterministic corridor routes only, so it cannot invent
 * runtime state or drift from the server's canonical model.
 *
 * owner: RStack developed by Richardson Gunde
 */
function point(x, y, z) {
  return Object.freeze([x, y, z]);
}

function slot(id, x, y, z, yaw = 0) {
  return Object.freeze({
    id,
    position: point(x, y, z),
    rotation: point(0, yaw, 0),
  });
}

function row(prefix, count, startX, stepX, z, yaw = 0, offset = 0) {
  return Object.freeze(Array.from({ length: count }, (_, index) => (
    slot(`${prefix}-${index + offset + 1}`, startX + index * stepX, 0, z, yaw)
  )));
}

const EMPTY_ROUTE = Object.freeze([]);

// Corridor spine and door openings the routes thread through.
const CORRIDOR_Z = -5.5;
const DOORS = Object.freeze({
  library: -9.2,
  hq: -2,
  governance: 7.5,
  vault: 15.5,
  bullpen: -6,
  lab: 10,
});

export const STUDIO_TOPOLOGY = Object.freeze({
  // Building envelope, shared with the office renderer.
  bounds: Object.freeze({ west: -18, east: 18, north: -13, south: 13 }),
  corridor: Object.freeze({ north: -7, south: -4, z: CORRIDOR_Z }),
  doors: DOORS,

  orchestrator: slot('orchestrator-hq', -2, 0, -10),
  dispatch: slot('dispatch', -16, 0, 10, Math.PI / 2),
  dispatchQueue: row('dispatch-queue', 12, -17.2, 1.15, 12.1),
  library: Object.freeze({
    ...slot('skills-library', -13, 0, -10, Math.PI / 2),
    entry: point(DOORS.library, 0, -9.5),
  }),
  governance: Object.freeze({
    ...slot('governance-room', 7.5, 0, -10, -Math.PI / 2),
    entry: point(DOORS.governance, 0, -9.5),
  }),
  evidence: Object.freeze({
    ...slot('evidence-vault', 15.5, 0, -10, -Math.PI / 2),
    entry: point(DOORS.vault, 0, -9.5),
  }),
  // Eight mission boards on the Builder Bullpen's corridor wall.
  missions: row('mission-board', 8, -16, 2.5, -3.62),
  // Fifteen canonical stage work cells: eight along the Builder Bullpen rail,
  // seven inside the glass Validator Lab.
  departments: Object.freeze([
    ...row('department', 8, -16.5, 2, -1.5),
    ...row('department', 7, 6.9, 1, -1.5, 0, 8),
  ]),
  // Two face-to-face desk pods in the bullpen.
  builderDesks: Object.freeze([
    ...row('builder-desk', 4, -15.5, 2.75, 2.5),
    ...row('builder-desk', 4, -15.5, 2.75, 6.5, Math.PI, 4),
  ]),
  validatorDesks: row('validator-desk', 4, 7.2, 1.8, 4),
  builderPool: slot('builder-bullpen', -11, 0, 4.5),
  validator: slot('validator-lab', 10, 0, 4, Math.PI),
  handoffDock: point(5.5, 0, 2),
  overviewTarget: point(0, 0.4, -0.5),
  overviewCamera: point(17.5, 19.5, 22.5),
  routes: Object.freeze({
    dispatch_to_library: Object.freeze([
      point(-16, 0, 10),
      point(-16, 0, 6),
      point(DOORS.bullpen, 0, -1),
      point(DOORS.bullpen, 0, CORRIDOR_Z),
      point(DOORS.library, 0, CORRIDOR_Z),
      point(DOORS.library, 0, -9.5),
    ]),
    library_to_builder: Object.freeze([
      point(DOORS.library, 0, -9.5),
      point(DOORS.library, 0, CORRIDOR_Z),
      point(DOORS.bullpen, 0, CORRIDOR_Z),
      point(DOORS.bullpen, 0, 0.5),
    ]),
    library_to_validator: Object.freeze([
      point(DOORS.library, 0, -9.5),
      point(DOORS.library, 0, CORRIDOR_Z),
      point(DOORS.lab, 0, CORRIDOR_Z),
      point(DOORS.lab, 0, 0.5),
    ]),
    builder_to_validator: Object.freeze([
      point(-7.25, 0, 1.8),
      point(-2, 0, 2),
      point(5.5, 0, 2),
    ]),
    assignment_to_governance: Object.freeze([
      point(DOORS.bullpen, 0, 0.5),
      point(DOORS.bullpen, 0, CORRIDOR_Z),
      point(DOORS.governance, 0, CORRIDOR_Z),
      point(DOORS.governance, 0, -9.5),
    ]),
    assignment_to_vault: Object.freeze([
      point(DOORS.bullpen, 0, 0.5),
      point(DOORS.bullpen, 0, CORRIDOR_Z),
      point(DOORS.vault, 0, CORRIDOR_Z),
      point(DOORS.vault, 0, -9.5),
    ]),
  }),
});

export function topologySlot(kind, index = 0) {
  if (kind === 'mission') return STUDIO_TOPOLOGY.missions[index % STUDIO_TOPOLOGY.missions.length];
  if (kind === 'department') return STUDIO_TOPOLOGY.departments[index % STUDIO_TOPOLOGY.departments.length];
  return STUDIO_TOPOLOGY[kind] ?? STUDIO_TOPOLOGY.orchestrator;
}

export function workstationSlot(session, _projection, sessionIndex = 0) {
  const slots = session?.role === 'validator'
    ? STUDIO_TOPOLOGY.validatorDesks
    : STUDIO_TOPOLOGY.builderDesks;
  return slots[sessionIndex] ?? null;
}

export function sessionPosition(session, projection, sessionIndex = 0) {
  const workstation = workstationSlot(session, projection, sessionIndex);
  return workstation?.position
    ?? STUDIO_TOPOLOGY.dispatchQueue[sessionIndex % STUDIO_TOPOLOGY.dispatchQueue.length].position;
}

function doorXFor(position) {
  const [x, , z] = position;
  if (z < STUDIO_TOPOLOGY.corridor.north) {
    if (x < -7) return DOORS.library;
    if (x < 3) return DOORS.hq;
    if (x < 12) return DOORS.governance;
    return DOORS.vault;
  }
  return x > 5.5 ? DOORS.lab : DOORS.bullpen;
}

/**
 * Deterministic corridor-following path between two authored points. Points in
 * the same wing on the same side of the lab glass connect directly; everything
 * else threads its room door and the corridor so robots never cross walls.
 */
export function corridorRoute(from, to) {
  const southSide = (position) => position[2] > STUDIO_TOPOLOGY.corridor.south;
  const labSide = (position) => position[0] > 5.5;
  if (southSide(from) && southSide(to) && labSide(from) === labSide(to)) {
    return [point(...from), point(...to)];
  }
  const fromDoor = doorXFor(from);
  const toDoor = doorXFor(to);
  return [
    point(...from),
    point(fromDoor, 0, from[2]),
    point(fromDoor, 0, CORRIDOR_Z),
    point(toDoor, 0, CORRIDOR_Z),
    point(toDoor, 0, to[2]),
    point(...to),
  ];
}

export function routePoints(name) {
  return STUDIO_TOPOLOGY.routes[name] ?? EMPTY_ROUTE;
}
