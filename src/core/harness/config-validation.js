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
// #136 (BLE-6.2): context-pressure thresholds live in rstack.config.json under
// `context_pressure`; validated field-by-field like every other block.
import { validateContextPressureConfig } from './context-pressure.js';
// #159: parallel-groups config validation (data-independence + gate target).
import { validateParallelGroupsConfig } from './parallel-benchmark.js';
// #72: review_policy field rules live next to the defaults they guard.
import { validateReviewPolicyConfig } from './review-independence.js';
// #78: enabled_packs rules live next to the pack registry they check.
import { validateEnabledPacksConfig } from '../packs.js';

const KNOWN_PROFILES = ['business-flex', 'enterprise-webapp', 'lean-mvp'];
const KNOWN_CHANNELS = ['slack', 'teams', 'discord', 'telegram', 'whatsapp', 'email'];
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
  // #136 (BLE-6.2): context-pressure warning thresholds. Additive block —
  // validated via the classifier module so the field rules live next to the
  // defaults they guard.
  if (parsed.context_pressure != null) {
    issues.push(...validateContextPressureConfig(parsed.context_pressure));
  }
  // #159: parallel_groups block — data-independence of each group + gate target.
  if (parsed.parallel_groups != null) {
    for (const found of validateParallelGroupsConfig(parsed.parallel_groups)) {
      issues.push(found);
    }
  }
  // #78: governance packs — unknown names are named, never silently ignored.
  if (parsed.enabled_packs != null) {
    issues.push(...validateEnabledPacksConfig(parsed.enabled_packs));
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

// #353: the email channel + people layer. Recipient addresses are checked
// for basic shape only, and any credential-shaped key is a hard error — the
// ACS access key lives ONLY in RSTACK_ACS_CONNECTION_STRING (env), never in
// this committable file. `access[_-]?key` / `connection[_-]?string` extend
// the SECRETISH_KEY pattern because they are the exact ACS secret shapes.
const NOTIFICATIONS_SECRETISH_KEY = /token|secret|password|api[_-]?key|credential|access[_-]?key|connection[_-]?string/i;
const EMAIL_ADDRESS_SHAPE = /.+@.+\..+/;
const EMAIL_CHANNEL_FIELDS = ['endpoint', 'sender'];
const RECIPIENT_FIELDS = ['name', 'email'];

function validateEmailChannel(config, issues) {
  for (const [key, value] of Object.entries(config)) {
    if (key.startsWith('_')) continue;
    if (NOTIFICATIONS_SECRETISH_KEY.test(key)) {
      issues.push({ field: `channels.email.${key}`, problem: 'credential-shaped key — the ACS access key belongs in the RSTACK_ACS_CONNECTION_STRING environment variable, NEVER in .rstack/notifications.json; remove this field' });
      continue;
    }
    if (!EMAIL_CHANNEL_FIELDS.includes(key)) {
      issues.push({ field: `channels.email.${key}`, problem: `unknown key — expected ${EMAIL_CHANNEL_FIELDS.join(' | ')}; this key is ignored` });
      continue;
    }
    if (typeof value !== 'string' || !value.trim()) {
      issues.push({ field: `channels.email.${key}`, problem: `must be a non-empty string, got ${JSON.stringify(value)}` });
    }
  }
  if (typeof config.sender === 'string' && config.sender.trim() && !EMAIL_ADDRESS_SHAPE.test(config.sender)) {
    issues.push({ field: 'channels.email.sender', problem: `"${config.sender}" does not look like an email address (name@host.tld) — ACS will reject sends from it` });
  }
}

function validateRecipients(recipients, issues) {
  if (!isPlainObject(recipients)) {
    issues.push({ field: 'recipients', problem: 'must be an object of role -> { name?, email } (role names are free-form, e.g. manager / team_lead / developer / tester / cicd)' });
    return;
  }
  for (const [role, entry] of Object.entries(recipients)) {
    if (role.startsWith('_')) continue;
    if (NOTIFICATIONS_SECRETISH_KEY.test(role)) {
      issues.push({ field: `recipients.${role}`, problem: 'credential-shaped key — secrets belong in environment variables, NEVER in .rstack/notifications.json; remove this field' });
      continue;
    }
    if (!isPlainObject(entry)) {
      issues.push({ field: `recipients.${role}`, problem: `must be an object like { "name": "Priya", "email": "priya@example.com" }, got ${JSON.stringify(entry)}` });
      continue;
    }
    for (const key of Object.keys(entry)) {
      if (key.startsWith('_')) continue;
      if (NOTIFICATIONS_SECRETISH_KEY.test(key)) {
        issues.push({ field: `recipients.${role}.${key}`, problem: 'credential-shaped key — secrets belong in environment variables, NEVER in .rstack/notifications.json; remove this field' });
      } else if (!RECIPIENT_FIELDS.includes(key)) {
        issues.push({ field: `recipients.${role}.${key}`, problem: `unknown key — expected ${RECIPIENT_FIELDS.join(' | ')}; this key is ignored` });
      }
    }
    if (typeof entry.email !== 'string' || !EMAIL_ADDRESS_SHAPE.test(entry.email)) {
      issues.push({ field: `recipients.${role}.email`, problem: `must be an email address (name@host.tld), got ${JSON.stringify(entry.email)} — this recipient can NEVER receive approval mail` });
    }
    if (entry.name != null && typeof entry.name !== 'string') {
      issues.push({ field: `recipients.${role}.name`, problem: `must be a string, got ${JSON.stringify(entry.name)}` });
    }
  }
}

// The #228 lesson: a route whose roles all miss the recipients map is the
// silent-failure mode here — the approval email NEVER sends — so it warns
// with the exact resolution outcome, never fails silently.
function validateRouting(routing, recipients, issues) {
  if (!isPlainObject(routing)) {
    issues.push({ field: 'routing', problem: 'must be an object of pattern -> [role, ...] (patterns: exact artifact names, guardrail-override:* / stage-approval:* / destructive-action:* wildcards, or canonical stage ids)' });
    return;
  }
  const knownRoles = isPlainObject(recipients) ? Object.keys(recipients) : [];
  for (const [pattern, roles] of Object.entries(routing)) {
    if (pattern.startsWith('_')) continue;
    if (!Array.isArray(roles) || roles.some((role) => typeof role !== 'string' || !role.trim())) {
      issues.push({ field: `routing.${pattern}`, problem: `must be an array of non-empty role names, got ${JSON.stringify(roles)} — this route will NOT send as written` });
      continue;
    }
    const missing = roles.filter((role) => !knownRoles.includes(role));
    if (missing.length === roles.length && roles.length > 0) {
      issues.push({ field: `routing.${pattern}`, problem: `none of [${roles.join(', ')}] exist in recipients — this route resolves to NOBODY and the approval email will never send` });
    } else if (missing.length > 0) {
      issues.push({ field: `routing.${pattern}`, problem: `role(s) ${missing.join(', ')} not found in recipients — those roles resolve to nobody` });
    }
  }
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
      } else if (name === 'email') {
        validateEmailChannel(config, issues);
      }
    }
  }
  if (parsed.recipients != null) validateRecipients(parsed.recipients, issues);
  if (parsed.routing != null) validateRouting(parsed.routing, parsed.recipients, issues);
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
  // #228: stage-keyed gates. Unknown stage ids are the silent-failure mode
  // here — the gate keyed to a typo'd stage never fires — so they warn with
  // the exact canonical form expected.
  if (parsed.required_stage_approvals != null) {
    if (!isPlainObject(parsed.required_stage_approvals)) {
      issues.push({ field: 'required_stage_approvals', problem: 'must be an object of canonical-stage-id -> [artifact, ...] (e.g. "07-code": ["architecture.md"])' });
    } else {
      for (const [stageId, artifacts] of Object.entries(parsed.required_stage_approvals)) {
        if (!getCanonicalStage(stageId)) {
          issues.push({ field: `required_stage_approvals.${stageId}`, problem: 'unknown canonical stage id — this gate will NEVER fire; use a canonical 00-14 stage id like "07-code"' });
        }
        if (!Array.isArray(artifacts) || artifacts.some((artifact) => typeof artifact !== 'string' || !artifact.trim())) {
          issues.push({ field: `required_stage_approvals.${stageId}`, problem: 'must be an array of non-empty artifact names — this gate will NOT be enforced as written' });
        }
      }
    }
  }
  if (parsed.approvals != null) {
    if (!isPlainObject(parsed.approvals)) {
      issues.push({ field: 'approvals', problem: 'must be an object (e.g. { "every_stage": true })' });
    } else if (parsed.approvals.every_stage != null && parsed.approvals.every_stage !== true && parsed.approvals.every_stage !== false) {
      issues.push({ field: 'approvals.every_stage', problem: `must be a boolean, got ${JSON.stringify(parsed.approvals.every_stage)} — only the literal true enables the blanket per-stage gate` });
    }
  }
  if (parsed.enforce_in_express != null && typeof parsed.enforce_in_express !== 'boolean') {
    issues.push({ field: 'enforce_in_express', problem: `must be a boolean, got ${JSON.stringify(parsed.enforce_in_express)}` });
  }
  // #285: cockpit-controls opt-in. Only the literal true enables state-changing
  // hub controls; a typo'd key silently leaves the feature OFF, so warn.
  if (parsed.cockpit_controls != null) {
    if (!isPlainObject(parsed.cockpit_controls)) {
      issues.push({ field: 'cockpit_controls', problem: 'must be an object (e.g. { "enabled": true })' });
    } else if (parsed.cockpit_controls.enabled != null && typeof parsed.cockpit_controls.enabled !== 'boolean') {
      issues.push({ field: 'cockpit_controls.enabled', problem: `must be a boolean, got ${JSON.stringify(parsed.cockpit_controls.enabled)} — only the literal true enables cockpit controls` });
    }
  }
  if (parsed.managers != null && (!Array.isArray(parsed.managers) || parsed.managers.some((manager) => typeof manager !== 'string' || !manager.trim()))) {
    issues.push({ field: 'managers', problem: 'must be an array of non-empty manager names/emails' });
  }
  // #72: cross-harness review independence policy block.
  if (parsed.review_policy != null) {
    issues.push(...validateReviewPolicyConfig(parsed.review_policy));
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

// #237: .rstack/integrations.json — endpoints and identifiers ONLY, so the
// file is safe to commit. Credential-shaped keys are a hard validation error
// (secrets belong in .env), enforced BEFORE any shape leniency. Keys starting
// with "_" are comment slots and always ignored.
export const INTEGRATION_TICKETING_PROVIDERS = Object.freeze(['jira', 'github', 'azure_devops', 'linear', 'file-based']);
export const INTEGRATION_DOCS_PROVIDERS = Object.freeze(['confluence', 'none']);
export const INTEGRATION_NOTIFICATION_CHANNELS = Object.freeze(['slack', 'teams', 'discord', 'none']);
const SECRETISH_KEY = /token|secret|password|api[_-]?key|credential/i;

function collectSecretKeyIssues(value, path, issues) {
  if (!isPlainObject(value)) return;
  for (const [key, nested] of Object.entries(value)) {
    if (key.startsWith('_')) continue;
    const fieldPath = path ? `${path}.${key}` : key;
    if (SECRETISH_KEY.test(key)) {
      issues.push({ field: fieldPath, problem: 'credential-shaped key — secrets belong in .env (e.g. JIRA_API_TOKEN as an environment variable), NEVER in .rstack/integrations.json; remove this field' });
      continue;
    }
    collectSecretKeyIssues(nested, fieldPath, issues);
  }
}

function checkIntegrationSection(parsed, section, knownFields, issues) {
  const value = parsed[section];
  if (value == null) return null;
  if (!isPlainObject(value)) {
    issues.push({ field: section, problem: 'must be an object — this section is ignored' });
    return null;
  }
  for (const [key, fieldValue] of Object.entries(value)) {
    if (key.startsWith('_') || SECRETISH_KEY.test(key)) continue; // secret keys already reported above
    if (!(key in knownFields)) {
      issues.push({ field: `${section}.${key}`, problem: `unknown key — expected ${Object.keys(knownFields).join(' | ')}; this key is ignored` });
      continue;
    }
    const allowed = knownFields[key];
    if (typeof fieldValue !== 'string' || !fieldValue.trim()) {
      issues.push({ field: `${section}.${key}`, problem: `must be a non-empty string, got ${JSON.stringify(fieldValue)}` });
    } else if (Array.isArray(allowed) && !allowed.includes(fieldValue)) {
      issues.push({ field: `${section}.${key}`, problem: `unknown value "${fieldValue}" — expected ${allowed.join(' | ')}` });
    }
  }
  return value;
}

export function validateIntegrationsConfig(parsed) {
  const issues = [];
  collectSecretKeyIssues(parsed, '', issues);
  for (const key of Object.keys(parsed)) {
    if (key.startsWith('_')) continue;
    if (!['ticketing', 'docs', 'notifications'].includes(key)) {
      issues.push({ field: key, problem: 'unknown section — expected ticketing | docs | notifications; this section is ignored' });
    }
  }
  const ticketing = checkIntegrationSection(parsed, 'ticketing', {
    provider: INTEGRATION_TICKETING_PROVIDERS,
    base_url: 'string',
    project_key: 'string',
  }, issues);
  if (ticketing && ticketing.provider == null) {
    issues.push({ field: 'ticketing.provider', problem: `required when ticketing is configured — expected ${INTEGRATION_TICKETING_PROVIDERS.join(' | ')}` });
  }
  checkIntegrationSection(parsed, 'docs', {
    provider: INTEGRATION_DOCS_PROVIDERS,
    space_key: 'string',
  }, issues);
  checkIntegrationSection(parsed, 'notifications', {
    channel: INTEGRATION_NOTIFICATION_CHANNELS,
  }, issues);
  return issues;
}

const CONFIG_FILES = [
  { name: 'rstack.config.json', validate: validateRstackConfig },
  { name: 'budget.json', validate: validateBudgetConfig },
  { name: 'notifications.json', validate: validateNotificationsConfig },
  { name: 'policy.json', validate: validatePolicyConfig },
  { name: 'memory-config.json', validate: validateMemoryConfig },
  { name: 'integrations.json', validate: validateIntegrationsConfig },
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
