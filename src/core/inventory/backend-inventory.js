import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PACKAGE_ROOT = path.resolve(__dirname, '..', '..', '..');
const REPORT_RELATIVE_PATH = path.join('.rstack', 'registry', 'backend-inventory.json');

const DOMAIN_KEYWORDS = {
  architecture: ['architecture', 'architect', 'c4'],
  backend: ['backend', 'api', 'database', 'graphql', 'rest', 'server', 'sql'],
  cli: ['cli', 'command'],
  compliance: ['compliance', 'governance'],
  context: ['context', 'memory'],
  core: ['orchestrator', 'builder', 'validator', 'core'],
  data: ['data', 'analytics', 'etl', 'ml', 'ai'],
  deployment: ['deployment', 'deploy', 'devops', 'kubernetes', 'terraform', 'cloud'],
  frontend: ['frontend', 'react', 'ui', 'ux', 'css', 'design'],
  harness: ['sdlc', 'harness', 'pipeline', 'run', 'approval', 'trace', 'rollback'],
  product: ['product', 'prd', 'roadmap', 'planning'],
  qa: ['qa', 'test', 'testing', 'playwright', 'cypress'],
  security: ['security', 'threat', 'owasp', 'audit'],
};

function toPosix(value) {
  return value.split(path.sep).join('/');
}

function isMissingFileError(error) {
  return error && error.code === 'ENOENT';
}

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (isMissingFileError(error)) return false;
    throw error;
  }
}

async function readTextIfPresent(filePath) {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if (isMissingFileError(error)) return null;
    throw error;
  }
}

async function readJsonIfPresent(filePath) {
  const content = await readTextIfPresent(filePath);
  if (content === null) return {};
  try {
    return JSON.parse(content);
  } catch (error) {
    if (error instanceof SyntaxError) return {};
    throw error;
  }
}

async function readMarkdownMeta(filePath) {
  const content = await readTextIfPresent(filePath);
  if (content === null) {
    return {
      name: path.basename(filePath, path.extname(filePath)),
      description: '',
    };
  }

  const frontmatter = parseFrontmatter(content);
  return {
    name: frontmatter.name || path.basename(filePath, path.extname(filePath)),
    description: frontmatter.description || '',
  };
}

async function readJson(filePath) {
  return readJsonIfPresent(filePath);
}
async function listFilesRecursive(dir, predicate) {
  if (!(await exists(dir))) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFilesRecursive(full, predicate));
      continue;
    }
    if (predicate(full)) files.push(full);
  }
  return files;
}

function parseFrontmatter(rawContent) {
  const content = rawContent.replace(/\r\n?/g, '\n');
  if (!content.startsWith('---')) return {};
  const end = content.indexOf('\n---', 3);
  if (end === -1) return {};

  const fields = {};
  for (const line of content.slice(3, end).split('\n')) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (match) fields[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
  }
  return fields;
}

function classifyDomain(sourcePath, fallback = 'other') {
  const lower = sourcePath.toLowerCase();
  if (/agents\/sdlc\/\d{2}-/.test(lower)) return 'harness';
  for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
    if (keywords.some((keyword) => lower.includes(keyword))) return domain;
  }
  return fallback;
}

function relativeSource(root, filePath) {
  return toPosix(path.relative(root, filePath));
}

function makeItem({
  kind,
  name,
  sourcePath,
  runtimeAvailability,
  domain,
  commandName = null,
  description = '',
}) {
  const runtimeKey = runtimeAvailability.join('+');
  const idName = commandName || name;
  return {
    id: `${kind}:${runtimeKey}:${idName}:${sourcePath}`,
    kind,
    name,
    command_name: commandName,
    source_path: sourcePath,
    domain,
    runtime_availability: runtimeAvailability,
    description,
  };
}

