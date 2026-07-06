import { mkdir, readFile, cp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { CANONICAL_SDLC_STAGES, assertCanonicalStages, getCanonicalStage } from './stages.js';
import { withFileLock, writeJsonAtomic } from './safe-write.js';

export function stageArtifactsDir(runDir) {
  return join(runDir, 'artifacts', 'stages');
}

export function stageDir(runDir, stageId) {
  const stage = getCanonicalStage(stageId);
  if (!stage) throw new Error(`Unknown canonical SDLC stage: ${stageId}`);
  return join(stageArtifactsDir(runDir), stage.id);
}

export function stageArtifactPath(runDir, stageId, artifactName) {
  const stage = getCanonicalStage(stageId);
  if (!stage) throw new Error(`Unknown canonical SDLC stage: ${stageId}`);
  return join(stageDir(runDir, stage.id), artifactName || stage.artifact);
}

export async function prepareStageFolders(runDir, stages = CANONICAL_SDLC_STAGES) {
  assertCanonicalStages(stages);
  await mkdir(stageArtifactsDir(runDir), { recursive: true });
  for (const stage of stages) {
    await mkdir(join(stageArtifactsDir(runDir), stage.id), { recursive: true });
  }
  return stageArtifactsDir(runDir);
}

export async function prepareRunState(runDir) {
  await mkdir(join(runDir, 'tasks'), { recursive: true });
  await mkdir(join(runDir, 'artifacts'), { recursive: true });
  await prepareStageFolders(runDir);
  return runDir;
}

// Cumulative token totals shape (#83). Tolerates malformed/legacy values —
// anything non-numeric collapses to 0, a missing total is derived.
function coerceTokenCounts(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const input = Number(source.input);
  const output = Number(source.output);
  const total = Number(source.total);
  const safeInput = Number.isFinite(input) ? input : 0;
  const safeOutput = Number.isFinite(output) ? output : 0;
  return {
    input: safeInput,
    output: safeOutput,
    total: Number.isFinite(total) ? total : safeInput + safeOutput,
  };
}

function addTokenCounts(base, delta) {
  const a = coerceTokenCounts(base);
  const b = coerceTokenCounts(delta);
  return { input: a.input + b.input, output: a.output + b.output, total: a.total + b.total };
}

// Strip float dust from accumulated USD without losing sub-cent telemetry.
function roundUsd(value) {
  return Math.round(value * 1e6) / 1e6;
}

// Apply an incremental delta (#83): unlike the top-level cumulative_* fields
// (which overwrite), `increment` ADDS to the running totals — the whole
// read-modify-write already runs inside the file lock, so concurrent
// increments from parallel validations both land.
function applyMetricsIncrement(merged, increment) {
  if (!increment || typeof increment !== 'object') return;

  const cost = Number(increment.cost_usd);
  if (Number.isFinite(cost)) {
    merged.cumulative_cost_usd = roundUsd((Number(merged.cumulative_cost_usd) || 0) + cost);
  }

  const toolCalls = Number(increment.tool_calls);
  if (Number.isFinite(toolCalls)) {
    merged.cumulative_tool_calls = (Number(merged.cumulative_tool_calls) || 0) + toolCalls;
  }

  if (increment.tokens && typeof increment.tokens === 'object') {
    merged.cumulative_tokens = addTokenCounts(merged.cumulative_tokens, increment.tokens);
  }

  if (increment.stage_cost_usd && typeof increment.stage_cost_usd === 'object') {
    const stageCost = { ...(merged.stage_cost_usd && typeof merged.stage_cost_usd === 'object' ? merged.stage_cost_usd : {}) };
    for (const [stageId, usd] of Object.entries(increment.stage_cost_usd)) {
      const delta = Number(usd);
      if (!Number.isFinite(delta)) continue;
      stageCost[stageId] = roundUsd((Number(stageCost[stageId]) || 0) + delta);
    }
    merged.stage_cost_usd = stageCost;
  }

  if (increment.stage_tokens && typeof increment.stage_tokens === 'object') {
    const stageTokens = { ...(merged.stage_tokens && typeof merged.stage_tokens === 'object' ? merged.stage_tokens : {}) };
    for (const [stageId, tokens] of Object.entries(increment.stage_tokens)) {
      if (!tokens || typeof tokens !== 'object') continue;
      stageTokens[stageId] = addTokenCounts(stageTokens[stageId], tokens);
    }
    merged.stage_tokens = stageTokens;
  }
}

export async function updateRunMetrics(runDir, metricsUpdate = {}) {
  const path = join(runDir, 'metrics.json');
  // Lock the whole read-modify-write: concurrent stage updates (parallel
  // builders, dashboard actions) must both land instead of the last writer
  // silently dropping the first (issue #81).
  return withFileLock(path, async () => {
    let current = {
      cumulative_duration_ms: 0,
      cumulative_cost_usd: 0,
      cumulative_tool_calls: 0,
      stage_elapsed_ms: {},
      stage_status: {},
    };

    if (existsSync(path)) {
      try {
        current = JSON.parse(await readFile(path, 'utf8'));
      } catch { current = {}; }
    }

    const { increment, ...update } = metricsUpdate;

    const merged = {
      ...current,
      ...update,
      stage_elapsed_ms: { ...current.stage_elapsed_ms, ...(update.stage_elapsed_ms || {}) },
      stage_status: { ...current.stage_status, ...(update.stage_status || {}) },
    };
    // Per-stage cost/token maps (#83) merge per key like the other stage maps,
    // but are only materialized when data exists — `cumulative_tokens` doubles
    // as the "incremental totals are authoritative" marker for readers
    // (derive.js), so unrelated updates must never stamp it onto legacy runs.
    if (current.stage_cost_usd || update.stage_cost_usd) {
      merged.stage_cost_usd = { ...(current.stage_cost_usd || {}), ...(update.stage_cost_usd || {}) };
    }
    if (current.stage_tokens || update.stage_tokens) {
      merged.stage_tokens = { ...(current.stage_tokens || {}), ...(update.stage_tokens || {}) };
    }
    if (update.cumulative_tokens !== undefined) merged.cumulative_tokens = coerceTokenCounts(update.cumulative_tokens);

    if (update.cumulative_duration_ms !== undefined) merged.cumulative_duration_ms = update.cumulative_duration_ms;
    if (update.cumulative_cost_usd !== undefined) merged.cumulative_cost_usd = update.cumulative_cost_usd;
    if (update.cumulative_tool_calls !== undefined) merged.cumulative_tool_calls = update.cumulative_tool_calls;

    applyMetricsIncrement(merged, increment);

    await writeJsonAtomic(path, merged);
    return merged;
  });
}

export async function createStageCheckpoint(runDir, stageId) {
  const src = stageDir(runDir, stageId);
  const dest = join(runDir, 'checkpoints', stageId);
  if (!existsSync(src)) return false;
  await mkdir(join(runDir, 'checkpoints'), { recursive: true });
  await rm(dest, { recursive: true, force: true });
  await cp(src, dest, { recursive: true, force: true });
  return true;
}

export async function rollbackStage(runDir, stageId) {
  const src = join(runDir, 'checkpoints', stageId);
  const dest = stageDir(runDir, stageId);
  if (!existsSync(src)) return false;
  await rm(dest, { recursive: true, force: true });
  await cp(src, dest, { recursive: true, force: true });
  return true;
}

