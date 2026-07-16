#!/usr/bin/env node
/**
 * Compatibility wrapper.
 *
 * rstack-observer now opens the unified RStack Business Hub instead of the
 * retired run observer dashboard. Keep the command so older docs,
 * scripts, and muscle memory land on the single supported dashboard.
 */

import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.resolve(__dirname, './rstack-business.js');

const deprecatedFlags = new Set(['--run-id', '--port']);
for (let i = 0; i < process.argv.length; i++) {
  if (deprecatedFlags.has(process.argv[i])) {
    process.argv.splice(i, 2);
    i--;
  }
}

process.stderr.write('[rstack] rstack-observer now opens the unified Business Hub. Use rstack-business for new scripts.\n');

import(pathToFileURL(serverPath).href).catch((err) => {
  console.error(`[rstack-observer] Failed to start unified dashboard: ${err.message}`);
  console.error(err);
  process.exit(1);
});
