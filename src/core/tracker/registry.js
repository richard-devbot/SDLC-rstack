import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

// owner: RStack developed by Richardson Gunde
//
// Global project registry — tracks every project root that has used RStack.
// Stored at ~/.rstack/known-projects.json so the Business Hub can aggregate
// runs from all projects, not just the one it was started from.

const REGISTRY_DIR  = join(homedir(), '.rstack');
const REGISTRY_FILE = join(REGISTRY_DIR, 'known-projects.json');
const MAX_PROJECTS  = 50;

export async function registerProject(projectRoot) {
  const abs = resolve(projectRoot);
  await mkdir(REGISTRY_DIR, { recursive: true });

  let list = await readRegistry();
  if (!list.includes(abs)) {
    list = [abs, ...list.filter(p => p !== abs)].slice(0, MAX_PROJECTS);
    await writeFile(REGISTRY_FILE, JSON.stringify(list, null, 2));
  }
  return abs;
}

export async function readRegistry() {
  if (!existsSync(REGISTRY_FILE)) return [];
  try {
    const raw = JSON.parse(await readFile(REGISTRY_FILE, 'utf8'));
    return Array.isArray(raw) ? raw.filter(p => typeof p === 'string') : [];
  } catch { return []; }
}

export async function knownProjectRoots(extraRoot) {
  const registered = await readRegistry();
  // Always include CWD so `rstack-business` works immediately on a fresh global
  // install before any Pi session has run (and thus before the registry is populated).
  const cwd = process.cwd();
  const all = new Set([
    ...(extraRoot ? [resolve(extraRoot)] : []),
    cwd,
    ...registered,
  ]);
  // Keep only roots that still have a .rstack directory
  return [...all].filter(p => existsSync(join(p, '.rstack')));
}
