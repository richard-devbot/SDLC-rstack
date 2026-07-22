// owner: RStack developed by Richardson Gunde
//
// rstack-agents doctor (#244): the one-command setup verifier for any host
// framework. It answers a single question — "does governance actually work on
// this machine, and if not, exactly what do I run to fix it?"
//
// Design rules (non-negotiable):
//   - NEVER crash on a partial setup. Every problem is a {PASS|FAIL|WARN}
//     check carrying a `fix` command, never a thrown exception. A doctor that
//     dies on a broken repo is useless precisely when it's needed most.
//   - The hero check is the GUARD SELF-TEST: it spawns the real `rstack-agents
//     guard` twice and asserts a destructive call blocks (exit 2) and a safe
//     call allows (exit 0). PASS means enforcement is live on THIS machine —
//     not merely wired in a template.
//   - Every FAIL prints the exact fix; WARN is advisory (does not fail the
//     run). Exit 1 iff any check FAILs.
//
// Reuses existing harness seams — no duplicated logic:
//   - validateProjectConfigs (config-validation.js) for the config check.
//   - the real guard CLI (spawned) for the self-test — same binary a host hook
//     invokes, so a PASS here is a PASS in production.

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { get as httpGet } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateProjectConfigs } from '../core/harness/config-validation.js';
// #452 PR3: report the active sandbox execution tier + opt-in bounded auto-start.
import { detectContainerRuntime, detectInstalledRuntime, loadSandboxConfig, startContainerRuntime } from '../core/harness/sandbox.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dirname, '..', '..');
const BIN = join(PACKAGE_ROOT, 'bin', 'rstack-agents.js');

export const DOCTOR_FRAMEWORKS = Object.freeze(['pi', 'claude-code', 'operator', 'tau', 'hermes', 'custom']);

const PASS = 'PASS';
const FAIL = 'FAIL';
const WARN = 'WARN';

function check(name, status, detail, fix = null) {
  return { name, status, detail, fix };
}

// --- environment checks -----------------------------------------------------

function parseMajor(version) {
  const match = String(version || '').match(/(\d+)/);
  return match ? Number(match[1]) : NaN;
}

function checkNodeVersion(pkg) {
  const required = pkg?.engines?.node ?? '>=18.0.0';
  const requiredMajor = parseMajor(required);
  const currentMajor = parseMajor(process.versions.node);
  if (!Number.isFinite(requiredMajor) || !Number.isFinite(currentMajor)) {
    return check('node version', WARN, `could not compare node ${process.version} against engines "${required}"`, null);
  }
  if (currentMajor >= requiredMajor) {
    return check('node version', PASS, `node ${process.version} satisfies engines "${required}"`);
  }
  return check('node version', FAIL, `node ${process.version} is below engines "${required}"`,
    `Install Node ${required} (e.g. nvm install ${requiredMajor} && nvm use ${requiredMajor})`);
}

async function checkNpx() {
  const found = await commandExists('npx');
  return found
    ? check('npx present', PASS, 'npx is on PATH — hosts can invoke `npx rstack-agents ...`')
    : check('npx present', FAIL, 'npx not found on PATH', 'Install Node.js (npx ships with it): https://nodejs.org');
}

function checkPackageResolvable(cwd) {
  // rstack-agents must be resolvable from the project so a host `npx
  // rstack-agents ...` hook resolves the local install rather than downloading.
  try {
    const requireFromCwd = createRequire(join(resolve(cwd), 'package.json'));
    requireFromCwd.resolve('rstack-agents/package.json');
    return check('package resolvable', PASS, 'rstack-agents resolves from this project');
  } catch {
    // Not fatal: running via `npx rstack-agents` (this very process) still
    // works without a local install, so this is advisory.
    return check('package resolvable', WARN,
      'rstack-agents is not installed in this project — host `npx rstack-agents` hooks will download it each run',
      'npm install rstack-agents (in a scratch dir, NOT inside the rstack-agents repo)');
  }
}

function commandExists(cmd) {
  return new Promise((resolveP) => {
    const probe = spawn(process.platform === 'win32' ? 'where' : 'which', [cmd], { stdio: 'ignore' });
    probe.on('error', () => resolveP(false));
    probe.on('close', (code) => resolveP(code === 0));
  });
}

async function checkGuardResolution(cwd) {
  // #371: the guard now fails CLOSED when it cannot RUN, so HOW it resolves is a
  // real posture question. A locally-installed binary runs with no network; if
  // the guard resolves only via `npx --yes`, a cold cache or an offline host
  // cannot start it — and every gated tool call then fails closed (blocks) until
  // the install is fixed or RSTACK_GUARD_FAIL_OPEN=1 is set. This surfaces that
  // before it bites, complementing the guard self-test (which proves the guard
  // WORKS, not that it resolves without network).
  let localResolvable = false;
  try {
    createRequire(join(resolve(cwd), 'package.json')).resolve('rstack-agents/package.json');
    localResolvable = true;
  } catch { /* not installed locally — fall through to the npx check */ }
  if (localResolvable) {
    return check('guard resolution', PASS,
      'guard resolves from a local install (no network needed); it fails closed if it ever cannot run — set RSTACK_GUARD_FAIL_OPEN=1 to allow instead');
  }
  const hasNpx = await commandExists('npx');
  if (hasNpx) {
    return check('guard resolution', WARN,
      'guard resolves ONLY via `npx --yes` (downloads on a cold cache; offline → the guard cannot start → gated tool calls fail closed by default)',
      'npm install rstack-agents in this project so the guard runs locally without network');
  }
  return check('guard resolution', FAIL,
    'guard cannot be resolved — no local rstack-agents install and no npx on PATH; every gated tool call fails closed',
    'Install Node.js (ships npx) and run `npm install rstack-agents` in this project');
}

// --- .rstack + config -------------------------------------------------------

function checkRstackDir(projectRoot) {
  const stateDir = process.env.RSTACK_STATE_DIR || join(projectRoot, '.rstack');
  if (existsSync(stateDir)) {
    return check('.rstack present', PASS, `state directory found at ${stateDir}`);
  }
  return check('.rstack present', FAIL, `no .rstack/ state directory at ${projectRoot}`,
    'rstack-agents init');
}

