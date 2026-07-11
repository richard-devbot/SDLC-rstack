// owner: RStack developed by Richardson Gunde

import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import {
  validateBudgetConfig,
  validateRstackConfig,
} from '../../../core/harness/config-validation.js';
import { profileConfig } from '../../../core/profiles.js';

const PROFILE_SOURCE = '.rstack/rstack.config.json';
const BUDGET_SOURCE = '.rstack/budget.json';
const AVAILABILITY_PRIORITY = {
  configured: 0,
  missing: 1,
  invalid: 2,
  inaccessible: 3,
};

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function fileIssue(problem) {
  return [{ field: null, problem }];
}

async function readPolicyFile(root, sourcePath, io) {
  try {
    const text = await io.readFile(join(root, sourcePath), 'utf8');
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      return {
        availability: 'invalid',
        parsed: null,
        issues: fileIssue(`malformed JSON: ${error.message} — values are not active`),
      };
    }
    if (!isPlainObject(parsed)) {
      return {
        availability: 'invalid',
        parsed: null,
        issues: fileIssue('must be a JSON object — values are not active'),
      };
    }
    return { availability: 'configured', parsed, issues: [] };
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { availability: 'missing', parsed: null, issues: [] };
    }
    if (error?.code === 'EACCES' || error?.code === 'EPERM') {
      return {
        availability: 'inaccessible',
        parsed: null,
        issues: fileIssue(`cannot read ${sourcePath}: ${error.message}`),
      };
    }
    return {
      availability: 'inaccessible',
      parsed: null,
      issues: fileIssue(`cannot load ${sourcePath}: ${error?.message ?? String(error)}`),
    };
  }
}

function emptyProfile(availability, issues = []) {
  return {
    availability,
    id: null,
    name: null,
    workflow: null,
    enabledDomains: [],
    enabledAgents: [],
    enabledPlugins: [],
    dashboardPages: [],
    sourcePath: PROFILE_SOURCE,
    issues,
  };
}

async function readProfilePolicy(root, io) {
  const file = await readPolicyFile(root, PROFILE_SOURCE, io);
  if (file.availability !== 'configured') {
    return emptyProfile(file.availability, file.issues);
  }
  const issues = validateRstackConfig(file.parsed);
  if (issues.length) return emptyProfile('invalid', issues);

  const id = file.parsed.profile || file.parsed.name || 'business-flex';
  const builtIn = profileConfig(id);
  const merged = { ...builtIn, ...file.parsed };
  return {
    availability: 'configured',
    id,
    name: merged.name || id,
    workflow: merged.workflow || 'unknown',
    enabledDomains: [...(merged.enabled_domains || [])],
    enabledAgents: [...(merged.enabled_agents || [])],
    enabledPlugins: [...(merged.enabled_plugins || [])],
    dashboardPages: [...(merged.dashboard_pages || [])],
    sourcePath: PROFILE_SOURCE,
    issues: [],
  };
}

function emptyBudget(availability, issues = []) {
  return {
    availability,
    currency: null,
    runBudgetUsd: null,
    dailyBudgetUsd: null,
    monthlyBudgetUsd: null,
    sourcePath: BUDGET_SOURCE,
    issues,
  };
}

function optionalBudgetValue(value) {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

async function readBudgetPolicy(root, io) {
  const file = await readPolicyFile(root, BUDGET_SOURCE, io);
  if (file.availability !== 'configured') {
    return emptyBudget(file.availability, file.issues);
  }
  const issues = validateBudgetConfig(file.parsed);
  if (issues.length) return emptyBudget('invalid', issues);
  return {
    availability: 'configured',
    currency: typeof file.parsed.currency === 'string' && file.parsed.currency
      ? file.parsed.currency
      : 'USD',
    runBudgetUsd: optionalBudgetValue(file.parsed.run_budget_usd),
    dailyBudgetUsd: optionalBudgetValue(file.parsed.daily_budget_usd),
    monthlyBudgetUsd: optionalBudgetValue(file.parsed.monthly_budget_usd),
    sourcePath: BUDGET_SOURCE,
    issues: [],
  };
}

function combinedAvailability(...values) {
  return values.reduce((current, value) => (
    AVAILABILITY_PRIORITY[value] > AVAILABILITY_PRIORITY[current] ? value : current
  ), 'configured');
}

export async function readConfiguredPolicies(roots, descriptors, options = {}) {
  const io = options.io ?? { readFile };
  const loadedAt = new Date(options.now ?? Date.now()).toISOString();
  return {
    projects: await Promise.all((roots ?? []).map(async (root) => {
      const descriptor = (descriptors ?? []).find((item) => item.root === root);
      const [profile, budget] = await Promise.all([
        readProfilePolicy(root, io),
        readBudgetPolicy(root, io),
      ]);
      return {
        projectId: descriptor?.id ?? null,
        projectRoot: root,
        projectName: descriptor?.name ?? basename(root),
        worktreeName: descriptor?.worktreeName ?? null,
        availability: combinedAvailability(profile.availability, budget.availability),
        profile,
        budget,
        loadedAt,
      };
    })),
  };
}

