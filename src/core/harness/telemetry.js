// owner: RStack developed by Richardson Gunde
//
// Builder-contract cost/context telemetry (#83, #135).
//
// The builder contract carries structured `cost`, `context`, and `execution`
// fields; until now they were optional decoration — tokens lived only inside
// cost_recorded events and were re-derived O(events) on every dashboard poll.
// This module is the shared extraction point: hosts (the Pi extension's
// sdlc_validate, or any framework) call extractBuilderTelemetry at validate
// time, append the pinned events from builderTelemetryEvents, and persist the
// totals incrementally via updateRunMetrics(runDir, telemetryMetricsUpdate(...)).
//
// Everything here is pure — no filesystem, no model calls. Invalid values are
// ignored here; the contract gate (validateBuilderContract's
// builder_v2_cost_values_are_numeric check) is what fails validation on
// non-numeric cost telemetry.

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function nonEmptyString(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

/**
 * Extract cost/context/execution telemetry from a builder contract.
 *
 * Returns { cost, tokens, tools_used_count, context } where every section is
 * null when the contract carries no usable data for it:
 * - cost: { estimated_usd, actual_usd, usd, currency } — `usd` is the
 *   effective spend (actual wins over estimate). Legacy contracts where
 *   `builder.cost` is a bare number are treated as actual spend.
 * - tokens: { input, output, total } from optional cost.input_tokens /
 *   cost.output_tokens / cost.total_tokens (cost.tokens accepted as total).
 * - tools_used_count: length of execution.tools_used (distinct tools, not
 *   call counts — execution.tool_calls stays the guardrail-budget signal).
 * - context: { profile, workflow, injected_source_count, tokens_used,
 *   tokens_available } — the token gauges are the context-pressure hook (#136).
 */
export function extractBuilderTelemetry(builder) {
  const telemetry = { cost: null, tokens: null, tools_used_count: null, context: null };
  if (!plainObject(builder)) return telemetry;

  const rawCost = builder.cost;
  if (typeof rawCost === 'number' && Number.isFinite(rawCost)) {
    // Legacy v1 shape: builder.cost is a bare USD number.
    telemetry.cost = { estimated_usd: null, actual_usd: rawCost, usd: rawCost, currency: 'USD' };
  } else if (plainObject(rawCost)) {
    const estimated = finiteNumber(rawCost.estimated_usd);
    const actual = finiteNumber(rawCost.actual_usd);
    if (estimated !== null || actual !== null) {
      telemetry.cost = {
        estimated_usd: estimated,
        actual_usd: actual,
        usd: actual ?? estimated,
        currency: nonEmptyString(rawCost.currency) ?? 'USD',
      };
    }
    const input = finiteNumber(rawCost.input_tokens);
    const output = finiteNumber(rawCost.output_tokens);
    const total = finiteNumber(rawCost.total_tokens) ?? finiteNumber(rawCost.tokens);
    if (input !== null || output !== null || total !== null) {
      telemetry.tokens = {
        input: input ?? 0,
        output: output ?? 0,
        total: total ?? (input ?? 0) + (output ?? 0),
      };
    }
  }

  if (Array.isArray(builder.execution?.tools_used)) {
    telemetry.tools_used_count = builder.execution.tools_used.length;
  }

  const rawContext = plainObject(builder.context);
  if (rawContext) {
    const profile = nonEmptyString(rawContext.profile);
    const workflow = nonEmptyString(rawContext.workflow);
    const injected = Array.isArray(rawContext.injected_sources)
      ? rawContext.injected_sources.length
      : finiteNumber(rawContext.injected_source_count);
    const tokensUsed = finiteNumber(rawContext.tokens_used);
    const tokensAvailable = finiteNumber(rawContext.tokens_available);
    if (profile !== null || workflow !== null || injected !== null || tokensUsed !== null || tokensAvailable !== null) {
      telemetry.context = {
        profile,
        workflow,
        injected_source_count: injected,
        tokens_used: tokensUsed,
        tokens_available: tokensAvailable,
      };
    }
  }

  return telemetry;
}

/**
 * Pinned event payloads for the extracted telemetry (contract style follows
 * retry_decision — downstream consumers key on these exact shapes; change
 * only with a schema migration):
 *
 * cost_recorded: { type, task_id, usd, cost (legacy alias), estimated_usd,
 *   actual_usd, currency, tokens, input_tokens, output_tokens, source }
 * context_recorded: { type, task_id, profile, workflow, injected_sources,
 *   tokens_used, tokens_available, source }
 *
 * Returns [] when the contract carried no cost and no context data.
 */
export function builderTelemetryEvents(taskId, telemetry) {
  const events = [];
  if (telemetry?.cost || telemetry?.tokens) {
    const usd = telemetry.cost?.usd ?? 0;
    events.push({
      type: 'cost_recorded',
      task_id: taskId ?? null,
      usd,
      cost: usd,
      estimated_usd: telemetry.cost?.estimated_usd ?? null,
      actual_usd: telemetry.cost?.actual_usd ?? null,
      currency: telemetry.cost?.currency ?? 'USD',
      tokens: telemetry.tokens?.total ?? 0,
      input_tokens: telemetry.tokens?.input ?? 0,
      output_tokens: telemetry.tokens?.output ?? 0,
      source: 'builder_contract',
    });
  }
  if (telemetry?.context) {
    events.push({
      type: 'context_recorded',
      task_id: taskId ?? null,
      profile: telemetry.context.profile,
      workflow: telemetry.context.workflow,
      injected_sources: telemetry.context.injected_source_count ?? 0,
      tokens_used: telemetry.context.tokens_used,
      tokens_available: telemetry.context.tokens_available,
      source: 'builder_contract',
    });
  }
  return events;
}

/**
 * updateRunMetrics payload for the extracted telemetry, or null when there is
 * nothing to persist. Cost and tokens land as an `increment` (added to the
 * running totals atomically in-lock); the per-stage share is split evenly
 * across the task's canonical stages, mirroring deriveStageElapsed's
 * multi-stage normalization so nothing is double-counted. Context token
 * gauges are point-in-time values, not counters, so they overwrite.
 */
export function telemetryMetricsUpdate(telemetry, stageIds = []) {
  const ids = (Array.isArray(stageIds) ? stageIds : []).filter((id) => typeof id === 'string' && id);
  const increment = {};

  const usd = telemetry?.cost?.usd ?? null;
  if (usd !== null) {
    increment.cost_usd = usd;
    if (ids.length > 0) {
      increment.stage_cost_usd = Object.fromEntries(ids.map((id) => [id, usd / ids.length]));
    }
  }

  if (telemetry?.tokens) {
    increment.tokens = telemetry.tokens;
    if (ids.length > 0) {
      const share = (value) => Math.round((Number(value) || 0) / ids.length);
      increment.stage_tokens = Object.fromEntries(ids.map((id) => [id, {
        input: share(telemetry.tokens.input),
        output: share(telemetry.tokens.output),
        total: share(telemetry.tokens.total),
      }]));
    }
  }

  const update = {};
  if (Object.keys(increment).length > 0) update.increment = increment;
  if (telemetry?.context?.tokens_used !== null && telemetry?.context?.tokens_used !== undefined) {
    update.context_tokens_used = telemetry.context.tokens_used;
  }
  if (telemetry?.context?.tokens_available !== null && telemetry?.context?.tokens_available !== undefined) {
    update.context_tokens_available = telemetry.context.tokens_available;
  }
  return Object.keys(update).length > 0 ? update : null;
}
