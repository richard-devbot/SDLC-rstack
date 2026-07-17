/**
 * Pure browser view-model helpers for Agent Force Studio.
 *
 * owner: RStack developed by Richardson Gunde
 */
export function validateStudioSnapshot(snapshot) {
  if (!snapshot?.studio) {
    return { ok: false, studio: null, error: 'Studio projection unavailable' };
  }
  if (snapshot.studio.schema_version !== 1) {
    return { ok: false, studio: null, error: 'Unsupported Studio projection version' };
  }
  const studio = snapshot.studio;
  const valid = [
    studio.missions,
    studio.departments,
    studio.sessions,
    studio.timeline,
    studio.limitations,
  ].every(Array.isArray);
  return valid
    ? { ok: true, studio, error: null }
    : { ok: false, studio: null, error: 'Studio projection unavailable' };
}

export function motionMode(explicit, systemReduced) {
  if (explicit === 'reduced' || explicit === 'full') return explicit;
  return systemReduced ? 'reduced' : 'full';
}

export function statusLabel(value) {
  const status = String(value ?? 'unknown').replaceAll('_', ' ');
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function formatSnapshotAge(freshness) {
  if (!freshness?.observed_at) return 'Snapshot time unavailable';
  const age = Number(freshness.age_ms);
  if (!Number.isFinite(age)) return `Observed ${freshness.observed_at}`;
  if (age < 1_000) return 'Observed just now';
  if (age < 60_000) return `Observed ${Math.floor(age / 1_000)}s ago`;
  return `Observed ${Math.floor(age / 60_000)}m ago`;
}

export function entityRef(kind, id) {
  return id ? `${kind}:${id}` : null;
}

export function timelineIdentity(item) {
  return item?.id ?? [item?.source, item?.timestamp, item?.type, item?.entity_id].join(':');
}
