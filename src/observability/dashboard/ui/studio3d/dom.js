/**
 * Accessible semantic renderer for Agent Force Studio.
 *
 * Projection values are inserted with textContent only. The canvas mirrors
 * this tree and is never the sole carrier of operational facts.
 *
 * owner: RStack developed by Richardson Gunde
 */
import { formatSnapshotAge, statusLabel } from './model.js';

const ANNOUNCED_TYPES = new Set([
  'agent_session_failed',
  'agent_waiting',
  'handoff_created',
  'approval_gate_blocked',
  'dor_gate_blocked',
  'guardrail_blocked',
  'task_human_context_required',
  'artifact_emitted',
  'agent_session_completed',
]);

function element(doc, tag, className = '', text = null) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== null && text !== undefined) node.textContent = String(text);
  return node;
}

function clear(node) {
  node?.replaceChildren();
}

function emptyState(doc, message) {
  return element(doc, 'p', 'studio-panel-empty', message);
}

function stateMark(doc, state) {
  const chip = element(doc, 'span', 'studio-state', statusLabel(state));
  chip.dataset.state = state ?? 'unknown';
  const icon = element(doc, 'span', 'studio-state-icon', null);
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = ({
    active: '●', starting: '◐', waiting: 'Ⅱ', blocked: '!', failed: '×',
    completed: '✓', queued: '○', stopped: '■', fresh: '●', stale: '!',
  })[state] ?? '?';
  chip.prepend(icon);
  return chip;
}

function fact(doc, label, value) {
  const row = element(doc, 'div', 'studio-fact');
  row.append(element(doc, 'dt', '', label), element(doc, 'dd', '', value ?? 'Unavailable'));
  return row;
}

function entityButton(doc, kind, entity, body) {
  const button = element(doc, 'button', `studio-entity studio-${kind}`);
  button.type = 'button';
  button.dataset.entityKind = kind;
  button.dataset.entityId = entity.id;
  button.setAttribute('aria-label', `${entity.title ?? entity.id}: ${statusLabel(entity.status)}`);
  button.append(body);
  return button;
}

function populatePicker(doc, select, snapshot) {
  const runs = snapshot?.scopeCatalog?.runs ?? [];
  const selected = snapshot?.scope?.runKey ?? null;
  clear(select);
  if (runs.length === 0) {
    const option = element(doc, 'option', '', 'No runs available');
    option.value = '';
    select.append(option);
    select.disabled = true;
    return;
  }
  select.disabled = false;
  const all = element(doc, 'option', '', 'Most relevant scoped run');
  all.value = '';
  select.append(all);
  for (const run of runs) {
    const label = [run.projectName, run.worktreeName, run.goal ?? run.runId].filter(Boolean).join(' · ');
    const option = element(doc, 'option', '', label);
    option.value = run.key;
    option.selected = run.key === selected;
    select.append(option);
  }
}

