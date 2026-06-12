/**
 * Validate package Markdown frontmatter for Pi-compatible resource loading.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..');
const MARKDOWN_ROOTS = ['agents', 'skills', 'prompts', 'plugins', 'docs/public'];
const SKILL_NAME_REGEX = /^[a-z0-9-]+$/;

async function walk(dir, predicate = () => true) {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['.git', 'node_modules'].includes(entry.name)) continue;
      out.push(...await walk(full, predicate));
    } else if (predicate(full)) out.push(full);
  }
  return out;
}

function frontmatterBlock(rawText) {
  // Normalize CRLF/CR so frontmatter parsing is consistent across OS checkouts.
  const text = rawText.replace(/\r\n?/g, '\n');
  if (!text.startsWith('---\n')) return null;
  const end = text.indexOf('\n---', 4);
  assert.notEqual(end, -1, 'frontmatter should have a closing fence');
  return text.slice(4, end);
}

function unquote(value) {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function topLevelFields(block) {
  const fields = new Map();
  for (const line of block.split('\n')) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (match) fields.set(match[1], match[2]);
  }
  return fields;
}

function isQuotedOrBlockScalar(value) {
  const trimmed = value.trim();
  return trimmed === '' || trimmed === '|' || trimmed === '>-' || trimmed === '>' || trimmed.startsWith('"') || trimmed.startsWith("'");
}

test('all packaged markdown frontmatter uses Pi-safe YAML scalars', async () => {
  const markdown = [];
  for (const root of MARKDOWN_ROOTS) {
    markdown.push(...await walk(path.join(REPO_ROOT, root), (file) => file.endsWith('.md')));
  }
  assert.ok(markdown.length > 1000, `expected to scan all packaged markdown files, got ${markdown.length}`);

  const issues = [];
  for (const file of markdown) {
    const rel = path.relative(REPO_ROOT, file);
    const block = frontmatterBlock(await readFile(file, 'utf8'));
    if (!block) continue;
    for (const [key, rawValue] of topLevelFields(block)) {
      const value = rawValue.trim();
      if (key === 'argument-hint' && /[[\]|]/.test(value) && !isQuotedOrBlockScalar(value)) {
        issues.push(`${rel}: quote argument-hint value ${value}`);
      }
      if (!isQuotedOrBlockScalar(value) && /:\s/.test(value)) {
        issues.push(`${rel}: quote or block-scalar ${key} because value contains colon-space`);
      }
    }
  }

  assert.deepEqual(issues, []);
});

test('all packaged SKILL.md files have valid unique Pi skill names', async () => {
  const skillFiles = [];
  for (const root of ['skills', 'plugins']) {
    skillFiles.push(...await walk(path.join(REPO_ROOT, root), (file) => path.basename(file) === 'SKILL.md'));
  }
  assert.ok(skillFiles.length >= 156, `expected packaged skills to be scanned, got ${skillFiles.length}`);

  const seen = new Map();
  const issues = [];
  for (const file of skillFiles) {
    const rel = path.relative(REPO_ROOT, file);
    const block = frontmatterBlock(await readFile(file, 'utf8'));
    if (!block) {
      issues.push(`${rel}: missing frontmatter`);
      continue;
    }
    const fields = topLevelFields(block);
    const name = fields.has('name') ? unquote(fields.get('name')) : '';
    if (!SKILL_NAME_REGEX.test(name)) {
      issues.push(`${rel}: invalid skill name ${name || '<missing>'}`);
      continue;
    }
    if (seen.has(name)) issues.push(`${rel}: duplicate skill name ${name}, first seen in ${seen.get(name)}`);
    else seen.set(name, rel);
  }

  assert.deepEqual(issues, []);
});
