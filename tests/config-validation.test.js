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
  validateIntegrationsConfig,
  validateProjectConfigs,
} from '../src/core/harness/config-validation.js';
import { INTEGRATIONS_TEMPLATE } from '../src/integrations/init.js';

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

// #237: .rstack/integrations.json — intake config for ticketing/docs/notifications.

test('integrations.json: valid shapes produce zero issues (init template included)', () => {
  assert.deepEqual(validateIntegrationsConfig({
    ticketing: { provider: 'jira', base_url: 'https://x.atlassian.net', project_key: 'PROJ' },
    docs: { provider: 'confluence', space_key: 'ENG' },
    notifications: { channel: 'slack' },
  }), []);
  assert.deepEqual(validateIntegrationsConfig({ ticketing: { provider: 'file-based' } }), []);
  assert.deepEqual(validateIntegrationsConfig({}), []);
  // The template init writes must validate clean — "_comment" keys are ignored.
  assert.deepEqual(validateIntegrationsConfig(INTEGRATIONS_TEMPLATE), []);
});

test('integrations.json: credential-shaped keys are a validation error pointing at .env', () => {
  const issues = validateIntegrationsConfig({
    ticketing: { provider: 'jira', api_token: 'abc123' },
    jira_password: 'hunter2',
    docs: { provider: 'confluence', access_secret: 'x' },
  });
  for (const field of ['ticketing.api_token', 'jira_password', 'docs.access_secret']) {
    assert.ok(issues.some((issue) => issue.field === field && /secrets belong in \.env/.test(issue.problem)), `expected secret error for ${field}`);
  }
});

test('integrations.json: shape problems name the exact field', () => {
  const issues = validateIntegrationsConfig({
    ticketing: { provider: 'trello', base_url: 42 },
    docs: 'confluence',
    notifications: { channel: 'carrier-pigeon', extra: 'x' },
    tickets: {},
  });
  assert.ok(issues.some((issue) => issue.field === 'ticketing.provider' && /jira \| github \| azure_devops \| linear \| file-based/.test(issue.problem)));
  assert.ok(issues.some((issue) => issue.field === 'ticketing.base_url' && /non-empty string/.test(issue.problem)));
  assert.ok(issues.some((issue) => issue.field === 'docs' && /must be an object/.test(issue.problem)));
  assert.ok(issues.some((issue) => issue.field === 'notifications.channel' && /slack \| teams \| discord \| none/.test(issue.problem)));
  assert.ok(issues.some((issue) => issue.field === 'notifications.extra' && /unknown key/.test(issue.problem)));
  assert.ok(issues.some((issue) => issue.field === 'tickets' && /unknown section/.test(issue.problem)));
  assert.ok(issues.some((issue) => issue.field === 'ticketing.provider' || issue.field === 'ticketing'), 'ticketing provider enum enforced');
});

test('integrations.json: ticketing section without a provider is flagged', () => {
  const issues = validateIntegrationsConfig({ ticketing: { base_url: 'https://x.atlassian.net' } });
  assert.ok(issues.some((issue) => issue.field === 'ticketing.provider' && /required/.test(issue.problem)));
});

test('integrations.json is registered in CONFIG_FILES — problems surface from validateProjectConfigs', async () => {
  const projectRoot = seedProject({
    'integrations.json': { ticketing: { provider: 'jira', api_token: 'leaked' } },
  });
  const problems = await validateProjectConfigs(projectRoot);
  const secret = problems.find((problem) => problem.file.endsWith('integrations.json') && problem.field === 'ticketing.api_token');
  assert.ok(secret, 'secret-key error must surface through the config registry');
  assert.match(secret.problem, /secrets belong in \.env/);
});
