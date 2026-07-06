import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { CANONICAL_SDLC_STAGES } from './stages.js';
import { verifyStageCheckpoint } from './checkpoints.js';
import { runDirectory } from './runs.js';
import { withFileLock, writeJsonAtomic } from './safe-write.js';

// owner: RStack developed by Richardson Gunde

const STATE_FILE = 'pipeline-state.json';
const RUNNING_STATUSES = new Set(['RUNNING', 'IN_PROGRESS', 'STARTED']);
const PASSED_STATUSES = new Set(['PASS', 'PASSED', 'SUCCESS', 'SUCCEEDED', 'DONE', 'COMPLETED']);
const FAILED_STATUSES = new Set(['FAIL', 'FAILED', 'ERROR', 'BLOCKED']);
const BLOCKING_APPROVAL_STATUSES = new Set(['PENDING', 'REQUIRED', 'REQUESTED', 'BLOCKED', 'NEEDS_APPROVAL']);

// Anchor to the shared resolver so run selection (resolveRunId) and rollup
// reads/writes always agree when RSTACK_STATE_DIR overrides the default
// <projectRoot>/.rstack location.
function runDir(projectRoot, runId) {
  return runDirectory(projectRoot, runId);
}

function statePath(projectRoot, runId) {
  return path.join(runDir(projectRoot, runId), STATE_FILE);
}

function toPosix(value) {
  return value.split(path.sep).join('/');
}

async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function readJsonIfPresent(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback;
    if (error instanceof SyntaxError) return fallback;
    throw error;
  }
}

async function readJsonlIfPresent(filePath) {
  let raw;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }

  return raw
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

async function listStageEvidencePaths(runDirPath, stage) {
  const stageDir = path.join(runDirPath, 'artifacts', 'stages', stage.id);
  let entries;
  try {
    entries = await readdir(stageDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }

  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => toPosix(path.join('.rstack', 'runs', path.basename(runDirPath), 'artifacts', 'stages', stage.id, entry.name)))
    .sort();
}

function normalizeTasks(rawTasks) {
  if (Array.isArray(rawTasks)) return rawTasks;
  if (Array.isArray(rawTasks?.tasks)) return rawTasks.tasks;
  return [];
}

function normalizeApprovals(rawApprovals) {
  if (Array.isArray(rawApprovals)) return rawApprovals;
  if (Array.isArray(rawApprovals?.approvals)) return rawApprovals.approvals;
  return [];
}

// Exported: the goal-loop stage reset (goal-loop.js) must derive stage ids
// for tasks exactly the way the rollup does, so the two can never disagree.
export function taskStageIds(task) {
  const ids = new Set();
  for (const artifact of task.stage_artifacts || []) {
    if (artifact?.stage_id) ids.add(artifact.stage_id);
  }
  for (const agent of task.pipeline_agents || []) {
    const stage = CANONICAL_SDLC_STAGES.find((candidate) => candidate.agent === agent);
    if (stage) ids.add(stage.id);
  }
  if (task.stage_id) ids.add(task.stage_id);
  return [...ids];
}

function normalizeStatus(status, fallback = 'PENDING') {
  if (!status) return fallback;
  return String(status).toUpperCase();
}

function deriveStageStatus({ stageId, metrics, events, stageTasks }) {
  const metricStatus = metrics.stage_status?.[stageId];
  if (metricStatus) return normalizeStatus(metricStatus);

  const statuses = stageTasks.map((task) => normalizeStatus(task.status, null)).filter(Boolean);
  if (statuses.some((status) => FAILED_STATUSES.has(status))) return 'FAILED';
  if (statuses.some((status) => RUNNING_STATUSES.has(status))) return 'RUNNING';
  if (statuses.length > 0 && statuses.every((status) => PASSED_STATUSES.has(status))) return 'PASS';

  if (events.some((event) => event.stage_id === stageId && FAILED_STATUSES.has(normalizeStatus(event.status, null)))) return 'FAILED';
  if (events.some((event) => event.stage_id === stageId && String(event.type || '').includes('started'))) return 'RUNNING';
  if (events.some((event) => event.stage_id === stageId && String(event.type || '').includes('completed'))) return 'PASS';

  return 'PENDING';
}

