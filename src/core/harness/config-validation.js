// owner: RStack developed by Richardson Gunde
//
// Config validation (#151): every .rstack/*.json config is checked on load
// so a typo'd budget or malformed policy produces an actionable warning
// naming the file and field — never a silently-applied default the user
// believes is active. Transparency first.

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { DEFAULT_HARNESS_GUARDRAILS } from './guardrails.js';
import { DEFAULT_LOOP_BOUNDS, LOOP_HARD_CAP } from './goal-loop.js';
import { DEFAULT_CRITICAL_STAGE_IDS } from './checkpoints.js';
import { getCanonicalStage } from './stages.js';
import { rstackStateDir } from './runs.js';

const KNOWN_PROFILES = ['business-flex', 'enterprise-webapp', 'lean-mvp'];
const KNOWN_CHANNELS = ['slack', 'teams', 'discord', 'telegram', 'whatsapp'];
const MEMORY_WRITE_POLICIES = ['validator-approved-only', 'validation-attempts'];
const NUMERIC_BUDGET_FIELDS = ['run_budget_usd', 'daily_budget_usd', 'monthly_budget_usd', 'require_approval_above_usd'];

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonNegativeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0;
}

export function validateRstackConfig(parsed) {
  const issues = [];
  if (parsed.profile != null && !KNOWN_PROFILES.includes(parsed.profile)) {
    issues.push({ field: 'profile', problem: `unknown profile "${parsed.profile}" — expected ${KNOWN_PROFILES.join(' | ')}` });
  }
  if (parsed.guardrails != null) {
    if (!isPlainObject(parsed.guardrails)) {
      issues.push({ field: 'guardrails', problem: 'must be an object of guardrail overrides' });
    } else {
      for (const [key, value] of Object.entries(parsed.guardrails)) {
        if (!(key in DEFAULT_HARNESS_GUARDRAILS)) {
          issues.push({ field: `guardrails.${key}`, problem: 'unknown guardrail key — this override is ignored' });
          continue;
        }
        const defaultValue = DEFAULT_HARNESS_GUARDRAILS[key];
        if (typeof defaultValue === 'number' && !isNonNegativeNumber(value)) {
          issues.push({ field: `guardrails.${key}`, problem: `must be a non-negative number, got ${JSON.stringify(value)} — the default (${defaultValue}) applies` });
        }
        if (typeof defaultValue === 'boolean' && typeof value !== 'boolean' && value !== 'true' && value !== 'false') {
          issues.push({ field: `guardrails.${key}`, problem: `must be a boolean, got ${JSON.stringify(value)} — the default (${defaultValue}) applies` });
        }
      }
    }
  }
  if (parsed.loop != null) {
    if (!isPlainObject(parsed.loop)) {
      issues.push({ field: 'loop', problem: 'must be an object of goal-loop bound overrides' });
    } else {
      for (const [key, value] of Object.entries(parsed.loop)) {
        if (!(key in DEFAULT_LOOP_BOUNDS)) {
          issues.push({ field: `loop.${key}`, problem: 'unknown loop bound key — this override is ignored' });
          continue;
        }
        const parsedValue = Number(value);
        if (!Number.isFinite(parsedValue) || parsedValue < 1) {
          issues.push({ field: `loop.${key}`, problem: `must be a number >= 1, got ${JSON.stringify(value)} — the default (${DEFAULT_LOOP_BOUNDS[key]}) applies` });
        } else if (key === 'maxIterations' && parsedValue > LOOP_HARD_CAP) {
          issues.push({ field: 'loop.maxIterations', problem: `exceeds the hard cap of ${LOOP_HARD_CAP} — it will be clamped to ${LOOP_HARD_CAP}` });
        }
      }
    }
  }
  if (parsed.checkpoints != null) {
    if (!isPlainObject(parsed.checkpoints)) {
      issues.push({ field: 'checkpoints', problem: 'must be an object of checkpoint settings' });
    } else {
      for (const key of Object.keys(parsed.checkpoints)) {
        if (key !== 'critical_stages') {
          issues.push({ field: `checkpoints.${key}`, problem: 'unknown checkpoint key — this setting is ignored' });
        }
      }
      const criticalStages = parsed.checkpoints.critical_stages;
      if (criticalStages != null) {
        if (!Array.isArray(criticalStages)) {
          issues.push({ field: 'checkpoints.critical_stages', problem: `must be an array of canonical stage ids — the default (${DEFAULT_CRITICAL_STAGE_IDS.join(', ')}) applies` });
        } else {
          for (const stageId of criticalStages) {
            if (typeof stageId !== 'string' || !getCanonicalStage(stageId)) {
              issues.push({ field: 'checkpoints.critical_stages', problem: `${JSON.stringify(stageId)} is not a canonical stage id (plan task ids are not stage ids) — this entry is ignored` });
            }
          }
        }
      }
    }
  }
  return issues;
}

