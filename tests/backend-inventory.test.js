import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildBackendInventory, writeBackendInventory } from '../src/core/inventory/backend-inventory.js';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function tempProject() {
  return mkdtemp(path.join(os.tmpdir(), 'rstack-inventory-'));
}

function findItem(inventory, predicate) {
  return inventory.items.find(predicate);
}

test('buildBackendInventory discovers backend runtime surfaces', async () => {
  const projectRoot = await tempProject();
  const inventory = await buildBackendInventory({
    packageRoot: repoRoot,
    projectRoot,
    generatedAt: '2026-06-18T00:00:00.000Z',
  });

  assert.equal(inventory.schema_version, 1);
  assert.equal(inventory.generated_at, '2026-06-18T00:00:00.000Z');
  assert.ok(inventory.counts.total > 0);
  assert.ok(inventory.counts.by_kind.agent > 0);
  assert.ok(inventory.counts.by_kind.skill > 0);
  assert.ok(inventory.counts.by_kind.plugin > 0);
  assert.ok(inventory.counts.by_kind.command > 0);
  assert.ok(inventory.counts.by_kind.tool > 0);
  assert.ok(inventory.counts.by_kind.hook > 0);

  assert.ok(findItem(inventory, (item) =>
    item.kind === 'agent' &&
    item.name === '00-environment' &&
    item.source_path === 'agents/sdlc/00-environment.md' &&
    item.runtime_availability.includes('pi')
  ));

  assert.ok(findItem(inventory, (item) =>
    item.kind === 'tool' &&
    item.command_name === 'sdlc_start' &&
    item.runtime_availability.includes('pi')
  ));

  assert.ok(findItem(inventory, (item) =>
    item.kind === 'hook' &&
    item.command_name === 'tool_call' &&
    item.runtime_availability.includes('pi')
  ));

  assert.ok(findItem(inventory, (item) =>
    item.kind === 'command' &&
    item.command_name === 'rstack-agents inventory' &&
    item.runtime_availability.includes('cli')
  ));
});

test('writeBackendInventory writes the generated registry report', async () => {
  const projectRoot = await tempProject();
  const { inventory, reportPath } = await writeBackendInventory({
    packageRoot: repoRoot,
    projectRoot,
    generatedAt: '2026-06-18T00:00:00.000Z',
  });

  assert.equal(reportPath, path.join(projectRoot, '.rstack', 'registry', 'backend-inventory.json'));

  const written = JSON.parse(await readFile(reportPath, 'utf8'));
  assert.equal(written.generated_at, inventory.generated_at);
  assert.equal(written.items.length, inventory.items.length);
  assert.equal(written.counts.by_kind.tool, inventory.counts.by_kind.tool);
});

test('buildBackendInventory includes project-local .rstack and .pi runtime assets', async () => {
  const projectRoot = await tempProject();
  await mkdir(path.join(projectRoot, '.rstack', 'plugins', 'local-review', 'commands'), { recursive: true });
  await mkdir(path.join(projectRoot, '.pi', 'rstack', 'agents'), { recursive: true });
  await mkdir(path.join(projectRoot, '.pi', 'rstack', 'skills', 'pi-local-skill'), { recursive: true });
  await writeFile(path.join(projectRoot, '.rstack', 'plugins', 'local-review', 'plugin.json'), JSON.stringify({
    name: 'local-review',
    description: 'Local review workflow',
  }), 'utf8');
  await writeFile(path.join(projectRoot, '.rstack', 'plugins', 'local-review', 'commands', 'local-review.md'), '---\nname: local-review\n---\n', 'utf8');
  await writeFile(path.join(projectRoot, '.pi', 'rstack', 'agents', 'pi-agent.md'), '---\nname: pi-agent\n---\n', 'utf8');
  await writeFile(path.join(projectRoot, '.pi', 'rstack', 'skills', 'pi-local-skill', 'SKILL.md'), '---\nname: pi-local-skill\n---\n', 'utf8');

  const inventory = await buildBackendInventory({
    packageRoot: repoRoot,
    projectRoot,
    generatedAt: '2026-06-18T00:00:00.000Z',
  });

  assert.ok(findItem(inventory, (item) =>
    item.kind === 'plugin' &&
    item.name === 'local-review' &&
    item.source_path === '.rstack/plugins/local-review/plugin.json' &&
    item.runtime_availability.includes('cli')
  ));
  assert.ok(findItem(inventory, (item) =>
    item.kind === 'command' &&
    item.command_name === '/local-review' &&
    item.source_path === '.rstack/plugins/local-review/commands/local-review.md'
  ));
  assert.ok(findItem(inventory, (item) =>
    item.kind === 'agent' &&
    item.name === 'pi-agent' &&
    item.source_path === '.pi/rstack/agents/pi-agent.md' &&
    item.runtime_availability.includes('pi')
  ));
  assert.ok(findItem(inventory, (item) =>
    item.kind === 'skill' &&
    item.name === 'pi-local-skill' &&
    item.source_path === '.pi/rstack/skills/pi-local-skill/SKILL.md' &&
    item.runtime_availability.includes('pi')
  ));
});

test('rstack-agents inventory prints JSON and writes the registry report', async () => {
  const projectRoot = await tempProject();
  const binPath = path.join(repoRoot, 'bin', 'rstack-agents.js');
  const { stdout } = await execFileAsync(process.execPath, [
    binPath,
    'inventory',
    '--project',
    projectRoot,
    '--json',
  ], {
    cwd: repoRoot,
    env: { ...process.env, NO_COLOR: '1' },
  });

  const inventory = JSON.parse(stdout);
  assert.ok(findItem(inventory, (item) => item.command_name === 'rstack-agents inventory'));
  assert.ok(findItem(inventory, (item) => item.command_name === 'sdlc_validate'));

  const written = JSON.parse(await readFile(
    path.join(projectRoot, '.rstack', 'registry', 'backend-inventory.json'),
    'utf8',
  ));
  assert.equal(written.items.length, inventory.items.length);
});
