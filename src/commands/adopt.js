// owner: RStack developed by Richardson Gunde
//
// `rstack-agents adopt` (#148): bring an existing codebase into the governed
// pipeline. Scan → plan → (dry-run: show the plan and write nothing) →
// materialize an adoption run whose harvested stages are DONE-with-evidence,
// so `pipeline run` and feature work resume at real work.

import { readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { scanRepository, detectSpecialistGaps } from '../core/adopt/scan.js';
import { buildAdoptionPlan, materializeAdoption } from '../core/adopt/harvest.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function packagedAgentNames() {
  const agentsRoot = resolve(__dirname, '..', '..', 'agents');
  const names = [];
  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) await walk(join(dir, entry.name));
      else if (entry.isFile() && entry.name.endsWith('.md')) names.push(entry.name.replace(/\.md$/, ''));
    }
  }
  await walk(agentsRoot);
  return names;
}

function defaultRunId(now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  return `adopt-${stamp}`;
}

export async function adoptProject(projectRoot, { goal, runId, dryRun = false } = {}) {
  const scan = await scanRepository(projectRoot);
  const plan = buildAdoptionPlan(scan);
  const gaps = detectSpecialistGaps(scan.toolchain, await packagedAgentNames());
  const effectiveGoal = goal || `Adopt existing codebase at ${projectRoot}`;
  const effectiveRunId = runId || defaultRunId();

  if (dryRun) {
    return { dry_run: true, run_id: effectiveRunId, goal: effectiveGoal, scan_root: projectRoot, plan: plan.stages, harvested: plan.harvested, specialist_gaps: gaps };
  }

  const { state } = await materializeAdoption(projectRoot, { scan, plan, goal: effectiveGoal, runId: effectiveRunId, gaps });
  return {
    dry_run: false,
    run_id: effectiveRunId,
    goal: effectiveGoal,
    scan_root: projectRoot,
    plan: plan.stages,
    harvested: plan.harvested,
    specialist_gaps: gaps,
    stages_passed: state.pipeline.stages_passed,
    stages_total: state.pipeline.stages_total,
  };
}

export function formatAdoptionReport(report) {
  const lines = [];
  lines.push(report.dry_run
    ? `Adoption plan for ${report.scan_root} (dry run — nothing written):`
    : `Adopted ${report.scan_root} as run ${report.run_id}:`);
  for (const stage of report.plan) {
    const mark = stage.action === 'harvest' ? '+' : '-';
    const evidence = stage.action === 'harvest' && stage.evidence.length ? ` [${stage.evidence.slice(0, 3).join(', ')}${stage.evidence.length > 3 ? ', …' : ''}]` : '';
    lines.push(`  ${mark} ${stage.stage_id}: ${stage.action} — ${stage.reason}${evidence}`);
  }
  if (report.specialist_gaps.length) {
    lines.push(`Specialist gaps (detected stacks with no matching agent): ${report.specialist_gaps.map((gap) => `${gap.name} (${gap.kind})`).join(', ')}`);
  }
  if (report.dry_run) {
    lines.push('Next: run without --dry-run to materialize the adoption run.');
  } else {
    lines.push(`Harvested ${report.harvested.length} stages DONE-with-evidence (${report.stages_passed}/${report.stages_total} stages passed).`);
    lines.push(`Next: 'rstack-agents pipeline status' to inspect, then start feature work with sdlc_plan — the pipeline resumes at real work, not from scratch.`);
  }
  return lines.join('\n');
}
