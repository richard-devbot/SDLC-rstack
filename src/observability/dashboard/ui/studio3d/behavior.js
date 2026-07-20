/**
 * Source-backed robot behavior mapping for Agent Force Studio.
 *
 * owner: RStack developed by Richardson Gunde
 */
const ACTIONS = Object.freeze({
  delegation_requested: Object.freeze(['delegate', null, null]),
  agent_session_started: Object.freeze(['enter', null, null]),
  agent_session_ready: Object.freeze(['walk_to_assignment', null, null]),
  agent_capabilities_attached: Object.freeze(['collect_capabilities', null, null]),
  agent_activity: Object.freeze(['work', null, null]),
  agent_waiting: Object.freeze(['wait', null, 'waiting']),
  approval_gate_blocked: Object.freeze(['wait', null, 'approval']),
  dor_gate_blocked: Object.freeze(['wait', null, 'guardrail']),
  guardrail_blocked: Object.freeze(['wait', null, 'guardrail']),
  task_human_context_required: Object.freeze(['wait', null, 'context']),
  task_retry_exhausted: Object.freeze(['fail', null, 'retry_exhausted']),
  task_blocked_by_validator: Object.freeze(['wait', null, 'validation']),
  handoff_created: Object.freeze(['handoff', null, 'handoff']),
  artifact_emitted: Object.freeze(['return_evidence', null, 'evidence']),
  task_retry_scheduled: Object.freeze(['retry', null, 'retry']),
  agent_session_completed: Object.freeze(['complete', null, 'complete']),
  agent_session_failed: Object.freeze(['fail', null, 'failure']),
  agent_session_stopped: Object.freeze(['exit', null, null]),
});

const GESTURES = Object.freeze({
  planning: 'monitor_focus',
  reading: 'monitor_focus',
  file: 'keyboard',
  file_edit: 'keyboard',
  tool: 'mouse',
  tool_call: 'mouse',
  test: 'validation_monitor',
  validation: 'validation_monitor',
  artifact: 'output_dock',
  unknown: 'status_only',
});

export function safeActivityGesture(value) {
  return GESTURES[String(value ?? 'unknown').toLowerCase()] ?? 'status_only';
}

export function behaviorIntent(event) {
  const definition = ACTIONS[event?.type];
  if (!definition) return null;
  const stageIds = Array.isArray(event.stage_ids)
    ? [...event.stage_ids]
    : event.stage_id ? [event.stage_id] : [];
  return {
    action: definition[0],
    sessionId: event.agent_session_id ?? event.session_id ?? event.entity_id ?? null,
    taskId: event.task_id ?? null,
    stageIds,
    gesture: event.type === 'agent_activity'
      ? safeActivityGesture(event.activity_class)
      : definition[1],
    notification: event.reason_class ?? definition[2],
  };
}

export function managerIntent(event) {
  // The orchestrator's reasons to leave HQ — each one an observed lifecycle
  // event, never invented: a capability attachment sends the manager on a
  // skill run to the Skills Library; a session reaching its desk, a handoff,
  // or a scheduled retry earns a walking check-in at that desk.
  if (event?.type === 'agent_capabilities_attached') {
    return {
      action: 'manager_skill_run',
      sessionId: event.agent_session_id ?? event.session_id ?? event.entity_id ?? null,
      taskId: event.task_id ?? null,
      trigger: event.type,
      skillId: event.skill_ids?.[0] ?? null,
    };
  }
  if (!['handoff_created', 'task_retry_scheduled', 'agent_session_ready'].includes(event?.type)) return null;
  return {
    action: 'manager_check_in',
    sessionId: event.agent_session_id ?? event.session_id ?? event.entity_id ?? null,
    taskId: event.task_id ?? null,
    trigger: event.type,
    attempt: Number.isSafeInteger(event.attempt) ? event.attempt : undefined,
  };
}

export function restingBehavior(session) {
  if (session?.status === 'failed') return 'failed';
  if (session?.status === 'waiting' || session?.status === 'blocked') return 'waiting';
  if (session?.status === 'completed') return 'complete';
  if (session?.status !== 'active') return 'standing';
  return session?.role === 'validator' ? 'validating' : 'seated_work';
}

export function freezeReason(studio, connectionState) {
  if (connectionState === 'disconnected' || connectionState === 'error') return connectionState;
  if (studio?.freshness?.state === 'stale') return 'stale';
  return null;
}
