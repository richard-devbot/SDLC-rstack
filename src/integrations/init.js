/**
 * rstack-agents init — one-command setup of RStack SDLC in any project,
 * for any host framework (Pi, Claude Code, Operator, Tau, or custom).
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

export const FRAMEWORKS = Object.freeze(['pi', 'claude-code', 'operator', 'tau', 'custom']);

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Bootstrap files written at project root per framework (only when missing). */
export const BOOTSTRAP_BY_FRAMEWORK = Object.freeze({
  'claude-code': ['CLAUDE.md', 'SOUL.md', 'HEARTBEAT.md'],
  pi: ['SOUL.md', 'HEARTBEAT.md'],
  operator: ['SOUL.md', 'HEARTBEAT.md'],
  tau: ['SOUL.md', 'HEARTBEAT.md'],
  custom: ['AGENTS.md', 'SOUL.md', 'HEARTBEAT.md'],
});

/** Best-effort host framework detection from project signals. */
export async function detectFramework(projectRoot) {
  const root = resolve(projectRoot);
  if (existsSync(join(root, '.claude'))) return 'claude-code';
  if (existsSync(join(root, 'operator.json')) || existsSync(join(root, 'operator_settings.json'))) return 'operator';
  if (existsSync(join(root, 'tau.json')) || existsSync(join(root, 'tau_settings.json')) || existsSync(join(root, '.tau'))) return 'tau';
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
const ARCHIVABLE_STATE = ['runs', 'approvals.jsonl', 'memory', 'registry', 'rstack.config.json', 'budget.json', 'integrations.json'];

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

// #237: commented-defaults intake template. Endpoints and identifiers ONLY —
// validateIntegrationsConfig rejects credential-shaped keys, so tokens can
// never land here. "_comment" keys are ignored by the validator.
export const INTEGRATIONS_TEMPLATE = Object.freeze({
  _comment: 'RStack integrations intake (#237): endpoints and identifiers ONLY. Secrets (API tokens, passwords) belong in .env — credential-shaped keys in this file fail config validation.',
  ticketing: {
    _comment: 'provider: jira | github | azure_devops | linear | file-based. Jira also takes base_url + project_key here; JIRA_API_TOKEN stays in .env.',
    provider: 'file-based',
  },
  docs: {
    _comment: 'provider: confluence | none (+ space_key). CONFLUENCE_* env vars stay in .env.',
    provider: 'none',
  },
  notifications: {
    _comment: 'channel: slack | teams | discord | none. Webhook URLs stay in env (RSTACK_SLACK_WEBHOOK, RSTACK_TEAMS_WEBHOOK, RSTACK_DISCORD_WEBHOOK).',
    channel: 'none',
  },
});

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
  await writeIfMissing(
    join(root, '.rstack', 'integrations.json'),
    JSON.stringify(INTEGRATIONS_TEMPLATE, null, 2) + '\n',
    '.rstack/integrations.json (ticketing/docs/notifications intake — endpoints only, secrets stay in .env)',
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
    const wroteSettings = await writeIfMissing(settingsPath, hookSettings, '.claude/settings.json (SessionStart → Business Hub + rstack-agents context, UserPromptSubmit → context, PreToolUse → rstack-agents guard enforcement, PostToolUse/PostToolUseFailure/SubagentStart/SubagentStop/PreCompact/Stop/SessionEnd → rstack-agents observe, Notification → rstack-agents notify-hook)', report);
    if (!wroteSettings) {
      await writeIfMissing(join(root, '.claude', 'rstack-hooks.json'), hookSettings, '.claude/rstack-hooks.json (merge into your settings.json hooks)', report);
      report.nextSteps.push('Your .claude/settings.json already exists — RStack never edits it. Merge the hooks from .claude/rstack-hooks.json: SessionStart opens the Business Hub and injects RStack context, UserPromptSubmit injects context via `rstack-agents context`, PreToolUse enforces the destructive gate + validator sandbox via `rstack-agents guard`, PostToolUse/PostToolUseFailure/SubagentStart/SubagentStop/PreCompact/Stop/SessionEnd feed the dashboard via `rstack-agents observe`, and Notification routes to your channels via `rstack-agents notify-hook` (all best-effort, only the guard ever blocks).');
    }
    report.nextSteps.push(
      'Install the Claude Code plugin: /plugin install sdlc-automation (or add the marketplace repo)',
      'Run /sdlc-start in Claude Code to drive the full pipeline',
      'The Business Hub auto-opens each session (SessionStart hook) — or run: npx rstack-agents hub',
      'Context: the SessionStart + UserPromptSubmit hooks inject an RStack packet (active run + stage + blockers + orchestrator pointer) via `rstack-agents context` — no-op when there is no active run, never blocks.',
      'Enforcement: the PreToolUse hook routes Bash/Write/Edit through `rstack-agents guard` — destructive actions block until a destructive-action:<taskId> approval exists (docs/integrations/claude-code.md).',
      'Observability: PostToolUse/PostToolUseFailure/SubagentStart/SubagentStop/PreCompact/Stop/SessionEnd feed `rstack-agents observe` — terminal edits, delegated subagents, failures, and compaction now appear in the Business Hub, just like on Pi. Observe never blocks and no-ops when there is no active run.',
      'Notifications: the Notification hook routes host notifications to your configured channels via `rstack-agents notify-hook` (Slack/Teams/Discord — set RSTACK_SLACK_WEBHOOK etc.). No-op if no channels are configured.',
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

  if (fw === 'tau') {
    const settingsPath = join(root, 'rstack-tau.example.json');
    const adapterPath = packageRoot
      ? join(packageRoot, 'src', 'integrations', 'tau', 'rstack_sdlc.py')
      : 'node_modules/rstack-agents/src/integrations/tau/rstack_sdlc.py';
    const example = JSON.stringify({
      extensions: {
        list: [{
          path: adapterPath,
          settings: {
            worker_command: '',
            default_model: '',
            escalated_model: '',
            slack_webhook: '',
          },
        }],
      },
    }, null, 2) + '\n';
    await writeIfMissing(settingsPath, example, 'rstack-tau.example.json', report);
    report.nextSteps.push(
      'Install the package: npm install rstack-agents (the Python adapter shells out to its Node bridge)',
      'Merge rstack-tau.example.json into your Tau settings.json extensions list',
      'Requirements on this host: node + npx on PATH, npm install run once in the package directory',
      'Enforcement: loading the extension IS the wiring — the adapter routes Tau\'s terminal/write/edit tools through `rstack-agents guard` on the tool_call hook (destructive gate + validator sandbox, exit 2 = block).',
      'Open the dashboard: npx rstack-business',
    );
  }

  if (fw === 'custom') {
    report.nextSteps.push(
      'RStack state lives in .rstack/ — any agent framework that writes the run contract can plug in.',
      'Adapter contract: read docs/integrations/custom.md and docs/integrations/adapter-contract.md in the rstack-agents package.',
      'Reuse the Node bridge for tool calls: npx tsx node_modules/rstack-agents/bin/rstack-bridge.ts <tool> \'<json>\'',
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
 * exact shape). Full governance hook-event coverage (#255):
 *   - SessionStart runs TWO hooks: auto-launch the Business Hub, and inject the
 *     RStack context packet via `rstack-agents context`.
 *   - UserPromptSubmit injects the same context packet before every prompt so a
 *     Claude Code agent stays RStack-aware (active run + stage + blockers +
 *     orchestrator pointer). `context` NEVER blocks/denies and emits nothing
 *     when there is no active run.
 *   - PreToolUse is the ENFORCEMENT guard (#227): every Bash/Write/Edit call is
 *     classified by `rstack-agents guard`, which exits 2 to block (destructive
 *     gate + validator sandbox) — the same policy the Pi tool_call hook enforces.
 *   - PostToolUse / PostToolUseFailure / Stop / SessionEnd / SubagentStart /
 *     SubagentStop / PreCompact are the OBSERVABILITY writer (#251/#255):
 *     `rstack-agents observe` appends a normalized event (tool_result,
 *     subagent_started/stopped, context_preserved, session_shutdown) to the
 *     active run's events.jsonl so the Business Hub mirrors terminal + delegated
 *     activity the way it already does on Pi.
 *   - Notification routes host notifications to configured channels via
 *     `rstack-agents notify-hook` (Slack/Teams/Discord/...).
 * Every observability/context/notification hook NEVER blocks (always exits 0)
 * and is a no-op when there is no active run (or no channels) — they can only add
 * visibility/context, never disrupt a session. Only PreToolUse can block, and
 * only via the audited destructive gate.
 */
const OBSERVE_CMD = 'npx --yes rstack-agents observe --source claude-code';
const CONTEXT_CMD = 'npx --yes rstack-agents context --source claude-code';
const NOTIFY_CMD = 'npx --yes rstack-agents notify-hook --source claude-code';

export const CLAUDE_CODE_HOOKS = Object.freeze({
  hooks: {
    SessionStart: [
      { hooks: [{ type: 'command', command: 'npx -y rstack-agents hub' }] },
      { hooks: [{ type: 'command', command: CONTEXT_CMD }] },
    ],
    UserPromptSubmit: [{ hooks: [{ type: 'command', command: CONTEXT_CMD }] }],
    PreToolUse: [{
      matcher: 'Bash|Write|Edit',
      hooks: [{ type: 'command', command: 'npx --yes rstack-agents guard --context builder' }],
    }],
    PostToolUse: [{
      matcher: 'Bash|Write|Edit',
      hooks: [{ type: 'command', command: OBSERVE_CMD }],
    }],
    PostToolUseFailure: [{
      matcher: 'Bash|Write|Edit',
      hooks: [{ type: 'command', command: OBSERVE_CMD }],
    }],
    SubagentStart: [{ hooks: [{ type: 'command', command: OBSERVE_CMD }] }],
    SubagentStop: [{ hooks: [{ type: 'command', command: OBSERVE_CMD }] }],
    PreCompact: [{ hooks: [{ type: 'command', command: OBSERVE_CMD }] }],
    Notification: [{ hooks: [{ type: 'command', command: NOTIFY_CMD }] }],
    Stop: [{ hooks: [{ type: 'command', command: OBSERVE_CMD }] }],
    SessionEnd: [{ hooks: [{ type: 'command', command: OBSERVE_CMD }] }],
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

## Context injection

The SessionStart and UserPromptSubmit hooks route through \`rstack-agents context\`,
which injects a small RStack packet (active run id + current stage, pending
approvals + open decisions, an orchestrator pointer) so the agent stays governed-
run-aware. It never blocks (context hooks can't deny), emits nothing when there is
no active run, and never injects secrets — the packet is structural only.

## Observability

The PostToolUse / PostToolUseFailure / SubagentStart / SubagentStop / PreCompact /
Stop / SessionEnd hooks route through \`rstack-agents observe\`, which appends a
normalized event to the active run's \`events.jsonl\` — the same shape Pi writes —
so the Business Hub mirrors your terminal activity, delegated subagents, tool
failures, and context compaction live. \`observe\` is best-effort: it never blocks
a tool call (always exits 0), redacts secrets, and no-ops when there is no run.

## Notifications

The Notification hook routes through \`rstack-agents notify-hook\`, which forwards
host notifications to your configured channels (Slack/Teams/Discord/Telegram/
WhatsApp — set \`RSTACK_SLACK_WEBHOOK\` etc.). Best-effort: never blocks, no-ops
when no channels are configured, and redacts secrets from the message.

## Dashboard

\`npx rstack-business\` opens the Business Hub on :3008 — run timelines,
stage durations, approvals, alerts, and traceability for every run.
`;
