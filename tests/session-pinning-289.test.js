import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import extension from '../extensions/rstack-sdlc.ts';

// #289: the bridge runs one process per tool call, so the in-memory session id
// never survives. A no-run_id call must resolve the DURABLE active-run pointer
// (.rstack/active-run) written by sdlc_start — not latestRun() ("newest dir").
// This file never calls sdlc_start, so the module-level sessionRunId stays
// undefined and the disk-pointer fallback is exercised directly.

const mockPi = {
  tools: {},
  commands: {},
  on: () => {},
  registerTool(tool) { this.tools[tool.name] = tool; },
  registerCommand(cmd, opts) { this.commands[cmd] = opts; },
};

function seedRun(projectRoot, runId) {
  const runDir = join(projectRoot, '.rstack', 'runs', runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, 'manifest.json'), JSON.stringify({
    schema_version: 2, run_id: runId, goal: `goal ${runId}`, mode: 'interactive',
    status: 'PLANNED', project_root: projectRoot,
    created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
  }));
  writeFileSync(join(runDir, 'tasks.json'), JSON.stringify({ run_id: runId, tasks: [] }));
  return runDir;
}

test('no-run_id resolution prefers the active-run pointer over latestRun (#289)', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-session-'));
  process.env.RSTACK_PROJECT_ROOT = projectRoot;
  extension(mockPi);

  // A sorts before B, so latestRun() (newest dir) would pick B.
  const idA = '2026-01-01T00-00-00-alpha';
  const idB = '2026-06-01T00-00-00-beta';
  seedRun(projectRoot, idA);
  seedRun(projectRoot, idB);

  try {
    // 1. No pointer, no run_id → falls back to latestRun() = B (documents it).
    const noPointer = await mockPi.tools.sdlc_status.execute('1', {});
    assert.equal(noPointer.details.manifest.run_id, idB, 'fallback is latestRun when no pointer');

    // 2. Active-run pointer = A (the OLDER run) → no-run_id resolves A, not B.
    writeFileSync(join(projectRoot, '.rstack', 'active-run'), idA);
    const pointed = await mockPi.tools.sdlc_status.execute('2', {});
    assert.equal(pointed.details.manifest.run_id, idA, 'active-run pointer beats latestRun');

    // 3. An explicit run_id always wins over the pointer.
    const explicit = await mockPi.tools.sdlc_status.execute('3', { run_id: idB });
    assert.equal(explicit.details.manifest.run_id, idB, 'explicit run_id wins');

    // 4. A dangling pointer (run dir gone) self-heals back to latestRun.
    writeFileSync(join(projectRoot, '.rstack', 'active-run'), 'run-that-does-not-exist');
    const healed = await mockPi.tools.sdlc_status.execute('4', {});
    assert.equal(healed.details.manifest.run_id, idB, 'dangling pointer falls back to latestRun');
  } finally {
    delete process.env.RSTACK_PROJECT_ROOT;
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('sdlc_start persists the active-run pointer (#289)', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-session-start-'));
  process.env.RSTACK_PROJECT_ROOT = projectRoot;
  extension(mockPi);
  try {
    const start = await mockPi.tools.sdlc_start.execute('1', { goal: 'pointer persistence' });
    const runId = start.details.run_id;
    const { readFileSync } = await import('node:fs');
    const pointer = readFileSync(join(projectRoot, '.rstack', 'active-run'), 'utf8').trim();
    assert.equal(pointer, runId, 'sdlc_start wrote the active-run pointer');
  } finally {
    delete process.env.RSTACK_PROJECT_ROOT;
    rmSync(projectRoot, { recursive: true, force: true });
  }
});