function deriveValidationStatus(stageId, evidenceEvents) {
  const stageEvidence = evidenceEvents.filter((event) => event.stage_id === stageId || event.stage === stageId);
  if (stageEvidence.some((event) => FAILED_STATUSES.has(normalizeStatus(event.status, null)))) return 'FAIL';
  if (stageEvidence.some((event) => PASSED_STATUSES.has(normalizeStatus(event.status, null)))) return 'PASS';
  return 'UNKNOWN';
}

function eventType(event) {
  return String(event.type || event.kind || event.event || '');
}

function isRetryEvent(event) {
  // Matches legacy retry_* names plus the BLE-3 emitter contract
  // (retry_decision, task_retry_scheduled, task_retry_exhausted).
  // task_human_context_required has no "retry" in its name but is part of
  // the retry loop, so it is included explicitly. Goal-loop events
  // (loop_iteration_retrying_stages, ...) have their own rollup and must not
  // inflate the task-retry counts.
  const type = eventType(event);
  if (type.startsWith('loop_')) return false;
  return /retry/i.test(type) || type === 'task_human_context_required';
}

function isGuardrailEvent(event) {
  return /guardrail|approval.*block|blocked/i.test(String(event.type || event.kind || event.event || ''));
}

function eventStageId(event) {
  return event.stage_id || event.stage || null;
}

function isStageStartedEvent(event) {
  return eventStageId(event) && /stage_started|started/i.test(String(event.type || event.kind || event.event || ''));
}

function deriveAttempts(stageId, events) {
  const started = events.filter((event) => event.stage_id === stageId && /started|attempt/i.test(String(event.type || ''))).length;
  const retries = events.filter((event) => event.stage_id === stageId && isRetryEvent(event)).length;
  return Math.max(started, retries + (started || retries ? 1 : 0), 0);
}

function findCurrentTask(tasks) {
  return tasks.find((task) => RUNNING_STATUSES.has(normalizeStatus(task.status, null))) || null;
}

function findCurrentStage({ tasks, stages, metrics, events }) {
  const currentTask = findCurrentTask(tasks);
  if (currentTask) {
    const [stageId] = taskStageIds(currentTask);
    if (stageId) return { stage_id: stageId, task_id: currentTask.id || null };
  }

  const runningMetricStage = stages.find((stage) => RUNNING_STATUSES.has(normalizeStatus(metrics.stage_status?.[stage.id], null)));
  if (runningMetricStage) return { stage_id: runningMetricStage.id, task_id: null };

  const lastRunningEvent = [...events].reverse().find((event) => (
    eventStageId(event)
    && (RUNNING_STATUSES.has(normalizeStatus(event.status, null)) || isStageStartedEvent(event))
  ));
  if (lastRunningEvent) return { stage_id: eventStageId(lastRunningEvent), task_id: lastRunningEvent.task_id || null };

  return { stage_id: null, task_id: null };
}

function buildRunMetadata(manifest, runId) {
  return {
    run_id: manifest.run_id || runId,
    goal: manifest.goal || manifest.request || null,
    status: normalizeStatus(manifest.status, 'UNKNOWN'),
    profile: manifest.profile || null,
    created_at: manifest.created_at || manifest.started_at || null,
    updated_at: manifest.updated_at || null,
  };
}

function buildPipelineStatus(manifest, stages) {
  const status = normalizeStatus(manifest.status, null)
    || (stages.some((stage) => stage.status === 'RUNNING') ? 'RUNNING' : 'UNKNOWN');
  return {
    status,
    stages_total: stages.length,
    stages_passed: stages.filter((stage) => PASSED_STATUSES.has(stage.status)).length,
    stages_failed: stages.filter((stage) => FAILED_STATUSES.has(stage.status)).length,
  };
}

function buildCostContext(metrics) {
  return {
    cumulative_duration_ms: metrics.cumulative_duration_ms ?? 0,
    cumulative_cost_usd: metrics.cumulative_cost_usd ?? 0,
    cumulative_tool_calls: metrics.cumulative_tool_calls ?? 0,
    context_tokens_used: metrics.context_tokens_used ?? null,
    context_tokens_available: metrics.context_tokens_available ?? null,
  };
}

function approvalStageId(approval) {
  return approval.stage_id || approval.stage || null;
}

