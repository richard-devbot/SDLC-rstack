/**
 * Canonical project and run identity for dashboard scope selection.
 *
 * A dashboard source root may be a linked Git worktree. Repository identity
 * stays canonical while the worktree remains visible as secondary context.
 * Resolution is filesystem-only so state assembly never shells out.
 *
 * owner: RStack developed by Richardson Gunde
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

function digest(prefix, value, length) {
  return `${prefix}-${createHash('sha256').update(value).digest('hex').slice(0, length)}`;
}

function directory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function text(path) {
  try {
    return readFileSync(path, 'utf8').trim();
  } catch {
    return '';
  }
}

function repositoryRootFromGitFile(root, gitFile) {
  const match = /^gitdir:\s*(.+)$/im.exec(text(gitFile));
  if (!match) return root;
  const gitDir = resolve(root, match[1].trim());
  const commonDirValue = text(join(gitDir, 'commondir'));
  if (commonDirValue) {
    const commonDir = resolve(gitDir, commonDirValue);
    return basename(commonDir) === '.git' ? dirname(commonDir) : root;
  }

  const marker = `${join('.git', 'worktrees')}`;
  const markerIndex = gitDir.lastIndexOf(marker);
  if (markerIndex >= 0) return gitDir.slice(0, markerIndex - 1);
  return root;
}

export function resolveProjectDescriptor(root) {
  const canonicalRoot = resolve(root);
  const gitPath = join(canonicalRoot, '.git');
  const repositoryRoot = directory(gitPath)
    ? canonicalRoot
    : existsSync(gitPath)
      ? repositoryRootFromGitFile(canonicalRoot, gitPath)
      : canonicalRoot;
  const isWorktree = repositoryRoot !== canonicalRoot;
  return {
    id: digest('project', repositoryRoot, 16),
    name: basename(repositoryRoot) || basename(canonicalRoot),
    root: canonicalRoot,
    repositoryRoot,
    worktreeName: isWorktree ? basename(canonicalRoot) : null,
    isWorktree,
  };
}

export function resolveProjectDescriptors(roots) {
  return (roots ?? []).map((root) => resolveProjectDescriptor(root));
}

export function runScopeKey(projectId, root, runId) {
  return digest('run', `${projectId}\u0000${resolve(root)}\u0000${runId}`, 20);
}

export function decorateRunIdentity(runs, projects) {
  const byRoot = new Map((projects ?? []).map((project) => [resolve(project.root), project]));
  return (runs ?? []).map((run) => {
    const root = resolve(run.projectRoot);
    const project = byRoot.get(root) ?? resolveProjectDescriptor(root);
    return {
      ...run,
      projectId: project.id,
      project: project,
      scopeKey: runScopeKey(project.id, root, run.runId),
    };
  });
}
