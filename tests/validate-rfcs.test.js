/**
 * Validate RStack RFC / ADR registry structure.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..');
const RFCS_DIR = path.join(REPO_ROOT, 'rfcs');
const VALID_STATUSES = new Set(['Draft', 'Accepted', 'Implemented', 'Superseded']);
const REQUIRED_SECTIONS = [
  '## Status',
  '## Context',
  '## Decision',
  '## Alternatives considered',
  '## Research references',
  '## Implementation plan',
  '## Validation',
];

async function rfcFiles() {
  const entries = await readdir(RFCS_DIR, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && /^RFC-\d{4}-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

function statusFrom(text) {
  const match = text.match(/^## Status\s*\n+([^\n]+)/m);
  return match?.[1]?.trim();
}

test('RFC registry files and template exist', () => {
  assert.ok(existsSync(path.join(RFCS_DIR, 'README.md')), 'rfcs/README.md should exist');
  assert.ok(existsSync(path.join(RFCS_DIR, 'TEMPLATE.md')), 'rfcs/TEMPLATE.md should exist');
});

test('RFC files use valid names, headers, statuses, and required sections', async () => {
  const files = await rfcFiles();
  assert.ok(files.length >= 6, 'expected initial roadmap RFC stubs');

  const seenNumbers = [];
  for (const file of files) {
    const number = Number(file.match(/^RFC-(\d{4})-/)[1]);
    seenNumbers.push(number);
    const text = await readFile(path.join(RFCS_DIR, file), 'utf8');

    assert.match(text, new RegExp(`^# RFC-${String(number).padStart(4, '0')}: .+`, 'm'), `${file} header should match filename number`);
    const status = statusFrom(text);
    assert.ok(VALID_STATUSES.has(status), `${file} has invalid status: ${status}`);
    for (const section of REQUIRED_SECTIONS) {
      assert.ok(text.includes(section), `${file} missing ${section}`);
    }
    assert.ok(text.includes('RStack developed by Richardson Gunde'), `${file} should carry owner label`);
  }

  assert.deepEqual(seenNumbers, [...new Set(seenNumbers)], 'RFC numbers should be unique');
  assert.deepEqual(seenNumbers, seenNumbers.map((_, index) => index + 1), 'RFC numbers should be sequential from 0001');
});

test('RFC README indexes every RFC file', async () => {
  const readme = await readFile(path.join(RFCS_DIR, 'README.md'), 'utf8');
  for (const file of await rfcFiles()) {
    assert.ok(readme.includes(file), `README should link ${file}`);
  }
});
