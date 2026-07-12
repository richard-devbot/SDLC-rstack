// owner: RStack developed by Richardson Gunde

import { approvalHistoryIssues, validateApprovalRecord } from '../../../core/harness/approval-audit.js';

export const EVIDENCE_KINDS = Object.freeze(['implementation', 'test', 'security', 'compliance', 'approval']);

const PASS = new Set(['PASS', 'PASSED', 'APPROVED', 'ACCEPTED', 'SUCCESS', 'SUCCEEDED']);
const FAIL = new Set(['FAIL', 'FAILED', 'BLOCKED', 'REJECTED', 'DENIED', 'ERROR']);

function norm(value) {
  return String(value ?? '').trim().toUpperCase();
}

function evidenceKind(entry) {
  const text = `${entry?.kind ?? ''} ${entry?.task_id ?? ''} ${entry?.stage_id ?? ''}`.toLowerCase();
  if (/approv|decision/.test(text)) return 'approval';
  if (/compliance|audit|13-/.test(text)) return 'compliance';
  if (/security|threat|sast|dast|12-/.test(text)) return 'security';
  if (/test|validat|qa|08-/.test(text)) return 'test';
  return 'implementation';
}

function referencesRequirement(value, requirementId) {
  if (!requirementId) return false;
  const direct = value?.requirement_id ?? value?.requirementId ?? value?.req_id;
  if (direct !== undefined) return String(direct) === String(requirementId);
  return JSON.stringify(value ?? '').toLowerCase().includes(String(requirementId).toLowerCase());
}

function source(run, kind, path, extra = {}) {
  const normalizedPath = String(path ?? '');
  const safe = normalizedPath && !normalizedPath.includes('..') && !normalizedPath.startsWith('/');
  return {
    kind,
    path: normalizedPath,
    projectRoot: run.projectRoot ?? null,
    runId: run.runId,
    available: extra.available !== false,
    linkable: safe && normalizedPath.startsWith('.rstack/'),
    ...extra,
  };
}