async function checkConfigs(projectRoot) {
  let problems = [];
  try {
    problems = await validateProjectConfigs(projectRoot);
  } catch (error) {
    return check('config validation', WARN, `could not validate configs: ${error.message}`, null);
  }
  if (problems.length === 0) {
    return check('config validation', PASS, 'all .rstack/*.json config files validate');
  }
  const first = problems[0];
  const where = `${first.file}${first.field ? ` (${first.field})` : ''}`;
  return check('config validation', FAIL,
    `${problems.length} config issue(s); first: ${where}: ${first.problem}`,
    'Fix the flagged fields in .rstack/*.json (run `rstack-agents doctor --json` to see every issue)');
}

// --- email approval notifications (#353) -------------------------------------

// PASS when the three configuration halves line up (env connection string +
// sender in notifications.json + at least one recipient); WARN naming exactly
// what is missing when partially configured; null (skip silently) when wholly
// unconfigured — email is opt-in and its absence is not a problem to report.
// Never FAIL: notifications are best-effort by contract and cannot block work.
function checkEmailNotifications(projectRoot, env = process.env) {
  const hasKey = Boolean(env.RSTACK_ACS_CONNECTION_STRING);
  let sender = '';
  let recipientCount = 0;
  const path = join(projectRoot, '.rstack', 'notifications.json');
  if (existsSync(path)) {
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8'));
      const configured = parsed?.channels?.email?.sender;
      sender = typeof configured === 'string' ? configured.trim() : '';
      const recipients = parsed?.recipients;
      if (recipients && typeof recipients === 'object' && !Array.isArray(recipients)) {
        recipientCount = Object.values(recipients)
          .filter((entry) => entry && typeof entry === 'object' && /.+@.+\..+/.test(String(entry.email ?? ''))).length;
      }
    } catch { /* malformed json is the config-validation check's finding */ }
  }
  if (!hasKey && !sender && recipientCount === 0) return null; // wholly unconfigured — skip
  if (hasKey && sender && recipientCount > 0) {
    return check('email approval notifications', PASS,
      `ACS email configured — sender ${sender}, ${recipientCount} recipient(s), access key from RSTACK_ACS_CONNECTION_STRING`);
  }
  const missing = [];
  if (!hasKey) missing.push('RSTACK_ACS_CONNECTION_STRING (env — "endpoint=https://...;accesskey=...")');
  if (!sender) missing.push('channels.email.sender in .rstack/notifications.json');
  if (recipientCount === 0) missing.push('at least one recipients.<role>.email in .rstack/notifications.json');
  return check('email approval notifications', WARN,
    `email is partially configured — approval emails will NOT send. Missing: ${missing.join('; ')}`,
    'Set RSTACK_ACS_CONNECTION_STRING in the environment and add channels.email.sender + recipients/routing to .rstack/notifications.json (see docs/mintlify/reference/approvals.mdx)');
}

// --- sandbox execution tier (#452 PR3) --------------------------------------

// Pure decision: given what's detected + the config, what tier is active and
// what does the operator need to know? Separated from the I/O below so the
// verdict logic is unit-testable without a container daemon. `autostart` is the
// startContainerRuntime result (or null when not requested).
export function sandboxTierCheck({ readyRuntime, installedRuntime, config, autostart }) {
  const note = autostart?.message ? ` (auto-start: ${autostart.message})` : '';
  if (config && config.enabled === false) {
    return check('sandbox execution tier', WARN,
      `sandbox execution is DISABLED in config — sdlc_validate uses the self-reported tests_run only, never container-verified${note}`,
      'Set sandbox.enabled=true in .rstack/rstack.config.json to run tests in a container');
  }
  if (readyRuntime) {
    const hasCommand = Boolean(config?.command) || Object.keys(config?.perStage ?? {}).length > 0;
    if (hasCommand) {
      return check('sandbox execution tier', PASS,
        `container-verified (${readyRuntime}) — sdlc_validate runs the authoritative command in a locked-down ${readyRuntime} container and authors execution evidence from the REAL exit code${note}`);
    }
    return check('sandbox execution tier', WARN,
      `${readyRuntime} engine is ready, but NO authoritative test command is configured (sandbox.command / sandbox.per_stage) — execution stays UNVERIFIED until one is set or a task carries test_command${note}`,
      'Add sandbox.command (e.g. "npm test") to .rstack/rstack.config.json to turn on container-verified execution');
  }
  if (installedRuntime) {
    const fix = installedRuntime === 'podman'
      ? 'Start the engine: podman machine start (or: rstack-agents doctor --start-runtime)'
      : process.platform === 'darwin'
        ? 'Start Docker Desktop (open -a Docker), or: rstack-agents doctor --start-runtime'
        : `Start the ${installedRuntime} engine, or: rstack-agents doctor --start-runtime`;
    return check('sandbox execution tier', WARN,
      `${installedRuntime} is installed but its engine is not running — execution degrades to UNVERIFIED (contract validation only), never a false green${note}`,
      fix);
  }
  return check('sandbox execution tier', WARN,
    `no container runtime (docker/podman) available — execution is UNVERIFIED: sdlc_validate falls back to contract validation + self-reported tests_run, never a false green${note}`,
    'Install Docker or Podman for container-verified execution (https://docs.docker.com/get-docker/ or https://podman.io)');
}

async function checkSandboxTier(projectRoot, { autostart = false } = {}) {
  let config;
  try {
    config = await loadSandboxConfig(projectRoot);
  } catch (error) {
    return check('sandbox execution tier', WARN, `could not read sandbox config: ${error.message}`, null);
  }
  let readyRuntime = detectContainerRuntime({});
  const installedRuntime = detectInstalledRuntime({});
  let autostartResult = null;
  if (autostart && !readyRuntime) {
    autostartResult = await startContainerRuntime({});
    if (autostartResult.ready) readyRuntime = autostartResult.runtime;
  }
  return sandboxTierCheck({ readyRuntime, installedRuntime, config, autostart: autostartResult });
}

