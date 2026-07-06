// owner: RStack developed by Richardson Gunde
//
// Goal evaluator (#127, BLE-4.1): decides whether a run has met its declared
// success condition. Deterministic and model-free by design — verifiable
// criteria (file exists, command exits 0, metric threshold) are evaluated
// directly by the harness; "judge-kind" criteria close through a
// goal-verdict.json that a host framework or a human writes. The harness only
// validates and consumes verdicts; it NEVER calls a model.
//
// Inputs are structured JSON only (pipeline-state rollup, agent-11 feedback
// artifact, validation contracts, approvals, decisions, guardrail events).
// Prose is never parsed.

import { exec } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { CANONICAL_SDLC_STAGES } from './stages.js';
import { buildPipelineState } from './pipeline-state.js';
import { runDirectory, resolveRunId } from './runs.js';

const execAsync = promisify(exec);

export const GOAL_STATUSES = Object.freeze(['PASS', 'RETRY', 'ASK_USER', 'BLOCK']);
export const CRITERION_KINDS = Object.freeze(['file_exists', 'command', 'metric_threshold', 'judge']);
export const CRITERION_STATUSES = Object.freeze(['PASS', 'FAIL', 'PENDING']);
export const METRIC_OPERATORS = Object.freeze(['>=', '>', '<=', '<', '==', '!=']);
export const GOAL_DEFINITION_FILE = 'goal.json';
export const GOAL_VERDICT_FILE = 'goal-verdict.json';
export const VERDICT_VALUES = Object.freeze(['PASS', 'FAIL']);
export const VERDICT_RECOMMENDATIONS = Object.freeze(['retry', 'block']);

const DEFAULT_COMMAND_TIMEOUT_MS = 120_000;
const MAX_COMMAND_TIMEOUT_MS = 600_000;
const PASSED_TASK_STATUSES = new Set(['PASS', 'PASSED', 'SUCCESS', 'SUCCEEDED', 'DONE', 'COMPLETED']);
const FAILED_STAGE_STATUSES = new Set(['FAIL', 'FAILED', 'ERROR', 'BLOCKED']);
const FEEDBACK_STAGE_ID = '11-feedback-loop';

// ── Small tolerant readers (junk shapes degrade, never throw) ───────────────

async function readJsonIfPresent(filePath, fallback = null) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

async function readJsonlIfPresent(filePath) {
  let raw;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch {
    return [];
  }
  return raw.split('\n').filter((line) => line.trim()).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

function normalizeTasks(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.tasks)) return raw.tasks;
  return [];
}

function normalizeDecisionsList(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.decisions)) return raw.decisions;
  return [];
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// ── Goal definition schema ───────────────────────────────────────────────────
//
// {
//   "schema_version": 1,
//   "goal_id": "docs-sweep",
//   "description": "Docs match the shipped code",
//   "min_score": 100,
//   "criteria": [
//     { "id": "c1", "kind": "file_exists", "path": "docs/HARNESS.md" },
//     { "id": "c2", "kind": "command", "command": "npm test", "expect_exit_code": 0 },
//     { "id": "c3", "kind": "metric_threshold", "source": "feedback",
//       "metric": "summary.overall_consistency_score", "operator": ">=", "value": 90 },
//     { "id": "c4", "kind": "judge", "question": "Is the architecture satisfying?",
//       "rerun_stages": ["06-architecture"] }
//   ]
// }
//
// Any criterion may carry `rerun_stages` — the canonical stages the loop
// runner should reset when this criterion fails.

function normalizeRerunStages(value) {
  if (!Array.isArray(value)) return [];
  const known = new Set(CANONICAL_SDLC_STAGES.map((stage) => stage.id));
  return [...new Set(value.filter((id) => known.has(id)))];
}

