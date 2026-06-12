import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addDecision, decide, readDecisions, summarizeDecisions } from '../src/core/harness/decisions.js';
import { dorCheck } from '../src/core/harness/readiness.js';
import { buildFullState } from '../src/observability/dashboard/state/index.js';
import { dashboardHtml } from '../src/observability/dashboard/ui.js';

// owner: RStack developed by Richardson Gunde

async function writeJson(path, value) {
  await writeFile(path, JSON.stringify(value, null, 2));
}

async function makeRun(profile = 'business-flex') {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-decisions-'));
  const runId = `2026-06-10T00-00-00-${profile}`;
  const runDir = join(projectRoot, '.rstack', 'runs', runId);
  await mkdir(runDir, { recursive: true });
  await writeJson(join(runDir, 'manifest.json'), {
    run_id: runId,
    goal: 'Decision queue test run',
    created_at: '2026-06-10T00:00:00.000Z',
    updated_at: '2026-06-10T00:00:00.000Z',
    mode: 'interactive',
    status: 'PLANNED',
    project_root: projectRoot,
    profile,
    workflow: profile === 'enterprise-webapp' ? 'enterprise-webapp-sdlc' : 'production-business-sdlc',
  });
  await writeJson(join(runDir, 'tasks.json'), { profile, tasks: [] });
  return { projectRoot, runId, runDir };
}

test('Decision Queue covers pending, resolved, waived, and stale summaries', async () => {
  const { projectRoot, runId } = await makeRun();
  try {
    const pending = await addDecision(projectRoot, runId, {
      question: 'JWT or server sessions?',
      impact: 'security',
      required_before_stage: '06-architecture',
      recommendation: 'Server sessions',
    });
    await addDecision(projectRoot, runId, {
      question: 'Which hosting target?',
      impact: 'delivery',
      required_before_stage: '09-deployment',
      created_at: '2020-01-01T00:00:00.000Z',
      stale_after_days: 1,
    });
    await decide(projectRoot, runId, pending.decision_id, {
      status: 'resolved',
      resolution: 'Use server sessions for this release',
      resolvedBy: 'PM',
    });
    const waiver = await addDecision(projectRoot, runId, { question: 'Defer analytics?', impact: 'scope' });
    await decide(projectRoot, runId, waiver.decision_id, { status: 'waived', resolution: 'Not required for MVP', resolvedBy: 'PM' });

    const decisions = await readDecisions(projectRoot, runId);
    const summary = summarizeDecisions(decisions, new Date('2026-06-10T00:00:00.000Z'));
    assert.equal(summary.pending, 1);
    assert.equal(summary.resolved, 1);
    assert.equal(summary.waived, 1);
    assert.equal(summary.stale.length, 1);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test('DoR warns for business-flex but fails for enterprise-webapp pending required decisions', async () => {
  const flex = await makeRun('business-flex');
  const enterprise = await makeRun('enterprise-webapp');
  try {
    await addDecision(flex.projectRoot, flex.runId, { question: 'Pick data store', impact: 'architecture', required_before_stage: '06-architecture' });
    await addDecision(enterprise.projectRoot, enterprise.runId, { question: 'Pick auth boundary', impact: 'security', required_before_stage: '06-architecture' });

    const flexReport = await dorCheck(flex.projectRoot, { runId: flex.runId, targetStage: '07-code' });
    const enterpriseReport = await dorCheck(enterprise.projectRoot, { runId: enterprise.runId, targetStage: '07-code' });

    assert.equal(flexReport.status, 'WARN');
    assert.equal(flexReport.mode, 'approval');
    assert.equal(enterpriseReport.status, 'FAIL');
    assert.equal(enterpriseReport.mode, 'blocking');
    assert.deepEqual(enterpriseReport.pending_required, ['DEC-001']);

    await decide(enterprise.projectRoot, enterprise.runId, 'DEC-001', { status: 'resolved', resolution: 'OIDC behind gateway', resolvedBy: 'Architect' });
    const after = await dorCheck(enterprise.projectRoot, { runId: enterprise.runId, targetStage: '07-code' });
    assert.equal(after.status, 'PASS');
  } finally {
    await rm(flex.projectRoot, { recursive: true, force: true });
    await rm(enterprise.projectRoot, { recursive: true, force: true });
  }
});

test('Business Hub exposes decisions and readiness from real .rstack files', async () => {
  const { projectRoot, runId } = await makeRun('enterprise-webapp');
  try {
    await addDecision(projectRoot, runId, { question: 'Choose session strategy', impact: 'security', required_before_stage: '06-architecture' });
    const state = await buildFullState(projectRoot, { includeRegistry: false });
    assert.equal(state.decisions.totals.pending, 1);
    assert.equal(state.decisions.runs[0].readiness.status, 'FAIL');

    const html = dashboardHtml(3008);
    assert.match(html, /data-page="decisions"/);
    assert.match(html, /id="decisions-list"/);
    assert.match(html, /function renderDecisions\(s\)/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test('rstack-agents decisions and dor CLI operate on the latest run', async () => {
  const { projectRoot, runId } = await makeRun('business-flex');
  try {
    const bin = join(process.cwd(), 'bin', 'rstack-agents.js');
    execFileSync(process.execPath, [bin, 'decisions', '--project', projectRoot, '--run-id', runId, '--add', 'Choose cache tier', '--impact', 'architecture'], { encoding: 'utf8' });
    const listOut = execFileSync(process.execPath, [bin, 'decisions', '--project', projectRoot, '--run-id', runId], { encoding: 'utf8' });
    const listed = JSON.parse(listOut);
    assert.equal(listed.summary.pending, 1);

    const dorOut = execFileSync(process.execPath, [bin, 'dor', '--project', projectRoot, '--run-id', runId, '--stage', '07-code'], { encoding: 'utf8' });
    const report = JSON.parse(dorOut);
    assert.equal(report.status, 'WARN');
    assert.equal(JSON.parse(await readFile(join(projectRoot, '.rstack', 'runs', runId, 'readiness.json'), 'utf8')).status, 'WARN');
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});
