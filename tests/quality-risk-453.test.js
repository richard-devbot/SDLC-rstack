/**
 * Quality & Risk Index (#453) — Aggregated Risk Score + Complexity Index +
 * Cost-to-Value, computed server-side from a run's real artifacts + events,
 * with honest nulls when a source is absent.
 *
 * owner: RStack developed by Richardson Gunde
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeQualityRisk,
  buildQualityRiskProjection,
  normalizeRiskSeverity,
  isRiskMitigated,
  RISK_SEVERITY_WEIGHTS,
  GUARDRAIL_BLOCK_WEIGHT,
  VALIDATOR_BLOCK_WEIGHT,
} from '../src/observability/dashboard/state/quality-risk.js';

// --- severity + mitigation normalization -----------------------------------

test('normalizeRiskSeverity maps synonyms and defaults to medium', () => {
  assert.equal(normalizeRiskSeverity({ severity: 'Critical' }), 'critical');
  assert.equal(normalizeRiskSeverity({ level: 'error' }), 'high');
  assert.equal(normalizeRiskSeverity({ impact: 'minor' }), 'low');
  assert.equal(normalizeRiskSeverity({}), 'medium');
  assert.equal(normalizeRiskSeverity('a bare string risk'), 'medium');
});

test('isRiskMitigated: mitigated/resolved/has-mitigation true; accepted is NOT mitigated', () => {
  assert.equal(isRiskMitigated({ mitigated: true }), true);
  assert.equal(isRiskMitigated({ status: 'resolved' }), true);
  assert.equal(isRiskMitigated({ mitigation: 'added input validation' }), true);
  assert.equal(isRiskMitigated({ status: 'accepted' }), false, 'accepted = knowingly-retained residual, still risk');
  assert.equal(isRiskMitigated({}), false);
});

// --- Aggregated Risk Score --------------------------------------------------

test('risk score weights by severity and discounts mitigated risks', () => {
  const run = { tasks: [{ builder: { risks: [
    { severity: 'critical' },                         // 25
    { severity: 'high', mitigated: true },            // 12 * 0.25 = 3
    { severity: 'low' },                              // 2
  ] } }], events: [] };
  const qr = computeQualityRisk(run);
  assert.equal(qr.risk.score, Math.round(RISK_SEVERITY_WEIGHTS.critical + RISK_SEVERITY_WEIGHTS.high * 0.25 + RISK_SEVERITY_WEIGHTS.low));
  assert.deepEqual(qr.risk.by_severity, { critical: 1, high: 1, medium: 0, low: 1 });
  assert.equal(qr.risk.mitigated, 1);
  assert.equal(qr.risk.band, 'elevated');
});

test('guardrail + validator blocks raise the risk score and are counted', () => {
  const run = { tasks: [{ builder: { risks: [] } }], events: [
    { type: 'guardrail_triggered' },
    { type: 'guardrail_overridden' },
    { type: 'task_blocked_by_validator' },
  ] };
  const qr = computeQualityRisk(run);
  assert.equal(qr.risk.guardrail_blocks, 1);
  assert.equal(qr.risk.accepted_overrides, 1);
  assert.equal(qr.risk.validator_blocks, 1);
  assert.ok(qr.risk.score >= GUARDRAIL_BLOCK_WEIGHT + VALIDATOR_BLOCK_WEIGHT);
});

test('risk score is capped at 100', () => {
  const risks = Array.from({ length: 20 }, () => ({ severity: 'critical' }));
  const qr = computeQualityRisk({ tasks: [{ builder: { risks } }], events: [] });
  assert.equal(qr.risk.score, 100);
  assert.equal(qr.risk.band, 'critical');
});

test('risk is a real 0 when a builder contract exists but nothing is flagged', () => {
  const qr = computeQualityRisk({ tasks: [{ builder: { risks: [] } }], events: [] });
  assert.equal(qr.risk.score, 0);
  assert.equal(qr.risk.band, 'low');
});

test('risk is UNKNOWN (null) when there is no risk-bearing source at all', () => {
  const qr = computeQualityRisk({ tasks: [{ id: 't', status: 'READY' }], events: [] });
  assert.equal(qr.risk.score, null);
  assert.equal(qr.risk.band, 'unknown');
});

// --- Complexity Index -------------------------------------------------------

test('complexity index rolls files touched, builder tasks, and executions', () => {
  const run = {
    tasks: [
      { builder: { files_modified: ['a.js', 'b.js', 'a.js'] } }, // 2 unique
      { builder: { files_modified: ['c.js'] } },
    ],
    events: [{ type: 'execution_recorded', tier: 'docker', status: 'PASS' }],
  };
  const qr = computeQualityRisk(run);
  assert.equal(qr.complexity.files_touched, 3);
  assert.equal(qr.complexity.builder_tasks, 2);
  assert.equal(qr.complexity.executions, 1);
  assert.ok(qr.complexity.score > 0 && qr.complexity.score <= 100);
});

test('complexity is UNKNOWN when there is no structural signal', () => {
  const qr = computeQualityRisk({ tasks: [{ id: 't' }], events: [] });
  assert.equal(qr.complexity.score, null);
  assert.equal(qr.complexity.band, 'unknown');
});

// --- execution posture + cost-to-value --------------------------------------

test('execution posture summarizes container-verified vs unverified runs', () => {
  const run = { tasks: [{ builder: { risks: [] } }], events: [
    { type: 'execution_recorded', tier: 'docker', status: 'PASS' },
    { type: 'execution_recorded', tier: 'docker', status: 'FAIL' },
    { type: 'execution_recorded', tier: 'unverified', status: 'observed' },
  ] };
  const ex = computeQualityRisk(run).execution;
  assert.equal(ex.total, 3);
  assert.equal(ex.verified, 2);
  assert.equal(ex.passed, 1);
  assert.equal(ex.failed, 1);
  assert.equal(ex.unverified, 1);
});

test('cost_to_value pairs cost against coverage; null coverage → null ratio, no /0', () => {
  const run = { tasks: [{ builder: { risks: [] } }], events: [] };
  const withCov = computeQualityRisk(run, { coveragePercent: 80, costUsd: 4 });
  assert.equal(withCov.cost_to_value.cost_usd, 4);
  assert.equal(withCov.cost_to_value.cost_per_coverage_point, 0.05);
  const zeroCov = computeQualityRisk(run, { coveragePercent: 0, costUsd: 4 });
  assert.equal(zeroCov.cost_to_value.cost_per_coverage_point, null, 'never divide by zero coverage');
  const noCost = computeQualityRisk(run, { coveragePercent: 80 });
  assert.equal(noCost.cost_to_value, null, 'no cost telemetry → no cost-to-value');
});

// --- projection wiring ------------------------------------------------------

test('buildQualityRiskProjection: null focus run → honest nulls', () => {
  const proj = buildQualityRiskProjection({ runs: [] });
  assert.equal(proj.focusRunId, null);
  assert.equal(proj.risk, null);
  assert.equal(proj.complexity, null);
});

test('buildQualityRiskProjection: picks focus run, pulls coverage from readiness + cost from rollup', () => {
  const state = {
    runs: [{
      runId: 'r1',
      derivedStatus: 'active',
      tasks: [{ builder: { risks: [{ severity: 'high' }], files_modified: ['x.js'] } }],
      events: [],
      pipelineRollup: { stages: [{ cost_usd: 1.5 }, { cost_usd: 0.5 }] },
    }],
    readiness: { coverage: { percent: 50 } },
  };
  const proj = buildQualityRiskProjection(state, { evaluatedAt: 'now' });
  assert.equal(proj.focusRunId, 'r1');
  assert.equal(proj.risk.by_severity.high, 1);
  assert.equal(proj.cost_to_value.cost_usd, 2);       // 1.5 + 0.5
  assert.equal(proj.cost_to_value.coverage_percent, 50);
  assert.equal(proj.evaluatedAt, 'now');
});
