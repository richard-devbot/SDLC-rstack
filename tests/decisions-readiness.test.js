import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { utimes } from 'node:fs/promises';
import { addDecision, decide, readDecisions, resolveRunId, summarizeDecisions } from '../src/core/harness/decisions.js';
import { dorCheck, latestStageId } from '../src/core/harness/readiness.js';
import { buildDecisionState } from '../src/observability/dashboard/state/decisions.js';
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


test('Decision Queue serializes concurrent additions with unique ids', async () => {
  const { projectRoot, runId } = await makeRun();
  try {
    await Promise.all(Array.from({ length: 20 }, (_, index) => addDecision(projectRoot, runId, {
      question: `Concurrent decision ${index}`,
      impact: 'scope',
    })));
    const decisions = await readDecisions(projectRoot, runId);
    const ids = decisions.map((decision) => decision.decision_id).sort();
    assert.equal(decisions.length, 20);
    assert.equal(new Set(ids).size, 20);
    assert.deepEqual(ids, Array.from({ length: 20 }, (_, index) => `DEC-${String(index + 1).padStart(3, '0')}`));
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test('Decision Queue steals a stale orphaned lock instead of timing out', async () => {
  const { projectRoot, runId, runDir } = await makeRun();
  try {
    const lockDir = join(runDir, '.decisions.lock');
    await mkdir(lockDir, { recursive: true });
    const stale = new Date(Date.now() - 120000);
    await utimes(lockDir, stale, stale);
    const decision = await addDecision(projectRoot, runId, { question: 'Survive crashed lock holder?', impact: 'delivery' });
    assert.equal(decision.decision_id, 'DEC-001');
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test('resolveRunId rejects run ids with path separators or traversal', async () => {
  const { projectRoot } = await makeRun();
  try {
    await assert.rejects(resolveRunId(projectRoot, '..\\..\\escape'), /Invalid run id/);
    await assert.rejects(resolveRunId(projectRoot, '../escape'), /Invalid run id/);
    await assert.rejects(resolveRunId(projectRoot, '..'), /Invalid run id/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test('latestStageId gates bundled tasks on their latest stage', () => {
  assert.equal(latestStageId(['02-requirements', '04-planning', '05-jira']), '05-jira');
  assert.equal(latestStageId(['06-architecture', '12-security-threat-model', '14-cost-estimation']), '14-cost-estimation');
  assert.equal(latestStageId([]), '07-code');
  assert.equal(latestStageId(['99-made-up']), '07-code');
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


test('DoR fails closed for unknown decision or target stages', async () => {
  const { projectRoot, runId } = await makeRun('enterprise-webapp');
  try {
    await addDecision(projectRoot, runId, { question: 'Unknown stage should not bypass', impact: 'scope', required_before_stage: '99-made-up' });
    await assert.rejects(
      dorCheck(projectRoot, { runId, targetStage: '07-code' }),
      /Unknown required_before_stage: 99-made-up/,
    );
    await decide(projectRoot, runId, 'DEC-001', { status: 'waived', resolution: 'invalid stage entry retired', resolvedBy: 'QA' });
    await assert.rejects(
      dorCheck(projectRoot, { runId, targetStage: '99-made-up' }),
      /Unknown target_stage: 99-made-up/,
    );
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
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
    assert.match(html, /scopedDecisionRuns/);
    assert.match(html, /scopedTotals/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});


test('Business Hub marks decision read failures as WARN instead of PASS', async () => {
  const { projectRoot, runId, runDir } = await makeRun('business-flex');
  try {
    await writeFile(join(runDir, 'decisions.json'), '{ bad json');
    const state = await buildDecisionState([{ projectRoot, runId, manifest: { goal: 'bad decisions' }, profile: { profile: 'business-flex' } }]);
    assert.equal(state.runs[0].readiness.status, 'WARN');
    assert.equal(state.runs[0].readiness.error, true);
    assert.match(state.runs[0].readiness.errorMessage, /Expected property name|JSON/);
    assert.equal(state.totals.warn, 1);
    assert.equal(state.totals.pass, 0);
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

test('decisions --add rejects a non-canonical --before at the source; nothing is persisted (#290)', async () => {
  const { projectRoot, runId } = await makeRun('business-flex');
  try {
    const bin = join(process.cwd(), 'bin', 'rstack-agents.js');
    let threw = false;
    try {
      execFileSync(
        process.execPath,
        [bin, 'decisions', '--project', projectRoot, '--run-id', runId, '--add', 'Bad stage entry', '--before', '99-made-up'],
        { encoding: 'utf8', stdio: 'pipe' },
      );
    } catch (err) {
      threw = true;
      assert.match(String(err.stderr || err.message), /Invalid --before stage/);
    }
    assert.equal(threw, true, 'CLI must exit non-zero for a non-canonical --before stage');
    // The bad decision never entered the queue (so the fail-closed DoR gate is
    // never reached with an unknown stage via the documented path).
    const decisions = await readDecisions(projectRoot, runId);
    assert.equal(decisions.length, 0);

    // A valid --before still works.
    execFileSync(process.execPath, [bin, 'decisions', '--project', projectRoot, '--run-id', runId, '--add', 'Good stage entry', '--before', '06-architecture'], { encoding: 'utf8', stdio: 'pipe' });
    assert.equal((await readDecisions(projectRoot, runId)).length, 1);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});