function normalizeCriterion(raw, index, issues) {
  const id = typeof raw?.id === 'string' && raw.id.trim() ? raw.id.trim() : `criterion-${index + 1}`;
  const base = {
    id,
    kind: raw?.kind,
    description: typeof raw?.description === 'string' ? raw.description : '',
    rerun_stages: normalizeRerunStages(raw?.rerun_stages),
  };
  if (!isPlainObject(raw) || !CRITERION_KINDS.includes(raw.kind)) {
    issues.push(`criterion ${id}: unknown kind ${JSON.stringify(raw?.kind)} — expected ${CRITERION_KINDS.join(' | ')}`);
    return { ...base, kind: 'invalid' };
  }
  if (raw.kind === 'file_exists') {
    if (typeof raw.path !== 'string' || !raw.path.trim()) {
      issues.push(`criterion ${id}: file_exists requires a non-empty "path"`);
      return { ...base, kind: 'invalid' };
    }
    return { ...base, path: raw.path.trim(), run_relative: raw.run_relative === true };
  }
  if (raw.kind === 'command') {
    if (typeof raw.command !== 'string' || !raw.command.trim()) {
      issues.push(`criterion ${id}: command requires a non-empty "command"`);
      return { ...base, kind: 'invalid' };
    }
    const timeout = Number(raw.timeout_ms);
    return {
      ...base,
      command: raw.command.trim(),
      expect_exit_code: Number.isInteger(raw.expect_exit_code) ? raw.expect_exit_code : 0,
      timeout_ms: Number.isFinite(timeout) && timeout > 0
        ? Math.min(timeout, MAX_COMMAND_TIMEOUT_MS)
        : DEFAULT_COMMAND_TIMEOUT_MS,
    };
  }
  if (raw.kind === 'metric_threshold') {
    const value = Number(raw.value);
    const operator = METRIC_OPERATORS.includes(raw.operator) ? raw.operator : '>=';
    const validSource = raw.source === 'feedback' || raw.source === 'pipeline_state'
      || (isPlainObject(raw.source) && typeof raw.source.file === 'string' && raw.source.file.trim());
    if (typeof raw.metric !== 'string' || !raw.metric.trim() || !Number.isFinite(value) || !validSource) {
      issues.push(`criterion ${id}: metric_threshold requires "metric" (dot path), a numeric "value", and "source" ("feedback" | "pipeline_state" | {"file": "..."})`);
      return { ...base, kind: 'invalid' };
    }
    return { ...base, metric: raw.metric.trim(), operator, value, source: raw.source };
  }
  // judge
  return {
    ...base,
    question: typeof raw.question === 'string' ? raw.question : '',
  };
}

export function normalizeGoalDefinition(raw) {
  const issues = [];
  const goal = {
    schema_version: 1,
    goal_id: 'pipeline-complete',
    description: 'Default harness goal: every task passed, nothing is waiting on a human, and structured feedback reports no critical issues.',
    min_score: 100,
    criteria: [],
    issues,
  };
  if (raw == null) return goal;
  if (!isPlainObject(raw)) {
    issues.push('goal definition must be a JSON object — the default goal applies');
    return goal;
  }
  if (typeof raw.goal_id === 'string' && raw.goal_id.trim()) goal.goal_id = raw.goal_id.trim();
  if (typeof raw.description === 'string' && raw.description.trim()) goal.description = raw.description.trim();
  const minScore = Number(raw.min_score);
  if (raw.min_score != null) {
    if (Number.isFinite(minScore) && minScore >= 0 && minScore <= 100) goal.min_score = minScore;
    else issues.push(`min_score must be a number between 0 and 100, got ${JSON.stringify(raw.min_score)} — 100 applies`);
  }
  if (raw.criteria != null && !Array.isArray(raw.criteria)) {
    issues.push('criteria must be an array');
  } else if (Array.isArray(raw.criteria)) {
    goal.criteria = raw.criteria.map((criterion, index) => normalizeCriterion(criterion, index, issues));
  }
  return goal;
}

// ── Judge verdict protocol ───────────────────────────────────────────────────
//
// <run_dir>/goal-verdict.json is written by a host framework or a human — the
// harness only validates and consumes it. Accepted shapes: a single verdict
// object, an array of verdicts, or { "verdicts": [...] }. A verdict:
//
// { "criterion_id": "c4", "verdict": "PASS" | "FAIL", "judge": "who",
//   "reasoning": "...", "score": 0-100, "iteration": 2,
//   "recommendation": "retry" | "block", "recommended_rerun_stages": [...] }
//
// Freshness: when the evaluator runs with an iteration context (the loop
// runner always passes one), a verdict must carry `iteration >= current` to
// be consumed — a MISSING iteration stamp is treated as stale too, so a
// write-once {"verdict":"PASS"} can never auto-pass every later
// re-evaluation of a regressed design. One-shot evaluations (no iteration
// context) accept unstamped verdicts.

export function normalizeGoalVerdicts(raw) {
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.verdicts) ? raw.verdicts : raw != null ? [raw] : [];
  return list.filter(isPlainObject).map((item) => ({
    criterion_id: typeof item.criterion_id === 'string' ? item.criterion_id : null,
    verdict: VERDICT_VALUES.includes(item.verdict) ? item.verdict : null,
    judge: typeof item.judge === 'string' ? item.judge : null,
    reasoning: typeof item.reasoning === 'string' ? item.reasoning : '',
    score: Number.isFinite(Number(item.score)) ? Number(item.score) : null,
    iteration: Number.isInteger(item.iteration) ? item.iteration : null,
    recommendation: VERDICT_RECOMMENDATIONS.includes(item.recommendation) ? item.recommendation : 'retry',
    recommended_rerun_stages: normalizeRerunStages(item.recommended_rerun_stages),
  }));
}

function findVerdict(verdicts, criterion, judgeCriteriaCount, minIteration) {
  // Inside a loop iteration an unstamped verdict is stale by definition —
  // otherwise it would short-circuit the freshness filter forever.
  const fresh = verdicts.filter((verdict) => (
    minIteration == null || (verdict.iteration != null && verdict.iteration >= minIteration)
  ));
  const byId = fresh.find((verdict) => verdict.criterion_id === criterion.id);
  if (byId) return byId;
  // A single verdict with no criterion_id applies to the sole judge criterion.
  if (judgeCriteriaCount === 1) return fresh.find((verdict) => verdict.criterion_id == null) ?? null;
  return null;
}

