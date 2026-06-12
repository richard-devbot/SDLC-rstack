/**
 * `rstack-agents validate` — sanity-check package-local agents/.
 *
 * Checks per-agent:
 *   - Frontmatter exists
 *   - `name` field present and matches /^[a-z][a-z0-9-]*$/
 *   - `description` field present and non-empty
 *   - Hook paths referenced in frontmatter exist on disk
 *   - No duplicate `name` values across the agent set
 */

import path from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import fsExtra from 'fs-extra';
import chalk from 'chalk';
import { log } from '../utils/logger.js';

const { pathExists } = fsExtra;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(__dirname, '..', '..');
const AGENTS_DIR = path.join(PACKAGE_ROOT, 'agents');

const NAME_REGEX = /^[a-z0-9][a-z0-9.-]*$/;

function parseFrontmatter(content) {
  // Normalize CRLF/CR so the line-anchored regex below matches on Windows checkouts.
  const normalized = content.replace(/\r\n?/g, '\n');
  if (!normalized.startsWith('---')) return null;
  const end = normalized.indexOf('\n---', 3);
  if (end === -1) return null;
  const block = normalized.slice(3, end);
  const out = {};
  for (const line of block.split('\n')) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (match) {
      const key = match[1];
      let value = match[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      out[key] = value;
    }
  }
  return out;
}

function extractHookPaths(frontmatter) {
  const paths = [];
  for (const [key, value] of Object.entries(frontmatter)) {
    if (typeof value !== 'string') continue;
    if (!key.toLowerCase().includes('hook') && !key.toLowerCase().includes('script')) continue;
    const matches = value.match(/[\w./-]+\.(py|sh|js|ts)/g);
    if (matches) paths.push(...matches);
  }
  return paths;
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

export async function validateCommand() {
  const agentsDir = AGENTS_DIR;

  if (!(await pathExists(agentsDir))) {
    log.error(`agents/ not found in package root ${PACKAGE_ROOT}.`);
    return 1;
  }

  const mdFiles = await listFilesRecursive(agentsDir, (file) => file.endsWith('.md'));

  if (mdFiles.length === 0) {
    log.warn('No agent .md files found.');
    return 0;
  }

  const seenNames = new Map();
  const results = [];
  let failures = 0;

  for (const fp of mdFiles) {
    const file = path.relative(agentsDir, fp);
    const content = await readFile(fp, 'utf8');
    const fm = parseFrontmatter(content);
    const issues = [];

    if (!fm) {
      issues.push('missing or malformed YAML frontmatter');
    } else {
      if (!fm.name) {
        issues.push('missing required field: name');
      } else if (!NAME_REGEX.test(fm.name)) {
        issues.push(`name "${fm.name}" does not match /^[a-z][a-z0-9-]*$/`);
      } else {
        if (seenNames.has(fm.name)) {
          issues.push(`duplicate name "${fm.name}" (also in ${seenNames.get(fm.name)})`);
        } else {
          seenNames.set(fm.name, file);
        }
      }

      if (!fm.description || fm.description.trim() === '') {
        issues.push('missing required field: description');
      }

      const hookPaths = extractHookPaths(fm);
      for (const hp of hookPaths) {
        const resolved = hp.startsWith('/') ? hp : path.join(PACKAGE_ROOT, hp.replace(/^\.?\//, ''));
        if (!(await pathExists(resolved))) {
          issues.push(`hook path not found on disk: ${hp}`);
        }
      }
    }

    if (issues.length === 0) {
      results.push({ file, status: 'PASS', issues });
    } else {
      results.push({ file, status: 'FAIL', issues });
      failures++;
    }
  }

  console.log(chalk.bold(`\nValidating ${mdFiles.length} agents in ${agentsDir}\n`));
  for (const r of results) {
    if (r.status === 'PASS') {
      console.log(`  ${chalk.green('PASS')}  ${r.file}`);
    } else {
      console.log(`  ${chalk.red('FAIL')}  ${r.file}`);
      for (const issue of r.issues) {
        console.log(`        ${chalk.gray('-')} ${issue}`);
      }
    }
  }

  console.log('');
  if (failures > 0) {
    log.error(`${failures} of ${mdFiles.length} agents failed validation.`);
    return 1;
  }
  log.success(`All ${mdFiles.length} agents passed validation.`);
  return 0;
}
