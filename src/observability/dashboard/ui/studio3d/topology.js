/**
 * Authored spatial anchors for the Agent Force living company.
 *
 * Semantic mission and department IDs arrive from state.studio. This module
 * owns positions and deterministic routes only, so it cannot invent runtime
 * state or drift from the server's canonical model.
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

export const STUDIO_TOPOLOGY = Object.freeze({
  orchestrator: slot('orchestrator-hq', 0, 0, -10),
  dispatch: slot('dispatch', -15, 0, 8, Math.PI / 2),
  dispatchQueue: row('dispatch-queue', 12, -11, 2, 5.3),
  library: Object.freeze({
    ...slot('skills-library', -13, 0, -6, Math.PI / 2),
    entry: point(-10.5, 0, -6),
  }),
  governance: Object.freeze({
    ...slot('governance-room', 13, 0, -7, -Math.PI / 2),
    entry: point(10.5, 0, -7),
  }),
  evidence: Object.freeze({
    ...slot('evidence-vault', 14, 0, 7, -Math.PI / 2),
    entry: point(11.5, 0, 7),
  }),
  missions: row('mission-board', 8, -10.5, 3, -12.5),
  departments: Object.freeze([
    ...row('department', 8, -10.5, 3, -1.8),
    ...row('department', 7, -9, 3, 1.8, Math.PI, 8),
  ]),
  builderDesks: row('builder-desk', 8, -10.5, 3, 8.5, Math.PI),
  validatorDesks: row('validator-desk', 4, 3.5, 3, 8.5, Math.PI),
  builderPool: slot('builder-bullpen', -6, 0, 8.5, Math.PI),
  validator: slot('validator-lab', 8, 0, 8.5, Math.PI),
  overviewTarget: point(0, 0.8, 0),
  overviewCamera: point(22, 26, 29),
  routes: Object.freeze({
    dispatch_to_library: Object.freeze([
      point(-15, 0, 8),
      point(-12, 0, 5),
      point(-10.5, 0, -6),
    ]),
    library_to_builder: Object.freeze([
      point(-10.5, 0, -6),
      point(-8, 0, 3.8),
      point(-6, 0, 7),
    ]),
    library_to_validator: Object.freeze([
      point(-10.5, 0, -6),
      point(0, 0, 3.8),
      point(8, 0, 7),
    ]),
    builder_to_validator: Object.freeze([
      point(-6, 0, 7),
      point(0, 0, 5.3),
      point(8, 0, 7),
    ]),
    assignment_to_governance: Object.freeze([
      point(0, 0, 5.3),
      point(8, 0, 2),
      point(10.5, 0, -7),
    ]),
    assignment_to_vault: Object.freeze([
      point(0, 0, 5.3),
      point(8, 0, 5.3),
      point(11.5, 0, 7),
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

export function routePoints(name) {
  return STUDIO_TOPOLOGY.routes[name] ?? EMPTY_ROUTE;
}
