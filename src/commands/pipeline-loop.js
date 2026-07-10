// owner: RStack developed by Richardson Gunde
//
// Bounded goal-loop runner (#129, BLE-4.3): `rstack-agents pipeline loop`
// advances the run (one resume-aware pipeline pass per iteration), evaluates
// the goal (goal-check.js), and either stops (PASS / ASK_USER / BLOCK / any
// human gate / a spent bound) or resets only the recommended stages and goes
// again. Model-free like `pipeline run`: builder packets are executed by the
// host framework's agents; judge-kind goal criteria close through
// goal-verdict.json. `--dry-run` reports the first iteration's evaluation and
// decision and persists nothing — not even an event.

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { evaluateGoal, summarizeGoalDecision } from '../core/harness/goal-check.js';
import {
  LOOP_HARD_CAP,
  appendLoopEvent,
  computeProgressFingerprint,
  evaluateLoopBudget,
  loadProjectLoopBounds,
  planLoopDecision,
  resetStagesForRetry,
  resolveLoopBounds,
} from '../core/harness/goal-loop.js';
import { runDirectory, resolveRunId } from '../core/harness/runs.js';
import { runPipeline } from './pipeline-run.js';

async function readRunTasks(projectRoot, runId) {
  try {
    const raw = JSON.parse(await readFile(resolve(runDirectory(projectRoot, runId), 'tasks.json'), 'utf8'));
    if (Array.isArray(raw)) return raw;
    if (Array.isArray(raw?.tasks)) return raw.tasks;
  } catch {
    // tolerated — fingerprinting degrades to evaluation-only
  }
  return [];
}

// Load a goal definition from an explicit --goal <path>. Malformed files fail
// loudly — a silently-defaulted goal would make the loop chase the wrong
// success condition.
export async function loadGoalDefinition(goalPath) {
  let raw;
  try {
    raw = await readFile(goalPath, 'utf8');
  } catch (error) {
    throw new Error(`Cannot read goal definition ${goalPath}: ${error.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Goal definition ${goalPath} is not valid JSON: ${error.message}`);
  }
}

function compactEvaluation(evaluation) {
  return {
    goal_id: evaluation.goal_id,
    status: evaluation.status,
    score: evaluation.score,
    min_score: evaluation.min_score,
    critical_count: evaluation.critical_count,
    failing_stages: evaluation.failing_stages,
    recommended_rerun_stages: evaluation.recommended_rerun_stages,
    reason: evaluation.reason,
    criteria: evaluation.criteria,
  };
}

