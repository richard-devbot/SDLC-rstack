/**
 * Marketplace conformance (#388): .claude-plugin/marketplace.json is
 * generated (scripts/generate-marketplace.mjs) from each plugin.json under
 * plugins/, so "/plugin marketplace add richard-devbot/SDLC-rstack" can
 * never silently drift from what's actually on disk — adding or removing a
 * plugin without regenerating the manifest fails this test.
 *
 * owner: RStack developed by Richardson Gunde
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMarketplace } from '../scripts/generate-marketplace.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dirname, '..');
const MANIFEST_PATH = join(PACKAGE_ROOT, '.claude-plugin', 'marketplace.json');

test('marketplace.json matches a fresh generation from plugins/*/plugin.json', () => {
  const committed = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  const fresh = buildMarketplace(PACKAGE_ROOT);
  assert.deepEqual(
    committed,
    fresh,
    'marketplace.json is stale — run `node scripts/generate-marketplace.mjs` after adding/removing a plugin',
  );
});

test('marketplace.json includes the flagship sdlc-rstack plugin', () => {
  const committed = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  const entry = committed.plugins.find((p) => p.name === 'sdlc-rstack');
  assert.ok(entry, 'sdlc-rstack is listed in the marketplace');
  assert.equal(entry.source, './plugins/sdlc-rstack');
});

test('marketplace.json lists 10 consolidated domain plugins + sdlc-rstack (domain-manifest consolidation)', () => {
  const committed = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  assert.equal(committed.plugins.length, 11, '10 domain plugins + sdlc-rstack — one manifest per domain, not one per sub-plugin');
  const domainNames = ['backend', 'frontend-mobile', 'devops-cloud', 'security', 'languages', 'data-ml', 'quality-testing', 'docs-content', 'product-team', 'specialized'];
  for (const name of domainNames) {
    const entry = committed.plugins.find((p) => p.name === name);
    assert.ok(entry, `domain plugin "${name}" is listed`);
    assert.equal(entry.source, `./plugins/${name}`);
  }
  // Single-author domain keeps its real author untouched — never relabeled.
  const backend = committed.plugins.find((p) => p.name === 'backend');
  assert.equal(backend.author?.name, 'Seth Hobson');
});

test('marketplace.json required top-level fields are present', () => {
  const committed = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  assert.ok(committed.name, 'marketplace has a name');
  assert.ok(committed.owner?.name, 'marketplace has an owner.name');
  assert.ok(Array.isArray(committed.plugins) && committed.plugins.length > 0, 'marketplace lists plugins');
});
