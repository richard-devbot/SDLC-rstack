import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { scanRepository } from '../src/core/adopt/scan.js';
import { buildAdoptionPlan, materializeAdoption } from '../src/core/adopt/harvest.js';

function seedBrownfieldRepo() {
  const root = mkdtempSync(join(tmpdir(), 'rstack-adopt-'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({
    name: 'legacy-app', scripts: { test: 'jest' }, dependencies: { express: '^4' }, devDependencies: { jest: '^29' },
  }));
  writeFileSync(join(root, 'README.md'), '# Legacy');
  mkdirSync(join(root, 'tests'), { recursive: true });
  writeFileSync(join(root, 'tests', 'a.test.js'), 'test');
  writeFileSync(join(root, 'Dockerfile'), 'FROM node:20');
  mkdirSync(join(root, 'src'), { recursive: true });
  return root;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

test('buildAdoptionPlan harvests only evidenced stages and states every skip reason', async () => {
  const root = seedBrownfieldRepo();
  const plan = buildAdoptionPlan(await scanRepository(root));

  assert.deepEqual(plan.harvested, ['00-environment', '02-requirements', '03-documentation', '06-architecture', '07-code', '08-testing', '09-deployment']);
  assert.equal(plan.stages.length, 15, 'every canonical stage gets a decision');
  for (const stage of plan.stages) {
    assert.ok(stage.reason, `${stage.stage_id} must state a reason`);
    if (stage.action === 'harvest') assert.ok(stage.evidence.length >= 0 && stage.artifact);
  }
  // Deliberate governance stages are never inferred.
  for (const id of ['12-security-threat-model', '13-compliance-checker', '04-planning']) {
    assert.equal(plan.stages.find((stage) => stage.stage_id === id).action, 'skip');
  }
});

test('a repo without tests or docs harvests less — gaps surface instead of being papered over', async () => {
  const root = mkdtempSync(join(tmpdir(), 'rstack-adopt-bare-'));
  writeFileSync(join(root, 'go.mod'), 'module bare');
  const plan = buildAdoptionPlan(await scanRepository(root));
  assert.ok(!plan.harvested.includes('08-testing'));
  assert.ok(!plan.harvested.includes('02-requirements'));
  assert.ok(plan.harvested.includes('06-architecture'));
});

test('materializeAdoption creates a complete, resumable run and never overwrites', async () => {
  const root = seedBrownfieldRepo();
  const scan = await scanRepository(root);
  const plan = buildAdoptionPlan(scan);
  const { state } = await materializeAdoption(root, {
    scan, plan, goal: 'Adopt legacy-app', runId: 'adopt-test-run', gaps: [{ kind: 'framework', name: 'express' }], now: '2026-07-05T12:00:00.000Z',
  });

  const runDir = join(root, '.rstack', 'runs', 'adopt-test-run');
  const manifest = readJson(join(runDir, 'manifest.json'));
  assert.equal(manifest.mode, 'adopt');
  assert.equal(manifest.schema_version, 2);

  // Harvested stages are DONE-with-evidence in the rollup; skipped stay PENDING.
  const byId = Object.fromEntries(state.stages.map((stage) => [stage.id, stage]));
  assert.equal(byId['06-architecture'].status, 'PASS');
  assert.equal(byId['08-testing'].status, 'PASS');
  assert.equal(byId['04-planning'].status, 'PENDING');
  assert.equal(state.pipeline.stages_passed, 7);

  // Artifacts carry evidence pointers and honest notes.
  const testReport = readJson(join(runDir, 'artifacts', 'stages', '08-testing', 'test_report.json'));
  assert.equal(testReport.executed, false);
  assert.match(testReport.note, /NOT executed/);
  const adoption = readJson(join(runDir, 'artifacts', 'adoption_report.json'));
  assert.equal(adoption.plan.length, 15);
  assert.deepEqual(adoption.specialist_gaps, [{ kind: 'framework', name: 'express' }]);

  // Evidence ledger records every harvest.
  const evidence = readFileSync(join(runDir, 'evidence.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(evidence.length, 7);
  assert.ok(evidence.every((entry) => entry.kind === 'adoption'));

  // Never overwrites: a second adoption with the same run id refuses.
  await assert.rejects(
    materializeAdoption(root, { scan, plan, goal: 'again', runId: 'adopt-test-run' }),
    /never overwrites/,
  );
  assert.ok(existsSync(join(runDir, 'pipeline-state.json')));
});
