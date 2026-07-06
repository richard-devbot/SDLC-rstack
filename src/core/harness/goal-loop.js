// owner: RStack developed by Richardson Gunde
//
// Bounded goal-loop engine (#129, BLE-4.3): the harness-side policy for
// "keep working until the goal passes" — without ever running unbounded.
// Three independent brakes, all enforced here in code:
//   1. Iteration bound  — default 3, hard cap 20 (clamped, never exceeded).
//   2. No-progress stop — an iteration that changes nothing ends the loop.
//   3. Budget cap       — .rstack/budget.json run_budget_usd vs metrics.json.
// Every loop decision emits a pinned event (loop_iteration_started,
// goal_evaluated, loop_iteration_retrying_stages, loop_completed,
// loop_blocked) so trace/status/feed render the loop without reading source.

import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { GOAL_STATUSES } from './goal-check.js';
import { taskStageIds } from './pipeline-state.js';
import { runDirectory, rstackStateDir } from './runs.js';
import { updateRunMetrics } from './run-state.js';
import { withFileLock, writeJsonAtomic } from './safe-write.js';

export const LOOP_HARD_CAP = 20;

export const DEFAULT_LOOP_BOUNDS = Object.freeze({
  maxIterations: 3,
  maxStepsPerIteration: 10,
});

export const LOOP_EVENT_TYPES = Object.freeze([
  'loop_iteration_started',
  'goal_evaluated',
  'loop_iteration_retrying_stages',
  'loop_completed',
  'loop_blocked',
]);

const PASSED_TASK_STATUSES = new Set(['PASS', 'PASSED', 'SUCCESS', 'SUCCEEDED', 'DONE', 'COMPLETED']);
const RESETTABLE_TASK_STATUSES = new Set([...PASSED_TASK_STATUSES, 'FAIL', 'FAILED', 'ERROR']);

// Pipeline-runner stops that mean a human (or an external agent) must act
// before another loop pass can achieve anything. The loop propagates them.
export const HUMAN_GATE_STOPS = Object.freeze([
  'pending_approval',
  'ask_user',
  'blocked_retry_policy',
  'missing_contract',
]);

// ── Bounds resolution (same pattern as guardrails.resolveGuardrails) ────────

export function resolveLoopBounds(overrides = {}) {
  const merged = { ...DEFAULT_LOOP_BOUNDS };
  for (const [key, value] of Object.entries(overrides || {})) {
    if (!(key in DEFAULT_LOOP_BOUNDS)) continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 1) merged[key] = Math.floor(parsed);
  }
  // The hard cap is not overridable — a config typo must never yield an
  // effectively unbounded loop.
  merged.maxIterations = Math.min(merged.maxIterations, LOOP_HARD_CAP);
  return merged;
}

export async function loadProjectLoopBounds(projectRoot) {
  const configPath = join(rstackStateDir(projectRoot), 'rstack.config.json');
  if (!existsSync(configPath)) return resolveLoopBounds();
  try {
    const parsed = JSON.parse(await readFile(configPath, 'utf8'));
    return resolveLoopBounds(parsed?.loop || {});
  } catch (error) {
    if (error instanceof SyntaxError) {
      console.error(`[rstack] Ignoring malformed ${configPath}: ${error.message}. Default loop bounds apply.`);
      return resolveLoopBounds();
    }
    throw error;
  }
}

// ── Budget cap ───────────────────────────────────────────────────────────────
//
// The loop respects the same budget config the cost guardrails use:
// .rstack/budget.json run_budget_usd against the run's cumulative_cost_usd.
// No budget configured = no cost brake (iteration bound still applies).

