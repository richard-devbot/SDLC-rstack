// owner: RStack developed by Richardson Gunde

const SEVERITY_RANK = Object.freeze({ critical: 0, high: 1, medium: 2, low: 3 });
const CLOSED = new Set(['approved', 'rejected', 'consumed', 'resolved', 'expired']);

function statusOf(value) {
  const status = String(value ?? 'open').toLowerCase();
  if (status === 'pending') return 'open';
  if (status === 'approve') return 'approved';
  if (status === 'reject') return 'rejected';
  return ['open', 'claimed', 'approved', 'rejected', 'consumed', 'resolved', 'expired'].includes(status) ? status : 'open';
}

function severityOf(value, fallback = 'medium') {
  const severity = String(value ?? fallback).toLowerCase();
  if (severity === 'error' || severity === 'fatal') return 'critical';
  if (severity === 'warning' || severity === 'warn') return 'medium';
  return Object.hasOwn(SEVERITY_RANK, severity) ? severity : fallback;
}

function runFor(state, runId) {
  return (state.runs ?? []).find((run) => run.runId === runId) ?? null;
}

function scopeOf(record, run) {
  return {
    projectId: record.projectId ?? run?.project?.id ?? null,
    projectRoot: record.projectRoot ?? run?.projectRoot ?? null,
    runId: record.runId ?? run?.runId ?? null,
    stageId: record.stageId ?? record.stage_id ?? null,
    taskId: record.taskId ?? record.task_id ?? null,
  };
}

function guardrailKey(runId, taskId) {
  return runId && taskId ? `guardrail:${runId}:${taskId}` : null;
}

function baseAction(input) {
  return {
    id: input.id,
    dedupeKey: input.dedupeKey ?? input.id,
    type: input.type,
    severity: input.severity ?? 'medium',
    blocking: input.blocking === true,
    title: input.title,
    consequence: input.consequence,
    nextStep: input.nextStep,
    projectId: input.projectId ?? null,
    projectRoot: input.projectRoot ?? null,
    runId: input.runId ?? null,
    stageId: input.stageId ?? null,
    taskId: input.taskId ?? null,
    owner: input.owner ?? null,
    audience: input.audience ?? null,
    needsMe: null,
    createdAt: input.createdAt ?? null,
    updatedAt: input.updatedAt ?? input.createdAt ?? null,
    resolvedAt: input.resolvedAt ?? null,
    status: input.status ?? 'open',
    source: input.source,
    allowedActions: input.allowedActions ?? [],
    audit: input.audit ?? null,
    availability: input.availability ?? 'available',
    stale: input.stale === true,
    signals: [input.signal ?? { kind: input.source.kind, recordId: input.source.recordId ?? null }],
    producerRank: input.producerRank ?? 50,
  };
}

function approvalActions(state) {
  return (state.approvals ?? []).map((approval) => {
    const run = runFor(state, approval.runId);
    const scope = scopeOf(approval, run);
    const artifact = String(approval.artifact ?? 'approval');
    const overrideTask = artifact.startsWith('guardrail-override:') ? artifact.slice('guardrail-override:'.length) : scope.taskId;
    const status = statusOf(approval.status);
    const stale = Boolean(run?.pipelineRollup?.stale) && !CLOSED.has(status);
    return baseAction({
      id: `approval:${approval.id ?? artifact}`,
      dedupeKey: guardrailKey(scope.runId, overrideTask) ?? `approval:${approval.id ?? artifact}:${scope.runId ?? 'global'}`,
      type: 'approval', severity: artifact.startsWith('guardrail-override:') ? 'critical' : 'high', blocking: !CLOSED.has(status),
      title: approval.title ?? `Approval required for ${artifact}`,
      consequence: approval.detail ?? approval.reason ?? 'Governed work cannot continue until this approval is resolved.',
      nextStep: CLOSED.has(status) ? `Inspect the ${status} approval audit trail.` : 'Review the governed request in Approvals.',
      ...scope, taskId: overrideTask ?? scope.taskId,
      owner: approval.approver ?? approval.owner ?? null, audience: 'approver',
      createdAt: approval.ts ?? approval.createdAt ?? null, updatedAt: approval.updatedAt ?? approval.timestamp ?? approval.ts ?? null,
      resolvedAt: CLOSED.has(status) ? approval.timestamp ?? approval.resolvedAt ?? null : null,
      status,
      source: { kind: 'approval', recordId: approval.id ?? null, path: approval.path ?? (scope.runId ? `.rstack/runs/${scope.runId}/approvals.json` : '.rstack/approvals.json') },
      allowedActions: stale || CLOSED.has(status) ? [] : (Array.isArray(approval.allowedActions) ? approval.allowedActions : []),
      audit: { source: approval.source ?? 'queue', lifecycle: approval.status ?? 'pending' },
      availability: stale ? 'stale' : 'available', stale, producerRank: 0,
    });
  });
}