function buildApprovalBlockers(approvals) {
  return approvals
    .filter((approval) => BLOCKING_APPROVAL_STATUSES.has(normalizeStatus(approval.status, null)))
    .map((approval) => ({
      artifact: approval.artifact || approval.path || approval.name || null,
      stage_id: approvalStageId(approval),
      status: normalizeStatus(approval.status),
    }));
}

// A stage is 'retryable' while its most recent scheduled/exhausted retry
// event says another attempt is coming, 'exhausted' once the retry budget is
// spent (the task sits BLOCKED pending a guardrail-override), and null when
// no retry loop has touched the stage's tasks.
function deriveStageRetryState(stageId, stageTaskIds, events) {
  const taskIds = new Set(stageTaskIds);
  let latest = null;
  for (const event of events) {
    const type = eventType(event);
    if (type !== 'task_retry_scheduled' && type !== 'task_retry_exhausted') continue;
    if (eventStageId(event) !== stageId && !taskIds.has(event.task_id)) continue;
    latest = type;
  }
  if (latest === 'task_retry_scheduled') return 'retryable';
  if (latest === 'task_retry_exhausted') return 'exhausted';
  return null;
}

function summarizeRetryEvents(events) {
  const summary = summarizeEvents(events, isRetryEvent);
  const counts = { scheduled: 0, exhausted: 0, human_required: 0 };
  for (const event of events) {
    const type = eventType(event);
    if (type === 'task_retry_scheduled') counts.scheduled += 1;
    else if (type === 'task_retry_exhausted') counts.exhausted += 1;
    else if (type === 'task_human_context_required') counts.human_required += 1;
  }
  return { total: summary.total, ...counts, events: summary.events };
}

// Goal-loop rollup (#129): surfaces the bounded loop's progress — iteration
// count, the latest goal evaluation, and how the loop ended — so
// `pipeline status` answers "where is the loop?" without reading events.jsonl.
function summarizeGoalLoopEvents(events) {
  let total = 0;
  let iterations = 0;
  let lastEvaluation = null;
  let stoppedOn = null;
  for (const event of events) {
    const type = eventType(event);
    if (!type.startsWith('loop_') && type !== 'goal_evaluated') continue;
    total += 1;
    if (type === 'loop_iteration_started') {
      // Scope the counter to the most recent loop invocation: every
      // invocation restarts at iteration 1, so a non-increasing iteration
      // number marks a fresh loop — a historical max across old runs would
      // report "iteration 3" for a loop that just started at 1.
      const iteration = Number(event.iteration) || 0;
      iterations = iteration <= 1 ? iteration : Math.max(iterations, iteration);
      stoppedOn = null; // a new iteration supersedes an earlier terminal event
    } else if (type === 'goal_evaluated') {
      lastEvaluation = {
        goal_id: event.goal_id ?? null,
        status: event.status ?? null,
        score: event.score ?? null,
        reason: event.reason ?? null,
      };
    } else if (type === 'loop_completed') {
      stoppedOn = 'complete';
    } else if (type === 'loop_blocked') {
      stoppedOn = event.stopped_on ?? 'blocked';
    }
  }
  return { total, iterations, last_evaluation: lastEvaluation, stopped_on: stoppedOn };
}

// Checkpoint rollup (#132, BLE-5.2): counts the pinned checkpoint events
// (stage_checkpoint_before_saved / stage_checkpoint_after_saved /
// stage_checkpoint_reverted) so `pipeline status` answers "which critical
// stages have restore points?" without reading events.jsonl. Restorability
// itself is NEVER derived from these events — each stage's
// checkpoint_restorable flag is verified against the checkpoint directory
// on disk at rollup time.
function summarizeCheckpointEvents(events) {
  const counts = { before_saved: 0, after_saved: 0, reverted: 0 };
  for (const event of events) {
    const type = eventType(event);
    if (type === 'stage_checkpoint_before_saved') counts.before_saved += 1;
    else if (type === 'stage_checkpoint_after_saved') counts.after_saved += 1;
    else if (type === 'stage_checkpoint_reverted') counts.reverted += 1;
  }
  return { total: counts.before_saved + counts.after_saved + counts.reverted, ...counts };
}

