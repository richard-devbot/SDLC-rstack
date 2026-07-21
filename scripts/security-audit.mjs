#!/usr/bin/env node
// owner: RStack developed by Richardson Gunde
//
// Security baseline gate. Wraps `npm audit` and fails on any high/critical
// advisory EXCEPT those whose every install path is inside a vendored, bundled
// dependency we cannot patch downstream. npm `overrides` cannot reach deps that
// a package ships bundled in its own tarball, so forcing patched versions there
// is impossible until the upstream package releases a fix.
//
// The gate stays strict for everything we actually control: an advisory is
// tolerated only when 100% of its affected install paths sit under one of the
// BUNDLED_ROOTS below. Anything reachable through our own dependency tree still
// fails the build. Tolerated advisories are printed so they stay visible.

import { execFileSync } from 'node:child_process';

// Packages whose own subtree we cannot patch downstream: pi-coding-agent ships
// an npm-shrinkwrap.json, which npm honors absolutely — root `overrides` are
// ignored inside it exactly like a bundled tarball (verified empirically: a
// fresh resolve with a matching override still installs the shrinkwrapped
// version). Fixes there must come from an upstream pi release.
const BUNDLED_ROOTS = [
  'node_modules/@earendil-works/pi-coding-agent/node_modules/',
];

// An advisory is tolerated ONLY when it is one of these named packages AND its
// every install path is bundled/shrinkwrapped (below). The name allowlist is
// deliberate: a brand-new high/critical in that subtree for any other package
// still fails the gate, forcing a conscious decision rather than silent
// acceptance.
// - brace-expansion (GHSA-3jxr-9vmj-r5cp, DoS): pinned 5.0.6 by pi's
//   shrinkwrap; every non-shrinkwrapped path in our tree is on the fixed line.
const TOLERATED_BUNDLED_ADVISORIES = new Set(['protobufjs', 'ws', 'brace-expansion']);

const BLOCKING = new Set(['high', 'critical']);

function runAudit() {
  try {
    const out = execFileSync('npm', ['audit', '--json'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    return JSON.parse(out);
  } catch (err) {
    // npm audit exits non-zero when vulnerabilities exist; the JSON is on stdout.
    if (err.stdout) {
      try { return JSON.parse(err.stdout); } catch { /* fall through */ }
    }
    console.error('security-audit: could not parse npm audit output');
    console.error(String(err.stderr || err.message));
    process.exit(2);
  }
}

function isFullyBundled(nodes) {
  if (!nodes || !nodes.length) return false;
  return nodes.every((path) => BUNDLED_ROOTS.some((root) => path.includes(root)));
}

const report = runAudit();
const vulns = report.vulnerabilities || {};
const blocking = [];
const tolerated = [];

for (const [name, info] of Object.entries(vulns)) {
  if (!BLOCKING.has(info.severity)) continue;
  if (TOLERATED_BUNDLED_ADVISORIES.has(name) && isFullyBundled(info.nodes)) {
    tolerated.push({ name, severity: info.severity });
  } else {
    blocking.push({ name, severity: info.severity, nodes: info.nodes });
  }
}

if (tolerated.length) {
  console.log('Tolerated advisories (vendored/bundled, unpatchable downstream — track upstream):');
  for (const t of tolerated) console.log(`  - ${t.name} (${t.severity})`);
}

if (blocking.length) {
  console.error('\nBlocking high/critical advisories in our dependency tree:');
  for (const b of blocking) {
    console.error(`  - ${b.name} (${b.severity})`);
    for (const n of b.nodes || []) console.error(`      ${n}`);
  }
  console.error('\nRun `npm audit` for details, then bump or override the offending package.');
  process.exit(1);
}

console.log(`\nSecurity baseline OK — ${tolerated.length} tolerated bundled advisory(ies), 0 blocking.`);
