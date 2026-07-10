// owner: RStack developed by Richardson Gunde
//
// Brownfield stage harvesters (#148): reverse-populate pipeline stages from
// what an existing codebase already proves. Two hard rules:
//   1. Evidence or skip — a stage is only harvested when the scan found real
//      artifacts to point at; everything else is skipped with a stated reason.
//   2. Additive only — adoption creates a NEW run and never touches existing
//      runs, files, or state.

import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { appendEvidenceEvent } from '../harness/evidence.js';
import { MANIFEST_SCHEMA_VERSION } from '../harness/migrations.js';
import { writePipelineState } from '../harness/pipeline-state.js';
import { prepareRunState, stageArtifactPath, updateRunMetrics } from '../harness/run-state.js';
import { runDirectory, writeSessionPin } from '../harness/runs.js';
import { writeJsonAtomic } from '../harness/safe-write.js';

const ADOPTION_SOURCE = 'brownfield-adoption';

// Pure planner: which stages can be harvested from this scan, which are
// skipped and why. Shared verbatim by --dry-run and the live command.
export function buildAdoptionPlan(scan) {
  const hasToolchain = scan.toolchain.languages.length > 0;
  const hasDocs = scan.docs.length > 0;
  const hasTests = scan.tests.testDirs.length > 0 || scan.tests.configs.length > 0;
  const hasDeploy = scan.ci.length > 0 || scan.deploy.length > 0;

  const stages = [
    {
      stage_id: '00-environment',
      action: 'harvest',
      artifact: 'environment_report.json',
      evidence: scan.toolchain.languages.map((entry) => entry.evidence),
      reason: hasToolchain ? 'toolchain detected from manifest files' : 'baseline environment report (no manifests found)',
    },
    { stage_id: '01-transcript', action: 'skip', reason: 'no meeting transcript exists for an already-built system' },
    {
      stage_id: '02-requirements',
      action: hasDocs ? 'harvest' : 'skip',
      artifact: 'requirement_spec.json',
      evidence: scan.docs,
      reason: hasDocs
        ? 'existing docs recorded as the requirements baseline — feature-mode requirements are specced per change'
        : 'no docs found to anchor a requirements baseline',
    },
    {
      stage_id: '03-documentation',
      action: hasDocs ? 'harvest' : 'skip',
      artifact: 'documentation.json',
      evidence: scan.docs,
      reason: hasDocs ? 'existing documentation indexed' : 'no documentation found',
    },
    { stage_id: '04-planning', action: 'skip', reason: 'plans belong to new work — run sdlc_plan (or feature mode) after adoption' },
    { stage_id: '05-jira', action: 'skip', reason: 'tickets belong to new work' },
    {
      stage_id: '06-architecture',
      action: hasToolchain ? 'harvest' : 'skip',
      artifact: 'system_design.json',
      evidence: [...scan.toolchain.languages.map((entry) => entry.evidence), ...scan.topLevelDirs.map((dir) => `${dir}/`)],
      reason: hasToolchain ? 'architecture baseline inferred from manifests and repo structure' : 'no toolchain signals to infer architecture from',
    },
    {
      stage_id: '07-code',
      action: hasToolchain ? 'harvest' : 'skip',
      artifact: 'code_report.json',
      evidence: scan.topLevelDirs.map((dir) => `${dir}/`),
      reason: hasToolchain ? 'the existing codebase is the code baseline' : 'no codebase signals detected',
    },
    {
      stage_id: '08-testing',
      action: hasTests ? 'harvest' : 'skip',
      artifact: 'test_report.json',
      evidence: [...scan.tests.testDirs.map((entry) => `${entry.dir}/`), ...scan.tests.configs],
      reason: hasTests
        ? 'existing test suite recorded as baseline — tests were detected, NOT executed, during adoption'
        : 'no test suite found — a real gap worth surfacing, not papering over',
    },
    {
      stage_id: '09-deployment',
      action: hasDeploy ? 'harvest' : 'skip',
      artifact: 'deployment_report.json',
      evidence: [...scan.ci, ...scan.deploy],
      reason: hasDeploy ? 'CI/CD and deploy configuration recorded' : 'no CI/CD or deploy configuration found',
    },
    { stage_id: '10-summary', action: 'skip', reason: 'summaries describe completed pipeline work' },
    { stage_id: '11-feedback-loop', action: 'skip', reason: 'the consistency review runs after pipeline work' },
    { stage_id: '12-security-threat-model', action: 'skip', reason: 'threat modeling should be done deliberately, not inferred' },
    { stage_id: '13-compliance-checker', action: 'skip', reason: 'compliance posture must be asserted by a human-reviewed run' },
    { stage_id: '14-cost-estimation', action: 'skip', reason: 'cost estimates belong to new work' },
  ];

  return { stages, harvested: stages.filter((stage) => stage.action === 'harvest').map((stage) => stage.stage_id) };
}

