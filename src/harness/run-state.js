import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { CANONICAL_SDLC_STAGES, assertCanonicalStages, getCanonicalStage } from './stages.js';

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

export async function updateRunMetrics(runDir, metricsUpdate = {}) {
  const path = join(runDir, 'metrics.json');
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
    } catch {}
  }

  const merged = {
    ...current,
    ...metricsUpdate,
    stage_elapsed_ms: { ...current.stage_elapsed_ms, ...(metricsUpdate.stage_elapsed_ms || {}) },
    stage_status: { ...current.stage_status, ...(metricsUpdate.stage_status || {}) },
  };

  if (metricsUpdate.cumulative_duration_ms !== undefined) merged.cumulative_duration_ms = metricsUpdate.cumulative_duration_ms;
  if (metricsUpdate.cumulative_cost_usd !== undefined) merged.cumulative_cost_usd = metricsUpdate.cumulative_cost_usd;
  if (metricsUpdate.cumulative_tool_calls !== undefined) merged.cumulative_tool_calls = metricsUpdate.cumulative_tool_calls;

  await writeFile(path, JSON.stringify(merged, null, 2));
  return merged;
}

