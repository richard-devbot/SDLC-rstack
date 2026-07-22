// owner: RStack developed by Richardson Gunde
//
// Quality & Risk Index (#453) — the qualitative counterpart to the financial
// (cost/token) telemetry. Today the Hub can say "green, cost $X" but not "green,
// but complexity spiked and two high-severity risks were accepted." This derives
// two indices, SERVER-SIDE from the run's real artifacts + events (no second
// brain in the client), with HONEST NULLS when a source is absent — a missing
// signal yields "unknown", never a fabricated number:
//
//   Aggregated Risk Score (0-100, higher = riskier) — rolls builder-reported
//     risks (weighted by severity, discounted when mitigated), guardrail blocks
//     (accepted overrides count less than hard blocks), and validator hard-blocks
//     into ONE index — not a bare count.
//   Complexity Index (0-100, higher = more complex) — from real structural
//     signal: files touched, breadth of tasks, and executed-command count
//     (#452 execution evidence), never self-report.
//   Cost-to-Value (optional) — pairs cumulative cost against delivered proof
//     coverage so a high spend on thin proof is visible.
//
// The weights below are OPINIONATED but TRANSPARENT (v1, #453): one documented
// formula, computed here. They can become config-tunable later without changing
// callers. This projection is BI only — it never blocks a gate or changes a
// verdict (best-effort by contract).

// --- transparent weights (v1) ----------------------------------------------

export const RISK_SEVERITY_WEIGHTS = Object.freeze({ critical: 25, high: 12, medium: 5, low: 2 });
export const MITIGATED_RISK_FACTOR = 0.25;      // a mitigated risk still carries residual
export const GUARDRAIL_BLOCK_WEIGHT = 15;        // a hard guardrail block
export const GUARDRAIL_OVERRIDE_WEIGHT = 8;      // a knowingly-ACCEPTED (overridden) risk
export const VALIDATOR_BLOCK_WEIGHT = 10;        // a validator hard-block

// Complexity contributions (each capped, summing to 100).
const FILES_CAP = 200;   // files touched → up to 50 pts
const TASKS_CAP = 15;    // builder tasks → up to 25 pts
const EXEC_CAP = 15;     // executed commands → up to 25 pts

const RISK_BANDS = [
  { max: 19, band: 'low' },
  { max: 49, band: 'elevated' },
  { max: 79, band: 'high' },
  { max: 100, band: 'critical' },
];
const COMPLEXITY_BANDS = [
  { max: 24, band: 'low' },
  { max: 49, band: 'moderate' },
  { max: 74, band: 'high' },
  { max: 100, band: 'very_high' },
];

