import {
  readApprovals,
  pendingApprovals,
  approvalSummary,
  resolveApproval,
  approvalQueueId,
} from '../../../core/tracker/approvals.js';

// owner: RStack developed by Richardson Gunde

export async function getAllApprovals(roots) {
  const perRoot = await Promise.all((roots ?? []).map(async (root) => {
    const approvals = await readApprovals(root);
    return approvals.map((approval) => ({ ...approval, projectRoot: approval.projectRoot ?? root, source: approval.source ?? 'queue' }));
  }));
  return perRoot.flat().sort((a, b) => (b.ts ?? '').localeCompare(a.ts ?? ''));
}

export function buildBlockedGates(runs) {
  return (runs ?? []).flatMap((run) => (run.events ?? [])
    .filter((event) => event.type === 'approval_gate_blocked')
    .map((event) => ({
      id: `${run.runId}-${event.ts ?? event.task_id ?? 'blocked'}`,
      type: event.type,
      title: `Approval required - missing ${(event.missing ?? []).join(', ') || event.reason || 'artifact'}`,
      detail: event.task_id ? `Task ${event.task_id} could not proceed` : 'Workflow could not proceed',
      taskId: event.task_id ?? null,
      missing: event.missing ?? [],
      runId: run.runId,
      projectRoot: run.projectRoot,
      ts: event.ts,
      source: 'events',
    })))
    .sort((a, b) => (b.ts ?? '').localeCompare(a.ts ?? ''));
}

export function approvalRequestsFromBlockedGates(blockedGates, queueApprovals = []) {
  const existing = new Set((queueApprovals ?? []).map((approval) => approval.id));
  const requests = [];

  for (const gate of blockedGates ?? []) {
    const missing = gate.missing?.length ? gate.missing : ['manager-approval'];
    for (const artifact of missing) {
      const id = approvalQueueId({ runId: gate.runId, taskId: gate.taskId, artifact });
      if (existing.has(id)) continue;
      existing.add(id);
      requests.push({
        id,
        title: `Approve ${artifact}`,
        detail: gate.detail,
        status: 'pending',
        runId: gate.runId,
        taskId: gate.taskId,
        artifact,
        projectRoot: gate.projectRoot,
        source: 'blocked_gate',
        ts: gate.ts,
      });
    }
  }

  return requests;
}

export function summarizeApprovals(queueApprovals) {
  const pending = pendingApprovals(queueApprovals);
  return {
    approvals: queueApprovals,
    pendingApprovals: pending,
    approvalStats: approvalSummary(queueApprovals),
  };
}

// #156 (CONSUMED lifecycle): the queue entry freezes at 'approved' the moment
// a manager signs off, but a guardrail override is a one-shot credential —
// the harness appends a run-level CONSUMED record when the claim spends it
// (in-lock, before the attempt is granted). Cross-reference the run-level
// history so the card shows the full lifecycle instead of a stale 'approved'.
// Server-owned semantics: pages render `lifecycle`, they never re-derive it.
export function annotateApprovalLifecycle(queueApprovals, runs) {
  const latestByKey = new Map();
  for (const run of runs ?? []) {
    for (const record of run.approvals ?? []) {
      if (!record?.artifact) continue;
      const key = `${run.runId}|${record.artifact}`;
      const previous = latestByKey.get(key);
      if (!previous || String(record.timestamp ?? '') >= String(previous.timestamp ?? '')) {
        latestByKey.set(key, record);
      }
    }
  }
  return (queueApprovals ?? []).map((item) => {
    if (!item?.artifact || !item.runId) return item;
    const latest = latestByKey.get(`${item.runId}|${item.artifact}`);
    if (latest && String(latest.status ?? '').toUpperCase() === 'CONSUMED') {
      return { ...item, lifecycle: 'consumed', consumedAt: latest.timestamp ?? null };
    }
    return item;
  });
}

export async function resolveApprovalAcrossRoots(roots, id, decision, resolvedBy, options = {}) {
  for (const root of roots ?? []) {
    const ok = await resolveApproval(root, id, decision, resolvedBy, options);
    if (ok) return true;
  }
  return false;
}