// --- framework wiring -------------------------------------------------------

async function detectFrameworkLocal(projectRoot) {
  const root = resolve(projectRoot);
  if (existsSync(join(root, '.claude'))) return 'claude-code';
  if (existsSync(join(root, 'operator.json')) || existsSync(join(root, 'operator_settings.json'))) return 'operator';
  const pkgPath = join(root, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
      if (deps['@earendil-works/pi-coding-agent'] || deps['@earendil-works/pi-ai'] || pkg.pi) return 'pi';
    } catch { /* unreadable — fall through */ }
  }
  return null;
}

function fileCheck(name, absPath, relLabel, fix) {
  return existsSync(absPath)
    ? check(name, PASS, `${relLabel} present`)
    : check(name, FAIL, `${relLabel} not found at ${absPath}`, fix);
}

// The exact snippet a user pastes when the hook is missing — mirrors the shape
// `init --framework claude-code` installs (init.js CLAUDE_CODE_HOOKS).
const CLAUDE_HOOK_SNIPPET = 'Add a PreToolUse hook to .claude/settings.json: '
  + '{"hooks":{"PreToolUse":[{"matcher":"Bash|Write|Edit|MultiEdit|NotebookEdit","hooks":[{"type":"command",'
  + '"command":"npx --yes rstack-agents guard --context builder"}]}]}} '
  + '(or run: rstack-agents init --framework claude-code)';

// The observability counterpart (#251) — the PostToolUse hook that feeds the
// dashboard. Mirrors init.js CLAUDE_CODE_HOOKS.
const OBSERVE_HOOK_SNIPPET = 'Add a PostToolUse hook to .claude/settings.json: '
  + '{"hooks":{"PostToolUse":[{"matcher":"Bash|Write|Edit|MultiEdit|NotebookEdit","hooks":[{"type":"command",'
  + '"command":"npx --yes rstack-agents observe --source claude-code"}]}]}} '
  + '(or run: rstack-agents init --framework claude-code)';

// Context injection (#255) — UserPromptSubmit/SessionStart hooks that inject the
// RStack packet. Mirrors init.js CLAUDE_CODE_HOOKS.
const CONTEXT_HOOK_SNIPPET = 'Add a UserPromptSubmit hook to .claude/settings.json: '
  + '{"hooks":{"UserPromptSubmit":[{"hooks":[{"type":"command",'
  + '"command":"npx --yes rstack-agents context --source claude-code"}]}]}} '
  + '(or run: rstack-agents init --framework claude-code)';

// Plugin/marketplace presence (#388): the hooks check above verifies
// *enforcement* wiring, but before this the onboarding docs pointed at a
// `/plugin install sdlc-rstack` that did not exist anywhere in the repo — a
// user could have a perfectly wired guard hook and still have no /sdlc-*
// commands. This checks what the PACKAGE ships (like checkPiWiring/
// checkBridge do for their frameworks), not the user's project — the plugin
// and marketplace manifest live in the rstack-agents package itself.
function checkClaudeCodePlugin() {
  const marketplacePath = join(PACKAGE_ROOT, '.claude-plugin', 'marketplace.json');
  const pluginPath = join(PACKAGE_ROOT, 'plugins', 'sdlc-rstack', 'plugin.json');
  const checks = [
    fileCheck('claude-code marketplace manifest', marketplacePath, '.claude-plugin/marketplace.json',
      'Reinstall the package: npm install rstack-agents (or regenerate: node scripts/generate-marketplace.mjs)'),
    fileCheck('claude-code sdlc-rstack plugin', pluginPath, 'plugins/sdlc-rstack/plugin.json',
      'Reinstall the package: npm install rstack-agents'),
  ];
  if (existsSync(marketplacePath)) {
    try {
      const manifest = JSON.parse(readFileSync(marketplacePath, 'utf8'));
      const listed = Array.isArray(manifest.plugins) && manifest.plugins.some((p) => p?.name === 'sdlc-rstack');
      checks.push(listed
        ? check('claude-code marketplace lists sdlc-rstack', PASS,
          '`/plugin marketplace add richard-devbot/SDLC-rstack` then `/plugin install sdlc-rstack` will resolve')
        : check('claude-code marketplace lists sdlc-rstack', FAIL,
          '.claude-plugin/marketplace.json exists but does not list the sdlc-rstack plugin',
          'node scripts/generate-marketplace.mjs'));
    } catch (error) {
      checks.push(check('claude-code marketplace lists sdlc-rstack', FAIL,
        `.claude-plugin/marketplace.json is not valid JSON: ${error.message}`,
        'node scripts/generate-marketplace.mjs'));
    }
  }
  return checks;
}

