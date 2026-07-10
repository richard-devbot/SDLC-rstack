// owner: RStack developed by Richardson Gunde
//
// environment_report.json shape validation (#237). The report is stage 00's
// core artifact and every downstream agent plans from it, but until now no
// validator existed anywhere — a malformed report degraded silently.
//
// Two-tier policy, honest about history:
//   - Legacy fields (tools, env_vars, fallbacks, pipeline_ready, status) are
//     WARN-only when missing: reports written before #237 must never start
//     failing retroactively.
//   - Intake-v2 fields (run_mode, run_mode_evidence, user_preferences,
//     setup_needs) are strictly typed WHEN PRESENT: a new field that is
//     malformed is an error-severity issue.
//
// Wiring is best-effort at sdlc_validate for stage 00 only (context-pressure
// precedent): issues land in validation.json as a WARN check that can never
// flip the validation verdict, and a throw here can never fail validation.

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const RUN_MODES = Object.freeze(['greenfield', 'brownfield', 'feature']);

const LEGACY_FIELDS = Object.freeze(['tools', 'env_vars', 'fallbacks', 'pipeline_ready', 'status']);
const SETUP_NEED_KINDS = Object.freeze(['ticketing', 'docs', 'notifications', 'deployment']);
// Secrets never belong in the report (kept in .env): user_preferences keys
// that look like credentials are rejected outright. env_vars is exempt — its
// keys legitimately NAME tokens while its values are presence booleans.
const SECRETISH_KEY = /token|secret|password|api[_-]?key|credential/i;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

// Returns [{ field, severity: 'warning'|'error', problem }]. Empty = clean.
export function validateEnvironmentReport(parsed) {
  if (!isPlainObject(parsed)) {
    return [{ field: null, severity: 'error', problem: 'environment_report.json must be a JSON object' }];
  }
  const issues = [];

  for (const field of LEGACY_FIELDS) {
    if (parsed[field] == null) {
      issues.push({ field, severity: 'warning', problem: 'missing legacy field — downstream agents expect it (warn-only, old reports never fail)' });
    }
  }

  if (parsed.run_mode != null && !RUN_MODES.includes(parsed.run_mode)) {
    issues.push({ field: 'run_mode', severity: 'error', problem: `must be one of ${RUN_MODES.join(' | ')}, got ${JSON.stringify(parsed.run_mode)}` });
  }

  if (parsed.run_mode_evidence != null && !isStringArray(parsed.run_mode_evidence)) {
    issues.push({ field: 'run_mode_evidence', severity: 'error', problem: 'must be an array of strings' });
  }

  if (parsed.user_preferences != null) {
    if (!isPlainObject(parsed.user_preferences)) {
      issues.push({ field: 'user_preferences', severity: 'error', problem: 'must be an object of preference-name -> string' });
    } else {
      for (const [key, value] of Object.entries(parsed.user_preferences)) {
        if (SECRETISH_KEY.test(key)) {
          issues.push({ field: `user_preferences.${key}`, severity: 'error', problem: 'credential-shaped key — secrets belong in .env, never in environment_report.json; remove this field' });
        } else if (typeof value !== 'string') {
          issues.push({ field: `user_preferences.${key}`, severity: 'error', problem: `must be a string, got ${JSON.stringify(value)}` });
        }
      }
    }
  }

  if (parsed.setup_needs != null) {
    if (!Array.isArray(parsed.setup_needs)) {
      issues.push({ field: 'setup_needs', severity: 'error', problem: 'must be an array of { kind, platform, required_vars[], satisfied }' });
    } else {
      parsed.setup_needs.forEach((need, index) => {
        const field = `setup_needs[${index}]`;
        if (!isPlainObject(need)) {
          issues.push({ field, severity: 'error', problem: 'must be an object { kind, platform, required_vars[], satisfied }' });
          return;
        }
        if (typeof need.kind !== 'string' || !need.kind) {
          issues.push({ field: `${field}.kind`, severity: 'error', problem: `must be a non-empty string (expected one of ${SETUP_NEED_KINDS.join(' | ')})` });
        } else if (!SETUP_NEED_KINDS.includes(need.kind)) {
          issues.push({ field: `${field}.kind`, severity: 'error', problem: `unknown kind ${JSON.stringify(need.kind)} — expected ${SETUP_NEED_KINDS.join(' | ')}` });
        }
        if (typeof need.platform !== 'string' || !need.platform) {
          issues.push({ field: `${field}.platform`, severity: 'error', problem: 'must be a non-empty string' });
        }
        if (!isStringArray(need.required_vars)) {
          issues.push({ field: `${field}.required_vars`, severity: 'error', problem: 'must be an array of env var NAMES (never values)' });
        }
        if (typeof need.satisfied !== 'boolean') {
          issues.push({ field: `${field}.satisfied`, severity: 'error', problem: `must be a boolean, got ${JSON.stringify(need.satisfied)}` });
        }
      });
    }
  }

  return issues;
}

const REPORT_PATHS = Object.freeze([
  'artifacts/stages/00-environment/environment_report.json',
  'artifacts/environment_report.json',
]);

// Produce ONE validation.json check for the run's environment report.
// Non-fatal by construction: status is PASS or WARN, never FAIL — only the
// caller's explicit FAILs flip a validation verdict, and WARN checks are not
// collected into issues[]. Missing/malformed reports WARN with the evidence
// a human needs to fix them.
export async function environmentReportCheck(runDir) {
  for (const relPath of REPORT_PATHS) {
    const filePath = join(runDir, ...relPath.split('/'));
    if (!existsSync(filePath)) continue;
    let parsed;
    try {
      parsed = JSON.parse(await readFile(filePath, 'utf8'));
    } catch (error) {
      return { name: 'environment_report_shape', status: 'WARN', evidence: `${relPath}: malformed JSON (${error.message}) — non-fatal, fix the report` };
    }
    const issues = validateEnvironmentReport(parsed);
    if (issues.length === 0) {
      return { name: 'environment_report_shape', status: 'PASS', evidence: relPath };
    }
    const detail = issues.slice(0, 6).map((issue) => `${issue.field ?? 'report'}: ${issue.problem}`).join('; ');
    const more = issues.length > 6 ? ` (+${issues.length - 6} more)` : '';
    return { name: 'environment_report_shape', status: 'WARN', evidence: `${relPath}: ${issues.length} issue(s) — ${detail}${more}` };
  }
  return { name: 'environment_report_shape', status: 'WARN', evidence: `no environment_report.json found at ${REPORT_PATHS.join(' or ')}` };
}
