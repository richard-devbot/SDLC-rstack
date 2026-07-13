/**
 * Persisted-event transition scheduler for Agent Force Studio.
 *
 * It never invents activity: only allow-listed timeline events can enqueue a
 * transition, and an event identity is consumed at most once per browser
 * session. Historical state can be primed without replaying old work.
 *
 * owner: RStack developed by Richardson Gunde
 */
import { timelineIdentity } from './model.js';

const TRANSITION_TYPES = Object.freeze({
  delegation_requested: Object.freeze({ kind: 'dispatch', duration_ms: 900 }),
  agent_session_started: Object.freeze({ kind: 'materialize', duration_ms: 560 }),
  agent_session_ready: Object.freeze({ kind: 'ready', duration_ms: 420 }),
  agent_capabilities_attached: Object.freeze({ kind: 'dock', duration_ms: 420 }),
  agent_activity: Object.freeze({ kind: 'pulse', duration_ms: 320 }),
  agent_waiting: Object.freeze({ kind: 'governance', duration_ms: 640 }),
  approval_gate_blocked: Object.freeze({ kind: 'governance', duration_ms: 640 }),
  dor_gate_blocked: Object.freeze({ kind: 'governance', duration_ms: 640 }),
  guardrail_blocked: Object.freeze({ kind: 'governance', duration_ms: 640 }),
  task_human_context_required: Object.freeze({ kind: 'governance', duration_ms: 640 }),
  task_retry_exhausted: Object.freeze({ kind: 'governance', duration_ms: 640 }),
  task_blocked_by_validator: Object.freeze({ kind: 'governance', duration_ms: 640 }),
  handoff_created: Object.freeze({ kind: 'handoff', duration_ms: 800 }),
  artifact_emitted: Object.freeze({ kind: 'artifact', duration_ms: 800 }),
  task_retry_scheduled: Object.freeze({ kind: 'retry', duration_ms: 700 }),
  agent_session_completed: Object.freeze({ kind: 'shutdown', duration_ms: 650 }),
  agent_session_failed: Object.freeze({ kind: 'shutdown', duration_ms: 650 }),
  agent_session_stopped: Object.freeze({ kind: 'shutdown', duration_ms: 650 }),
});

const MAX_SEEN_EVENTS = 500;

function eventIdentity(item) {
  return `${item?.run_id ?? 'unscoped'}:${timelineIdentity(item)}`;
}

function readSeen(storage, storageKey) {
  if (!storage) return [];
  try {
    const value = JSON.parse(storage.getItem(storageKey) ?? '[]');
    return Array.isArray(value) ? value.filter((item) => typeof item === 'string').slice(-MAX_SEEN_EVENTS) : [];
  } catch {
    return [];
  }
}

export function createTransitionScheduler({
  apply = () => {},
  storage = null,
  storageKey = 'rstack.studio.seen-transitions.v1',
} = {}) {
  const seenOrder = readSeen(storage, storageKey);
  const seen = new Set(seenOrder);
  const queue = [];
  const pauseReasons = new Set();
  let motion = 'full';

  function persistSeen() {
    if (!storage) return;
    try { storage.setItem(storageKey, JSON.stringify(seenOrder.slice(-MAX_SEEN_EVENTS))); } catch { /* optional storage */ }
  }

  function remember(identity) {
    if (seen.has(identity)) return false;
    seen.add(identity);
    seenOrder.push(identity);
    while (seenOrder.length > MAX_SEEN_EVENTS) seen.delete(seenOrder.shift());
    return true;
  }

  function ingest(items, { prime = false } = {}) {
    let changed = false;
    const ordered = [...(items ?? [])].sort((left, right) => (
      (Date.parse(left?.timestamp ?? '') || 0) - (Date.parse(right?.timestamp ?? '') || 0)
    ));
    for (const item of ordered) {
      const definition = TRANSITION_TYPES[item?.type];
      if (!definition) continue;
      const identity = eventIdentity(item);
      if (!remember(identity)) continue;
      changed = true;
      if (!prime) {
        queue.push({
          id: identity,
          kind: definition.kind,
          duration_ms: motion === 'reduced' ? 0 : definition.duration_ms,
          event: item,
        });
      }
    }
    if (changed) persistSeen();
    return queue.length;
  }

  function tick(now) {
    if (pauseReasons.size || queue.length === 0) return false;
    const transition = queue.shift();
    apply({ ...transition, started_at_ms: now });
    return true;
  }

  function setMotion(nextMotion) {
    motion = nextMotion === 'reduced' ? 'reduced' : 'full';
    if (motion === 'reduced') {
      queue.forEach((transition) => { transition.duration_ms = 0; });
    }
  }

  function pause(reason = 'manual') { pauseReasons.add(reason); }
  function resume(reason = 'manual') { pauseReasons.delete(reason); }
  function clear() { queue.length = 0; pauseReasons.clear(); }

  return {
    ingest,
    tick,
    setMotion,
    pause,
    resume,
    clear,
    pending: () => queue.length,
  };
}

