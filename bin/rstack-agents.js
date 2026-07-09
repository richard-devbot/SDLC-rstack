#!/usr/bin/env node
/**
 * rstack-agents CLI entry point.
 *
 * Commands:
 *   rstack-agents init [--framework pi|claude-code|operator|custom]
 *   rstack-agents list <agents|skills|plugins>
 *   rstack-agents inventory [--json]
 *   rstack-agents add plugin <name>
 *   rstack-agents validate
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { listAgents, listSkills, listPlugins, addPlugin } from '../src/commands/list.js';
import { loadPipelineStatus, formatPipelineStatus } from '../src/commands/pipeline.js';
import { runPipeline, formatRunReport } from '../src/commands/pipeline-run.js';
import { runGoalLoop, formatLoopReport, loadGoalDefinition } from '../src/commands/pipeline-loop.js';
import { adoptProject, formatAdoptionReport } from '../src/commands/adopt.js';
import { envScan, formatEnvScan } from '../src/commands/env-scan.js';
import { buildBackendInventory, formatBackendInventory, writeBackendInventory } from '../src/core/inventory/backend-inventory.js';
import { validateCommand } from '../src/commands/validate.js';
import { runGuardCommand, readStdinText } from '../src/commands/guard.js';
import { runGateCommand, readStdinText as readGateStdin, GATE_NAMES } from '../src/commands/gate.js';
import { runObserveCommand, readStdinText as readObserveStdin } from '../src/commands/observe.js';
import { runContextCommand, readStdinText as readContextStdin } from '../src/commands/context.js';
import { runNotifyHookCommand, readStdinText as readNotifyStdin } from '../src/commands/notify-hook.js';
import { runStatuslineCommand, readStdinText as readStatuslineStdin } from '../src/commands/statusline.js';
import { runDoctor, formatDoctorReport, DOCTOR_FRAMEWORKS } from '../src/commands/doctor.js';
import { initFramework, detectFramework, FRAMEWORKS } from '../src/integrations/init.js';
import { notifyAll, resolveChannels, formatSlackStageMessage } from '../src/notifications/index.js';
import { autoLaunchBusinessHub } from '../src/hooks/auto-launch.js';
import { registerProject } from '../src/core/tracker/registry.js';
import { addDecision, decide, readDecisions, summarizeDecisions } from '../src/core/harness/decisions.js';
import { dorCheck } from '../src/core/harness/readiness.js';
import { log } from '../src/utils/logger.js';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(__dirname, '..', 'package.json'), 'utf8'));

const program = new Command();

program
  .name('rstack-agents')
  .description('Inspect the RStack SDLC Pi package assets')
  .version(pkg.version);

const listCmd = program
  .command('list')
  .description('List packaged agents, skills, or plugins');

listCmd
  .command('agents')
  .description('List all packaged agents grouped by domain')
  .action(async () => {
    try {
      await listAgents();
    } catch (err) {
      log.error(err.message);
      process.exit(1);
    }
  });

listCmd
  .command('skills')
  .description('List all packaged skills with descriptions')
  .action(async () => {
    try {
      await listSkills();
    } catch (err) {
      log.error(err.message);
      process.exit(1);
    }
  });

listCmd
  .command('plugins')
  .description('List all packaged plugins with descriptions')
  .action(async () => {
    try {
      await listPlugins();
    } catch (err) {
      log.error(err.message);
      process.exit(1);
    }
  });

program
  .command('add')
  .argument('<resource>', 'resource type to add, currently only "plugin"')
  .argument('<name>', 'name of the resource to add')
  .description('Copy a packaged plugin into .rstack/plugins/<name> in the current project')
  .action(async (resource, name) => {
    try {
      if (resource !== 'plugin') {
        log.error(`Unknown resource type "${resource}". Only "plugin" is supported.`);
        process.exit(1);
      }
      await addPlugin(name);
    } catch (err) {
      log.error(err.message);
      process.exit(1);
    }
  });

program
  .command('decisions')
  .description('List, add, resolve, or waive run-level Decision Queue items')
  .option('-p, --project <path>', 'project root (defaults to current directory)')
  .option('-r, --run-id <runId>', 'run id (defaults to latest run)')
  .option('--add <question>', 'add a pending decision question')
  .option('--impact <impact>', 'architecture | security | budget | scope | delivery', 'scope')
  .option('--before <stage>', 'required before canonical stage', '06-architecture')
  .option('--resolve <decisionId>', 'mark a decision resolved')
  .option('--waive <decisionId>', 'mark a decision waived')
  .option('--resolution <text>', 'resolution or waiver reason')
  .option('--by <name>', 'resolver name', 'human')
  .action(async (opts) => {
    try {
      const projectRoot = resolve(opts.project ?? process.cwd());
      if (opts.add) {
        const created = await addDecision(projectRoot, opts.runId, {
          question: opts.add,
          impact: opts.impact,
          required_before_stage: opts.before,
        });
        console.log(JSON.stringify(created, null, 2));
        return;
      }
      if (opts.resolve || opts.waive) {
        const updated = await decide(projectRoot, opts.runId, opts.resolve || opts.waive, {
          status: opts.resolve ? 'resolved' : 'waived',
          resolution: opts.resolution || '',
          resolvedBy: opts.by,
        });
        console.log(JSON.stringify(updated, null, 2));
        return;
      }
      const decisions = await readDecisions(projectRoot, opts.runId);
      console.log(JSON.stringify({ summary: summarizeDecisions(decisions), decisions }, null, 2));
    } catch (err) {
      log.error(err.message);
      process.exit(1);
    }
  });

program
  .command('dor')
  .description('Run the Definition-of-Ready gate for the latest or selected RStack run')
  .option('-p, --project <path>', 'project root (defaults to current directory)')
  .option('-r, --run-id <runId>', 'run id (defaults to latest run)')
  .option('--stage <stage>', 'target canonical stage', '07-code')
  .action(async (opts) => {
    try {
      const projectRoot = resolve(opts.project ?? process.cwd());
      const report = await dorCheck(projectRoot, { runId: opts.runId, targetStage: opts.stage });
      console.log(JSON.stringify(report, null, 2));
      process.exit(report.status === 'FAIL' ? 1 : 0);
    } catch (err) {
      log.error(err.message);
      process.exit(1);
    }
  });

const pipelineCmd = program
  .command('pipeline')
  .description('Inspect authoritative harness pipeline state without the Business Hub');

pipelineCmd
  .command('status')
  .description('Show pipeline status for the latest or selected run, with one recommended next action')
  .option('-p, --project <path>', 'project root (defaults to current directory)')
  .option('-r, --run-id <runId>', 'run id (defaults to latest run)')
  .option('--json', 'print the complete pipeline-state object as JSON with no decorative text')
  .option('--regenerate', 'rebuild and persist the rollup from canonical run artifacts')
  .action(async (opts) => {
    try {
      const projectRoot = resolve(opts.project ?? process.cwd());
      const { state } = await loadPipelineStatus(projectRoot, { runId: opts.runId, regenerate: opts.regenerate });
      if (opts.json) {
        // JSON mode: the state object only — errors and decoration stay on stderr.
        process.stdout.write(`${JSON.stringify(state, null, 2)}\n`);
      } else {
        console.log(formatPipelineStatus(state));
      }
    } catch (err) {
      log.error(err.message);
      process.exit(1);
    }
  });

pipelineCmd
  .command('run')
  .description('Advance the run from current state: skip DONE work, re-enter retryable tasks, stop at human gates')
  .option('-p, --project <path>', 'project root (defaults to current directory)')
  .option('-r, --run-id <runId>', 'run id (defaults to latest run)')
  .option('--max-steps <n>', 'maximum backend steps before stopping', '5')
  .option('--dry-run', 'show the next action without invoking tools or writing any state')
  .option('--json', 'print the structured step report as JSON')
  .action(async (opts) => {
    try {
      const projectRoot = resolve(opts.project ?? process.cwd());
      const report = await runPipeline(projectRoot, {
        runId: opts.runId,
        maxSteps: Math.max(1, Number(opts.maxSteps) || 5),
        dryRun: opts.dryRun === true,
      });
      if (opts.json) {
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      } else {
        console.log(formatRunReport(report));
      }
      // Human-gate stops exit non-zero so CI can distinguish "needs a human"
      // from "complete"; dry-run and completion exit zero.
      process.exit(['complete', 'dry_run', 'missing_contract', 'max_steps'].includes(report.stopped_on) ? 0 : 1);
    } catch (err) {
      log.error(err.message);
      process.exit(1);
    }
  });

pipelineCmd
  .command('loop')
  .description('Bounded goal loop: advance the run, evaluate the goal after each pass, rerun only recommended stages until PASS, a human gate, or a spent bound')
  .option('-p, --project <path>', 'project root (defaults to current directory)')
  .option('-r, --run-id <runId>', 'run id (defaults to latest run)')
  .option('-g, --goal <path>', 'goal definition JSON (defaults to <run>/goal.json, else the built-in pipeline-complete goal)')
  .option('--max-iterations <n>', 'iteration bound (default 3 or .rstack/rstack.config.json loop.maxIterations; hard cap 20)')
  .option('--max-steps <n>', 'backend steps per iteration (default 10)')
  .option('--dry-run', 'evaluate the goal and report the loop decision without invoking tools or writing any state')
  .option('--json', 'print the structured loop report as JSON')
  .action(async (opts) => {
    try {
      const projectRoot = resolve(opts.project ?? process.cwd());
      const goal = opts.goal ? await loadGoalDefinition(resolve(opts.goal)) : null;
      const report = await runGoalLoop(projectRoot, {
        runId: opts.runId,
        goal,
        maxIterations: opts.maxIterations != null ? Number(opts.maxIterations) : undefined,
        maxStepsPerIteration: opts.maxSteps != null ? Number(opts.maxSteps) : undefined,
        dryRun: opts.dryRun === true,
      });
      if (opts.json) {
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      } else {
        console.log(formatLoopReport(report));
      }
      // Only "goal met" and dry-run exit zero — every other stop means the
      // goal is unmet or a human is needed, and CI must be able to tell.
      process.exit(['complete', 'dry_run'].includes(report.stopped_on) ? 0 : 1);
    } catch (err) {
      log.error(err.message);
      process.exit(1);
    }
  });

program
  .command('guard')
  .description('Framework-neutral enforcement guard: classify one pending tool call and allow (exit 0) or block (exit 2). Reads Claude Code PreToolUse JSON on stdin, or takes --tool/--command/--path flags. Wire it into any harness tool-call hook.')
  .option('--tool <name>', 'tool name (bash, write, edit, ...) when passing flags instead of stdin JSON')
  .option('--command <command>', 'shell command to classify (implies --tool bash)')
  .option('--path <path>', 'write/edit target path to classify (implies --tool write)')
  .option('--context <context>', 'agent context: builder | validator | reviewer | security (default: RSTACK_AGENT_CONTEXT env, else builder; RSTACK_VALIDATOR_CONTEXT=1 always wins)')
  .option('--task <taskId>', 'task id keying the destructive-action approval (default: RSTACK_TASK_ID env)')
  .option('-p, --project <path>', 'project root (defaults to current directory)')
  .option('-r, --run-id <runId>', 'run whose audited approvals gate destructive actions (defaults to latest run)')
  .option('--explain', 'classify only: print the verdict, skip the approval lookup, always exit 0')
  .action(async (opts) => {
    try {
      const usesFlags = opts.tool !== undefined || opts.command !== undefined || opts.path !== undefined;
      const stdinText = usesFlags ? '' : await readStdinText();
      process.exit(await runGuardCommand(opts, { stdinText }));
    } catch (err) {
      // The guard must never hard-fail a hook: an unexpected error here means
      // nothing was classified — allow loudly (destructive-time failures are
      // already blocked inside runGuard, which never throws).
      process.stderr.write(`[rstack guard] internal error before classification (allowing): ${err.message}\n`);
      process.stdout.write(`${JSON.stringify({ decision: 'allow', category: null, reason: 'unclassifiable input (guard internal error)', context: null, tool: null })}\n`);
      process.exit(0);
    }
  });

program
  .command('gate <name>')
  .description(`OPT-IN quality-gate preset as a PreToolUse hook (#256): ${GATE_NAMES.join(' | ')}. Reads Claude Code tool JSON on stdin; plan-gate/scope-guard WARN (exit 0), tdd-gate BLOCKs production-code edits with no test (exit 2, overridable via RSTACK_ALLOW_NO_TESTS=1 or an audited no-tests:<taskId>/guardrail-override:<taskId> approval). OFF by default — wire with 'init --gates ...' or .rstack/rstack.config.json hooks.gates. Unknown gate/malformed input → allow.`)
  .option('--task <taskId>', 'task id keying the tdd-gate override approval (default: RSTACK_TASK_ID env)')
  .option('-p, --project <path>', 'project root (defaults to RSTACK_PROJECT_ROOT env, else current directory)')
  .option('-r, --run-id <runId>', 'run whose plan/approvals the gate consults (defaults to RSTACK_RUN_ID env, else latest)')
  .action(async (name, opts) => {
    try {
      const stdinText = await readGateStdin();
      process.exit(await runGateCommand(name, opts, { stdinText }));
    } catch (err) {
      // A gate must NEVER dead-end a session on an unexpected error — allow loudly.
      process.stderr.write(`[rstack gate] internal error before evaluation (allowing): ${err.message}\n`);
      process.stdout.write(`${JSON.stringify({ decision: 'allow', gate: String(name ?? ''), reason: 'internal error (allowed)' })}\n`);
      process.exit(0);
    }
  });

program
  .command('observe')
  .description('Framework-neutral observability writer (#251): append one normalized tool_call/tool_result/session event to the active run\'s events.jsonl so the Business Hub mirrors terminal activity on ANY harness. Reads a Claude Code PostToolUse/Stop/SessionEnd hook payload on stdin, or takes --event-type/--tool/--summary flags. Best-effort: NEVER blocks, always exits 0. No active run = silent no-op.')
  .option('--event-type <type>', 'normalized event type: tool_call | tool_result | session_shutdown (default: inferred from the payload)')
  .option('--tool <name>', 'tool name for the event (e.g. Bash, Write, Edit)')
  .option('--summary <text>', 'result summary text (implies a tool_result event; truncated + secret-redacted)')
  .option('--is-error', 'mark a tool_result as an error')
  .option('--source <source>', 'harness label written on the event: claude-code | tau | operator | ... (default: RSTACK_OBSERVE_SOURCE env, else "unknown")')
  .option('-p, --project <path>', 'project root (defaults to RSTACK_PROJECT_ROOT env, else current directory)')
  .option('-r, --run-id <runId>', 'run to append to (defaults to RSTACK_RUN_ID env, else the latest run)')
  .option('--verbose', 'print a one-line result to stderr (silent by default)')
  .action(async (opts) => {
    try {
      const usesFlags = opts.tool !== undefined || opts.summary !== undefined || opts.eventType !== undefined;
      const stdinText = usesFlags ? '' : await readObserveStdin();
      process.exit(await runObserveCommand({
        eventType: opts.eventType,
        tool: opts.tool,
        summary: opts.summary,
        isError: opts.isError,
        source: opts.source,
        project: opts.project,
        runId: opts.runId,
        verbose: opts.verbose,
      }, { stdinText }));
    } catch (err) {
      // Rule (a)/(b): the observer must NEVER disrupt a session. Any failure
      // here — even before observation — exits 0 silently (opt-in verbose only).
      if (opts.verbose) process.stderr.write(`[rstack observe] internal error (ignored): ${err.message}\n`);
      process.exit(0);
    }
  });

program
  .command('context')
  .description('Framework-neutral context injector (#255): emit a small RStack situational packet (active run id + current stage, pending approvals + open decisions, an orchestrator pointer) so ANY harness agent is RStack-aware at prompt/session time. Reads a Claude Code UserPromptSubmit/SessionStart hook payload on stdin and prints {"hookSpecificOutput":{...,"additionalContext":"..."}} on stdout. Best-effort: NEVER blocks/denies, always exits 0, injects nothing (no output) when there is no active run, never injects secrets.')
  .option('--hook-event-name <name>', 'hookEventName to echo in the output shape (default: inferred from the payload, else UserPromptSubmit)')
  .option('--source <source>', 'harness label (informational only)')
  .option('-p, --project <path>', 'project root (defaults to RSTACK_PROJECT_ROOT env, else current directory)')
  .option('-r, --run-id <runId>', 'run to describe (defaults to RSTACK_RUN_ID env, else the latest run)')
  .option('--verbose', 'print a one-line result to stderr (silent by default)')
  .action(async (opts) => {
    try {
      const stdinText = await readContextStdin();
      process.exit(await runContextCommand({
        hookEventName: opts.hookEventName,
        source: opts.source,
        project: opts.project,
        runId: opts.runId,
        verbose: opts.verbose,
      }, { stdinText }));
    } catch (err) {
      // Rule (a)/(b): the injector must NEVER disrupt a session. Any failure —
      // even before injection — exits 0 silently (opt-in verbose only). We emit
      // no stdout so no partial/invalid additionalContext reaches the model.
      if (opts.verbose) process.stderr.write(`[rstack context] internal error (ignored): ${err.message}\n`);
      process.exit(0);
    }
  });

program
  .command('notify-hook')
  .description('Framework-neutral notification relay (#255): forward a host Notification hook payload to every configured RStack channel (Slack/Teams/Discord/Telegram/WhatsApp). Reads a Claude Code Notification hook payload on stdin, or takes --message/--title. Best-effort: NEVER blocks, always exits 0, no-ops when no channels are configured, secret-redacted.')
  .option('--message <text>', 'notification message (when passing flags instead of stdin JSON)')
  .option('--title <text>', 'notification title')
  .option('--source <source>', 'harness label included in the message (informational)')
  .option('-p, --project <path>', 'project root (defaults to RSTACK_PROJECT_ROOT env, else current directory)')
  .option('--verbose', 'print a one-line result to stderr (silent by default)')
  .action(async (opts) => {
    try {
      const usesFlags = opts.message !== undefined;
      const stdinText = usesFlags ? '' : await readNotifyStdin();
      process.exit(await runNotifyHookCommand({
        message: opts.message,
        title: opts.title,
        source: opts.source,
        project: opts.project,
        verbose: opts.verbose,
      }, { stdinText }));
    } catch (err) {
      // Rule (a)/(b): the relay must NEVER disrupt a session. Any failure exits 0.
      if (opts.verbose) process.stderr.write(`[rstack notify-hook] internal error (ignored): ${err.message}\n`);
      process.exit(0);
    }
  });

program
  .command('statusline')
  .description('Claude Code statusLine command (#257): render a compact, live RStack status line — active run + stage, ✔approved/⧗pending approvals, ◇open decisions. Reads the Claude Code session JSON on stdin (model, cwd) and prints ONE line on stdout. Display-only: NEVER blocks, ALWAYS exits 0, never prints secrets/free text; no active run → a minimal `⬡ rstack  <model>  <cwd-basename>` line. Wire via `init --framework claude-code` (statusLine settings key).')
  .option('--source <source>', 'harness label (informational only)')
  .option('-p, --project <path>', 'project root (defaults to RSTACK_PROJECT_ROOT env, else the session cwd / current directory)')
  .option('-r, --run-id <runId>', 'run to describe (defaults to RSTACK_RUN_ID env, else the latest run)')
  .option('--verbose', 'print a one-line result to stderr (silent by default)')
  .action(async (opts) => {
    try {
      const stdinText = await readStatuslineStdin();
      process.exit(await runStatuslineCommand({
        source: opts.source,
        project: opts.project,
        runId: opts.runId,
        verbose: opts.verbose,
      }, { stdinText }));
    } catch (err) {
      // Rule (a)/(c): the status line must NEVER disrupt a session. Even a failure
      // before rendering still prints a minimal, safe line and exits 0.
      process.stdout.write('⬡ rstack  Claude\n');
      if (opts.verbose) process.stderr.write(`[rstack statusline] internal error (ignored): ${err.message}\n`);
      process.exit(0);
    }
  });

const envCmd = program
  .command('env')
  .description('Environment intake helpers for stage 00 (#237)');

envCmd
  .command('scan')
  .description('Read-only project scan: toolchain/docs/tests/ci/deploy signals + a proposed run mode with evidence and env-var setup needs')
  .option('-p, --project <path>', 'project root (defaults to current directory)')
  .option('--json', 'print the structured scan report as JSON')
  .action(async (opts) => {
    try {
      const projectRoot = resolve(opts.project ?? process.cwd());
      const report = await envScan(projectRoot);
      if (opts.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      else console.log(formatEnvScan(report));
    } catch (err) {
      log.error(err.message);
      process.exit(1);
    }
  });

program
  .command('adopt')
  .description('Adopt an existing codebase: harvest evidence into a pipeline run so work resumes from reality, not from scratch')
  .option('-p, --project <path>', 'project root (defaults to current directory)')
  .option('-g, --goal <text>', 'adoption goal recorded on the run manifest')
  .option('-r, --run-id <runId>', 'run id for the adoption run (defaults to adopt-<timestamp>)')
  .option('--dry-run', 'print the stage-population plan without writing anything')
  .option('--json', 'print the structured adoption report as JSON')
  .action(async (opts) => {
    try {
      const projectRoot = resolve(opts.project ?? process.cwd());
      const report = await adoptProject(projectRoot, { goal: opts.goal, runId: opts.runId, dryRun: opts.dryRun === true });
      if (opts.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      else console.log(formatAdoptionReport(report));
    } catch (err) {
      log.error(err.message);
      process.exit(1);
    }
  });

program
  .command('init')
  .description('Set up RStack SDLC in the current project for a host framework')
  .option('-f, --framework <framework>', `host framework: ${FRAMEWORKS.join(' | ')} (auto-detected if omitted)`)
  .option('--profile <profile>', 'business workflow profile: business-flex | enterprise-webapp | lean-mvp', 'business-flex')
  .option('--fresh', 'archive existing .rstack state (runs, approvals, registry, config) to .rstack/archive/<timestamp>/ and start clean')
  .option('--gates <list>', 'OPT-IN quality-gate presets to wire into PreToolUse alongside guard (comma-separated: plan,tdd,scope — or plan-gate,tdd-gate,scope-guard). Off by default. tdd-gate BLOCKS production-code edits with no test.')
  .option('-p, --project <path>', 'project root (defaults to current directory)')
  .action(async (opts) => {
    try {
      const projectRoot = opts.project ?? process.cwd();
      const framework = opts.framework ?? await detectFramework(projectRoot);
      if (!opts.framework) {
        console.log(chalk.dim(`[rstack] No --framework given — detected: ${framework}`));
      }
      // Accept both short (plan,tdd,scope) and full (plan-gate,...) names.
      const gates = (opts.gates ?? '').split(',').map((g) => g.trim()).filter(Boolean)
        .map((g) => (g.endsWith('-gate') || g.endsWith('-guard') ? g : g === 'scope' ? 'scope-guard' : `${g}-gate`));
      const report = await initFramework(projectRoot, framework, { packageRoot: resolve(__dirname, '..'), profile: opts.profile, fresh: opts.fresh === true, gates });
      console.log(chalk.bold(`\n[rstack] init complete — framework: ${report.framework}`));
      console.log(chalk.dim(`[rstack] active profile: ${report.profile}`));
      for (const item of report.created) console.log(chalk.green(`  + ${item}`));
      for (const item of report.skipped) console.log(chalk.dim(`  = ${item}`));
      console.log(chalk.bold('\nNext steps:'));
      for (const step of report.nextSteps) console.log(`  ${step}`);
      console.log('');
    } catch (err) {
      log.error(err.message);
      process.exit(1);
    }
  });

program
  .command('hub')
  .description('Ensure the Business Hub is running on :3008 and open it — the universal session-start hook for any framework')
  .option('-p, --project <path>', 'project root to register (defaults to current directory)')
  .option('--no-browser', 'do not open the browser')
  .action(async (opts) => {
    try {
      const projectRoot = resolve(opts.project ?? process.cwd());
      await registerProject(projectRoot);
      await autoLaunchBusinessHub(projectRoot, { noBrowser: opts.browser === false });
    } catch (err) {
      log.error(err.message);
      process.exit(1);
    }
  });

program
  .command('notify')
  .description('Inspect configured notification channels; --test sends a test message to all of them')
  .option('-t, --test', 'send a test notification to every configured channel')
  .option('-p, --project <path>', 'project root (defaults to current directory)')
  .action(async (opts) => {
    try {
      const projectRoot = opts.project ?? process.cwd();
      const channels = resolveChannels({ projectRoot });
      const names = Object.keys(channels);
      if (names.length === 0) {
        console.log(chalk.yellow('[rstack] No notification channels configured.'));
        console.log('Configure via environment (RSTACK_SLACK_WEBHOOK, RSTACK_TEAMS_WEBHOOK, RSTACK_DISCORD_WEBHOOK,');
        console.log('RSTACK_TELEGRAM_BOT_TOKEN + RSTACK_TELEGRAM_CHAT_ID, RSTACK_WHATSAPP_TOKEN + RSTACK_WHATSAPP_PHONE_ID + RSTACK_WHATSAPP_TO)');
        console.log('or via .rstack/notifications.json — see docs/integrations/webhooks.md');
        process.exit(1);
      }
      console.log(chalk.bold(`[rstack] Configured channels: ${names.join(', ')}`));
      if (!opts.test) {
        console.log(chalk.dim('Run with --test to send a test message to every channel.'));
        return;
      }
      const payload = formatSlackStageMessage('notify-test', '00-environment', 'START', {
        message: 'RStack webhook test — if you can read this, the channel works.',
      });
      const results = await notifyAll(payload, { projectRoot });
      let failed = 0;
      for (const result of results) {
        if (result.ok) console.log(chalk.green(`  ✓ ${result.channel}`));
        else { failed++; console.log(chalk.red(`  ✗ ${result.channel} — ${result.detail}`)); }
      }
      process.exit(failed ? 1 : 0);
    } catch (err) {
      log.error(err.message);
      process.exit(1);
    }
  });

program
  .command('inventory')
  .description('Generate a backend control-plane registry report')
  .option('-p, --project <path>', 'project root (defaults to current directory)')
  .option('--json', 'print the complete inventory JSON')
  .option('--no-write', 'print inventory without writing .rstack/registry/backend-inventory.json')
  .action(async (opts) => {
    try {
      const projectRoot = resolve(opts.project ?? process.cwd());
      if (opts.write === false) {
        const inventory = await buildBackendInventory({ projectRoot, packageRoot: resolve(__dirname, '..') });
        if (opts.json) console.log(JSON.stringify(inventory, null, 2));
        else process.stdout.write(formatBackendInventory(inventory, { reportPath: null }));
        return;
      }

      const { inventory, reportPath } = await writeBackendInventory({ projectRoot, packageRoot: resolve(__dirname, '..') });
      if (opts.json) console.log(JSON.stringify(inventory, null, 2));
      else process.stdout.write(formatBackendInventory(inventory, { reportPath }));
    } catch (err) {
      log.error(err.message);
      process.exit(1);
    }
  });

program
  .command('doctor')
  .description('Verify RStack is set up and enforcement is LIVE on this machine: environment, .rstack config, framework wiring, a real guard self-test (destructive→block / safe→allow), and hub health. Every problem prints its fix. Exit 1 on any FAIL.')
  .option('-f, --framework <framework>', `host framework to check wiring for: ${DOCTOR_FRAMEWORKS.join(' | ')} (auto-detected if omitted)`)
  .option('-p, --project <path>', 'project root (defaults to current directory)')
  .option('--json', 'print the structured report as JSON for CI')
  .action(async (opts) => {
    try {
      if (opts.framework && !DOCTOR_FRAMEWORKS.includes(opts.framework)) {
        log.error(`Unknown framework "${opts.framework}". Expected one of: ${DOCTOR_FRAMEWORKS.join(', ')}`);
        process.exit(1);
      }
      const report = await runDoctor({ framework: opts.framework, project: opts.project });
      if (opts.json) {
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      } else {
        console.log(formatDoctorReport(report, { color: process.stdout.isTTY === true }));
      }
      process.exit(report.exitCode);
    } catch (err) {
      // Defensive: doctor should never crash, but if something truly unexpected
      // escapes, surface it as a failure rather than a stack trace.
      log.error(`doctor encountered an unexpected error: ${err.message}`);
      process.exit(1);
    }
  });

program
  .command('validate')
  .description('Validate packaged agent definitions')
  .action(async () => {
    try {
      const exitCode = await validateCommand();
      process.exit(exitCode);
    } catch (err) {
      log.error(err.message);
      process.exit(1);
    }
  });

program.on('command:*', (operands) => {
  console.error(chalk.red(`[rstack] Unknown command: ${operands.join(' ')}`));
  program.outputHelp();
  process.exit(1);
});

program.parseAsync(process.argv).catch((err) => {
  log.error(err.message);
  process.exit(1);
});
