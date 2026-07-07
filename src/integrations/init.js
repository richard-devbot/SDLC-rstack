/**
 * rstack-agents init — one-command setup of RStack SDLC in any project,
 * for any host framework (Pi, Claude Code, Operator, or custom).
 *
 * Design rules:
 *   - Idempotent: running twice is safe; existing files are never overwritten.
 *   - Non-destructive: we create new files and print instructions — we never
 *     rewrite a user's settings.json / CLAUDE.md in place.
 *   - Honest: every report lists exactly what was created, what was skipped,
 *     and what the user still has to do.
 *
 * owner: RStack developed by Richardson Gunde
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerProject } from '../core/tracker/registry.js';
import { budgetPolicyForProfile, profileConfig } from '../core/profiles.js';

export const FRAMEWORKS = Object.freeze(['pi', 'claude-code', 'operator', 'custom']);

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Bootstrap files written at project root per framework (only when missing). */
export const BOOTSTRAP_BY_FRAMEWORK = Object.freeze({
  'claude-code': ['CLAUDE.md', 'SOUL.md', 'HEARTBEAT.md'],
  pi: ['SOUL.md', 'HEARTBEAT.md'],
  operator: ['SOUL.md', 'HEARTBEAT.md'],
  custom: ['AGENTS.md', 'SOUL.md', 'HEARTBEAT.md'],
});

/** Best-effort host framework detection from project signals. */
export async function detectFramework(projectRoot) {
  const root = resolve(projectRoot);
  if (existsSync(join(root, '.claude'))) return 'claude-code';
  if (existsSync(join(root, 'operator.json')) || existsSync(join(root, 'operator_settings.json'))) return 'operator';
  const pkgPath = join(root, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
      if (deps['@earendil-works/pi-coding-agent'] || deps['@earendil-works/pi-ai'] || pkg.pi) return 'pi';
    } catch { /* unreadable package.json — fall through */ }
  }
  return 'custom';
}

async function countPriorRuns(stateDir) {
  const runsPath = join(stateDir, 'runs');
  if (!existsSync(runsPath)) return 0;
  const entries = await readdir(runsPath, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).length;
}

// State init adopts an existing .rstack/ — but a business user expects init to
// mean "clean slate", so an adopted workspace with stale runs must say so
// loudly, and --fresh must offer a non-destructive way out (#99).
const ARCHIVABLE_STATE = ['runs', 'approvals.jsonl', 'memory', 'registry', 'rstack.config.json', 'budget.json'];

async function archiveExistingState(stateDir, report) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const archiveDir = join(stateDir, 'archive', stamp);
  let moved = 0;
  for (const entry of ARCHIVABLE_STATE) {
    const source = join(stateDir, entry);
    if (!existsSync(source)) continue;
    await mkdir(archiveDir, { recursive: true });
    await rename(source, join(archiveDir, entry));
    moved += 1;
  }
  if (moved > 0) {
    report.created.push(`.rstack/archive/${stamp}/ (--fresh moved ${moved} prior state entr${moved === 1 ? 'y' : 'ies'} aside — nothing deleted)`);
  }
  await mkdir(join(stateDir, 'runs'), { recursive: true });
}

async function ensureStateDir(projectRoot, report, { fresh = false } = {}) {
  const stateDir = join(projectRoot, '.rstack');
  if (existsSync(stateDir)) {
    if (fresh) {
      await archiveExistingState(stateDir, report);
      return;
    }
    const priorRuns = await countPriorRuns(stateDir);
    report.skipped.push(priorRuns > 0
      ? `.rstack/ (already exists — ${priorRuns} prior run${priorRuns === 1 ? '' : 's'} preserved; rerun with --fresh to archive them and start clean)`
      : '.rstack/ (already exists)');
  } else {
    await mkdir(join(stateDir, 'runs'), { recursive: true });
    report.created.push('.rstack/');
  }
}

async function writeIfMissing(filePath, content, label, report) {
  if (existsSync(filePath)) {
    report.skipped.push(`${label} (already exists)`);
    return false;
  }
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
  report.created.push(label);
  return true;
}

async function readBootstrapTemplate(packageRoot, name) {
  const templatePath = join(packageRoot, 'templates', 'bootstrap', name);
  if (!existsSync(templatePath)) {
    throw new Error(`Bootstrap template missing: templates/bootstrap/${name}`);
  }
  return readFile(templatePath, 'utf8');
}

