// owner: RStack developed by Richardson Gunde
//
// Parallel-execution benchmark harness (#159). Builder/validator round-trips
// dominate wall clock, so parallel groups of *data-independent* stages can
// cut it — but only if the measured speed-up justifies the added scheduling
// complexity. This module holds the PURE decision logic:
//
//   1. Which stages may share a parallel group (data-independence check).
//   2. Sequential vs parallel wall-clock aggregation from injected timings.
//   3. The >= target-improvement gate that decides whether parallel groups
//      are enabled from evidence, not vibes.
//   4. The run-artifact shape the Business Hub can index and render.
//   5. Config validation for the `parallel_groups` block in rstack.config.json.
//
// Everything here takes timings as INPUT — nothing in this module reads a
// clock. The CLI runner (scripts/bench-parallel.mjs) measures wall clock and
// feeds the numbers in, so the gate decision is deterministic and testable.

import { getCanonicalStage } from './stages.js';

// Default speed-up the parallel path must clear before parallel groups are
// enabled. 0.40 == "at least 40% faster than sequential", the draft target
// from #159. Override per project via rstack.config.json parallel_groups.target.
export const DEFAULT_PARALLEL_TARGET = 0.40;

// Hard ceiling on stages per parallel group. Parallelism past this point
// stops paying off (host agent-team fan-out, contention on shared read
// artifacts) and risks masking a real data dependency behind luck. A config
// group larger than this is NOT silently truncated — it is flagged as an
// issue and the group is rejected. Transparency first.
export const PARALLEL_GROUP_HARD_CAP = 6;

// The benchmark measures wall clock two ways and reports which mode produced
// the numbers so a reader never mistakes a mock run for a live one.
export const BENCHMARK_MODES = Object.freeze(['mock', 'real']);

const SCHEMA_VERSION = 1;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isPositiveFiniteNumber(value) {
  return Number.isFinite(value) && value > 0;
}

/**
 * Data-independence check for a candidate parallel group.
 *
 * Two stages are data-independent when neither reads the other's output
 * artifact. RStack's canonical stages each own exactly one output artifact
 * (see stages.js), and downstream stages read upstream artifacts by
 * convention of pipeline order. So within a single benchmark group the
 * conservative, verifiable rule is: every stage id must be canonical, unique,
 * and the group must declare it reads only artifacts produced OUTSIDE the
 * group. We enforce the structural half here (canonical + unique + no stage's
 * own artifact appears in another member's declared reads); relevance of the
 * reads themselves is the caller's declared contract, documented honestly.
 *
 * @param {Array<{id:string, reads?:string[]}>} members
 * @returns {{ok:boolean, issues:string[]}}
 */
export function checkDataIndependence(members) {
  const issues = [];
  if (!Array.isArray(members) || members.length === 0) {
    return { ok: false, issues: ['a parallel group must list at least one stage'] };
  }
  if (members.length > PARALLEL_GROUP_HARD_CAP) {
    issues.push(`group has ${members.length} stages — exceeds the hard cap of ${PARALLEL_GROUP_HARD_CAP}; the group is rejected (not truncated)`);
  }
  const seen = new Set();
  const ownArtifacts = new Map(); // artifact -> stage id that produces it
  for (const member of members) {
    const id = member?.id;
    if (typeof id !== 'string' || !getCanonicalStage(id)) {
      issues.push(`${JSON.stringify(id)} is not a canonical stage id — data-independence cannot be verified`);
      continue;
    }
    if (seen.has(id)) {
      issues.push(`stage ${id} appears twice in the same group`);
      continue;
    }
    seen.add(id);
    ownArtifacts.set(getCanonicalStage(id).artifact, id);
  }
  // A member that declares it reads an artifact PRODUCED by another member of
  // the same group is a real data dependency — the group is not parallel-safe.
  for (const member of members) {
    const reads = Array.isArray(member?.reads) ? member.reads : [];
    for (const artifact of reads) {
      const producer = ownArtifacts.get(artifact);
      if (producer && producer !== member.id) {
        issues.push(`stage ${member.id} reads ${artifact}, produced by group member ${producer} — not data-independent`);
      }
    }
  }
  return { ok: issues.length === 0, issues };
}

