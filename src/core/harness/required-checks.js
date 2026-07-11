// owner: RStack developed by Richardson Gunde
//
// Mechanical enforcement of validator-profile required_checks (#222).
//
// The validator registry (#120) declares required_checks per stage, and until
// now they were recorded as delegated-only (#230's honest transparency slice)
// — a stage could pass validation without its declared checks ever running.
// This module evaluates every check that CAN be decided mechanically from
// on-disk evidence (builder contract signals, stage artifact JSON, modified
// file contents) and returns real PASS/FAIL entries. Checks that genuinely
// need specialist judgment stay DELEGATED (returned so the delegation record
// names exactly the remainder — epic #72), and an unknown check id FAILs with
// an actionable reason instead of silently passing: a project that declares a
// custom check owns providing a mechanical evaluator or accepting the FAIL.
//
// Design rule (the Archon-R1 insight adopted after the 2026-07-11 prior-art
// research): the required_checks list IS the stage's output contract — field
// presence in the canonical stage artifact JSON is the mechanical evaluation,
// so enforcing the checks and specifying the artifact schema are one move.

import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

// Checks that require the delegated specialist validator's judgment. Never
// fabricated as PASS, never false-FAILed — they remain visibly delegated.
export const DELEGATED_SEMANTIC_CHECKS = Object.freeze(new Set([
  'no_secrets_introduced',
  'no_silent_skips',
]));

