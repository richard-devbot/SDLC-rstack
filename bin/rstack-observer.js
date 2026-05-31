#!/usr/bin/env node
/**
 * rstack-observer — RStack SDLC Live Observability Server
 *
 * Usage:
 *   rstack-observer [options]
 *   node bin/rstack-observer.js [options]
 *
 * Options:
 *   --port <n>        HTTP/WebSocket port (default: 3007)
 *   --project <path>  Project root directory (default: cwd)
 *   --run-id <id>     Pin to a specific run ID (default: latest)
 *   --no-browser      Don't open browser on start
 *   --help, -h        Show this help
 *   --version, -v     Print version
 */

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Parse CLI args before handing off to the server so --help works
// even when the server module can't find a project directory.
const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`
rstack-observer  v${getVersion()}

RStack SDLC Live Observability Server — watch any running pipeline in real-time.
Opens a browser dashboard with a Kanban board, event stream, and trace explorer.

USAGE
  rstack-observer [options]

OPTIONS
  --port <n>        HTTP / WebSocket port  (default: 3007)
  --project <path>  Project root directory (default: current directory)
  --run-id <id>     Pin to a specific run  (default: latest)
  --no-browser      Don't open browser on start
  --help, -h        Show this help
  --version, -v     Print version

EXAMPLES
  # Watch the latest run in the current project
  rstack-observer

  # Watch on a different port
  rstack-observer --port 4000

  # Watch a specific project from anywhere
  rstack-observer --project /path/to/my-project

  # Pin to a specific run ID
  rstack-observer --run-id run_20240527_abc123

BINARY DOWNLOAD
  Pre-built zero-install binaries (no Node.js required):
  • Windows:  rstack-observer-win.exe
  • macOS:    rstack-observer-macos
  • Linux:    rstack-observer-linux

  Double-click or run from terminal — opens in your default browser automatically.

MORE INFO
  https://github.com/richard-devbot/SDLC-rstack#observability
`);
  process.exit(0);
}

if (args.includes("--version") || args.includes("-v")) {
  console.log(getVersion());
  process.exit(0);
}

// Delegate to the actual server implementation
const serverPath = path.resolve(__dirname, "../src/observers/developer.js");

// Use dynamic import so the server sees process.argv intact
import(serverPath).catch((err) => {
  console.error(`[rstack-observer] Failed to start server: ${err.message}`);
  console.error(err);
  process.exit(1);
});

// ─── helpers ──────────────────────────────────────────────────────────────────

function getVersion() {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require("../package.json");
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}
