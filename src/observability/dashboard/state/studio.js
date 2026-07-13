/**
 * Server-owned projection for Agent Force Studio.
 *
 * This is the only place that translates persisted run/task/lifecycle state
 * into Studio semantics. Browser modules render this contract; they do not
 * inspect raw run events or infer delivery truth independently.
 *
 * owner: RStack developed by Richardson Gunde
 */
import { CANONICAL_SDLC_STAGES } from '../../../core/harness/stages.js';
import { RSTACK_MISSIONS } from '../../../core/harness/missions.js';

export const STUDIO_SCHEMA_VERSION = 1;

const TASK_STATUS = Object.freeze({
  PENDING: 'queued',
  READY: 'queued',
  IN_PROGRESS: 'active',
  BLOCKED: 'blocked',
  FAIL: 'failed',
  PASS: 'completed',
});

const LIFECYCLE_TYPES = new Set([
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
]);

const TIMELINE_TYPES = new Set([
  ...LIFECYCLE_TYPES,
  'task_started',
  'task_validated',
  'stage_completed',
  'approval_gate_blocked',
  'dor_gate_blocked',
  'guardrail_blocked',
  'guardrail_overridden',
  'task_retry_scheduled',
  'task_retry_exhausted',
  'task_human_context_required',
  'task_blocked_by_validator',
  'stage_checkpoint_before_saved',
  'stage_checkpoint_after_saved',
  'stage_checkpoint_saved',
]);

const WORK_OBJECT_TYPES = Object.freeze({
  delegation_requested: 'delegation',
  handoff_created: 'handoff',
  artifact_emitted: 'artifact',
});

function eventTimestamp(event) {
  return event?.timestamp ?? event?.ts ?? null;
}

function timestampMs(value) {
  const parsed = Date.parse(value ?? '');
  return Number.isFinite(parsed) ? parsed : null;
}

function compareEvents(a, b) {
  const left = timestampMs(eventTimestamp(a)) ?? 0;
  const right = timestampMs(eventTimestamp(b)) ?? 0;
  return left - right;
}

function safeId(value, fallback = null) {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return /^[a-zA-Z0-9._:@-]{1,180}$/.test(trimmed) ? trimmed : fallback;
}

function safeIds(values, limit = 32) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map((value) => safeId(value)).filter(Boolean))].slice(0, limit);
}

function safeText(value, limit = 240) {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  return text ? text.slice(0, limit) : null;
}

function safeSource(value) {
  const source = safeText(value, 240);
  if (!source) return null;
  if (/^[a-zA-Z]:[\\/]/.test(source) || source.startsWith('/')) {
    return source.split(/[\\/]/).filter(Boolean).at(-1) ?? null;
  }
  if (source.split('/').some((part) => part === '..')) return null;
  return source;
}

function eventIdentity(event) {
  return safeId(event?.id)
    ?? [
      safeId(event?.type, 'event'),
      safeId(event?.agent_session_id, ''),
      safeId(event?.delegation_id, ''),
      safeId(event?.task_id, ''),
      eventTimestamp(event) ?? '',
    ].join(':');
}

function dedupeEvents(events) {
  const seen = new Set();
  const result = [];
  for (const event of [...(events ?? [])].sort(compareEvents)) {
    const identity = eventIdentity(event);
    if (seen.has(identity)) continue;
    seen.add(identity);
    result.push(event);
  }
  return result;
}

function chooseRun(runs) {
  return runs.find((run) => run?.derivedStatus === 'active') ?? runs[0] ?? null;
}

function normalizedTaskStatus(task) {
  return TASK_STATUS[String(task?.status ?? '').toUpperCase()] ?? 'unknown';
}

function taskStageIds(task) {
  const stageIds = [
    ...(task?.stage_artifacts ?? []).map((artifact) => artifact?.stage_id),
    task?.stageId,
    task?.stage_id,
  ];
  const canonical = new Set(CANONICAL_SDLC_STAGES.map((stage) => stage.id));
  return [...new Set(stageIds.filter((stageId) => canonical.has(stageId)))];
}