function checkClaudeCodeWiring(projectRoot) {
  const settingsPath = join(projectRoot, '.claude', 'settings.json');
  if (!existsSync(settingsPath)) {
    return [check('claude-code PreToolUse guard hook', FAIL,
      `.claude/settings.json not found at ${settingsPath}`, CLAUDE_HOOK_SNIPPET)];
  }
  // Read + parse defensively — a malformed settings.json is a FAIL, not a throw.
  let raw;
  try {
    raw = readFileSync(settingsPath, 'utf8');
  } catch (error) {
    return [check('claude-code PreToolUse guard hook', FAIL,
      `.claude/settings.json unreadable: ${error.message}`, CLAUDE_HOOK_SNIPPET)];
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return [check('claude-code PreToolUse guard hook', FAIL,
      `.claude/settings.json is not valid JSON: ${error.message}`, CLAUDE_HOOK_SNIPPET)];
  }
  const preToolUse = parsed?.hooks?.PreToolUse;
  const hooksText = JSON.stringify(Array.isArray(preToolUse) ? preToolUse : '');
  const invokesGuard = hooksText.includes('rstack-agents') && hooksText.includes('guard');
  const guardCheck = invokesGuard
    ? check('claude-code PreToolUse guard hook', PASS,
      'PreToolUse hook routes tool calls through `rstack-agents guard`')
    : check('claude-code PreToolUse guard hook', FAIL,
      Array.isArray(preToolUse) && preToolUse.length
        ? 'a PreToolUse hook exists but none invoke `rstack-agents guard`'
        : 'no PreToolUse hook invoking `rstack-agents guard` in .claude/settings.json',
      CLAUDE_HOOK_SNIPPET);

  // Observability wiring (#251): a PostToolUse (or Stop / SessionEnd) hook that
  // invokes `rstack-agents observe`. WARN not FAIL — observability is additive,
  // so its absence degrades the dashboard but never breaks enforcement.
  const observeHooks = [parsed?.hooks?.PostToolUse, parsed?.hooks?.Stop, parsed?.hooks?.SessionEnd];
  const observeText = JSON.stringify(observeHooks.filter(Array.isArray));
  const invokesObserve = observeText.includes('rstack-agents') && observeText.includes('observe');
  const observeCheck = invokesObserve
    ? check('claude-code observability hook', PASS,
      'PostToolUse/Stop/SessionEnd hook feeds `rstack-agents observe` — terminal activity reaches the Business Hub')
    : check('claude-code observability hook', WARN,
      'no PostToolUse/Stop/SessionEnd hook invoking `rstack-agents observe` — ordinary terminal work will NOT appear in the Business Hub (enforcement still works)',
      OBSERVE_HOOK_SNIPPET);

  // Context injection (#255): a UserPromptSubmit (or SessionStart) hook invoking
  // `rstack-agents context`. WARN not FAIL — context is additive.
  const contextHooks = [parsed?.hooks?.UserPromptSubmit, parsed?.hooks?.SessionStart];
  const contextText = JSON.stringify(contextHooks.filter(Array.isArray));
  const invokesContext = contextText.includes('rstack-agents') && contextText.includes('context');
  const contextCheck = invokesContext
    ? check('claude-code context hook', PASS,
      'UserPromptSubmit/SessionStart hook injects RStack context via `rstack-agents context` — agents start each prompt run-aware')
    : check('claude-code context hook', WARN,
      'no UserPromptSubmit/SessionStart hook invoking `rstack-agents context` — agents will NOT get the RStack run/stage/approval packet (enforcement + observability still work)',
      CONTEXT_HOOK_SNIPPET);

  // Notification routing (#255): a Notification hook invoking notify-hook. WARN.
  const notifyHooks = [parsed?.hooks?.Notification];
  const notifyText = JSON.stringify(notifyHooks.filter(Array.isArray));
  const invokesNotify = notifyText.includes('rstack-agents') && notifyText.includes('notify-hook');
  const notifyCheck = invokesNotify
    ? check('claude-code notification hook', PASS,
      'Notification hook routes host notifications to your channels via `rstack-agents notify-hook`')
    : check('claude-code notification hook', WARN,
      'no Notification hook invoking `rstack-agents notify-hook` — host notifications will NOT reach your Slack/Teams/Discord channels (everything else still works)',
      'rstack-agents init --framework claude-code (adds the Notification hook)');

  // Quality gates (#256): OPT-IN, so this is purely INFORMATIONAL — never a
  // FAIL and never a WARN. We report which presets (if any) are wired into
  // PreToolUse alongside guard so `doctor` answers "are my gates on?".
  const preToolUseText = JSON.stringify(Array.isArray(preToolUse) ? preToolUse : []);
  const wiredGates = ['plan-gate', 'tdd-gate', 'scope-guard'].filter(
    (g) => preToolUseText.includes(`gate ${g}`),
  );
  const gatesCheck = wiredGates.length
    ? check('claude-code quality gates', PASS,
      `opt-in quality gates wired: ${wiredGates.join(', ')}${wiredGates.includes('tdd-gate') ? ' (tdd-gate BLOCKS production edits with no test — override: RSTACK_ALLOW_NO_TESTS=1)' : ''}`)
    : check('claude-code quality gates', PASS,
      'no opt-in quality gates wired (default). Enable with `rstack-agents init --framework claude-code --gates plan,tdd,scope`');

  // Status line (#257): a top-level `statusLine` settings key invoking
  // `rstack-agents statusline`. Purely INFORMATIONAL — display-only, so never a
  // FAIL and never a WARN. We just report whether the RStack status bar is wired.
  const statusLineText = JSON.stringify(parsed?.statusLine ?? '');
  const invokesStatusline = statusLineText.includes('rstack-agents') && statusLineText.includes('statusline');
  const statuslineCheck = invokesStatusline
    ? check('claude-code status line', PASS,
      'statusLine key renders live RStack context via `rstack-agents statusline` — active run, stage, approvals, and open decisions in the status bar')
    : check('claude-code status line', PASS,
      'no statusLine key invoking `rstack-agents statusline` (optional, display-only). Add it with `rstack-agents init --framework claude-code`');

  // Matcher breadth (#324, the #286 residual): init never overwrites an
  // existing settings.json, so installs initialized before #286 keep the
  // narrow 'Bash|Write|Edit' matcher — and Claude Code only fires a hook
  // whose matcher names the tool, so on those installs the guard NEVER RUNS
  // for MultiEdit/NotebookEdit. The guard self-test can't see this (it probes
  // the binary, not the host wiring), so the wiring check owns it: FAIL for
  // the guard (enforcement hole), WARN for observe (blind dashboard only).
  const breadthChecks = [];
  const guardBreadth = matcherBreadth(preToolUse, 'guard');
  if (guardBreadth) {
    breadthChecks.push(guardBreadth.missing.length === 0
      ? check('claude-code guard matcher breadth', PASS,
        `PreToolUse guard matcher covers the enforced tool set (${ENFORCED_TOOL_MATCHER})`)
      : check('claude-code guard matcher breadth', FAIL,
        `PreToolUse guard matcher '${guardBreadth.matcher}' does not fire for: ${guardBreadth.missing.join(', ')} — a secret write via those tools bypasses enforcement on this install (pre-#286 init)`,
        `Edit .claude/settings.json: set the guard hook's matcher to "${ENFORCED_TOOL_MATCHER}" (init never overwrites existing settings — this is a one-line manual fix, or re-merge from .claude/rstack-hooks.json)`));
  }
  const observeBreadth = matcherBreadth(parsed?.hooks?.PostToolUse, 'observe');
  if (observeBreadth && observeBreadth.missing.length > 0) {
    breadthChecks.push(check('claude-code observe matcher breadth', WARN,
      `PostToolUse observe matcher '${observeBreadth.matcher}' misses: ${observeBreadth.missing.join(', ')} — activity via those tools will not reach the Business Hub (enforcement unaffected once the guard matcher is fixed)`,
      `Edit .claude/settings.json: set the observe hook's matcher to "${ENFORCED_TOOL_MATCHER}"`));
  }

  return [guardCheck, ...breadthChecks, observeCheck, contextCheck, notifyCheck, gatesCheck, statuslineCheck];
}

