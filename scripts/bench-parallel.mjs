#!/usr/bin/env node
// owner: RStack developed by Richardson Gunde
//
// Parallel-execution benchmark runner (#159).
//
// Runs the SAME set of data-independent stages two ways and records
// SEQ_TIME / PAR_TIME and the delta, then applies the >= target-improvement
// gate (default 40%) to decide whether parallel groups should be enabled.
// The result is written as a run artifact the Business Hub indexes.
//
// HONESTY NOTE — what this measures:
//   By default this runs in MOCK mode: it does NOT launch real builder/
//   validator agents. It executes a synthetic sleep workload per stage
//   (durations modelling that builder/validator round-trips dominate wall
//   clock) and times it with the real clock. Sequential runs the stages one
//   after another; parallel runs each declared group concurrently. The
//   speed-up is therefore a MODEL of what real parallelism would yield given
//   the supplied per-stage durations — clearly stamped mode:"mock" in the
//   artifact and printed below. Live-agent timing (mode:"real") is future
//   work; feed real durations in via --timings to compute the gate against
//   measured numbers without changing this script.
//
// Usage:
//   node scripts/bench-parallel.mjs [--target 0.4] [--out <path>] \
//        [--run-id <id>] [--project-root <dir>] [--timings '{"12-...":1200}']
//
// The default data-independent group is stages 12/13/14 (security threat
// model, compliance checker, cost estimation): each reads upstream artifacts
// (requirements, architecture, code) and writes its own distinct output, so
// none reads another's artifact — verified by checkDataIndependence.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import {
  DEFAULT_PARALLEL_TARGET,
  aggregateSequentialTime,
  aggregateParallelTime,
  evaluateParallelGate,
  buildBenchmarkArtifact,
  checkDataIndependence,
} from '../src/core/harness/parallel-benchmark.js';

// Default benchmark plan: one data-independent group + the surrounding
// sequential spine is out of scope; we benchmark the group in isolation
// against running its members one after another.
const DEFAULT_GROUP = ['12-security-threat-model', '13-compliance-checker', '14-cost-estimation'];

// Modelled per-stage durations (ms) for MOCK mode. These stand in for real
// builder/validator round-trip wall clock; override any of them with --timings.
const DEFAULT_TIMINGS = {
  '12-security-threat-model': 900,
  '13-compliance-checker': 750,
  '14-cost-estimation': 600,
};

function parseArgs(argv) {
  const args = { target: DEFAULT_PARALLEL_TARGET, out: null, runId: null, projectRoot: process.cwd(), timings: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--target') args.target = Number(argv[++i]);
    else if (arg === '--out') args.out = argv[++i];
    else if (arg === '--run-id') args.runId = argv[++i];
    else if (arg === '--project-root') args.projectRoot = argv[++i];
    else if (arg === '--timings') args.timings = JSON.parse(argv[++i]);
  }
  return args;
}

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

// One "stage" of mock work: a real sleep of the modelled duration. Using the
// real clock keeps SEQ_TIME/PAR_TIME honest measurements of THIS process, even
// though the workload itself is synthetic.
async function runStageMock(id, timings) {
  await sleep(timings[id]);
  return id;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const timings = { ...DEFAULT_TIMINGS, ...(args.timings || {}) };
  const group = DEFAULT_GROUP;

  // Refuse to benchmark a group that is not actually data-independent —
  // reporting a speed-up for an unsafe group would be a lie.
  const { ok, issues } = checkDataIndependence(group.map((id) => ({ id })));
  if (!ok) {
    console.error('bench-parallel: default group is not data-independent:');
    for (const issue of issues) console.error(`  - ${issue}`);
    process.exit(2);
  }

  // SEQUENTIAL: run every stage one after another, timed with the real clock.
  const seqStart = performance.now();
  for (const id of group) await runStageMock(id, timings);
  const seqMeasuredMs = performance.now() - seqStart;

  // PARALLEL: run the whole group concurrently, timed with the real clock.
  const parStart = performance.now();
  await Promise.all(group.map((id) => runStageMock(id, timings)));
  const parMeasuredMs = performance.now() - parStart;

  // Deterministic model of the same run from the injected per-stage durations
  // (sum vs slowest-in-group). We report BOTH the measured wall clock and the
  // modelled numbers, and gate on the model so CI is not flaky on scheduler
  // jitter. The measured numbers are the honesty check that the model holds.
  const seqModelMs = aggregateSequentialTime(timings, group);
  const parModelMs = aggregateParallelTime(timings, [group], []);
  const gate = evaluateParallelGate({ seqTimeMs: seqModelMs, parTimeMs: parModelMs, target: args.target });

  const artifact = buildBenchmarkArtifact({
    runId: args.runId,
    mode: 'mock',
    stageOrder: group,
    groups: [group],
    soloStages: [],
    timings,
    seqTimeMs: seqModelMs,
    parTimeMs: parModelMs,
    gate,
    samples: 1,
    notes: [
      `measured wall clock (this process): SEQ ${seqMeasuredMs.toFixed(0)}ms / PAR ${parMeasuredMs.toFixed(0)}ms`,
      'gate computed against the modelled durations (sum vs slowest-in-group) to stay deterministic in CI',
      'mock mode: synthetic sleep workload, not live builder/validator agents',
    ],
  });

  const outPath = args.out
    ? resolve(args.out)
    : join(resolve(args.projectRoot), '.rstack', 'runs', args.runId || 'bench', 'artifacts', 'parallel-benchmark.json');
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');

  console.log('RStack parallel-execution benchmark (#159)');
  console.log(`  mode:        mock (synthetic sleep workload — NOT live agents)`);
  console.log(`  group:       ${group.join(', ')}`);
  console.log(`  SEQ_TIME:    ${seqModelMs}ms (modelled)  | measured ${seqMeasuredMs.toFixed(0)}ms`);
  console.log(`  PAR_TIME:    ${parModelMs}ms (modelled)  | measured ${parMeasuredMs.toFixed(0)}ms`);
  console.log(`  delta:       ${gate.deltaMs}ms (${artifact.improvement_pct}% faster)`);
  console.log(`  target:      >= ${(args.target * 100).toFixed(0)}%`);
  console.log(`  decision:    ${gate.enable ? 'ENABLE' : 'KEEP DISABLED'} — ${gate.reason}`);
  console.log(`  artifact:    ${outPath}`);
}

main().catch((err) => {
  console.error(`bench-parallel: ${err.message}`);
  process.exit(1);
});
