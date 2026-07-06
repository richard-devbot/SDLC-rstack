// owner: RStack developed by Richardson Gunde

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

//
// Context pressure warnings (#136, BLE-6.2).
//
// Long loop runs degrade quality when they keep injecting large context. The
// cost/context telemetry from #83/#135 (src/core/harness/telemetry.js) already
// records the builder contract's `context` gauges and per-task summaries; this
// module is the shared CLASSIFIER that turns oversized context into pinned
// `context_pressure_warning` events the host appends at validate time.
//
// The classifier and validators are pure — no filesystem, no model calls, no
// tokenizer (the sole impure export is loadProjectContextPressureThresholds,
// which reads .rstack/rstack.config.json, mirroring loadProjectGuardrails). Sizes
// are APPROXIMATE character/token signals already present in the harness (the
// issue's explicit constraint: "No model tokenization dependency"). A "token"
// gauge is whatever the builder contract reported in context.tokens_used /
// context.tokens_available; a "chars" gauge is the string length of a context
// block. The two never mix inside one threshold.
//
// TRANSPARENCY (Richardson's non-negotiable #1 + the #136 emit-vs-detect rule):
// this module DETECTS pressure and WARNS. It does not prune memory or truncate
// artifacts, so it emits ONLY `context_pressure_warning`. It never emits
// `memory_pruned` or `artifact_summary_truncated` — those name actions this
// code does not take. (Memory pruning is emitted separately by the memory
// injection path.) A warning may name the pressure `source` so a reader knows
// WHERE the pressure is, but the event never claims an action was performed.

/**
 * Default context-pressure thresholds. All sizes are approximate.
 *
 * - builder_prompt_chars: the assembled builder prompt string length. A large
 *   prompt is the task-packet pressure the issue calls out ("oversized task
 *   packet emits warning before builder execution").
 * - injected_memory_chars: the formatted episodic-memory block injected into
 *   the prompt. This is the "oversized memory injection" signal.
 * - artifact_summary_chars: a single artifact/tool-result summary carried in
 *   the contract or events.
 * - stage_summary_chars: a single stage_summaries[] entry serialized.
 * - context_tokens_used: the builder contract's reported context.tokens_used
 *   (a token gauge, not a char count).
 * - context_tokens_ratio: fraction of context.tokens_available consumed
 *   (0..1). Fires when tokens_used / tokens_available crosses it. This catches
 *   pressure on small windows that a flat token count would miss.
 *
 * Defaults are deliberately generous — a warning is a non-blocking signal
 * (issue: "Keep warning behavior non-blocking"), so a false positive costs a
 * log line, not a stalled run.
 */
export const DEFAULT_CONTEXT_PRESSURE_THRESHOLDS = Object.freeze({
  builder_prompt_chars: 120000,
  injected_memory_chars: 24000,
  artifact_summary_chars: 12000,
  stage_summary_chars: 8000,
  context_tokens_used: 160000,
  context_tokens_ratio: 0.85,
});

// The char/count thresholds share one shape (a positive number); the ratio is
// the only 0..1 field, validated separately.
const COUNT_THRESHOLD_FIELDS = [
  'builder_prompt_chars',
  'injected_memory_chars',
  'artifact_summary_chars',
  'stage_summary_chars',
  'context_tokens_used',
];
const RATIO_THRESHOLD_FIELD = 'context_tokens_ratio';