// The tool set every enforcement matcher must cover — mirrors init.js
// ENFORCED_TOOLS (#286) and is pinned against it by the doctor tests.
const ENFORCED_TOOL_MATCHER = 'Bash|Write|Edit|MultiEdit|NotebookEdit';

/**
 * Find the hook group invoking `rstack-agents <invoker>` and report which
 * enforced tools its matcher misses. Returns null when no such group exists
 * (presence is the wiring check's verdict, not breadth's). An absent/empty
 * matcher or a regex wildcard matches every tool in Claude Code — that is
 * full breadth, not a gap.
 */
function matcherBreadth(entries, invoker) {
  const group = (Array.isArray(entries) ? entries : []).find((entry) => {
    const text = JSON.stringify(entry?.hooks ?? '');
    return text.includes('rstack-agents') && text.includes(invoker);
  });
  if (!group) return null;
  const matcher = String(group.matcher ?? '').trim();
  if (!matcher || matcher === '*' || matcher.includes('.*')) return { matcher: matcher || '(all tools)', missing: [] };
  const tools = matcher.split('|').map((tool) => tool.trim());
  const missing = ENFORCED_TOOL_MATCHER.split('|').filter((tool) => !tools.includes(tool));
  return { matcher, missing };
}

function checkPiWiring() {
  // Pi auto-loads the SDLC extension from the package (pi.extensions). We check
  // the packaged extension entry is present — that's what the host loads.
  const extEntry = join(PACKAGE_ROOT, 'extensions', 'rstack-sdlc.ts');
  const impl = join(PACKAGE_ROOT, 'src', 'integrations', 'pi', 'rstack-sdlc.ts');
  const checks = [
    fileCheck('pi extension entry', extEntry, 'extensions/rstack-sdlc.ts',
      'Reinstall the package: npm install rstack-agents'),
  ];
  // The implementation module is the real extension body — report defensively.
  checks.push(existsSync(impl)
    ? check('pi extension implementation', PASS, 'src/integrations/pi/rstack-sdlc.ts present')
    : check('pi extension implementation', WARN,
      `src/integrations/pi/rstack-sdlc.ts not found at ${impl} — the packaged shim may still re-export it`, null));
  return checks;
}

function checkBridge() {
  const bridge = join(PACKAGE_ROOT, 'bin', 'rstack-operator-bridge.ts');
  return fileCheck('bridge reachable', bridge, 'bin/rstack-operator-bridge.ts',
    'Reinstall the package: npm install rstack-agents');
}

function checkAdapterWiring(framework) {
  // operator / tau / hermes share the Node bridge; each has its own adapter
  // file. The tau adapter ships separately (#243) — a missing adapter is a
  // FAIL with the expected path, NEVER a crash (defensive probe).
  const adapterPaths = {
    operator: [
      join(PACKAGE_ROOT, 'src', 'integrations', 'operator', 'rstack_sdlc.py'),
      join(PACKAGE_ROOT, 'extensions', 'rstack_sdlc.py'),
    ],
    tau: [
      join(PACKAGE_ROOT, 'src', 'integrations', 'tau', 'rstack_sdlc.py'),
      join(PACKAGE_ROOT, 'src', 'integrations', 'tau', 'adapter.py'),
      join(PACKAGE_ROOT, 'src', 'integrations', 'tau', 'index.js'),
    ],
    hermes: [
      join(PACKAGE_ROOT, 'src', 'integrations', 'hermes', 'rstack_sdlc.py'),
    ],
  };
  const candidates = adapterPaths[framework] ?? [];
  const found = candidates.find((p) => existsSync(p));
  const relFirst = candidates[0] ? candidates[0].replace(`${PACKAGE_ROOT}/`, '') : `src/integrations/${framework}/`;
  const adapterCheck = found
    ? check(`${framework} adapter present`, PASS, `${found.replace(`${PACKAGE_ROOT}/`, '')} present`)
    : check(`${framework} adapter present`, FAIL,
      `no ${framework} adapter found (looked for ${relFirst}${candidates.length > 1 ? ' and alternates' : ''})`,
      framework === 'tau'
        ? 'The tau adapter ships in a separate change — update: npm install rstack-agents@latest'
        : 'Reinstall the package: npm install rstack-agents');

  const checks = [adapterCheck, checkBridge()];

  // Observability + context wiring (#251/#255): the tau adapter emits events via
  // `rstack-agents observe` and injects context via `rstack-agents context`.
  // WARN (additive) if absent.
  if (framework === 'tau') checks.push(...checkTauObservability(found));
  if (framework === 'hermes') checks.push(...checkHermesWiring(found));
  if (framework === 'operator') checks.push(...checkOperatorWiring(found));

  return checks;
}