export async function evaluateLoopBudget(projectRoot, runId) {
  const budgetPath = join(rstackStateDir(projectRoot), 'budget.json');
  let budget = null;
  try {
    budget = JSON.parse(await readFile(budgetPath, 'utf8'));
  } catch {
    budget = null;
  }
  const limit = Number(budget?.run_budget_usd);
  if (!Number.isFinite(limit) || limit < 0) return { ok: true, limit: null, spent: null };

  let metrics = null;
  try {
    metrics = JSON.parse(await readFile(join(runDirectory(projectRoot, runId), 'metrics.json'), 'utf8'));
  } catch {
    metrics = null;
  }
  const spent = Number(metrics?.cumulative_cost_usd) || 0;
  if (spent >= limit) {
    return {
      ok: false,
      limit,
      spent,
      reason: `run budget exhausted — $${spent.toFixed(2)} spent of the $${limit.toFixed(2)} run_budget_usd cap in .rstack/budget.json`,
    };
  }
  return { ok: true, limit, spent };
}

// ── Progress fingerprint ─────────────────────────────────────────────────────
//
// If an iteration leaves the fingerprint unchanged — same task statuses, same
// goal verdict, same failing stages, same criteria outcomes — the next pass
// would repeat it exactly, so the loop stops and says why instead of burning
// budget. Event counts are deliberately excluded (loop events always grow).

export function computeProgressFingerprint({ tasks = [], evaluation = null } = {}) {
  const taskPart = tasks
    .map((task) => `${task?.id ?? '?'}=${String(task?.status ?? '').toUpperCase()}`)
    .sort()
    .join(',');
  const evalPart = evaluation
    ? [
      evaluation.status,
      evaluation.score,
      (evaluation.failing_stages ?? []).join('+'),
      (evaluation.recommended_rerun_stages ?? []).join('+'),
      (evaluation.criteria ?? []).map((criterion) => `${criterion.id}:${criterion.status}`).join('+'),
    ].join('|')
    : '';
  return `${taskPart}#${evalPart}`;
}

// ── Loop decision (pure — dry-run and the live loop share it) ───────────────

export function planLoopDecision({
  evaluation,
  iteration,
  maxIterations,
  pipelineStoppedOn = null,
  budget = { ok: true },
  progressFingerprint = null,
  previousFingerprint = null,
} = {}) {
  if (budget && budget.ok === false) {
    return { action: 'stop', stopped_on: 'budget_exhausted', detail: budget.reason ?? 'run budget exhausted.' };
  }
  if (pipelineStoppedOn && HUMAN_GATE_STOPS.includes(pipelineStoppedOn)) {
    return {
      action: 'stop',
      stopped_on: pipelineStoppedOn,
      detail: `Pipeline pass stopped on a human gate (${pipelineStoppedOn}) — the loop cannot resolve it; resolve and run again.`,
    };
  }
  const status = GOAL_STATUSES.includes(evaluation?.status) ? evaluation.status : null;
  if (status === 'PASS') {
    return { action: 'stop', stopped_on: 'complete', detail: `Goal met — ${evaluation.reason ?? 'all checks passing.'}` };
  }
  if (status === 'ASK_USER') {
    return { action: 'stop', stopped_on: 'ask_user', detail: evaluation.reason ?? 'A human decision is required.' };
  }
  if (status === 'BLOCK') {
    return { action: 'stop', stopped_on: 'blocked', detail: evaluation.reason ?? 'A blocking issue requires human intervention.' };
  }
  if (status !== 'RETRY') {
    return { action: 'stop', stopped_on: 'evaluation_error', detail: 'Goal evaluation returned no usable status — inspect the run manually.' };
  }
  // RETRY — bounded by iterations, progress, and something to actually rerun.
  if (iteration >= maxIterations) {
    return {
      action: 'stop',
      stopped_on: 'max_iterations',
      detail: `Goal still unmet after ${iteration} of ${maxIterations} iteration(s) — the loop never runs past its bound; raise --max-iterations (hard cap ${LOOP_HARD_CAP}) or intervene.`,
    };
  }
  // Continue without resetting when the pipeline simply ran out of per-pass
  // steps mid-work — there is nothing to rerun yet, just more of the same.
  if (pipelineStoppedOn === 'max_steps') {
    return { action: 'continue', detail: 'Pipeline pass hit --max-steps with work remaining — continuing without resetting stages.' };
  }
  if (previousFingerprint != null && progressFingerprint != null && previousFingerprint === progressFingerprint) {
    return {
      action: 'stop',
      stopped_on: 'no_progress',
      detail: 'Iteration produced no state change and no new evidence (identical task statuses and goal evaluation) — stopping instead of repeating it.',
    };
  }
  const stages = (evaluation.recommended_rerun_stages?.length
    ? evaluation.recommended_rerun_stages
    : evaluation.failing_stages) ?? [];
  if (!stages.length) {
    return {
      action: 'stop',
      stopped_on: 'no_progress',
      detail: 'Goal evaluation asks for a retry but names no stages to rerun — nothing would change; inspect the goal definition or the run.',
    };
  }
  return {
    action: 'retry_stages',
    stages: [...new Set(stages)],
    detail: `Rerun only the recommended stages: ${[...new Set(stages)].join(', ')}.`,
  };
}