async function scaffoldBootstrapFiles(projectRoot, framework, report) {
  const names = BOOTSTRAP_BY_FRAMEWORK[framework] ?? BOOTSTRAP_BY_FRAMEWORK.custom;
  for (const name of names) {
    const content = await readBootstrapTemplate(PACKAGE_ROOT, name);
    await writeIfMissing(join(projectRoot, name), content, name, report);
  }
}

const ENV_HINTS = [
  'RSTACK_SLACK_WEBHOOK   — webhook URL for Slack / Teams / Discord notifications',
  'RSTACK_BUSINESS_PORT   — Business Hub dashboard port (default 3008)',
  'RSTACK_DEFAULT_MODEL   — model for delegated builder agents',
  'RSTACK_ESCALATED_MODEL — model used when a task needs attempt >= 2',
];

export async function initFramework(projectRoot, framework, { packageRoot, profile = 'business-flex', fresh = false } = {}) {
  const root = resolve(projectRoot);
  const fw = framework ?? await detectFramework(root);
  if (!FRAMEWORKS.includes(fw)) {
    throw new Error(`Unknown framework "${fw}". Expected one of: ${FRAMEWORKS.join(', ')}`);
  }

  const activeProfile = profileConfig(profile);
  const report = { framework: fw, profile: activeProfile.profile, projectRoot: root, created: [], skipped: [], nextSteps: [] };
  await ensureStateDir(root, report, { fresh });
  await writeIfMissing(
    join(root, '.rstack', 'rstack.config.json'),
    JSON.stringify(activeProfile, null, 2) + '\n',
    `.rstack/rstack.config.json (${activeProfile.profile} profile)`,
    report,
  );
  await writeIfMissing(
    join(root, '.rstack', 'budget.json'),
    JSON.stringify(budgetPolicyForProfile(activeProfile.profile), null, 2) + '\n',
    `.rstack/budget.json (${activeProfile.profile} budget policy)`,
    report,
  );
  await registerProject(root);
  report.created.push('project registered for Business Hub multi-project observation');

  await scaffoldBootstrapFiles(root, fw, report);

  if (fw === 'pi') {
    report.nextSteps.push(
      'Install the package in this project: npm install rstack-agents',
      'Pi auto-loads the SDLC extension from the package (pi.extensions in its package.json) — no wiring needed.',
      'Start a run from any Pi session: sdlc_start { goal: "..." }',
      'Open the dashboard: npx rstack-business',
    );
  }

  if (fw === 'claude-code') {
    const docPath = join(root, '.claude', 'rstack-sdlc.md');
    await writeIfMissing(docPath, CLAUDE_CODE_DOC, '.claude/rstack-sdlc.md', report);
    // Hooks: Business Hub auto-launch on SessionStart, and the enforcement
    // guard (#227) on PreToolUse — Bash/Write/Edit calls route through
    // `rstack-agents guard`, which reuses the harness destructive gate and
    // validator sandbox and blocks with exit 2. We only create settings.json
    // when it doesn't exist — never rewrite (or merge into) the user's; if it
    // already exists we drop the snippet next to it and print guidance.
    const settingsPath = join(root, '.claude', 'settings.json');
    const hookSettings = JSON.stringify(CLAUDE_CODE_HOOKS, null, 2) + '\n';
    const wroteSettings = await writeIfMissing(settingsPath, hookSettings, '.claude/settings.json (SessionStart → Business Hub, PreToolUse → rstack-agents guard enforcement)', report);
    if (!wroteSettings) {
      await writeIfMissing(join(root, '.claude', 'rstack-hooks.json'), hookSettings, '.claude/rstack-hooks.json (merge into your settings.json hooks)', report);
      report.nextSteps.push('Your .claude/settings.json already exists — RStack never edits it. Merge the hooks from .claude/rstack-hooks.json: SessionStart opens the Business Hub, PreToolUse enforces the destructive gate + validator sandbox via `rstack-agents guard`.');
    }
    report.nextSteps.push(
      'Install the Claude Code plugin: /plugin install sdlc-automation (or add the marketplace repo)',
      'Run /sdlc-start in Claude Code to drive the full pipeline',
      'The Business Hub auto-opens each session (SessionStart hook) — or run: npx rstack-agents hub',
      'Enforcement: the PreToolUse hook routes Bash/Write/Edit through `rstack-agents guard` — destructive actions block until a destructive-action:<taskId> approval exists (docs/integrations/claude-code.md).',
    );
  }

  if (fw === 'operator') {
    const settingsPath = join(root, 'rstack-operator.example.json');
    const example = JSON.stringify({
      extensions: {
        list: [{
          path: packageRoot ? join(packageRoot, 'extensions', 'rstack_sdlc.py') : 'node_modules/rstack-agents/extensions/rstack_sdlc.py',
          settings: {
            worker_command: '',
            default_model: '',
            escalated_model: '',
            slack_webhook: '',
          },
        }],
      },
    }, null, 2) + '\n';
    await writeIfMissing(settingsPath, example, 'rstack-operator.example.json', report);
    report.nextSteps.push(
      'Install the package: npm install rstack-agents (the Python adapter shells out to its Node bridge)',
      'Merge rstack-operator.example.json into your Operator settings.json extensions list',
      'Requirements on this host: node + npx on PATH, npm install run once in the package directory',
      'Open the dashboard: npx rstack-business',
    );
  }

  if (fw === 'custom') {
    report.nextSteps.push(
      'RStack state lives in .rstack/ — any agent framework that writes the run contract can plug in.',
      'Adapter contract: read docs/integrations/custom.md in the rstack-agents package.',
      'Reuse the Node bridge for tool calls: npx tsx node_modules/rstack-agents/bin/rstack-operator-bridge.ts <tool> \'<json>\'',
      'Auto-launch the dashboard from your harness session hook: npx rstack-agents hub',
    );
  }

  report.nextSteps.push(
    `Active RStack profile: ${activeProfile.profile} (${activeProfile.name})`,
    'Governance identity: SOUL.md (team roles, contracts, evidence). Standby automation: HEARTBEAT.md (optional periodic checks).',
    'Adjust the profile any time in .rstack/rstack.config.json to enable only the business teams, plugins, and dashboard pages this project needs.',
    'Adjust budget controls in .rstack/budget.json before high-cost agent runs.',
    'SessionStart hub hook and heartbeat checks are opt-in — disable hub auto-launch with RSTACK_NO_BUSINESS_HUB=1.',
    'Optional environment configuration:',
    ...ENV_HINTS.map((hint) => `  ${hint}`),
  );
  return report;
}

