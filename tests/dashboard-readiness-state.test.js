/**
 * Availability-aware release readiness (#93).
 *
 * The dashboard must never translate an empty scope into READY. Readiness is
 * a server-owned projection with explicit coverage and source references so
 * every UI surface renders the same conclusion.
 *
 * owner: RStack developed by Richardson Gunde
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildFullState, toClientState } from '../src/observability/dashboard/state/index.js';
import { buildReadinessProjection } from '../src/observability/dashboard/state/readiness.js';
import { clientScript } from '../src/observability/dashboard/ui/client.js';
import { libScript } from '../src/observability/dashboard/ui/lib.js';
import { commandCenterScript } from '../src/observability/dashboard/ui/pages/command-center.js';
import { releaseReadinessScript } from '../src/observability/dashboard/ui/pages/release-readiness.js';
import { styles } from '../src/observability/dashboard/ui/styles.js';
import { dashboardHtml } from '../src/observability/dashboard/ui/index.js';

function loadReadinessPages() {
  const elements = new Map();
  const makeElement = (id) => ({
    id,
    innerHTML: '',
    textContent: '',
    className: '',
    style: {},
    setAttribute() {},
    getAttribute() { return null; },
    querySelector() { return null; },
    insertAdjacentHTML() {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
  });
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, makeElement(id));
      return elements.get(id);
    },
    querySelectorAll() { return []; },
    createElement: () => makeElement(''),
    addEventListener() {},
  };
  const api = new Function(
    'document',
    `var STATE = null;\n${libScript}\n${commandCenterScript}\n${releaseReadinessScript}\n` +
    'return { renderers: PAGE_RENDERERS };',
  )(document);
  return {
    render(id, state) { api.renderers.find((renderer) => renderer.id === id).render(state); },
    element(id) { return document.getElementById(id); },
  };
}

function run(overrides = {}) {
  return {
    runId: 'run-1',
    projectRoot: '/workspace/product',
    manifest: { completed_at: '2026-07-10T12:00:00.000Z' },
    derivedStatus: 'done',
    tasks: [{
      id: '08-testing',
      title: 'Test the release',
      status: 'PASS',
      validation: { status: 'PASS', checks: [{ name: 'npm test', status: 'PASS' }] },
      evidence_count: 1,
    }],
    pipelineRollup: {
      status: 'COMPLETED',
      stages_total: 1,
      stages_passed: 1,
      stages_failed: 0,
      stale: false,
      approval_blockers: 0,
      next_action: { kind: 'complete', text: 'Pipeline complete.' },
    },
    integrity: [],
    ...overrides,
  };
}

function snapshot(overrides = {}) {
  return {
    runs: [run()],
    blockedGates: [],
    pendingApprovals: [],
    alerts: [],
    ...overrides,
  };
}

test('an empty project scope is unknown, never ready', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-readiness-empty-'));
  const state = await buildFullState(projectRoot, { includeRegistry: false });

  assert.equal(state.readiness.status, 'unknown');
  assert.equal(state.readiness.coverage.runs.total, 0);
  assert.equal(state.readiness.coverage.complete, false);
  assert.equal(state.readiness.checks.every((check) => check.status !== 'pass'), true);
  assert.match(state.readiness.summary, /not evaluated|no runs/i);

  const client = toClientState(state);
  assert.equal(client.readiness.status, 'unknown');
  assert.equal(client.readiness.evaluatedAt, state.readiness.evaluatedAt);
});

test('partial proof is at risk and coverage names the missing validation', () => {
  const candidate = run({
    tasks: [{ id: '08-testing', status: 'PASS', validation: null, evidence_count: 0 }],
  });

  const readiness = buildReadinessProjection(snapshot({ runs: [candidate] }), {
    evaluatedAt: '2026-07-10T12:30:00.000Z',
  });

  assert.equal(readiness.status, 'at_risk');
  assert.equal(readiness.coverage.validations.evaluated, 0);
  assert.equal(readiness.coverage.validations.total, 1);
  assert.equal(readiness.coverage.complete, false);
  const validationCheck = readiness.checks.find((check) => check.id === 'validation');
  assert.equal(validationCheck.status, 'unknown');
  assert.equal(validationCheck.sourceRefs[0].available, false, 'the expected validation path is named as unavailable');
  assert.match(validationCheck.sourceRefs[0].path, /tasks\/08-testing\/validation\.json$/);
  assert.match(readiness.summary, /partial|incomplete|proof/i);
});

test('failed or guardrail-blocked tasks create source-linked hard blockers', () => {
  const candidate = run({
    tasks: [{
      id: '08-testing',
      status: 'FAIL',
      validation: { status: 'FAIL', checks: [{ name: 'npm test', status: 'FAIL' }] },
      evidence_count: 1,
    }],
    pipelineRollup: {
      status: 'BLOCKED', stages_total: 1, stages_passed: 0, stages_failed: 1,
      stale: false, approval_blockers: 0,
      next_action: { kind: 'guardrail_blocked', task_id: '08-testing', text: 'Approval required.' },
    },
  });

  const readiness = buildReadinessProjection(snapshot({ runs: [candidate] }));

  assert.equal(readiness.status, 'blocked');
  assert.ok(readiness.blockers.some((blocker) => blocker.type === 'failed_task'));
  assert.ok(readiness.blockers.some((blocker) => blocker.type === 'pipeline'));
  assert.ok(readiness.blockers.every((blocker) => blocker.sourceRef?.path));
  assert.equal(readiness.checks.find((check) => check.id === 'tasks').status, 'fail');
});

test('unresolved approvals block readiness even when task and pipeline proof pass', () => {
  const readiness = buildReadinessProjection(snapshot({
    blockedGates: [{
      id: 'gate-1', runId: 'run-1', projectRoot: '/workspace/product',
      taskId: '09-deployment', detail: 'Deployment approval required',
    }],
    pendingApprovals: [{
      id: 'approval-1', runId: 'run-1', projectRoot: '/workspace/product',
      artifact: 'release-readiness', status: 'pending',
    }],
  }));

  assert.equal(readiness.status, 'blocked');
  assert.equal(readiness.checks.find((check) => check.id === 'approvals').status, 'fail');
  assert.ok(readiness.blockers.some((blocker) => blocker.type === 'approval'));
  assert.match(readiness.summary, /blocked/i);
});

test('a trusted approved or consumed override resolves its historical gate event', () => {
  const artifact = 'guardrail-override:08-testing';
  const candidate = run({
    approvals: [{
      id: 'app-consumed-1',
      artifact,
      status: 'CONSUMED',
      approver: 'Richardson',
      timestamp: '2026-07-10T12:20:00.000Z',
      run_id: 'run-1',
      source: 'api',
    }],
  });
  const readiness = buildReadinessProjection(snapshot({
    runs: [candidate],
    blockedGates: [{
      id: 'historical-block', runId: 'run-1', projectRoot: '/workspace/product',
      taskId: '08-testing', missing: [artifact], detail: 'Task could not proceed',
      ts: '2026-07-10T12:10:00.000Z',
    }],
  }));

  assert.equal(readiness.status, 'ready');
  assert.equal(readiness.checks.find((check) => check.id === 'approvals').status, 'pass');
  assert.equal(readiness.blockers.some((blocker) => blocker.type === 'approval'), false);
});

test('complete source-backed coverage with no concerns is ready', () => {
  const readiness = buildReadinessProjection(snapshot(), {
    evaluatedAt: '2026-07-10T12:30:00.000Z',
  });

  assert.equal(readiness.status, 'ready');
  assert.equal(readiness.coverage.complete, true);
  assert.equal(readiness.coverage.percent, 100);
  assert.equal(readiness.checks.every((check) => check.status === 'pass'), true);
  assert.equal(readiness.blockers.length, 0);
  assert.ok(readiness.sources.some((source) => source.path.endsWith('/pipeline-state.json')));
  assert.ok(readiness.sources.some((source) => source.path.endsWith('/validation.json')));
  assert.equal(readiness.evaluatedAt, '2026-07-10T12:30:00.000Z');
});

test('server precomputes isolated project and run verdicts for browser scope selection', () => {
  const readyRun = run({ runId: 'run-ready', projectRoot: '/workspace/ready' });
  const blockedRun = run({
    runId: 'run-blocked',
    projectRoot: '/workspace/blocked',
    tasks: [{ id: '08-testing', status: 'FAIL', validation: { status: 'FAIL' }, evidence_count: 1 }],
  });
  const readiness = buildReadinessProjection(snapshot({
    runs: [readyRun, blockedRun],
    pendingApprovals: [{
      id: 'blocked-approval', runId: 'run-blocked', projectRoot: '/workspace/blocked', status: 'pending',
    }],
  }));

  assert.equal(readiness.status, 'blocked', 'the all-projects view remains conservative');
  const readyProject = readiness.scopes.projects.find((entry) => entry.projectRoot === '/workspace/ready');
  const blockedProject = readiness.scopes.projects.find((entry) => entry.projectRoot === '/workspace/blocked');
  assert.equal(readyProject.status, 'ready');
  assert.equal(blockedProject.status, 'blocked');
  assert.equal(readyProject.blockers.length, 0, 'another project approval never leaks into this verdict');
  assert.equal(readiness.scopes.runs.find((entry) => entry.runId === 'run-ready').status, 'ready');
  assert.equal(readiness.scopes.runs.find((entry) => entry.runId === 'run-blocked').status, 'blocked');
});

test('the browser scope selector chooses a server-owned readiness result', () => {
  const bundle = clientScript(3008);
  assert.match(bundle, /function selectReadinessScope\(/);
  assert.match(bundle, /copy\.readiness = selectReadinessScope\(s\.readiness\)/);
  assert.match(bundle, /function resetDashboardScroll\(/);
  assert.match(bundle, /setText\('page-title',[\s\S]+resetDashboardScroll\(\)/);
  assert.doesNotThrow(() => new Function(bundle));
});

test('Release Readiness renders unknown without Ready or 100% language', () => {
  const pages = loadReadinessPages();
  const readiness = buildReadinessProjection({ runs: [], blockedGates: [], pendingApprovals: [], alerts: [] }, {
    evaluatedAt: '2026-07-10T12:30:00.000Z',
  });

  pages.render('release-readiness', { readiness });

  assert.match(pages.element('release-readiness-verdict').textContent, /not evaluated|unknown/i);
  assert.equal(pages.element('release-readiness-summary').textContent, readiness.summary);
  assert.equal(pages.element('release-readiness-chip').textContent, 'Unknown');
  const rendered = [
    pages.element('release-readiness-verdict').textContent,
    pages.element('release-readiness-count').textContent,
    pages.element('release-readiness-checklist').innerHTML,
  ].join(' ');
  assert.doesNotMatch(rendered, /ready to ship|100%/i);
});

test('release page header and verdict summary have unique DOM ids', () => {
  const html = dashboardHtml(3008);
  assert.equal([...html.matchAll(/id="release-readiness-sub"/g)].length, 1);
  assert.equal([...html.matchAll(/id="release-readiness-summary"/g)].length, 1);
});

test('Release Readiness renders server checks, blockers, coverage and source paths', () => {
  const pages = loadReadinessPages();
  const failed = run({
    tasks: [{ id: '08-testing', title: 'Test the release', status: 'FAIL', validation: { status: 'FAIL' } }],
  });
  const readiness = buildReadinessProjection(snapshot({ runs: [failed] }), {
    evaluatedAt: '2026-07-10T12:30:00.000Z',
  });

  pages.render('release-readiness', { readiness });

  assert.equal(pages.element('release-readiness-chip').textContent, 'Blocked');
  assert.match(pages.element('release-readiness-count').textContent, /coverage/i);
  assert.match(pages.element('release-readiness-checklist').innerHTML, /Task outcomes/);
  assert.match(pages.element('release-readiness-blockers').innerHTML, /Test the release/);
  assert.match(pages.element('release-readiness-blockers').innerHTML, /\.rstack\/runs\/run-1\/tasks\.json/);
});

test('Command Center mission brief uses the same readiness verdict and coverage', () => {
  const pages = loadReadinessPages();
  const readiness = buildReadinessProjection({ runs: [], blockedGates: [], pendingApprovals: [], alerts: [] });

  pages.render('command', {
    readiness,
    runs: [], activeRuns: [], alerts: [], blockedGates: [], pendingApprovals: [],
    diagnostics: {}, decisions: { runs: [] }, projectSummaries: [], agentWork: [],
    sourceRoots: [], feed: [], stageMatrix: [], layers: [], totalRuns: 0, todayCount: 0,
  });

  assert.equal(pages.element('executive-readiness-verdict').textContent, 'NOT EVALUATED');
  assert.equal(pages.element('executive-governance-score').textContent, '—');
  assert.match(pages.element('executive-next-action').textContent, /start.*run|no runs/i);
});

test('guardrail and alert motion is accessible, bounded and reduced-motion safe', () => {
  const html = dashboardHtml(3008);
  const bundle = clientScript(3008);

  assert.match(html, /id="signal-toast-region"[^>]+role="status"[^>]+aria-live="polite"/);
  assert.match(bundle, /function announceOperationalSignals\(/);
  assert.match(bundle, /freshAlerts/);
  assert.match(styles, /@keyframes readiness-signal-pop/);
  assert.match(styles, /@keyframes signal-toast-enter/);
  assert.match(styles, /prefers-reduced-motion: reduce/);
  assert.match(styles, /animation-iteration-count:\s*1\s*!important/);
});