// ── State mutations (live loop only — all atomic + in-lock) ──────────────────

export async function appendLoopEvent(runDir, event) {
  if (!LOOP_EVENT_TYPES.includes(event?.type)) {
    throw new Error(`Unknown loop event type: ${event?.type} — expected ${LOOP_EVENT_TYPES.join(' | ')}`);
  }
  const eventPath = join(runDir, 'events.jsonl');
  await mkdir(dirname(eventPath), { recursive: true });
  // Same lock discipline as the evidence ledger: parallel writers must never
  // interleave a line in the audit surface.
  await withFileLock(eventPath, async () => {
    await appendFile(eventPath, `${JSON.stringify({ ts: new Date().toISOString(), ...event })}\n`);
  });
  return eventPath;
}

// Reset the tasks of the selected stages back to PENDING so the runner's
// claim gate picks them up again. In-lock read-modify-write; the original
// tasks.json shape ({tasks:[...]} vs bare array) is preserved. Deliberately
// NOT reset: IN_PROGRESS (active work), NEEDS_CONTEXT (waiting on a human),
// and BLOCKED (waiting on a guardrail-override) — those are gates, and
// attempt budgets still count historical task_started events, so a reset can
// never launder attempts past the claim gate.
export async function resetStagesForRetry(projectRoot, runId, stageIds) {
  const stageSet = new Set(stageIds);
  const runDir = runDirectory(projectRoot, runId);
  const tasksPath = join(runDir, 'tasks.json');
  const resetTaskIds = [];
  const resetStageIds = new Set();

  await withFileLock(tasksPath, async () => {
    let raw;
    try {
      raw = JSON.parse(await readFile(tasksPath, 'utf8'));
    } catch {
      return;
    }
    const wrapped = !Array.isArray(raw) && Array.isArray(raw?.tasks);
    const tasks = Array.isArray(raw) ? raw : wrapped ? raw.tasks : [];
    for (const task of tasks) {
      const status = String(task?.status ?? '').toUpperCase();
      if (!RESETTABLE_TASK_STATUSES.has(status)) continue;
      const matched = taskStageIds(task).filter((stageId) => stageSet.has(stageId));
      if (!matched.length) continue;
      task.status = 'PENDING';
      resetTaskIds.push(task.id);
      for (const stageId of matched) resetStageIds.add(stageId);
    }
    await writeJsonAtomic(tasksPath, wrapped ? raw : tasks);
  });

  // Clear the stage-status overrides too, or the rollup would keep reporting
  // the stale PASS/FAIL from before the reset (updateRunMetrics is locked).
  // Only stages where a task was ACTUALLY reset — a selected stage whose only
  // tasks were gated (IN_PROGRESS/NEEDS_CONTEXT/BLOCKED) keeps its real
  // status, or the dashboard would report PENDING work that never restarted.
  if (resetStageIds.size) {
    await updateRunMetrics(runDir, {
      stage_status: Object.fromEntries([...resetStageIds].map((stageId) => [stageId, 'PENDING'])),
    });
  }
  return resetTaskIds;
}
