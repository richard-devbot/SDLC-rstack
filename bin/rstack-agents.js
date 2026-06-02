#!/usr/bin/env node
/**
 * rstack-agents CLI entry point.
 *
 * Commands:
 *   rstack-agents init [--framework pi|claude-code|operator|custom]
 *   rstack-agents list <agents|skills|plugins>
 *   rstack-agents add plugin <name>
 *   rstack-agents validate
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { listAgents, listSkills, listPlugins, addPlugin } from '../src/commands/list.js';
import { validateCommand } from '../src/commands/validate.js';
import { initFramework, detectFramework, FRAMEWORKS } from '../src/integrations/init.js';
import { notifyAll, resolveChannels, formatSlackStageMessage } from '../src/notifications/index.js';
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
  .command('init')
  .description('Set up RStack SDLC in the current project for a host framework')
  .option('-f, --framework <framework>', `host framework: ${FRAMEWORKS.join(' | ')} (auto-detected if omitted)`)
  .option('-p, --project <path>', 'project root (defaults to current directory)')
  .action(async (opts) => {
    try {
      const projectRoot = opts.project ?? process.cwd();
      const framework = opts.framework ?? await detectFramework(projectRoot);
      if (!opts.framework) {
        console.log(chalk.dim(`[rstack] No --framework given — detected: ${framework}`));
      }
      const report = await initFramework(projectRoot, framework, { packageRoot: resolve(__dirname, '..') });
      console.log(chalk.bold(`\n[rstack] init complete — framework: ${report.framework}`));
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
