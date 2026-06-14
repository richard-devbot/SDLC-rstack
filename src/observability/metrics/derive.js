/**
 * Run metrics derivation — pure functions over (events, tasks).
 *
 * Everything here is derived from data already on disk (events.jsonl +
 * tasks.json), so timelines, durations, and trends work retroactively for
 * historical runs — no re-instrumentation required.
 *
 * Legacy compatibility: stage_completed events written before the canonical
 * stage attribution fix carry plan task ids (e.g. "002-requirements") in
 * stage_id. normalizeStageCompletions remaps those through the task's
 * stage_artifacts so old runs aggregate correctly.
 *
 * owner: RStack developed by Richardson Gunde
 */

import { getCanonicalStage } from '../../core/harness/stages.js';

function parseTs(ts) {
  const ms = Date.parse(ts ?? '');
  return Number.isFinite(ms) ? ms : null;
}

/** task_id → unique canonical stage ids the task produces. */
export function taskStageMap(tasks) {
  const map = {};
  for (const task of tasks ?? []) {
    if (!task?.id) continue;
    const ids = [...new Set(
      (task.stage_artifacts ?? [])
        .map((artifact) => artifact?.stage_id)
        .filter((id) => typeof id === 'string' && getCanonicalStage(id)),
    )];
    if (ids.length === 0 && getCanonicalStage(task.id)) ids.push(task.id);
    map[task.id] = ids;
  }
  return map;
}

/**
 * Normalize stage_completed events to canonical stage ids.
 * Returns [{ stage_id, task_id, ts, elapsed_ms, stages_in_task }].
 */
export function normalizeStageCompletions(events, tasks) {
  const stagesByTask = taskStageMap(tasks);
  const out = [];
  for (const ev of events ?? []) {
    if (ev?.type !== 'stage_completed') continue;
    const taskId = ev.task_id ?? ev.stage_id ?? null;
    if (ev.stage_id && getCanonicalStage(ev.stage_id)) {
      out.push({
        stage_id: ev.stage_id,
        task_id: taskId,
        ts: ev.ts ?? null,
        elapsed_ms: Number(ev.elapsed_ms) || 0,
        stages_in_task: Number(ev.stages_in_task) || 1,
      });
      continue;
    }
    // Legacy event: stage_id is a plan task id — remap via tasks.json.
    const mapped = stagesByTask[taskId] ?? [];
    for (const stageId of mapped) {
      out.push({
        stage_id: stageId,
        task_id: taskId,
        ts: ev.ts ?? null,
        elapsed_ms: Number(ev.elapsed_ms) || 0,
        stages_in_task: mapped.length,
      });
    }
  }
  return out;
}

/**
 * Per-stage elapsed totals, normalized so a multi-stage task's elapsed is
 * split evenly across its stages instead of double-counted.
 * Returns { [stage_id]: elapsed_ms }.
 */
export function deriveStageElapsed(events, tasks) {
  const elapsed = {};
  for (const completion of normalizeStageCompletions(events, tasks)) {
    const share = completion.elapsed_ms / (completion.stages_in_task || 1);
    elapsed[completion.stage_id] = (elapsed[completion.stage_id] ?? 0) + share;
  }
  for (const key of Object.keys(elapsed)) elapsed[key] = Math.round(elapsed[key]);
  return elapsed;
}

/**
 * Gantt-ready task segments: one per validation attempt, with wall-clock
 * start/end derived from task_started → task_validated event pairs.
 * Returns [{ task_id, stage_ids, started_at, ended_at, elapsed_ms, status, attempt }]
 * sorted by start time.
 */
