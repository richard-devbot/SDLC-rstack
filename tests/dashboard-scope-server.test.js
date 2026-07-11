/**
 * Scoped dashboard REST contract (#276).
 *
 * owner: RStack developed by Richardson Gunde
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveProjectDescriptor } from '../src/observability/dashboard/state/identity.js';

const SERVER_PATH = join(process.cwd(), 'src', 'observability', 'dashboard', 'server.js');

function startServer({ projectRoot, env = {} }) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [SERVER_PATH, '--port', '0', '--no-browser', '--project', projectRoot], {
      cwd: projectRoot,
      env: {
        ...process.env,
        RSTACK_DASHBOARD_READ_TOKEN: undefined,
        RSTACK_BUSINESS_PORT: undefined,
        RSTACK_PROJECT_ROOT: undefined,
        RSTACK_NO_BROWSER: '1',
        RSTACK_REGISTRY_DIR: join(projectRoot, '.registry'),
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      rejectPromise(new Error(`dashboard server did not boot\nstdout: ${stdout}\nstderr: ${stderr}`));
    }, 15_000);
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      const match = stdout.match(/Dashboard: https?:\/\/localhost:(\d+)/);
      if (match && !settled) {
        settled = true;
        clearTimeout(timer);
        resolvePromise({
          baseUrl: `http://127.0.0.1:${match[1]}`,
          stop: () => child.kill('SIGKILL'),
        });
      }
    });
    child.on('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rejectPromise(new Error(`dashboard server exited early (${code})\nstderr: ${stderr}`));
    });
  });
}

async function seedProject(projectRoot) {
  mkdirSync(join(projectRoot, '.git'), { recursive: true });
  const runId = 'run-scope-api';
  const runDir = join(projectRoot, '.rstack', 'runs', runId);
  await mkdir(runDir, { recursive: true });
  await writeFile(join(runDir, 'manifest.json'), JSON.stringify({
    run_id: runId,
    goal: 'Verify server-owned scope',
    created_at: '2026-07-11T09:00:00.000Z',
    framework: 'pi',
  }));
  await writeFile(join(runDir, 'tasks.json'), JSON.stringify({
    tasks: [{ id: '08-testing', title: 'Scope contract', status: 'PASS' }],
  }));
  await writeFile(join(runDir, 'events.jsonl'), `${JSON.stringify({
    ts: '2026-07-11T09:01:00.000Z',
    type: 'task_validated',
    task_id: '08-testing',
    status: 'PASS',
  })}\n`);
  return runId;
}

test('GET /api/state accepts opaque project and run scope keys and preserves ETags', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-scope-server-'));
  let server;
  try {
    const runId = await seedProject(projectRoot);
    const projectId = resolveProjectDescriptor(projectRoot).id;
    server = await startServer({ projectRoot });

    const projectResponse = await fetch(
      `${server.baseUrl}/api/state?project=${encodeURIComponent(projectId)}`,
    );
    assert.equal(projectResponse.status, 200);
    assert.ok(projectResponse.headers.get('etag'));
    const projectState = await projectResponse.json();
    assert.equal(projectState.scope.type, 'project');
    assert.equal(projectState.scope.projectId, projectId);
    assert.equal(projectState.totalRuns, 1);
    assert.equal(projectState.runs.every((run) => run.projectId === projectId), true);

    const runEntry = projectState.scopeCatalog.runs.find((run) => run.runId === runId);
    const runResponse = await fetch(
      `${server.baseUrl}/api/state?run=${encodeURIComponent(runEntry.key)}`,
    );
    const runState = await runResponse.json();
    assert.equal(runState.scope.type, 'run');
    assert.equal(runState.scope.runKey, runEntry.key);
    assert.deepEqual(runState.runs.map((run) => run.scopeKey), [runEntry.key]);

    assert.ok(runResponse.headers.get('etag'), 'scoped run responses keep cache validators');
  } finally {
    server?.stop();
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('unknown scope resets honestly and scoped reads keep read-token authentication', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-scope-auth-'));
  let server;
  try {
    await seedProject(projectRoot);
    server = await startServer({
      projectRoot,
      env: { RSTACK_DASHBOARD_READ_TOKEN: 'scope-read-token' },
    });

    const denied = await fetch(`${server.baseUrl}/api/state?project=unknown`);
    assert.equal(denied.status, 401);

    const response = await fetch(
      `${server.baseUrl}/api/state?project=unknown`,
      { headers: { 'x-rstack-read-token': 'scope-read-token' } },
    );
    assert.equal(response.status, 200);
    const state = await response.json();
    assert.equal(state.scope.type, 'global');
    assert.equal(state.scope.reset, true);
    assert.match(state.scope.reason, /no longer available/i);
    assert.ok(
      state.runs.some((run) => run.runId === 'run-scope-api'),
      'reset response is an honest global snapshot that retains the seeded run',
    );
  } finally {
    server?.stop();
    rmSync(projectRoot, { recursive: true, force: true });
  }
});
