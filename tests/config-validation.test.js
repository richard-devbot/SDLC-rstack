import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  validateRstackConfig,
  validateBudgetConfig,
  validateNotificationsConfig,
  validatePolicyConfig,
  validateMemoryConfig,
  validateProjectConfigs,
} from '../src/core/harness/config-validation.js';

function seedProject(files = {}) {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-config-'));
  mkdirSync(join(projectRoot, '.rstack'), { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(projectRoot, '.rstack', name), typeof content === 'string' ? content : JSON.stringify(content));
  }
  return projectRoot;
}

test('valid configs produce zero issues', async () => {
  const projectRoot = seedProject({
    'rstack.config.json': { profile: 'business-flex', guardrails: { maxTaskAttempts: 3, requireEvidenceForPass: true } },
    'budget.json': { run_budget_usd: 10, daily_budget_usd: 50, stage_budgets: { '07-code': 2 } },
    'notifications.json': { channels: { slack: { webhook: 'https://hooks.slack.com/x' } } },
    'policy.json': { required_approvals: { '004-implementation': ['plan.md'] }, enforce_in_express: true, managers: ['richardson'] },
    'memory-config.json': { writePolicy: 'validator-approved-only' },
  });
  assert.deepEqual(await validateProjectConfigs(projectRoot), []);
});

test('each validator names the exact field and problem', () => {
  const rstack = validateRstackConfig({ profile: 'mega-profile', guardrails: { maxTaskAttempts: -1, requireEvidenceForPass: 'sure', notARule: 1 } });
  assert.ok(rstack.some((issue) => issue.field === 'profile' && /unknown profile "mega-profile"/.test(issue.problem)));
  assert.ok(rstack.some((issue) => issue.field === 'guardrails.maxTaskAttempts' && /non-negative number/.test(issue.problem)));
  assert.ok(rstack.some((issue) => issue.field === 'guardrails.requireEvidenceForPass' && /boolean/.test(issue.problem)));
  assert.ok(rstack.some((issue) => issue.field === 'guardrails.notARule' && /unknown guardrail key/.test(issue.problem)));

  const budget = validateBudgetConfig({ run_budget_usd: 'ten', stage_budgets: { '07-code': 'lots' } });
  assert.ok(budget.some((issue) => issue.field === 'run_budget_usd' && /NOT use this value/.test(issue.problem)));
  assert.ok(budget.some((issue) => issue.field === 'stage_budgets.07-code'));

  const notifications = validateNotificationsConfig({ channels: { slak: { webhook: 'x' }, telegram: 'not-an-object' } });
  assert.ok(notifications.some((issue) => issue.field === 'channels.slak' && /unknown channel/.test(issue.problem)));
  assert.ok(notifications.some((issue) => issue.field === 'channels.telegram' && /must be an object/.test(issue.problem)));

  const policy = validatePolicyConfig({ required_approvals: { '004-implementation': [''] }, enforce_in_express: 'yes', managers: [42] });
  assert.ok(policy.some((issue) => issue.field === 'required_approvals.004-implementation' && /NOT be enforced/.test(issue.problem)));
  assert.ok(policy.some((issue) => issue.field === 'enforce_in_express'));
  assert.ok(policy.some((issue) => issue.field === 'managers'));

  const memory = validateMemoryConfig({ writePolicy: 'whenever' });
  assert.ok(memory.some((issue) => issue.field === 'writePolicy' && /unknown write policy/.test(issue.problem)));

  const loop = validateRstackConfig({ loop: { maxIterations: 99, maxStepsPerIteration: 'lots', notABound: 1 } });
  assert.ok(loop.some((issue) => issue.field === 'loop.maxIterations' && /clamped to 20/.test(issue.problem)));
  assert.ok(loop.some((issue) => issue.field === 'loop.maxStepsPerIteration' && /must be a number >= 1/.test(issue.problem)));
  assert.ok(loop.some((issue) => issue.field === 'loop.notABound' && /unknown loop bound key/.test(issue.problem)));
  assert.deepEqual(validateRstackConfig({ loop: { maxIterations: 5 } }), []);
});

test('malformed JSON and non-object configs are reported as file-level problems', async () => {
  const projectRoot = seedProject({
    'budget.json': '{ nope',
    'policy.json': '[1, 2, 3]',
  });
  const problems = await validateProjectConfigs(projectRoot);
  const budget = problems.find((problem) => problem.file.endsWith('budget.json'));
  assert.ok(budget, 'malformed budget.json must be reported');
  assert.match(budget.problem, /malformed JSON/);
  const policy = problems.find((problem) => problem.file.endsWith('policy.json'));
  assert.match(policy.problem, /must be a JSON object/);
});

test('missing config files are normal, not problems', async () => {
  const projectRoot = seedProject();
  assert.deepEqual(await validateProjectConfigs(projectRoot), []);
});
