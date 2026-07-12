// owner: RStack developed by Richardson Gunde
//
// Canonical dashboard fixtures (#96): deterministic, secret-free project
// trees covering every product-truth state the Business Hub must render
// honestly. Fixed timestamps and run ids — no Date.now(), no randomness —
// so two clean runs of the suite see byte-identical state. These builders
// are the canonical examples of what each .rstack file looks like; extend
// them (never fork ad-hoc copies) when a new surface needs a fixture.

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Every timestamp derives from this base so fixtures are reproducible and
// obviously in the past (freshness logic must not think they are live).
export const FIXTURE_T0 = '2026-07-01T00:00:00.000Z';

export function at(hoursAfterT0) {
  return new Date(Date.parse(FIXTURE_T0) + hoursAfterT0 * 3_600_000).toISOString();
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeJsonl(filePath, rows) {
  await writeFile(filePath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
}

async function projectShell(root, { profile = 'business-flex', runBudgetUsd = 25 } = {}) {
  await mkdir(join(root, '.rstack'), { recursive: true });
  await writeJson(join(root, '.rstack', 'rstack.config.json'), {
    profile,
    enabled_domains: ['product', 'backend', 'qa', 'security', 'docs'],
  });
  await writeJson(join(root, '.rstack', 'budget.json'), { run_budget_usd: runBudgetUsd });
}

async function runShell(root, runId, { status = 'IN_PROGRESS', goal, schemaVersion = 2 } = {}) {
  const runDir = join(root, '.rstack', 'runs', runId);
  await mkdir(join(runDir, 'artifacts', 'stages'), { recursive: true });
  await mkdir(join(runDir, 'tasks'), { recursive: true });
  const manifest = {
    run_id: runId,
    goal: goal ?? `Fixture goal for ${runId}`,
    created_at: at(0),
    updated_at: at(1),
    mode: 'interactive',
    status,
    profile: 'business-flex',
    rstack_version: '2.0.0',
    started_by: { name: 'Fixture Frank', email: null },
  };
  if (schemaVersion != null) manifest.schema_version = schemaVersion;
  await writeJson(join(runDir, 'manifest.json'), manifest);
  return runDir;
}

// A hand-written pipeline-state rollup: fixtures control generated_at
// explicitly so staleness (events newer than the snapshot) is a fixture
// property, not an accident of when the test ran.
async function writeRollup(runDir, { runId, generatedAt, stages = [], approvalBlockers = [] }) {
  await writeJson(join(runDir, 'pipeline-state.json'), {
    schema_version: 1,
    generated_at: generatedAt,
    run: { run_id: runId },
    pipeline: {
      status: stages.some((stage) => stage.status === 'FAILED' || stage.status === 'BLOCKED') ? 'FAILED'
        : stages.every((stage) => stage.status === 'PASS') && stages.length ? 'PASS' : 'RUNNING',
      stages_total: stages.length,
      stages_passed: stages.filter((stage) => stage.status === 'PASS').length,
      stages_failed: stages.filter((stage) => stage.status === 'FAILED').length,
    },
    current: null,
    stages,
    retries: { total: 0, scheduled: 0, exhausted: 0, human_required: 0 },
    goal_loop: {},
    checkpoints: { total: 0, before_saved: 0, after_saved: 0, reverted: 0 },
    guardrails: { total: 0, events: [] },
    context_pressure: { total: 0, by_source: {}, warnings: [] },
    approval_blockers: approvalBlockers,
  });
}

function rollupStage(id, status, extra = {}) {
  return {
    id,
    title: id,
    status,
    attempts: status === 'PENDING' ? 0 : 1,
    retry_state: 'none',
    task_ids: [id],
    validation_status: status === 'PASS' ? 'PASS' : null,
    elapsed_ms: null,
    cost_usd: null,
    tokens: null,
    evidence_paths: [],
    checkpoint_restorable: false,
    checkpoint_reason: 'no_checkpoint',
    ...extra,
  };
}

/** Fixture 1 — initialized project, valid profile + budget, zero runs. */
export async function fixtureNoRunsProject(root) {
  await projectShell(root);
}

/** Fixture 2 — active run: one stage passed, one in progress. */
export async function fixtureActiveRun(root) {
  await projectShell(root);
  const runId = 'run-fx-active';
  const runDir = await runShell(root, runId, { status: 'IN_PROGRESS', goal: 'Active fixture — billing portal' });
  await writeJson(join(runDir, 'tasks.json'), {
    tasks: [
      { id: '02-requirements', title: 'Requirements', status: 'PASS', stage_id: '02-requirements' },
      { id: '07-code', title: 'Code', status: 'IN_PROGRESS', stage_id: '07-code', agent: 'agent.07-code' },
    ],
  });
  await writeJsonl(join(runDir, 'events.jsonl'), [
    { ts: at(1), type: 'run_started', started_by: 'Fixture Frank' },
    { ts: at(2), type: 'task_started', task_id: '02-requirements' },
    { ts: at(3), type: 'task_validated', task_id: '02-requirements', status: 'PASS' },
    { ts: at(4), type: 'task_started', task_id: '07-code' },
  ]);
  await writeJson(join(runDir, 'approvals.json'), [
    { id: 'app-fx-1', artifact: 'plan.md', status: 'APPROVED', approver: 'Fixture Frank', timestamp: at(1), run_id: runId },
  ]);
  await writeJsonl(join(runDir, 'evidence.jsonl'), [
    { ts: at(3), task_id: '02-requirements', kind: 'validation', status: 'PASS', evidence: 'requirements.json' },
  ]);
  const stageDir = join(runDir, 'artifacts', 'stages', '02-requirements');
  await mkdir(stageDir, { recursive: true });
  await writeJson(join(stageDir, 'requirements.json'), [
    { id: 'R1', area: 'billing', priority: 'must', description: 'Users can download invoices' },
  ]);
  await writeRollup(runDir, {
    runId,
    generatedAt: at(4),
    stages: [rollupStage('02-requirements', 'PASS'), rollupStage('07-code', 'RUNNING')],
  });
  return runId;
}

/** Fixture 3 — blocked run: guardrail hard-block + pending override card. */
export async function fixtureBlockedRun(root) {
  await projectShell(root);
  const runId = 'run-fx-blocked';
  const runDir = await runShell(root, runId, { status: 'IN_PROGRESS', goal: 'Blocked fixture — exhausted retries' });
  await writeJson(join(runDir, 'tasks.json'), {
    tasks: [{ id: '07-code', title: 'Code', status: 'BLOCKED', stage_id: '07-code' }],
  });
  await writeJsonl(join(runDir, 'events.jsonl'), [
    { ts: at(1), type: 'task_started', task_id: '07-code' },
    { ts: at(2), type: 'task_validated', task_id: '07-code', status: 'FAIL' },
    { ts: at(3), type: 'task_started', task_id: '07-code' },
    { ts: at(4), type: 'guardrail_triggered', task_id: '07-code', limit_name: 'maxTaskAttempts', current_value: 2, limit_value: 2, reason: 'task 07-code already has 2 attempt(s); limit is 2' },
    { ts: at(4), type: 'approval_gate_blocked', task_id: '07-code', missing: ['guardrail-override:07-code'] },
  ]);
  await writeJson(join(runDir, 'approvals.json'), []);
  const taskDir = join(runDir, 'tasks', '07-code');
  await mkdir(taskDir, { recursive: true });
  await writeJson(join(taskDir, 'validation.json'), {
    task_id: '07-code',
    status: 'FAIL',
    checks: [{ name: 'tests_pass', status: 'FAIL', evidence: 'unit suite failed' }],
    issues: ['unit suite failed'],
    retry_recommendation: 'retry_builder',
  });
  // The pending override card in the project-level queue.
  await writeJsonl(join(root, '.rstack', 'approvals.jsonl'), [
    { id: 'q-fx-blocked', title: 'Override guardrail for 07-code', detail: 'Task 07-code is blocked: retry budget exhausted', status: 'pending', runId, taskId: '07-code', artifact: 'guardrail-override:07-code', ts: at(4) },
  ]);
  await writeRollup(runDir, {
    runId,
    generatedAt: at(4),
    stages: [rollupStage('07-code', 'BLOCKED', { retry_state: 'exhausted', validation_status: 'FAIL' })],
  });
  return runId;
}

/** Fixture 4 — fully verified run: everything passed, approvals on file. */
export async function fixtureReadyRun(root) {
  await projectShell(root);
  const runId = 'run-fx-ready';
  const runDir = await runShell(root, runId, { status: 'DONE', goal: 'Ready fixture — shipped feature' });
  const stageIds = ['02-requirements', '07-code', '08-testing'];
  await writeJson(join(runDir, 'tasks.json'), {
    tasks: stageIds.map((id) => ({ id, title: id, status: 'PASS', stage_id: id })),
  });
  await writeJsonl(join(runDir, 'events.jsonl'), stageIds.flatMap((id, index) => [
    { ts: at(index + 1), type: 'task_started', task_id: id },
    { ts: at(index + 2), type: 'task_validated', task_id: id, status: 'PASS' },
  ]));
  await writeJson(join(runDir, 'approvals.json'), [
    { id: 'app-fx-r1', artifact: 'plan.md', status: 'APPROVED', approver: 'Fixture Frank', timestamp: at(1), run_id: runId },
    { id: 'app-fx-r2', artifact: 'requirements.json', status: 'APPROVED', approver: 'Fixture Frank', timestamp: at(1), run_id: runId },
    { id: 'app-fx-r3', artifact: 'architecture.md', status: 'APPROVED', approver: 'Fixture Frank', timestamp: at(2), run_id: runId },
    { id: 'app-fx-r4', artifact: 'release-readiness.json', status: 'APPROVED', approver: 'Fixture Frank', timestamp: at(6), run_id: runId },
  ]);
  await writeJsonl(join(runDir, 'evidence.jsonl'), stageIds.map((id, index) => (
    { ts: at(index + 2), task_id: id, kind: 'validation', status: 'PASS', evidence: `${id} artifact` }
  )));
  for (const id of stageIds) {
    const taskDir = join(runDir, 'tasks', id);
    await mkdir(taskDir, { recursive: true });
    await writeJson(join(taskDir, 'validation.json'), {
      task_id: id,
      status: 'PASS',
      checks: [{ name: 'artifact_exists', status: 'PASS', evidence: 'on disk' }],
      issues: [],
    });
  }
  const stageDir = join(runDir, 'artifacts', 'stages', '02-requirements');
  await mkdir(stageDir, { recursive: true });
  await writeJson(join(stageDir, 'requirements.json'), [
    { id: 'R1', area: 'billing', priority: 'must', description: 'Users can download invoices' },
  ]);
  await writeRollup(runDir, {
    runId,
    generatedAt: at(8),
    stages: stageIds.map((id) => rollupStage(id, 'PASS')),
  });
  return runId;
}

/** Fixture 5 — stale snapshot: events newer than pipeline-state.json. */
export async function fixtureStaleRun(root) {
  await projectShell(root);
  const runId = 'run-fx-stale';
  const runDir = await runShell(root, runId, { status: 'IN_PROGRESS', goal: 'Stale fixture — snapshot lags events' });
  await writeJson(join(runDir, 'tasks.json'), {
    tasks: [{ id: '07-code', title: 'Code', status: 'IN_PROGRESS', stage_id: '07-code' }],
  });
  // Rollup generated at hour 2; two events land after it → stale by 2.
  await writeRollup(runDir, {
    runId,
    generatedAt: at(2),
    stages: [rollupStage('07-code', 'RUNNING')],
  });
  await writeJsonl(join(runDir, 'events.jsonl'), [
    { ts: at(1), type: 'task_started', task_id: '07-code' },
    { ts: at(3), type: 'file_written', task_id: '07-code', path: 'src/x.js' },
    { ts: at(4), type: 'file_written', task_id: '07-code', path: 'src/y.js' },
  ]);
  await writeJson(join(runDir, 'approvals.json'), []);
  return runId;
}

/** Fixture 7 — legacy/partial/malformed run: no schema_version, corrupt
 * decisions.json, truncated trailing events line. The dashboard must badge
 * it damaged and keep serving everything else. */
export async function fixtureMalformedRun(root) {
  await projectShell(root);
  const runId = 'run-fx-damaged';
  const runDir = await runShell(root, runId, { status: 'IN_PROGRESS', goal: 'Damaged fixture', schemaVersion: null });
  await writeJson(join(runDir, 'tasks.json'), {
    tasks: [{ id: '02-requirements', title: 'Requirements', status: 'PASS', stage_id: '02-requirements' }],
  });
  await writeFile(join(runDir, 'events.jsonl'), `${JSON.stringify({ ts: at(1), type: 'task_started', task_id: '02-requirements' })}\n{"ts":"${at(2)}","type":"task_val`);
  await writeFile(join(runDir, 'decisions.json'), '{ this is not json');
  await writeJson(join(runDir, 'approvals.json'), []);
  return runId;
}

/** Fixture 8 — artifact access matrix: one real artifact to fetch, plus the
 * paths the API must refuse. Returns the request cases. */
export async function fixtureArtifactMatrix(root) {
  const runId = await fixtureActiveRun(root);
  return {
    runId,
    allowed: 'artifacts/stages/02-requirements/requirements.json',
    missing: 'artifacts/stages/09-deployment/deployment_report.json',
    traversal: '../../../etc/hosts',
  };
}
