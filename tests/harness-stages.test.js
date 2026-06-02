import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CANONICAL_SDLC_STAGES, assertCanonicalStages, stageArtifactRelativePath } from '../src/core/harness/stages.js';
import { prepareStageFolders, stageArtifactPath } from '../src/core/harness/run-state.js';

const EXPECTED_STAGE_IDS = [
  '00-environment',
  '01-transcript',
  '02-requirements',
  '03-documentation',
  '04-planning',
  '05-jira',
  '06-architecture',
  '07-code',
  '08-testing',
  '09-deployment',
  '10-summary',
  '11-feedback-loop',
  '12-security-threat-model',
  '13-compliance-checker',
  '14-cost-estimation',
];

test('canonical SDLC stage list preserves exact 00-14 pipeline', () => {
  assert.equal(CANONICAL_SDLC_STAGES.length, 15);
  assert.deepEqual(CANONICAL_SDLC_STAGES.map((stage) => stage.id), EXPECTED_STAGE_IDS);
  assert.equal(assertCanonicalStages(), true);
});

test('stage folder preparation creates one clean folder per canonical stage', async () => {
  const runDir = mkdtempSync(join(tmpdir(), 'rstack-run-'));
  try {
    await prepareStageFolders(runDir);
    for (const stage of CANONICAL_SDLC_STAGES) {
      assert.ok(existsSync(join(runDir, 'artifacts', 'stages', stage.id)), `${stage.id} folder should exist`);
    }
    assert.equal(stageArtifactPath(runDir, '06-architecture').endsWith('artifacts/stages/06-architecture/system_design.json'), true);
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

test('stage artifact relative paths point under artifacts/stages/<stage-id>', () => {
  assert.equal(
    stageArtifactRelativePath('run-1', '14-cost-estimation'),
    '.rstack/runs/run-1/artifacts/stages/14-cost-estimation/cost_estimate.json',
  );
  assert.throws(() => stageArtifactRelativePath('run-1', '15-invalid'), /Unknown canonical SDLC stage/);
});
