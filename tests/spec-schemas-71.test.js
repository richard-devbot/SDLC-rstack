// RStack Spec v1alpha1 (#71): every packaged schema compiles, the conformance
// example validates end-to-end, broken files fail naming the exact field, the
// CLI exit codes are honest, and no schema in spec/schemas/ can ship dead
// (unexercised by the validator).
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  EXAMPLE_RUN_DIR,
  SCHEMAS_DIR,
  SPEC_SCHEMA_FILES,
  runValidateSchemas,
} from '../src/commands/validate-schemas.js';

const execFileAsync = promisify(execFile);
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(PACKAGE_ROOT, 'bin', 'rstack-agents.js');

function emptyProject() {
  return mkdtempSync(path.join(os.tmpdir(), 'rstack-spec-71-'));
}

// A project whose newest run is a copy of the conformance example, optionally
// mutated by the caller before validation.
function projectWithExampleRun(mutate = () => {}) {
  const projectRoot = emptyProject();
  const runDir = path.join(projectRoot, '.rstack', 'runs', '2026-07-12-0900-governed-checkout-flow');
  mkdirSync(path.dirname(runDir), { recursive: true });
  cpSync(EXAMPLE_RUN_DIR, runDir, { recursive: true });
  mutate(runDir);
  return { projectRoot, runDir };
}

test('every schema in spec/schemas/ parses and compiles', async () => {
  const report = await runValidateSchemas({ project: emptyProject() });
  for (const name of SPEC_SCHEMA_FILES) {
    const check = report.checks.find((entry) => entry.schema === name && entry.target === `spec/schemas/${name}`);
    assert.ok(check, `${name} has a parse/compile check`);
    assert.equal(check.status, 'PASS', `${name} compiles: ${JSON.stringify(check.errors)}`);
  }
});

test('the packaged conformance example validates against every matching schema', async () => {
  const report = await runValidateSchemas({ project: emptyProject() });
  const failures = report.checks.filter((check) => check.status === 'FAIL');
  assert.deepEqual(failures, [], `no FAIL expected, got: ${failures.map((f) => `${f.target} ${JSON.stringify(f.errors)}`).join('; ')}`);
  assert.equal(report.ok, true);
  assert.ok(report.summary.pass >= SPEC_SCHEMA_FILES.length, 'every schema contributes at least its compile check');
});

test('a deliberately broken builder contract fails naming the field', async () => {
  const { projectRoot } = projectWithExampleRun((runDir) => {
    const builderPath = path.join(runDir, 'tasks', '004-implementation', 'builder.json');
    const builder = JSON.parse(readFileSync(builderPath, 'utf8'));
    builder.status = 'MAYBE'; // not in BUILDER_STATUSES
    delete builder.summary; // required field
    writeFileSync(builderPath, JSON.stringify(builder, null, 2));
  });
  const report = await runValidateSchemas({ project: projectRoot });
  assert.equal(report.ok, false);
  const failure = report.checks.find((check) => check.status === 'FAIL' && check.schema === 'builder-contract.schema.json');
  assert.ok(failure, 'broken builder.json produces a FAIL against builder-contract.schema.json');
  const paths = failure.errors.map((error) => error.path);
  assert.ok(paths.includes('/status'), `errors name /status, got ${JSON.stringify(paths)}`);
  assert.ok(failure.errors.some((error) => /summary/.test(error.path) || /summary/.test(error.message)), 'errors name the missing summary field');
});

test('a broken manifest fails on the exact enum fields; missing files SKIP, never FAIL', async () => {
  const projectRoot = emptyProject();
  const runDir = path.join(projectRoot, '.rstack', 'runs', '2026-01-01-0000-partial');
  mkdirSync(runDir, { recursive: true });
  writeFileSync(path.join(runDir, 'manifest.json'), JSON.stringify({
    run_id: '2026-01-01-0000-partial',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    goal: 'partial run',
    mode: 'warp',
    status: 'MAYBE',
    project_root: projectRoot,
  }));
  const report = await runValidateSchemas({ project: projectRoot });
  const failure = report.checks.find((check) => check.status === 'FAIL' && check.target.includes('manifest.json'));
  assert.ok(failure, 'broken manifest FAILs');
  const paths = failure.errors.map((error) => error.path).sort();
  assert.deepEqual(paths, ['/mode', '/status']);
  // Tolerance: the run has no tasks.json/approvals.json — those are SKIP.
  const skipped = report.checks.filter((check) => check.status === 'SKIP' && check.target.startsWith('run 2026-01-01-0000-partial/'));
  assert.ok(skipped.some((check) => check.target.endsWith('tasks.json')), 'missing tasks.json is SKIP');
  assert.ok(skipped.some((check) => check.target.endsWith('approvals.json')), 'missing approvals.json is SKIP');
  assert.ok(!report.checks.some((check) => check.status === 'FAIL' && check.target.endsWith('tasks.json')), 'missing files never FAIL');
});

test('per-entry paths: a bad task status is reported at /tasks/<index>/status', async () => {
  const { projectRoot } = projectWithExampleRun((runDir) => {
    const tasksPath = path.join(runDir, 'tasks.json');
    const taskState = JSON.parse(readFileSync(tasksPath, 'utf8'));
    taskState.tasks[1].status = 'ALMOST';
    writeFileSync(tasksPath, JSON.stringify(taskState, null, 2));
  });
  const report = await runValidateSchemas({ project: projectRoot });
  const failure = report.checks.find((check) => check.status === 'FAIL' && check.target.includes('tasks[1]'));
  assert.ok(failure, 'the per-entry task check FAILs');
  assert.ok(failure.errors.some((error) => error.path === '/tasks/1/status'), `field path is /tasks/1/status, got ${JSON.stringify(failure.errors)}`);
});

test('CLI: exit 0 on the repo example, exit 1 on a broken fixture', async () => {
  const clean = await execFileAsync(process.execPath, [CLI, 'validate', '--schemas', '--project', emptyProject()]);
  assert.match(clean.stdout, /0 FAIL/);

  const { projectRoot } = projectWithExampleRun((runDir) => {
    const approvalsPath = path.join(runDir, 'approvals.json');
    const approvals = JSON.parse(readFileSync(approvalsPath, 'utf8'));
    approvals[0].status = 'approved'; // lowercase is malformed, not a synonym
    writeFileSync(approvalsPath, JSON.stringify(approvals, null, 2));
  });
  await assert.rejects(
    execFileAsync(process.execPath, [CLI, 'validate', '--schemas', '--project', projectRoot]),
    (error) => {
      assert.equal(error.code, 1, 'broken fixture exits 1');
      assert.match(error.stdout, /FAIL/);
      assert.match(error.stdout, /\/0\/status/, 'stdout names the failing record field path');
      return true;
    },
  );
});

test('registry: every schema file in spec/schemas/ is exercised by the validator (no dead schemas)', async () => {
  const onDisk = readdirSync(SCHEMAS_DIR).filter((name) => name.endsWith('.schema.json')).sort();
  assert.deepEqual(onDisk, [...SPEC_SCHEMA_FILES].sort(),
    'SPEC_SCHEMA_FILES must list exactly the schemas on disk — register new schemas in src/commands/validate-schemas.js');

  const report = await runValidateSchemas({ project: emptyProject() });
  for (const name of onDisk) {
    const exercised = report.checks.some(
      (check) => check.schema === name && check.status !== 'SKIP' && check.target !== `spec/schemas/${name}`,
    );
    assert.ok(exercised, `${name} must be exercised by at least one example validation beyond its own compile check — add an example file for it`);
  }
});