export function validateBudgetConfig(parsed) {
  const issues = [];
  for (const field of NUMERIC_BUDGET_FIELDS) {
    if (parsed[field] != null && !isNonNegativeNumber(parsed[field])) {
      issues.push({ field, problem: `must be a non-negative number, got ${JSON.stringify(parsed[field])} — budget guardrails will NOT use this value` });
    }
  }
  if (parsed.stage_budgets != null) {
    if (!isPlainObject(parsed.stage_budgets)) {
      issues.push({ field: 'stage_budgets', problem: 'must be an object of stage-id -> number' });
    } else {
      for (const [stageId, value] of Object.entries(parsed.stage_budgets)) {
        if (!isNonNegativeNumber(value)) {
          issues.push({ field: `stage_budgets.${stageId}`, problem: `must be a non-negative number, got ${JSON.stringify(value)}` });
        }
      }
    }
  }
  return issues;
}

export function validateNotificationsConfig(parsed) {
  const issues = [];
  if (parsed.channels != null) {
    if (!isPlainObject(parsed.channels)) {
      issues.push({ field: 'channels', problem: 'must be an object keyed by channel name' });
      return issues;
    }
    for (const [name, config] of Object.entries(parsed.channels)) {
      if (!KNOWN_CHANNELS.includes(name)) {
        issues.push({ field: `channels.${name}`, problem: `unknown channel — expected ${KNOWN_CHANNELS.join(' | ')}; this channel is ignored` });
      } else if (!isPlainObject(config)) {
        issues.push({ field: `channels.${name}`, problem: 'must be an object with the channel credentials (e.g. webhook)' });
      }
    }
  }
  return issues;
}

export function validatePolicyConfig(parsed) {
  const issues = [];
  if (parsed.required_approvals != null) {
    if (!isPlainObject(parsed.required_approvals)) {
      issues.push({ field: 'required_approvals', problem: 'must be an object of task-id -> [artifact, ...]' });
    } else {
      for (const [taskId, artifacts] of Object.entries(parsed.required_approvals)) {
        if (!Array.isArray(artifacts) || artifacts.some((artifact) => typeof artifact !== 'string' || !artifact.trim())) {
          issues.push({ field: `required_approvals.${taskId}`, problem: 'must be an array of non-empty artifact names — this gate will NOT be enforced as written' });
        }
      }
    }
  }
  if (parsed.enforce_in_express != null && typeof parsed.enforce_in_express !== 'boolean') {
    issues.push({ field: 'enforce_in_express', problem: `must be a boolean, got ${JSON.stringify(parsed.enforce_in_express)}` });
  }
  if (parsed.managers != null && (!Array.isArray(parsed.managers) || parsed.managers.some((manager) => typeof manager !== 'string' || !manager.trim()))) {
    issues.push({ field: 'managers', problem: 'must be an array of non-empty manager names/emails' });
  }
  return issues;
}

export function validateMemoryConfig(parsed) {
  const issues = [];
  if (parsed.writePolicy != null && !MEMORY_WRITE_POLICIES.includes(parsed.writePolicy)) {
    issues.push({ field: 'writePolicy', problem: `unknown write policy "${parsed.writePolicy}" — expected ${MEMORY_WRITE_POLICIES.join(' | ')}; the default applies` });
  }
  return issues;
}

const CONFIG_FILES = [
  { name: 'rstack.config.json', validate: validateRstackConfig },
  { name: 'budget.json', validate: validateBudgetConfig },
  { name: 'notifications.json', validate: validateNotificationsConfig },
  { name: 'policy.json', validate: validatePolicyConfig },
  { name: 'memory-config.json', validate: validateMemoryConfig },
];

export async function validateProjectConfigs(projectRoot, { warn = false } = {}) {
  const stateDir = rstackStateDir(projectRoot);
  const problems = [];

  for (const { name, validate } of CONFIG_FILES) {
    const filePath = join(stateDir, name);
    if (!existsSync(filePath)) continue;
    const displayPath = join('.rstack', name);

    let parsed;
    try {
      parsed = JSON.parse(await readFile(filePath, 'utf8'));
    } catch (error) {
      problems.push({ file: displayPath, field: null, problem: `malformed JSON: ${error.message} — defaults apply` });
      continue;
    }
    if (!isPlainObject(parsed)) {
      problems.push({ file: displayPath, field: null, problem: 'must be a JSON object — defaults apply' });
      continue;
    }
    for (const found of validate(parsed)) {
      problems.push({ file: displayPath, ...found });
    }
  }

  if (warn) {
    for (const problem of problems) {
      console.error(`[rstack] config issue in ${problem.file}${problem.field ? ` (${problem.field})` : ''}: ${problem.problem}`);
    }
  }
  return problems;
}
