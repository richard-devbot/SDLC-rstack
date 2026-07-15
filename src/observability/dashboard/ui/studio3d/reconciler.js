/**
 * Stable entity registry for Agent Force Studio.
 *
 * owner: RStack developed by Richardson Gunde
 */
import { STUDIO_TOPOLOGY, topologySlot, workstationSlot } from './topology.js';

function key(kind, id) {
  return `${kind}:${id}`;
}

function desiredEntities(projection, maxDetailedSessions) {
  const desired = [{
    kind: 'orchestrator',
    id: projection.orchestrator.id,
    data: projection.orchestrator,
    slot: topologySlot('orchestrator'),
  }];
  projection.missions.forEach((data, index) => desired.push({ kind: 'mission', id: data.id, data, slot: topologySlot('mission', index) }));
  projection.departments.forEach((data, index) => desired.push({ kind: 'department', id: data.id, data, slot: topologySlot('department', index) }));
  const detailedSessions = projection.sessions.slice(-maxDetailedSessions);
  const workstationIndexes = { builder: 0, validator: 0 };
  let dispatchIndex = 0;
  detailedSessions.forEach((data) => {
    const role = data.role === 'validator' ? 'validator' : 'builder';
    const workstation = workstationSlot(data, projection, workstationIndexes[role]);
    workstationIndexes[role] += 1;
    const slot = workstation
      ?? STUDIO_TOPOLOGY.dispatchQueue[dispatchIndex++ % STUDIO_TOPOLOGY.dispatchQueue.length];
    desired.push({ kind: 'session', id: data.id, data, slot });
  });
  if (projection.sessions.length > detailedSessions.length) desired.push({
    kind: 'aggregate',
    id: 'overflow-sessions',
    data: {
      id: 'overflow-sessions',
      status: 'active',
      count: projection.sessions.length - detailedSessions.length,
    },
    slot: topologySlot('dispatch'),
  });
  if (projection.governance_items.length) desired.push({
    kind: 'governance',
    id: 'governance-deck',
    data: { id: 'governance-deck', status: 'blocked', count: projection.governance_items.length },
    slot: topologySlot('governance'),
  });
  if (projection.evidence_items.length) desired.push({
    kind: 'evidence',
    id: 'evidence-vault',
    data: { id: 'evidence-vault', status: 'completed', count: projection.evidence_items.length },
    slot: topologySlot('evidence'),
  });
  return desired;
}

export function createEntityReconciler({
  scene,
  factories,
  onAdded = () => {},
  onRemoved = () => {},
  maxDetailedSessions = 16,
} = {}) {
  const registry = new Map();

  function add(entity) {
    const factory = factories[entity.kind];
    if (!factory) return null;
    const handle = factory(entity.data, entity.slot);
    handle.object.userData.entityRef = { kind: entity.kind, id: entity.id };
    handle.object.traverse?.((object) => {
      object.userData.entityRef ??= handle.object.userData.entityRef;
      if (object.isMesh) object.userData.interactive = true;
    });
    scene.add(handle.object);
    registry.set(key(entity.kind, entity.id), handle);
    onAdded(entity, handle);
    return handle;
  }

  function apply(projection) {
    const desired = desiredEntities(projection, maxDetailedSessions);
    const desiredKeys = new Set(desired.map((entity) => key(entity.kind, entity.id)));
    for (const entity of desired) {
      const entityKey = key(entity.kind, entity.id);
      const handle = registry.get(entityKey) ?? add(entity);
      handle?.update?.(entity.data, entity.slot);
    }
    for (const [entityKey, handle] of registry) {
      if (desiredKeys.has(entityKey)) continue;
      scene.remove(handle.object);
      handle.dispose?.();
      registry.delete(entityKey);
      onRemoved(entityKey, handle);
    }
    return registry;
  }

  function get(ref) {
    if (!ref) return null;
    const entityKey = typeof ref === 'string' ? ref : key(ref.kind, ref.id);
    return registry.get(entityKey) ?? null;
  }

  function clear() {
    for (const [entityKey, handle] of registry) {
      scene.remove(handle.object);
      handle.dispose?.();
      onRemoved(entityKey, handle);
    }
    registry.clear();
  }

  return { apply, get, clear, entries: () => [...registry.entries()] };
}
