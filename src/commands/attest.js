// owner: RStack developed by Richardson Gunde
//
// Attestation CLI verbs (#73), exposure-style: each verb pairs a run* function
// returning a structured result (shared by --json and tests) with a format*
// companion; bin/rstack-agents.js owns exit codes. Signing key comes ONLY from
// the RSTACK_ATTESTATION_KEY environment variable — never a CLI argument
// (secrets in argv leak into shell history and process lists).

import { attestRun, verifyRunAttestations } from '../core/harness/attestations.js';

export async function runAttest(projectRoot, { runId } = {}) {
  return attestRun(projectRoot, runId);
}

export function formatAttest(result) {
  const lines = [
    `attest (run ${result.run_id}): ${result.written.length} envelope(s) written`
    + `${result.signed ? ' [local-dev-signature]' : ' [unsigned — set RSTACK_ATTESTATION_KEY to sign]'}`
    + `${result.commit ? `, commit ${result.commit.slice(0, 12)}` : ', no git commit detected'}`,
  ];
  for (const item of result.written) {
    lines.push(`  ✓ ${item.kind}${item.task_id ? ` ${item.task_id}` : ''}`);
  }
  for (const item of result.skipped) {
    lines.push(`  - skipped ${item.kind}${item.task_id ? ` ${item.task_id}` : ''}: ${item.reason}`);
  }
  return lines.join('\n');
}

export async function runVerifyAttestations(projectRoot, { runId, requireSignature = false } = {}) {
  return verifyRunAttestations(projectRoot, runId, { requireSignature });
}

export function formatVerifyAttestations(result) {
  const lines = [`verify-attestations (run ${result.run_id}): ${result.valid}/${result.total} envelope(s) valid.`];
  for (const finding of result.findings) {
    if (finding.valid) {
      lines.push(`  ✓ ${finding.file}`);
      continue;
    }
    lines.push(`  ✗ ${finding.file}`);
    for (const issue of finding.issues) lines.push(`      - [${issue.type}] ${issue.message}`);
  }
  for (const item of result.missing) {
    lines.push(`  ! missing: ${item.task_id} ${item.kind} — ${item.reason}`);
  }
  if (result.total === 0 && !result.missing.length) {
    lines.push('  No attestations on disk yet — run `rstack-agents attest` after a validated task.');
  }
  return lines.join('\n');
}
