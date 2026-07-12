// owner: RStack developed by Richardson Gunde
//
// Governance packs (#78): profiles were already RStack's posture dial —
// packs make the posture CONCRETE and inspectable. Each pack is a named
// bundle of governance capability (readiness gates, cross-harness review,
// attestations, drift detection, the untrusted PR gate, compliance mappings)
// with a declared enforcement level, defined by a pack.json under
// <package>/packs/<name>/. Profiles map to default pack sets; a project can
// override the set via `enabled_packs` in .rstack/rstack.config.json.
//
// Packs are DECLARATIVE metadata over enforcement that lives in the harness
// (#72 review policy, #73 attestations, #74 drift, #75 PR gate) — enabling a
// pack records intent and surfaces posture in the Business Hub; it does not
// duplicate the enforcement code.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const PACKS_DIR = join(PACKAGE_ROOT, 'packs');

export const PACK_ENFORCEMENT_LEVELS = Object.freeze(['advisory', 'warning', 'blocking']);

// Profile → default pack set (#78 acceptance mapping): lean-mvp keeps the
// advisory floor; business-flex adds warning-level independence + drift;
// enterprise-webapp turns on the full enforcement stack + compliance mappings.
export const PROFILE_PACK_DEFAULTS = Object.freeze({
  'lean-mvp': Object.freeze(['dor-basic']),
  'business-flex': Object.freeze(['dor-basic', 'cross-harness-review', 'drift-detection']),
  'enterprise-webapp': Object.freeze([
    'dor-enterprise',
    'cross-harness-review',
    'attestations',
    'drift-detection',
    'untrusted-pr-gate',
    'compliance-nist-ai-rmf',
    'compliance-iso-42001',
  ]),
});

export function packsForProfile(name = 'business-flex') {
  return [...(PROFILE_PACK_DEFAULTS[name] ?? PROFILE_PACK_DEFAULTS['business-flex'])];
}

const PACK_REQUIRED_FIELDS = ['name', 'title', 'description', 'enforcement', 'provides'];

// Same {field, problem} issue shape as config-validation.js.
export function validatePackMetadata(parsed) {
  const issues = [];
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return [{ field: null, problem: 'pack.json must be a JSON object' }];
  }
  for (const field of PACK_REQUIRED_FIELDS) {
    if (field === 'provides') continue;
    if (typeof parsed[field] !== 'string' || !parsed[field].trim()) {
      issues.push({ field, problem: 'must be a non-empty string' });
    }
  }
  if (parsed.name != null && !/^[a-z0-9][a-z0-9-]*$/.test(String(parsed.name))) {
    issues.push({ field: 'name', problem: 'must be a kebab-case slug matching the pack directory' });
  }
  if (parsed.enforcement != null && !PACK_ENFORCEMENT_LEVELS.includes(parsed.enforcement)) {
    issues.push({ field: 'enforcement', problem: `must be one of ${PACK_ENFORCEMENT_LEVELS.join(' | ')}` });
  }
  if (!Array.isArray(parsed.provides) || !parsed.provides.length
    || parsed.provides.some((item) => typeof item !== 'string' || !item.trim())) {
    issues.push({ field: 'provides', problem: 'must be a non-empty array of capability strings' });
  }
  return issues;
}

// Read every packaged pack. Malformed pack.json files are returned with their
// issues named, never silently dropped — the pack registry is itself audited.
export function listPacks({ packsDir = PACKS_DIR } = {}) {
  if (!existsSync(packsDir)) return [];
  const packs = [];
  for (const entry of readdirSync(packsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const packPath = join(packsDir, entry.name, 'pack.json');
    if (!existsSync(packPath)) continue;
    let parsed = null;
    let issues = [];
    try {
      parsed = JSON.parse(readFileSync(packPath, 'utf8'));
      issues = validatePackMetadata(parsed);
      if (!issues.length && parsed.name !== entry.name) {
        issues.push({ field: 'name', problem: `pack.json name "${parsed.name}" does not match directory "${entry.name}"` });
      }
    } catch (error) {
      issues = [{ field: null, problem: `malformed JSON: ${error.message}` }];
    }
    packs.push({ dir: entry.name, ...(parsed ?? {}), issues });
  }
  return packs.sort((a, b) => a.dir.localeCompare(b.dir));
}

export function knownPackNames() {
  return listPacks().map((pack) => pack.dir);
}

// Effective enabled packs for a project: explicit `enabled_packs` in
// rstack.config.json wins; otherwise the profile default set.
export function enabledPacksForConfig(config) {
  if (Array.isArray(config?.enabled_packs)
    && config.enabled_packs.every((name) => typeof name === 'string' && name.trim())) {
    return config.enabled_packs.map((name) => name.trim());
  }
  return packsForProfile(config?.profile ?? 'business-flex');
}

// Config-validation hook for the `enabled_packs` block (rules live next to
// the registry they check, context-pressure precedent).
export function validateEnabledPacksConfig(parsed) {
  const issues = [];
  if (!Array.isArray(parsed)) {
    return [{ field: 'enabled_packs', problem: 'must be an array of pack names — the profile default set applies' }];
  }
  const known = knownPackNames();
  for (const name of parsed) {
    if (typeof name !== 'string' || !name.trim()) {
      issues.push({ field: 'enabled_packs', problem: `pack names must be non-empty strings, got ${JSON.stringify(name)}` });
    } else if (known.length && !known.includes(name.trim())) {
      issues.push({ field: 'enabled_packs', problem: `unknown pack "${name}" — expected one of ${known.join(' | ')}; this entry is ignored` });
    }
  }
  return issues;
}
