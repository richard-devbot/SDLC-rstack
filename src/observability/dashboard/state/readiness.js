// owner: RStack developed by Richardson Gunde

import { approvalHistoryIssues, validateApprovalRecord } from '../../../core/harness/approval-audit.js';

const PASS_STATUSES = new Set(['PASS', 'PASSED', 'DONE', 'COMPLETED', 'SUCCESS', 'SUCCEEDED']);
const FAIL_STATUSES = new Set(['FAIL', 'FAILED', 'ERROR', 'BLOCKED']);
const OPEN_STATUSES = new Set(['IN_PROGRESS', 'RUNNING', 'PENDING', 'READY', 'QUEUED', 'IDLE']);

function normalizedStatus(value) {
  return String(value ?? '').trim().toUpperCase();
}

function runSource(run, file, kind, available = true) {
  return {
    kind,
    path: `.rstack/runs/${run.runId}/${file}`,
    runId: run.runId,
    projectRoot: run.projectRoot ?? null,
    available,
  };
}

function taskSource(entry, file = 'tasks.json', kind = 'tasks', available = true) {
  return runSource(entry.run, file === 'validation.json'
    ? `tasks/${entry.task.id}/validation.json`
    : file, kind, available);
}

function uniqueSources(sources) {
  const seen = new Set();
  return sources.filter((source) => {
    const key = `${source.kind}:${source.projectRoot ?? ''}:${source.runId ?? ''}:${source.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function check(id, label, status, summary, sourceRefs = []) {
  return { id, label, status, summary, sourceRefs: uniqueSources(sourceRefs) };
}

function approvalTime(record, casing) {
  const stamp = casing === 'run'
    ? record?.timestamp
    : record?.updatedAt ?? record?.resolvedAt ?? record?.ts;
  const time = Date.parse(stamp ?? '');
  return Number.isFinite(time) ? time : -Infinity;
}

function latestApprovalCandidate(state, gate, artifact) {
  const candidates = [];
  const run = (state?.runs ?? []).find((entry) => (
    entry.runId === gate.runId
    && (!gate.projectRoot || !entry.projectRoot || entry.projectRoot === gate.projectRoot)
  ));
  const runHistory = (run?.approvals ?? []).filter((record) => record?.artifact === artifact);
  if (runHistory.length) {
    const latest = runHistory[runHistory.length - 1];
    const trusted = approvalHistoryIssues(runHistory).length === 0
      && validateApprovalRecord(latest, { expectedRunId: run.runId }).ok;
    candidates.push({
      status: trusted ? normalizedStatus(latest.status) : 'INVALID',
      time: approvalTime(latest, 'run'),
    });
  }

  const queueHistory = (state?.approvals ?? []).filter((record) => (
    record?.artifact === artifact
    && (!record.runId || record.runId === gate.runId)
    && (!record.projectRoot || !gate.projectRoot || record.projectRoot === gate.projectRoot)
    && (!record.taskId || !gate.taskId || record.taskId === gate.taskId)
  )).sort((a, b) => approvalTime(a, 'queue') - approvalTime(b, 'queue'));
  if (queueHistory.length) {
    const latest = queueHistory[queueHistory.length - 1];
    candidates.push({
      status: approvalHistoryIssues(queueHistory).length === 0
        && validateApprovalRecord(latest, { casing: 'queue' }).ok
        ? normalizedStatus(latest.status ?? 'pending')
        : 'INVALID',
      time: approvalTime(latest, 'queue'),
    });
  }

  return candidates.sort((a, b) => b.time - a.time)[0] ?? null;
}

function gateIsResolved(state, gate) {
  const gateTime = Date.parse(gate?.ts ?? '');
  if (!Number.isFinite(gateTime)) return false;
  const artifacts = gate?.missing?.length ? gate.missing : ['manager-approval'];
  return artifacts.every((artifact) => {
    const latest = latestApprovalCandidate(state, gate, artifact);
    return latest
      && latest.time >= gateTime
      && (latest.status === 'APPROVED' || latest.status === 'CONSUMED');
  });
}

function scopedState(state, runs) {
  const identities = new Set(runs.map((run) => `${run.projectRoot ?? ''}\u0000${run.runId}`));
  const roots = new Set(runs.map((run) => run.projectRoot).filter(Boolean));
  const runIds = new Set(runs.map((run) => run.runId));
  const belongsToScope = (record) => {
    if (!record) return false;
    if (record.projectRoot && record.runId) return identities.has(`${record.projectRoot}\u0000${record.runId}`);
    if (record.projectRoot) return roots.has(record.projectRoot);
    if (record.runId) return runIds.has(record.runId);
    return false;
  };
  return {
    ...state,
    runs,
    blockedGates: (state?.blockedGates ?? []).filter(belongsToScope),
    pendingApprovals: (state?.pendingApprovals ?? []).filter(belongsToScope),
    alerts: (state?.alerts ?? []).filter(belongsToScope),
  };
}

/**
 * Build the release-readiness conclusion consumed by every dashboard page.
 * It uses only state already loaded by the dashboard and never writes to the
 * governed run. Missing proof remains unknown; it is not converted to zero.
 */
export function buildReadinessProjection(state, options = {}) {
  const runs = state?.runs ?? [];
  const evaluatedAt = options.evaluatedAt ?? new Date().toISOString();
  const taskEntries = runs.flatMap((run) => (run.tasks ?? []).map((task) => ({ run, task })));
  const pipelineRuns = runs.filter((run) => run.pipelineRollup);
  const validations = taskEntries.filter(({ task }) => normalizedStatus(task.validation?.status));
  const evaluatedTasks = taskEntries.filter(({ task }) => normalizedStatus(task.status));
  const failedTasks = taskEntries.filter(({ task }) => FAIL_STATUSES.has(normalizedStatus(task.status)));
  const openTasks = taskEntries.filter(({ task }) => OPEN_STATUSES.has(normalizedStatus(task.status)));
  const failedValidations = validations.filter(({ task }) => FAIL_STATUSES.has(normalizedStatus(task.validation?.status)));
  const pendingApprovals = state?.pendingApprovals ?? [];
  const gateHistory = state?.blockedGates ?? [];
  const resolvedGates = new Set(gateHistory.filter((gate) => gateIsResolved(state, gate)));
  const resolvedGateIds = new Set([...resolvedGates].map((gate) => gate.id).filter(Boolean));
  const blockedGates = gateHistory.filter((gate) => !resolvedGates.has(gate));
  const alerts = (state?.alerts ?? []).filter((alert) => !(
    alert.type === 'approval_gate_blocked'
    && String(alert.id ?? '').startsWith('blocked-')
    && resolvedGateIds.has(String(alert.id).slice('blocked-'.length))
  ));
  const criticalAlerts = alerts.filter((alert) => ['critical', 'danger', 'error'].includes(String(alert.level ?? '').toLowerCase()));
  const integrityIssues = runs.flatMap((run) => (run.integrity ?? []).map((issue) => ({ run, issue })));
  const failedPipelines = pipelineRuns.filter((run) => {
    const rollup = run.pipelineRollup;
    return FAIL_STATUSES.has(normalizedStatus(rollup.status))
      || Number(rollup.stages_failed ?? 0) > 0
      || Number(rollup.approval_blockers ?? 0) > 0
      || ['failed', 'guardrail_blocked'].includes(rollup.next_action?.kind);
  });
  const incompletePipelines = pipelineRuns.filter((run) => {
    const rollup = run.pipelineRollup;
    return !PASS_STATUSES.has(normalizedStatus(rollup.status)) || rollup.stale === true;
  });

  const expectedSignals = runs.length + taskEntries.length + taskEntries.length + runs.length;
  const evaluatedSignals = runs.length + evaluatedTasks.length + validations.length + pipelineRuns.length;
  const coverage = {
    runs: { evaluated: runs.length, total: runs.length },
    tasks: { evaluated: evaluatedTasks.length, total: taskEntries.length },
    validations: { evaluated: validations.length, total: taskEntries.length },
    pipelineStates: { evaluated: pipelineRuns.length, total: runs.length },
    percent: expectedSignals ? Math.round((evaluatedSignals / expectedSignals) * 100) : null,
    complete: runs.length > 0
      && taskEntries.length > 0
      && evaluatedTasks.length === taskEntries.length
      && validations.length === taskEntries.length
      && pipelineRuns.length === runs.length,
  };

  const hasRuns = runs.length > 0;
  const hasTasks = taskEntries.length > 0;
  const taskSources = taskEntries.map((entry) => taskSource(entry));
  const validationSources = taskEntries.map((entry) => taskSource(
    entry,
    'validation.json',
    'validation',
    Boolean(normalizedStatus(entry.task.validation?.status)),
  ));
  const pipelineSources = runs.map((run) => runSource(run, 'pipeline-state.json', 'pipeline', Boolean(run.pipelineRollup)));
  const approvalSources = runs.map((run) => runSource(run, 'approvals.json', 'approvals'));
  const alertSources = alerts.flatMap((alert) => {
    const run = runs.find((candidate) => candidate.runId === alert.runId);
    return run ? [runSource(run, 'events.jsonl', 'alerts')] : [];
  });

  const checks = [
    check('scope', 'Run data available', !hasRuns ? 'unknown' : !hasTasks ? 'warning' : 'pass',
      !hasRuns ? 'No runs in scope.' : !hasTasks ? 'Runs exist, but no tasks are available to evaluate.' : `${runs.length} run${runs.length === 1 ? '' : 's'} and ${taskEntries.length} task${taskEntries.length === 1 ? '' : 's'} are in scope.`, taskSources),
    check('tasks', 'Task outcomes', !hasRuns || !hasTasks ? 'unknown' : failedTasks.length ? 'fail' : openTasks.length ? 'warning' : 'pass',
      !hasTasks ? 'Task outcomes have not been recorded.' : failedTasks.length ? `${failedTasks.length} task${failedTasks.length === 1 ? '' : 's'} failed or are guardrail-blocked.` : openTasks.length ? `${openTasks.length} task${openTasks.length === 1 ? '' : 's'} are still open.` : 'All recorded tasks passed.', taskSources),
    check('approvals', 'Approval gates', !hasRuns ? 'unknown' : blockedGates.length || pendingApprovals.length ? 'fail' : 'pass',
      !hasRuns ? 'Approval state has no run scope.' : blockedGates.length || pendingApprovals.length ? `${blockedGates.length} blocked gate${blockedGates.length === 1 ? '' : 's'} and ${pendingApprovals.length} pending approval${pendingApprovals.length === 1 ? '' : 's'}.` : 'No unresolved approval gates.', approvalSources),
    check('validation', 'Validation proof', !hasTasks ? 'unknown' : failedValidations.length ? 'fail' : validations.length === 0 ? 'unknown' : validations.length < taskEntries.length ? 'warning' : 'pass',
      !hasTasks ? 'There are no tasks to validate.' : failedValidations.length ? `${failedValidations.length} validation result${failedValidations.length === 1 ? '' : 's'} failed.` : validations.length === 0 ? 'No validation results are available.' : validations.length < taskEntries.length ? `${validations.length}/${taskEntries.length} tasks have validation results.` : `Validation results exist for all ${taskEntries.length} tasks.`, validationSources),
    check('pipeline', 'Pipeline state', !hasRuns ? 'unknown' : failedPipelines.length ? 'fail' : pipelineRuns.length === 0 ? 'unknown' : pipelineRuns.length < runs.length || incompletePipelines.length ? 'warning' : 'pass',
      !hasRuns ? 'There are no runs to evaluate.' : failedPipelines.length ? `${failedPipelines.length} pipeline${failedPipelines.length === 1 ? '' : 's'} are blocked or failed.` : pipelineRuns.length === 0 ? 'No pipeline-state.json data is available.' : pipelineRuns.length < runs.length ? `${pipelineRuns.length}/${runs.length} runs have pipeline state.` : incompletePipelines.length ? `${incompletePipelines.length} pipeline${incompletePipelines.length === 1 ? '' : 's'} are incomplete or stale.` : 'All pipeline states are complete and current.', pipelineSources),
    check('alerts', 'Operational alerts', !hasRuns ? 'unknown' : criticalAlerts.length ? 'fail' : alerts.length ? 'warning' : 'pass',
      !hasRuns ? 'Alerts have no run scope.' : criticalAlerts.length ? `${criticalAlerts.length} critical alert${criticalAlerts.length === 1 ? '' : 's'} require action.` : alerts.length ? `${alerts.length} active alert${alerts.length === 1 ? '' : 's'} need review.` : 'No active operational alerts.', alertSources),
    check('integrity', 'Source integrity', !hasRuns ? 'unknown' : integrityIssues.length ? 'fail' : 'pass',
      !hasRuns ? 'Source integrity has not been evaluated.' : integrityIssues.length ? `${integrityIssues.length} source file${integrityIssues.length === 1 ? '' : 's'} could not be parsed.` : 'No run-file integrity errors detected.', integrityIssues.map(({ run, issue }) => ({
        kind: 'integrity',
        path: issue.path ?? `.rstack/runs/${run.runId}`,
        runId: run.runId,
        projectRoot: run.projectRoot ?? null,
      }))),
  ];

  const blockers = [
    ...failedTasks.map((entry) => ({
      id: `task:${entry.run.runId}:${entry.task.id}`,
      type: 'failed_task',
      label: entry.task.status === 'BLOCKED' ? 'Guardrail-blocked task' : 'Failed task',
      detail: entry.task.title ?? entry.task.id,
      runId: entry.run.runId,
      projectRoot: entry.run.projectRoot ?? null,
      sourceRef: taskSource(entry),
    })),
    ...failedValidations.map((entry) => ({
      id: `validation:${entry.run.runId}:${entry.task.id}`,
      type: 'validation',
      label: 'Failed validation',
      detail: entry.task.title ?? entry.task.id,
      runId: entry.run.runId,
      projectRoot: entry.run.projectRoot ?? null,
      sourceRef: taskSource(entry, 'validation.json', 'validation'),
    })),
    ...failedPipelines.map((run) => ({
      id: `pipeline:${run.runId}`,
      type: 'pipeline',
      label: 'Pipeline blocked',
      detail: run.pipelineRollup?.next_action?.text ?? 'Pipeline state reports a failure.',
      runId: run.runId,
      projectRoot: run.projectRoot ?? null,
      sourceRef: runSource(run, 'pipeline-state.json', 'pipeline'),
    })),
    ...blockedGates.map((gate) => ({
      id: `gate:${gate.id ?? gate.runId ?? 'blocked'}`,
      type: 'approval',
      label: 'Approval gate blocked',
      detail: gate.detail ?? gate.title ?? 'A governed approval is required.',
      runId: gate.runId ?? null,
      projectRoot: gate.projectRoot ?? null,
      sourceRef: {
        kind: 'approval_gate',
        path: gate.runId ? `.rstack/runs/${gate.runId}/events.jsonl` : '.rstack/approvals.json',
        runId: gate.runId ?? null,
        projectRoot: gate.projectRoot ?? null,
      },
    })),
    ...pendingApprovals.map((approval) => ({
      id: `approval:${approval.id ?? approval.artifact ?? 'pending'}`,
      type: 'approval',
      label: 'Approval required',
      detail: approval.title ?? approval.artifact ?? 'A manager decision is pending.',
      runId: approval.runId ?? null,
      projectRoot: approval.projectRoot ?? null,
      sourceRef: {
        kind: 'approvals',
        path: approval.runId ? `.rstack/runs/${approval.runId}/approvals.json` : '.rstack/approvals.json',
        runId: approval.runId ?? null,
        projectRoot: approval.projectRoot ?? null,
      },
    })),
    ...criticalAlerts.map((alert, index) => {
      const run = runs.find((candidate) => candidate.runId === alert.runId);
      return {
        id: `alert:${alert.id ?? index}`,
        type: 'alert',
        label: alert.title ?? 'Critical operational alert',
        detail: alert.detail ?? 'A critical alert requires action.',
        runId: alert.runId ?? null,
        projectRoot: run?.projectRoot ?? null,
        sourceRef: run ? runSource(run, 'events.jsonl', 'alerts') : { kind: 'alerts', path: '.rstack alert evaluation', runId: null, projectRoot: null },
      };
    }),
    ...integrityIssues.map(({ run, issue }, index) => ({
      id: `integrity:${run.runId}:${index}`,
      type: 'integrity',
      label: 'Unreadable readiness source',
      detail: issue.error ?? issue.message ?? issue.path ?? 'A run source could not be parsed.',
      runId: run.runId,
      projectRoot: run.projectRoot ?? null,
      sourceRef: { kind: 'integrity', path: issue.path ?? `.rstack/runs/${run.runId}`, runId: run.runId, projectRoot: run.projectRoot ?? null },
    })),
  ];

  const observedProof = validations.length > 0 || pipelineRuns.length > 0;
  const hasConcerns = checks.some((item) => item.status === 'warning' || item.status === 'unknown');
  const status = blockers.length ? 'blocked'
    : !hasRuns || !hasTasks || !observedProof ? 'unknown'
    : !coverage.complete || hasConcerns ? 'at_risk'
    : 'ready';

  const summary = status === 'blocked'
    ? `Release is blocked by ${blockers.length} source-backed condition${blockers.length === 1 ? '' : 's'}.`
    : status === 'ready'
      ? `Ready to ship — ${taskEntries.length} task${taskEntries.length === 1 ? '' : 's'} have complete, current proof.`
      : status === 'at_risk'
        ? `Readiness is at risk — proof coverage is ${coverage.percent}% and incomplete or cautionary signals remain.`
        : !hasRuns
          ? 'Release readiness not evaluated — no runs are available in this scope.'
          : 'Release readiness is unknown because task, validation, or pipeline proof has not been evaluated.';

  const sources = uniqueSources([
    ...taskSources,
    ...validationSources,
    ...pipelineSources,
    ...approvalSources,
    ...alertSources,
  ]);

  const result = {
    status,
    summary,
    coverage,
    checks,
    blockers,
    sources,
    evaluatedAt,
  };

  if (!options.skipScopes) {
    const projectRoots = [...new Set(runs.map((run) => run.projectRoot).filter(Boolean))];
    const runIds = [...new Set(runs.map((run) => run.runId).filter(Boolean))];
    result.scopes = {
      projects: projectRoots.map((projectRoot) => ({
        projectRoot,
        ...buildReadinessProjection(scopedState(state, runs.filter((run) => run.projectRoot === projectRoot)), {
          evaluatedAt,
          skipScopes: true,
        }),
      })),
      // The current selector keys by runId. If two roots reuse the same ID,
      // evaluate the group conservatively instead of silently choosing one;
      // #276 will give the selector a canonical composite identity.
      runs: runIds.map((runId) => {
        const scopedRuns = runs.filter((run) => run.runId === runId);
        return {
          runId,
          projectRoots: [...new Set(scopedRuns.map((run) => run.projectRoot).filter(Boolean))],
          ...buildReadinessProjection(scopedState(state, scopedRuns), {
            evaluatedAt,
            skipScopes: true,
          }),
        };
      }),
    };
  }

  return result;
}
