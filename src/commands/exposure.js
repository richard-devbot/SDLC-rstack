// owner: RStack developed by Richardson Gunde
//
// Exposure CLI verbs (#229): thin, read-oriented wrappers that make harness
// capability reachable from the terminal. Each verb delegates to an EXISTING,
// already-tested function — this module adds no new behavior, only a CLI
// surface + a human formatter:
//
//   config validate          → validateProjectConfigs   (config-validation.js)
//   pipeline rollback <stage> → rollbackToCheckpoint     (checkpoints.js)
//   pipeline checkpoint-status → verifyStageCheckpoint   (checkpoints.js, deep)
//   approvals audit [run-id]  → auditRunApprovals        (approval-audit.js)
//   memory inspect            → runMemoryDiagnostics     (memory/diagnostics.js)
//
// Every function returns a structured result (so `--json` and tests use the
// same shape) plus a companion formatter; bin/rstack-agents.js owns exit codes.

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { resolveRunId, runDirectory } from '../core/harness/runs.js';
import { validateProjectConfigs } from '../core/harness/config-validation.js';
import { rollbackToCheckpoint, verifyStageCheckpoint } from '../core/harness/checkpoints.js';
import { auditRunApprovals } from '../core/harness/approval-audit.js';
import { CANONICAL_SDLC_STAGES } from '../core/harness/stages.js';
import { runMemoryDiagnostics } from '../memory/diagnostics.js';

// ── config validate ──────────────────────────────────────────────────────────

export async function runConfigValidate(projectRoot) {
  const problems = await validateProjectConfigs(projectRoot, { warn: false });
  return { ok: problems.length === 0, problem_count: problems.length, problems };
}

export function formatConfigValidate(result) {
  if (result.ok) return 'config validate: all .rstack/*.json config files are valid.';
  const lines = [`config validate: ${result.problem_count} issue(s) found:`];
  for (const p of result.problems) {
    lines.push(`  ✗ ${p.file}${p.field ? ` (${p.field})` : ''}: ${p.problem}`);
  }
  return lines.join('\n');
}

// ── pipeline rollback <stage> ─────────────────────────────────────────────────

export async function runPipelineRollback(projectRoot, { runId, stageId } = {}) {
  const selected = await resolveRunId(projectRoot, runId);
  const runDir = runDirectory(projectRoot, selected);
  const result = await rollbackToCheckpoint(runDir, stageId);
  return { run_id: selected, stage_id: stageId, ...result };
}

export function formatRollback(r) {
  const head = `pipeline rollback ${r.stage_id} (run ${r.run_id}): ${r.status}`;
  return r.detail ? `${head}\n  ${r.detail}` : head;
}

// ── pipeline checkpoint-status ────────────────────────────────────────────────

export async function runCheckpointStatus(projectRoot, { runId } = {}) {
  const selected = await resolveRunId(projectRoot, runId);
  const runDir = runDirectory(projectRoot, selected);
  // Deep verification (#203): sha-256 each checkpoint file against its manifest,
  // matching what `pipeline rollback` actually enforces. Only stages that have a
  // checkpoint on disk are listed — the rest short-circuit on "no_checkpoint".
  const stages = [];
  for (const stage of CANONICAL_SDLC_STAGES) {
    const v = verifyStageCheckpoint(runDir, stage.id, { deep: true });
    if (v.reason === 'no_checkpoint') continue;
    stages.push({ stage_id: stage.id, restorable: v.restorable, verified: v.verified, reason: v.reason ?? null });
  }
  return { run_id: selected, checkpoints: stages.length, stages };
}

export function formatCheckpointStatus(result) {
  if (result.checkpoints === 0) {
    return `pipeline checkpoint-status (run ${result.run_id}): no stage checkpoints recorded.`;
  }
  const lines = [`pipeline checkpoint-status (run ${result.run_id}): ${result.checkpoints} checkpoint(s):`];
  for (const s of result.stages) {
    const mark = s.restorable ? (s.verified ? '✓ restorable' : '✓ restorable (legacy, unverified)') : '✗ CORRUPT';
    lines.push(`  ${mark}  ${s.stage_id}${s.reason ? ` — ${s.reason}` : ''}`);
  }
  return lines.join('\n');
}

// ── approvals audit [run-id] ──────────────────────────────────────────────────

export async function runApprovalsAudit(projectRoot, { runId } = {}) {
  const selected = await resolveRunId(projectRoot, runId);
  const runDir = runDirectory(projectRoot, selected);
  let raw = [];
  const path = join(runDir, 'approvals.json');
  if (existsSync(path)) {
    try {
      const parsed = JSON.parse(await readFile(path, 'utf8'));
      if (Array.isArray(parsed)) raw = parsed;
    } catch { /* unreadable/corrupt → audited as an empty set below */ }
  }
  const audit = auditRunApprovals(raw, { runId: selected, runDir });
  return {
    run_id: selected,
    ok: audit.ok,
    total: raw.length,
    valid: audit.valid.length,
    rejected: audit.rejected.map((r) => ({
      id: (r.record && r.record.id) ?? null,
      artifact: (r.record && r.record.artifact) ?? null,
      status: (r.record && r.record.status) ?? null,
      reasons: (r.issues ?? []).map((i) => `${i.name}: ${i.evidence}`),
    })),
  };
}

export function formatApprovalsAudit(result) {
  const lines = [`approvals audit (run ${result.run_id}): ${result.total} record(s), ${result.valid} valid, ${result.rejected.length} rejected.`];
  for (const r of result.rejected) {
    lines.push(`  ✗ ${r.artifact ?? '(no artifact)'} [${r.status ?? '?'}] id=${r.id ?? '?'}`);
    for (const reason of r.reasons) lines.push(`      - ${reason}`);
  }
  if (result.rejected.length === 0) lines.push('  All records passed the consistency audit.');
  return lines.join('\n');
}

// ── memory inspect ────────────────────────────────────────────────────────────

export async function runMemoryInspect(projectRoot, { runId } = {}) {
  return runMemoryDiagnostics(projectRoot, runId);
}

export function formatMemoryInspect(d) {
  const lines = [
    `memory inspect: ${d.episode_count} episode(s), ${d.store_size_kb}KB`
    + `${d.recall_hit_rate != null ? `, recall hit-rate ${d.recall_hit_rate}% (${d.total_recall_queries} queries)` : ''}`,
    `  health: ${d.healthy ? 'OK' : 'ISSUES'}`
    + `${d.signature_failures.length ? `, ${d.signature_failures.length} signature failure(s)` : ''}`
    + `${d.duplicate_episodes.length ? `, ${d.duplicate_episodes.length} duplicate id(s)` : ''}`
    + `${d.stale_candidates.length ? `, ${d.stale_candidates.length} stale` : ''}`,
  ];
  for (const item of d.diagnostics.slice(0, 20)) {
    lines.push(`  [${item.severity}] ${item.type}: ${item.message}`);
  }
  if (d.last_compaction) lines.push(`  last compaction: ${d.last_compaction}`);
  return lines.join('\n');
}
