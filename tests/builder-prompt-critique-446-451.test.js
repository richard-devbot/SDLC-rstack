/**
 * #446 (prompt reliability) + #451 (critique loop-back).
 *
 * #446: the machine-readable Builder Contract must survive a large context —
 * so it sits AHEAD of the specialist block, and the specialist block is bounded
 * with a visible truncation marker (never a silent cut).
 * #451: a retry (reclaim after FAIL/BLOCKED) hands the builder the PREVIOUS
 * attempt's validator critique — instruction-first — so it fixes the specific
 * failures instead of retrying blind.
 *
 * owner: RStack developed by Richardson Gunde
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { boundPromptSection, priorCritiqueBlock, builderPrompt } from '../src/integrations/pi/rstack-sdlc.ts';

test('#446 boundPromptSection truncates oversized text with a visible marker, leaves short text intact', () => {
  assert.equal(boundPromptSection('short', 100, 'x'), 'short');
  const big = 'a'.repeat(5000);
  const bounded = boundPromptSection(big, 1000, 'specialist instructions');
  assert.ok(bounded.length < big.length, 'oversized text is shortened');
  assert.ok(bounded.startsWith('a'.repeat(1000)), 'keeps the head within budget');
  assert.match(bounded, /specialist instructions truncated to fit the context budget — 4000 chars omitted/);
});

test('#451 priorCritiqueBlock surfaces the prior FAIL, is empty on PASS / first attempt', async () => {
  const root = mkdtempSync(join(tmpdir(), 'rstack-critique-'));
  try {
    const task = { id: '07-code', output_dir: 'tasks/07-code' };
    mkdirSync(join(root, task.output_dir), { recursive: true });

    // First attempt: no validation.json → no critique.
    assert.equal(await priorCritiqueBlock(root, task), '');

    // A PASS never nags.
    writeFileSync(join(root, task.output_dir, 'validation.json'), JSON.stringify({ status: 'PASS', checks: [] }));
    assert.equal(await priorCritiqueBlock(root, task), '');

    // A FAIL surfaces the failed checks + recommendation.
    writeFileSync(join(root, task.output_dir, 'validation.json'), JSON.stringify({
      status: 'FAIL',
      retry_recommendation: 'retry_builder',
      issues: [
        { name: 'high_risks_have_mitigation', status: 'FAIL', evidence: '2 of 3 high threats lack mitigation' },
        { name: 'tests_run_has_evidence', status: 'FAIL', evidence: 'no command output recorded', remediation: 'attach the test command + output' },
      ],
    }));
    const block = await priorCritiqueBlock(root, task);
    assert.match(block, /PREVIOUS attempt FAILED/);
    assert.match(block, /high_risks_have_mitigation/);
    assert.match(block, /2 of 3 high threats lack mitigation/);
    assert.match(block, /fix: attach the test command/);
    assert.match(block, /retry_builder/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('#446/#451 builderPrompt: contract precedes specialists, critique lands instruction-first', async () => {
  const root = mkdtempSync(join(tmpdir(), 'rstack-builderprompt-'));
  try {
    const task = {
      id: '07-code',
      title: 'Implement billing export',
      description: 'Add invoice CSV export.',
      output_dir: 'tasks/07-code',
      artifact_path: 'artifacts/stages/07-code/code_manifest.json',
      stage_artifacts: [],
      acceptance_criteria: ['CSV downloads'],
      validation_checks: ['tests pass'],
      routing: {},
      budget_envelope: {},
    };
    mkdirSync(join(root, task.output_dir), { recursive: true });
    writeFileSync(join(root, task.output_dir, 'validation.json'), JSON.stringify({
      status: 'FAIL',
      retry_recommendation: 'retry_builder',
      issues: [{ name: 'tests_run_has_evidence', status: 'FAIL', evidence: 'no command output recorded' }],
    }));

    // runId omitted → no event writes / no context-pressure side effects.
    const prompt = await builderPrompt(root, task, []);

    const contractAt = prompt.indexOf('## Builder contract');
    const specialistAt = prompt.indexOf('## Selected specialist instructions');
    const critiqueAt = prompt.indexOf('PREVIOUS attempt FAILED');
    const scopeAt = prompt.indexOf('## Scope');

    assert.ok(contractAt !== -1 && specialistAt !== -1, 'both sections present');
    assert.ok(contractAt < specialistAt, '#446: the output contract sits ahead of the specialist block');
    assert.ok(critiqueAt !== -1 && critiqueAt < scopeAt, '#451: the critique lands instruction-first, before Scope');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
