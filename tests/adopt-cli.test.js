import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const execFileAsync = promisify(execFile);
const BIN = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'rstack-agents.js');

function seedRepo() {
  const root = mkdtempSync(join(tmpdir(), 'rstack-adopt-cli-'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'legacy', scripts: { test: 'jest' }, devDependencies: { jest: '^29' } }));
  writeFileSync(join(root, 'README.md'), '# Legacy');
  mkdirSync(join(root, 'tests'), { recursive: true });
  writeFileSync(join(root, 'tests', 'a.test.js'), 'test');
  return root;
}

test('adopt --dry-run prints the plan as JSON and writes nothing', async () => {
  const root = seedRepo();
  const { stdout } = await execFileAsync(process.execPath, [BIN, 'adopt', '--project', root, '--dry-run', '--json']);
  const report = JSON.parse(stdout);
  assert.equal(report.dry_run, true);
  assert.ok(report.harvested.includes('08-testing'));
  assert.equal(report.plan.length, 15);
  assert.ok(!existsSync(join(root, '.rstack')), 'dry-run must not create .rstack');
});

test('adopt materializes a run that pipeline status can read, resuming at real work', async () => {
  const root = seedRepo();
  const { stdout } = await execFileAsync(process.execPath, [BIN, 'adopt', '--project', root, '--run-id', 'adopt-cli-run', '--goal', 'Adopt legacy', '--json']);
  const report = JSON.parse(stdout);
  assert.equal(report.dry_run, false);
  assert.ok(report.stages_passed >= 5);

  const { stdout: statusOut } = await execFileAsync(process.execPath, [BIN, 'pipeline', 'status', '--project', root, '--run-id', 'adopt-cli-run', '--json']);
  const state = JSON.parse(statusOut);
  assert.equal(state.run.run_id, 'adopt-cli-run');
  assert.equal(state.stages.find((stage) => stage.id === '08-testing').status, 'PASS');
  assert.equal(state.stages.find((stage) => stage.id === '04-planning').status, 'PENDING');

  const { stdout: runOut } = await execFileAsync(process.execPath, [BIN, 'pipeline', 'run', '--project', root, '--run-id', 'adopt-cli-run', '--dry-run', '--json']);
  const runReport = JSON.parse(runOut);
  // No fabricated pending tasks: the adopted baseline is COMPLETE until real
  // work (sdlc_plan / feature mode) adds tasks on top of it.
  assert.equal(runReport.steps[0].stopped_on, 'complete');
});