// #391: operator-use 0.2.9 has NO third-party plugin discovery (no
// entry_points, no config field, no directory scan) — cli/start.py hardcodes
// its plugin list directly in Python source. bootstrap.py is the only way to
// wire RStack in: it's a drop-in replacement for the `operator` console
// script that monkeypatches the hardcoded plugin list before handing off to
// the real Typer app. This check fails loud if bootstrap.py is missing, and
// pins the adapter against regressing to the fictional
// operator_use.extension/operator_use.tool modules the pre-#391 adapter
// imported (neither exists in the real package — verified live).
function checkOperatorWiring(adapterPath) {
  const bootstrapPath = join(PACKAGE_ROOT, 'src', 'integrations', 'operator', 'bootstrap.py');
  const bootstrapCheck = fileCheck('operator bootstrap.py', bootstrapPath, 'src/integrations/operator/bootstrap.py',
    'Reinstall the package: npm install rstack-agents');

  if (!adapterPath) {
    return [bootstrapCheck, check('operator adapter uses the real operator_use API', WARN,
      'operator adapter not found — cannot confirm which API it targets', null)];
  }
  let raw = '';
  try {
    raw = readFileSync(adapterPath, 'utf8');
  } catch (error) {
    return [bootstrapCheck, check('operator adapter uses the real operator_use API', WARN,
      `could not read the operator adapter to confirm its API surface: ${error.message}`, null)];
  }
  // Match real import statements only — the module docstring quotes the OLD
  // broken import paths verbatim to document the #391 correction, which would
  // otherwise false-positive this check against prose, not code (the same
  // class of bug fixed in checkHermesWiring above).
  const imports = (raw.match(/^(?:from|import)[ \t]+operator_use\S*/gm) ?? []).join('\n');
  const usesRealApi = imports.includes('operator_use.plugins') && imports.includes('operator_use.tools')
    && !imports.includes('operator_use.extension') && !imports.includes('operator_use.tool.types');
  const apiCheck = usesRealApi
    ? check('operator adapter uses the real operator_use API', PASS,
      'imports operator_use.plugins.Plugin / operator_use.tools.Tool — both verified against the installed package (#391)')
    : check('operator adapter uses the real operator_use API', FAIL,
      'the operator adapter references operator_use.extension/operator_use.tool — neither module exists in operator-use 0.2.9; every import would raise ModuleNotFoundError',
      'Update the package: npm install rstack-agents@latest');

  const tierNote = check('operator plugin-loading tier', WARN,
    'operator-use has no third-party plugin discovery mechanism (no entry_points, no config field, no directory scan) — '
    + 'run the RStack-wrapped bootstrap in place of the `operator` command: '
    + 'python node_modules/rstack-agents/src/integrations/operator/bootstrap.py start. '
    + 'See docs/integrations/operator.md for why.', null);

  return [bootstrapCheck, apiCheck, tierNote];
}

// #390: Hermes requires a plugin.yaml manifest alongside the adapter's
// __init__.py — the loader silently SKIPS any plugin directory without one
// (verified against a live hermes-agent install), so a missing manifest is a
// FAIL, not a WARN. Also verifies the guard payload uses the real
// {"action": "block", "message": ...} shape a live Hermes dispatch actually
// reads (hermes_cli/plugins.py _get_pre_tool_call_directive_details) — the
// original {"decision": "block", "reason": ...} shape (a Claude-Code
// convention that applies to a DIFFERENT Hermes subsystem) is silently
// ignored, so the guard fires but never actually blocks anything.
function checkHermesWiring(adapterPath) {
  const manifestPath = join(PACKAGE_ROOT, 'src', 'integrations', 'hermes', 'plugin.yaml');
  const manifestCheck = fileCheck('hermes plugin.yaml manifest', manifestPath, 'src/integrations/hermes/plugin.yaml',
    'Reinstall the package: npm install rstack-agents');

  if (!adapterPath) {
    return [manifestCheck, check('hermes guard payload shape', WARN,
      'hermes adapter not found — cannot confirm the guard payload shape', null)];
  }
  let raw = '';
  try {
    raw = readFileSync(adapterPath, 'utf8');
  } catch (error) {
    return [manifestCheck, check('hermes guard payload shape', WARN,
      `could not read the hermes adapter to confirm the guard payload shape: ${error.message}`, null)];
  }
  // Match the actual `return {...}` statement only — the module docstring and
  // comments quote the OLD wrong shape verbatim to document the correction,
  // which would otherwise false-positive this check against prose, not code.
  const blockReturn = raw.match(/^[ \t]*return[ \t]*\{[^}]*\}/m)?.[0] ?? '';
  const usesRealShape = blockReturn.includes('"action": "block"') && !blockReturn.includes('"decision": "block"');
  const shapeCheck = usesRealShape
    ? check('hermes guard payload shape', PASS,
      'the hermes adapter returns the real {"action":"block","message":...} shape hermes_cli/plugins.py reads — the guard actually blocks')
    : check('hermes guard payload shape', FAIL,
      'the hermes adapter does not appear to use the real {"action":"block"} payload shape — a Claude-Code-style {"decision":"block"} is silently ignored by Hermes\' pre_tool_call dispatch, so the guard would fire but never actually block anything',
      'Update the package: npm install rstack-agents@latest');

  return [manifestCheck, shapeCheck];
}

// The tau adapter carries its own observability wiring (loading it IS the
// wiring — no host config), so we verify the adapter FILE invokes
// `rstack-agents observe`. WARN, never FAIL: enforcement is independent.
function checkTauObservability(adapterPath) {
  if (!adapterPath) {
    return [check('tau observability hook', WARN,
      'tau adapter not found — cannot confirm observability wiring',
      'Update the package: npm install rstack-agents@latest')];
  }
  let raw = '';
  try {
    raw = readFileSync(adapterPath, 'utf8');
  } catch (error) {
    return [check('tau observability hook', WARN,
      `could not read the tau adapter to confirm observability wiring: ${error.message}`, null)];
  }
  const emitsObserve = raw.includes('rstack-agents') && raw.includes('observe')
    && (raw.includes('tool_result') || raw.includes('_emit_observation'));
  const observeCheck = emitsObserve
    ? check('tau observability hook', PASS,
      'the tau adapter feeds `rstack-agents observe` on its tool hooks — Tau activity reaches the Business Hub')
    : check('tau observability hook', WARN,
      'the tau adapter does not appear to emit `rstack-agents observe` events — Tau terminal work will NOT appear in the Business Hub (enforcement still works)',
      'Update the package: npm install rstack-agents@latest');

  // Context injection (#255, corrected #389): the tau adapter injects the
  // RStack packet on the real `input` hook — NOT `before_agent_start`, which
  // a #389 source audit found is never fired by the real Tau engine. WARN if
  // the wiring is absent (additive).
  const injectsContext = raw.includes('rstack-agents') && raw.includes('context')
    && raw.includes('@tau.on("input")');
  const contextCheck = injectsContext
    ? check('tau context hook', PASS,
      'the tau adapter injects RStack context via `rstack-agents context` on the real `input` hook — Tau agents start each turn run-aware')
    : check('tau context hook', WARN,
      'the tau adapter does not appear to inject `rstack-agents context` — Tau agents will NOT get the RStack run/stage/approval packet (enforcement + observability still work)',
      'Update the package: npm install rstack-agents@latest');

  return [observeCheck, contextCheck];
}