export function deriveRunTimeline(events, tasks) {
  const stagesByTask = taskStageMap(tasks);
  const open = {};
  const segments = [];
  const attempts = {};
  for (const ev of events ?? []) {
    if (!ev?.task_id) continue;
    if (ev.type === 'task_started' || ev.type === 'builder_task_prepared') {
      // First signal wins per attempt; a new task_started after validation opens a new attempt.
      if (!open[ev.task_id]) open[ev.task_id] = { started_at: ev.ts ?? null };
      continue;
    }
    if (ev.type === 'task_validated') {
      const attempt = (attempts[ev.task_id] = (attempts[ev.task_id] ?? 0) + 1);
      const startTs = open[ev.task_id]?.started_at ?? null;
      const startMs = parseTs(startTs);
      const endMs = parseTs(ev.ts);
      segments.push({
        task_id: ev.task_id,
        stage_ids: stagesByTask[ev.task_id] ?? [],
        started_at: startTs,
        ended_at: ev.ts ?? null,
        elapsed_ms: startMs !== null && endMs !== null ? Math.max(0, endMs - startMs) : 0,
        status: ev.status ?? 'UNKNOWN',
        attempt,
      });
      delete open[ev.task_id];
    }
  }
  // Tasks still in flight: open segment without an end.
  for (const [taskId, info] of Object.entries(open)) {
    segments.push({
      task_id: taskId,
      stage_ids: stagesByTask[taskId] ?? [],
      started_at: info.started_at,
      ended_at: null,
      elapsed_ms: 0,
      status: 'IN_PROGRESS',
      attempt: (attempts[taskId] ?? 0) + 1,
    });
  }
  return segments.sort((a, b) => (parseTs(a.started_at) ?? Infinity) - (parseTs(b.started_at) ?? Infinity));
}

/** Whole-run totals from the event stream. */
export function deriveRunTotals(events) {
  const totals = {
    duration_ms: 0,
    tool_calls: 0,
    cost_usd: 0,
    tokens: 0,
    tasks_passed: 0,
    tasks_failed: 0,
    guardrails: 0,
    quality_avg: null,
  };
  const qualityScores = [];
  let firstTs = null;
  let lastTs = null;
  for (const ev of events ?? []) {
    const ms = parseTs(ev?.ts);
    if (ms !== null) {
      if (firstTs === null || ms < firstTs) firstTs = ms;
      if (lastTs === null || ms > lastTs) lastTs = ms;
    }
    switch (ev?.type) {
      case 'tool_call': totals.tool_calls++; break;
      case 'cost_recorded':
        totals.cost_usd += Number(ev.usd ?? ev.cost ?? 0) || 0;
        totals.tokens += Number(ev.tokens) || 0;
        break;
      case 'task_validated':
        if (ev.status === 'PASS') totals.tasks_passed++;
        else if (ev.status === 'FAIL') totals.tasks_failed++;
        break;
      case 'guardrail_triggered': totals.guardrails++; break;
      case 'quality_score_recorded':
        if (Number.isFinite(Number(ev.score))) qualityScores.push(Number(ev.score));
        break;
      default: break;
    }
  }
  if (firstTs !== null && lastTs !== null) totals.duration_ms = Math.max(0, lastTs - firstTs);
  if (qualityScores.length) {
    totals.quality_avg = Math.round((qualityScores.reduce((sum, score) => sum + score, 0) / qualityScores.length) * 100) / 100;
  }
  totals.cost_usd = Math.round(totals.cost_usd * 10000) / 10000;
  return totals;
}

/**
 * Cross-run trends.
 * runs: [{ runId, manifest, events, tasks }]
 * Returns {
 *   stages: { [stage_id]: { runs, total_elapsed_ms, avg_elapsed_ms, completions } },
 *   runs:   [{ runId, created_at, goal, duration_ms, cost_usd, tokens,
 *              tasks_passed, tasks_failed, quality_avg, tool_calls }] (newest first)
 * }
 */
export function buildStageTrends(runs) {
  const stages = {};
  const runRows = [];
  for (const run of runs ?? []) {
    const events = run.events ?? [];
    const tasks = run.tasks ?? [];
    // Index-served runs carry precomputed rollups (run.stageElapsed /
    // run.totals) so trends never need their raw events re-parsed.
    const elapsed = run.stageElapsed ?? deriveStageElapsed(events, tasks);
    const seenStages = new Set();
    for (const [stageId, ms] of Object.entries(elapsed)) {
      const entry = (stages[stageId] ??= { runs: 0, total_elapsed_ms: 0, avg_elapsed_ms: 0, completions: 0 });
      entry.total_elapsed_ms += ms;
      entry.completions++;
      if (!seenStages.has(stageId)) { entry.runs++; seenStages.add(stageId); }
    }
    const totals = run.totals ?? deriveRunTotals(events);
    runRows.push({
      runId: run.runId,
      created_at: run.manifest?.created_at ?? null,
      goal: (run.manifest?.goal ?? '').slice(0, 160),
      ...totals,
    });
  }
  for (const entry of Object.values(stages)) {
    entry.avg_elapsed_ms = entry.runs > 0 ? Math.round(entry.total_elapsed_ms / entry.runs) : 0;
  }
  runRows.sort((a, b) => String(b.runId).localeCompare(String(a.runId)));
  return { stages, runs: runRows };
}
