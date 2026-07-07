// owner: RStack developed by Richardson Gunde
//
// Environment & Integrations state (#238). Everything here is DEFENSIVE by
// contract: the environment_report v2 fields (run_mode, setup_needs,
// user_preferences — #237) and .rstack/integrations.json may not exist yet
// in a given project — an absent file or field is an honest empty state,
// never a crash and never a fabricated default.
//
// Secrecy rules (the page's whole point is handling secrets safely):
//   - .env values NEVER appear — key names + set/length only (listEnvKeys)
//   - notification channels are reported by NAME only, never webhook URLs
//     or tokens
//   - integrations.json is endpoints/keys by design (#237), but fields are
//     copied selectively anyway so a mistakenly-pasted secret in that file
//     does not ride the snapshot.

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { listEnvKeys, isEnvGitignored } from '../../../core/harness/env-file.js';
import { resolveChannels } from '../../../notifications/router.js';
import { readJson } from './files.js';
import { resolveStageArtifactPath } from './stage-reports.js';

export const ENV_WRITE_ARTIFACT_PREFIX = 'destructive-action:env-write:';

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function str(value, max = 200) {
  return typeof value === 'string' ? value.slice(0, max) : null;
}

// environment_report tools historically come as {name: bool} (v1) — some
// writers use {name: "2.42.0"} or richer objects. Normalize to
// [{ name, available, detail }] without inventing anything.
function normalizeTools(tools) {
  if (!isPlainObject(tools)) return [];
  return Object.entries(tools).slice(0, 40).map(([name, value]) => {
    if (typeof value === 'boolean') return { name, available: value, detail: null };
    if (typeof value === 'string') return { name, available: true, detail: value.slice(0, 80) };
    if (isPlainObject(value)) {
      return {
        name,
        available: value.available !== false && value.installed !== false,
        detail: str(value.version ?? value.detail, 80),
      };
    }
    return { name, available: Boolean(value), detail: null };
  });
}

function normalizeSetupNeeds(setupNeeds) {
  if (!Array.isArray(setupNeeds)) return [];
  return setupNeeds.slice(0, 20).filter(isPlainObject).map((need) => ({
    kind: str(need.kind, 60),
    platform: str(need.platform, 60),
    required_vars: Array.isArray(need.required_vars)
      ? need.required_vars.slice(0, 10).map((v) => String(v).slice(0, 80))
      : [],
    satisfied: need.satisfied === true,
  }));
}

function normalizeUserPreferences(prefs) {
  if (!isPlainObject(prefs)) return {};
  const out = {};
  for (const field of ['ticketing_platform', 'deployment_platform', 'notification_channel']) {
    if (typeof prefs[field] === 'string') out[field] = prefs[field].slice(0, 80);
  }
  return out;
}

function compactReport(raw, runId) {
  if (!isPlainObject(raw)) return null;
  return {
    runId,
    // v2 fields (#237) — absent on legacy reports, reported as null/empty.
    run_mode: str(raw.run_mode, 40),
    run_mode_evidence: Array.isArray(raw.run_mode_evidence)
      ? raw.run_mode_evidence.slice(0, 10).map((item) => String(item).slice(0, 200))
      : [],
    user_preferences: normalizeUserPreferences(raw.user_preferences),
    setup_needs: normalizeSetupNeeds(raw.setup_needs),
    // v1 fields.
    tools: normalizeTools(raw.tools),
    pipeline_ready: typeof raw.pipeline_ready === 'boolean' ? raw.pipeline_ready : null,
    status: str(raw.status, 40),
    source: str(raw.source, 60),
  };
}

// Latest run first: prefer manifest.created_at, fall back to runId ordering
// (run ids are timestamp-prefixed).
function newestFirst(runs) {
  return [...(runs ?? [])].sort((a, b) =>
    String(b.manifest?.created_at ?? b.runId ?? '').localeCompare(String(a.manifest?.created_at ?? a.runId ?? '')));
}

