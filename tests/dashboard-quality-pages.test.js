/**
 * Quality-wave page tests (#90 #91 #97 #215): the Requirements & Traceability
 * registry, the Security threat registry, the Stephens report cards (cutover,
 * defect analysis, maintenance taxonomy) and the dark-stage surfacing.
 *
 * The page modules are plain client JS strings concatenated into the served
 * bundle, so these tests evaluate the real modules against a minimal DOM stub
 * and assert on what each renderer writes into its containers — fixture-shaped
 * artifacts in, rendered panels (and honest empty states) out.
 *
 * owner: RStack developed by Richardson Gunde
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { stageMetaScript } from '../src/observability/dashboard/ui/stage-meta.js';
import { libScript } from '../src/observability/dashboard/ui/lib.js';
import { runReportScript } from '../src/observability/dashboard/ui/pages/run-report.js';
import { securityScript } from '../src/observability/dashboard/ui/pages/security.js';
import { traceabilityScript } from '../src/observability/dashboard/ui/pages/traceability.js';
import { projectsRunsScript } from '../src/observability/dashboard/ui/pages/projects-runs.js';
import { clientScript } from '../src/observability/dashboard/ui/client.js';
import {
  collectStageReports,
  stageReportIndex,
  resolveStageArtifactPath,
} from '../src/observability/dashboard/state/stage-reports.js';

// ── client-module harness: evaluate the real page scripts against a DOM stub ──

function makeElement(id) {
  return {
    id,
    innerHTML: '',
    textContent: '',
    className: '',
    value: '',
    style: {},
    setAttribute() {},
    getAttribute() { return null; },
    removeAttribute() {},
    appendChild() {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    querySelectorAll() { return []; },
  };
}

function loadPages({ report } = {}) {
  const elements = new Map();
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, makeElement(id));
      return elements.get(id);
    },
    querySelectorAll() { return []; },
    createElement: () => makeElement(''),
    addEventListener() {},
  };
  const fetchCalls = [];
  const fetchFn = (url) => {
    fetchCalls.push(url);
    return Promise.resolve({
      status: 200,
      json: () => Promise.resolve(report ?? { stages: {}, deliverables: {} }),
    });
  };
  const sessionStorage = { getItem: () => '', setItem() {} };
  const source = [stageMetaScript, libScript, runReportScript, securityScript, traceabilityScript, projectsRunsScript].join('\n');
  const factory = new Function(
    'document', 'window', 'sessionStorage', 'fetch', 'requestAnimationFrame',
    `var STATE = null;\n${source}\nreturn { renderers: PAGE_RENDERERS, stageBody: stageBody, setState: function(s) { STATE = s; } };`,
  );
  const api = factory(document, {}, sessionStorage, fetchFn, () => {});
  const render = (id, state) => {
    api.setState(state);
    api.renderers.find((r) => r.id === id).render(state);
  };
  const html = (id) => (elements.get(id) ? elements.get(id).innerHTML : '');
  return { ...api, render, html, elements, fetchCalls };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

// ── #215 Stephens slice: cutover, defect analysis, maintenance taxonomy ──

test('run-report 09-deployment card renders the cutover block (strategy, rationale, point of no return)', () => {
  const { stageBody } = loadPages();
  const body = stageBody('09-deployment', {
    status: 'PASS',
    cutover: {
      strategy: 'staged',
      options_considered: ['staged', 'gradual', 'big-bang'],
      rationale: 'Staging environment exists; rehearse there, then production.',
      point_of_no_return: 'none — rollback tested at every step',
    },
  });
  assert.match(body, /Cutover strategy/);
  assert.match(body, /staged/);
  assert.match(body, /rehearse there/);
  assert.match(body, /Point of no return/);
  assert.match(body, /big-bang/);
});

test('run-report 09-deployment card is honest when no cutover block was written', () => {
  const { stageBody } = loadPages();
  const body = stageBody('09-deployment', { status: 'PASS' });
  assert.match(body, /No cutover strategy recorded/);
  assert.match(body, /stage 09/);
});

test('run-report 10-summary card renders defect analysis by Ishikawa cause bucket, nulls as not-yet-measured', () => {
  const { stageBody } = loadPages();
  const body = stageBody('10-summary', {
    open_risks: [],
    defect_analysis: {
      defects: [{ task_id: 't1', cause_bucket: 'process' }, { task_id: 't2', cause_bucket: 'tools' }],
      totals: { by_cause_bucket: { process: 1, tools: 1 } },
      retry_rollup: { scheduled: 1, exhausted: 0, human_required: 0 },
      metrics: [
        { name: 'defect_count', value: 2, scope: 'project' },
        { name: 'cost_usd', value: null, scope: 'project', reason: 'not fabricating' },
      ],
    },
  });
  assert.match(body, /Defect analysis \(Ishikawa cause buckets\)/);
  for (const bucket of ['people', 'process', 'tools', 'requirements']) assert.match(body, new RegExp(bucket));
  assert.match(body, /Defects recorded/);
  assert.match(body, /1 scheduled \/ 0 exhausted \/ 0 human/);
  assert.match(body, /cost_usd/);
  assert.match(body, /not yet measured/);
});

test('run-report 10-summary card is honest when defect analysis is missing', () => {
  const { stageBody } = loadPages();
  const body = stageBody('10-summary', { open_risks: [] });
  assert.match(body, /Defect analysis not recorded/);
  assert.match(body, /stage 10/);
});

test('run-report 11-feedback-loop card renders the maintenance taxonomy and goal criteria from fixture-shaped feedback.json', () => {
  const { stageBody } = loadPages();
  // Shape of the local fixture run's feedback.json plus a contract-shaped issue.
  const body = stageBody('11-feedback-loop', {
    status: 'PASS',
    consistency_score: 88,
    goal_evaluation: {
      iteration: 1,
      results: [
        { criterion_id: 'tests-pass', result: 'met', evidence: ['tasks/004-implementation/builder.json'] },
        { criterion_id: 'design-reviewed', result: 'unknown', evidence: [] },
      ],
    },
    remediation: [{ id: 'R1', maintenance_category: 'corrective', description: 'Fix failing 08-testing suite' }],
    issues: [{ id: 'FBK-001', severity: 'WARNING', title: 'Docs drift', remediation: { maintenance_category: 'perfective' } }],
  });
  assert.match(body, /Maintenance taxonomy \(2 remediations\)/);
  assert.match(body, /corrective/);
  assert.match(body, /perfective/);
  assert.match(body, /Goal criteria met/);
  assert.match(body, /1\/2/);
  assert.match(body, /Docs drift/);
});

test('run-report 11-feedback-loop card is honest when remediations carry no category', () => {
  const { stageBody } = loadPages();
  const body = stageBody('11-feedback-loop', { consistency_score: 90 });
  assert.match(body, /No categorized remediations/);
});

test('run-report 03-documentation card renders real contract fields (documents_created + requirement counts)', () => {
  const { stageBody } = loadPages();
  const body = stageBody('03-documentation', {
    documents_created: ['artifacts/documents/BRD.md', 'artifacts/documents/FRD.md'],
    total_functional_requirements: 7,
    total_non_functional_requirements: 3,
    estimated_complexity: 'MEDIUM',
  });
  assert.match(body, /documents/);
  assert.match(body, /functional reqs/);
  assert.match(body, /Estimated complexity/);
  assert.match(body, /BRD\.md/);
  // Adopted-run shape (harvest.js writes docs: [...]).
  const adopted = stageBody('03-documentation', { docs: ['README.md'], source: 'brownfield-adoption' });
  assert.match(adopted, /README\.md/);
});

// ── #97: stage artifacts resolve through contract-listed legacy paths ──

function seedLegacyRun() {
  const runDir = mkdtempSync(join(tmpdir(), 'rstack-quality-legacy-'));
  const write = (rel, obj) => {
    mkdirSync(join(runDir, rel, '..'), { recursive: true });
    writeFileSync(join(runDir, rel), JSON.stringify(obj));
  };
  write('artifacts/transcript.json', { goals: ['ship it'], stakeholders: [], open_questions: ['who signs off?'] });
  write('artifacts/requirement_spec.json', { functional: [{ id: 'F-001' }], status: 'PASS' });
  write('artifacts/documents/documentation_output.json', { documents_created: ['BRD.md'], total_functional_requirements: 1 });
  write('artifacts/security/threat_model.json', { threats: [{ id: 'THR-001', risk_level: 'HIGH' }] });
  write('artifacts/summary.json', { status: 'PASS', defect_analysis: { defects: [] } });
  return runDir;
}

test('collectStageReports finds legacy-path artifacts for the previously dark stages', async () => {
  const runDir = seedLegacyRun();
  const { stages } = await collectStageReports(runDir);
  assert.equal(stages['01-transcript'].goals[0], 'ship it');
  assert.equal(stages['02-requirements'].functional.length, 1);
  assert.equal(stages['03-documentation'].documents_created[0], 'BRD.md');
  assert.equal(stages['12-security-threat-model'].threats[0].id, 'THR-001');
  assert.equal(stages['10-summary'].status, 'PASS');
  const index = await stageReportIndex(runDir);
  assert.deepEqual(index.sort(), [
    '01-transcript', '02-requirements', '03-documentation', '10-summary', '12-security-threat-model',
  ]);
  rmSync(runDir, { recursive: true, force: true });
});

test('canonical stage path wins over legacy fallbacks when both exist', async () => {
  const runDir = seedLegacyRun();
  const canonicalDir = join(runDir, 'artifacts', 'stages', '01-transcript');
  mkdirSync(canonicalDir, { recursive: true });
  writeFileSync(join(canonicalDir, 'transcript.json'), JSON.stringify({ goals: ['canonical wins'] }));
  assert.equal(resolveStageArtifactPath(runDir, '01-transcript'), join(canonicalDir, 'transcript.json'));
  const { stages } = await collectStageReports(runDir);
  assert.equal(stages['01-transcript'].goals[0], 'canonical wins');
  rmSync(runDir, { recursive: true, force: true });
});

test('resolveStageArtifactPath returns null when a stage produced nothing', () => {
  const runDir = mkdtempSync(join(tmpdir(), 'rstack-quality-empty-'));
  assert.equal(resolveStageArtifactPath(runDir, '14-cost-estimation'), null);
  rmSync(runDir, { recursive: true, force: true });
});

// ── #90: Requirements & Traceability registry ──

const REQUIREMENT_SPEC = {
  functional: [
    { id: 'F-001', description: 'Reject invoices with mismatched totals', category: 'functional', priority: 'must', acceptance: ['422 on mismatch'], verification: 'Integration test: POST /invoices returns 422' },
    { id: 'F-002', description: 'Export monthly report', category: 'functional', priority: 'could', verification: 'Manual demo' },
  ],
  non_functional: [
    { id: 'N-001', category: 'nonfunctional', furps: 'performance', requirement: 'API stays fast under load', metric: 'p95 < 200ms @ 1000 users', priority: 'should', verification: 'k6 load test in CI' },
  ],
  user_stories: [{ id: 'US-001', story: 'As a clerk...', criteria: ['...'] }],
  out_of_scope: ['Mobile app'],
  wont_have: [{ id: 'F-009', description: 'Multi-currency support', reason: 'deferred to next iteration' }],
  requirement_sources: ['docs/existing-spec.md'],
  status: 'PASS',
};

const TEST_REPORT = {
  test_levels: {
    unit: { technique: 'white-box', tests: 28, status: 'PASS' },
    acceptance: { technique: 'black-box', tests: 5, status: 'PASS', requirements_covered: ['F-001'] },
  },
  results: { passed: 33, failed: 0 },
  security_tests: ['auth_bypass: PASS'],
  status: 'PASS',
};

function traceabilityState(stageReports) {
  return {
    runs: [{ runId: 'run-quality-1', projectRoot: '/p', stageReports, tasks: [] }],
    traceMap: [],
  };
}

test('traceability page renders the FR/NFR registry with MoSCoW priority, verification and test coverage', async () => {
  const pagesApi = loadPages({ report: { stages: { '02-requirements': REQUIREMENT_SPEC, '08-testing': TEST_REPORT }, deliverables: {} } });
  pagesApi.render('traceability', traceabilityState(['02-requirements', '08-testing']));
  await tick();
  const body = pagesApi.html('req-registry-body');
  assert.match(body, /F-001/);
  assert.match(body, /Reject invoices/);
  assert.match(body, /must/);
  assert.match(body, /Integration test: POST \/invoices returns 422/);
  assert.match(body, /tested/);                      // F-001 covered by acceptance tests
  assert.match(body, /acceptance/);
  assert.match(body, /no test in this run references F-002/); // honest gap
  assert.match(body, /N-001/);
  assert.match(body, /performance/);                 // FURPS+ category
  assert.match(body, /p95 &lt; 200ms/);
  // Won't-have and out-of-scope rendered separately.
  assert.match(pagesApi.html('req-wont-have'), /Multi-currency support/);
  assert.match(pagesApi.html('req-wont-have'), /deferred to next iteration/);
  assert.match(pagesApi.html('req-out-of-scope'), /Mobile app/);
  // Coverage KPI matches the data: 1 of 3 requirements covered.
  assert.match(pagesApi.html('req-registry-kpis'), /1\/3/);
});

test('traceability coverage column is honest when the run has no test report', async () => {
  const pagesApi = loadPages({ report: { stages: { '02-requirements': REQUIREMENT_SPEC }, deliverables: {} } });
  pagesApi.render('traceability', traceabilityState(['02-requirements']));
  await tick();
  assert.match(pagesApi.html('req-registry-body'), /stage 08 links tests by requirement ID/);
});

test('traceability page explains which stage produces the registry when no spec exists', () => {
  const pagesApi = loadPages();
  pagesApi.render('traceability', { runs: [{ runId: 'r1', stageReports: [] }], traceMap: [] });
  assert.match(pagesApi.html('req-registry-body'), /No requirement spec yet/);
  assert.match(pagesApi.html('req-registry-body'), /Stage 02 \(requirements\) writes requirement_spec\.json/);
  assert.equal(pagesApi.fetchCalls.length, 0, 'no report fetch without a spec-bearing run');
});

// ── bundle safety: the assembled client still compiles with the wave changes ──

test('assembled client bundle compiles with the quality-wave page modules', () => {
  const bundle = clientScript(3008);
  assert.doesNotThrow(() => new Function(bundle));
  assert.ok(!bundle.includes('</script'));
});