/**
 * Claude Code hooks installed by init (exported so tests and docs pin the
 * exact shape). SessionStart auto-launches the Business Hub; PreToolUse is
 * the enforcement guard (#227): every Bash/Write/Edit call is classified by
 * `rstack-agents guard`, which exits 2 to block (destructive gate + validator
 * sandbox) — the same harness policy the Pi tool_call hook enforces.
 */
export const CLAUDE_CODE_HOOKS = Object.freeze({
  hooks: {
    SessionStart: [{ hooks: [{ type: 'command', command: 'npx -y rstack-agents hub' }] }],
    PreToolUse: [{
      matcher: 'Bash|Write|Edit',
      hooks: [{ type: 'command', command: 'npx --yes rstack-agents guard --context builder' }],
    }],
  },
});

const CLAUDE_CODE_DOC = `# RStack SDLC — Claude Code integration

<!-- owner: RStack developed by Richardson Gunde -->

This project uses RStack for governed SDLC runs. State lives in \`.rstack/\`.

## Commands (via the sdlc-automation plugin)

- \`/sdlc-start\` — start the full pipeline (interactive)
- \`/sdlc-status\` — which agents completed, which are pending
- \`/sdlc-resume\` — resume from a specific agent
- \`/sdlc-agent <name>\` — run one SDLC agent in isolation

## Enforcement

The PreToolUse hook in \`.claude/settings.json\` routes Bash/Write/Edit calls
through \`rstack-agents guard\`: destructive actions (recursive deletes, force
pushes, publishes, deploys, secret writes, db drops) block until a
\`destructive-action:<taskId>\` approval exists on the run, and
validator/reviewer/security contexts are read-only. Details:
\`docs/integrations/claude-code.md\` in the rstack-agents package.

## Dashboard

\`npx rstack-business\` opens the Business Hub on :3008 — run timelines,
stage durations, approvals, alerts, and traceability for every run.
`;
