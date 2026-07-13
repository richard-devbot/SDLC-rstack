/**
 * Role-based approval recipient routing (#353).
 *
 * `.rstack/notifications.json` carries the people layer (names + addresses —
 * committable, never credentials):
 *
 *   {
 *     "recipients": {
 *       "manager":   { "name": "Priya", "email": "priya@example.com" },
 *       "team_lead": { "name": "Sam",   "email": "sam@example.com" }
 *     },
 *     "routing": {
 *       "guardrail-override:*":   ["manager"],
 *       "stage-approval:07-code": ["team_lead"],
 *       "release-readiness.json": ["manager", "cicd"],
 *       "07-code":                ["team_lead"]
 *     }
 *   }
 *
 * Role names are free-form. Routing patterns support, in precedence order:
 *   1. exact artifact names            (release-readiness.json,
 *                                       guardrail-override:task-3)
 *   2. artifact-kind prefix wildcards  (guardrail-override:* /
 *                                       stage-approval:* / destructive-action:*)
 *   3. canonical stage ids             (07-code) matched against the blocked
 *                                       task's stages
 * UNROUTED artifacts fall back to the roles/people named in policy.json
 * `managers[]` when those managers appear in recipients — otherwise the
 * resolution is empty and the caller logs "no email recipients resolved".
 *
 * This module is routing ONLY. Enforcement stays with the claim gate
 * (#133/#149/#228) — email is a notification layer, never a second gate.
 *
 * owner: RStack developed by Richardson Gunde
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

const EMAIL_SHAPE = /.+@.+\..+/;

function readJson(path) {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null; // malformed config is #151's job to report — routing degrades to empty
  }
}

/**
 * Read `recipients` + `routing` from .rstack/notifications.json. Tolerant:
 * a missing or malformed file resolves to empty maps (never throws).
 */
export function loadRecipients(projectRoot) {
  const parsed = projectRoot ? readJson(join(projectRoot, '.rstack', 'notifications.json')) : null;
  return {
    recipients: isPlainObject(parsed?.recipients) ? parsed.recipients : {},
    routing: isPlainObject(parsed?.routing) ? parsed.routing : {},
  };
}

/** Read the `managers[]` fallback list from .rstack/policy.json (tolerant). */
export function loadManagers(projectRoot) {
  const parsed = projectRoot ? readJson(join(projectRoot, '.rstack', 'policy.json')) : null;
  return Array.isArray(parsed?.managers)
    ? parsed.managers.filter((entry) => typeof entry === 'string' && entry.trim())
    : [];
}

function recipientEntry(role, entry) {
  if (!isPlainObject(entry)) return null;
  const email = typeof entry.email === 'string' ? entry.email.trim() : '';
  if (!EMAIL_SHAPE.test(email)) return null;
  return { role, name: typeof entry.name === 'string' ? entry.name : null, email };
}

function rolesForArtifact(artifact, stageIds, routing) {
  const art = String(artifact ?? '');
  // 1. Exact artifact name.
  if (Array.isArray(routing[art]) && routing[art].length) return routing[art];
  // 2. Kind prefix wildcard: 'guardrail-override:task-3' → 'guardrail-override:*'.
  const colon = art.indexOf(':');
  if (colon > 0) {
    const wildcard = `${art.slice(0, colon)}:*`;
    if (Array.isArray(routing[wildcard]) && routing[wildcard].length) return routing[wildcard];
  }
  // 3. Canonical stage id of the blocked task.
  for (const stageId of stageIds) {
    if (Array.isArray(routing[stageId]) && routing[stageId].length) return routing[stageId];
  }
  return null;
}

/**
 * Pure resolution: blocked artifact (+ the task's canonical stage ids) →
 * deduped [{ role, name, email }]. `stageId` accepts a single id or an array.
 * A route that names only unknown roles resolves to empty (config validation
 * warns "resolves to nobody" — the runtime never guesses); only a fully
 * UNROUTED artifact falls back to `managers[]`, matched against recipients
 * by role key, name, or email.
 */
export function resolveApprovalRecipients({ artifact, stageId, recipients = {}, routing = {}, managers = [] } = {}) {
  const stageIds = (Array.isArray(stageId) ? stageId : [stageId]).filter(Boolean).map(String);
  const safeRecipients = isPlainObject(recipients) ? recipients : {};
  const safeRouting = isPlainObject(routing) ? routing : {};

  const routedRoles = rolesForArtifact(artifact, stageIds, safeRouting);
  const resolved = [];
  if (routedRoles) {
    for (const role of routedRoles) {
      const entry = recipientEntry(role, safeRecipients[role]);
      if (entry) resolved.push(entry);
    }
  } else {
    // Unrouted → managers[] fallback (a manager entry may be a role key, a
    // recipient's display name, or their email address).
    const wanted = (Array.isArray(managers) ? managers : []).map((manager) => String(manager).trim()).filter(Boolean);
    for (const [role, raw] of Object.entries(safeRecipients)) {
      const entry = recipientEntry(role, raw);
      if (!entry) continue;
      if (wanted.some((manager) => manager === role || manager === entry.name || manager.toLowerCase() === entry.email.toLowerCase())) {
        resolved.push(entry);
      }
    }
  }

  // One email per person: dedupe by address so a person holding two roles is
  // never notified twice for the same block.
  const seen = new Set();
  return resolved.filter((entry) => {
    const key = entry.email.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
