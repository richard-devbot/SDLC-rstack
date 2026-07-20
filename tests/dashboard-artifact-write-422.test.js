/**
 * Governed artifact-override endpoint (#422): POST /api/artifact-write lets an
 * operator correct a bad stage-00/01 intake artifact from the Business Hub,
 * behind the SAME trust boundary as /api/env-write — JSON + approval token +
 * CSRF origin + 64KB cap + rate limit — plus a schema gate and a two-step
 * one-shot approval. Only 00-environment and 01-transcript are overridable.
 *
 * Boots the real server as a child process against a throwaway project.
 *
 * owner: RStack developed by Richardson Gunde
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SERVER_PATH = join(process.cwd(), 'src', 'observability', 'dashboard', 'server.js');
const TOKEN = 'secret-token';
const ORIGIN = null; // same-origin (no Origin header) passes the CSRF shape check

function startServer(projectRoot) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [SERVER_PATH, '--port', '0', '--no-browser', '--project', projectRoot], {
      cwd: projectRoot,
      env: {
        ...process.env,
        RSTACK_HTTP_LOG: undefined,
        RSTACK_BUSINESS_PORT: undefined,
        RSTACK_PROJECT_ROOT: undefined,
        RSTACK_NO_BROWSER: '1',
        RSTACK_REGISTRY_DIR: join(projectRoot, '.registry'),
        RSTACK_APPROVAL_TOKEN: TOKEN,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) { settled = true; child.kill('SIGKILL'); rejectPromise(new Error(`server did not boot\n${stdout}\n${stderr}`)); }
    }, 15_000);
    child.stderr.on('data', (c) => { stderr += c; });
    child.stdout.on('data', (c) => {
      stdout += c;
      const match = stdout.match(/Dashboard: http:\/\/localhost:(\d+)/);
      if (match && !settled) {
        settled = true; clearTimeout(timer);
        resolvePromise({ baseUrl: `http://127.0.0.1:${match[1]}`, stop: () => child.kill('SIGKILL') });
      }
    });
    child.on('exit', () => { if (!settled) { settled = true; clearTimeout(timer); rejectPromise(new Error(`server exited early\n${stderr}`)); } });
  });
}

async function seedRun(projectRoot, runId) {
  const runDir = join(projectRoot, '.rstack', 'runs', runId);
  await mkdir(join(runDir, 'artifacts', 'stages', '00-environment'), { recursive: true });
  await writeFile(join(runDir, 'manifest.json'), JSON.stringify({ run_id: runId, goal: 'artifact-write fixture', created_at: '2026-07-20T08:00:00.000Z', framework: 'pi' }));
  await writeFile(join(runDir, 'tasks.json'), JSON.stringify({ tasks: [] }));
  await writeFile(join(runDir, 'events.jsonl'), '');
  return runDir;
}

function post(baseUrl, body, { token = TOKEN } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['x-rstack-approval-token'] = token;
  if (ORIGIN) headers.Origin = ORIGIN;
  return fetch(`${baseUrl}/api/artifact-write`, { method: 'POST', headers, body: JSON.stringify(body) });
}

test('#422: /api/artifact-write is auth-gated, schema-gated, and two-step approval-gated', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-artifact-write-'));
  const runId = '2026-07-20T08-00-00-aw';
  let server;
  try {
    const runDir = await seedRun(projectRoot, runId);
    server = await startServer(projectRoot);

    // 1. No token → 401 (auth boundary), before anything is written.
    const noToken = await post(server.baseUrl, { runId, stageId: '00-environment', content: { run_mode: 'brownfield' }, resolvedBy: 'Maya' }, { token: null });
    assert.equal(noToken.status, 401);

    // 2. A machine-produced stage is not operator-overridable → 400.
    const badStage = await post(server.baseUrl, { runId, stageId: '07-code', content: { x: 1 }, resolvedBy: 'Maya' });
    assert.equal(badStage.status, 400);

    // 3. Schema gate: an invalid environment report is rejected BEFORE any
    //    approval is created (422), so a bad payload can't burn a one-shot.
    const badSchema = await post(server.baseUrl, { runId, stageId: '00-environment', content: { run_mode: 'not-a-mode' }, resolvedBy: 'Maya' });
    assert.equal(badSchema.status, 422);

    // 4. Valid payload, no approval yet → 409 approval_required, nothing written.
    const step1 = await post(server.baseUrl, { runId, stageId: '00-environment', content: { run_mode: 'brownfield', status: 'ready' }, resolvedBy: 'Maya' });
    assert.equal(step1.status, 409);
    const body1 = await step1.json();
    assert.equal(body1.error, 'approval_required');
    assert.ok(body1.approval_id, 'a pending approval id is returned');
    assert.equal(existsSync(join(runDir, 'artifacts', 'stages', '00-environment', 'environment_report.json')), false, 'nothing is written before approval');

    // 5. Approve the queued override, then re-submit → 200 written.
    const approve = await fetch(`${server.baseUrl}/api/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-rstack-approval-token': TOKEN },
      body: JSON.stringify({ id: body1.approval_id, resolvedBy: 'Manager Maya' }),
    });
    assert.equal(approve.status, 200);

    const step2 = await post(server.baseUrl, { runId, stageId: '00-environment', content: { run_mode: 'brownfield', status: 'ready' }, resolvedBy: 'Maya' });
    assert.equal(step2.status, 200, `override should be written after approval: ${await step2.clone().text()}`);
    assert.equal((await step2.json()).written, true);

    const written = JSON.parse(await readFile(join(runDir, 'artifacts', 'stages', '00-environment', 'environment_report.json'), 'utf8'));
    assert.equal(written.run_mode, 'brownfield');

    const events = (await readFile(join(runDir, 'events.jsonl'), 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const override = events.find((e) => e.type === 'artifact_overridden');
    assert.ok(override, 'an artifact_overridden event is appended');
    assert.equal(override.stage_id, '00-environment');
    assert.equal(override.actor, 'Maya');

    // 6. One-shot: a second write without a fresh approval re-blocks (409).
    const step3 = await post(server.baseUrl, { runId, stageId: '00-environment', content: { run_mode: 'greenfield' }, resolvedBy: 'Maya' });
    assert.equal(step3.status, 409, 'the approval was consumed one-shot; a new write needs re-approval');
  } finally {
    server?.stop();
    // Best-effort temp cleanup: the just-killed server process can briefly hold
    // the dir on Windows (EBUSY) — the OS reclaims the temp dir regardless.
    try { rmSync(projectRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* temp dir; OS reclaims */ }
  }
});
