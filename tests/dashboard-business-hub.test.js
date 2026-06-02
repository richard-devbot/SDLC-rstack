import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildFullState, resolveDashboardApproval } from '../src/observability/dashboard/state/index.js';
import { dashboardHtml } from '../src/observability/dashboard/ui.js';

async function writeJson(filePath, value) {
  await writeFile(filePath, JSON.stringify(value, null, 2));
}

test('Business Hub turns blocked gates into actionable pending approvals', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-business-state-'));
  try {
    const runId = '2026-05-31T10-00-00-demo';
    const runDir = join(projectRoot, '.rstack', 'runs', runId);
    await mkdir(join(runDir, 'tasks', '02-requirements'), { recursive: true });

    await writeJson(join(runDir, 'manifest.json'), {
      run_id: runId,
      goal: 'Build business dashboard',
      created_at: '2026-05-31T10:00:00.000Z',
      framework: 'pi',
    });
    await writeJson(join(runDir, 'metrics.json'), { cumulative_cost_usd: 0.25 });
    await writeJson(join(runDir, 'tasks.json'), {
      tasks: [{ id: '02-requirements', title: 'Requirements', status: 'PASS' }],
    });
    await writeJson(join(runDir, 'tasks', '02-requirements', 'builder.json'), {
      agent: 'agent.requirements',
      status: 'PASS',
      summary: 'Captured dashboard requirements',
      memory_summary: { decisions: ['Use real .rstack data only'] },
      risks: [],
      tests_run: ['npm test'],
      files_modified: ['src/dashboard/server.js'],
    });
    await writeJson(join(runDir, 'tasks', '02-requirements', 'validation.json'), {
      status: 'PASS',
      checks: [{ name: 'requirements-evidence', status: 'PASS' }],
    });

    await writeFile(join(runDir, 'events.jsonl'), [
      {
        ts: '2026-05-31T10:01:00.000Z',
        type: 'approval_gate_blocked',
        task_id: '09-deployment',
        missing: ['deploy-approval.md'],
      },
      {
        ts: '2026-05-31T10:02:00.000Z',
        type: 'approval_gate',
        artifact: 'plan.md',
        status: 'APPROVED',
      },
    ].map((event) => JSON.stringify(event)).join('\n') + '\n');

    await writeFile(join(projectRoot, '.rstack', 'approvals.jsonl'), [
      {
        id: 'queue-1',
        title: 'Approve production deploy',
        detail: 'Deploy business hub',
        status: 'pending',
        runId,
        ts: '2026-05-31T10:03:00.000Z',
      },
      {
        id: 'queue-2',
        title: 'Approve plan',
        detail: 'Plan already approved',
        status: 'approved',
        runId,
        ts: '2026-05-31T10:04:00.000Z',
      },
    ].map((entry) => JSON.stringify(entry)).join('\n') + '\n');

    const state = await buildFullState(projectRoot, { includeRegistry: false });

    assert.ok(state.pendingApprovals.some((a) => a.id === 'queue-1'));
    assert.ok(state.pendingApprovals.some((a) => a.artifact === 'deploy-approval.md'));
    assert.equal(state.approvalStats.pending, 2);
    assert.equal(state.approvalStats.total, 3);
    assert.ok(
      state.feed.some((event) => event.type === 'approval_gate_blocked'),
      'blocked gate history should remain visible in the live feed',
    );
    assert.ok(
      state.blockedGates.some((event) => event.taskId === '09-deployment'),
      'blocked gates should move to guardrail/history data',
    );
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('Business Hub approval resolution writes the run-level approval artifact', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-business-approve-'));
  try {
    const runId = '2026-05-31T11-00-00-demo';
    const runDir = join(projectRoot, '.rstack', 'runs', runId);
    await mkdir(runDir, { recursive: true });

    await writeJson(join(runDir, 'manifest.json'), {
      run_id: runId,
      goal: 'Approval source of truth',
      created_at: '2026-05-31T11:00:00.000Z',
      framework: 'pi',
    });
    await writeJson(join(runDir, 'tasks.json'), { tasks: [] });
    await writeFile(join(runDir, 'events.jsonl'), JSON.stringify({
      ts: '2026-05-31T11:01:00.000Z',
      type: 'approval_gate_blocked',
      task_id: '004-implementation',
      missing: ['architecture.md'],
    }) + '\n');

    const state = await buildFullState(projectRoot, { includeRegistry: false });
    const approval = state.pendingApprovals.find((item) => item.artifact === 'architecture.md');
    assert.ok(approval, 'blocked gate becomes a pending dashboard approval');

    const ok = await resolveDashboardApproval(projectRoot, approval.id, 'approved', 'Manager Maya', { includeRegistry: false });
    assert.equal(ok, true);

    const runApprovals = JSON.parse(await readFile(join(runDir, 'approvals.json'), 'utf8'));
    assert.equal(runApprovals.at(-1).artifact, 'architecture.md');
    assert.equal(runApprovals.at(-1).status, 'APPROVED');
    assert.equal(runApprovals.at(-1).approver, 'Manager Maya');

    const after = await buildFullState(projectRoot, { includeRegistry: false });
    assert.ok(!after.pendingApprovals.some((item) => item.id === approval.id), 'resolved approval leaves the pending queue');
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('Business Hub client does not overwrite a live WebSocket label after HTTP state loads', () => {
  const html = dashboardHtml(3008);

  assert.match(html, /var WS_CONNECTED = false;/);
  assert.match(html, /WS_CONNECTED = true;/);
  assert.match(html, /if \(!WS_CONNECTED\) \{\s*setConnectionStatus\('connecting', 'Loaded \(connecting…\)'\);/);
});

test('Business Hub exposes the planned production observability screens', () => {
  const html = dashboardHtml(3008);
  const expectedPages = [
    'command',
    'workflow',
    'projects',
    'agent-work',
    'live-feed',
    'approvals',
    'alerts-guardrails',
    'traceability',
    'team-layers',
    'diagnostics',
  ];

  for (const page of expectedPages) {
    assert.match(html, new RegExp(`data-page="${page}"`));
    assert.match(html, new RegExp(`id="page-${page}"`));
  }
});

test('Command Center exposes manager sections for real .rstack data', () => {
  const html = dashboardHtml(3008);
  const expectedSections = [
    'command-summary-title',
    'command-attention',
    'command-stage-strip',
    'command-projects',
    'command-agent-proof',
    'command-layers',
    'command-feed',
  ];

  for (const section of expectedSections) {
    assert.match(html, new RegExp(`id="${section}"`));
  }

  assert.match(html, /function stageMiniHtml\(stage\)/);
  assert.match(html, /pass<\/span>/);
  assert.match(html, /ready<\/span>/);
  assert.match(html, /stage\.artifact/);
  assert.match(html, /missing validations/);
});

test('Workflow Map exposes live agent-stage tracking controls', () => {
  const html = dashboardHtml(3008);
  const expectedSections = [
    'workflow-rail',
    'workflow-grid',
    'workflow-inspector',
    'workflow-runs',
    'workflow-active-stages',
    'workflow-validations',
  ];

  for (const section of expectedSections) {
    assert.match(html, new RegExp(`id="${section}"`));
  }

  assert.match(html, /WORKFLOW_STAGE_META/);
  assert.match(html, /function workflowStageCardHtml\(stage, index\)/);
  assert.match(html, /function openWorkflowStageButton\(btn\)/);
  assert.match(html, /stage\.artifact/);
});

test('dashboard CLI surface uses one Business Hub instead of a separate 3007 observer', async () => {
  const packageJson = JSON.parse(await readFile(join(process.cwd(), 'package.json'), 'utf8'));
  const observerBin = await readFile(join(process.cwd(), 'bin', 'rstack-observer.js'), 'utf8');

  assert.equal(packageJson.bin['rstack-business'], 'bin/rstack-business.js');
  assert.equal(packageJson.bin['rstack-observer'], 'bin/rstack-observer.js');
  assert.equal(packageJson.scripts.observer, 'node bin/rstack-observer.js');
  assert.equal(packageJson.scripts['observer:dev'], 'node --watch bin/rstack-business.js');
  assert.equal(packageJson.scripts['build:observer'], undefined);
  assert.doesNotMatch(JSON.stringify(packageJson.scripts), /3007/);
  assert.match(observerBin, /rstack-business\.js/);
  assert.doesNotMatch(observerBin, /3007|developer\.js/);
});
