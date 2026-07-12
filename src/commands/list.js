/**
 * `rstack-agents list <agents|skills|plugins>` and `rstack-agents add plugin <name>`.
 *
 * Reads from package-local publishable assets by default.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdir, readFile, stat } from 'node:fs/promises';
import fsExtra from 'fs-extra';
import chalk from 'chalk';
import { log } from '../utils/logger.js';

const { pathExists, ensureDir, copy } = fsExtra;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(__dirname, '..', '..');
const PACKAGE_AGENTS_DIR = path.join(PACKAGE_ROOT, 'agents');
const PACKAGE_SKILLS_DIR = path.join(PACKAGE_ROOT, 'skills');
const PACKAGE_PLUGINS_DIR = path.join(PACKAGE_ROOT, 'plugins');

const DOMAIN_KEYWORDS = {
  core: ['orchestrator', 'builder', 'validator', 'planner', 'router', 'core'],
  sdlc: ['sdlc', 'environment', 'transcript', 'requirements', 'planning', 'jira', 'architecture', 'deployment', 'summary', 'feedback-loop'],
  backend: ['backend', 'api', 'server', 'database', 'sql', 'graphql', 'rest', 'microservice'],
  frontend: ['frontend', 'react', 'vue', 'angular', 'ui', 'css', 'design-system', 'tailwind'],
  devops: ['devops', 'kubernetes', 'docker', 'terraform', 'ci-cd', 'aws', 'azure', 'gcp', 'infra'],
  qa: ['qa', 'test', 'e2e', 'playwright', 'cypress', 'unit-test'],
  security: ['security', 'owasp', 'audit', 'pentest', 'compliance', 'threat'],
  data: ['data', 'analytics', 'etl', 'warehouse', 'pipeline', 'spark', 'hadoop'],
  product: ['product', 'pm', 'prd', 'roadmap', 'feature'],
  docs: ['docs', 'documentation', 'technical-writer', 'changelog'],
  crypto: ['crypto', 'blockchain', 'web3', 'solidity', 'ethereum']
};

function classifyAgent(filename) {
  const lower = filename.toLowerCase();
  // SDLC files start with two digits (00-, 01-, ...)
  if (/^\d{2}-/.test(lower)) return 'sdlc';
  for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) return domain;
    }
  }
  return 'other';
}

function parseFrontmatter(rawContent) {
  // Normalize CRLF/CR so the fence search works on Windows checkouts.
  const content = rawContent.replace(/\r\n?/g, '\n');
  if (!content.startsWith('---')) return {};
  const end = content.indexOf('\n---', 3);
  if (end === -1) return {};
  const block = content.slice(3, end);
  const out = {};
  for (const line of block.split('\n')) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (match) out[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

async function readAgentMeta(filePath) {
  try {
    const content = await readFile(filePath, 'utf8');
    const fm = parseFrontmatter(content);
    return {
      name: fm.name || path.basename(filePath, '.md'),
      description: fm.description || ''
    };
  } catch {
    return { name: path.basename(filePath, '.md'), description: '' };
  }
}

async function listFilesRecursive(dir, predicate) {
  if (!(await pathExists(dir))) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await listFilesRecursive(full, predicate));
    else if (predicate(full)) out.push(full);
  }
  return out;
}

function localRstackDir() {
  return path.join(process.cwd(), '.rstack');
}

export async function listAgents() {
  const mdFiles = await listFilesRecursive(PACKAGE_AGENTS_DIR, (file) => file.endsWith('.md'));
  if (mdFiles.length === 0) {
    log.warn('No package agents found.');
    return;
  }

  const grouped = {};
  for (const file of mdFiles) {
    const meta = await readAgentMeta(file);
    const domain = classifyAgent(path.relative(PACKAGE_AGENTS_DIR, file));
    if (!grouped[domain]) grouped[domain] = [];
    grouped[domain].push(meta);
  }

  const order = ['core', 'sdlc', 'backend', 'frontend', 'devops', 'qa', 'security', 'data', 'product', 'docs', 'crypto', 'other'];
  console.log(chalk.bold(`\nrstack agents (${mdFiles.length} total)\n`));
  for (const domain of order) {
    if (!grouped[domain] || grouped[domain].length === 0) continue;
    console.log(chalk.cyan.bold(`  ${domain} (${grouped[domain].length})`));
    grouped[domain].sort((a, b) => a.name.localeCompare(b.name));
    for (const agent of grouped[domain]) {
      const desc = agent.description ? chalk.gray(` — ${agent.description.slice(0, 80)}`) : '';
      console.log(`    ${chalk.green(agent.name)}${desc}`);
    }
    console.log('');
  }
}

export async function listSkills() {
  const skillsDir = PACKAGE_SKILLS_DIR;
  if (!(await pathExists(skillsDir))) {
    log.warn('No package skills found.');
    return;
  }
  const entries = await readdir(skillsDir);
  const skills = [];
  for (const entry of entries) {
    const full = path.join(skillsDir, entry);
    const st = await stat(full).catch(() => null);
    if (!st || !st.isDirectory()) continue;
    const skillFile = path.join(full, 'SKILL.md');
    if (await pathExists(skillFile)) {
      const meta = await readAgentMeta(skillFile);
      skills.push({ name: entry, description: meta.description });
    } else {
      skills.push({ name: entry, description: '' });
    }
  }
  skills.sort((a, b) => a.name.localeCompare(b.name));
  console.log(chalk.bold(`\nrstack skills (${skills.length} total)\n`));
  for (const s of skills) {
    const desc = s.description ? chalk.gray(` — ${s.description.slice(0, 100)}`) : '';
    console.log(`  ${chalk.green(s.name)}${desc}`);
  }
  console.log('');
}

async function readPluginMeta(pluginDir, name) {
  const candidates = ['plugin.json', 'package.json'];
  for (const c of candidates) {
    const fp = path.join(pluginDir, c);
    if (await pathExists(fp)) {
      try {
        const raw = await readFile(fp, 'utf8');
        const json = JSON.parse(raw);
        return {
          name: json.name || name,
          description: json.description || ''
        };
      } catch {
        // fall through
      }
    }
  }
  return { name, description: '' };
}

export async function listPlugins() {
  const pluginsDir = PACKAGE_PLUGINS_DIR;
  if (!(await pathExists(pluginsDir))) {
    log.warn('No package plugins found.');
    return;
  }
  const entries = await readdir(pluginsDir);
  const plugins = [];
  for (const entry of entries) {
    const full = path.join(pluginsDir, entry);
    const st = await stat(full).catch(() => null);
    if (!st || !st.isDirectory()) continue;
    plugins.push(await readPluginMeta(full, entry));
  }
  plugins.sort((a, b) => a.name.localeCompare(b.name));
  console.log(chalk.bold(`\nrstack plugins (${plugins.length} total)\n`));
  for (const p of plugins) {
    const desc = p.description ? chalk.gray(` — ${p.description.slice(0, 100)}`) : '';
    console.log(`  ${chalk.green(p.name)}${desc}`);
  }
  console.log('');
}

// #78: governance packs — profile-mapped posture bundles under <package>/packs/.
export async function listGovernancePacks() {
  const { listPacks, PROFILE_PACK_DEFAULTS } = await import('../core/packs.js');
  const packs = listPacks();
  if (!packs.length) {
    log.warn('No governance packs found in this package.');
    return;
  }
  console.log(chalk.bold(`\nrstack governance packs (${packs.length} total)\n`));
  for (const pack of packs) {
    const enforcement = pack.enforcement === 'blocking' ? chalk.red(pack.enforcement)
      : pack.enforcement === 'warning' ? chalk.yellow(pack.enforcement) : chalk.cyan(pack.enforcement ?? '?');
    const profiles = Object.entries(PROFILE_PACK_DEFAULTS)
      .filter(([, names]) => names.includes(pack.dir))
      .map(([profile]) => profile);
    console.log(`  ${chalk.green(pack.dir)} [${enforcement}]${profiles.length ? chalk.gray(` — default in ${profiles.join(', ')}`) : ''}`);
    if (pack.title) console.log(`      ${pack.title}`);
    for (const issue of pack.issues ?? []) {
      console.log(`      ${chalk.red('✗')} ${issue.field ? `${issue.field}: ` : ''}${issue.problem}`);
    }
  }
  console.log('');
}

export async function addPlugin(name) {
  if (!name || !/^[a-z0-9][a-z0-9._-]*$/i.test(name)) {
    throw new Error(`Invalid plugin name "${name}". Use letters, digits, dots, dashes, underscores.`);
  }
  const src = path.join(PACKAGE_PLUGINS_DIR, name);
  const dst = path.join(localRstackDir(), 'plugins', name);

  if (!(await pathExists(src))) {
    throw new Error(`Plugin "${name}" not found in package plugins/.`);
  }
  await ensureDir(path.dirname(dst));
  if (await pathExists(dst)) {
    log.warn(`Plugin "${name}" already exists locally. Overwriting.`);
  }
  await copy(src, dst, { overwrite: true });
  log.success(`Added plugin "${name}" to ${dst}.`);
}
