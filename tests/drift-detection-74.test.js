// Traceability drift detection (#74): orphaned requirements/tasks, completed
// work without contracts (waiver-aware), PASS verdicts without evidence,
// stale file references, missing approved artifacts, contradicted readiness,
// and the fully-valid run.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { scanProjectDrift, scanRunDrift } from '../src/core/harness/drift.js';
import { runDrift, formatDrift } from '../src/commands/drift.js';

const RUN_ID = 'run-20260712-drift';
const outputDir = (taskId) => `.rstack/runs/${RUN_ID}/tasks/${taskId}`;

function seedRun(projectRoot, runId, { tasks = [], taskFiles = {}, runFiles = {}, stageFiles = {} } = {}) {
  const runDir = path.join(projectRoot, '.rstack', 'runs', runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(path.join(runDir, 'manifest.json'), JSON.stringify({ run_id: runId, goal: 'Drift fixture', status: 'IN_PROGRESS' }));
  writeFileSync(path.join(runDir, 'tasks.json'), JSON.stringify({ tasks }));
  for (const [name, content] of Object.entries(runFiles)) {
    writeFileSync(path.join(runDir, name), typeof content === 'string' ? content : JSON.stringify(content));
  }
  for (const [stageId, files] of Object.entries(stageFiles)) {
    const stageDir = path.join(runDir, 'artifacts', 'stages', stageId);
    mkdirSync(stageDir, { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(path.join(stageDir, name), typeof content === 'string' ? content : JSON.stringify(content));
    }
  }
  for (const [taskId, files] of Object.entries(taskFiles)) {
    const taskDir = path.join(runDir, 'tasks', taskId);
    mkdirSync(taskDir, { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(path.join(taskDir, name), typeof content === 'string' ? content : JSON.stringify(content));
    }
  }
  return runDir;
}

const task = (id, status, extra = {}) => ({
  id,
  title: id,
  status,
  agent: 'backend-builder',
  artifact_path: `.rstack/runs/${RUN_ID}/artifacts/${id}.md`,
  stage_artifacts: [{ stage_id: '07-code' }],
  output_dir: outputDir(id),
  description: `work for ${id}`,
  ...extra,
});

const passingContracts = (id, files = []) => ({
  'builder.json': { task_id: id, status: 'PASS', summary: 'done', files_modified: files, tests_run: ['npm test'], risks: [], next_steps: [] },
  'validation.json': { task_id: id, validator: 'v', status: 'PASS', checks: [{ name: 'x', status: 'PASS', evidence: 'ok' }], issues: [], retry_recommendation: 'none' },
});

test('a fully-consistent run reports PASS with no findings', async () => {
  const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'rstack-drift-'));
  mkdirSync(path.join(projectRoot, 'src'), { recursive: true });
  writeFileSync(path.join(projectRoot, 'src', 'ok.js'), 'export const ok = 1;');
  seedRun(projectRoot, RUN_ID, {
    tasks: [task('001-code', 'PASS', { description: 'implements REQ-1 login' })],
    taskFiles: { '001-code': passingContracts('001-code', ['src/ok.js']) },
    stageFiles: { '02-requirements': { 'requirements.json': { functional: [{ id: 'REQ-1', description: 'login' }] } } },
  });
  const result = await scanRunDrift(projectRoot, RUN_ID);
  assert.equal(result.status, 'PASS');
  assert.deepEqual(result.findings, []);
  assert.equal(result.summary.requirements, 1);
  assert.equal(result.summary.tasks, 1);
});

test('a requirement no task references is reported', async () => {
  const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'rstack-drift-'));
  seedRun(projectRoot, RUN_ID, {
    tasks: [task('001-code', 'PENDING')],
    stageFiles: { '02-requirements': { 'requirements.json': { functional: [{ id: 'REQ-99', description: 'forgotten feature' }] } } },
  });
  const result = await scanRunDrift(projectRoot, RUN_ID);
  assert.equal(result.status, 'WARN');
  const found = result.findings.find((f) => f.type === 'requirement-without-task');
  assert.equal(found.requirement_id, 'REQ-99');
});

test('completed tasks without contracts are errors; a waiver downgrades the validator gap', async () => {
  const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'rstack-drift-'));
  seedRun(projectRoot, RUN_ID, {
    tasks: [task('001-code', 'PASS'), task('002-code', 'PASS')],
    // 001: no contracts at all. 002: builder only, validator waived.
    taskFiles: { '002-code': { 'builder.json': passingContracts('002-code')['builder.json'] } },
    runFiles: {
      'approvals.json': [{ id: 'w1', artifact: 'validation-waiver:002-code', status: 'APPROVED', approved_by: 'richardson' }],
    },
  });
  const result = await scanRunDrift(projectRoot, RUN_ID);
  assert.equal(result.status, 'FAIL');
  const builderGap = result.findings.find((f) => f.type === 'missing-builder-contract' && f.task_id === '001-code');
  assert.equal(builderGap.severity, 'error');
  const hardGap = result.findings.find((f) => f.type === 'missing-validator-contract' && f.task_id === '001-code');
  assert.equal(hardGap.severity, 'error');
  const waivedGap = result.findings.find((f) => f.type === 'missing-validator-contract' && f.task_id === '002-code');
  assert.equal(waivedGap.severity, 'warning');
  assert.equal(waivedGap.waived, true);
  assert.equal(result.summary.missing_evidence, 3);
});

