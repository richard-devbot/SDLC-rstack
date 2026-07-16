#!/usr/bin/env node
// owner: RStack developed by Richardson Gunde
//
// Generates one consolidated plugin.json per domain folder under plugins/
// (plugins/<domain>/plugin.json) from its sub-plugins' own plugin.json
// files, so a domain installs as a single Claude Code plugin instead of
// N separate ones. Component paths (agents/commands/skills) are arrays
// pointing at each sub-plugin's own subdirectory — the sub-plugin folders
// and their content are untouched; only the per-sub-plugin plugin.json
// files become redundant (deleted separately, see README note below).
//
// Attribution is never collapsed: every original author is preserved,
// either as the domain's sole `author` (single-author domains) or as a
// `contributors` array (mixed-author domains) naming which sub-plugins are
// whose. License uses an SPDX "AND" expression when a domain mixes
// licenses. THIRD-PARTY-NOTICES.md remains the human-readable summary.
//
// Usage: node scripts/generate-domain-plugins.mjs
//
// After running, the 72 individual plugins/<domain>/<sub>/plugin.json
// files are redundant — the domain plugin.json is the installable unit now
// referenced by .claude-plugin/marketplace.json. Delete them, then
// regenerate the marketplace: node scripts/generate-marketplace.mjs

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PLUGINS_DIR = join(ROOT, 'plugins');

const DOMAINS = [
  'backend', 'frontend-mobile', 'devops-cloud', 'security', 'languages',
  'data-ml', 'quality-testing', 'docs-content', 'product-team', 'specialized',
];

function readSubPluginManifest(domain, sub) {
  return JSON.parse(readFileSync(join(PLUGINS_DIR, domain, sub, 'plugin.json'), 'utf8'));
}

function buildDomainManifest(domain) {
  const subDirs = readdirSync(join(PLUGINS_DIR, domain), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  const subManifests = subDirs.map((sub) => ({ sub, manifest: readSubPluginManifest(domain, sub) }));

  // Attribution: single author if every sub-plugin shares one; otherwise a
  // `contributors` array naming each author and which sub-plugins are theirs.
  const authorKey = (a) => `${a?.name ?? ''}|${a?.email ?? a?.url ?? ''}`;
  const byAuthor = new Map();
  for (const { sub, manifest } of subManifests) {
    const key = authorKey(manifest.author);
    if (!byAuthor.has(key)) byAuthor.set(key, { author: manifest.author, subs: [] });
    byAuthor.get(key).subs.push(sub);
  }

  const entry = {
    name: domain,
    description: `RStack ${domain} plugin pack — combines: ${subManifests.map(({ manifest }) => manifest.description).join(' | ')}`,
    owner: 'RStack developed by Richardson Gunde',
  };

  if (byAuthor.size === 1) {
    entry.author = subManifests[0].manifest.author;
  } else {
    entry.author = { name: 'Multiple contributors — see THIRD-PARTY-NOTICES.md' };
    entry.contributors = [...byAuthor.values()].map(({ author, subs }) => ({ ...author, plugins: subs }));
  }

  // License: single value if uniform; SPDX "AND" expression if mixed.
  const licenses = [...new Set(subManifests.map(({ manifest }) => manifest.license).filter(Boolean))].sort();
  entry.license = licenses.length <= 1 ? (licenses[0] ?? 'MIT') : licenses.join(' AND ');

  // Component paths: array of each sub-plugin's own subdirectory, only
  // when that sub-plugin actually has one (mirrors the pre-consolidation
  // per-plugin shape — nothing is invented or flattened).
  for (const kind of ['agents', 'commands', 'skills']) {
    const paths = subDirs.filter((sub) => existsSync(join(PLUGINS_DIR, domain, sub, kind)))
      .map((sub) => `${sub}/${kind}`);
    if (paths.length) entry[kind] = paths;
  }

  return entry;
}

function main() {
  for (const domain of DOMAINS) {
    const manifest = buildDomainManifest(domain);
    const outPath = join(PLUGINS_DIR, domain, 'plugin.json');
    writeFileSync(outPath, JSON.stringify(manifest, null, 2) + '\n');
    console.log(`Wrote ${outPath}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