export const CONTEXT_PRESSURE_THRESHOLD_FIELDS = Object.freeze([
  ...COUNT_THRESHOLD_FIELDS,
  RATIO_THRESHOLD_FIELD,
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function positiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Resolve effective thresholds from a config override, falling back to defaults
 * per-field. Malformed or missing overrides fall back SILENTLY here (safe
 * defaults) — the actionable warning about *why* a field was ignored is
 * produced by validateContextPressureConfig at config-load time, so a bad
 * threshold never silently disables a warning the user believes is active.
 *
 * Accepts either a bare thresholds object or a config wrapper
 * ({ context_pressure: { thresholds: {...} } } / { thresholds: {...} }).
 */
export function resolveContextPressureThresholds(override) {
  const source = extractThresholdSource(override);
  const resolved = { ...DEFAULT_CONTEXT_PRESSURE_THRESHOLDS };
  if (!isPlainObject(source)) return resolved;
  for (const field of COUNT_THRESHOLD_FIELDS) {
    const parsed = positiveNumber(source[field]);
    if (parsed !== null) resolved[field] = parsed;
  }
  const ratio = Number(source[RATIO_THRESHOLD_FIELD]);
  if (Number.isFinite(ratio) && ratio > 0 && ratio <= 1) resolved[RATIO_THRESHOLD_FIELD] = ratio;
  return resolved;
}

function extractThresholdSource(override) {
  if (!isPlainObject(override)) return null;
  if (isPlainObject(override.context_pressure)) {
    return isPlainObject(override.context_pressure.thresholds)
      ? override.context_pressure.thresholds
      : override.context_pressure;
  }
  if (isPlainObject(override.thresholds)) return override.thresholds;
  return override;
}

// Approximate size of a context value in characters. Objects/arrays are
// measured as their JSON serialization (what would actually be injected);
// strings by length; everything else as its String() form. Null/undefined are
// size 0 — nothing to pressure on.
function approxChars(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'string') return value.length;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value).length;
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return 0;
  }
}

function warning(source, metric, size, threshold, extra = {}) {
  return {
    type: 'context_pressure_warning',
    source,
    metric,
    size,
    threshold,
    // Non-blocking by contract (#136). A future policy may set this to a
    // blocking severity; today every warning is advisory.
    blocking: false,
    ...extra,
  };
}

/**
 * Classify context-pressure signals for one builder attempt into pinned
 * `context_pressure_warning` events. Pure: takes the measurable inputs, returns
 * an array (empty when nothing breaches a threshold — under-threshold is
 * SILENCE, never a zero-size event).
 *
 * Inputs (all optional; a missing input contributes no warnings):
 * - taskId: stamped on every emitted warning.
 * - builderPrompt: the assembled prompt string (task-packet size).
 * - memoryBlock: the injected episodic-memory block string.
 * - contract: the builder.json contract — its `memory_summary` and
 *   `stage_summaries[]` are measured, and its `context.tokens_used` /
 *   `context.tokens_available` gauges drive the token thresholds.
 * - artifactSummaries: array of { name, text } artifact/tool-result summaries.
 * - thresholds: effective thresholds (from resolveContextPressureThresholds);
 *   defaults applied when omitted.
 *
 * Each returned event carries the exact contract shape documented in
 * HARNESS.md (source, metric, size, threshold, blocking:false). Downstream
 * consumers (pipeline-state rollup, alerts feed) key on these — same discipline
 * as retry_decision.
 */
export function classifyContextPressure({
  taskId = null,
  builderPrompt = null,
  memoryBlock = null,
  contract = null,
  artifactSummaries = null,
  thresholds = DEFAULT_CONTEXT_PRESSURE_THRESHOLDS,
} = {}) {
  const t = { ...DEFAULT_CONTEXT_PRESSURE_THRESHOLDS, ...(isPlainObject(thresholds) ? thresholds : {}) };
  const events = [];
  const stamp = (event) => (taskId ? { task_id: taskId, ...event } : event);

  if (typeof builderPrompt === 'string') {
    const size = builderPrompt.length;
    if (size > t.builder_prompt_chars) {
      events.push(stamp(warning('builder_prompt', 'chars', size, t.builder_prompt_chars)));
    }
  }

  if (typeof memoryBlock === 'string') {
    const size = memoryBlock.length;
    if (size > t.injected_memory_chars) {
      events.push(stamp(warning('injected_memory', 'chars', size, t.injected_memory_chars)));
    }
  }

  if (isPlainObject(contract)) {
    const memorySummarySize = approxChars(contract.memory_summary);
    if (memorySummarySize > t.injected_memory_chars) {
      events.push(stamp(warning('memory_summary', 'chars', memorySummarySize, t.injected_memory_chars)));
    }

    if (Array.isArray(contract.stage_summaries)) {
      for (const summary of contract.stage_summaries) {
        const size = approxChars(summary);
        if (size > t.stage_summary_chars) {
          const stageId = isPlainObject(summary) && typeof summary.stage_id === 'string' ? summary.stage_id : null;
          events.push(stamp(warning('stage_summary', 'chars', size, t.stage_summary_chars, stageId ? { stage_id: stageId } : {})));
        }
      }
    }

    const context = isPlainObject(contract.context) ? contract.context : null;
    if (context) {
      const used = positiveNumber(context.tokens_used);
      if (used !== null && used > t.context_tokens_used) {
        events.push(stamp(warning('context_tokens', 'tokens', used, t.context_tokens_used)));
      }
      const available = positiveNumber(context.tokens_available);
      if (used !== null && available !== null) {
        const ratio = used / available;
        if (ratio > t.context_tokens_ratio) {
          events.push(stamp(warning('context_tokens', 'ratio', Number(ratio.toFixed(4)), t.context_tokens_ratio, {
            tokens_used: used,
            tokens_available: available,
          })));
        }
      }
    }
  }

  if (Array.isArray(artifactSummaries)) {
    for (const item of artifactSummaries) {
      const text = isPlainObject(item) ? item.text : item;
      const size = approxChars(text);
      if (size > t.artifact_summary_chars) {
        const name = isPlainObject(item) && typeof item.name === 'string' ? item.name : null;
        events.push(stamp(warning('artifact_summary', 'chars', size, t.artifact_summary_chars, name ? { artifact: name } : {})));
      }
    }
  }

  return events;
}

