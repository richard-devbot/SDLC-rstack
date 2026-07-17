#!/usr/bin/env node
// owner: RStack developed by Richardson Gunde
//
// Generates .claude-plugin/marketplace.json from plugins/*/plugin.json so
// `/plugin marketplace add richard-devbot/SDLC-rstack` resolves every plugin
// under plugins/ (not just sdlc-rstack), and the manifest can never drift
// from what's actually on disk (#388). Run after adding/removing a plugin:
//
//   node scripts/generate-marketplace.mjs
//
// tests/marketplace-conformance.test.js fails CI if the committed manifest
// is stale relative to plugins/*/plugin.json.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// Plugins may sit directly under plugins/ (e.g. sdlc-rstack) or nested one
// level under a domain folder (e.g. plugins/backend/backend-development) —
// finding every plugin.json regardless of depth means the domain layout can
// change shape without this generator silently dropping or mis-pathing a
// plugin. Stops descending once a plugin.json is found (a plugin's own
// agents/skills/commands subdirectories are never scanned for nested ones).
function findManifests(dir) {
  const manifests = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  if (entries.some((e) => e.name === 'plugin.json')) {
    manifests.push(join(dir, 'plugin.json'));
    return manifests;
  }
  for (const entry of entries.filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    manifests.push(...findManifests(join(dir, entry.name)));
  }
  return manifests;
}

export function buildMarketplace(root = ROOT) {
  const pluginsDir = join(root, 'plugins');
  const manifestPaths = findManifests(pluginsDir);

  const plugins = manifestPaths.map((manifestPath) => {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const sourceRel = relative(root, dirname(manifestPath)).split(sep).join('/');
    const entry = {
      name: manifest.name,
      source: `./${sourceRel}`,
      description: manifest.description,
    };
    if (manifest.version) entry.version = manifest.version;
    if (manifest.author) entry.author = manifest.author;
    return entry;
  }).sort((a, b) => a.name.localeCompare(b.name));

  return {
    $schema: 'https://anthropic.com/claude-code/marketplace.schema.json',
    name: 'rstack-agents',
    description:
      'RStack plugin library — the governed sdlc-rstack pipeline plugin plus the full domain plugin catalog, installable via `/plugin marketplace add richard-devbot/SDLC-rstack`.',
    owner: { name: 'Richardson Gunde' },
    plugins,
  };
}

function main() {
  const marketplace = buildMarketplace();
  const outPath = join(ROOT, '.claude-plugin', 'marketplace.json');
  writeFileSync(outPath, JSON.stringify(marketplace, null, 2) + '\n');
  console.log(`Wrote ${marketplace.plugins.length} plugin entries to ${outPath}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