function summarizeEvents(events, predicate) {
  const items = events.filter(predicate).map((event) => ({
    ts: event.ts || event.timestamp || null,
    stage_id: event.stage_id || null,
    task_id: event.task_id || null,
    type: event.type || event.kind || event.event || null,
    reason: event.reason || event.message || null,
  }));
  return { total: items.length, events: items };
}

export async function buildPipelineState(projectRoot, runId, { generatedAt = new Date().toISOString() } = {}) {
  const dir = runDir(projectRoot, runId);
  const manifest = await readJsonIfPresent(path.join(dir, 'manifest.json'), { run_id: runId, status: 'UNKNOWN' });
  const tasks = normalizeTasks(await readJsonIfPresent(path.join(dir, 'tasks.json'), { tasks: [] }));
  const metrics = await readJsonIfPresent(path.join(dir, 'metrics.json'), {});
  const approvals = normalizeApprovals(await readJsonIfPresent(path.join(dir, 'approvals.json'), []));
  const events = await readJsonlIfPresent(path.join(dir, 'events.jsonl'));
  const evidenceEvents = await readJsonlIfPresent(path.join(dir, 'evidence.jsonl'));

  const stages = [];
  for (const stage of CANONICAL_SDLC_STAGES) {
    const stageTasks = tasks.filter((task) => taskStageIds(task).includes(stage.id));
    const artifactPaths = await listStageEvidencePaths(dir, stage);
    const evidencePaths = evidenceEvents
      .filter((event) => eventStageId(event) === stage.id)
      .map((event) => `evidence.jsonl#${event.task_id || stage.id}`);

    const stageTaskIds = stageTasks.map((task) => task.id).filter(Boolean);
    stages.push({
      id: stage.id,
      title: stage.title,
      agent: stage.agent,
      artifact: stage.artifact,
      status: deriveStageStatus({ stageId: stage.id, metrics, events, stageTasks }),
      attempts: deriveAttempts(stage.id, events),
      retry_state: deriveStageRetryState(stage.id, stageTaskIds, events),
      task_ids: stageTaskIds,
      validation_status: deriveValidationStatus(stage.id, evidenceEvents),
      elapsed_ms: metrics.stage_elapsed_ms?.[stage.id] ?? null,
      evidence_paths: [...new Set([...artifactPaths, ...evidencePaths])],
      // Verified on disk, never inferred from events: true only when the
      // checkpoint directory actually exists right now (#132).
      checkpoint_restorable: verifyStageCheckpoint(dir, stage.id).restorable,
    });
  }

  const current = findCurrentStage({ tasks, stages: CANONICAL_SDLC_STAGES, metrics, events });
  const pipeline = buildPipelineStatus(manifest, stages);

  return {
    schema_version: 1,
    generated_at: generatedAt,
    run: buildRunMetadata(manifest, runId),
    pipeline,
    current,
    stages,
    retries: summarizeRetryEvents(events),
    goal_loop: summarizeGoalLoopEvents(events),
    checkpoints: summarizeCheckpointEvents(events),
    guardrails: summarizeEvents(events, isGuardrailEvent),
    approval_blockers: buildApprovalBlockers(approvals),
    cost_context: buildCostContext(metrics),
  };
}

export async function writePipelineState(projectRoot, runId, options = {}) {
  const filePath = statePath(projectRoot, runId);
  return withFileLock(filePath, async () => {
    const state = await buildPipelineState(projectRoot, runId, options);
    await writeJsonAtomic(filePath, state);
    return { state, statePath: filePath };
  });
}

export async function readPipelineState(projectRoot, runId, { regenerateIfMissing = false, ...options } = {}) {
  const filePath = statePath(projectRoot, runId);
  if (await pathExists(filePath)) return readJsonIfPresent(filePath, null);
  if (regenerateIfMissing) {
    const { state } = await writePipelineState(projectRoot, runId, options);
    return state;
  }
  return null;
}

export function summarizePipelineState(state) {
  return {
    run_id: state.run.run_id,
    status: state.pipeline.status,
    current_stage_id: state.current.stage_id,
    current_task_id: state.current.task_id,
    stages_total: state.pipeline.stages_total,
    stages_passed: state.pipeline.stages_passed,
    stages_failed: state.pipeline.stages_failed,
    approval_blockers: state.approval_blockers.length,
    retries: state.retries.total,
    guardrails: state.guardrails.total,
  };
}
