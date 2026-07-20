// owner: RStack developed by Richardson Gunde
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getCanonicalStage } from './stages.js';

// Fallback profile for stages without a registered validator. Minimal checks:
// the generic contract gate already covers these in sdlc_validate.
export const GENERIC_VALIDATOR_PROFILE = Object.freeze({
  stage_id: null,
  validator: 'validator.generic',
  model_hint: 'haiku',
  read_only: true,
  priority: 0,
  required_checks: Object.freeze([
    'builder_contract_complete',
    'files_modified_exist',
  ]),
  output_contract_fields: Object.freeze([]),
});

// Critical stages get stage-specific validators. `priority` decides which
// profile wins when one task targets several registered stages (security and
// compliance outrank code, code outranks testing and architecture — the
// riskier verdict must own the validation). `model_hint` is advisory only:
// the host framework picks the model; mechanical checks suggest a cheap one.
export const DEFAULT_VALIDATOR_REGISTRY = Object.freeze({
  // #421: the environment report is the ground truth every downstream stage
  // plans from — run_mode (greenfield/brownfield/feature) decides how agents
  // treat the repo. Previously its only check was WARN-only shape validation
  // that could never fail a run; an empty or mode-less report now FAILs the
  // stage. The legacy WARN shape check stays for the softer fields.
  '00-environment': Object.freeze({
    stage_id: '00-environment',
    validator: 'validator.00-environment',
    model_hint: 'haiku',
    read_only: true,
    priority: 25,
    required_checks: Object.freeze([
      'environment_report_present',
      'environment_run_mode_valid',
    ]),
    output_contract_fields: Object.freeze(['run_mode']),
  }),
  // #410: the transcript stage previously had NO validation — a missing or
  // goalless transcript.json passed silently and stage 02 built requirements
  // from nothing. A low priority keeps it from ever shadowing a riskier stage
  // (it is single-stage per task since #404, so priority is academic here).
  '01-transcript': Object.freeze({
    stage_id: '01-transcript',
    validator: 'validator.01-transcript',
    model_hint: 'haiku',
    read_only: true,
    priority: 20,
    required_checks: Object.freeze([
      'transcript_present',
      'transcript_has_goals',
    ]),
    output_contract_fields: Object.freeze(['goals']),
  }),
  '06-architecture': Object.freeze({
    stage_id: '06-architecture',
    validator: 'validator.06-architecture',
    model_hint: 'sonnet',
    read_only: true,
    priority: 60,
    required_checks: Object.freeze([
      'architecture_artifact_present',
      'components_and_interfaces_defined',
      'tradeoffs_documented',
      'security_boundaries_identified',
    ]),
    output_contract_fields: Object.freeze(['components', 'interfaces', 'data_model', 'tradeoffs']),
  }),
  '07-code': Object.freeze({
    stage_id: '07-code',
    validator: 'validator.07-code',
    model_hint: 'haiku',
    read_only: true,
    priority: 80,
    required_checks: Object.freeze([
      'builder_contract_complete',
      'files_modified_exist',
      // #406: the code stage must actually change a file — empty files_modified
      // is a no-op that files_modified_exist would otherwise pass vacuously.
      'files_modified_nonempty',
      'tests_run_evidence',
      'no_placeholder_stubs',
    ]),
    output_contract_fields: Object.freeze(['files_modified', 'tests_run', 'summary']),
  }),
  '08-testing': Object.freeze({
    stage_id: '08-testing',
    validator: 'validator.08-testing',
    model_hint: 'haiku',
    read_only: true,
    priority: 70,
    required_checks: Object.freeze([
      'test_report_exists',
      'test_results_counted',
      'failures_have_root_cause',
      'no_silent_skips',
    ]),
    output_contract_fields: Object.freeze(['total', 'passed', 'failed', 'skipped']),
  }),
  '12-security-threat-model': Object.freeze({
    stage_id: '12-security-threat-model',
    validator: 'validator.12-security-threat-model',
    model_hint: 'sonnet',
    read_only: true,
    priority: 100,
    required_checks: Object.freeze([
      'threat_model_artifact_present',
      'stride_categories_covered',
      'high_risks_have_mitigation',
      'no_secrets_introduced',
    ]),
    output_contract_fields: Object.freeze(['threats', 'mitigations', 'risk_ratings']),
  }),
  '13-compliance-checker': Object.freeze({
    stage_id: '13-compliance-checker',
    validator: 'validator.13-compliance-checker',
    model_hint: 'sonnet',
    read_only: true,
    priority: 90,
    required_checks: Object.freeze([
      'compliance_report_present',
      'frameworks_enumerated',
      'gaps_have_remediation',
    ]),
    output_contract_fields: Object.freeze(['frameworks', 'gaps', 'remediation_plan']),
  }),
});

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// Deep merge for registry entries: nested objects merge recursively; arrays
// and scalars are replaced wholesale (a project overriding required_checks
// owns the full list for that stage).
function mergeEntry(base, override) {
  const merged = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (isPlainObject(value) && isPlainObject(base[key])) merged[key] = mergeEntry(base[key], value);
    else merged[key] = value;
  }
  return merged;
}

