import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// owner: RStack developed by Richardson Gunde

export const BUILT_IN_PROFILES = Object.freeze({
  'business-flex': {
    profile: 'business-flex',
    name: 'Business Flex Delivery',
    description: 'Client-facing governed SDLC for business teams: requirements, budget, routing, evidence, dashboard visibility.',
    enabled_domains: ['product', 'docs', 'backend', 'frontend', 'qa', 'security', 'devops', 'sdlc'],
    enabled_agents: [
      'business-analyst',
      'product-manager',
      'project-manager',
      'backend-architect',
      'frontend-developer',
      'test-automator',
      'security-auditor',
      'compliance-auditor',
      'deployment-engineer',
      'technical-writer',
    ],
    enabled_plugins: [
      'business-analytics',
      'backend-development',
      'frontend-mobile-development',
      'unit-testing',
      'security-scanning',
      'cicd-automation',
      'documentation-generation',
    ],
    workflow: 'production-business-sdlc',
    dashboard_pages: ['command', 'business-flex', 'workflow', 'studio', 'run-report', 'agent-work', 'live-feed', 'approvals', 'team-layers'],
    business_stage_order: [
      '02-requirements',
      '00-environment',
      '06-architecture',
      '03-documentation',
      '04-planning',
      '05-jira',
      '07-code',
      '08-testing',
      '09-deployment',
      '10-summary',
      '11-feedback-loop',
      '12-security-threat-model',
      '13-compliance-checker',
      '14-cost-estimation',
    ],
  },
  'enterprise-webapp': {
    profile: 'enterprise-webapp',
    name: 'Enterprise Web App',
    description: 'Governed web application delivery with backend, frontend, security, compliance, CI/CD, and docs.',
    enabled_domains: ['product', 'frontend', 'backend', 'qa', 'security', 'devops', 'docs'],
    enabled_agents: ['business-analyst', 'solution-architect', 'backend-architect', 'frontend-developer', 'test-automator', 'security-auditor', 'deployment-engineer'],
    enabled_plugins: ['backend-development', 'frontend-mobile-development', 'security-scanning', 'cicd-automation', 'documentation-generation'],
    workflow: 'enterprise-webapp-sdlc',
    dashboard_pages: ['command', 'business-flex', 'workflow', 'studio', 'run-report', 'approvals', 'alerts-guardrails'],
    business_stage_order: ['02-requirements', '00-environment', '06-architecture', '04-planning', '05-jira', '07-code', '08-testing', '09-deployment', '12-security-threat-model', '13-compliance-checker', '14-cost-estimation'],
  },
  'lean-mvp': {
    profile: 'lean-mvp',
    name: 'Lean MVP',
    description: 'Smallest useful SDLC path for prototypes and MVPs while preserving evidence and cost visibility.',
    enabled_domains: ['product', 'backend', 'frontend', 'qa', 'docs'],
    enabled_agents: ['business-analyst', 'product-manager', 'fullstack-developer', 'test-automator', 'technical-writer'],
    enabled_plugins: ['business-analytics', 'full-stack-orchestration', 'unit-testing', 'documentation-generation'],
    workflow: 'lean-mvp-sdlc',
    dashboard_pages: ['command', 'business-flex', 'workflow', 'agent-work', 'live-feed'],
    business_stage_order: ['02-requirements', '00-environment', '06-architecture', '04-planning', '07-code', '08-testing', '10-summary', '14-cost-estimation'],
  },
});

export function profileConfig(name = 'business-flex') {
  const profile = BUILT_IN_PROFILES[name] || BUILT_IN_PROFILES['business-flex'];
  return JSON.parse(JSON.stringify(profile));
}

export function budgetPolicyForProfile(name = 'business-flex') {
  const base = {
    currency: 'USD',
    run_budget_usd: 10,
    daily_budget_usd: 50,
    monthly_budget_usd: 500,
    warn_at_percent: 70,
    block_at_percent: 100,
    require_approval_above_usd: 25,
    model_policy: {
      default: 'balanced',
      requirements: 'balanced',
      architecture: 'strong',
      builder: 'balanced',
      validator: 'balanced',
      retry_escalation: 'strong',
    },
    stage_budgets: {
      '02-requirements': 1,
      '06-architecture': 2,
      '07-code': 4,
      '08-testing': 2,
      '12-security-threat-model': 1,
      '13-compliance-checker': 1,
      '14-cost-estimation': 1,
    },
  };

  if (name === 'lean-mvp') {
    return { ...base, run_budget_usd: 5, daily_budget_usd: 20, monthly_budget_usd: 150, require_approval_above_usd: 10 };
  }
  if (name === 'enterprise-webapp') {
    return { ...base, run_budget_usd: 25, daily_budget_usd: 100, monthly_budget_usd: 1500, require_approval_above_usd: 50 };
  }
  return base;
}

export async function loadProjectProfile(projectRoot) {
  const configPath = join(projectRoot, '.rstack', 'rstack.config.json');
  if (!existsSync(configPath)) return profileConfig('business-flex');
  try {
    const parsed = JSON.parse(await readFile(configPath, 'utf8'));
    const base = profileConfig(parsed.profile || parsed.name || 'business-flex');
    return {
      ...base,
      ...parsed,
      enabled_domains: parsed.enabled_domains || base.enabled_domains,
      enabled_agents: parsed.enabled_agents || base.enabled_agents,
      enabled_plugins: parsed.enabled_plugins || base.enabled_plugins,
      dashboard_pages: parsed.dashboard_pages || base.dashboard_pages,
      business_stage_order: parsed.business_stage_order || base.business_stage_order,
    };
  } catch {
    return profileConfig('business-flex');
  }
}

export async function loadBudgetPolicy(projectRoot, profileName = 'business-flex') {
  const budgetPath = join(projectRoot, '.rstack', 'budget.json');
  const defaults = budgetPolicyForProfile(profileName);
  if (!existsSync(budgetPath)) return defaults;
  try {
    const parsed = JSON.parse(await readFile(budgetPath, 'utf8'));
    return {
      ...defaults,
      ...parsed,
      model_policy: { ...defaults.model_policy, ...(parsed.model_policy || {}) },
      stage_budgets: { ...defaults.stage_budgets, ...(parsed.stage_budgets || {}) },
    };
  } catch {
    return defaults;
  }
}

export function budgetEnvelopeForTask(task, budgetPolicy = budgetPolicyForProfile()) {
  const stageIds = (task.stage_artifacts || []).map((artifact) => artifact.stage_id).filter(Boolean);
  const stageBudget = stageIds.reduce((sum, stageId) => sum + Number(budgetPolicy.stage_budgets?.[stageId] || 0), 0);
  // #404: the run budget is now spread across the 15 canonical stage tasks
  // (previously 8 bundled missions) when no per-stage budget is configured.
  const fallback = Number(budgetPolicy.run_budget_usd || 0) / 15;
  return {
    currency: budgetPolicy.currency || 'USD',
    estimated_ai_cost_usd: Math.round((stageBudget || fallback) * 100) / 100,
    approval_required_above_usd: Number(budgetPolicy.require_approval_above_usd || 0),
    warn_at_percent: Number(budgetPolicy.warn_at_percent || 70),
    block_at_percent: Number(budgetPolicy.block_at_percent || 100),
    model_policy: budgetPolicy.model_policy || {},
    stage_budgets: stageIds.reduce((acc, stageId) => {
      acc[stageId] = Number(budgetPolicy.stage_budgets?.[stageId] || 0);
      return acc;
    }, {}),
  };
}