// ── Agent-11 goal_evaluation (#128, BLE-4.2) ─────────────────────────────────
//
// Stage 11 (feedback-loop) may embed a structured `goal_evaluation` object in
// feedback.json — its machine-readable answer to "does this run meet the
// active goal?". The harness/agent boundary stays clean: agent 11 RECOMMENDS
// with evidence; this evaluator remains the deterministic decision-maker and
// still never calls a model. Per-criterion results become goal verdicts
// through the SAME verdict protocol as goal-verdict.json (same iteration
// freshness rules — a missing stamp is stale inside a loop iteration) and are
// consumed ONLY when every listed evidence path exists on disk. An `unknown`
// result or an unevidenced claim is never consumed — the judge criterion stays
// PENDING and the evaluation stops at the existing ASK_USER path.
//
// {
//   "goal_evaluation": {
//     "goal_id": "arch-satisfaction",
//     "iteration": 2,
//     "status": "RETRY",
//     "consistency_score": 82.5,
//     "critical_count": 1,
//     "failing_stages": ["06-architecture"],
//     "recommended_rerun_stages": ["06-architecture"],
//     "requires_human_decision": false,
//     "reason": "FR-003 has no endpoint in system_design.json",
//     "criteria": [
//       { "criterion_id": "design-review", "result": "not_met",
//         "evidence": ["artifacts/stages/06-architecture/system_design.json"],
//         "reasoning": "FR-003 unmapped", "maintenance_category": "corrective",
//         "recommendation": "retry",
//         "recommended_rerun_stages": ["06-architecture"] }
//     ]
//   }
// }
//
// The top-level fields (status, consistency_score, ...) are the agent's
// recommendation for hosts and dashboards — the evaluator recomputes its own
// decision from raw evidence and never trusts them blindly.

export const GOAL_EVALUATION_RESULTS = Object.freeze(['met', 'not_met', 'unknown']);
export const MAINTENANCE_CATEGORIES = Object.freeze(['perfective', 'adaptive', 'corrective', 'preventive']);
export const AGENT_GOAL_JUDGE = 'agent.11-feedback-loop';
export const GOAL_EVALUATION_REQUIRED_FIELDS = Object.freeze([
  'status',
  'consistency_score',
  'critical_count',
  'failing_stages',
  'recommended_rerun_stages',
  'requires_human_decision',
  'reason',
]);

export function normalizeGoalEvaluation(raw) {
  const issues = [];
  const section = {
    present: raw != null,
    goal_id: null,
    iteration: null,
    status: null,
    criteria: [],
    issues,
  };
  if (raw == null) return section;
  if (!isPlainObject(raw)) {
    issues.push('goal_evaluation must be a JSON object');
    return section;
  }
  if (typeof raw.goal_id === 'string' && raw.goal_id.trim()) section.goal_id = raw.goal_id.trim();
  if (raw.iteration != null) {
    if (Number.isInteger(raw.iteration)) section.iteration = raw.iteration;
    else issues.push(`goal_evaluation.iteration must be an integer, got ${JSON.stringify(raw.iteration)} — treated as unstamped (stale inside a loop iteration)`);
  }
  if (GOAL_STATUSES.includes(raw.status)) section.status = raw.status;
  else issues.push(`goal_evaluation.status must be ${GOAL_STATUSES.join(' | ')}, got ${JSON.stringify(raw.status)}`);
  if (raw.criteria != null && !Array.isArray(raw.criteria)) {
    issues.push('goal_evaluation.criteria must be an array');
    return section;
  }
  for (const [index, entry] of (raw.criteria ?? []).entries()) {
    if (!isPlainObject(entry)) {
      issues.push(`goal_evaluation.criteria[${index}] must be an object`);
      continue;
    }
    const criterionId = typeof entry.criterion_id === 'string' && entry.criterion_id.trim() ? entry.criterion_id.trim() : null;
    if (!criterionId) {
      issues.push(`goal_evaluation.criteria[${index}] is missing "criterion_id"`);
      continue;
    }
    if (!GOAL_EVALUATION_RESULTS.includes(entry.result)) {
      issues.push(`goal_evaluation.criteria[${index}] (${criterionId}): result must be ${GOAL_EVALUATION_RESULTS.join(' | ')}, got ${JSON.stringify(entry.result)}`);
      continue;
    }
    section.criteria.push({
      criterion_id: criterionId,
      result: entry.result,
      evidence: Array.isArray(entry.evidence)
        ? entry.evidence.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())
        : [],
      reasoning: typeof entry.reasoning === 'string' ? entry.reasoning : '',
      // A per-criterion stamp wins; otherwise the section stamp applies. No
      // stamp at all = stale inside a loop iteration, same as goal-verdict.json.
      iteration: Number.isInteger(entry.iteration) ? entry.iteration : section.iteration,
      recommendation: VERDICT_RECOMMENDATIONS.includes(entry.recommendation) ? entry.recommendation : 'retry',
      recommended_rerun_stages: normalizeRerunStages(entry.recommended_rerun_stages),
      maintenance_category: MAINTENANCE_CATEGORIES.includes(entry.maintenance_category) ? entry.maintenance_category : null,
    });
  }
  return section;
}