/**
 * Field-level config validation for the `context_pressure` block of
 * rstack.config.json (#151 pattern). Returns [{ field, problem }] — an empty
 * array means the config is clean. Never throws; a malformed block yields
 * warnings and the defaults apply (so a typo never silently disables pressure
 * warnings the user believes are active).
 *
 * Accepts the block itself (config.context_pressure). Callers pass
 * parsed.context_pressure; a nested `thresholds` object is also accepted.
 */
export function validateContextPressureConfig(block) {
  const issues = [];
  if (block == null) return issues;
  if (!isPlainObject(block)) {
    issues.push({ field: 'context_pressure', problem: 'must be an object of pressure-threshold overrides — the defaults apply' });
    return issues;
  }
  const thresholds = isPlainObject(block.thresholds) ? block.thresholds : block;
  const prefix = isPlainObject(block.thresholds) ? 'context_pressure.thresholds' : 'context_pressure';
  for (const [key, value] of Object.entries(thresholds)) {
    if (key === 'thresholds') continue; // wrapper key, validated via its contents
    if (!CONTEXT_PRESSURE_THRESHOLD_FIELDS.includes(key)) {
      issues.push({ field: `${prefix}.${key}`, problem: 'unknown context-pressure threshold key — this override is ignored' });
      continue;
    }
    if (key === RATIO_THRESHOLD_FIELD) {
      const ratio = Number(value);
      if (!Number.isFinite(ratio) || ratio <= 0 || ratio > 1) {
        issues.push({ field: `${prefix}.${key}`, problem: `must be a number in (0, 1], got ${JSON.stringify(value)} — the default (${DEFAULT_CONTEXT_PRESSURE_THRESHOLDS[key]}) applies` });
      }
    } else if (positiveNumber(value) === null) {
      issues.push({ field: `${prefix}.${key}`, problem: `must be a positive number, got ${JSON.stringify(value)} — the default (${DEFAULT_CONTEXT_PRESSURE_THRESHOLDS[key]}) applies` });
    }
  }
  return issues;
}

// ── project config loader (the one impure function) ──────────────────────────
//
// Everything above is pure; this reads .rstack/rstack.config.json to resolve
// the effective thresholds, mirroring loadProjectGuardrails. A malformed config
// falls back to defaults with a stderr note (the field-level detail is surfaced
// by validateProjectConfigs at load time) — a bad config never silently
// disables the warnings.
export async function loadProjectContextPressureThresholds(projectRoot) {
  const configPath = join(projectRoot, '.rstack', 'rstack.config.json');
  if (!existsSync(configPath)) return { ...DEFAULT_CONTEXT_PRESSURE_THRESHOLDS };
  try {
    const parsed = JSON.parse(await readFile(configPath, 'utf8'));
    return resolveContextPressureThresholds(parsed?.context_pressure ?? {});
  } catch (error) {
    if (error instanceof SyntaxError) {
      console.error(`[rstack] Ignoring malformed ${configPath} for context-pressure thresholds: ${error.message}. Defaults apply.`);
      return { ...DEFAULT_CONTEXT_PRESSURE_THRESHOLDS };
    }
    throw error;
  }
}