function uniqueSources(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.kind}:${item.projectRoot ?? ''}:${item.runId ?? ''}:${item.path}:${item.recordId ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function integrityFor(run, token) {
  return (run.integrity ?? []).some((issue) => String(issue.file ?? issue.path ?? '').toLowerCase().includes(token));
}

function ledgerSignals(run, requirementId, kind) {
  return (run.evidence ?? [])
    .filter((entry) => evidenceKind(entry) === kind && referencesRequirement(entry, requirementId))
    .map((entry, index) => ({
      status: norm(entry.status),
      evaluator: entry.evaluator ?? entry.source ?? entry.task_id ?? null,
      evaluatedAt: entry.ts ?? null,
      sourceRef: source(run, 'evidence_ledger', `.rstack/runs/${run.runId}/evidence.jsonl`, {
        recordId: entry.id ?? `${entry.task_id ?? kind}:${index}`,
        taskId: entry.task_id ?? null,
        evidence: entry.evidence ?? null,
      }),
    }));
}

function validationSignals(run, requirementId) {
  return (run.tasks ?? []).flatMap((task) => (task.validation?.checks ?? [])
    .filter((check) => referencesRequirement(check, requirementId))
    .map((check, index) => ({
      status: norm(check.status),
      evaluator: task.agent_name ?? task.id,
      evaluatedAt: check.ts ?? task.validation?.ts ?? null,
      sourceRef: source(run, 'validation', `.rstack/runs/${run.runId}/tasks/${task.id}/validation.json`, {
        recordId: check.id ?? check.name ?? `${task.id}:${index}`,
        taskId: task.id,
        evidence: check.evidence ?? null,
      }),
    })));
}

function approvalSignals(run, requirementId) {
  const history = (run.approvals ?? []).filter((record) => referencesRequirement(record, requirementId));
  if (!history.length) return [];
  const historyTrusted = approvalHistoryIssues(history).length === 0;
  return history.map((record, index) => ({
    status: historyTrusted && validateApprovalRecord(record, { expectedRunId: run.runId }).ok
      ? norm(record.status)
      : 'INVALID',
    evaluator: record.approver ?? record.actor?.name ?? null,
    evaluatedAt: record.timestamp ?? null,
    sourceRef: source(run, 'approval_audit', `.rstack/runs/${run.runId}/approvals.json`, {
      recordId: record.id ?? record.artifact ?? `approval:${index}`,
    }),
  }));
}

function cell(run, requirementId, kind, evaluatedAt) {
  const signals = kind === 'approval'
    ? approvalSignals(run, requirementId)
    : [...ledgerSignals(run, requirementId, kind), ...(kind === 'test' ? validationSignals(run, requirementId) : [])];
  const damaged = integrityFor(run, kind === 'approval' ? 'approvals.json' : kind === 'test' ? 'validation.json' : 'evidence.jsonl')
    || (kind !== 'approval' && integrityFor(run, 'evidence.jsonl'));
  const negative = signals.filter((signal) => FAIL.has(signal.status));
  const positive = signals.filter((signal) => PASS.has(signal.status));
  const invalid = signals.filter((signal) => signal.status === 'INVALID');
  const status = negative.length ? 'failed' : positive.length && !damaged && !invalid.length ? 'verified' : 'unknown';
  const chosen = negative.length ? negative : status === 'verified' ? positive : signals;
  return {
    kind,
    expected: true,
    observed: signals.length > 0,
    status,
    availability: damaged ? 'inaccessible' : signals.length ? invalid.length ? 'invalid' : 'available' : 'not_observed',
    sourceRefs: uniqueSources(chosen.map((signal) => ({ ...signal.sourceRef, available: !damaged }))),
    evaluator: chosen.find((signal) => signal.evaluator)?.evaluator ?? null,
    evaluatedAt: chosen.find((signal) => signal.evaluatedAt)?.evaluatedAt ?? evaluatedAt,
  };
}

export function buildEvidenceProjection(state, options = {}) {
  const evaluatedAt = options.evaluatedAt ?? new Date().toISOString();
  const runs = (state?.runs ?? []).filter((run) => (
    (!options.projectRoot || run.projectRoot === options.projectRoot)
    && (!options.runId || run.runId === options.runId)
  ));
  const rows = runs.flatMap((run) => (run.requirements ?? []).map((requirement, index) => {
    const requirementId = requirement.id ?? requirement.req_id ?? `requirement-${index + 1}`;
    const cells = Object.fromEntries(EVIDENCE_KINDS.map((kind) => [kind, cell(run, requirementId, kind, evaluatedAt)]));
    return {
      id: `${run.projectRoot ?? ''}:${run.runId}:${requirementId}`,
      requirementId,
      requirement: requirement.description ?? requirement.requirement ?? requirement.text ?? requirement.title ?? requirementId,
      priority: requirement.priority ?? 'unranked',
      projectRoot: run.projectRoot ?? null,
      runId: run.runId,
      stageId: requirement.stage_id ?? '02-requirements',
      cells,
    };
  }));
  const cells = rows.flatMap((row) => Object.values(row.cells));
  const summary = {
    requirements: rows.length,
    expected: cells.length,
    verified: cells.filter((entry) => entry.status === 'verified').length,
    failed: cells.filter((entry) => entry.status === 'failed').length,
    unknown: cells.filter((entry) => entry.status === 'unknown').length,
  };
  summary.coveragePercent = summary.expected ? Math.round((summary.verified / summary.expected) * 100) : null;
  const sources = uniqueSources(cells.flatMap((entry) => entry.sourceRefs));
  const status = summary.failed ? 'blocked' : !summary.expected || summary.unknown ? 'unknown' : 'verified';
  return {
    status,
    summary,
    rows,
    sources,
    evaluatedAt,
    kinds: EVIDENCE_KINDS,
    rationale: rows.flatMap((row) => EVIDENCE_KINDS.map((kind) => ({
      id: `${row.id}:${kind}`,
      requirementId: row.requirementId,
      kind,
      status: row.cells[kind].status,
      sourceRefs: row.cells[kind].sourceRefs,
    }))),
  };
}