async function checkFrameworkWiring(framework, projectRoot) {
  if (framework === 'claude-code') return [...checkClaudeCodeWiring(projectRoot), ...checkClaudeCodePlugin()];
  if (framework === 'pi') return checkPiWiring();
  if (framework === 'operator' || framework === 'tau' || framework === 'hermes') return checkAdapterWiring(framework);
  if (framework === 'custom') {
    // custom: the only requirement is a reachable guard binary — verified by
    // the guard self-test below. Report the bin file presence here too.
    return [fileCheck('guard binary reachable', BIN, 'bin/rstack-agents.js (guard entry)',
      'Reinstall the package: npm install rstack-agents')];
  }
  return [];
}

// --- guard self-test (the hero check) ---------------------------------------

function spawnGuard(args, stdinText) {
  return new Promise((resolveP) => {
    // Hermetic: strip RStack knobs that could change the verdict, so the
    // self-test reflects default enforcement policy.
    const env = { ...process.env };
    for (const key of ['RSTACK_ALLOW_DESTRUCTIVE', 'RSTACK_TASK_ID', 'RSTACK_AGENT_CONTEXT', 'RSTACK_VALIDATOR_CONTEXT']) {
      delete env[key];
    }
    let child;
    try {
      child = spawn(process.execPath, [BIN, 'guard', ...args], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (error) {
      resolveP({ code: null, error: error.message });
      return;
    }
    let stdout = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', () => {});
    child.on('error', (error) => resolveP({ code: null, error: error.message }));
    child.on('close', (code) => resolveP({ code, stdout }));
    child.stdin.end(stdinText);
  });
}

async function checkGuardSelfTest(projectRoot) {
  // One probe per enforcement family (#286): the original Bash-only probe
  // reported enforcement "live" while every non-Bash form (MultiEdit secret
  // write, PowerShell delete) sailed through unclassified — the self-test
  // must exercise the forms that actually broke, not just the happy path.
  const probes = [
    { label: 'Bash rm -rf', want: 2, payload: { tool_name: 'Bash', tool_input: { command: 'rm -rf /tmp/x' } } },
    { label: 'MultiEdit .env write', want: 2, payload: { tool_name: 'MultiEdit', tool_input: { file_path: '.env', edits: [] } } },
    { label: 'PowerShell Remove-Item -Recurse -Force', want: 2, payload: { tool_name: 'Bash', tool_input: { command: 'Remove-Item -Recurse -Force C:\\tmp\\x' } } },
    // #372: a validator subagent (identified by `agent_type` in the PreToolUse
    // payload — the only signal available for a plugin subagent, whose agent-def
    // hooks Claude Code ignores) must be sandboxed read-only even though the
    // hook wiring passes `--context builder`. Its bash WRITE blocks; its bash
    // READ allows. This proves the shared escalation is live, not just wired.
    { label: 'validator subagent bash write (agent_type)', want: 2, payload: { tool_name: 'Bash', tool_input: { command: 'echo x > src/app.js' }, agent_type: 'validator' } },
    { label: 'validator subagent bash read (agent_type)', want: 0, payload: { tool_name: 'Bash', tool_input: { command: 'ls -la' }, agent_type: 'validator' } },
    { label: 'safe ls', want: 0, payload: { tool_name: 'Bash', tool_input: { command: 'ls' } } },
    { label: 'safe Edit to source file', want: 0, payload: { tool_name: 'Edit', tool_input: { file_path: 'src/app.js' } } },
  ];
  const args = ['--context', 'builder', '--project', resolve(projectRoot)];

  const results = [];
  for (const probe of probes) {
    const res = await spawnGuard(args, JSON.stringify(probe.payload));
    if (res.error) {
      return check('guard self-test (enforcement live)', FAIL,
        `could not spawn the guard: ${res.error}`,
        'Reinstall the package and confirm `rstack-agents guard` runs: echo \'{"tool_name":"Bash","tool_input":{"command":"ls"}}\' | rstack-agents guard');
    }
    results.push({ ...probe, code: res.code });
  }

  const failures = results.filter((probe) => probe.code !== probe.want);
  if (!failures.length) {
    return check('guard self-test (enforcement live)', PASS,
      'destructive Bash, MultiEdit secret-write, and PowerShell delete all blocked (exit 2); a validator subagent\'s bash WRITE blocked but its READ allowed (agent_type sandbox, #372); safe calls allowed (exit 0) — RStack enforcement is live on this machine');
  }
  const detail = failures.map((probe) => `${probe.label} exited ${probe.code} (want ${probe.want})`).join('; ');
  return check('guard self-test (enforcement live)', FAIL, `enforcement is NOT behaving as expected: ${detail}`,
    'Verify the guard: echo \'{"tool_name":"MultiEdit","tool_input":{"file_path":".env"}}\' | rstack-agents guard --context builder ; echo exit=$?');
}

// --- hub health -------------------------------------------------------------

function checkHubHealth() {
  const port = Number(process.env.RSTACK_BUSINESS_PORT ?? 3008);
  return new Promise((resolveP) => {
    const req = httpGet({ hostname: '127.0.0.1', port, path: '/health', timeout: 1000 }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        let ok = false;
        try { ok = JSON.parse(body)?.ok === true; } catch { /* ignore */ }
        resolveP(ok
          ? check('business hub', PASS, `hub healthy on :${port}`)
          : check('business hub', WARN, `something answered :${port}/health but not the RStack hub`, 'npx rstack-agents hub'));
      });
    });
    req.on('error', () => resolveP(check('business hub', WARN, `hub not running on :${port}`, 'npx rstack-agents hub')));
    req.on('timeout', () => { req.destroy(); resolveP(check('business hub', WARN, `hub did not respond on :${port} within 1s`, 'npx rstack-agents hub')); });
  });
}