// Contract check for the section — same {ok, checks, issues} shape as the
// builder/validator contract checks in contracts.js, so hosts and validators
// can gate on it without new plumbing.
export function validateGoalEvaluation(raw) {
  const checks = [];
  const push = (name, pass, evidence) => checks.push({ name, status: pass ? 'PASS' : 'FAIL', evidence });

  if (!isPlainObject(raw)) {
    push('goal_evaluation_is_object', false, 'goal_evaluation missing or not an object');
    return { ok: false, checks, issues: checks.filter((check) => check.status === 'FAIL') };
  }
  push('goal_evaluation_is_object', true, 'present');

  for (const field of GOAL_EVALUATION_REQUIRED_FIELDS) {
    const present = Object.prototype.hasOwnProperty.call(raw, field);
    push(`goal_evaluation_has_${field}`, present, present ? 'present' : 'missing');
  }
  push('goal_evaluation_status_allowed', GOAL_STATUSES.includes(raw.status), String(raw.status));
  const score = Number(raw.consistency_score);
  push('goal_evaluation_consistency_score_numeric', Number.isFinite(score) && score >= 0 && score <= 100, String(raw.consistency_score));
  push('goal_evaluation_critical_count_numeric', Number.isInteger(raw.critical_count) && raw.critical_count >= 0, String(raw.critical_count));
  for (const field of ['failing_stages', 'recommended_rerun_stages']) {
    push(`goal_evaluation_${field}_is_array`, Array.isArray(raw[field]), Array.isArray(raw[field]) ? `${raw[field].length} item(s)` : 'not an array');
  }
  push('goal_evaluation_requires_human_decision_boolean', typeof raw.requires_human_decision === 'boolean', String(raw.requires_human_decision));
  const reasonOk = typeof raw.reason === 'string' && raw.reason.trim().length >= 10;
  push('goal_evaluation_reason_meaningful', reasonOk, reasonOk ? 'present' : 'reason must be at least 10 characters');

  const normalized = normalizeGoalEvaluation(raw);
  const criteriaIssues = normalized.issues.filter((issue) => issue.includes('criteria'));
  push('goal_evaluation_criteria_well_formed', criteriaIssues.length === 0, criteriaIssues.length ? criteriaIssues.join('; ') : `${normalized.criteria.length} criteria entr(ies)`);

  return { ok: checks.every((check) => check.status === 'PASS'), checks, issues: checks.filter((check) => check.status === 'FAIL') };
}

// Convert the section's per-criterion results into verdict-protocol entries.
// Evidence-or-nothing: every listed path must exist (relative paths resolve
// against the run dir first, then the project root). Rejections are returned
// with reasons so ASK_USER can say WHY the agent's claim was not consumed.
export function goalVerdictsFromFeedback(feedback, { runDir, projectRoot, iteration = null } = {}) {
  const section = normalizeGoalEvaluation(feedback?.goal_evaluation);
  const verdicts = [];
  const rejected = [];
  const evidenceExists = (evidencePath) => {
    if (isAbsolute(evidencePath)) return existsSync(evidencePath);
    if (runDir && existsSync(resolve(runDir, evidencePath))) return true;
    if (projectRoot && existsSync(resolve(projectRoot, evidencePath))) return true;
    return false;
  };
  for (const criterion of section.criteria) {
    if (criterion.result === 'unknown') {
      rejected.push({ criterion_id: criterion.criterion_id, reason: 'result is "unknown" — a host framework or human must judge' });
      continue;
    }
    // Anti-over-stamping (model-written artifact, unlike the trusted
    // goal-verdict.json writer): the prompt tells agent 11 to copy the CURRENT
    // loop_iteration_started value, so an honest agent never stamps ahead. A
    // stamp greater than the current iteration would stay ">= minIteration"
    // fresh forever and defeat the freshness filter — reject it as malformed.
    if (iteration != null && criterion.iteration != null && criterion.iteration > iteration) {
      rejected.push({
        criterion_id: criterion.criterion_id,
        reason: `iteration stamp ${criterion.iteration} is ahead of the current iteration ${iteration} — over-stamped evaluations are malformed, re-run 11-feedback-loop`,
      });
      continue;
    }
    if (!criterion.evidence.length) {
      rejected.push({ criterion_id: criterion.criterion_id, reason: 'no evidence paths — the harness never consumes unevidenced claims' });
      continue;
    }
    const missing = criterion.evidence.filter((evidencePath) => !evidenceExists(evidencePath));
    if (missing.length) {
      rejected.push({ criterion_id: criterion.criterion_id, reason: `evidence path(s) missing on disk: ${missing.join(', ')}` });
      continue;
    }
    verdicts.push({
      criterion_id: criterion.criterion_id,
      verdict: criterion.result === 'met' ? 'PASS' : 'FAIL',
      judge: AGENT_GOAL_JUDGE,
      reasoning: criterion.reasoning,
      score: null,
      iteration: criterion.iteration,
      recommendation: criterion.recommendation,
      recommended_rerun_stages: criterion.recommended_rerun_stages,
      evidence: criterion.evidence,
      maintenance_category: criterion.maintenance_category,
    });
  }
  return { present: section.present, verdicts, rejected, issues: section.issues };
}

