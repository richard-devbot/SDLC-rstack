/**
 * Unified scoped Run Workspace (#280).
 * owner: RStack developed by Richardson Gunde
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildRunWorkspace } from '../src/observability/dashboard/state/run-workspace.js';
import { clientScript } from '../src/observability/dashboard/ui/client.js';
import { runWorkspaceScript } from '../src/observability/dashboard/ui/pages/run-workspace.js';
import { styles } from '../src/observability/dashboard/ui/styles.js';
import { dashboardHtml } from '../src/observability/dashboard/ui.js';

function fixtureRun(overrides = {}) {
  return {
    runId: 'run-280',
    runKey: 'run-key-280',
    projectRoot: '/workspace/product',
    canonicalProjectId: 'project-1',
    worktree: { path: '/workspace/product-wt', branch: 'feat/run-workspace' },
    manifest: { goal: 'Unify the run experience', status: 'IN_PROGRESS', created_at: '2026-07-12T08:00:00.000Z' },
    derivedStatus: 'active',
    tasks: [{
      id: '07-code', title: 'Build Run Workspace', stageId: '07-code', status: 'IN_PROGRESS',
      agent_name: 'builder-agent', evidence_count: 2,
      validation: { status: 'PENDING', total_checks: 3, pass_checks: 1, failed_checks: [] },
      risk_count: 1,
    }],
    stageReports: ['06-architecture'],
    artifactIndex: [{ path: 'artifacts/stages/06-architecture/system_design.json', kind: 'stage-report' }],
    evidenceRecent: [{ ts: '2026-07-12T08:12:00.000Z', task_id: '07-code', kind: 'test', status: 'PASS', evidence: 'npm test' }],
    timeline: [{ ts: '2026-07-12T08:10:00.000Z', type: 'task_started', task_id: '07-code' }],
    activityTimeline: [{ ts: '2026-07-12T08:11:00.000Z', type: 'checkpoint_created', stage_id: '06-architecture' }],
    totals: { duration_ms: 720000, cost_usd: 3.25, tokens: 42000 },
    tokenTotals: { input: 30000, output: 12000, total: 42000 },
    metricsSource: 'persisted',
    stageCost: { '07-code': 2.1 },
    stageTokens: { '07-code': { input: 20000, output: 8000, total: 28000 } },
    pipelineRollup: {
      status: 'IN_PROGRESS', stale: false,
      next_action: { kind: 'active', stage_id: '07-code', task_id: '07-code', text: 'Continue implementation.' },
      // The shipped checkpoint contract (#215): checkpoints.stages, not a
      // full stages map — the old shape pinned the exact consumer bug.
      checkpoints: { stages: [{ id: '06-architecture', restorable: true, reason: null }] },
    },
    ...overrides,
  };
}

test('run workspace normalizes all five sections without inventing availability', () => {
  const run = fixtureRun();
  const workspace = buildRunWorkspace(run, {
    readiness: { status: 'at_risk', summary: 'Validation is incomplete.', evaluatedAt: '2026-07-12T08:15:00.000Z' },
    stageProof: [{ id: '07-code', state: 'in_progress', proof: { attached: 2, expected: null, availability: 'partial' } }],
  });

  assert.equal(workspace.identity.runId, 'run-280');
  assert.equal(workspace.goal, 'Unify the run experience');
  assert.equal(workspace.outcome.status, 'at_risk');
  assert.equal(workspace.nextAction.text, 'Continue implementation.');
  assert.equal(workspace.sections.summary.available, true);
  assert.equal(workspace.sections.work.items[0].agent, 'builder-agent');
  assert.equal(workspace.sections.timeline.items.length, 2);
  assert.equal(workspace.sections.artifacts.items[0].path, 'artifacts/stages/06-architecture/system_design.json');
  assert.equal(workspace.sections.metrics.provenance, 'persisted');
  assert.equal(workspace.sections.metrics.stageDrivers[0].stageId, '07-code');
  assert.equal(workspace.sections.metrics.recovery[0].restorable, true);
});

test('legacy partial runs expose unavailable sections instead of empty success', () => {
  const workspace = buildRunWorkspace(fixtureRun({
    manifest: { goal: 'Legacy run' }, tasks: [], artifactIndex: [], evidenceRecent: [],
    timeline: [], activityTimeline: [], totals: null, tokenTotals: null,
    metricsSource: 'none', stageCost: {}, stageTokens: {}, pipelineRollup: null,
  }), { readiness: { status: 'unknown', summary: 'Not evaluated.' }, stageProof: [] });

  assert.equal(workspace.outcome.status, 'unknown');
  assert.equal(workspace.sections.work.available, false);
  assert.equal(workspace.sections.timeline.available, false);
  assert.equal(workspace.sections.artifacts.available, false);
  assert.equal(workspace.sections.metrics.available, false);
  assert.equal(workspace.sections.metrics.provenance, 'unavailable');
});

test('run workspace registers five accessible URL-backed sections and legacy parity links', () => {
  const html = dashboardHtml(3008);
  for (const section of ['summary', 'work', 'timeline', 'artifacts', 'metrics']) {
    assert.ok(runWorkspaceScript.includes(`'${section}'`));
    assert.match(html, new RegExp(`id="run-workspace-${section}"`));
  }
  assert.match(runWorkspaceScript, /showRunWorkspaceSection/);
  assert.match(runWorkspaceScript, /aria-selected/);
  assert.match(runWorkspaceScript, /openDrawer\(/, 'artifact preview reuses the protected run drawer');
  assert.match(runWorkspaceScript, /Source unavailable|unavailable/i);

  const bundle = clientScript(3008);
  assert.doesNotThrow(() => new Function(bundle));
  assert.equal([...bundle.matchAll(/registerPage\('run-workspace',/g)].length, 1);
});

test('run workspace has responsive no-page-overflow and visible focus contracts', () => {
  assert.match(styles, /\.run-workspace-passport/);
  assert.match(styles, /\.run-workspace-tabs[^}]*overflow-x:\s*auto/);
  assert.match(styles, /@media \(max-width: 640px\)[\s\S]*\.run-workspace-passport[^}]*grid-template-columns:\s*1fr/);
  assert.match(styles, /\.run-workspace-tab:focus-visible/);
});