function gateActions(state) {
  return (state.blockedGates ?? []).flatMap((gate) => {
    const run = runFor(state, gate.runId);
    const scope = scopeOf(gate, run);
    const missing = gate.missing?.length ? gate.missing : ['manager-approval'];
    return missing.map((artifact) => {
      const overrideTask = String(artifact).startsWith('guardrail-override:') ? String(artifact).slice('guardrail-override:'.length) : scope.taskId;
      return baseAction({
        id: `gate:${gate.id}:${artifact}`,
        dedupeKey: guardrailKey(scope.runId, overrideTask) ?? `gate:${gate.id}:${artifact}`,
        type: 'approval', severity: 'critical', blocking: true,
        title: gate.title ?? `Approval required for ${artifact}`,
        consequence: gate.detail ?? 'A governed gate stopped this delivery.',
        nextStep: 'Review the matching approval request and its source event.',
        ...scope, taskId: overrideTask ?? scope.taskId,
        createdAt: gate.ts ?? null, status: 'open',
        source: { kind: 'blocked_gate', recordId: gate.id ?? null, path: scope.runId ? `.rstack/runs/${scope.runId}/events.jsonl` : '.rstack events' },
        availability: run?.pipelineRollup?.stale ? 'stale' : 'available', stale: Boolean(run?.pipelineRollup?.stale), producerRank: 10,
      });
    });
  });
}

function taskActions(state) {
  return (state.runs ?? []).flatMap((run) => (run.tasks ?? []).flatMap((task) => {
    const status = String(task.status ?? '').toUpperCase();
    const validation = String(task.validation?.status ?? '').toUpperCase();
    if (!['FAIL', 'FAILED', 'BLOCKED'].includes(status) && !['FAIL', 'FAILED'].includes(validation)) return [];
    const exhausted = status === 'BLOCKED' && run.pipelineRollup?.next_action?.kind === 'guardrail_blocked'
      && (!run.pipelineRollup.next_action.task_id || run.pipelineRollup.next_action.task_id === task.id);
    const stale = Boolean(run.pipelineRollup?.stale);
    const scope = scopeOf({ runId: run.runId, stageId: task.stageId ?? task.stage_id, taskId: task.id }, run);
    return [baseAction({
      id: `${exhausted ? 'guardrail' : 'failure'}:${run.runId}:${task.id}`,
      dedupeKey: exhausted ? guardrailKey(run.runId, task.id) : `failure:${run.runId}:${task.id}`,
      type: exhausted ? 'approval' : 'failure', severity: 'critical', blocking: true,
      title: exhausted ? `Retry approval needed for ${task.title ?? task.id}` : `Failed work: ${task.title ?? task.id}`,
      consequence: task.validation?.issues?.[0] ?? (exhausted ? 'The retry budget is exhausted and work remains blocked.' : 'The task or its validation failed.'),
      nextStep: exhausted ? 'Review the guardrail override request.' : 'Inspect validation evidence and correct the failure.',
      ...scope, owner: task.agent_name ?? null,
      createdAt: run.pipelineRollup?.generated_at ?? run.manifest?.created_at ?? null, status: 'open',
      source: { kind: exhausted ? 'pipeline' : 'task', recordId: task.id, path: `.rstack/runs/${run.runId}/${exhausted ? 'pipeline-state.json' : `tasks/${task.id}/validation.json`}` },
      availability: stale ? 'stale' : 'available', stale, producerRank: exhausted ? 20 : 5,
    })];
  }));
}

function decisionActions(state) {
  return (state.decisions?.runs ?? []).flatMap((entry) => (entry.decisions ?? [])
    .filter((decision) => statusOf(decision.status) === 'open')
    .map((decision) => {
      const run = runFor(state, entry.runId);
      const scope = scopeOf({ ...decision, runId: entry.runId, projectRoot: entry.projectRoot, stageId: decision.required_before_stage }, run);
      return baseAction({
        id: `decision:${entry.runId}:${decision.decision_id ?? decision.id}`,
        type: 'decision', severity: decision.impact === 'security' ? 'high' : 'medium', blocking: Boolean(decision.required_before_stage),
        title: decision.question ?? decision.title ?? 'Decision required',
        consequence: decision.impact ? `This unresolved ${decision.impact} decision can delay the run.` : 'The run is waiting for a human decision.',
        nextStep: 'Review the decision context and record a resolution.',
        ...scope, owner: decision.owner ?? null, audience: 'decision-maker',
        createdAt: decision.created_at ?? decision.ts ?? null, status: 'open',
        source: { kind: 'decision', recordId: decision.decision_id ?? decision.id ?? null, path: `.rstack/runs/${entry.runId}/decisions.json` },
        producerRank: 15,
      });
    }));
}

