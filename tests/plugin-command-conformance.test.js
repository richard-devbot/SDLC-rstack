/**
 * Claude Code plugin conformance (#388): the sdlc-rstack plugin's commands
 * must not silently drift from the real sdlc_* tool surface — mirrors the
 * adapter conformance pattern in bridge-conformance.test.js, applied to the
 * plugin's commands/*.md instead of a host adapter's tool table.
 *
 * owner: RStack developed by Richardson Gunde
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dirname, '..');
const GENERIC_BRIDGE = join(PACKAGE_ROOT, 'bin', 'rstack-bridge.ts');
const PLUGIN_ROOT = join(PACKAGE_ROOT, 'plugins', 'sdlc-rstack');
const COMMANDS_DIR = join(PLUGIN_ROOT, 'commands');

// Commands that intentionally do not map 1:1 to an sdlc_* tool — they drive
// the rstack-agents CLI instead (documented in the command body itself).
const CLI_ONLY_COMMANDS = new Set(['sdlc-resume']);

function runBridge(args) {
  return new Promise((resolveRun) => {
    const proc = spawn('npx', ['tsx', GENERIC_BRIDGE, ...args], {
      cwd: PACKAGE_ROOT,
      env: {
        ...process.env,
        RSTACK_PROJECT_ROOT: mkdtempSync(join(tmpdir(), 'rstack-plugin-conformance-')),
        RSTACK_NO_BUSINESS_HUB: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (c) => { stdout += c.toString(); });
    proc.stderr.on('data', (c) => { stderr += c.toString(); });
    proc.on('close', (code) => resolveRun({ code, stdout, stderr }));
  });
}

function commandFiles() {
  return readdirSync(COMMANDS_DIR).filter((f) => f.endsWith('.md')).sort();
}

function parseFrontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(match, 'command file has a --- frontmatter block');
  const fields = {};
  for (const line of match[1].split('\n')) {
    const kv = line.match(/^([a-zA-Z-]+):\s*(.*)$/);
    if (kv) fields[kv[1]] = kv[2].replace(/^"|"$/g, '');
  }
  return fields;
}

test('plugin command conformance: every sdlc_* tool has a matching command file', async () => {
  const listed = await runBridge(['--list']);
  assert.equal(listed.code, 0, `--list exited ${listed.code}: ${listed.stderr}`);
  const tools = JSON.parse(listed.stdout);
  assert.ok(tools.length >= 15, `registry has a real tool surface (got ${tools.length})`);

  const files = commandFiles();
  const commandNames = new Set(files.map((f) => f.replace(/\.md$/, '')));

  for (const tool of tools) {
    const expectedCommand = `sdlc-${tool.replace(/^sdlc_/, '').replace(/_/g, '-')}`;
    assert.ok(
      commandNames.has(expectedCommand),
      `tool ${tool} has no matching plugins/sdlc-rstack/commands/${expectedCommand}.md — plugin drifted from the tool registry (#388)`,
    );
  }
});

test('plugin command conformance: every non-CLI command names a real sdlc_* tool', async () => {
  const listed = await runBridge(['--list']);
  const tools = new Set(JSON.parse(listed.stdout));

  for (const file of commandFiles()) {
    const name = file.replace(/\.md$/, '');
    if (CLI_ONLY_COMMANDS.has(name)) continue;
    const toolName = `sdlc_${name.replace(/^sdlc-/, '').replace(/-/g, '_')}`;
    assert.ok(
      tools.has(toolName),
      `commands/${file} implies tool ${toolName}, which does not exist in the registry — rename or add to CLI_ONLY_COMMANDS`,
    );
  }
});

test('plugin command conformance: every command has description + argument-hint frontmatter', () => {
  for (const file of commandFiles()) {
    const fields = parseFrontmatter(readFileSync(join(COMMANDS_DIR, file), 'utf8'));
    assert.ok(fields.description, `commands/${file} has a description`);
    assert.ok('argument-hint' in fields, `commands/${file} has an argument-hint`);
  }
});

test('plugin manifest: plugin.json is valid and named sdlc-rstack', () => {
  const manifest = JSON.parse(readFileSync(join(PLUGIN_ROOT, 'plugin.json'), 'utf8'));
  assert.equal(manifest.name, 'sdlc-rstack');
  assert.ok(manifest.description);
});

test('plugin agents: bundled orchestrator/builder/validator match the core roster exactly', () => {
  for (const name of ['orchestrator', 'builder', 'validator']) {
    const core = readFileSync(join(PACKAGE_ROOT, 'agents', 'core', `${name}.md`), 'utf8');
    const bundled = readFileSync(join(PLUGIN_ROOT, 'agents', `${name}.md`), 'utf8');
    assert.equal(
      bundled,
      core,
      `plugins/sdlc-rstack/agents/${name}.md diverged from agents/core/${name}.md — the plugin should ship the same team, kept in sync by copy`,
    );
  }
});
