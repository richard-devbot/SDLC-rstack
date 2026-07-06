/**
 * Stage-report collector — reads the structured deliverables a run produced
 * (the 15 canonical stage artifacts + key top-level reports) and returns them
 * parsed, so the UI can render them as infographics.
 *
 * Everything here is read-only and size-capped. Path safety is the caller's
 * responsibility (server validates the runId + containment before calling).
 *
 * owner: RStack developed by Richardson Gunde
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { CANONICAL_SDLC_STAGES } from '../../../core/harness/stages.js';

const MAX_REPORT_BYTES = 256 * 1024;

// stage id → the artifact filename it writes under artifacts/stages/<id>/.
// Derived from the canonical harness stage list — never hand-mirrored (#95).
export const STAGE_ARTIFACTS = Object.freeze(
  Object.fromEntries(CANONICAL_SDLC_STAGES.map((stage) => [stage.id, stage.artifact])),
);

// Top-level cross-stage deliverables worth surfacing on their own.
const DELIVERABLES = Object.freeze({
  'release-readiness': 'artifacts/release-readiness.json',
  summary: 'artifacts/stages/10-summary/summary.json',
});

async function readCappedJson(path) {
  if (!existsSync(path)) return null;
  try {
    const raw = await readFile(path, 'utf8');
    if (raw.length > MAX_REPORT_BYTES) return { _truncated: true, _bytes: raw.length };
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Collect parsed stage reports for one run.
 * Returns { stages: { [stageId]: data|null }, deliverables: { [key]: data|null } }.
 */
export async function collectStageReports(runDir) {
  const stages = {};
  await Promise.all(Object.entries(STAGE_ARTIFACTS).map(async ([stageId, file]) => {
    stages[stageId] = await readCappedJson(join(runDir, 'artifacts', 'stages', stageId, file));
  }));
  const deliverables = {};
  await Promise.all(Object.entries(DELIVERABLES).map(async ([key, rel]) => {
    deliverables[key] = await readCappedJson(join(runDir, rel));
  }));
  return { stages, deliverables };
}

/** Which stage ids actually produced a report (for snapshot indexing). */
export async function stageReportIndex(runDir) {
  return Object.keys(STAGE_ARTIFACTS).filter((stageId) =>
    existsSync(join(runDir, 'artifacts', 'stages', stageId, STAGE_ARTIFACTS[stageId])));
}