export async function runGoalLoop(projectRoot, {
  runId,
  goal = null,
  maxIterations,
  maxStepsPerIteration,
  dryRun = false,
  invokeTool,
  runCommand,
} = {}) {
  const selected = await resolveRunId(projectRoot, runId);
  const runDir = runDirectory(projectRoot, selected);
  const bounds = resolveLoopBounds({
    ...(await loadProjectLoopBounds(projectRoot)),
    ...(maxIterations != null ? { maxIterations } : {}),
    ...(maxStepsPerIteration != null ? { maxStepsPerIteration } : {}),
  });

  const iterations = [];
  let stoppedOn = null;
  let stoppedDetail = null;
  let goalId = null;
  let previousFingerprint = null;

  for (let iteration = 1; iteration <= bounds.maxIterations; iteration++) {
    // Budget brake first — a loop must never start an iteration it cannot pay for.
    const budget = await evaluateLoopBudget(projectRoot, selected);
    if (!budget.ok) {
      stoppedOn = 'budget_exhausted';
      stoppedDetail = budget.reason;
      iterations.push({ iteration, decision: { action: 'stop', stopped_on: stoppedOn, detail: budget.reason } });
      if (!dryRun) {
        await appendLoopEvent(runDir, {
          type: 'loop_blocked', iteration, max_iterations: bounds.maxIterations,
          goal_id: goalId, stopped_on: stoppedOn, reason: budget.reason,
        });
      }
      break;
    }

    if (!dryRun) {
      await appendLoopEvent(runDir, {
        type: 'loop_iteration_started', iteration, max_iterations: bounds.maxIterations, goal_id: goalId,
      });
    }

    // One resume-aware pipeline pass: skip DONE work, validate active
    // contracts, re-claim retryable failures, stop at human gates. Dry-run
    // plans the next action only and persists nothing.
    const pipelineReport = await runPipeline(projectRoot, {
      runId: selected,
      maxSteps: bounds.maxStepsPerIteration,
      dryRun,
      invokeTool,
    });

    // Evaluate the goal against post-pass state (built in memory — the
    // evaluator never persists anything).
    const evaluation = await evaluateGoal(projectRoot, selected, { goal, iteration, runCommand });
    goalId = evaluation.goal_id;
    if (!dryRun) {
      await appendLoopEvent(runDir, {
        type: 'goal_evaluated', iteration, max_iterations: bounds.maxIterations,
        goal_id: evaluation.goal_id, status: evaluation.status, score: evaluation.score,
        critical_count: evaluation.critical_count, failing_stages: evaluation.failing_stages,
        recommended_rerun_stages: evaluation.recommended_rerun_stages, reason: evaluation.reason,
      });
    }

    const fingerprint = computeProgressFingerprint({
      tasks: await readRunTasks(projectRoot, selected),
      evaluation,
    });
    const decision = planLoopDecision({
      evaluation,
      iteration,
      maxIterations: bounds.maxIterations,
      // 'dry_run' just means "first live action planned" — not a gate.
      pipelineStoppedOn: pipelineReport.stopped_on === 'dry_run' ? null : pipelineReport.stopped_on,
      budget,
      progressFingerprint: fingerprint,
      previousFingerprint,
    });
    previousFingerprint = fingerprint;

    const record = {
      iteration,
      pipeline: { steps: pipelineReport.steps, stopped_on: pipelineReport.stopped_on },
      evaluation: compactEvaluation(evaluation),
      decision,
    };
    iterations.push(record);

    if (dryRun) {
      // Dry-run reports iteration 1 in full and stops: executing nothing
      // means later iterations would be speculation, not a plan.
      stoppedOn = 'dry_run';
      stoppedDetail = 'Dry run: evaluation and decision reported; no state was written.';
      break;
    }

    if (decision.action === 'stop') {
      stoppedOn = decision.stopped_on;
      stoppedDetail = decision.detail;
      await appendLoopEvent(runDir, decision.stopped_on === 'complete'
        ? {
          type: 'loop_completed', iteration, max_iterations: bounds.maxIterations,
          goal_id: evaluation.goal_id, score: evaluation.score, reason: evaluation.reason,
        }
        : {
          type: 'loop_blocked', iteration, max_iterations: bounds.maxIterations,
          goal_id: evaluation.goal_id, stopped_on: decision.stopped_on, reason: decision.detail,
        });
      break;
    }

    if (decision.action === 'retry_stages') {
      const resetTaskIds = await resetStagesForRetry(projectRoot, selected, decision.stages);
      record.reset_task_ids = resetTaskIds;
      await appendLoopEvent(runDir, {
        type: 'loop_iteration_retrying_stages', iteration, max_iterations: bounds.maxIterations,
        goal_id: evaluation.goal_id, stages: decision.stages, task_ids: resetTaskIds,
        reason: evaluation.reason,
      });
    }
    // decision.action === 'continue' needs no state change — next pass
    // simply resumes the remaining work.
  }

  if (!stoppedOn) {
    // The for-loop bound itself expired mid-retry (defense in depth — the
    // planner's max_iterations stop normally fires first).
    stoppedOn = 'max_iterations';
    stoppedDetail = `Iteration bound (${bounds.maxIterations}) reached with the goal still unmet.`;
    if (!dryRun) {
      await appendLoopEvent(runDir, {
        type: 'loop_blocked', iteration: bounds.maxIterations, max_iterations: bounds.maxIterations,
        goal_id: goalId, stopped_on: stoppedOn, reason: stoppedDetail,
      });
    }
  }

  return {
    run_id: selected,
    goal_id: goalId,
    max_iterations: bounds.maxIterations,
    hard_cap: LOOP_HARD_CAP,
    iterations,
    stopped_on: stoppedOn,
    detail: stoppedDetail,
  };
}

export function formatLoopReport(report) {
  const lines = [`Run: ${report.run_id} | goal: ${report.goal_id ?? 'pipeline-complete'} | bound: ${report.iterations.length}/${report.max_iterations} iteration(s) (hard cap ${report.hard_cap})`];
  for (const record of report.iterations) {
    lines.push(`Iteration ${record.iteration}:`);
    if (record.pipeline) {
      lines.push(`  pipeline: ${record.pipeline.steps.length} step(s), stopped on ${record.pipeline.stopped_on}`);
    }
    if (record.evaluation) {
      lines.push(`  ${summarizeGoalDecision(record.evaluation)}`);
    }
    const decision = record.decision ?? {};
    if (decision.action === 'retry_stages') {
      lines.push(`  ↻ resetting stages: ${decision.stages.join(', ')}${record.reset_task_ids?.length ? ` (tasks: ${record.reset_task_ids.join(', ')})` : ''}`);
    } else if (decision.action === 'continue') {
      lines.push(`  → continuing: ${decision.detail}`);
    }
  }
  const closing = {
    complete: '✅ Loop complete — goal met.',
    ask_user: '⏸ Stopped: a human decision is required.',
    blocked: '⛔ Stopped: a blocking issue requires human intervention.',
    pending_approval: '⏸ Stopped: waiting on a human approval.',
    blocked_retry_policy: '⛔ Stopped: retry budget exhausted — a guardrail override is required.',
    missing_contract: '⏸ Stopped: a builder packet awaits agent execution — the harness never calls models.',
    max_iterations: '⛔ Stopped: iteration bound reached with the goal unmet.',
    no_progress: '⛔ Stopped: no progress between iterations.',
    budget_exhausted: '⛔ Stopped: run budget exhausted.',
    evaluation_error: '⛔ Stopped: goal evaluation was unusable.',
    dry_run: 'Dry run: no state was written.',
  };
  lines.push(closing[report.stopped_on] ?? `Stopped: ${report.stopped_on}.`);
  if (report.detail) lines.push(report.detail);
  return lines.join('\n');
}
