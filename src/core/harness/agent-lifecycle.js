/**
 * Safe normalized lifecycle events for delegated agent sessions.
 *
 * The event stream is persisted and later exposed through a compact Studio
 * projection, so this constructor accepts only structural identifiers and a
 * short normalized summary. Prompts, tool arguments, stderr, and absolute
 * sandbox paths are deliberately outside the contract.
 *
 * owner: RStack developed by Richardson Gunde
 */
const TYPES = [
  'delegation_requested',
  'agent_session_started',
  'agent_session_ready',
  'agent_capabilities_attached',
  'agent_activity',
  'agent_waiting',
  'handoff_created',
  'artifact_emitted',
  'agent_session_completed',
  'agent_session_failed',
  'agent_session_stopped',
];

export const AGENT_LIFECYCLE_TYPES = new Set(TYPES);

const TERMINAL_TYPES = new Set([
  'agent_session_completed',
  'agent_session_failed',
  'agent_session_stopped',
]);

const ARRAY_FIELDS = new Set([
  'stage_ids',
  'specialist_ids',
  'skill_ids',
  'plugin_ids',
  'evidence_refs',
]);

const ID_FIELDS = new Set([
  'run_id',
  'task_id',
  'delegation_id',
  'agent_session_id',
  'agent_id',
  'role',
  'harness',
  'model',
  'status',
  'activity_class',
  'reason_class',
  'source',
  'from',
  'to',
]);

function safeId(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^[a-zA-Z0-9._:@-]{1,180}$/.test(trimmed) ? trimmed : null;
}

function safeIds(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map(safeId).filter(Boolean))].slice(0, 32);
}

function safeSummary(value) {
  if (value === null || value === undefined) return null;
  const summary = String(value)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return summary ? summary.slice(0, 240) : null;
}

function safeSandboxId(value) {
  if (typeof value !== 'string') return null;
  return safeId(value.split(/[\\/]/).filter(Boolean).at(-1));
}

export function agentLifecycleEvent(type, fields = {}, { now = new Date().toISOString() } = {}) {
  if (!AGENT_LIFECYCLE_TYPES.has(type)) {
    throw new TypeError(`Unknown agent lifecycle event: ${type}`);
  }

  const event = { type, timestamp: now };
  for (const field of ARRAY_FIELDS) {
    if (fields[field] !== undefined) event[field] = safeIds(fields[field]);
  }
  for (const field of ID_FIELDS) {
    const value = safeId(fields[field]);
    if (value) event[field] = value;
  }
  const sandboxId = safeSandboxId(fields.sandbox_id);
  if (sandboxId) event.sandbox_id = sandboxId;
  const summary = safeSummary(fields.summary);
  if (summary) event.summary = summary;

  return event;
}

export function isTerminalAgentLifecycle(type) {
  return TERMINAL_TYPES.has(type);
}