export function createStudioDom(root, {
  onSelect = () => {},
  onRunSelect = () => {},
} = {}) {
  const doc = root.ownerDocument ?? root;
  const byId = (id) => doc.getElementById(id);
  const runSelect = byId('studio-run-select');
  const connection = byId('studio-connection');
  const freshness = byId('studio-freshness');
  const goal = byId('studio-goal');
  const orchestratorBody = byId('studio-orchestrator-body');
  const missionsRoot = byId('studio-missions');
  const sessionsRoot = byId('studio-sessions');
  const governanceRoot = byId('studio-governance');
  const evidenceRoot = byId('studio-evidence');
  const limitationsSection = byId('studio-limitations-section');
  const limitationsRoot = byId('studio-limitations');
  const timelineRoot = byId('studio-timeline');
  const inspector = byId('studio-inspector');
  const inspectorKind = byId('studio-inspector-kind');
  const inspectorTitle = byId('studio-inspector-title');
  const inspectorBody = byId('studio-inspector-body');
  const inspectorClose = byId('studio-inspector-close');
  const announcer = byId('studio-announcer');
  let snapshot = null;
  let studio = null;
  let selectedRef = null;
  let trigger = null;
  let initializedTimeline = false;
  const seenTimeline = new Set();

  function findEntity(kind, id) {
    if (!studio) return null;
    if (kind === 'orchestrator') return studio.orchestrator?.id === id ? studio.orchestrator : null;
    const collection = ({
      mission: studio.missions,
      department: studio.departments,
      session: studio.sessions,
      governance: studio.governance_items,
      evidence: studio.evidence_items,
    })[kind] ?? [];
    return collection.find((item) => item.id === id) ?? null;
  }

  function renderInspector(kind, entity, focus = true) {
    if (!entity) return;
    inspectorKind.textContent = kind === 'session' ? `${statusLabel(entity.role)} session` : statusLabel(kind);
    inspectorTitle.textContent = entity.title ?? entity.goal ?? entity.id;
    clear(inspectorBody);
    const facts = element(doc, 'dl', 'studio-facts');
    facts.append(
      fact(doc, 'Status', statusLabel(entity.status)),
      fact(doc, 'Run', entity.run_id ?? studio.scope?.run_id),
      fact(doc, 'Task', entity.task_id),
      fact(doc, 'Source', entity.source),
      fact(doc, 'Observed', entity.timestamp ?? entity.last_activity_at ?? entity.started_at),
    );
    if (kind === 'session') {
      facts.append(
        fact(doc, 'Identity', statusLabel(entity.identity_confidence)),
        fact(doc, 'Harness', entity.harness),
        fact(doc, 'Model', entity.model),
        fact(doc, 'Sandbox', entity.sandbox_id),
        fact(doc, 'Waiting for', entity.waiting_reason),
        fact(doc, 'Stages', entity.stage_ids?.length ? entity.stage_ids.join(', ') : 'Unavailable'),
        fact(doc, 'Activity class', entity.activity_class ? statusLabel(entity.activity_class) : 'Unavailable'),
        fact(doc, 'Last activity', entity.last_activity_at),
      );
    }
    inspectorBody.append(facts);
    const capabilities = [
      ...(entity.specialist_ids ?? []).map((id) => `Specialist · ${id}`),
      ...(entity.skill_ids ?? []).map((id) => `Skill · ${id}`),
      ...(entity.plugin_ids ?? []).map((id) => `Plugin · ${id}`),
    ];
    if (capabilities.length) {
      const heading = element(doc, 'h3', '', 'Attached capabilities');
      const list = element(doc, 'ul', 'studio-capabilities');
      for (const label of capabilities) list.append(element(doc, 'li', '', label));
      inspectorBody.append(heading, list);
    }
    if (entity.activity) inspectorBody.append(element(doc, 'p', 'studio-inspector-summary', entity.activity));
    inspector.hidden = false;
    selectedRef = `${kind}:${entity.id}`;
    for (const button of doc.querySelectorAll('[data-entity-kind]')) {
      const current = `${button.dataset.entityKind}:${button.dataset.entityId}` === selectedRef;
      if (current) button.setAttribute('aria-current', 'true');
      else button.removeAttribute('aria-current');
    }
    if (focus) inspectorTitle.focus({ preventScroll: true });
  }

  function select(kind, id, { focus = true, sourceElement = null, notify = false } = {}) {
    const entity = findEntity(kind, id);
    if (!entity) return false;
    trigger = sourceElement ?? trigger;
    renderInspector(kind, entity, focus);
    if (notify) onSelect({ kind, id });
    return true;
  }

  function renderOrchestrator() {
    clear(orchestratorBody);
    const orchestrator = studio.orchestrator;
    if (!orchestrator) {
      orchestratorBody.append(emptyState(doc, 'No orchestrator state observed.'));
      return;
    }
    const body = element(doc, 'div', 'orchestrator-briefing');
    body.append(stateMark(doc, orchestrator.status));
    const next = orchestrator.next_action?.title ?? 'No source-backed next action available.';
    body.append(element(doc, 'p', 'orchestrator-next', next));
    const button = entityButton(doc, 'orchestrator', orchestrator, body);
    orchestratorBody.append(button);
  }

  function renderMissions() {
    clear(missionsRoot);
    for (const mission of studio.missions) {
      const body = element(doc, 'span', 'mission-body');
      const heading = element(doc, 'span', 'mission-title', mission.title);
      const meta = element(doc, 'span', 'mission-meta', `${mission.stage_ids.length} departments · ${mission.counts.sessions} sessions`);
      body.append(heading, stateMark(doc, mission.status), meta);
      missionsRoot.append(entityButton(doc, 'mission', mission, body));
    }
    const active = studio.missions.filter((mission) => mission.status !== 'unknown').length;
    byId('mission-count').textContent = `${active} / ${studio.missions.length} observed`;
  }

  function renderSessions() {
    clear(sessionsRoot);
    if (studio.sessions.length === 0) {
      sessionsRoot.append(emptyState(doc, 'No active session observed. Lifecycle coverage may be unavailable.'));
    }
    for (const session of studio.sessions) {
      const body = element(doc, 'span', 'session-body');
      body.append(
        element(doc, 'span', 'session-role', `${statusLabel(session.role)} · ${session.agent_id ?? 'Unattributed agent'}`),
        stateMark(doc, session.status),
        element(doc, 'span', 'session-meta', `${statusLabel(session.identity_confidence)} identity · ${session.task_id ?? 'No task scope'}`),
      );
      sessionsRoot.append(entityButton(doc, 'session', session, body));
    }
    const observed = studio.sessions.filter((session) => session.identity_confidence === 'observed').length;
    byId('session-count').textContent = `${observed} observed · ${studio.sessions.length - observed} derived`;
  }

  function renderStack(target, kind, items, emptyMessage) {
    clear(target);
    if (!items.length) target.append(emptyState(doc, emptyMessage));
    for (const item of items) {
      const body = element(doc, 'span', 'stack-item-body');
      body.append(element(doc, 'span', 'stack-title', item.title ?? item.id), stateMark(doc, item.status));
      body.append(element(doc, 'span', 'stack-meta', [item.source, item.timestamp].filter(Boolean).join(' · ') || 'Source unavailable'));
      target.append(entityButton(doc, kind, item, body));
    }
  }

  function renderTimeline() {
    clear(timelineRoot);
    if (!studio.timeline.length) timelineRoot.append(element(doc, 'li', 'studio-panel-empty', 'No lifecycle events observed.'));
    const newestAnnouncements = [];
    for (const item of [...studio.timeline].reverse()) {
      const row = element(doc, 'li', 'timeline-item');
      row.dataset.eventType = item.type;
      row.append(
        element(doc, 'time', 'timeline-time', item.timestamp ?? 'Time unavailable'),
        element(doc, 'strong', 'timeline-type', statusLabel(item.type)),
        element(doc, 'span', 'timeline-summary', item.summary ?? item.reason_class ?? item.task_id ?? 'Source-backed lifecycle event'),
        element(doc, 'span', 'timeline-source', item.source ?? 'Source unavailable'),
      );
      timelineRoot.append(row);
      if (!seenTimeline.has(item.id) && ANNOUNCED_TYPES.has(item.type)) {
        newestAnnouncements.push(item.summary ?? `${statusLabel(item.type)} for ${item.task_id ?? 'the selected run'}`);
      }
      seenTimeline.add(item.id);
    }
    if (initializedTimeline && newestAnnouncements.length) announcer.textContent = newestAnnouncements.at(-1);
    initializedTimeline = true;
    byId('timeline-source').textContent = studio.timeline.length ? 'events.jsonl projection' : 'No lifecycle source';
  }

  function render(nextSnapshot) {
    snapshot = nextSnapshot;
    studio = snapshot.studio;
    populatePicker(doc, runSelect, snapshot);
    goal.textContent = studio.orchestrator?.goal ?? 'No run goal available.';
    freshness.textContent = `${statusLabel(studio.freshness?.state)} · ${formatSnapshotAge(studio.freshness)}`;
    freshness.dataset.state = studio.freshness?.state ?? 'unknown';
    renderOrchestrator();
    renderMissions();
    renderSessions();
    renderStack(governanceRoot, 'governance', studio.governance_items ?? [], 'No governance item requires attention.');
    renderStack(evidenceRoot, 'evidence', studio.evidence_items ?? [], 'No evidence item is available in this scope.');
    clear(limitationsRoot);
    limitationsSection.hidden = !(studio.limitations?.length);
    for (const limitation of studio.limitations ?? []) limitationsRoot.append(element(doc, 'li', '', limitation.message));
    renderTimeline();
    if (selectedRef) {
      const [kind, ...idParts] = selectedRef.split(':');
      if (!select(kind, idParts.join(':'), { focus: false })) closeInspector(false);
    }
  }

  function closeInspector(restoreFocus = true) {
    inspector.hidden = true;
    selectedRef = null;
    for (const button of doc.querySelectorAll('[aria-current="true"]')) button.removeAttribute('aria-current');
    if (restoreFocus && trigger?.isConnected) trigger.focus();
  }

  function onEntityClick(event) {
    const button = event.target.closest('[data-entity-kind]');
    if (!button) return;
    select(button.dataset.entityKind, button.dataset.entityId, {
      sourceElement: button,
      notify: true,
    });
  }

  function setConnection(state) {
    const value = typeof state === 'string' ? state : state?.state ?? 'unknown';
    root.dataset.connection = value;
    connection.textContent = statusLabel(value);
    connection.dataset.state = value;
    if (state?.detail) connection.title = state.detail;
  }

  function renderUnavailable(message) {
    goal.textContent = message;
    for (const target of [orchestratorBody, missionsRoot, sessionsRoot, governanceRoot, evidenceRoot]) {
      clear(target);
      target.append(emptyState(doc, message));
    }
  }

  root.addEventListener('click', onEntityClick);
  runSelect.addEventListener('change', () => onRunSelect(runSelect.value || null));
  inspectorClose.addEventListener('click', () => closeInspector(true));
  inspector.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeInspector(true);
  });

  return {
    render,
    renderUnavailable,
    select: (ref, options) => select(ref.kind, ref.id, options),
    setConnection,
    closeInspector,
    destroy() {
      root.removeEventListener('click', onEntityClick);
      closeInspector(false);
      snapshot = null;
      studio = null;
    },
  };
}