// ── Evidence gathering ───────────────────────────────────────────────────────

export async function readGoalEvidence(runDir) {
  const feedbackCanonical = join(runDir, 'artifacts', 'stages', FEEDBACK_STAGE_ID, 'feedback.json');
  const feedbackLegacy = join(runDir, 'artifacts', 'feedback', 'consistency_report.json');
  const feedbackPath = existsSync(feedbackCanonical) ? feedbackCanonical : existsSync(feedbackLegacy) ? feedbackLegacy : null;

  return {
    goal: await readJsonIfPresent(join(runDir, GOAL_DEFINITION_FILE)),
    goal_path: existsSync(join(runDir, GOAL_DEFINITION_FILE)) ? join(runDir, GOAL_DEFINITION_FILE) : null,
    feedback: feedbackPath ? await readJsonIfPresent(feedbackPath) : null,
    feedback_path: feedbackPath,
    verdicts: normalizeGoalVerdicts(await readJsonIfPresent(join(runDir, GOAL_VERDICT_FILE))),
    verdict_path: existsSync(join(runDir, GOAL_VERDICT_FILE)) ? join(runDir, GOAL_VERDICT_FILE) : null,
    tasks: normalizeTasks(await readJsonIfPresent(join(runDir, 'tasks.json'), [])),
    approvals: await readJsonIfPresent(join(runDir, 'approvals.json'), []),
    decisions: normalizeDecisionsList(await readJsonIfPresent(join(runDir, 'decisions.json'), [])),
    events: await readJsonlIfPresent(join(runDir, 'events.jsonl')),
    metrics: await readJsonIfPresent(join(runDir, 'metrics.json'), {}),
  };
}

// ── Criterion evaluation ─────────────────────────────────────────────────────

function metricAt(source, path) {
  let cursor = source;
  for (const key of path.split('.')) {
    if (!isPlainObject(cursor) && !Array.isArray(cursor)) return undefined;
    cursor = cursor[key];
  }
  return cursor;
}

function compareMetric(observed, operator, value) {
  switch (operator) {
    case '>=': return observed >= value;
    case '>': return observed > value;
    case '<=': return observed <= value;
    case '<': return observed < value;
    case '==': return observed === value;
    case '!=': return observed !== value;
    default: return false;
  }
}

// Default command runner: shell exec with a bounded timeout. Injectable via
// options.runCommand so tests never spawn real processes. Criterion commands
// are user-authored project config (same trust level as npm scripts) and must
// be read-only checks — the evaluator runs them in dry-run too.
async function defaultRunCommand(command, { cwd, timeoutMs }) {
  try {
    await execAsync(command, { cwd, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 });
    return { exit_code: 0 };
  } catch (error) {
    if (error?.killed) return { exit_code: null, timed_out: true };
    return { exit_code: Number.isInteger(error?.code) ? error.code : 1 };
  }
}