function alertActions(state) {
  return (state.alerts ?? []).map((alert, index) => {
    const run = runFor(state, alert.runId);
    const scope = scopeOf(alert, run);
    return baseAction({
      id: `alert:${alert.id ?? index}`, type: 'alert', severity: severityOf(alert.severity ?? alert.level, 'high'), blocking: alert.blocking === true || severityOf(alert.severity ?? alert.level, 'high') === 'critical',
      title: alert.title ?? 'Operational alert', consequence: alert.detail ?? alert.message ?? 'An operational condition requires review.',
      nextStep: 'Open Operations to inspect the signal and remediation.', ...scope,
      // evaluateAlerts stamps snapshot time in `ts`; do not rename that
      // volatile evaluation clock into durable action age/ETag state.
      createdAt: alert.createdAt ?? null, status: statusOf(alert.status),
      source: { kind: 'alert', recordId: alert.id ?? null, path: alert.path ?? (scope.runId ? `.rstack/runs/${scope.runId}/events.jsonl` : '.rstack alerts') },
      availability: run?.pipelineRollup?.stale ? 'stale' : 'available', stale: Boolean(run?.pipelineRollup?.stale), producerRank: 25,
    });
  });
}

function configurationActions(state) {
  return (state.diagnostics?.configIssues ?? []).map((issue, index) => baseAction({
    id: `configuration:${issue.projectId ?? issue.root ?? 'global'}:${issue.field ?? index}`,
    type: 'configuration', severity: 'high', blocking: issue.blocking === true,
    title: `Configuration needs attention${issue.field ? `: ${issue.field}` : ''}`,
    consequence: issue.message ?? issue.error ?? 'The configured value is invalid or unavailable.',
    nextStep: 'Correct the named configuration source and run diagnostics again.',
    projectId: issue.projectId ?? null, projectRoot: issue.root ?? null,
    createdAt: issue.ts ?? null, status: 'open',
    source: { kind: 'configuration', recordId: issue.field ?? null, path: issue.path ?? '.rstack configuration' },
    producerRank: 30,
  }));
}

function auditActions(state) {
  return (state.feed ?? []).filter((item) => item.type === 'approval_audit_failed').map((item, index) => {
    const data = item.data ?? {};
    const run = runFor(state, item.runId);
    const scope = scopeOf(item, run);
    return baseAction({
      id: `audit:${data.record_id ?? index}`, type: 'audit', severity: 'critical', blocking: true,
      title: `Invalid approval record${data.artifact ? `: ${data.artifact}` : ''}`,
      consequence: data.reason ?? 'The approval record failed consistency checks and was not trusted.',
      nextStep: 'Inspect the rejected record and create a fresh governed approval if required.',
      ...scope, createdAt: item.ts ?? null, status: 'open',
      source: { kind: 'approval_audit', recordId: data.record_id ?? null, path: scope.runId ? `.rstack/runs/${scope.runId}/approvals.json` : '.rstack approvals' },
      audit: { claimedStatus: data.status ?? null, issues: Array.isArray(data.issues) ? data.issues : [] },
      availability: 'invalid', allowedActions: [], producerRank: 1,
    });
  });
}

function mergeGroup(group) {
  const sorted = [...group].sort((a, b) => a.producerRank - b.producerRank || a.id.localeCompare(b.id));
  const primary = { ...sorted[0] };
  primary.signals = sorted.flatMap((item) => item.signals);
  primary.blocking = sorted.some((item) => item.blocking);
  primary.severity = sorted.map((item) => item.severity).sort((a, b) => SEVERITY_RANK[a] - SEVERITY_RANK[b])[0];
  primary.createdAt = sorted.map((item) => item.createdAt).filter(Boolean).sort()[0] ?? null;
  primary.updatedAt = sorted.map((item) => item.updatedAt).filter(Boolean).sort().at(-1) ?? primary.createdAt;
  if (sorted.some((item) => item.availability === 'invalid')) primary.availability = 'invalid';
  else if (sorted.some((item) => item.availability === 'stale')) primary.availability = 'stale';
  if (primary.availability !== 'available') primary.allowedActions = [];
  delete primary.dedupeKey;
  delete primary.producerRank;
  return primary;
}

export function buildActions(state, options = {}) {
  const raw = [
    ...approvalActions(state), ...gateActions(state), ...taskActions(state), ...decisionActions(state),
    ...alertActions(state), ...configurationActions(state), ...auditActions(state),
  ];
  const groups = new Map();
  for (const action of raw) {
    if (!groups.has(action.dedupeKey)) groups.set(action.dedupeKey, []);
    groups.get(action.dedupeKey).push(action);
  }
  return [...groups.values()].map(mergeGroup).sort((a, b) => {
    if (a.blocking !== b.blocking) return a.blocking ? -1 : 1;
    const severity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (severity) return severity;
    const aClosed = CLOSED.has(a.status);
    const bClosed = CLOSED.has(b.status);
    if (aClosed !== bClosed) return aClosed ? 1 : -1;
    const age = String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? ''));
    return age || a.id.localeCompare(b.id);
  }).slice(0, options.limit ?? 250);
}