async function collectAgentItems(items, { root, dir, runtimeAvailability, fallbackDomain }) {
  const files = await listFilesRecursive(dir, (file) => file.endsWith('.md'));
  for (const file of files) {
    const meta = await readMarkdownMeta(file);
    const sourcePath = relativeSource(root, file);
    items.push(makeItem({
      kind: 'agent',
      name: meta.name,
      sourcePath,
      runtimeAvailability,
      domain: classifyDomain(sourcePath, fallbackDomain),
      description: meta.description,
    }));
  }
}

async function collectSkillItems(items, { root, dir, runtimeAvailability, fallbackDomain }) {
  const files = await listFilesRecursive(dir, (file) => path.basename(file) === 'SKILL.md');
  for (const file of files) {
    const meta = await readMarkdownMeta(file);
    const sourcePath = relativeSource(root, file);
    const skillName = toPosix(path.relative(dir, path.dirname(file))) || meta.name;
    items.push(makeItem({
      kind: 'skill',
      name: meta.name || skillName,
      sourcePath,
      runtimeAvailability,
      domain: classifyDomain(sourcePath, fallbackDomain),
      description: meta.description,
    }));
  }
}

async function collectPluginItems(items, { root, dir, runtimeAvailability }) {
  const pluginsDir = dir;
  if (!(await exists(pluginsDir))) return;

  const entries = await readdir(pluginsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const pluginDir = path.join(pluginsDir, entry.name);
    const manifestPath = path.join(pluginDir, 'plugin.json');
    const manifest = await readJson(manifestPath);
    const sourcePath = relativeSource(root, manifestPath);
    const domain = classifyDomain(sourcePath, entry.name);

    if (await exists(manifestPath)) {
      items.push(makeItem({
        kind: 'plugin',
        name: manifest.name || entry.name,
        sourcePath,
        runtimeAvailability,
        domain,
        description: manifest.description || '',
      }));
    }

    await collectAgentItems(items, {
      root,
      dir: path.join(pluginDir, 'agents'),
      runtimeAvailability,
      fallbackDomain: domain,
    });

    const commandFiles = await listFilesRecursive(path.join(pluginDir, 'commands'), (file) => file.endsWith('.md'));
    for (const file of commandFiles) {
      const meta = await readMarkdownMeta(file);
      const commandName = `/${path.basename(file, '.md')}`;
      const commandSource = relativeSource(root, file);
      items.push(makeItem({
        kind: 'command',
        name: meta.name || path.basename(file, '.md'),
        commandName,
        sourcePath: commandSource,
        runtimeAvailability,
        domain: classifyDomain(commandSource, domain),
        description: meta.description,
      }));
    }
  }
}

async function collectPromptItems(items, { root, dir, runtimeAvailability, fallbackDomain }) {
  const files = await listFilesRecursive(dir, (file) => file.endsWith('.md'));
  for (const file of files) {
    const meta = await readMarkdownMeta(file);
    const sourcePath = relativeSource(root, file);
    items.push(makeItem({
      kind: 'prompt',
      name: meta.name || path.basename(file, '.md'),
      sourcePath,
      runtimeAvailability,
      domain: classifyDomain(sourcePath, fallbackDomain),
      description: meta.description,
    }));
  }
}

function regexMatches(content, regex) {
  return [...content.matchAll(regex)].map((match) => match[1]);
}

