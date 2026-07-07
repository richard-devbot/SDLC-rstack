// owner: RStack developed by Richardson Gunde
//
// `rstack-agents env scan` (#237): the detection half of interactive
// environment intake. Wraps the read-only adopt scanner (scanRepository —
// detection logic is never duplicated here) and adds two intake signals:
//
//   1. proposed_run_mode (greenfield | brownfield | feature) with the
//      run_mode_evidence[] that justifies it, following the run-modes
//      contract in agents/OPERATING-STANDARD.md §8 — the brownfield markers
//      are exactly the ones `rstack-agents adopt` writes (harvest.js).
//   2. setup_needs[] — a skeleton derived from the platforms chosen in
//      .rstack/integrations.json vs the env vars actually present. Empty
//      until preferences exist; stage 00 turns each unsatisfied need into a
//      Decision Queue item gated on the stage that consumes it, so a missing
//      Jira token never blocks 01-transcript.
//
// Everything here is read-only and pure filesystem inspection: no state is
// written, no commands are executed, no secrets are read or echoed (env vars
// are reported by NAME and presence only).

import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { scanRepository } from '../core/adopt/scan.js';
import { rstackStateDir } from '../core/harness/runs.js';

export const RUN_MODES = Object.freeze(['greenfield', 'brownfield', 'feature']);