// --- self-dependency tripwire ----------------------------------------------

async function checkSelfDependency(cwd) {
  // On 2026-07-07, running `npm i rstack-agents` INSIDE this repo added
  // rstack-agents to its own package.json deps (and chmod'd its bins). Detect
  // that footgun so contributors don't ship a self-referential package.
  const pkgPath = join(resolve(cwd), 'package.json');
  if (!existsSync(pkgPath)) {
    return check('self-dependency tripwire', PASS, 'no package.json in cwd — not the rstack-agents repo');
  }
  let pkg;
  try {
    pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
  } catch {
    return check('self-dependency tripwire', WARN, 'cwd package.json is unreadable — skipped the tripwire', null);
  }
  const isSelf = pkg?.name === 'rstack-agents';
  const deps = { ...pkg?.dependencies, ...pkg?.devDependencies };
  if (isSelf && 'rstack-agents' in deps) {
    return check('self-dependency tripwire', WARN,
      'this IS the rstack-agents repo and it lists rstack-agents in its own dependencies — a self-dependency footgun (you likely ran `npm i rstack-agents` inside the repo)',
      'Remove the self-dependency: npm uninstall rstack-agents ; then `git checkout package.json package-lock.json`. Test adopters in a SCRATCH dir instead (mkdir ~/rstack-test && cd ~/rstack-test).');
  }
  return check('self-dependency tripwire', PASS,
    isSelf ? 'this is the rstack-agents repo and has no self-dependency' : 'cwd is not the rstack-agents repo');
}

// --- orchestration ----------------------------------------------------------

export async function runDoctor({ framework, project, cwd = process.cwd(), autostart = false } = {}) {
  const projectRoot = resolve(project ?? cwd);
  const checks = [];

  let pkg = {};
  try {
    pkg = JSON.parse(await readFile(join(PACKAGE_ROOT, 'package.json'), 'utf8'));
  } catch { /* engines fallback applies */ }

  // Environment
  checks.push(checkNodeVersion(pkg));
  checks.push(await checkNpx());
  checks.push(checkPackageResolvable(cwd));
  checks.push(await checkGuardResolution(cwd));

  // State + config
  checks.push(checkRstackDir(projectRoot));
  checks.push(await checkConfigs(projectRoot));

  // Email approval notifications (#353) — reported only when at least one
  // half is configured; a wholly-unconfigured opt-in feature is not a finding.
  const emailCheck = checkEmailNotifications(projectRoot);
  if (emailCheck) checks.push(emailCheck);

  // Sandbox execution tier (#452): container-verified vs. unverified — the honest
  // answer to "are my test results real or self-reported?". With autostart, tries
  // an opt-in bounded engine start first (never a hidden launch otherwise).
  checks.push(await checkSandboxTier(projectRoot, { autostart }));

  // Framework wiring (explicit --framework, else auto-detect; else all-generic)
  const detected = framework ?? await detectFrameworkLocal(projectRoot);
  const effectiveFramework = framework ?? detected ?? 'custom';
  const frameworkSource = framework ? 'requested' : detected ? 'auto-detected' : 'no framework detected — checking generic guard wiring';
  checks.push(check('framework', PASS, `${effectiveFramework} (${frameworkSource})`));
  for (const c of await checkFrameworkWiring(effectiveFramework, projectRoot)) checks.push(c);

  // Hero check
  checks.push(await checkGuardSelfTest(projectRoot));

  // Hub
  checks.push(await checkHubHealth());

  // Tripwire
  checks.push(await checkSelfDependency(cwd));

  const summary = {
    pass: checks.filter((c) => c.status === PASS).length,
    fail: checks.filter((c) => c.status === FAIL).length,
    warn: checks.filter((c) => c.status === WARN).length,
  };
  const exitCode = summary.fail > 0 ? 1 : 0;
  return { framework: effectiveFramework, framework_source: frameworkSource, project: projectRoot, checks, summary, exitCode };
}

// --- formatting -------------------------------------------------------------

const ICON = { PASS: '✓', FAIL: '✗', WARN: '!' };

export function formatDoctorReport(report, { color = false } = {}) {
  const paint = color
    ? { PASS: (s) => `\x1b[32m${s}\x1b[0m`, FAIL: (s) => `\x1b[31m${s}\x1b[0m`, WARN: (s) => `\x1b[33m${s}\x1b[0m` }
    : { PASS: (s) => s, FAIL: (s) => s, WARN: (s) => s };
  const lines = [];
  lines.push(`RStack doctor — framework: ${report.framework} (${report.framework_source})`);
  lines.push(`Project: ${report.project}`);
  lines.push('');
  const nameWidth = Math.max(...report.checks.map((c) => c.name.length), 4);
  for (const c of report.checks) {
    const badge = paint[c.status](`${ICON[c.status]} ${c.status}`);
    lines.push(`  ${badge}  ${c.name.padEnd(nameWidth)}  ${c.detail}`);
    if (c.status === FAIL && c.fix) lines.push(`         fix: ${c.fix}`);
    if (c.status === WARN && c.fix) lines.push(`         hint: ${c.fix}`);
  }
  lines.push('');
  lines.push(`Summary: ${report.summary.pass} PASS / ${report.summary.fail} FAIL / ${report.summary.warn} WARN`);
  lines.push(report.summary.fail > 0
    ? 'Result: FAIL — resolve the FAIL checks above (each lists its fix).'
    : 'Result: OK — governance is set up on this machine.');
  return lines.join('\n');
}