/**
 * Sequential wall clock == the sum of every stage's measured duration.
 * @param {Record<string, number>} timings  stage id -> duration ms
 * @param {string[]} stageOrder  stages that actually ran, in order
 * @returns {number} total ms
 */
export function aggregateSequentialTime(timings, stageOrder) {
  let total = 0;
  for (const id of stageOrder) {
    const ms = Number(timings?.[id]);
    if (!isPositiveFiniteNumber(ms)) {
      throw new Error(`missing or non-positive timing for stage ${id}`);
    }
    total += ms;
  }
  return total;
}

/**
 * Parallel wall clock == the sum, across groups run one after another, of
 * each group's SLOWEST member (the group finishes when its last stage does).
 * Solo stages (not in any group) contribute their full duration.
 *
 * @param {Record<string, number>} timings  stage id -> duration ms
 * @param {Array<string[]>} groups  ordered list of parallel groups (stage ids)
 * @param {string[]} soloStages  stage ids run sequentially outside any group
 * @returns {number} total ms
 */
export function aggregateParallelTime(timings, groups, soloStages = []) {
  let total = 0;
  for (const group of groups) {
    if (!Array.isArray(group) || group.length === 0) {
      throw new Error('each parallel group must list at least one stage');
    }
    let slowest = 0;
    for (const id of group) {
      const ms = Number(timings?.[id]);
      if (!isPositiveFiniteNumber(ms)) {
        throw new Error(`missing or non-positive timing for stage ${id}`);
      }
      slowest = Math.max(slowest, ms);
    }
    total += slowest;
  }
  for (const id of soloStages) {
    const ms = Number(timings?.[id]);
    if (!isPositiveFiniteNumber(ms)) {
      throw new Error(`missing or non-positive timing for stage ${id}`);
    }
    total += ms;
  }
  return total;
}

/**
 * The gate. Enable parallel groups only when the measured improvement clears
 * the target. Improvement is the fraction of sequential wall clock removed:
 *   improvement = (seq - par) / seq
 *
 * @param {{seqTimeMs:number, parTimeMs:number, target?:number}} args
 * @returns {{improvement:number, deltaMs:number, target:number, meetsTarget:boolean, enable:boolean, reason:string}}
 */
export function evaluateParallelGate({ seqTimeMs, parTimeMs, target = DEFAULT_PARALLEL_TARGET }) {
  if (!isPositiveFiniteNumber(seqTimeMs)) {
    throw new Error('seqTimeMs must be a positive number');
  }
  if (!Number.isFinite(parTimeMs) || parTimeMs < 0) {
    throw new Error('parTimeMs must be a non-negative number');
  }
  if (!Number.isFinite(target) || target < 0 || target >= 1) {
    throw new Error('target must be a fraction in [0, 1)');
  }
  const deltaMs = seqTimeMs - parTimeMs;
  const improvement = deltaMs / seqTimeMs;
  const meetsTarget = improvement >= target;
  const pct = (improvement * 100).toFixed(1);
  const targetPct = (target * 100).toFixed(0);
  const reason = meetsTarget
    ? `measured ${pct}% faster (>= ${targetPct}% target) — parallel groups enabled from evidence`
    : `measured ${pct}% faster (< ${targetPct}% target) — parallel groups stay disabled`;
  return { improvement, deltaMs, target, meetsTarget, enable: meetsTarget, reason };
}

/**
 * Build the run artifact. Written to <runDir>/artifacts/parallel-benchmark.json,
 * where the dashboard run indexer (state/runs.js indexArtifacts) picks up any
 * top-level file under artifacts/ as a run-scoped deliverable, so the data
 * reaches the Business Hub artifact index without extra wiring. A dedicated
 * Hub panel is a later, presentational step — the data flows now.
 *
 * @param {object} args
 * @returns {object} serializable artifact
 */
