// owner: RStack developed by Richardson Gunde

import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export function rstackStateDir(projectRoot) {
  return resolve(process.env.RSTACK_STATE_DIR || join(projectRoot, '.rstack'));
}

export function runDirectory(projectRoot, runId) {
  return join(rstackStateDir(projectRoot), 'runs', runId);
}

export async function latestRunId(projectRoot) {
  const runsDir = join(rstackStateDir(projectRoot), 'runs');
  if (!existsSync(runsDir)) return undefined;
  const entries = await readdir(runsDir, { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().at(-1);
}

const RUN_ID_REGEX = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export async function resolveRunId(projectRoot, runId) {
  if (runId && !RUN_ID_REGEX.test(String(runId))) {
    throw new Error(`Invalid run id "${runId}". Run ids may only contain letters, digits, dots, dashes, and underscores.`);
  }
  const selected = runId || await latestRunId(projectRoot);
  if (!selected) throw new Error('No RStack run found. Start one with sdlc_start first.');
  return selected;
}
