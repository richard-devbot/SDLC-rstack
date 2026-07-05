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
import { adoptProject, formatAdoptionReport } from '../src/commands/adopt.js';
import { buildBackendInventory, formatBackendInventory, writeBackendInventory } from '../src/core/inventory/backend-inventory.js';
import { validateCommand } from '../src/commands/validate.js';
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
  .option('-p, --project <path>', 'project root (defaults to current directory)')
  .action(async (opts) => {
    try {
      const projectRoot = opts.project ?? process.cwd();
      const framework = opts.framework ?? await detectFramework(projectRoot);
      if (!opts.framework) {
        console.log(chalk.dim(`[rstack] No --framework given — detected: ${framework}`));
      }
      const report = await initFramework(projectRoot, framework, { packageRoot: resolve(__dirname, '..'), profile: opts.profile, fresh: opts.fresh === true });
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