function bandFor(score, bands) {
  if (score == null) return 'unknown';
  for (const { max, band } of bands) if (score <= max) return band;
  return bands[bands.length - 1].band;
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

// --- risk signal normalization ---------------------------------------------

export function normalizeRiskSeverity(risk) {
  const raw = String(
    (risk && typeof risk === 'object' ? (risk.severity ?? risk.level ?? risk.impact) : '') ?? '',
  ).toLowerCase();
  if (['critical', 'fatal', 'severe', 'blocker'].includes(raw)) return 'critical';
  if (['high', 'error', 'major'].includes(raw)) return 'high';
  if (['low', 'minor', 'info', 'informational', 'trivial'].includes(raw)) return 'low';
  return 'medium'; // default, and explicit 'medium'/'moderate'/'warn'
}

// A risk is mitigated only when it is genuinely resolved/closed or carries a
// mitigation. An ACCEPTED risk is NOT mitigated — it is a knowingly-retained
// residual, so it keeps its full weight.
export function isRiskMitigated(risk) {
  if (!risk || typeof risk !== 'object') return false;
  if (risk.mitigated === true) return true;
  const status = String(risk.status ?? '').toLowerCase();
  if (['mitigated', 'resolved', 'closed', 'fixed'].includes(status)) return true;
  return typeof risk.mitigation === 'string' && risk.mitigation.trim().length > 0;
}

function collectRisks(tasks) {
  const risks = [];
  for (const task of tasks ?? []) {
    const list = task?.builder?.risks;
    if (Array.isArray(list)) risks.push(...list);
  }
  return risks;
}

// --- the pure computation ---------------------------------------------------

/**
 * Compute the Quality & Risk indices for a single run from its already-loaded
 * tasks + events. Extra signals (coverage %, cumulative cost) are passed in so
 * this function stays a pure, testable roll-up of the run's own data.
 */
export function computeQualityRisk(run, { coveragePercent = null, costUsd = null } = {}) {
  if (!run) return null;
  const tasks = run.tasks ?? [];
  const events = run.events ?? [];
  const builderTasks = tasks.filter((task) => task?.builder && typeof task.builder === 'object');

  const guardrailBlocks = events.filter((ev) => String(ev?.type ?? '') === 'guardrail_triggered').length;
  const guardrailOverrides = events.filter((ev) => String(ev?.type ?? '') === 'guardrail_overridden').length;
  const validatorBlocks = events.filter((ev) => String(ev?.type ?? '') === 'task_blocked_by_validator').length;
  const executions = events.filter((ev) => String(ev?.type ?? '') === 'execution_recorded');

  // ---- Aggregated Risk Score ----
  const risks = collectRisks(builderTasks);
  const severityCounts = { critical: 0, high: 0, medium: 0, low: 0 };
  let mitigatedCount = 0;
  let rawRisk = 0;
  for (const risk of risks) {
    const severity = normalizeRiskSeverity(risk);
    severityCounts[severity] += 1;
    const mitigated = isRiskMitigated(risk);
    if (mitigated) mitigatedCount += 1;
    rawRisk += RISK_SEVERITY_WEIGHTS[severity] * (mitigated ? MITIGATED_RISK_FACTOR : 1);
  }
  rawRisk += guardrailBlocks * GUARDRAIL_BLOCK_WEIGHT;
  rawRisk += guardrailOverrides * GUARDRAIL_OVERRIDE_WEIGHT;
  rawRisk += validatorBlocks * VALIDATOR_BLOCK_WEIGHT;

  // Honest null: no risk-bearing source at all (no builder contract, no gate
  // event) → unknown, not "0 risk". A genuine 0 (contracts present, nothing
  // flagged) IS a real, reportable score.
  const riskSignalPresent = builderTasks.length > 0 || guardrailBlocks > 0 || guardrailOverrides > 0 || validatorBlocks > 0;
  const riskScore = riskSignalPresent ? clampScore(rawRisk) : null;

  // ---- Complexity Index ----
  const filesTouched = new Set();
  for (const task of builderTasks) {
    const files = task.builder.files_modified;
    if (Array.isArray(files)) for (const file of files) if (typeof file === 'string' && file.trim()) filesTouched.add(file.trim());
  }
  const filesComponent = Math.min(filesTouched.size, FILES_CAP) / FILES_CAP * 50;
  const tasksComponent = Math.min(builderTasks.length, TASKS_CAP) / TASKS_CAP * 25;
  const execComponent = Math.min(executions.length, EXEC_CAP) / EXEC_CAP * 25;
  const complexitySignalPresent = builderTasks.length > 0 || filesTouched.size > 0 || executions.length > 0;
  const complexityScore = complexitySignalPresent
    ? clampScore(filesComponent + tasksComponent + execComponent)
    : null;

  // ---- Cost-to-Value (optional) ----
  const hasCost = typeof costUsd === 'number' && Number.isFinite(costUsd);
  const hasCoverage = typeof coveragePercent === 'number' && Number.isFinite(coveragePercent);
  const costToValue = hasCost
    ? {
      cost_usd: Math.round(costUsd * 100) / 100,
      coverage_percent: hasCoverage ? coveragePercent : null,
      // Cost per point of delivered proof coverage — high = expensive for the
      // proof produced. Null when coverage is unknown or zero (avoid /0 lies).
      cost_per_coverage_point: hasCoverage && coveragePercent > 0
        ? Math.round((costUsd / coveragePercent) * 100) / 100
        : null,
    }
    : null;

  // Execution verification posture (#452 signal): how many recorded executions
  // were container-verified vs. unverified — context for the indices above.
  const execution = executions.length
    ? {
      total: executions.length,
      verified: executions.filter((ev) => ev.tier && ev.tier !== 'unverified').length,
      passed: executions.filter((ev) => String(ev.status ?? '') === 'PASS').length,
      failed: executions.filter((ev) => String(ev.status ?? '') === 'FAIL').length,
      unverified: executions.filter((ev) => !ev.tier || ev.tier === 'unverified').length,
    }
    : null;

  return {
    risk: {
      score: riskScore,
      band: bandFor(riskScore, RISK_BANDS),
      total: risks.length,
      by_severity: severityCounts,
      mitigated: mitigatedCount,
      accepted_overrides: guardrailOverrides,
      guardrail_blocks: guardrailBlocks,
      validator_blocks: validatorBlocks,
    },
    complexity: {
      score: complexityScore,
      band: bandFor(complexityScore, COMPLEXITY_BANDS),
      files_touched: filesTouched.size,
      builder_tasks: builderTasks.length,
      executions: executions.length,
    },
    cost_to_value: costToValue,
    execution,
  };
}

// --- run selection + coverage/cost extraction -------------------------------

function focusRun(runs) {
  const candidates = runs ?? [];
  return candidates.find((run) => run.derivedStatus === 'active')
    ?? candidates.find((run) => run.pipelineRollup)
    ?? candidates[0]
    ?? null;
}

// Cumulative cost from the pipeline rollup's per-stage cost_usd (the same
// numbers the cost projection reads); null when none is recorded.
function cumulativeCost(run) {
  const stages = run?.pipelineRollup?.stages;
  if (!Array.isArray(stages)) return null;
  let total = 0;
  let seen = false;
  for (const stage of stages) {
    if (typeof stage?.cost_usd === 'number' && Number.isFinite(stage.cost_usd)) { total += stage.cost_usd; seen = true; }
  }
  return seen ? total : null;
}

/**
 * Server-owned Quality & Risk projection for the focus run. Reads proof coverage
 * from the readiness projection (single source) and cost from the rollup. Null
 * focusRunId + unknown bands when there is no run to evaluate.
 */
export function buildQualityRiskProjection(state, { evaluatedAt = null } = {}) {
  const run = focusRun(state?.runs);
  if (!run) {
    return { focusRunId: null, risk: null, complexity: null, cost_to_value: null, execution: null, evaluatedAt };
  }
  const coveragePercent = state?.readiness?.coverage?.percent ?? state?.evidenceCenter?.summary?.coveragePercent ?? null;
  const indices = computeQualityRisk(run, { coveragePercent, costUsd: cumulativeCost(run) });
  return { focusRunId: run.runId ?? null, ...indices, evaluatedAt };
}