function baseSession(event, taskById, runId) {
  const taskId = safeId(event?.task_id);
  const task = taskById.get(taskId);
  const sessionId = safeId(event?.agent_session_id)
    ?? `observed:${safeId(event?.delegation_id, 'unidentified')}:${taskId ?? 'unscoped'}`;
  return {
    id: sessionId,
    run_id: runId,
    task_id: taskId,
    mission_id: taskById.has(taskId) ? taskId : null,
    stage_ids: safeIds(event?.stage_ids?.length ? event.stage_ids : taskStageIds(task)),
    delegation_id: safeId(event?.delegation_id),
    agent_id: safeId(event?.agent_id),
    role: safeId(event?.role, 'unknown'),
    harness: safeId(event?.harness),
    model: safeId(event?.model),
    sandbox_id: safeId(event?.sandbox_id),
    status: 'starting',
    identity_confidence: 'observed',
    specialist_ids: safeIds(event?.specialist_ids),
    skill_ids: safeIds(event?.skill_ids),
    plugin_ids: safeIds(event?.plugin_ids),
    waiting_reason: null,
    activity: null,
    started_at: eventTimestamp(event),
    last_activity_at: eventTimestamp(event),
    ended_at: null,
    source: 'events.jsonl',
  };
}

function mergeSessionIdentity(session, event, taskById) {
  const taskId = safeId(event?.task_id);
  if (!session.task_id && taskId) session.task_id = taskId;
  if (!session.mission_id && taskById.has(taskId)) session.mission_id = taskId;
  if (!session.delegation_id) session.delegation_id = safeId(event?.delegation_id);
  if (!session.agent_id) session.agent_id = safeId(event?.agent_id);
  if (session.role === 'unknown') session.role = safeId(event?.role, 'unknown');
  if (!session.harness) session.harness = safeId(event?.harness);
  if (!session.model) session.model = safeId(event?.model);
  if (!session.sandbox_id) session.sandbox_id = safeId(event?.sandbox_id);
  if (event?.stage_ids?.length) session.stage_ids = safeIds(event.stage_ids);
}

function observedSessions(events, taskById, runId) {
  const sessions = new Map();
  for (const event of events) {
    if (!LIFECYCLE_TYPES.has(event?.type) || !event?.agent_session_id) continue;
    const id = safeId(event.agent_session_id);
    if (!id) continue;
    const session = sessions.get(id) ?? baseSession(event, taskById, runId);
    mergeSessionIdentity(session, event, taskById);
    const at = eventTimestamp(event);
    if (at) session.last_activity_at = at;

    if (event.type === 'agent_session_started') {
      session.status = 'starting';
      session.started_at ??= at;
    } else if (event.type === 'agent_session_ready') {
      session.status = 'active';
    } else if (event.type === 'agent_capabilities_attached') {
      session.specialist_ids = safeIds([...session.specialist_ids, ...(event.specialist_ids ?? [])]);
      session.skill_ids = safeIds([...session.skill_ids, ...(event.skill_ids ?? [])]);
      session.plugin_ids = safeIds([...session.plugin_ids, ...(event.plugin_ids ?? [])]);
    } else if (event.type === 'agent_activity') {
      session.status = session.status === 'starting' ? 'active' : session.status;
      session.activity = safeText(event.summary);
    } else if (event.type === 'agent_waiting') {
      session.status = 'waiting';
      session.waiting_reason = safeId(event.reason_class, 'unknown');
    } else if (event.type === 'agent_session_completed') {
      session.status = 'completed';
      session.ended_at = at;
      session.waiting_reason = null;
    } else if (event.type === 'agent_session_failed') {
      session.status = 'failed';
      session.ended_at = at;
      session.waiting_reason = null;
    } else if (event.type === 'agent_session_stopped') {
      if (!['completed', 'failed'].includes(session.status)) session.status = 'stopped';
      session.ended_at = at ?? session.ended_at;
    }
    sessions.set(id, session);
  }
  return sessions;
}

