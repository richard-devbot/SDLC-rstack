// owner: RStack developed by Richardson Gunde
//
// Drift CLI verb (#74), exposure-style: a structured run* function shared by
// --json and tests, plus a human formatter; bin owns exit codes. Default exit
// is warning-mode (non-zero only on errors) so CI can adopt it without
// breaking on cosmetic drift; --strict promotes warnings to failures.

import { scanProjectDrift, scanRunDrift } from '../core/harness/drift.js';

export async function runDrift(projectRoot, { runId, all = false } = {}) {
  if (all) return scanProjectDrift(projectRoot);
  return scanRunDrift(projectRoot, runId);
}

function formatRunDrift(result, lines) {
  lines.push(`  run ${result.run_id}: ${result.status} — ${result.summary.tasks} task(s), ${result.summary.requirements} requirement(s), ${result.summary.errors} error(s), ${result.summary.warnings} warning(s)`);
  for (const item of result.findings) {
    lines.push(`    ${item.severity === 'error' ? '✗' : '!'} [${item.type}] ${item.message}`);
    lines.push(`        ↳ ${item.remediation}  (${item.artifact})`);
  }
  if (!result.findings.length) lines.push('    No drift detected — requirements, tasks, evidence, and approvals line up.');
}

export function formatDrift(result) {
  const lines = [];
  if (Array.isArray(result.runs)) {
    lines.push(`drift: ${result.status} across ${result.run_count} run(s).`);
    for (const run of result.runs) formatRunDrift(run, lines);
    if (!result.run_count) lines.push('  No runs on disk yet.');
  } else {
    lines.push(`drift: ${result.status}.`);
    formatRunDrift(result, lines);
  }
  return lines.join('\n');
}
