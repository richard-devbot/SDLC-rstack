#!/usr/bin/env node
// owner: RStack developed by Richardson Gunde
//
// Generates the pip-installable packaging/tau-adapter/ distribution from
// src/integrations/tau/rstack_sdlc.py — the single source of truth for the
// Tau adapter stays in src/integrations/tau/ (alongside the Pi/Operator
// adapters); this script copies it verbatim into the pip package's __init__.py
// so `tau install ./packaging/tau-adapter` (or a future PyPI publish) has
// something real to install, without duplicating the logic by hand (#389).
//
// Usage: node scripts/generate-tau-package.mjs

import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ROOT, 'src', 'integrations', 'tau', 'rstack_sdlc.py');
const PKG_DIR = join(ROOT, 'packaging', 'tau-adapter', 'src', 'rstack_tau_adapter');

function main() {
  mkdirSync(PKG_DIR, { recursive: true });
  copyFileSync(SRC, join(PKG_DIR, '__init__.py'));

  const manifest = {
    tau: {
      // Relative to the installed package directory itself (site-packages/
      // rstack_tau_adapter/) — see tau/packages/manager.py find_extension_files.
      extensions: ['__init__.py'],
    },
  };
  writeFileSync(join(PKG_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  console.log(`Copied ${SRC}\n  -> ${join(PKG_DIR, '__init__.py')}`);
  console.log(`Wrote ${join(PKG_DIR, 'manifest.json')}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