function addTaskDerivedSessions(sessions, tasks, runId) {
  const observedTaskIds = new Set(
    [...sessions.values()].map((session) => session.task_id).filter(Boolean),
  );
  for (const task of tasks ?? []) {
    const status = normalizedTaskStatus(task);
    const hasRecordedWork = Boolean(task?.builder || task?.validation);
    if (observedTaskIds.has(task?.id)) continue;
    if (!['active', 'blocked', 'failed'].includes(status) && !hasRecordedWork) continue;
    const sessionId = `task-derived:${runId}:${task.id}:builder`;
    sessions.set(sessionId, {
      id: sessionId,
      run_id: runId,
      task_id: safeId(task.id),
      mission_id: RSTACK_MISSIONS.some((mission) => mission.id === task.id) ? task.id : null,
      stage_ids: taskStageIds(task),
      delegation_id: null,
      agent_id: safeId(task.agent ?? task.agent_name ?? task.pipeline_agents?.[0]),
      role: 'builder',
      harness: safeId(task.builder?.harness),
      model: safeId(task.builder?.model),
      sandbox_id: null,
      status,
      identity_confidence: 'task_derived',
      specialist_ids: safeIds(task.specialists),
      skill_ids: [],
      plugin_ids: [],
      waiting_reason: status === 'blocked' ? 'task_blocked' : null,
      activity: safeText(task.builder?.summary ?? task.builder?.memory_summary?.work_done),
      started_at: task._started_at ? new Date(task._started_at).toISOString() : null,
      last_activity_at: null,
      ended_at: ['completed', 'failed'].includes(status) ? safeText(task.validation?.timestamp) : null,
      source: 'tasks.json',
    });
  }
}

function missionView(mission, task, sessions) {
  const missionSessions = [...sessions.values()].filter((session) => session.mission_id === mission.id);
  const status = normalizedTaskStatus(task);
  return {
    id: mission.id,
    title: mission.title,
    order: mission.order,
    domains: [...mission.domains],
    stage_ids: [...mission.stageIds],
    task_id: safeId(task?.id),
    status,
    counts: {
      sessions: missionSessions.length,
      active: missionSessions.filter((session) => ['starting', 'active'].includes(session.status)).length,
      waiting: missionSessions.filter((session) => session.status === 'waiting').length,
      failed: missionSessions.filter((session) => session.status === 'failed').length,
      completed: missionSessions.filter((session) => session.status === 'completed').length,
    },
    source: task ? 'tasks.json' : null,
  };
}

function departmentViews(missions) {
  return CANONICAL_SDLC_STAGES.map((stage, order) => {
    const missionIds = missions
      .filter((mission) => mission.stage_ids.includes(stage.id))
      .map((mission) => mission.id);
    const states = missions.filter((mission) => missionIds.includes(mission.id)).map((mission) => mission.status);
    const status = ['failed', 'blocked', 'waiting', 'active', 'completed', 'queued']
      .find((candidate) => states.includes(candidate)) ?? 'unknown';
    return {
      id: stage.id,
      title: stage.title,
      artifact: stage.artifact,
      order,
      mission_ids: missionIds,
      status,
      source: 'canonical-stages',
    };
  });
}

function capabilityAttachments(sessions) {
  const result = [];
  for (const session of sessions.values()) {
    for (const [kind, ids] of [
      ['specialist', session.specialist_ids],
      ['skill', session.skill_ids],
      ['plugin', session.plugin_ids],
    ]) {
      for (const capabilityId of ids) {
        result.push({
          id: `${session.id}:${kind}:${capabilityId}`,
          session_id: session.id,
          run_id: session.run_id,
          kind,
          capability_id: capabilityId,
          source: session.identity_confidence === 'observed' ? 'events.jsonl' : 'tasks.json',
        });
      }
    }
  }
  return result;
}

function workObjects(events, runId) {
  return events
    .filter((event) => WORK_OBJECT_TYPES[event.type])
    .slice(-120)
    .map((event) => ({
      id: eventIdentity(event),
      kind: WORK_OBJECT_TYPES[event.type],
      run_id: runId,
      task_id: safeId(event.task_id),
      mission_id: safeId(event.task_id),
      stage_ids: safeIds(event.stage_ids),
      delegation_id: safeId(event.delegation_id),
      session_id: safeId(event.agent_session_id),
      source: safeSource(event.source) ?? 'events.jsonl',
      timestamp: eventTimestamp(event),
      status: safeId(event.status, 'observed'),
    }));
}