async function readJsonIfPresent(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

// Brownfield markers per the run-modes contract: manifest "mode":"adopt",
// artifacts/adoption_report.json, or an environment report stamped
// "source":"brownfield-adoption" (canonical stage path first, legacy second).
async function adoptionMarker(runDir) {
  const manifest = await readJsonIfPresent(join(runDir, 'manifest.json'));
  if (manifest?.mode === 'adopt') return 'manifest.json ("mode":"adopt")';
  if (existsSync(join(runDir, 'artifacts', 'adoption_report.json'))) return 'artifacts/adoption_report.json';
  for (const relPath of ['artifacts/stages/00-environment/environment_report.json', 'artifacts/environment_report.json']) {
    const report = await readJsonIfPresent(join(runDir, ...relPath.split('/')));
    if (report?.source === 'brownfield-adoption') return `${relPath} ("source":"brownfield-adoption")`;
  }
  return null;
}

async function listRunIds(stateDir) {
  const runsDir = join(stateDir, 'runs');
  if (!existsSync(runsDir)) return [];
  const entries = await readdir(runsDir, { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}

// Commit history detection without shelling out: refs or packed-refs mean at
// least one commit; a bare `git init` (no commits) does NOT count as history.
// A .git FILE is a worktree/submodule pointer — that always implies an
// existing repository with history.
async function detectGitHistory(projectRoot) {
  const gitPath = join(projectRoot, '.git');
  if (!existsSync(gitPath)) return null;
  const stats = await stat(gitPath).catch(() => null);
  if (stats?.isFile()) return '.git is a worktree/submodule pointer — existing repository';
  if (existsSync(join(gitPath, 'packed-refs'))) return '.git/packed-refs — commit history present';
  const heads = await readdir(join(gitPath, 'refs', 'heads')).catch(() => []);
  if (heads.length > 0) return '.git/refs/heads — commit history present';
  return null;
}

// Run-mode proposal (#237):
//   brownfield — the LATEST run carries adoption markers, OR the codebase has
//                git history + manifest files but no .rstack runs yet (an
//                existing project that was never adopted).
//   feature    — an adoption run exists alongside later non-adoption runs:
//                the baseline was adopted, this is new work on top of it.
//   greenfield — everything else.
async function proposeRunMode(projectRoot, scan, stateDir) {
  const runIds = await listRunIds(stateDir);
  const latest = runIds.at(-1);

  if (latest) {
    const latestMarker = await adoptionMarker(join(stateDir, 'runs', latest));
    if (latestMarker) {
      return { mode: 'brownfield', evidence: [`latest run ${latest}: ${latestMarker}`] };
    }
    for (const runId of runIds.slice(0, -1).reverse()) {
      const marker = await adoptionMarker(join(stateDir, 'runs', runId));
      if (marker) {
        return {
          mode: 'feature',
          evidence: [
            `adoption run ${runId} exists (${marker})`,
            `latest run ${latest} is not an adoption run — new work on an adopted baseline`,
          ],
        };
      }
    }
    return { mode: 'greenfield', evidence: [`no adoption markers in any of ${runIds.length} run(s) under .rstack/runs`] };
  }

  const gitEvidence = await detectGitHistory(projectRoot);
  const manifests = scan.toolchain.languages.map((entry) => entry.evidence);
  if (gitEvidence && manifests.length > 0) {
    return {
      mode: 'brownfield',
      evidence: [
        gitEvidence,
        `manifest files present: ${manifests.join(', ')}`,
        'no .rstack runs yet — existing codebase never adopted (consider `rstack-agents adopt`)',
      ],
    };
  }

  const evidence = ['no .rstack runs'];
  evidence.push(gitEvidence ? gitEvidence : 'no git commit history');
  evidence.push(manifests.length > 0 ? `manifest files present: ${manifests.join(', ')}` : 'no manifest files detected');
  return { mode: 'greenfield', evidence };
}

// Env vars each platform needs before its consuming stage can use it live.
// Names only — values are never read into the report. base_url / project_key
// can come from integrations.json itself, so they only appear as required
// env vars when the config does not provide them.
function ticketingVars(config) {
  const provider = config?.provider;
  if (provider === 'jira') {
    const vars = ['JIRA_API_TOKEN'];
    if (typeof config?.base_url !== 'string' || !config.base_url) vars.push('JIRA_BASE_URL');
    if (typeof config?.project_key !== 'string' || !config.project_key) vars.push('JIRA_PROJECT_KEY');
    return vars;
  }
  if (provider === 'github') return ['GITHUB_TOKEN'];
  if (provider === 'azure_devops') return ['AZURE_DEVOPS_ORG_URL', 'AZURE_DEVOPS_PAT'];
  if (provider === 'linear') return ['LINEAR_API_KEY'];
  if (provider === 'file-based') return [];
  return null; // no or unknown provider — no need derived (config validation flags unknowns)
}

function docsVars(config) {
  if (config?.provider === 'confluence') return ['CONFLUENCE_BASE_URL', 'CONFLUENCE_API_TOKEN'];
  return null; // 'none' or unset — nothing chosen
}

function notificationVars(config) {
  const channel = config?.channel;
  if (channel === 'slack') return ['RSTACK_SLACK_WEBHOOK'];
  if (channel === 'teams') return ['RSTACK_TEAMS_WEBHOOK'];
  if (channel === 'discord') return ['RSTACK_DISCORD_WEBHOOK'];
  return null; // 'none' or unset — nothing chosen
}

// setup_needs skeleton: one entry per platform chosen in integrations.json,
// each { kind, platform, required_vars[], satisfied }. Presence-only env
// checks — a var is satisfied when it is set and non-empty.
export function deriveSetupNeeds(integrations, env = process.env) {
  if (!integrations || typeof integrations !== 'object' || Array.isArray(integrations)) return [];
  const needs = [];
  const sections = [
    { kind: 'ticketing', platform: integrations.ticketing?.provider, vars: ticketingVars(integrations.ticketing) },
    { kind: 'docs', platform: integrations.docs?.provider, vars: docsVars(integrations.docs) },
    { kind: 'notifications', platform: integrations.notifications?.channel, vars: notificationVars(integrations.notifications) },
  ];
  for (const { kind, platform, vars } of sections) {
    if (vars === null) continue;
    const missing = vars.filter((name) => !env[name]);
    needs.push({ kind, platform, required_vars: vars, satisfied: missing.length === 0 });
  }
  return needs;
}

export async function envScan(projectRoot, { env = process.env } = {}) {
  const scan = await scanRepository(projectRoot);
  const stateDir = rstackStateDir(projectRoot);
  const { mode, evidence } = await proposeRunMode(projectRoot, scan, stateDir);
  const integrations = await readJsonIfPresent(join(stateDir, 'integrations.json'));
  return {
    ...scan,
    proposed_run_mode: mode,
    run_mode_evidence: evidence,
    setup_needs: deriveSetupNeeds(integrations, env),
  };
}

export function formatEnvScan(report) {
  const lines = [];
  lines.push(`Environment scan for ${report.projectRoot} (read-only):`);
  const languages = report.toolchain.languages.map((entry) => `${entry.language} (${entry.evidence})`);
  lines.push(`  Toolchain: ${languages.length ? languages.join(', ') : 'none detected'}`);
  if (report.toolchain.frameworks.length) {
    lines.push(`  Frameworks: ${report.toolchain.frameworks.map((entry) => entry.framework).join(', ')}`);
  }
  lines.push(`  Docs: ${report.docs.length} file(s) | Tests: ${report.tests.testDirs.length} dir(s), ${report.tests.configs.length} config(s) | CI: ${report.ci.length} | Deploy: ${report.deploy.length}`);
  lines.push(`Proposed run mode: ${report.proposed_run_mode}`);
  for (const item of report.run_mode_evidence) lines.push(`  - ${item}`);
  if (report.setup_needs.length === 0) {
    lines.push('Setup needs: none derived yet (choose platforms in .rstack/integrations.json or user_preferences).');
  } else {
    lines.push('Setup needs:');
    for (const need of report.setup_needs) {
      const vars = need.required_vars.length ? need.required_vars.join(', ') : 'no env vars required';
      lines.push(`  ${need.satisfied ? '+' : '!'} ${need.kind}/${need.platform}: ${vars} — ${need.satisfied ? 'satisfied' : 'MISSING env vars'}`);
    }
  }
  lines.push('Next: confirm the run mode with ONE Decision Queue item, then write run_mode + setup_needs into environment_report.json (stage 00).');
  return lines.join('\n');
}
