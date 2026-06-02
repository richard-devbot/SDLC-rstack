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

export async function resolveApprovalAcrossRoots(roots, id, decision, resolvedBy, options = {}) {
  for (const root of roots ?? []) {
    const ok = await resolveApproval(root, id, decision, resolvedBy, options);
    if (ok) return true;
  }
  return false;
}