function governanceItems(state, runId) {
  const gates = (state?.blockedGates ?? [])
    .filter((item) => !item?.runId || item.runId === runId)
    .map((item) => ({
      id: safeId(item.id) ?? `gate:${runId}:${safeId(item.taskId, 'unscoped')}`,
      kind: safeId(item.type, 'gate'),
      run_id: runId,
      task_id: safeId(item.taskId),
      title: safeText(item.title ?? item.detail ?? 'Governance gate'),
      status: safeId(item.status, 'blocked'),
      source: safeSource(item.source) ?? 'blocked-gates',
      timestamp: item.ts ?? item.timestamp ?? null,
    }));
  const approvals = (state?.approvals ?? [])
    .filter((item) => (!item?.runId || item.runId === runId) && String(item?.status ?? '').toLowerCase() === 'pending')
    .map((item) => ({
      id: safeId(item.id) ?? `approval:${runId}:${safeId(item.taskId, 'unscoped')}`,
      kind: 'approval',
      run_id: runId,
      task_id: safeId(item.taskId),
      title: safeText(item.title ?? item.artifact ?? 'Approval required'),
      status: 'pending',
      source: safeSource(item.source) ?? 'approvals',
      timestamp: item.ts ?? item.timestamp ?? null,
    }));
  return [...gates, ...approvals].slice(0, 80);
}

function evidenceItems(state, run) {
  const projected = (state?.evidenceCenter?.items ?? [])
    .filter((item) => !item?.runId || item.runId === run.runId)
    .map((item) => ({
      id: safeId(item.id) ?? `evidence:${run.runId}:${safeId(item.taskId, 'unscoped')}:${safeId(item.kind, 'item')}`,
      kind: safeId(item.kind, 'evidence'),
      run_id: run.runId,
      task_id: safeId(item.taskId),
      stage_id: safeId(item.stageId ?? item.stage_id),
      title: safeText(item.title ?? item.label ?? item.artifact ?? 'Evidence'),
      status: safeId(item.status, 'observed'),
      source: safeSource(item.source ?? item.path ?? item.artifact) ?? 'evidence-center',
      timestamp: item.ts ?? item.timestamp ?? null,
    }));
  const reports = (run.stageReports ?? []).map((report) => {
    const record = typeof report === 'string' ? { stage_id: report } : report;
    const stageId = safeId(record?.stage_id ?? record?.stageId);
    const stage = CANONICAL_SDLC_STAGES.find((entry) => entry.id === stageId);
    return {
      id: `stage-report:${run.runId}:${stageId ?? 'unknown'}`,
      kind: 'stage_report',
      run_id: run.runId,
      task_id: safeId(record?.task_id ?? record?.taskId),
      stage_id: stageId,
      title: safeText(record?.title ?? record?.label ?? stage?.title ?? 'Stage report'),
      status: safeId(record?.status, 'observed'),
      source: safeSource(record?.source ?? record?.path ?? record?.artifact) ?? 'stage-reports',
      timestamp: record?.ts ?? record?.timestamp ?? null,
    };
  });
  const seen = new Set();
  return [...projected, ...reports].filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  }).slice(0, 80);
}

function timelineItems(events, runId) {
  return events
    .filter((event) => TIMELINE_TYPES.has(event?.type))
    .slice(-120)
    .map((event) => ({
      id: eventIdentity(event),
      type: event.type,
      run_id: runId,
      task_id: safeId(event.task_id),
      stage_ids: safeIds(event.stage_ids ?? (event.stage_id ? [event.stage_id] : [])),
      delegation_id: safeId(event.delegation_id),
      session_id: safeId(event.agent_session_id),
      role: safeId(event.role),
      status: safeId(event.status),
      activity_class: safeId(event.activity_class),
      reason_class: safeId(event.reason_class),
      summary: safeText(event.summary),
      source: safeSource(event.source) ?? 'events.jsonl',
      timestamp: eventTimestamp(event),
      entity_id: safeId(event.agent_session_id ?? event.delegation_id ?? event.task_id),
    }));
}

function sourceNextAction(state, runId) {
  const action = (state?.actions ?? []).find((item) => !item?.runId || item.runId === runId);
  if (!action) return null;
  return {
    id: safeId(action.id),
    type: safeId(action.type, 'action'),
    title: safeText(action.title ?? action.label ?? action.summary),
    source: safeSource(action.source) ?? 'actions-projection',
  };
}