test('a PASS verdict with zero passing checks is an error', async () => {
  const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'rstack-drift-'));
  seedRun(projectRoot, RUN_ID, {
    tasks: [task('001-code', 'PASS')],
    taskFiles: {
      '001-code': {
        'builder.json': passingContracts('001-code')['builder.json'],
        'validation.json': { task_id: '001-code', validator: 'v', status: 'PASS', checks: [], issues: [], retry_recommendation: 'none' },
      },
    },
  });
  const result = await scanRunDrift(projectRoot, RUN_ID);
  assert.ok(result.findings.some((f) => f.type === 'validator-pass-without-evidence'));
  assert.equal(result.status, 'FAIL');
});

test('stale references: deleted builder files and evidence paths are flagged', async () => {
  const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'rstack-drift-'));
  seedRun(projectRoot, RUN_ID, {
    tasks: [task('001-code', 'PASS')],
    taskFiles: { '001-code': passingContracts('001-code', ['src/deleted.js']) },
    runFiles: {
      'evidence.jsonl': [
        JSON.stringify({ task_id: '001-code', kind: 'validation', status: 'PASS', evidence: ['npm test', 'src/also-gone.js'] }),
        JSON.stringify({ task_id: 'ghost-task', kind: 'validation', status: 'PASS', evidence: [] }),
      ].join('\n'),
    },
  });
  const result = await scanRunDrift(projectRoot, RUN_ID);
  const stale = result.findings.filter((f) => f.type === 'stale-file-reference');
  assert.deepEqual(stale.map((f) => f.path).sort(), ['src/also-gone.js', 'src/deleted.js']);
  assert.ok(result.findings.some((f) => f.type === 'evidence-unknown-task' && f.task_id === 'ghost-task'));
  // commands like "npm test" are not treated as paths
  assert.ok(!stale.some((f) => f.path === 'npm test'));
  assert.equal(result.summary.stale_references, 3);
});

test('an approved artifact that no longer exists is flagged; virtual gates are not', async () => {
  const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'rstack-drift-'));
  const runDir = seedRun(projectRoot, RUN_ID, {
    tasks: [task('001-code', 'PENDING')],
    runFiles: {
      'approvals.json': [
        { id: 'a1', artifact: 'plan.md', status: 'APPROVED', approved_by: 'r' },
        { id: 'a2', artifact: 'ghost-report.json', status: 'APPROVED', approved_by: 'r' },
        { id: 'a3', artifact: 'guardrail-override:001-code', status: 'APPROVED', approved_by: 'r' },
      ],
    },
  });
  writeFileSync(path.join(runDir, 'plan.md'), '# plan');
  const result = await scanRunDrift(projectRoot, RUN_ID);
  const missing = result.findings.filter((f) => f.type === 'approval-artifact-missing');
  assert.equal(missing.length, 1);
  assert.equal(missing[0].approved_artifact, 'ghost-report.json');
});

test('READY readiness over failing tasks is a contradiction error', async () => {
  const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'rstack-drift-'));
  seedRun(projectRoot, RUN_ID, {
    tasks: [task('001-code', 'FAIL'), task('002-code', 'BLOCKED')],
    runFiles: { 'readiness.json': { run_id: RUN_ID, status: 'READY', score: 1 } },
  });
  const result = await scanRunDrift(projectRoot, RUN_ID);
  const contradiction = result.findings.find((f) => f.type === 'readiness-contradiction');
  assert.equal(contradiction.severity, 'error');
  assert.deepEqual(contradiction.task_ids, ['001-code', '002-code']);
});

test('orphaned tasks (no stage, no artifact) are distinguished from merely-incomplete ones', async () => {
  const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'rstack-drift-'));
  seedRun(projectRoot, RUN_ID, {
    tasks: [
      { id: 'floater', title: 'floater', status: 'PENDING', output_dir: outputDir('floater') },
      { id: 'no-owner', title: 'no-owner', status: 'PENDING', artifact_path: 'x.md', stage_artifacts: [{ stage_id: '07-code' }], output_dir: outputDir('no-owner') },
    ],
  });
  const result = await scanRunDrift(projectRoot, RUN_ID);
  assert.ok(result.findings.some((f) => f.type === 'orphaned-task' && f.task_id === 'floater'));
  const incomplete = result.findings.find((f) => f.type === 'task-missing-fields' && f.task_id === 'no-owner');
  assert.match(incomplete.message, /owner\/agent/);
  assert.equal(result.summary.orphaned_tasks, 1);
});

test('project-wide scan aggregates the worst run status', async () => {
  const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'rstack-drift-'));
  seedRun(projectRoot, 'run-a-clean', { tasks: [] });
  seedRun(projectRoot, 'run-b-broken', { tasks: [task('001-code', 'PASS')] }); // no contracts → FAIL
  const result = await scanProjectDrift(projectRoot);
  assert.equal(result.run_count, 2);
  assert.equal(result.status, 'FAIL');
  const text = formatDrift(await runDrift(projectRoot, { all: true }));
  assert.match(text, /drift: FAIL across 2 run\(s\)/);
  assert.match(text, /missing-builder-contract/);
});
