import { resolve } from 'node:path';
import { knownProjectRoots } from '../../tracker/registry.js';

// owner: RStack developed by Richardson Gunde

export async function sourceRoots(projectRoot, options = {}) {
  const root = resolve(projectRoot);
  if (options.includeRegistry === false) return [root];
  const roots = await knownProjectRoots(root);
  return [...new Set((roots ?? []).map((entry) => resolve(entry)))];
}