async function latestEnvironmentReport(runs) {
  for (const run of newestFirst(runs)) {
    if (!run?.runId || !run?.projectRoot) continue;
    const runDir = join(run.projectRoot, '.rstack', 'runs', run.runId);
    if (!existsSync(runDir)) continue;
    const path = resolveStageArtifactPath(runDir, '00-environment')
      ?? [join(runDir, 'artifacts', 'environment_report.json')].find(existsSync)
      ?? null;
    if (!path) continue;
    const report = compactReport(await readJson(path, null), run.runId);
    if (report) return report;
  }
  return null;
}

// .rstack/integrations.json (#237): endpoints and project keys, never
// credentials. Selective copy — unknown fields stay behind.
function compactIntegrations(raw) {
  if (!isPlainObject(raw)) return null;
  const out = {};
  if (isPlainObject(raw.jira)) {
    out.jira = { base_url: str(raw.jira.base_url, 200), project_key: str(raw.jira.project_key, 60) };
  }
  if (isPlainObject(raw.confluence)) {
    out.confluence = { base_url: str(raw.confluence.base_url, 200), space: str(raw.confluence.space, 60) };
  }
  if (typeof raw.tracker === 'string') out.tracker = raw.tracker.slice(0, 60);
  return Object.keys(out).length ? out : null;
}

// Gitignore status is a subprocess check — memoize briefly so the 3s poll
// loop does not spawn git on every snapshot. The memo caches a stable
// boolean, so it adds no ETag-volatile field to the state.
const GITIGNORE_MEMO = { at: 0, root: '', value: false };
const GITIGNORE_MEMO_TTL_MS = 10_000;

async function gitignoredCached(projectRoot, now = Date.now()) {
  if (GITIGNORE_MEMO.root === projectRoot && now - GITIGNORE_MEMO.at < GITIGNORE_MEMO_TTL_MS) {
    return GITIGNORE_MEMO.value;
  }
  const value = await isEnvGitignored(projectRoot);
  GITIGNORE_MEMO.root = projectRoot;
  GITIGNORE_MEMO.at = now;
  GITIGNORE_MEMO.value = value;
  return value;
}

/**
 * Build the environment page's slice of the snapshot.
 *   projectRoot     — the hub's project (where .env and integrations live)
 *   runs            — the already-parsed run list (for the latest report)
 *   queueApprovals  — the already-read approval queue (for env-write gates)
 * Absent inputs produce honest empty state. No always-changing timestamp is
 * included, so the /api/state ETag stays stable when nothing real changed.
 */
export async function buildEnvironmentState(projectRoot, runs = [], queueApprovals = []) {
  const [report, envKeys, gitignored] = await Promise.all([
    latestEnvironmentReport(runs),
    listEnvKeys(projectRoot),
    gitignoredCached(projectRoot),
  ]);

  const integrations = compactIntegrations(
    await readJson(join(projectRoot, '.rstack', 'integrations.json'), null),
  );

  // Channel NAMES only — resolveChannels returns webhook URLs/tokens, which
  // must never reach the snapshot.
  let notificationChannels = [];
  try {
    notificationChannels = Object.keys(resolveChannels({ projectRoot })).sort();
  } catch {
    notificationChannels = [];
  }

  const envApprovals = (queueApprovals ?? [])
    .filter((approval) => String(approval?.artifact ?? '').startsWith(ENV_WRITE_ARTIFACT_PREFIX))
    .slice(0, 50)
    .map((approval) => ({
      id: str(approval.id, 200),
      artifact: str(approval.artifact, 255),
      key: String(approval.artifact ?? '').slice(ENV_WRITE_ARTIFACT_PREFIX.length, ENV_WRITE_ARTIFACT_PREFIX.length + 200),
      status: str(approval.status, 40) ?? 'pending',
      requestedBy: str(approval.requestedBy, 200),
      resolvedBy: str(approval.resolvedBy, 200),
      ts: str(approval.ts, 40),
    }));

  return {
    report,
    integrations,
    notifications: { channels: notificationChannels },
    env: {
      exists: existsSync(join(projectRoot, '.env')),
      gitignored,
      keys: envKeys,
    },
    envApprovals,
    pendingEnvApprovals: envApprovals.filter((approval) => !approval.status || approval.status === 'pending'),
  };
}
