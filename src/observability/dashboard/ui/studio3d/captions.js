/**
 * Renderer-free communication facts for the Agent Force company floor.
 *
 * Every line is derived from a server projection or lifecycle transition so
 * the canvas and semantic DOM can share the same honest, text-only wording.
 *
 * owner: RStack developed by Richardson Gunde
 */

export const MAX_CAPTIONS = 8;

export function truncateCaption(value, max = 48) {
  const withoutControls = [...String(value ?? '')]
    .map((character) => {
      const code = character.charCodeAt(0);
      return code <= 0x1f || code === 0x7f ? ' ' : character;
    })
    .join('');
  const text = withoutControls
    .replace(/\s+/g, ' ')
    .trim();
  const limit = Math.max(0, Number.isSafeInteger(max) ? max : 48);
  if (text.length <= limit) return text;
  if (limit < 1) return '';
  return `${text.slice(0, limit - 1)}…`;
}

function captionFact(id, ownerKind, ownerId, kind, text, priority, timestamp = 0) {
  return {
    id,
    ownerKind,
    ownerId,
    kind,
    text: truncateCaption(text),
    priority,
    timestamp: Number(timestamp) || 0,
  };
}

export function approvalCaptionFacts(summary) {
  const count = Number.isSafeInteger(summary?.pending_count) ? summary.pending_count : 0;
  if (count < 1) return [];
  const artifact = truncateCaption(summary?.artifact || `${count} pending`, 40);
  return [
    captionFact(
      'approval-manager-speech',
      'orchestrator',
      'orchestrator',
      'speech',
      `Requesting approval · ${artifact}`,
      100,
    ),
    captionFact(
      'approval-human-speech',
      'human',
      'human-approver',
      'speech',
      `Reviewing ${count} pending approval${count === 1 ? '' : 's'}`,
      100,
    ),
    captionFact(
      'approval-manager-thought',
      'orchestrator',
      'orchestrator',
      'thought',
      'Awaiting human sign-off',
      90,
    ),
  ];
}

export function waitingCaptionFacts(sessions = []) {
  return sessions
    .filter((session) => session?.status === 'waiting' && session.waiting_reason)
    .map((session) => captionFact(
      `waiting:${session.id}`,
      'session',
      session.id,
      'thought',
      `Waiting · ${truncateCaption(session.waiting_reason, 32)}`,
      60,
      Date.parse(session.last_activity_at ?? '') || 0,
    ));
}

export function transitionCaptionFact(transition) {
  const action = transition?.intent?.action;
  const event = transition?.event ?? {};
  let text = null;
  if (action === 'collect_capabilities') {
    const skill = truncateCaption(event.skill_ids?.[0], 28);
    text = skill ? `collecting ${skill}` : 'collecting capabilities';
  } else if (action === 'delegate') {
    const role = truncateCaption(event.role, 24);
    text = role ? `delegating → ${role}` : 'delegating';
  } else if (action === 'handoff') {
    const recipient = truncateCaption(event.to, 24);
    text = recipient ? `handoff → ${recipient}` : 'handoff';
  } else if (action === 'return_evidence') {
    text = 'delivering evidence';
  } else if (action === 'retry') {
    text = Number.isSafeInteger(event.attempt)
      ? `retrying (attempt ${event.attempt})`
      : 'retrying';
  } else if (action === 'manager_check_in') {
    text = 'walking to desk';
  }
  if (!text) return null;
  const managerAction = action === 'manager_check_in' || action === 'delegate';
  return captionFact(
    `action:${transition.id}`,
    managerAction ? 'orchestrator' : 'session',
    managerAction ? 'orchestrator' : transition.intent.sessionId,
    'action',
    text,
    80,
    transition.started_at_ms ?? 0,
  );
}

export function selectCaptionFacts(facts = [], { limit = MAX_CAPTIONS } = {}) {
  return facts
    .filter(Boolean)
    .slice()
    .sort((a, b) => (
      (Number(b.priority) || 0) - (Number(a.priority) || 0)
      || (Number(b.timestamp) || 0) - (Number(a.timestamp) || 0)
      || (Number(a.distance) || Infinity) - (Number(b.distance) || Infinity)
      || String(a.id).localeCompare(String(b.id))
    ))
    .slice(0, Math.max(0, Number(limit) || 0));
}

export function waitingSemanticText(session) {
  return waitingCaptionFacts([session])[0]?.text ?? '';
}

export function approvalSemanticText(summary) {
  const count = Number.isSafeInteger(summary?.pending_count) ? summary.pending_count : 0;
  if (count < 1) return '';
  const artifact = truncateCaption(summary?.artifact || `${count} pending`, 48);
  return `Human approval · ${count} pending approval${count === 1 ? '' : 's'} · ${artifact}`;
}
