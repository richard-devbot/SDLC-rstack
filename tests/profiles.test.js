/**
 * Tests for src/core/profiles.js
 * Covers: BUILT_IN_PROFILES, profileConfig, budgetPolicyForProfile,
 *         loadProjectProfile, loadBudgetPolicy, budgetEnvelopeForTask
 *
 * owner: RStack developed by Richardson Gunde
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BUILT_IN_PROFILES,
  profileConfig,
  budgetPolicyForProfile,
  loadProjectProfile,
  loadBudgetPolicy,
  budgetEnvelopeForTask,
} from '../src/core/profiles.js';

function tmpProject() {
  return mkdtempSync(join(tmpdir(), 'rstack-profiles-'));
}

// ---------------------------------------------------------------------------
// BUILT_IN_PROFILES
// ---------------------------------------------------------------------------

test('BUILT_IN_PROFILES contains the three expected profile keys', () => {
  const keys = Object.keys(BUILT_IN_PROFILES);
  assert.ok(keys.includes('business-flex'));
  assert.ok(keys.includes('enterprise-webapp'));
  assert.ok(keys.includes('lean-mvp'));
  assert.equal(keys.length, 3);
});

test('BUILT_IN_PROFILES is frozen and cannot be mutated', () => {
  assert.ok(Object.isFrozen(BUILT_IN_PROFILES));
  // Attempt to add a property
  assert.throws(() => {
    'use strict';
    BUILT_IN_PROFILES['new-profile'] = {};
  });
});

test('business-flex profile has required structure fields', () => {
  const profile = BUILT_IN_PROFILES['business-flex'];
  assert.equal(profile.profile, 'business-flex');
  assert.equal(profile.workflow, 'production-business-sdlc');
  assert.ok(Array.isArray(profile.enabled_domains));
  assert.ok(Array.isArray(profile.enabled_agents));
  assert.ok(Array.isArray(profile.enabled_plugins));
  assert.ok(Array.isArray(profile.dashboard_pages));
  assert.ok(Array.isArray(profile.business_stage_order));
  assert.ok(profile.enabled_domains.includes('backend'));
  assert.ok(profile.enabled_domains.includes('qa'));
  assert.ok(profile.enabled_domains.includes('security'));
  assert.ok(profile.dashboard_pages.includes('business-flex'));
});

test('lean-mvp profile has smaller enabled set than business-flex', () => {
  const lean = BUILT_IN_PROFILES['lean-mvp'];
  const flex = BUILT_IN_PROFILES['business-flex'];
  assert.equal(lean.profile, 'lean-mvp');
  assert.equal(lean.workflow, 'lean-mvp-sdlc');
  assert.ok(lean.enabled_domains.length < flex.enabled_domains.length);
  assert.ok(lean.enabled_agents.length < flex.enabled_agents.length);
  assert.ok(lean.enabled_plugins.length < flex.enabled_plugins.length);
});

test('enterprise-webapp profile has security/compliance oriented domains', () => {
  const enterprise = BUILT_IN_PROFILES['enterprise-webapp'];
  assert.equal(enterprise.profile, 'enterprise-webapp');
  assert.equal(enterprise.workflow, 'enterprise-webapp-sdlc');
  assert.ok(enterprise.enabled_domains.includes('security'));
  assert.ok(enterprise.enabled_domains.includes('devops'));
  assert.ok(enterprise.enabled_plugins.includes('security-scanning'));
});

// ---------------------------------------------------------------------------
// profileConfig
// ---------------------------------------------------------------------------

test('profileConfig returns business-flex by default', () => {
  const profile = profileConfig();
  assert.equal(profile.profile, 'business-flex');
  assert.equal(profile.workflow, 'production-business-sdlc');
});

test('profileConfig returns the requested profile', () => {
  assert.equal(profileConfig('lean-mvp').profile, 'lean-mvp');
  assert.equal(profileConfig('enterprise-webapp').profile, 'enterprise-webapp');
  assert.equal(profileConfig('business-flex').profile, 'business-flex');
});

test('profileConfig returns business-flex for unknown profile names', () => {
  const profile = profileConfig('nonexistent-profile');
  assert.equal(profile.profile, 'business-flex');
});

test('profileConfig returns a deep copy — mutations do not affect BUILT_IN_PROFILES', () => {
  const profile = profileConfig('business-flex');
  profile.enabled_domains.push('mutated-domain');
  profile.custom_field = 'added';
  // Original must be unchanged
  assert.ok(!BUILT_IN_PROFILES['business-flex'].enabled_domains.includes('mutated-domain'));
  assert.ok(!('custom_field' in BUILT_IN_PROFILES['business-flex']));
});

test('profileConfig with undefined argument falls back to business-flex', () => {
  const profile = profileConfig(undefined);
  assert.equal(profile.profile, 'business-flex');
});

// ---------------------------------------------------------------------------
// budgetPolicyForProfile
// ---------------------------------------------------------------------------

test('budgetPolicyForProfile business-flex returns base budgets', () => {
  const policy = budgetPolicyForProfile('business-flex');
  assert.equal(policy.currency, 'USD');
  assert.equal(policy.run_budget_usd, 10);
  assert.equal(policy.daily_budget_usd, 50);
  assert.equal(policy.monthly_budget_usd, 500);
  assert.equal(policy.require_approval_above_usd, 25);
  assert.equal(policy.warn_at_percent, 70);
  assert.equal(policy.block_at_percent, 100);
});

test('budgetPolicyForProfile lean-mvp returns smaller budgets', () => {
  const policy = budgetPolicyForProfile('lean-mvp');
  assert.equal(policy.currency, 'USD');
  assert.equal(policy.run_budget_usd, 5);
  assert.equal(policy.daily_budget_usd, 20);
  assert.equal(policy.monthly_budget_usd, 150);
  assert.equal(policy.require_approval_above_usd, 10);
  // base fields still present
  assert.equal(policy.warn_at_percent, 70);
});

test('budgetPolicyForProfile enterprise-webapp returns larger budgets', () => {
  const policy = budgetPolicyForProfile('enterprise-webapp');
  assert.equal(policy.run_budget_usd, 25);
  assert.equal(policy.daily_budget_usd, 100);
  assert.equal(policy.monthly_budget_usd, 1500);
  assert.equal(policy.require_approval_above_usd, 50);
});

test('budgetPolicyForProfile returns default for unknown profile name', () => {
  const policy = budgetPolicyForProfile('unknown-profile');
  assert.equal(policy.run_budget_usd, 10);
  assert.equal(policy.require_approval_above_usd, 25);
});

test('budgetPolicyForProfile includes model_policy and stage_budgets', () => {
  const policy = budgetPolicyForProfile('business-flex');
  assert.ok(typeof policy.model_policy === 'object');
  assert.equal(policy.model_policy.default, 'balanced');
  assert.equal(policy.model_policy.architecture, 'strong');
  assert.ok(typeof policy.stage_budgets === 'object');
  assert.ok(policy.stage_budgets['07-code'] > 0);
  assert.ok(policy.stage_budgets['02-requirements'] > 0);
});

test('budgetPolicyForProfile with no argument defaults to business-flex base', () => {
  const policy = budgetPolicyForProfile();
  assert.equal(policy.run_budget_usd, 10);
  assert.equal(policy.currency, 'USD');
});

// ---------------------------------------------------------------------------
// loadProjectProfile
// ---------------------------------------------------------------------------

test('loadProjectProfile returns business-flex default when no config file exists', async () => {
  const root = tmpProject();
  try {
    const profile = await loadProjectProfile(root);
    assert.equal(profile.profile, 'business-flex');
    assert.ok(Array.isArray(profile.enabled_domains));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('loadProjectProfile reads profile from rstack.config.json', async () => {
  const root = tmpProject();
  try {
    mkdirSync(join(root, '.rstack'), { recursive: true });
    writeFileSync(join(root, '.rstack', 'rstack.config.json'), JSON.stringify({
      profile: 'lean-mvp',
    }));
    const profile = await loadProjectProfile(root);
    assert.equal(profile.profile, 'lean-mvp');
    assert.equal(profile.workflow, 'lean-mvp-sdlc');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('loadProjectProfile merges overrides from config file onto base profile', async () => {
  const root = tmpProject();
  try {
    mkdirSync(join(root, '.rstack'), { recursive: true });
    writeFileSync(join(root, '.rstack', 'rstack.config.json'), JSON.stringify({
      profile: 'business-flex',
      enabled_domains: ['product', 'backend'],
      dashboard_pages: ['command', 'business-flex'],
    }));
    const profile = await loadProjectProfile(root);
    assert.equal(profile.profile, 'business-flex');
    assert.deepEqual(profile.enabled_domains, ['product', 'backend']);
    assert.deepEqual(profile.dashboard_pages, ['command', 'business-flex']);
    // base agents still present (not overridden)
    assert.ok(Array.isArray(profile.enabled_agents));
    assert.ok(profile.enabled_agents.length > 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('loadProjectProfile falls back to business-flex on invalid JSON', async () => {
  const root = tmpProject();
  try {
    mkdirSync(join(root, '.rstack'), { recursive: true });
    writeFileSync(join(root, '.rstack', 'rstack.config.json'), 'not valid json }{');
    const profile = await loadProjectProfile(root);
    assert.equal(profile.profile, 'business-flex');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('loadProjectProfile resolves unknown profile name in config to business-flex base', async () => {
  const root = tmpProject();
  try {
    mkdirSync(join(root, '.rstack'), { recursive: true });
    writeFileSync(join(root, '.rstack', 'rstack.config.json'), JSON.stringify({
      profile: 'does-not-exist',
    }));
    const profile = await loadProjectProfile(root);
    // Unknown profile falls through to business-flex base
    assert.ok(Array.isArray(profile.enabled_domains));
    assert.ok(profile.enabled_domains.length > 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('loadProjectProfile uses base profile arrays when overrides are omitted', async () => {
  const root = tmpProject();
  try {
    mkdirSync(join(root, '.rstack'), { recursive: true });
    writeFileSync(join(root, '.rstack', 'rstack.config.json'), JSON.stringify({
      profile: 'enterprise-webapp',
      // no domain/agent/plugin overrides
    }));
    const profile = await loadProjectProfile(root);
    assert.equal(profile.profile, 'enterprise-webapp');
    const base = BUILT_IN_PROFILES['enterprise-webapp'];
    assert.deepEqual(profile.enabled_domains, base.enabled_domains);
    assert.deepEqual(profile.enabled_agents, base.enabled_agents);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// loadBudgetPolicy
// ---------------------------------------------------------------------------

test('loadBudgetPolicy returns profile defaults when no budget.json exists', async () => {
  const root = tmpProject();
  try {
    const policy = await loadBudgetPolicy(root, 'lean-mvp');
    assert.equal(policy.run_budget_usd, 5);
    assert.equal(policy.currency, 'USD');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('loadBudgetPolicy reads and merges budget.json overrides', async () => {
  const root = tmpProject();
  try {
    mkdirSync(join(root, '.rstack'), { recursive: true });
    writeFileSync(join(root, '.rstack', 'budget.json'), JSON.stringify({
      run_budget_usd: 99,
      currency: 'EUR',
    }));
    const policy = await loadBudgetPolicy(root, 'business-flex');
    assert.equal(policy.run_budget_usd, 99);
    assert.equal(policy.currency, 'EUR');
    // default fields still present
    assert.equal(policy.warn_at_percent, 70);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('loadBudgetPolicy deep-merges model_policy and stage_budgets', async () => {
  const root = tmpProject();
  try {
    mkdirSync(join(root, '.rstack'), { recursive: true });
    writeFileSync(join(root, '.rstack', 'budget.json'), JSON.stringify({
      model_policy: { builder: 'strong' },
      stage_budgets: { '07-code': 10 },
    }));
    const policy = await loadBudgetPolicy(root, 'business-flex');
    assert.equal(policy.model_policy.builder, 'strong');   // overridden
    assert.equal(policy.model_policy.default, 'balanced');  // base preserved
    assert.equal(policy.stage_budgets['07-code'], 10);      // overridden
    assert.ok(policy.stage_budgets['02-requirements'] > 0); // base preserved
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('loadBudgetPolicy falls back to defaults on invalid JSON', async () => {
  const root = tmpProject();
  try {
    mkdirSync(join(root, '.rstack'), { recursive: true });
    writeFileSync(join(root, '.rstack', 'budget.json'), '{ bad json');
    const policy = await loadBudgetPolicy(root, 'enterprise-webapp');
    assert.equal(policy.run_budget_usd, 25);
    assert.equal(policy.currency, 'USD');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('loadBudgetPolicy defaults to business-flex when profileName is omitted', async () => {
  const root = tmpProject();
  try {
    const policy = await loadBudgetPolicy(root);
    assert.equal(policy.run_budget_usd, 10);
    assert.equal(policy.require_approval_above_usd, 25);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// budgetEnvelopeForTask
// ---------------------------------------------------------------------------

test('budgetEnvelopeForTask returns envelope with fallback when no stage_artifacts', () => {
  const task = { id: 'test-task' };
  const policy = budgetPolicyForProfile('business-flex');
  const envelope = budgetEnvelopeForTask(task, policy);
  assert.equal(envelope.currency, 'USD');
  assert.ok(typeof envelope.estimated_ai_cost_usd === 'number');
  assert.ok(envelope.estimated_ai_cost_usd > 0); // fallback = run_budget / 8 = 1.25
  assert.equal(envelope.approval_required_above_usd, 25);
  assert.equal(envelope.warn_at_percent, 70);
  assert.equal(envelope.block_at_percent, 100);
  assert.ok(typeof envelope.model_policy === 'object');
  assert.ok(typeof envelope.stage_budgets === 'object');
});

test('budgetEnvelopeForTask sums stage budgets from stage_artifacts', () => {
  const task = {
    id: 'test-task',
    stage_artifacts: [
      { stage_id: '07-code' },
      { stage_id: '08-testing' },
    ],
  };
  const policy = budgetPolicyForProfile('business-flex');
  const envelope = budgetEnvelopeForTask(task, policy);
  // 07-code = 4, 08-testing = 2 → 6
  assert.equal(envelope.estimated_ai_cost_usd, 6);
  assert.deepEqual(envelope.stage_budgets, { '07-code': 4, '08-testing': 2 });
});

test('budgetEnvelopeForTask filters out stage_artifacts without stage_id', () => {
  const task = {
    id: 'test-task',
    stage_artifacts: [
      { stage_id: '06-architecture' },
      { path: 'no-stage-id.json' }, // no stage_id
    ],
  };
  const policy = budgetPolicyForProfile('business-flex');
  const envelope = budgetEnvelopeForTask(task, policy);
  assert.equal(envelope.estimated_ai_cost_usd, 2); // only 06-architecture = 2
  assert.deepEqual(envelope.stage_budgets, { '06-architecture': 2 });
});

test('budgetEnvelopeForTask uses fallback when stage_artifacts present but no matching stage budgets', () => {
  const task = {
    id: 'test-task',
    stage_artifacts: [
      { stage_id: 'non-existent-stage' },
    ],
  };
  const policy = budgetPolicyForProfile('business-flex'); // run_budget_usd = 10
  const envelope = budgetEnvelopeForTask(task, policy);
  // stageBudget = 0, fallback = 10/8 = 1.25
  assert.equal(envelope.estimated_ai_cost_usd, 1.25);
});

test('budgetEnvelopeForTask uses default policy when no policy argument provided', () => {
  const task = {};
  const envelope = budgetEnvelopeForTask(task);
  assert.equal(envelope.currency, 'USD');
  assert.ok(typeof envelope.estimated_ai_cost_usd === 'number');
  assert.equal(envelope.approval_required_above_usd, 25);
});

test('budgetEnvelopeForTask approval_required_above_usd varies by profile', () => {
  const task = {};
  const leanPolicy = budgetPolicyForProfile('lean-mvp');
  const enterprisePolicy = budgetPolicyForProfile('enterprise-webapp');
  assert.equal(budgetEnvelopeForTask(task, leanPolicy).approval_required_above_usd, 10);
  assert.equal(budgetEnvelopeForTask(task, enterprisePolicy).approval_required_above_usd, 50);
});

test('budgetEnvelopeForTask rounds estimated cost to 2 decimal places', () => {
  const task = { stage_artifacts: [{ stage_id: '07-code' }] };
  const policy = { ...budgetPolicyForProfile('business-flex'), stage_budgets: { '07-code': 1.3333333 } };
  const envelope = budgetEnvelopeForTask(task, policy);
  const str = String(envelope.estimated_ai_cost_usd);
  const decimals = str.includes('.') ? str.split('.')[1].length : 0;
  assert.ok(decimals <= 2, `expected at most 2 decimal places, got ${str}`);
});