function latestObservedAt(run, events) {
  const candidates = [
    run?.manifest?.updated_at,
    run?.manifest?.created_at,
    ...events.map(eventTimestamp),
  ].filter((value) => timestampMs(value) !== null);
  return candidates.sort((a, b) => (timestampMs(b) ?? 0) - (timestampMs(a) ?? 0))[0] ?? null;
}

function freshness(observedAt, evaluatedAt) {
  const observedMs = timestampMs(observedAt);
  const evaluatedMs = timestampMs(evaluatedAt);
  if (observedMs === null || evaluatedMs === null || observedMs > evaluatedMs + 5000) {
    return { observed_at: observedAt, age_ms: null, state: 'unknown', source: observedAt ? 'run-state' : null };
  }
  const ageMs = evaluatedMs - observedMs;
  return {
    observed_at: observedAt,
    age_ms: ageMs,
    state: ageMs > 30_000 ? 'stale' : 'fresh',
    source: 'run-state',
  };
}

function emptyStudio(state, evaluatedAt) {
  const missions = RSTACK_MISSIONS.map((mission) => missionView(mission, null, new Map()));
  return {
    schema_version: STUDIO_SCHEMA_VERSION,
    generated_at: evaluatedAt,
    availability: 'unavailable',
    freshness: { observed_at: null, age_ms: null, state: 'unknown', source: null },
    scope: {
      project_id: safeId(state?.scope?.projectId),
      run_id: null,
      source: state?.scope ? 'scope-projection' : null,
    },
    orchestrator: { id: 'orchestrator:unscoped', goal: null, status: 'unknown', next_action: null },
    missions,
    departments: departmentViews(missions),
    sessions: [],
    capability_attachments: [],
    work_objects: [],
    governance_items: [],
    evidence_items: [],
    timeline: [],
    limitations: [{ code: 'no_run_selected', message: 'No delivery run is available in the selected scope.' }],
  };
}

export function buildStudioProjection(state, { evaluatedAt = state?.ts ?? new Date().toISOString() } = {}) {
  const run = chooseRun(state?.runs ?? []);
  if (!run) return emptyStudio(state, evaluatedAt);

  const events = dedupeEvents(run.events ?? []);
  const taskById = new Map((run.tasks ?? []).map((entry) => [entry.id, entry]));
  const sessions = observedSessions(events, taskById, run.runId);
  addTaskDerivedSessions(sessions, run.tasks ?? [], run.runId);
  const missions = RSTACK_MISSIONS.map((mission) => missionView(mission, taskById.get(mission.id), sessions));
  const observedCount = [...sessions.values()].filter((session) => session.identity_confidence === 'observed').length;
  const limitations = [];
  if (observedCount === 0) {
    limitations.push({
      code: 'partial_lifecycle_coverage',
      message: 'Agent sessions are derived from task state because normalized lifecycle events are unavailable.',
    });
  }
  if (String(run.manifest?.harness ?? '').toLowerCase() === 'tau' && observedCount === 0) {
    limitations.push({
      code: 'tau_delegation_lifecycle_unavailable',
      message: 'Tau does not expose delegated-session lifecycle; task and stage state remain available.',
    });
  }

  return {
    schema_version: STUDIO_SCHEMA_VERSION,
    generated_at: evaluatedAt,
    availability: observedCount > 0 ? 'available' : 'partial',
    freshness: freshness(latestObservedAt(run, events), evaluatedAt),
    scope: {
      project_id: safeId(run.projectId ?? state?.scope?.projectId),
      run_id: safeId(run.runId),
      source: 'run-state',
    },
    orchestrator: {
      id: `orchestrator:${run.runId}`,
      goal: safeText(run.manifest?.goal, 320),
      status: safeId(run.derivedStatus, 'unknown'),
      next_action: sourceNextAction(state, run.runId),
    },
    missions,
    departments: departmentViews(missions),
    sessions: [...sessions.values()].sort((a, b) => (
      (timestampMs(a.started_at) ?? 0) - (timestampMs(b.started_at) ?? 0)
      || a.id.localeCompare(b.id)
    )),
    capability_attachments: capabilityAttachments(sessions),
    work_objects: workObjects(events, run.runId),
    governance_items: governanceItems(state, run.runId),
    evidence_items: evidenceItems(state, run),
    timeline: timelineItems(events, run.runId),
    limitations,
  };
}