function normalizeEntry(stageId, entry, registryPath) {
  const normalized = { ...entry, stage_id: stageId };
  // Validators are read-only by design — a project override must not be able
  // to silently grant a validator write access.
  if (normalized.read_only !== true) {
    console.error(`[rstack] ${registryPath}: validator for ${stageId} cannot set read_only=false; forcing read_only=true.`);
    normalized.read_only = true;
  }
  return normalized;
}

export function resolveValidatorProfile(stageIds, registry = DEFAULT_VALIDATOR_REGISTRY) {
  const targets = Array.isArray(stageIds) ? stageIds.filter(Boolean) : [];
  let selected = null;
  for (const stageId of targets) {
    const entry = registry?.[stageId];
    if (!entry) continue;
    if (!selected || Number(entry.priority ?? 0) > Number(selected.priority ?? 0)) selected = entry;
  }
  return selected ?? GENERIC_VALIDATOR_PROFILE;
}

export async function loadValidatorRegistry(projectRoot) {
  const registryPath = join(projectRoot, '.rstack', 'validators', 'registry.json');
  if (!existsSync(registryPath)) return DEFAULT_VALIDATOR_REGISTRY;
  let overrides;
  try {
    overrides = JSON.parse(await readFile(registryPath, 'utf8'));
  } catch (error) {
    // A malformed override file must not silently change which validator
    // runs; unexpected I/O failures (EACCES, EIO) must surface, not
    // masquerade as "no overrides" (mirrors loadProjectGuardrails).
    if (error instanceof SyntaxError) {
      console.error(`[rstack] Ignoring malformed ${registryPath}: ${error.message}. Default validator registry applies.`);
      return DEFAULT_VALIDATOR_REGISTRY;
    }
    throw error;
  }
  if (!isPlainObject(overrides)) {
    console.error(`[rstack] Ignoring ${registryPath}: expected { "<stage_id>": { ...entry } }. Default validator registry applies.`);
    return DEFAULT_VALIDATOR_REGISTRY;
  }

  const merged = { ...DEFAULT_VALIDATOR_REGISTRY };
  for (const [stageId, override] of Object.entries(overrides)) {
    if (!isPlainObject(override)) {
      console.error(`[rstack] ${registryPath}: entry for ${stageId} is not an object; keeping defaults for that stage.`);
      continue;
    }
    if (!getCanonicalStage(stageId)) {
      console.error(`[rstack] ${registryPath}: ${stageId} is not a canonical SDLC stage; entry ignored.`);
      continue;
    }
    // Unregistered canonical stages can be promoted by a project: the
    // override is layered over the generic profile so partial entries stay valid.
    const base = merged[stageId] ?? { ...GENERIC_VALIDATOR_PROFILE, stage_id: stageId, priority: 10 };
    merged[stageId] = normalizeEntry(stageId, mergeEntry(base, override), registryPath);
  }
  return merged;
}

// #222: record WHICH validator owns this task's stage and WHICH
// required_checks remain delegated to it. Since the mechanical enforcement
// landed (required-checks.js), most declared checks contribute real PASS/FAIL
// entries at validate time — this record names only the semantic REMAINDER
// (specialist judgment, epic #72) when the caller passes it; with no argument
// it lists the full declared set (back-compat for callers that do not run the
// mechanical evaluation). Status PASS means only "the profile was resolved
// and its ownership recorded" — never that delegated checks passed.
export function validatorDelegationCheck(profile, delegatedChecks) {
  const declared = Array.isArray(profile?.required_checks) ? profile.required_checks : [];
  const delegated = Array.isArray(delegatedChecks) ? delegatedChecks : declared;
  const enforcedCount = declared.length - delegated.length;
  const enforcedNote = Array.isArray(delegatedChecks) && enforcedCount > 0
    ? `${enforcedCount} required check(s) enforced mechanically above; `
    : '';
  return {
    name: 'validator_profile_selected',
    status: 'PASS',
    evidence: `${profile?.validator ?? GENERIC_VALIDATOR_PROFILE.validator} owns this stage; ${enforcedNote}delegated to specialist judgment (epic #72): ${delegated.join(', ') || 'none'}`,
  };
}
