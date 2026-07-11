/**
 * Money pages (#92 + #215 tokens/budget/benchmark slices) — Run Analytics
 * token/stage-cost/benchmark panels, the Cost & Budget governance view, the
 * Compliance scorecard, and the client-state provenance/budget fields.
 *
 * The page modules ship as strings of browser JS. Pure HTML builders are
 * evaluated in a sandbox (the dashboard-artifact-render pattern); DOM-touching
 * renderers run against a minimal fake document so empty states are asserted
 * end to end without a browser.
 *
 * owner: RStack developed by Richardson Gunde
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { libScript } from '../src/observability/dashboard/ui/lib.js';
import { runAnalyticsScript } from '../src/observability/dashboard/ui/pages/run-analytics.js';
import { costBudgetScript } from '../src/observability/dashboard/ui/pages/cost-budget.js';
import { complianceScript } from '../src/observability/dashboard/ui/pages/compliance.js';
import { toClientState, readLoopBudgetCaps } from '../src/observability/dashboard/state/client-state.js';

// ── sandbox ──────────────────────────────────────────────────────────────────

function fakeDom() {
  const els = new Map();
  const makeEl = (id) => ({
    id,
    innerHTML: '',
    textContent: '',
    className: '',
    style: {},
    setAttribute() {},
    appendChild() {},
    insertBefore() {},
    querySelector: () => null,
    classList: { toggle() {}, contains: () => false, add() {}, remove() {} },
  });
  const document = {
    getElementById(id) {
      if (!els.has(id)) els.set(id, makeEl(id));
      return els.get(id);
    },
    createElement: () => makeEl(''),
    querySelectorAll: () => [],
    addEventListener() {},
  };
  return { document, els };
}

function sandbox(document, prelude = '') {
  return new Function(
    'document',
    'var STATE = null;\n' + prelude + '\n' +
    libScript + runAnalyticsScript + costBudgetScript + complianceScript + `
    return {
      fmtTokensCompact, moneySourcePill, analyticsKpisHtml, stageMoneyHtml,
      benchmarkPanelHtml, costSummaryHtml, configuredBudgetPolicyHtml, budgetGovernanceHtml, costRunRowsHtml,
      stageCostAcrossRunsHtml, complianceReportModel, complianceScorecardHtml,
      complianceControlsHtml, renderCostBudget, renderCompliance,
      seedBenchCache: function(runId, entry) { BENCH_CACHE[runId] = entry; },
      setState: function(s) { STATE = s; },
      renderRunAnalytics: renderRunAnalytics,
    };`,
  )(document);
}

// ── fixtures (mirror .rstack/runs/2026-07-06T12-00-00-000Z-ui-fixture-july-signals) ──

const FIXTURE_RUN_ID = '2026-07-06T12-00-00-000Z-ui-fixture-july-signals';

function fixtureRun(overrides = {}) {
  return {
    runId: FIXTURE_RUN_ID,
    projectRoot: '/tmp/fixture-project',
    manifest: { goal: 'UI fixture: exercise every July harness signal', created_at: '2026-07-06T12:00:00.000Z' },
    metrics: {
      cumulative_cost_usd: 4.87,
      cumulative_tokens: { input: 1420000, output: 312000, total: 1732000 },
      stage_cost_usd: { '06-architecture': 1.12, '07-code': 2.65, '08-testing': 1.1 },
      stage_tokens: {
        '06-architecture': { input: 380000, output: 71000, total: 451000 },
        '07-code': { input: 720000, output: 168000, total: 888000 },
        '08-testing': { input: 320000, output: 73000, total: 393000 },
      },
    },
    totals: { duration_ms: 2340000, tool_calls: 212, cost_usd: 4.87, tokens: 1732000, tasks_passed: 1, tasks_failed: 0, guardrails: 1, quality_avg: null },
    events: [{ type: 'task_validated', task_id: '003-architecture', status: 'PASS', ts: '2026-07-06T12:10:00.000Z' }],
    evidence: [],
    tasks: [],
    stageReports: [],
    timeline: [],
    ...overrides,
  };
}

const BENCH_FIXTURE = {
  schema_version: 1,
  mode: 'mock',
  seq_time_ms: 2250,
  par_time_ms: 900,
  improvement: 0.6,
  target: 0.4,
  gate: 'enabled-recommended',
  group: ['12-security-threat-model', '13-compliance-checker', '14-cost-estimation'],
  measurement: 'synthetic sleep workload — modelled, not live agents',
};

function clientRun(run = fixtureRun()) {
  return toClientState({ runs: [run] }).runs[0];
}

function configuredBudgetState(overrides = {}) {
  return {
    runs: [],
    businessFlex: {
      configuredPolicy: {
        projects: [{
          projectId: 'project-flex', projectRoot: '/tmp/fixture-project', projectName: 'fixture-project',
          availability: 'configured',
          budget: {
            availability: 'configured', currency: 'USD', runBudgetUsd: 10,
            dailyBudgetUsd: 50, monthlyBudgetUsd: 500,
            sourcePath: '.rstack/budget.json', issues: [],
          },
        }],
      },
      observedConsumption: {
        availability: 'unavailable', runCount: 0, runsWithTelemetry: 0,
        totalCostUsd: null, metricsSources: { persisted: 0, events: 0 }, lastMeasuredAt: null,
      },
      runSnapshots: [], profiles: [], budget: {}, routingSignals: [],
    },
    ...overrides,
  };
}

// ── client-state provenance + budget fields ─────────────────────────────────

test('toClientState marks persisted metrics and exposes the token breakdown', () => {
  const run = clientRun();
  assert.deepEqual(run.tokenTotals, { input: 1420000, output: 312000, total: 1732000 });
  assert.equal(run.metricsSource, 'persisted');
  assert.deepEqual(run.stageCost, { '06-architecture': 1.12, '07-code': 2.65, '08-testing': 1.1 });
  assert.equal(run.stageTokens['07-code'].total, 888000);
});

test('metrics_write_failed drift downgrades provenance to event recompute', () => {
  const drifted = fixtureRun({
    events: [{ type: 'metrics_write_failed', ts: '2026-07-06T12:20:00.000Z' }],
  });
  assert.equal(clientRun(drifted).metricsSource, 'events');
});

test('a run with no telemetry and no events is honestly source "none"', () => {
  const bare = fixtureRun({ metrics: {}, totals: null, events: [] });
  const run = clientRun(bare);
  assert.equal(run.tokenTotals, null);
  assert.equal(run.metricsSource, 'none');
});

test('readLoopBudgetCaps mirrors the goal-loop budget file exactly', () => {
  const root = mkdtempSync(join(tmpdir(), 'rstack-money-budget-'));
  mkdirSync(join(root, '.rstack'), { recursive: true });
  writeFileSync(join(root, '.rstack', 'budget.json'), JSON.stringify({ run_budget_usd: 10, daily_budget_usd: 40 }));
  const caps = readLoopBudgetCaps([root]);
  assert.deepEqual(caps, [{ root, run_budget_usd: 10, daily_budget_usd: 40, monthly_budget_usd: null }]);

  // Negative / non-numeric caps never arm the brake (matches evaluateLoopBudget).
  const badRoot = mkdtempSync(join(tmpdir(), 'rstack-money-budget-bad-'));
  mkdirSync(join(badRoot, '.rstack'), { recursive: true });
  writeFileSync(join(badRoot, '.rstack', 'budget.json'), JSON.stringify({ run_budget_usd: -5 }));
  assert.deepEqual(readLoopBudgetCaps([badRoot]), []);

  // Unreadable budget.json = no cap, never a crash.
  const corruptRoot = mkdtempSync(join(tmpdir(), 'rstack-money-budget-corrupt-'));
  mkdirSync(join(corruptRoot, '.rstack'), { recursive: true });
  writeFileSync(join(corruptRoot, '.rstack', 'budget.json'), '{ not json');
  assert.deepEqual(readLoopBudgetCaps([corruptRoot]), []);

  rmSync(root, { recursive: true, force: true });
  rmSync(badRoot, { recursive: true, force: true });
  rmSync(corruptRoot, { recursive: true, force: true });
});

test('toClientState wires loop budgets from configured policy without rereading files', () => {
  const root = mkdtempSync(join(tmpdir(), 'rstack-money-wire-'));
  const state = toClientState({
    sourceRoots: [root],
    runs: [fixtureRun({ projectRoot: root })],
    businessFlex: {
      configuredPolicy: {
        projects: [{
          projectRoot: root,
          budget: {
            availability: 'configured',
            currency: 'USD',
            runBudgetUsd: 10,
            dailyBudgetUsd: 50,
            monthlyBudgetUsd: 500,
            sourcePath: '.rstack/budget.json',
            issues: [],
          },
        }],
      },
      profiles: [], budget: {}, routingSignals: [],
    },
  });
  assert.equal(state.runs[0].loopBudgetUsd, 10);
  assert.deepEqual(state.loopBudgets, [{
    root,
    run_budget_usd: 10,
    daily_budget_usd: 50,
    monthly_budget_usd: 500,
  }]);

  const invalid = toClientState({
    runs: [fixtureRun({ projectRoot: root })],
    businessFlex: {
      configuredPolicy: { projects: [{
        projectRoot: root,
        budget: { availability: 'invalid', runBudgetUsd: null },
      }] },
    },
  });
  assert.equal(invalid.runs[0].loopBudgetUsd, null);

  const zero = toClientState({
    runs: [fixtureRun({ projectRoot: root })],
    businessFlex: {
      configuredPolicy: { projects: [{
        projectRoot: root,
        budget: { availability: 'configured', runBudgetUsd: 0, dailyBudgetUsd: 0, monthlyBudgetUsd: 0 },
      }] },
    },
  });
  assert.equal(zero.runs[0].loopBudgetUsd, 0);

  // A run with no configured policy record carries null — no invented cap.
  const capless = toClientState({ runs: [fixtureRun()] });
  assert.equal(capless.runs[0].loopBudgetUsd, null);
  rmSync(root, { recursive: true, force: true });
});

// ── Run Analytics builders ───────────────────────────────────────────────────

test('token formatting compacts real magnitudes', () => {
  const api = sandbox(fakeDom().document);
  assert.equal(api.fmtTokensCompact(1732000), '1.73M');
  assert.equal(api.fmtTokensCompact(451000), '451k');
  assert.equal(api.fmtTokensCompact(999), '999');
  assert.equal(api.fmtTokensCompact(2000000000), '2B');
});

test('analytics KPIs render fixture tokens + cost with provenance', () => {
  const api = sandbox(fakeDom().document);
  const html = api.analyticsKpisHtml(clientRun());
  assert.match(html, /1\.73M/, 'headline token total');
  assert.match(html, /1\.42M in \/ 312k out/, 'input/output breakdown');
  assert.match(html, /\$4\.8700/, 'run cost');
  assert.match(html, /persisted metrics/, 'provenance pill');
});

test('analytics KPIs never fake $0.00 when there is no telemetry', () => {
  const api = sandbox(fakeDom().document);
  const html = api.analyticsKpisHtml(clientRun(fixtureRun({ metrics: {}, totals: null, events: [] })));
  assert.doesNotMatch(html, /\$0\.0000/);
  assert.match(html, /no cost telemetry yet/);
  assert.match(html, /appears when builder contracts report cost/);
});

test('per-stage money bars render all three fixture stages', () => {
  const api = sandbox(fakeDom().document);
  const html = api.stageMoneyHtml(clientRun());
  for (const [stage, cost, tok] of [['06-architecture', '\\$1\\.12', '451k'], ['07-code', '\\$2\\.65', '888k'], ['08-testing', '\\$1\\.10', '393k']]) {
    assert.match(html, new RegExp(stage));
    assert.match(html, new RegExp(cost + ' · ' + tok + ' tok'));
  }
});

test('per-stage money bars explain themselves when telemetry is absent', () => {
  const api = sandbox(fakeDom().document);
  assert.match(api.stageMoneyHtml({ stageCost: {}, stageTokens: {} }), /No per-stage cost telemetry yet/);
});

test('benchmark panel renders SEQ vs PAR with the honest mock badge', () => {
  const api = sandbox(fakeDom().document);
  const html = api.benchmarkPanelHtml({ state: 'ok', data: BENCH_FIXTURE });
  assert.match(html, /Sequential/);
  assert.match(html, /Parallel/);
  assert.match(html, /60% faster — clears the 40% gate/);
  assert.match(html, /modelled — mock workload/, 'mock mode must never look measured');
  assert.match(html, /synthetic sleep workload/);
  assert.match(html, /13-compliance-checker/, 'stage group chips');
});

test('benchmark panel: real mode badge, missing artifact, junk numbers', () => {
  const api = sandbox(fakeDom().document);
  assert.match(api.benchmarkPanelHtml({ state: 'ok', data: { ...BENCH_FIXTURE, mode: 'real' } }), /measured — real stages/);
  assert.match(api.benchmarkPanelHtml({ state: 'missing' }), /No parallel benchmark for this run/);
  assert.match(api.benchmarkPanelHtml({ state: 'ok', data: { mode: 'mock', seq_time_ms: 'fast' } }), /Benchmark artifact incomplete/);
  const belowGate = api.benchmarkPanelHtml({ state: 'ok', data: { ...BENCH_FIXTURE, improvement: 0.2, gate: 'disabled' } });
  assert.match(belowGate, /20% faster — below the 40% gate/);
  assert.match(belowGate, /parallel execution stays disabled/i);
});

// ── Cost & Budget builders ───────────────────────────────────────────────────

test('cost summary shows fixture spend, tokens and provenance counts', () => {
  const api = sandbox(fakeDom().document);
  const html = api.costSummaryHtml({ runs: [clientRun()] });
  assert.match(html, /\$4\.87/);
  assert.match(html, /1\.73M/);
  assert.match(html, /1 run\(s\) from persisted metrics\.json totals/);
});

test('cost summary refuses to render $0.00 as real data', () => {
  const api = sandbox(fakeDom().document);
  const html = api.costSummaryHtml({ runs: [clientRun(fixtureRun({ metrics: {}, totals: null, events: [] }))] });
  assert.match(html, /No cost telemetry recorded yet/);
  assert.doesNotMatch(html, /proof-value/, 'no numeric value cells rendered at all');
  assert.match(api.costSummaryHtml({ runs: [] }), /No runs in scope/);
});

test('budget governance bar: under, near, and over the enforced cap', () => {
  const api = sandbox(fakeDom().document);
  const under = api.budgetGovernanceHtml({ runs: [{ ...clientRun(), loopBudgetUsd: 10 }] });
  assert.match(under, /\$4\.87/);
  assert.match(under, /of \$10\.00/);
  assert.match(under, /49% of cap used — \$5\.13 headroom/);
  assert.match(under, /enforced in code/, 'governance copy states the loop stops on this cap');
  assert.match(under, /before every iteration/);

  const over = api.budgetGovernanceHtml({
    runs: [{ ...clientRun(), loopBudgetUsd: 4, totals: { cost_usd: 4.87 }, tokenTotals: { input: 1, output: 1, total: 2 } }],
  });
  assert.match(over, /cap reached — the loop will not start another iteration/);
  assert.match(over, /budget-fill over/);

  const near = api.budgetGovernanceHtml({ runs: [{ ...clientRun(), loopBudgetUsd: 5.5 }] });
  assert.match(near, /budget-fill near/);
});

test('configured budget policy renders 10/50/500 before the first run without inventing spend', () => {
  const { document, els } = fakeDom();
  const api = sandbox(document);
  const state = configuredBudgetState();
  const html = api.configuredBudgetPolicyHtml(state);
  assert.match(html, /Current enforced policy/);
  assert.match(html, /\$10\.00 \/ run/);
  assert.match(html, /\$50\.00 \/ day/);
  assert.match(html, /\$500\.00 \/ month/);
  assert.match(html, /fixture-project/);
  assert.match(html, /\.rstack\/budget\.json/);
  assert.match(html, /No telemetry yet/);
  assert.doesNotMatch(html, /No run budget cap configured/);
  assert.match(api.budgetGovernanceHtml(state), /No telemetry yet/);
  api.renderCostBudget(state);
  assert.equal(els.get('cost-budget-governance-note').textContent, '1 current run cap · no run telemetry');
});

test('configured budget policy reserves no-cap copy for a valid file and recovers from invalid policy', () => {
  const api = sandbox(fakeDom().document);
  const state = configuredBudgetState();
  state.businessFlex.configuredPolicy.projects[0].budget.runBudgetUsd = null;
  assert.match(api.configuredBudgetPolicyHtml(state), /No run cap configured/);

  state.businessFlex.configuredPolicy.projects[0].availability = 'invalid';
  state.businessFlex.configuredPolicy.projects[0].budget = {
    availability: 'invalid', runBudgetUsd: null, dailyBudgetUsd: null, monthlyBudgetUsd: null,
    sourcePath: '.rstack/budget.json', issues: [{ field: 'run_budget_usd', problem: 'must be non-negative' }],
  };
  const invalid = api.configuredBudgetPolicyHtml(state);
  assert.match(invalid, /Invalid configuration/);
  assert.match(invalid, /run_budget_usd/);
  assert.match(invalid, /Open Diagnostics/);
  assert.doesNotMatch(invalid, /\$0\.00/);
});

test('per-run cost table carries provenance pills and honest dashes', () => {
  const api = sandbox(fakeDom().document);
  const html = api.costRunRowsHtml([clientRun(), clientRun(fixtureRun({ runId: 'bare-run', metrics: {}, totals: null, events: [] }))]);
  assert.match(html, /persisted metrics/);
  assert.match(html, /no telemetry/);
  assert.match(html, /\$4\.8700/);
  assert.match(html, /1\.73M/);
});

test('spend-by-stage aggregates stage cost across runs in scope', () => {
  const api = sandbox(fakeDom().document);
  const html = api.stageCostAcrossRunsHtml([clientRun(), clientRun(fixtureRun({ runId: 'second' }))]);
  assert.match(html, /07-code/);
  assert.match(html, /\$5\.30/, 'two fixture runs double 07-code spend');
  assert.match(api.stageCostAcrossRunsHtml([]), /No per-stage cost telemetry yet/);
});

test('renderCostBudget paints all panels from fixture-shaped state', () => {
  const { document, els } = fakeDom();
  const api = sandbox(document);
  const state = toClientState({ runs: [fixtureRun()] });
  state.runs[0].loopBudgetUsd = 10; // as if budget.json carried the cap
  api.renderCostBudget(state);
  assert.match(els.get('cost-budget-summary').innerHTML, /\$4\.87/);
  assert.match(els.get('cost-budget-governance').innerHTML, /49% of cap used/);
  assert.match(els.get('cost-budget-runs-table').innerHTML, /1\.73M/);
  assert.match(els.get('cost-budget-stages').innerHTML, /07-code/);
  assert.equal(els.get('cost-budget-count').textContent, '1 runs in scope');
});

// ── Compliance builders ──────────────────────────────────────────────────────

const AGENT_SHAPE_REPORT = {
  applicable_frameworks: ['HIPAA', 'GDPR'],
  compliance_requirements: [
    { id: 'HIPAA-01', framework: 'HIPAA', requirement: 'Audit logging of PHI access', status: 'PASS', risk_level: 'NONE' },
    { id: 'HIPAA-02', framework: 'HIPAA', requirement: 'Encryption at rest', status: 'FAIL', risk_level: 'CRITICAL', gap_description: 'Unencrypted backup bucket', remediation: { action: 'Enable SSE on backups' } },
    { id: 'GDPR-01', framework: 'GDPR', requirement: 'Right to erasure', status: 'PARTIAL', risk_level: 'HIGH', gap_description: 'No deletion endpoint' },
  ],
  framework_scores: [
    { framework: 'HIPAA', total_requirements: 2, pass_count: 1, partial_count: 0, fail_count: 1, compliance_percentage: 50, status: 'PARTIALLY_COMPLIANT' },
    { framework: 'GDPR', total_requirements: 1, pass_count: 0, partial_count: 1, fail_count: 0, compliance_percentage: 0, status: 'NON_COMPLIANT' },
  ],
  overall_compliance: { score_percentage: 33.3, status: 'PARTIALLY_COMPLIANT', critical_gaps: 1, high_gaps: 1, medium_gaps: 0, low_gaps: 0 },
};

test('compliance model normalizes the stage-13 agent contract shape', () => {
  const api = sandbox(fakeDom().document);
  const model = api.complianceReportModel(AGENT_SHAPE_REPORT);
  assert.equal(model.score, 33);
  assert.equal(model.frameworks.length, 2);
  assert.equal(model.frameworks[0].pct, 50);
  assert.deepEqual(model.gaps, { CRITICAL: 1, HIGH: 1, MEDIUM: 0, LOW: 0 });
});

test('compliance model tolerates the compact controls/overall_score shape', () => {
  const api = sandbox(fakeDom().document);
  const model = api.complianceReportModel({
    overall_score: 63,
    release_gate: { ready: false, blockers: ['SOC2-CC6.1'] },
    controls: [
      { id: 'SOC2-CC6.1', status: 'FAIL', severity: 'HIGH', required_action: 'Add access reviews' },
      { id: 'SOC2-CC7.2', status: 'PASS' },
    ],
  });
  assert.equal(model.score, 63);
  assert.equal(model.frameworks.length, 1, 'framework derived from controls');
  assert.equal(model.frameworks[0].pass, 1);
  assert.equal(model.gaps.HIGH, 1);
  assert.equal(model.releaseGate.ready, false);
  assert.equal(api.complianceReportModel(null), null);
  assert.equal(api.complianceReportModel({ _truncated: true, _bytes: 999999 }), null, 'truncated artifact is not pretended parsed');
});

test('compliance scorecard renders framework rows, gap chips and the gate', () => {
  const api = sandbox(fakeDom().document);
  const model = api.complianceReportModel(AGENT_SHAPE_REPORT);
  const html = api.complianceScorecardHtml(model, FIXTURE_RUN_ID);
  assert.match(html, /Overall compliance/);
  assert.match(html, /33%/);
  assert.match(html, /HIPAA/);
  assert.match(html, /1 pass · 0 partial · 1 gap of 2 controls/);
  assert.match(html, /1 critical gap/);
  assert.match(html, /1 high gap/);
  assert.match(api.complianceScorecardHtml(null, 'x'), /Compliance report unreadable/);
});

test('compliance controls list is severity-first with gaps and fixes', () => {
  const api = sandbox(fakeDom().document);
  const model = api.complianceReportModel(AGENT_SHAPE_REPORT);
  const html = api.complianceControlsHtml(model);
  assert.match(html, /2 of 3 controls need action/);
  assert.ok(html.indexOf('HIPAA-02') < html.indexOf('GDPR-01'), 'CRITICAL sorts before HIGH');
  assert.match(html, /Gap: Unencrypted backup bucket/);
  assert.match(html, /Fix: Enable SSE on backups/);
  const allPass = api.complianceControlsHtml(api.complianceReportModel({ controls: [{ id: 'A', status: 'PASS' }] }));
  assert.match(allPass, /All 1 controls pass/);
});

test('compliance page renders the honest empty state when stage 13 never ran', async () => {
  const { document, els } = fakeDom();
  const api = sandbox(document);
  // Fixture has no stage-13 report; the probe fetch fails in this sandbox
  // (no server), which the page treats as "no report" — the honest path.
  await api.renderCompliance({ runs: [fixtureRun()] });
  assert.match(els.get('compliance-scorecards').innerHTML, /Compliance stage has not run in this scope/);
  assert.match(els.get('compliance-scorecards').innerHTML, /compliance_report\.json/);
  assert.match(els.get('compliance-controls').innerHTML, /render here from compliance_report\.json/);
  assert.equal(els.get('compliance-score-count').textContent, '0 run(s) with a compliance report');
});

test('compliance page probes run reports even when the index served stageReports empty', async () => {
  const { document, els } = fakeDom();
  const api = sandbox(document, `var fetchRunReport = function(runId) {
    return Promise.resolve({ stages: { '13-compliance-checker': ${JSON.stringify(AGENT_SHAPE_REPORT)} } });
  };`);
  // Run arrives index-served: stageReports is [] although the report exists.
  await api.renderCompliance({ runs: [fixtureRun({ stageReports: [] })] });
  assert.match(els.get('compliance-scorecards').innerHTML, /HIPAA/);
  assert.match(els.get('compliance-scorecards').innerHTML, /33%/);
  assert.match(els.get('compliance-controls').innerHTML, /2 of 3 controls need action/);
  assert.equal(els.get('compliance-score-count').textContent, '1 run(s) with a compliance report');
});

// ── Run Analytics end-to-end against the fake DOM ────────────────────────────

test('renderRunAnalytics paints KPIs, stage money and a seeded benchmark', () => {
  const { document, els } = fakeDom();
  const api = sandbox(document);
  const state = toClientState({ runs: [fixtureRun()] });
  api.seedBenchCache(FIXTURE_RUN_ID, { state: 'ok', data: BENCH_FIXTURE });
  api.setState(state);
  api.renderRunAnalytics(state);
  assert.match(els.get('analytics-kpis').innerHTML, /1\.73M/);
  assert.match(els.get('analytics-kpis').innerHTML, /\$4\.8700/);
  assert.match(els.get('analytics-stage-money').innerHTML, /06-architecture/);
  assert.match(els.get('analytics-benchmark').innerHTML, /modelled — mock workload/);
  assert.equal(els.get('analytics-money-note').textContent, '3 stages with cost data');
});
