/**
 * Deterministic spatial slots for the Agent Force company floor.
 *
 * Semantic mission and department IDs arrive from state.studio. This module
 * owns positions only, so it cannot drift from the server's canonical model.
 *
 * owner: RStack developed by Richardson Gunde
 */
function point(x, y, z) {
  return Object.freeze([x, y, z]);
}

function ringSlots(prefix, count, radiusX, radiusZ, y, phase = -Math.PI / 2) {
  return Object.freeze(Array.from({ length: count }, (_, index) => {
    const angle = phase + (index / count) * Math.PI * 2;
    const x = Math.cos(angle) * radiusX;
    const z = Math.sin(angle) * radiusZ;
    return Object.freeze({
      id: `${prefix}-${index + 1}`,
      index,
      angle,
      position: point(Number(x.toFixed(4)), y, Number(z.toFixed(4))),
      rotation: point(0, Number((-angle + Math.PI / 2).toFixed(4)), 0),
    });
  }));
}

export const STUDIO_TOPOLOGY = Object.freeze({
  orchestrator: Object.freeze({
    id: 'orchestrator-hq',
    position: point(0, 0.55, 0),
    rotation: point(0, 0, 0),
  }),
  missions: ringSlots('mission-slot', 8, 10.5, 7.2, 0.28),
  departments: ringSlots('department-slot', 15, 15.5, 10.6, 0.12, -Math.PI / 2 + Math.PI / 15),
  builderPool: Object.freeze({
    id: 'builder-pool',
    position: point(8.2, 0.18, 8.4),
    rotation: point(0, -0.7, 0),
  }),
  validator: Object.freeze({
    id: 'validator-lab',
    position: point(-12.8, 0.2, 5.8),
    rotation: point(0, 0.7, 0),
  }),
  governance: Object.freeze({
    id: 'governance-deck',
    position: point(0, 4.8, -1.2),
    rotation: point(0, 0, 0),
  }),
  evidence: Object.freeze({
    id: 'evidence-vault',
    position: point(12.8, 0.18, -5.8),
    rotation: point(0, -0.8, 0),
  }),
  overviewTarget: point(0, 0.8, 0),
  overviewCamera: point(19, 22, 26),
});

export function topologySlot(kind, index = 0) {
  if (kind === 'mission') return STUDIO_TOPOLOGY.missions[index % STUDIO_TOPOLOGY.missions.length];
  if (kind === 'department') return STUDIO_TOPOLOGY.departments[index % STUDIO_TOPOLOGY.departments.length];
  return STUDIO_TOPOLOGY[kind] ?? STUDIO_TOPOLOGY.orchestrator;
}

export function sessionPosition(session, projection, sessionIndex = 0) {
  if (session?.role === 'validator') {
    const base = STUDIO_TOPOLOGY.validator.position;
    return point(base[0] + (sessionIndex % 3) * 1.1 - 1.1, base[1] + 0.12, base[2] + Math.floor(sessionIndex / 3) * 1.15);
  }
  const missionIndex = Math.max(0, (projection?.missions ?? []).findIndex((mission) => mission.id === session?.mission_id));
  const slot = topologySlot('mission', missionIndex);
  const side = sessionIndex % 2 === 0 ? -1 : 1;
  return point(
    slot.position[0] + Math.cos(slot.angle + Math.PI / 2) * (1.3 + Math.floor(sessionIndex / 2) * 0.75) * side,
    0.36,
    slot.position[2] + Math.sin(slot.angle + Math.PI / 2) * (1.3 + Math.floor(sessionIndex / 2) * 0.75) * side,
  );
}