export function buildBenchmarkArtifact({
  runId,
  mode,
  stageOrder,
  groups,
  soloStages = [],
  timings,
  seqTimeMs,
  parTimeMs,
  gate,
  samples = 1,
  notes = [],
}) {
  if (!BENCHMARK_MODES.includes(mode)) {
    throw new Error(`mode must be one of ${BENCHMARK_MODES.join(' | ')} — refusing to write an ambiguous artifact`);
  }
  return {
    artifact: 'parallel-benchmark',
    schema_version: SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    run_id: runId ?? null,
    // "mock" == synthetic sleep workload standing in for real builder/validator
    // round-trips; "real" == timings captured from live stage execution.
    // Never let a reader mistake one for the other.
    mode,
    measurement: mode === 'mock'
      ? 'Synthetic sleep workload timed with real wall clock; stage durations are simulated, not live agent round-trips.'
      : 'Timings captured from live stage execution.',
    samples,
    stage_order: stageOrder,
    parallel_groups: groups,
    solo_stages: soloStages,
    timings_ms: timings,
    seq_time_ms: seqTimeMs,
    par_time_ms: parTimeMs,
    delta_ms: gate.deltaMs,
    improvement: gate.improvement,
    improvement_pct: Number((gate.improvement * 100).toFixed(2)),
    target: gate.target,
    meets_target: gate.meetsTarget,
    recommendation: {
      enable_parallel_groups: gate.enable,
      reason: gate.reason,
    },
    notes,
  };
}

const KNOWN_PARALLEL_KEYS = new Set(['enabled', 'target', 'groups', 'require_benchmark']);

/**
 * Validate the `parallel_groups` block of rstack.config.json. Called by the
 * shared config-validation loader. Returns field-level issues; never throws.
 *
 * Shape:
 *   "parallel_groups": {
 *     "enabled": false,                 // gate result; only true when evidenced
 *     "target": 0.40,                   // required improvement fraction [0,1)
 *     "require_benchmark": true,        // enabled:true must be backed by a benchmark artifact
 *     "groups": [["12-...","13-...","14-..."]]
 *   }
 *
 * @param {object} parsed  parallel_groups object
 * @returns {Array<{field:string, problem:string}>}
 */
export function validateParallelGroupsConfig(parsed) {
  const issues = [];
  if (!isPlainObject(parsed)) {
    issues.push({ field: 'parallel_groups', problem: 'must be an object with { enabled, target, groups }' });
    return issues;
  }
  for (const key of Object.keys(parsed)) {
    if (!KNOWN_PARALLEL_KEYS.has(key)) {
      issues.push({ field: `parallel_groups.${key}`, problem: 'unknown key — this setting is ignored' });
    }
  }
  if (parsed.enabled != null && typeof parsed.enabled !== 'boolean') {
    issues.push({ field: 'parallel_groups.enabled', problem: `must be a boolean, got ${JSON.stringify(parsed.enabled)} — parallel groups stay disabled` });
  }
  if (parsed.require_benchmark != null && typeof parsed.require_benchmark !== 'boolean') {
    issues.push({ field: 'parallel_groups.require_benchmark', problem: `must be a boolean, got ${JSON.stringify(parsed.require_benchmark)}` });
  }
  if (parsed.target != null) {
    const target = Number(parsed.target);
    if (!Number.isFinite(target) || target < 0 || target >= 1) {
      issues.push({ field: 'parallel_groups.target', problem: `must be a fraction in [0, 1), got ${JSON.stringify(parsed.target)} — the default (${DEFAULT_PARALLEL_TARGET}) applies` });
    }
  }
  if (parsed.groups != null) {
    if (!Array.isArray(parsed.groups)) {
      issues.push({ field: 'parallel_groups.groups', problem: 'must be an array of stage-id groups (arrays)' });
    } else {
      parsed.groups.forEach((group, index) => {
        if (!Array.isArray(group)) {
          issues.push({ field: `parallel_groups.groups[${index}]`, problem: 'each group must be an array of canonical stage ids' });
          return;
        }
        const members = group.map((id) => ({ id }));
        const { ok, issues: depIssues } = checkDataIndependence(members);
        if (!ok) {
          for (const problem of depIssues) {
            issues.push({ field: `parallel_groups.groups[${index}]`, problem });
          }
        }
      });
    }
  }
  // enabled:true with require_benchmark (or defaulted true) but no groups is a
  // contradiction worth surfacing — enabling parallelism over nothing.
  if (parsed.enabled === true && (!Array.isArray(parsed.groups) || parsed.groups.length === 0)) {
    issues.push({ field: 'parallel_groups.enabled', problem: 'enabled is true but no groups are declared — parallel execution has nothing to run' });
  }
  return issues;
}