function stageArtifactBody(stageId, scan) {
  const base = { source: ADOPTION_SOURCE, status: 'PASS' };
  switch (stageId) {
    case '00-environment':
      return {
        ...base,
        tools: Object.fromEntries(scan.toolchain.languages.map((entry) => [entry.language, true])),
        frameworks: scan.toolchain.frameworks.map((entry) => entry.framework),
        pipeline_ready: true,
      };
    case '02-requirements':
      return {
        ...base,
        note: 'Baseline requirements live in the existing docs below. Per-change requirements are specced when feature work starts (spec only the change).',
        requirement_sources: scan.docs,
        functional: [],
      };
    case '03-documentation':
      return { ...base, docs: scan.docs };
    case '06-architecture':
      return {
        ...base,
        tech_stack: {
          languages: scan.toolchain.languages.map((entry) => entry.language),
          frameworks: scan.toolchain.frameworks.map((entry) => entry.framework),
        },
        structure: scan.topLevelDirs,
        note: 'Inferred baseline — refine with a deliberate 06-architecture run before large changes.',
      };
    case '07-code':
      return { ...base, existing_codebase: true, top_level_dirs: scan.topLevelDirs, test_command: scan.tests.testCommand };
    case '08-testing':
      return {
        ...base,
        baseline: true,
        executed: false,
        note: 'Tests detected but NOT executed during adoption. Run them before trusting this baseline.',
        test_dirs: scan.tests.testDirs,
        configs: scan.tests.configs,
        test_command: scan.tests.testCommand,
      };
    case '09-deployment':
      return { ...base, ci_pipelines: scan.ci, deploy_configs: scan.deploy };
    default:
      return base;
  }
}

export async function materializeAdoption(projectRoot, { scan, plan, goal, runId, gaps = [], now = new Date().toISOString() }) {
  const runDir = runDirectory(projectRoot, runId);
  if (existsSync(runDir)) {
    throw new Error(`Run ${runId} already exists — adoption never overwrites. Pick another run id.`);
  }
  await prepareRunState(runDir);

  const harvested = plan.stages.filter((stage) => stage.action === 'harvest');
  const events = [
    { ts: now, type: 'run_started', goal, mode: 'adopt', source: ADOPTION_SOURCE },
  ];
  const stageStatus = {};
  const tasks = [];

  for (const stage of harvested) {
    const body = { ...stageArtifactBody(stage.stage_id, scan), adopted_at: now, evidence: stage.evidence };
    await writeJsonAtomic(stageArtifactPath(runDir, stage.stage_id, stage.artifact), body);
    stageStatus[stage.stage_id] = 'PASS';
    events.push({ ts: now, type: 'adoption_harvested', stage_id: stage.stage_id, evidence_count: stage.evidence.length });
    events.push({ ts: now, type: 'stage_completed', stage_id: stage.stage_id, task_id: `adopt-${stage.stage_id}`, elapsed_ms: 0 });
    tasks.push({
      id: `adopt-${stage.stage_id}`,
      title: `Adopted baseline: ${stage.stage_id}`,
      status: 'PASS',
      stage_artifacts: [{ stage_id: stage.stage_id, artifact_path: `.rstack/runs/${runId}/artifacts/stages/${stage.stage_id}/${stage.artifact}` }],
    });
    await appendEvidenceEvent(runDir, {
      task_id: `adopt-${stage.stage_id}`,
      stage_id: stage.stage_id,
      kind: 'adoption',
      status: 'INFO',
      evidence: stage.evidence.slice(0, 10).join(', ') || 'baseline',
    });
  }

  const manifest = {
    schema_version: MANIFEST_SCHEMA_VERSION,
    run_id: runId,
    created_at: now,
    updated_at: now,
    goal,
    mode: 'adopt',
    status: 'IN_PROGRESS',
    project_root: projectRoot,
    adopted: true,
  };
  await writeJsonAtomic(join(runDir, 'manifest.json'), manifest);
  await writeJsonAtomic(join(runDir, 'tasks.json'), { run_id: runId, mode: 'adopt', tasks });
  await writeJsonAtomic(join(runDir, 'approvals.json'), []);
  await writeFile(join(runDir, 'events.jsonl'), events.map((event) => JSON.stringify(event)).join('\n') + '\n');
  await updateRunMetrics(runDir, { stage_status: stageStatus });
  await writeJsonAtomic(join(runDir, 'artifacts', 'adoption_report.json'), {
    source: ADOPTION_SOURCE,
    adopted_at: now,
    plan: plan.stages,
    specialist_gaps: gaps,
    scan_summary: {
      languages: scan.toolchain.languages,
      frameworks: scan.toolchain.frameworks,
      docs: scan.docs.length,
      test_dirs: scan.tests.testDirs.length,
      ci_pipelines: scan.ci.length,
      deploy_configs: scan.deploy.length,
    },
  });
  // Ensure the memory dir exists for downstream tools that expect it.
  await mkdir(join(runDir, 'tasks'), { recursive: true });

  // Session pin (#289): adopt creates a run outside sdlc_start — without
  // updating the pin, a later no-run_id tool call would target whatever run
  // a previous session pinned instead of the run just adopted.
  await writeSessionPin(projectRoot, runId);
  const { state } = await writePipelineState(projectRoot, runId);
  return { runDir, manifest, state };
}