const STUB_PATTERN = /\bnot\s+implemented\b|NotImplementedError|TODO:?\s*implement|FIXME:?\s*implement|throw new Error\((["'])TODO/i;
const STUB_FILE_CAP = 50;
const STUB_BYTES_CAP = 64 * 1024;

function pass(name, evidence) {
  return { name: `required_check_${name}`, status: 'PASS', evidence };
}

function fail(name, evidence) {
  return { name: `required_check_${name}`, status: 'FAIL', evidence };
}

function nonEmpty(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === 'object') return Object.keys(value).length > 0;
  if (typeof value === 'string') return value.trim().length > 0;
  return typeof value === 'number' || typeof value === 'boolean';
}

/**
 * Read the profile stage's canonical artifact JSON, contained to runDir.
 * Returns { exists, json, path, reason } — json is null when missing or
 * unparseable, with the reason explaining which (honest FAIL evidence).
 */
async function readStageArtifact(ctx) {
  const stageId = ctx.profile?.stage_id;
  if (!stageId) return { exists: false, json: null, path: null, reason: 'profile has no stage_id (generic profile has no stage artifact)' };
  const fromTask = (Array.isArray(ctx.task?.stage_artifacts) ? ctx.task.stage_artifacts : [])
    .find((entry) => entry?.stage_id === stageId && typeof entry?.artifact_path === 'string');
  const candidate = fromTask
    ? resolve(ctx.projectRoot, fromTask.artifact_path)
    : resolve(ctx.runDir, 'artifacts', 'stages', stageId, ctx.artifactName);
  // Containment: an artifact_path from tasks.json is data, not trusted input.
  const runRoot = resolve(ctx.runDir);
  const projectRootAbs = resolve(ctx.projectRoot);
  if (!candidate.startsWith(runRoot + sep) && !candidate.startsWith(projectRootAbs + sep)) {
    return { exists: false, json: null, path: candidate, reason: `artifact path escapes the run/project root: ${candidate}` };
  }
  if (!existsSync(candidate)) return { exists: false, json: null, path: candidate, reason: `artifact not found at ${candidate}` };
  try {
    const info = await stat(candidate);
    if (info.size === 0) return { exists: true, json: null, path: candidate, reason: 'artifact file is empty' };
    return { exists: true, json: JSON.parse(await readFile(candidate, 'utf8')), path: candidate, reason: null };
  } catch (err) {
    return { exists: true, json: null, path: candidate, reason: `artifact is not valid JSON: ${err?.message ?? err}` };
  }
}

function artifactPresent(name, artifact) {
  if (artifact.exists && artifact.json !== null) return pass(name, `artifact present and parseable: ${artifact.path}`);
  return fail(name, artifact.reason ?? 'artifact missing');
}

/** Field-presence check against the stage artifact JSON. */
function artifactFields(name, artifact, fields) {
  if (!artifact.exists || artifact.json === null) return fail(name, artifact.reason ?? 'artifact missing — fields cannot be evaluated');
  const missing = fields.filter((field) => !nonEmpty(artifact.json?.[field]));
  if (missing.length === 0) return pass(name, `fields present and non-empty: ${fields.join(', ')}`);
  return fail(name, `artifact ${artifact.path} is missing or has empty field(s): ${missing.join(', ')} — the stage's output contract requires them`);
}

/** Every entry of artifact.json[listField] must carry a non-empty itemField. */
function everyEntryHas(name, artifact, listField, itemField, { emptyListPasses = true } = {}) {
  if (!artifact.exists || artifact.json === null) return fail(name, artifact.reason ?? 'artifact missing — entries cannot be evaluated');
  const list = artifact.json?.[listField];
  if (!Array.isArray(list)) return fail(name, `artifact ${artifact.path} has no ${listField}[] array — the stage's output contract requires it`);
  if (list.length === 0) {
    return emptyListPasses
      ? pass(name, `${listField} is empty — nothing to require ${itemField} on`)
      : fail(name, `${listField} is empty`);
  }
  const missing = list.filter((entry) => !nonEmpty(entry?.[itemField]));
  if (missing.length === 0) return pass(name, `every ${listField} entry carries ${itemField} (${list.length} checked)`);
  return fail(name, `${missing.length} of ${list.length} ${listField} entries lack ${itemField}`);
}

async function noPlaceholderStubs(ctx) {
  const files = (Array.isArray(ctx.builder?.files_modified) ? ctx.builder.files_modified : [])
    .filter((file) => typeof file === 'string')
    .slice(0, STUB_FILE_CAP);
  // Vacuous pass, stated plainly: whether a code stage may ship zero files is
  // the completeness gate's question — this check only judges what WAS written.
  if (files.length === 0) return pass('no_placeholder_stubs', 'builder contract lists no modified files — nothing to scan for stubs');
  const offenders = [];
  for (const file of files) {
    const abs = resolve(ctx.projectRoot, file);
    if (!abs.startsWith(resolve(ctx.projectRoot) + sep)) continue;
    if (!existsSync(abs)) continue; // missing files are files_modified_exist's verdict, not this check's
    try {
      if ((await stat(abs)).size > STUB_BYTES_CAP) continue;
      if (STUB_PATTERN.test(await readFile(abs, 'utf8'))) offenders.push(file);
    } catch { /* unreadable file — files_modified_exist owns existence; skip content scan */ }
  }
  if (offenders.length === 0) return pass('no_placeholder_stubs', `no explicit stub signatures in ${files.length} modified file(s)`);
  return fail('no_placeholder_stubs', `explicit stub signature (not implemented / TODO: implement) in: ${offenders.join(', ')}`);
}

function signalCheck(name, ctx, signalKey, passText, failText) {
  return ctx.signals?.[signalKey] === true ? pass(name, passText) : fail(name, failText);
}

// One evaluator per known mechanical check id. Each receives the shared ctx
// plus the profile stage's artifact (read once).
const MECHANICAL_EVALUATORS = {
  builder_contract_complete: (ctx) => signalCheck('builder_contract_complete', ctx, 'builderContractOk',
    'builder contract parsed and passed the completeness gate',
    'builder contract missing, invalid, or incomplete (see builder_contract checks above)'),
  files_modified_exist: (ctx) => signalCheck('files_modified_exist', ctx, 'filesModifiedOk',
    'every claimed modified file exists on disk',
    'one or more claimed modified files do not exist (see modified_file_exists checks above)'),
  tests_run_evidence: (ctx) => signalCheck('tests_run_evidence', ctx, 'testsRunOk',
    'builder contract carries non-empty tests_run evidence',
    'builder contract has no tests_run evidence (commands run, or SKIPPED: reason)'),
  no_placeholder_stubs: (ctx) => noPlaceholderStubs(ctx),

  architecture_artifact_present: (ctx, artifact) => artifactPresent('architecture_artifact_present', artifact),
  components_and_interfaces_defined: (ctx, artifact) => artifactFields('components_and_interfaces_defined', artifact, ['components', 'interfaces']),
  tradeoffs_documented: (ctx, artifact) => artifactFields('tradeoffs_documented', artifact, ['tradeoffs']),
  security_boundaries_identified: (ctx, artifact) => artifactFields('security_boundaries_identified', artifact, ['security_boundaries']),

  test_report_exists: (ctx, artifact) => artifactPresent('test_report_exists', artifact),
  test_results_counted: (ctx, artifact) => artifactFields('test_results_counted', artifact, ['totals']),
  failures_have_root_cause: (ctx, artifact) => everyEntryHas('failures_have_root_cause', artifact, 'failures', 'root_cause'),

  threat_model_artifact_present: (ctx, artifact) => artifactPresent('threat_model_artifact_present', artifact),
  stride_categories_covered: (ctx, artifact) => everyEntryHas('stride_categories_covered', artifact, 'threats', 'category', { emptyListPasses: false }),
  high_risks_have_mitigation: (ctx, artifact) => {
    if (!artifact.exists || artifact.json === null) return fail('high_risks_have_mitigation', artifact.reason ?? 'artifact missing');
    const threats = Array.isArray(artifact.json?.threats) ? artifact.json.threats : [];
    const high = threats.filter((threat) => /^(high|critical)$/i.test(String(threat?.risk ?? threat?.severity ?? '')));
    const missing = high.filter((threat) => !nonEmpty(threat?.mitigation));
    if (missing.length === 0) return pass('high_risks_have_mitigation', `${high.length} high/critical threat(s), all carry mitigation`);
    return fail('high_risks_have_mitigation', `${missing.length} of ${high.length} high/critical threats lack mitigation`);
  },

  compliance_report_present: (ctx, artifact) => artifactPresent('compliance_report_present', artifact),
  frameworks_enumerated: (ctx, artifact) => artifactFields('frameworks_enumerated', artifact, ['frameworks']),
  gaps_have_remediation: (ctx, artifact) => everyEntryHas('gaps_have_remediation', artifact, 'gaps', 'remediation'),
};

/**
 * Evaluate a profile's required_checks mechanically.
 *
 * ctx: {
 *   profile,                 // resolved validator profile (may be generic)
 *   task,                    // the task under validation (stage_artifacts)
 *   builder,                 // parsed builder contract or undefined
 *   projectRoot, runDir,
 *   signals: {               // outcomes the caller already computed
 *     builderContractOk, filesModifiedOk, testsRunOk
 *   },
 * }
 *
 * Returns { ok, checks, delegated } — checks are real PASS/FAIL entries;
 * delegated lists the semantic remainder for the delegation record. A
 * profile with no required_checks returns ok:true with zero checks (no
 * enforcement, no false failures).
 */
export async function evaluateRequiredChecks(ctx) {
  const declared = Array.isArray(ctx.profile?.required_checks) ? ctx.profile.required_checks : [];
  if (declared.length === 0) return { ok: true, checks: [], delegated: [] };

  const artifact = await readStageArtifact({
    ...ctx,
    artifactName: ctx.artifactName ?? defaultArtifactName(ctx.profile?.stage_id),
  });

  const checks = [];
  const delegated = [];
  for (const id of declared) {
    if (DELEGATED_SEMANTIC_CHECKS.has(id)) {
      delegated.push(id);
      continue;
    }
    const evaluator = MECHANICAL_EVALUATORS[id];
    if (!evaluator) {
      // Honest by contract (#222 acceptance): a check that cannot be
      // evaluated FAILs with a clear reason — never silently passes.
      checks.push(fail(id, `unknown required check '${id}' — no mechanical evaluator exists; provide one, rename to a known check, or accept this FAIL as the honest verdict`));
      continue;
    }
    checks.push(await evaluator(ctx, artifact));
  }
  return { ok: checks.every((check) => check.status === 'PASS'), checks, delegated };
}

// Canonical artifact filename for a stage — kept here (data, not I/O) so the
// module stays import-light; mirrors CANONICAL_SDLC_STAGES in stages.js and
// is pinned against it by the tests.
const STAGE_ARTIFACTS = Object.freeze({
  '06-architecture': 'system_design.json',
  '07-code': 'code_report.json',
  '08-testing': 'test_report.json',
  '12-security-threat-model': 'threat_model.json',
  '13-compliance-checker': 'compliance_report.json',
});

function defaultArtifactName(stageId) {
  return STAGE_ARTIFACTS[stageId] ?? 'artifact.json';
}