async function evaluateCriterion(criterion, { projectRoot, runDir, state, evidence, explicitVerdicts, agentVerdicts, agentRejections, iteration, runCommand, judgeCriteriaCount }) {
  const result = { id: criterion.id, kind: criterion.kind, status: 'FAIL', detail: '', rerun_stages: criterion.rerun_stages };

  if (criterion.kind === 'invalid') {
    return { ...result, detail: 'invalid criterion — see goal_issues' };
  }

  if (criterion.kind === 'file_exists') {
    const base = criterion.run_relative ? runDir : projectRoot;
    const target = isAbsolute(criterion.path) ? criterion.path : resolve(base, criterion.path);
    const present = existsSync(target);
    return { ...result, status: present ? 'PASS' : 'FAIL', detail: present ? `${criterion.path} exists` : `${criterion.path} is missing` };
  }

  if (criterion.kind === 'command') {
    const outcome = await runCommand(criterion.command, { cwd: projectRoot, timeoutMs: criterion.timeout_ms });
    if (outcome?.timed_out) {
      return { ...result, status: 'FAIL', detail: `command timed out after ${criterion.timeout_ms}ms: ${criterion.command}` };
    }
    const passed = outcome?.exit_code === criterion.expect_exit_code;
    return {
      ...result,
      status: passed ? 'PASS' : 'FAIL',
      detail: `${criterion.command} exited ${outcome?.exit_code ?? 'unknown'} (expected ${criterion.expect_exit_code})`,
    };
  }

  if (criterion.kind === 'metric_threshold') {
    let source;
    let sourceLabel;
    if (criterion.source === 'feedback') {
      source = evidence.feedback;
      sourceLabel = 'feedback artifact';
      if (source == null) {
        return {
          ...result,
          status: 'PENDING',
          detail: 'feedback artifact missing — run stage 11-feedback-loop to produce structured feedback',
          rerun_stages: criterion.rerun_stages.length ? criterion.rerun_stages : [FEEDBACK_STAGE_ID],
        };
      }
    } else if (criterion.source === 'pipeline_state') {
      source = state;
      sourceLabel = 'pipeline-state rollup';
    } else {
      const filePath = resolve(runDir, criterion.source.file);
      source = await readJsonIfPresent(filePath);
      sourceLabel = criterion.source.file;
      if (source == null) {
        return { ...result, status: 'PENDING', detail: `metric source ${criterion.source.file} is missing or malformed` };
      }
    }
    const observed = Number(metricAt(source, criterion.metric));
    if (!Number.isFinite(observed)) {
      return { ...result, status: 'PENDING', detail: `metric ${criterion.metric} not found (or not numeric) in ${sourceLabel}` };
    }
    const passed = compareMetric(observed, criterion.operator, criterion.value);
    return {
      ...result,
      status: passed ? 'PASS' : 'FAIL',
      detail: `${criterion.metric} = ${observed} (required ${criterion.operator} ${criterion.value})`,
    };
  }

  // judge — model-free: consume the verdict protocol (goal-verdict.json, or an
  // evidence-backed agent-11 goal_evaluation entry) or report PENDING.
  //
  // The explicit goal-verdict.json pool is consumed FULLY first — including
  // the documented id-less single-judge shorthand {"verdict":"FAIL"} — before
  // any agent-11 verdict is considered. Agent entries always carry
  // criterion_ids, so a single merged pool would let an agent claim outrank a
  // shorthand human verdict by winning the id match. A human/host verdict
  // must always win.
  const verdict = findVerdict(explicitVerdicts, criterion, judgeCriteriaCount, iteration)
    ?? findVerdict(agentVerdicts, criterion, judgeCriteriaCount, iteration);
  if (!verdict || !verdict.verdict) {
    const rejection = agentRejections.find((item) => item.criterion_id === criterion.id);
    return {
      ...result,
      status: 'PENDING',
      detail: rejection
        ? `awaiting judge verdict — agent-11 goal_evaluation for ${criterion.id} was not consumed (${rejection.reason}); write ${GOAL_VERDICT_FILE} or re-run 11-feedback-loop with evidence`
        : `awaiting judge verdict — a host framework or human must write ${GOAL_VERDICT_FILE}, or stage 11-feedback-loop must emit an evidence-backed goal_evaluation (criterion_id: ${criterion.id})`,
    };
  }
  return {
    ...result,
    status: verdict.verdict,
    detail: `judge ${verdict.judge ?? 'unknown'}: ${verdict.verdict}${verdict.reasoning ? ` — ${verdict.reasoning}` : ''}`,
    rerun_stages: verdict.recommended_rerun_stages.length ? verdict.recommended_rerun_stages : criterion.rerun_stages,
    recommendation: verdict.recommendation,
  };
}

// ── Feedback (agent-11) interpretation — deterministic JSON fields only ─────

function feedbackCriticalIssues(feedback) {
  const issues = Array.isArray(feedback?.issues) ? feedback.issues : [];
  return issues.filter((issue) => String(issue?.severity ?? '').toUpperCase() === 'CRITICAL');
}

function feedbackCriticalCount(feedback) {
  const declared = Number(feedback?.summary?.critical_count);
  if (Number.isFinite(declared) && declared >= 0) return Math.max(declared, feedbackCriticalIssues(feedback).length);
  return feedbackCriticalIssues(feedback).length;
}

// Map an agent name from a remediation entry ("architecture_agent",
// "agent.06-architecture", "06-architecture") to a canonical stage id.
export function mapAgentToStage(name) {
  if (typeof name !== 'string' || !name.trim()) return null;
  const needle = name.trim().toLowerCase();
  for (const stage of CANONICAL_SDLC_STAGES) {
    if (needle === stage.agent || needle === stage.id) return stage.id;
  }
  for (const stage of CANONICAL_SDLC_STAGES) {
    const keyword = stage.id.replace(/^\d+-/, '');
    if (needle.includes(keyword)) return stage.id;
  }
  return null;
}

// ── The evaluator ────────────────────────────────────────────────────────────

