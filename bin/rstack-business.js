#!/usr/bin/env node
/**
 * rstack-business — RStack Business Observability Hub
 *
 * Usage:
 *   rstack-business [options]
 *
 * Options:
 *   --port <n>        HTTP/WebSocket port (default: 3008)
 *   --project <path>  Project root directory (default: cwd)
 *   --no-browser      Don't open browser on start
 *   --help, -h        Show this help
 *   --version, -v     Print version
 */

import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
rstack-business  v${getVersion()}

RStack Business Observability Hub — live tracking dashboard for teams.
Multi-run aggregation, human-in-loop approval queue, alert thresholds,
traceability explorer, and framework health — all in one view.

USAGE
  rstack-business [options]

OPTIONS
  --port <n>        HTTP / WebSocket port  (default: 3008)
  --project <path>  Project root directory (default: current directory)
  --no-browser      Don't open browser on start
  --help, -h        Show this help
  --version, -v     Print version

EXAMPLES
  # Start business hub for current project
  rstack-business

  # Watch on a different port
  rstack-business --port 4000

  # Watch a specific project without opening browser
  rstack-business --project /path/to/project --no-browser

AUTO-LAUNCH
  The business hub auto-launches when any RStack framework (Pi, Operator,
  Claude Code) starts a session. Set RSTACK_NO_BUSINESS_HUB=1 to disable.

MORE INFO
  https://github.com/richard-devbot/SDLC-rstack#observability
`);
  process.exit(0);
}

if (args.includes('--version') || args.includes('-v')) {
  console.log(getVersion());
  process.exit(0);
}

const serverPath = path.resolve(__dirname, '../src/observability/dashboard/server.js');
import(pathToFileURL(serverPath).href).catch((err) => {
  console.error(`[rstack-business] Failed to start: ${err.message}`);
  console.error(err);
  process.exit(1);
});

function getVersion() {
  try {
    const require = createRequire(import.meta.url);
    return require('../package.json').version ?? 'unknown';
  } catch { return 'unknown'; }
}