async function collectPiRuntimeItems(items, { packageRoot }) {
  const sourcePath = 'src/integrations/pi/rstack-sdlc.ts';
  const extensionPath = path.join(packageRoot, sourcePath);
  if (!(await exists(extensionPath))) return;
  const content = await readFile(extensionPath, 'utf8');

  for (const toolName of regexMatches(content, /pi\.registerTool\(\{\s*name:\s*["']([^"']+)["']/gs)) {
    items.push(makeItem({
      kind: 'tool',
      name: toolName,
      commandName: toolName,
      sourcePath,
      runtimeAvailability: ['pi'],
      domain: classifyDomain(toolName, 'harness'),
      description: 'Pi native tool registered by the SDLC extension.',
    }));
  }

  for (const hookName of regexMatches(content, /pi\.on\(["']([^"']+)["']/g)) {
    items.push(makeItem({
      kind: 'hook',
      name: hookName,
      commandName: hookName,
      sourcePath,
      runtimeAvailability: ['pi'],
      domain: classifyDomain(hookName, 'harness'),
      description: 'Pi lifecycle hook handled by the SDLC extension.',
    }));
  }

  for (const commandName of regexMatches(content, /pi\.registerCommand\(["']([^"']+)["']/g)) {
    items.push(makeItem({
      kind: 'command',
      name: commandName,
      commandName,
      sourcePath,
      runtimeAvailability: ['pi'],
      domain: classifyDomain(commandName, 'harness'),
      description: 'Pi command registered by the SDLC extension.',
    }));
  }
}

function normalizeCliCommand(rawCommand) {
  return rawCommand.split(/\s+/)[0].replace(/[<[].*$/, '');
}

async function collectCliCommandItems(items, { packageRoot }) {
  const sourcePath = 'bin/rstack-agents.js';
  const cliPath = path.join(packageRoot, sourcePath);
  if (!(await exists(cliPath))) return;
  const content = await readFile(cliPath, 'utf8');
  const commands = new Set(regexMatches(content, /\.command\(["']([^"']+)["']\)/g).map(normalizeCliCommand));

  const listSubcommands = ['agents', 'skills', 'plugins'];
  if (commands.has('list')) {
    for (const subcommand of listSubcommands) {
      commands.add(`list ${subcommand}`);
    }
  }

  for (const command of [...commands].sort()) {
    const commandName = `rstack-agents ${command}`;
    items.push(makeItem({
      kind: 'command',
      name: command,
      commandName,
      sourcePath,
      runtimeAvailability: ['cli'],
      domain: classifyDomain(commandName, 'cli'),
      description: 'Node CLI command exposed by rstack-agents.',
    }));
  }
}

function dedupeAndSort(items) {
  const byId = new Map();
  for (const item of items) byId.set(item.id, item);
  return [...byId.values()].sort((a, b) =>
    a.kind.localeCompare(b.kind) ||
    a.domain.localeCompare(b.domain) ||
    a.name.localeCompare(b.name) ||
    a.source_path.localeCompare(b.source_path)
  );
}

function countItems(items) {
  const counts = { total: items.length, by_kind: {}, by_runtime: {} };
  for (const item of items) {
    counts.by_kind[item.kind] = (counts.by_kind[item.kind] || 0) + 1;
    for (const runtime of item.runtime_availability) {
      counts.by_runtime[runtime] = (counts.by_runtime[runtime] || 0) + 1;
    }
  }
  return counts;
}

export async function buildBackendInventory({
  packageRoot = DEFAULT_PACKAGE_ROOT,
  projectRoot = process.cwd(),
  generatedAt = new Date().toISOString(),
} = {}) {
  const resolvedPackageRoot = path.resolve(packageRoot);
  const resolvedProjectRoot = path.resolve(projectRoot);
  const items = [];

  await collectAgentItems(items, {
    root: resolvedPackageRoot,
    dir: path.join(resolvedPackageRoot, 'agents'),
    runtimeAvailability: ['pi', 'claude-code', 'cli'],
    fallbackDomain: 'core',
  });
  await collectSkillItems(items, {
    root: resolvedPackageRoot,
    dir: path.join(resolvedPackageRoot, 'skills'),
    runtimeAvailability: ['pi', 'claude-code', 'cli'],
    fallbackDomain: 'core',
  });
  await collectPluginItems(items, {
    root: resolvedPackageRoot,
    dir: path.join(resolvedPackageRoot, 'plugins'),
    runtimeAvailability: ['cli', 'claude-code'],
  });
  await collectPromptItems(items, {
    root: resolvedPackageRoot,
    dir: path.join(resolvedPackageRoot, 'prompts'),
    runtimeAvailability: ['pi', 'claude-code', 'cli'],
    fallbackDomain: 'harness',
  });
  await collectPiRuntimeItems(items, { packageRoot: resolvedPackageRoot });
  await collectCliCommandItems(items, { packageRoot: resolvedPackageRoot });

  await collectAgentItems(items, {
    root: resolvedProjectRoot,
    dir: path.join(resolvedProjectRoot, '.rstack', 'agents'),
    runtimeAvailability: ['claude-code', 'cli'],
    fallbackDomain: 'project',
  });
  await collectSkillItems(items, {
    root: resolvedProjectRoot,
    dir: path.join(resolvedProjectRoot, '.rstack', 'skills'),
    runtimeAvailability: ['claude-code', 'cli'],
    fallbackDomain: 'project',
  });
  await collectPluginItems(items, {
    root: resolvedProjectRoot,
    dir: path.join(resolvedProjectRoot, '.rstack', 'plugins'),
    runtimeAvailability: ['claude-code', 'cli'],
  });
  await collectPromptItems(items, {
    root: resolvedProjectRoot,
    dir: path.join(resolvedProjectRoot, '.rstack', 'prompts'),
    runtimeAvailability: ['claude-code', 'cli'],
    fallbackDomain: 'project',
  });
  await collectAgentItems(items, {
    root: resolvedProjectRoot,
    dir: path.join(resolvedProjectRoot, '.pi', 'rstack', 'agents'),
    runtimeAvailability: ['pi'],
    fallbackDomain: 'project',
  });
  await collectSkillItems(items, {
    root: resolvedProjectRoot,
    dir: path.join(resolvedProjectRoot, '.pi', 'rstack', 'skills'),
    runtimeAvailability: ['pi'],
    fallbackDomain: 'project',
  });
  await collectPluginItems(items, {
    root: resolvedProjectRoot,
    dir: path.join(resolvedProjectRoot, '.pi', 'rstack', 'plugins'),
    runtimeAvailability: ['pi'],
  });
  await collectPromptItems(items, {
    root: resolvedProjectRoot,
    dir: path.join(resolvedProjectRoot, '.pi', 'rstack', 'prompts'),
    runtimeAvailability: ['pi'],
    fallbackDomain: 'project',
  });

  const sortedItems = dedupeAndSort(items);
  return {
    schema_version: 1,
    generated_at: generatedAt,
    package_root: resolvedPackageRoot,
    project_root: resolvedProjectRoot,
    report_path: path.join(resolvedProjectRoot, REPORT_RELATIVE_PATH),
    counts: countItems(sortedItems),
    items: sortedItems,
  };
}

export async function writeBackendInventory(options = {}) {
  const inventory = await buildBackendInventory(options);
  const reportPath = inventory.report_path;
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(inventory, null, 2)}\n`, 'utf8');
  return { inventory, reportPath };
}

export function formatBackendInventory(inventory, { reportPath = inventory.report_path } = {}) {
  const pluralLabels = [
    ['agent', 'agents'],
    ['skill', 'skills'],
    ['plugin', 'plugins'],
    ['prompt', 'prompts'],
    ['tool', 'tools'],
    ['hook', 'hooks'],
    ['command', 'commands'],
  ];
  const lines = [
    'rstack backend inventory',
    `report: ${reportPath || 'not written'}`,
    `total: ${inventory.counts.total}`,
    '',
  ];

  for (const [kind, label] of pluralLabels) {
    lines.push(`${label}: ${inventory.counts.by_kind[kind] || 0}`);
  }

  lines.push('', 'runtime availability:');
  for (const [runtime, count] of Object.entries(inventory.counts.by_runtime).sort()) {
    lines.push(`${runtime}: ${count}`);
  }

  return `${lines.join('\n')}\n`;
}
