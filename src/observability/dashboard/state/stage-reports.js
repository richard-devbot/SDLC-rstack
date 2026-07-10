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

// Where stages REALLY write today, beyond the canonical path (#97): several
// agent contracts still write legacy top-level artifacts (01-transcript,
// 02-requirements, 12-security) or "canonical + legacy copy" pairs (08, 09,
// 10, 11). The canonical path always wins; these run-relative fallbacks are
// consulted only when it is absent — so the previously dark stages become
// visible without moving any files. Every path here is copied from the
// agents/sdlc/*.md contract sections; do not invent entries.
export const STAGE_ARTIFACT_FALLBACKS = Object.freeze({
  '01-transcript': ['artifacts/transcript.json'],
  '02-requirements': [
    // agent contract + adopt harvester write requirement_spec.json, while the
    // canonical stage list names requirements.json — accept both names.
    'artifacts/stages/02-requirements/requirement_spec.json',
    'artifacts/requirement_spec.json',
    'artifacts/requirements/requirement_spec.json',
  ],
  '03-documentation': ['artifacts/documents/documentation_output.json'],
  '08-testing': ['artifacts/test_report.json'],
  '09-deployment': ['artifacts/deployment_report.json'],
  '10-summary': ['artifacts/summary.json'],
  '11-feedback-loop': ['artifacts/feedback/consistency_report.json'],
  '12-security-threat-model': ['artifacts/security/threat_model.json'],
});

/**
 * Absolute path of the first artifact location that exists for a stage:
 * canonical artifacts/stages/<id>/<artifact> first, then the contract-listed
 * legacy fallbacks. Returns null when the stage produced nothing.
 */
export function resolveStageArtifactPath(runDir, stageId) {
  const canonical = join(runDir, 'artifacts', 'stages', stageId, STAGE_ARTIFACTS[stageId]);
  if (existsSync(canonical)) return canonical;
  for (const rel of STAGE_ARTIFACT_FALLBACKS[stageId] ?? []) {
    const candidate = join(runDir, rel);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

// Top-level cross-stage deliverables worth surfacing on their own.
const DELIVERABLES = Object.freeze({
  'release-readiness': 'artifacts/release-readiness.json',
  summary: 'artifacts/stages/10-summary/summary.json',
});

async function readCappedJson(path) {
  if (!path || !existsSync(path)) return null;
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
  await Promise.all(Object.keys(STAGE_ARTIFACTS).map(async (stageId) => {
    stages[stageId] = await readCappedJson(resolveStageArtifactPath(runDir, stageId));
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
    resolveStageArtifactPath(runDir, stageId) !== null);
}