export async function evaluateGoal(projectRoot, runId, options = {}) {
  const selected = await resolveRunId(projectRoot, runId);
  const runDir = runDirectory(projectRoot, selected);
  // Built in memory — evaluation persists NOTHING (dry-run safe by default).
  const state = options.state ?? await buildPipelineState(projectRoot, selected);
  const evidence = options.evidence ?? await readGoalEvidence(runDir);
  const goal = normalizeGoalDefinition(options.goal ?? evidence.goal);
  const iteration = Number.isInteger(options.iteration) ? options.iteration : null;
  const runCommand = options.runCommand ?? defaultRunCommand;

  // Agent-11 writer path (#128): evidence-backed goal_evaluation entries speak
  // the same verdict protocol but stay a SEPARATE pool, consumed only when the
  // explicit goal-verdict.json pool yields nothing for a criterion — a
  // human/host verdict (id-matched OR the id-less shorthand) always outranks
  // the agent's.
  const agentGoal = goalVerdictsFromFeedback(evidence.feedback, { runDir, projectRoot, iteration });

  const judgeCriteriaCount = goal.criteria.filter((criterion) => criterion.kind === 'judge').length;
  const criteria = [];
  for (const criterion of goal.criteria) {
    criteria.push(await evaluateCriterion(criterion, {
      projectRoot, runDir, state, evidence,
      explicitVerdicts: evidence.verdicts, agentVerdicts: agentGoal.verdicts,
      agentRejections: agentGoal.rejected, iteration, runCommand, judgeCriteriaCount,
    }));
  }

  // Harness checks — always evaluated, structured state only.
  const approvalBlockers = state?.approval_blockers ?? [];
  const pendingDecisions = evidence.decisions.filter((decision) => String(decision?.status ?? 'pending') === 'pending');
  const needsContextTasks = evidence.tasks.filter((task) => String(task?.status ?? '').toUpperCase() === 'NEEDS_CONTEXT');
  const blockedTasks = evidence.tasks.filter((task) => String(task?.status ?? '').toUpperCase() === 'BLOCKED');
  const unfinishedTasks = evidence.tasks.filter((task) => !PASSED_TASK_STATUSES.has(String(task?.status ?? '').toUpperCase()));
  const failingStages = (state?.stages ?? []).filter((stage) => FAILED_STAGE_STATUSES.has(stage.status)).map((stage) => stage.id);
  const criticalCount = evidence.feedback ? feedbackCriticalCount(evidence.feedback) : 0;

  const harnessChecks = [
    { id: 'harness.no_pending_approvals', status: approvalBlockers.length ? 'FAIL' : 'PASS', detail: approvalBlockers.length ? `${approvalBlockers.length} approval(s) pending` : 'no pending approvals' },
    { id: 'harness.no_pending_decisions', status: pendingDecisions.length ? 'FAIL' : 'PASS', detail: pendingDecisions.length ? `${pendingDecisions.length} decision(s) pending` : 'no pending decisions' },
    { id: 'harness.no_tasks_awaiting_context', status: needsContextTasks.length ? 'FAIL' : 'PASS', detail: needsContextTasks.length ? `task(s) awaiting human context: ${needsContextTasks.map((task) => task.id).join(', ')}` : 'no tasks awaiting context' },
    { id: 'harness.no_guardrail_blocked_tasks', status: blockedTasks.length ? 'FAIL' : 'PASS', detail: blockedTasks.length ? `blocked task(s) needing a guardrail-override: ${blockedTasks.map((task) => task.id).join(', ')}` : 'no blocked tasks' },
    { id: 'harness.all_tasks_passed', status: evidence.tasks.length && unfinishedTasks.length ? 'FAIL' : 'PASS', detail: evidence.tasks.length ? (unfinishedTasks.length ? `${unfinishedTasks.length} of ${evidence.tasks.length} task(s) not passed` : 'all tasks passed') : 'no tasks planned' },
    { id: 'harness.no_critical_feedback_issues', status: criticalCount ? 'FAIL' : 'PASS', detail: evidence.feedback ? (criticalCount ? `${criticalCount} critical issue(s) in feedback artifact` : 'no critical issues reported') : 'no feedback artifact (informational)' },
  ];

  // Decision assembly — deterministic precedence: humans first, then blocking
  // issues, then retryable work, then PASS.
  const askUserReasons = [];
  if (approvalBlockers.length) askUserReasons.push(`approval pending for ${approvalBlockers[0].artifact ?? 'an artifact'}`);
  if (pendingDecisions.length) askUserReasons.push(`decision ${pendingDecisions[0].decision_id ?? pendingDecisions[0].id ?? ''} is pending`.trim());
  if (needsContextTasks.length) askUserReasons.push(`task ${needsContextTasks[0].id} needs human context`);
  const pendingJudges = criteria.filter((criterion) => criterion.kind === 'judge' && criterion.status === 'PENDING');
  if (pendingJudges.length) {
    const rejection = agentGoal.rejected.find((item) => item.criterion_id === pendingJudges[0].id);
    askUserReasons.push(rejection
      ? `judge verdict required for criterion ${pendingJudges[0].id} — agent-11 claim not consumed (${rejection.reason}); write ${GOAL_VERDICT_FILE} or re-run 11-feedback-loop with evidence`
      : `judge verdict required for criterion ${pendingJudges[0].id} (write ${GOAL_VERDICT_FILE} or have 11-feedback-loop emit an evidence-backed goal_evaluation)`);
  }

  const blockReasons = [];
  if (blockedTasks.length) blockReasons.push(`task ${blockedTasks[0].id} is BLOCKED — approve guardrail-override:${blockedTasks[0].id} or intervene`);
  const blockingJudges = criteria.filter((criterion) => criterion.kind === 'judge' && criterion.status === 'FAIL' && criterion.recommendation === 'block');
  if (blockingJudges.length) blockReasons.push(`judge blocked criterion ${blockingJudges[0].id}`);

  const rerunStages = new Set();
  const criticalIssues = evidence.feedback ? feedbackCriticalIssues(evidence.feedback) : [];
  if (criticalIssues.length) {
    const remediable = criticalIssues.filter((issue) => {
      const remediation = issue?.remediation;
      return isPlainObject(remediation) && (remediation.can_auto_remediate === true || typeof remediation.agent_to_rerun === 'string');
    });
    if (remediable.length === criticalIssues.length) {
      for (const issue of remediable) {
        const stageId = mapAgentToStage(issue.remediation.agent_to_rerun);
        if (stageId) rerunStages.add(stageId);
      }
    } else {
      const first = criticalIssues.find((issue) => !remediable.includes(issue));
      blockReasons.push(`critical feedback issue ${first?.id ?? ''} has no remediation path — human decision required`.trim());
    }
  }

  const failingCriteria = criteria.filter((criterion) => criterion.status === 'FAIL');
  const pendingCriteria = criteria.filter((criterion) => criterion.status === 'PENDING');
  for (const criterion of [...failingCriteria, ...pendingCriteria]) {
    for (const stageId of criterion.rerun_stages ?? []) rerunStages.add(stageId);
  }
  for (const stageId of failingStages) rerunStages.add(stageId);

  const allChecks = [...criteria, ...harnessChecks];
  const passCount = allChecks.filter((check) => check.status === 'PASS').length;
  const score = allChecks.length ? Math.round((passCount / allChecks.length) * 1000) / 10 : 100;

  const nonJudgePending = pendingCriteria.filter((criterion) => criterion.kind !== 'judge');
  const retryNeeded = failingCriteria.length > 0
    || nonJudgePending.length > 0
    || failingStages.length > 0
    || unfinishedTasks.length > 0
    || criticalIssues.length > 0
    || score < goal.min_score;

  let status;
  let reason;
  if (askUserReasons.length) {
    status = 'ASK_USER';
    reason = `Human input required: ${askUserReasons.join('; ')}.`;
  } else if (blockReasons.length) {
    status = 'BLOCK';
    reason = `Blocking issue: ${blockReasons.join('; ')}.`;
  } else if (retryNeeded) {
    status = 'RETRY';
    const failures = [
      failingCriteria.length ? `${failingCriteria.length} criteria failing` : null,
      nonJudgePending.length ? `${nonJudgePending.length} criteria pending evidence` : null,
      failingStages.length ? `failing stages: ${failingStages.join(', ')}` : null,
      unfinishedTasks.length ? `${unfinishedTasks.length} task(s) not passed` : null,
      criticalIssues.length ? `${criticalIssues.length} critical feedback issue(s)` : null,
      score < goal.min_score ? `score ${score} below min_score ${goal.min_score}` : null,
    ].filter(Boolean);
    reason = `Goal not met: ${failures.join('; ')}.`;
  } else {
    status = 'PASS';
    reason = `Goal met: all ${allChecks.length} check(s) passing and score ${score} >= min_score ${goal.min_score}.`;
  }

  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    run_id: selected,
    goal_id: goal.goal_id,
    iteration,
    status,
    score,
    min_score: goal.min_score,
    critical_count: criticalCount,
    failing_stages: failingStages,
    recommended_rerun_stages: status === 'RETRY' ? [...rerunStages] : [],
    reason,
    criteria,
    harness_checks: harnessChecks,
    goal_issues: goal.issues,
    // Observability for the agent-11 writer path: which claims were consumed
    // as verdicts and which were rejected (and why). Advisory only — the
    // decision above is recomputed from raw evidence, never copied from here.
    agent_goal_evaluation: {
      present: agentGoal.present,
      consumed: agentGoal.verdicts.map((verdict) => verdict.criterion_id),
      rejected: agentGoal.rejected,
      issues: agentGoal.issues,
    },
    evidence_paths: {
      goal: evidence.goal_path,
      feedback: evidence.feedback_path,
      verdict: evidence.verdict_path,
    },
  };
}

// One operator-readable line — someone tailing the trace must understand the
// decision without reading source.
export function summarizeGoalDecision(evaluation) {
  if (!evaluation || !GOAL_STATUSES.includes(evaluation.status)) {
    return '[UNKNOWN] goal evaluation is missing or malformed.';
  }
  const parts = [`[${evaluation.status}] goal ${evaluation.goal_id ?? 'unknown'} — score ${evaluation.score ?? '?'} (min ${evaluation.min_score ?? '?'})`];
  if (evaluation.status === 'RETRY' && evaluation.recommended_rerun_stages?.length) {
    parts.push(`rerun: ${evaluation.recommended_rerun_stages.join(', ')}`);
  }
  if (evaluation.reason) parts.push(evaluation.reason);
  return parts.join(' | ');
}
