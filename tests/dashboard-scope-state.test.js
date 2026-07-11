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
