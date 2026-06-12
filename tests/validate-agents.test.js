/**
 * Tests for package-local agent definitions inside agents/.
 *
 * These tests inspect the publishable agents/ directory at the repo root.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdir, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..');
const AGENTS_DIR = path.join(REPO_ROOT, 'agents');

const NAME_REGEX = /^[a-z0-9][a-z0-9.-]*$/;

function parseFrontmatter(rawContent) {
  // Normalize CRLF/CR so the line-anchored regex matches on Windows checkouts.
  const content = rawContent.replace(/\r\n?/g, '\n');
  if (!content.startsWith('---')) return null;
  const end = content.indexOf('\n---', 3);
  if (end === -1) return null;
  const block = content.slice(3, end);
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

async function listAgentFiles(dir = AGENTS_DIR) {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...await listAgentFiles(full));
      continue;
    }
    if (!entry.name.endsWith('.md')) continue;
    const st = await stat(full).catch(() => null);
    if (!st || !st.isFile()) continue;
    out.push(full);
  }
  return out;
}

test('agents directory exists', async () => {
  assert.ok(existsSync(AGENTS_DIR), `${AGENTS_DIR} should exist`);
});

test('all agent .md files have valid frontmatter with name and description', async () => {
  const files = await listAgentFiles();
  assert.ok(files.length > 0, 'expected at least one agent file');

  const failures = [];
  for (const file of files) {
    const content = await readFile(file, 'utf8');
    const fm = parseFrontmatter(content);
    if (!fm) {
      failures.push(`${path.basename(file)}: missing or malformed frontmatter`);
      continue;
    }
    if (!fm.name || fm.name.trim() === '') {
      failures.push(`${path.basename(file)}: missing 'name'`);
    }
    if (!fm.description || fm.description.trim() === '') {
      failures.push(`${path.basename(file)}: missing 'description'`);
    }
  }

  assert.deepEqual(failures, [], `agent frontmatter failures:\n${failures.join('\n')}`);
});

test('all agent name values match /^[a-z0-9][a-z0-9.-]*$/', async () => {
  const files = await listAgentFiles();
  const failures = [];
  for (const file of files) {
    const content = await readFile(file, 'utf8');
    const fm = parseFrontmatter(content);
    if (!fm || !fm.name) continue;
    if (!NAME_REGEX.test(fm.name)) {
      failures.push(`${path.basename(file)}: invalid name "${fm.name}"`);
    }
  }
  assert.deepEqual(failures, [], `invalid agent names:\n${failures.join('\n')}`);
});

test('no duplicate agent names across files', async () => {
  const files = await listAgentFiles();
  const seen = new Map();
  const dups = [];
  for (const file of files) {
    const content = await readFile(file, 'utf8');
    const fm = parseFrontmatter(content);
    if (!fm || !fm.name) continue;
    if (seen.has(fm.name)) {
      dups.push(`name "${fm.name}" used by both ${seen.get(fm.name)} and ${path.basename(file)}`);
    } else {
      seen.set(fm.name, path.basename(file));
    }
  }
  assert.deepEqual(dups, [], `duplicate agent names:\n${dups.join('\n')}`);
});

test('all hook paths referenced in agent frontmatter exist on disk', async () => {
  const files = await listAgentFiles();
  const missing = [];
  for (const file of files) {
    const content = await readFile(file, 'utf8');
    const fm = parseFrontmatter(content);
    if (!fm) continue;
    const paths = extractHookPaths(fm);
    for (const p of paths) {
      const resolved = p.startsWith('/') ? p : path.join(REPO_ROOT, p.replace(/^\.?\//, ''));
      if (!existsSync(resolved)) {
        missing.push(`${path.basename(file)}: hook path missing -> ${p}`);
      }
    }
  }
  assert.deepEqual(missing, [], `missing hook paths:\n${missing.join('\n')}`);
});
