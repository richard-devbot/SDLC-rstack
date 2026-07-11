/**
 * Dashboard scope trust (#276): canonical repository/worktree identity and
 * collision-safe run keys are the foundation for server-owned scoped state.
 *
 * owner: RStack developed by Richardson Gunde
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  decorateRunIdentity,
  resolveProjectDescriptor,
  resolveProjectDescriptors,
  runScopeKey,
} from '../src/observability/dashboard/state/identity.js';
import { buildScopeCatalog, resolveRequestedScope } from '../src/observability/dashboard/state/scope.js';
import { buildFullState } from '../src/observability/dashboard/state/index.js';
import { getIndexedRuns } from '../src/observability/dashboard/state/rollup-index.js';

function fakeLinkedWorktree() {
  const fixture = mkdtempSync(join(tmpdir(), 'rstack-scope-identity-'));
  const repositoryRoot = join(fixture, 'product-repository');
  const worktreeRoot = join(fixture, 'worktrees', 'agent-scope-fix');
  const worktreeGitDir = join(repositoryRoot, '.git', 'worktrees', 'agent-scope-fix');
  mkdirSync(worktreeGitDir, { recursive: true });
  mkdirSync(worktreeRoot, { recursive: true });
  writeFileSync(join(worktreeRoot, '.git'), `gitdir: ${worktreeGitDir}\n`);
  writeFileSync(join(worktreeGitDir, 'commondir'), '../..\n');
  return { fixture, repositoryRoot, worktreeRoot };
}

async function seedRun(projectRoot, runId) {
  const runDir = join(projectRoot, '.rstack', 'runs', runId);
  await mkdir(runDir, { recursive: true });
  await writeFile(join(runDir, 'manifest.json'), JSON.stringify({
    run_id: runId,
    goal: `Goal in ${projectRoot}`,
    created_at: '2026-07-11T08:00:00.000Z',
    framework: 'pi',
  }));
  await writeFile(join(runDir, 'tasks.json'), JSON.stringify({ tasks: [] }));
  await writeFile(join(runDir, 'events.jsonl'), `${JSON.stringify({
    ts: '2026-07-11T08:01:00.000Z', type: 'task_started', task_id: '01-discovery',
  })}\n`);
}

async function seedScopedProject(projectRoot, {
  runId,
  taskStatus,
  cost,
  blockedArtifact = null,
  approvalId,
}) {
  mkdirSync(join(projectRoot, '.git'), { recursive: true });
  const runDir = join(projectRoot, '.rstack', 'runs', runId);
  await mkdir(runDir, { recursive: true });
  await writeFile(join(runDir, 'manifest.json'), JSON.stringify({
    run_id: runId,
    goal: `Deliver ${runId}`,
    created_at: '2026-07-11T08:00:00.000Z',
    framework: 'pi',
  }));
  await writeFile(join(runDir, 'metrics.json'), JSON.stringify({ cumulative_cost_usd: cost }));
  await writeFile(join(runDir, 'tasks.json'), JSON.stringify({
    tasks: [{ id: '08-testing', title: `Tests for ${runId}`, status: taskStatus }],
  }));
  const events = [{
    ts: '2026-07-11T08:01:00.000Z',
    type: 'task_validated',
    task_id: '08-testing',
    status: taskStatus,
  }];
  if (blockedArtifact) {
    events.push({
      ts: '2026-07-11T08:02:00.000Z',
      type: 'approval_gate_blocked',
      task_id: '09-deployment',
      missing: [blockedArtifact],
    });
  }
  await writeFile(join(runDir, 'events.jsonl'), `${events.map(JSON.stringify).join('\n')}\n`);
  await writeFile(join(projectRoot, '.rstack', 'approvals.jsonl'), `${JSON.stringify({
    id: approvalId,
    title: `Approve ${runId}`,
    detail: `Decision for ${runId}`,
    status: 'pending',
    runId,
    ts: '2026-07-11T08:03:00.000Z',
  })}\n`);
}

test('a linked worktree keeps the canonical repository name and exposes the worktree secondarily', () => {
  const { fixture, repositoryRoot, worktreeRoot } = fakeLinkedWorktree();
  try {
    const descriptor = resolveProjectDescriptor(worktreeRoot);
    assert.equal(descriptor.name, 'product-repository');
    assert.equal(descriptor.repositoryRoot, repositoryRoot);
    assert.equal(descriptor.root, worktreeRoot);
    assert.equal(descriptor.worktreeName, 'agent-scope-fix');
    assert.equal(descriptor.isWorktree, true);
    assert.match(descriptor.id, /^project-[a-f0-9]{16}$/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('normal repositories and linked worktrees share a canonical project id', () => {
  const { fixture, repositoryRoot, worktreeRoot } = fakeLinkedWorktree();
  try {
    const [repository, worktree] = resolveProjectDescriptors([repositoryRoot, worktreeRoot]);
    assert.equal(repository.id, worktree.id);
    assert.equal(repository.isWorktree, false);
    assert.equal(repository.worktreeName, null);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('run scope keys distinguish equal run ids in different state roots', () => {
  const projectId = 'project-0123456789abcdef';
  const first = runScopeKey(projectId, '/workspace/repository', 'run-shared');
  const second = runScopeKey(projectId, '/workspace/worktree', 'run-shared');
  assert.notEqual(first, second);
  assert.match(first, /^run-[a-f0-9]{20}$/);

  const decorated = decorateRunIdentity([
    { runId: 'run-shared', projectRoot: '/workspace/repository' },
    { runId: 'run-shared', projectRoot: '/workspace/worktree' },
  ], [
    { id: projectId, root: '/workspace/repository' },
    { id: projectId, root: '/workspace/worktree' },
  ]);
  assert.equal(new Set(decorated.map((run) => run.scopeKey)).size, 2);
  assert.equal(decorated.every((run) => run.projectId === projectId), true);
});

test('the rollup keeps equal run ids from different roots', async () => {
  const fixture = mkdtempSync(join(tmpdir(), 'rstack-scope-collision-'));
  const projectA = join(fixture, 'project-a');
  const projectB = join(fixture, 'project-b');
  try {
    await seedRun(projectA, 'run-shared');
    await seedRun(projectB, 'run-shared');
    const { runs } = await getIndexedRuns([projectA, projectB], {
      retentionDays: 0,
      now: Date.parse('2026-07-11T08:02:00.000Z'),
    });
    assert.equal(runs.filter((run) => run.runId === 'run-shared').length, 2);
    assert.deepEqual(new Set(runs.map((run) => run.projectRoot)), new Set([projectA, projectB]));
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('scope catalog resolves repository projects and collision-safe runs without trusting client paths', () => {
  const projects = [
    { id: 'project-a', name: 'alpha', root: '/workspace/alpha', repositoryRoot: '/workspace/alpha', worktreeName: null, isWorktree: false },
    { id: 'project-b', name: 'beta', root: '/workspace/beta', repositoryRoot: '/workspace/beta', worktreeName: null, isWorktree: false },
  ];
  const runs = [
    { runId: 'run-shared', scopeKey: 'run-alpha', projectId: 'project-a', projectRoot: '/workspace/alpha', manifest: { goal: 'Alpha goal' } },
    { runId: 'run-shared', scopeKey: 'run-beta', projectId: 'project-b', projectRoot: '/workspace/beta', manifest: { goal: 'Beta goal' } },
  ];
  const catalog = buildScopeCatalog(projects, runs);
  assert.equal(catalog.projects.length, 2);
  assert.equal(catalog.runs.length, 2);
  assert.deepEqual(resolveRequestedScope(catalog, { runKey: 'run-beta' }), {
    type: 'run', key: 'run:run-beta', projectId: 'project-b', runKey: 'run-beta',
    projectIds: ['project-b'], roots: ['/workspace/beta'], runKeys: ['run-beta'], reset: false, reason: '',
  });
  assert.equal(resolveRequestedScope(catalog, { projectId: 'missing' }).reset, true);
});

test('project scope rebuilds all visible records and aggregates without cross-project leakage', async () => {
  const fixture = mkdtempSync(join(tmpdir(), 'rstack-scope-isolation-'));
  const projectA = join(fixture, 'alpha-repository');
  const projectB = join(fixture, 'beta-repository');
  try {
    await seedScopedProject(projectA, {
      runId: 'run-alpha', taskStatus: 'PASS', cost: 4.25, approvalId: 'approval-alpha',
    });
    await seedScopedProject(projectB, {
      runId: 'run-beta', taskStatus: 'FAIL', cost: 99, blockedArtifact: 'deploy-beta.md', approvalId: 'approval-beta',
    });
    const projectAId = resolveProjectDescriptor(projectA).id;
    const state = await buildFullState(projectA, {
      includeRegistry: false,
      sourceRoots: [projectA, projectB],
      scope: { projectId: projectAId },
      retentionDays: 0,
      now: Date.parse('2026-07-11T08:04:00.000Z'),
    });

    assert.equal(state.scope.type, 'project');
    assert.equal(state.scope.projectId, projectAId);
    assert.equal(state.totalRuns, 1);
    assert.equal(state.totalCost, 4.25);
    assert.equal(state.runs.every((run) => run.projectId === projectAId), true);
    assert.equal(state.runs.some((run) => run.runId === 'run-beta'), false);
    assert.equal(state.approvals.every((item) => item.projectId === projectAId), true);
    assert.equal(state.pendingApprovals.some((item) => item.id === 'approval-beta'), false);
    assert.equal(state.blockedGates.some((item) => item.projectRoot === projectB), false);
    assert.equal(state.alerts.some((item) => item.projectRoot === projectB), false);
    assert.equal(state.feed.some((item) => item.projectRoot === projectB), false);
    assert.equal(state.projectSummaries.every((item) => item.projectId === projectAId), true);
    assert.equal(state.stageMatrix.every((stage) => (
      stage.runs.every((row) => row.projectId === projectAId)
    )), true);
    assert.equal(state.diagnostics.runCount, 1);
    assert.deepEqual(state.diagnostics.sourceRoots, [projectA]);
    assert.equal(state.decisions.runs.every((row) => row.projectId === projectAId), true);
    assert.equal(state.readiness.blockers.some((item) => item.projectRoot === projectB), false);
    assert.equal(state.scopeCatalog.projects.length, 2, 'the global catalog remains available to switch scope');
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
