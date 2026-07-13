/**
 * Dashboard regression suite, Phase 1 (#96): server/API behavior, WebSocket
 * snapshot + reconnect, product-truth states (no-data readiness is NEVER
 * Ready), scope isolation across projects, artifact safety, the approval
 * auth matrix, and nav/container + landmark parity — all against the real
 * server process on an ephemeral port with the canonical deterministic
 * fixtures from tests/helpers/dashboard-fixtures.js.
 *
 * Phase 2 (real-browser journeys + axe scans + responsive viewports) is
 * coordinated on the issue — it needs a browser dependency and builds on
 * these fixtures.
 *
 * owner: RStack developed by Richardson Gunde
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  fixtureNoRunsProject, fixtureBlockedRun, fixtureReadyRun,
  fixtureStaleRun, fixtureMalformedRun, fixtureArtifactMatrix,
} from './helpers/dashboard-fixtures.js';
import { sidebarMarkup, pageMarkup } from '../src/observability/dashboard/ui/pages/index.js';

const SERVER_PATH = join(process.cwd(), 'src', 'observability', 'dashboard', 'server.js');

function startServer({ projectRoot, registryDir, env = {} }) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [SERVER_PATH, '--port', '0', '--no-browser', '--project', projectRoot], {
      cwd: projectRoot,
      env: {
        ...process.env,
        RSTACK_APPROVAL_TOKEN: undefined,
        RSTACK_APPROVAL_TOKEN_FILE: undefined,
        RSTACK_DASHBOARD_READ_TOKEN: undefined,
        RSTACK_DASHBOARD_READ_TOKEN_FILE: undefined,
        RSTACK_TLS_CERT: undefined,
        RSTACK_TLS_KEY: undefined,
        RSTACK_HTTP_LOG: undefined,
        RSTACK_BUSINESS_PORT: undefined,
        RSTACK_PROJECT_ROOT: undefined,
        RSTACK_NO_BROWSER: '1',
        RSTACK_REGISTRY_DIR: registryDir,
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) { settled = true; child.kill('SIGKILL'); rejectPromise(new Error(`server did not boot\nstderr: ${stderr}`)); }
    }, 15_000);
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      const match = stdout.match(/Dashboard: https?:\/\/localhost:(\d+)/);
      if (match && !settled) {
        settled = true;
        clearTimeout(timer);
        resolvePromise({ child, port: Number(match[1]), baseUrl: `http://127.0.0.1:${match[1]}`, stop: () => child.kill('SIGKILL') });
      }
    });
    child.on('exit', () => {
      if (!settled) { settled = true; clearTimeout(timer); rejectPromise(new Error(`server exited before boot\nstderr: ${stderr}`)); }
    });
  });
}

// Raw WebSocket client good enough for snapshot assertions: performs the
// upgrade, decodes the FIRST text frame (server→client frames are unmasked;
// handles 7-bit/16-bit/64-bit lengths), resolves its payload.
function wsFirstFrame(port, { path = '/' } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const req = request({
      host: '127.0.0.1',
      port,
      path,
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Key': Buffer.from('0123456789abcdef').toString('base64'),
        'Sec-WebSocket-Version': '13',
      },
    });
    const timer = setTimeout(() => rejectPromise(new Error('no snapshot frame within 10s')), 10_000);
    req.on('upgrade', (res, socket) => {
      let buffer = Buffer.alloc(0);
      socket.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        if (buffer.length < 2) return;
        let payloadLength = buffer[1] & 0x7f;
        let offset = 2;
        if (payloadLength === 126) {
          if (buffer.length < 4) return;
          payloadLength = buffer.readUInt16BE(2); offset = 4;
        } else if (payloadLength === 127) {
          if (buffer.length < 10) return;
          payloadLength = Number(buffer.readBigUInt64BE(2)); offset = 10;
        }
        if (buffer.length < offset + payloadLength) return;
        clearTimeout(timer);
        const payload = buffer.subarray(offset, offset + payloadLength).toString('utf8');
        socket.destroy();
        resolvePromise(payload);
      });
      socket.on('error', () => {});
    });
    req.on('response', (res) => { clearTimeout(timer); rejectPromise(new Error(`upgrade denied: ${res.statusCode}`)); });
    req.on('error', (err) => { clearTimeout(timer); rejectPromise(err); });
    req.end();
  });
}

async function getState(baseUrl, query = '') {
  const response = await fetch(`${baseUrl}/api/state${query}`);
  assert.equal(response.status, 200, `/api/state${query} must 200`);
  return { state: await response.json(), etag: response.headers.get('etag') };
}

// ── One multi-project server for the whole read-path suite ──────────────────
test('dashboard regression (#96): API, WS, truth states, scope isolation, artifact safety', async (t) => {
  const base = mkdtempSync(join(tmpdir(), 'rstack-96-'));
  const registryDir = join(base, 'registry');
  const projectA = join(base, 'project-a'); // active + blocked + ready + stale + damaged runs
  const projectB = join(base, 'project-b'); // initialized, ZERO runs
  const projectC = join(base, 'project-c'); // one fully verified run — the clean scope
  mkdirSync(registryDir, { recursive: true });
  mkdirSync(projectA, { recursive: true });
  mkdirSync(projectB, { recursive: true });
  mkdirSync(projectC, { recursive: true });

  const artifactCase = await fixtureArtifactMatrix(projectA); // builds the active run too
  const blockedRunId = await fixtureBlockedRun(projectA);
  const staleRunId = await fixtureStaleRun(projectA);
  const damagedRunId = await fixtureMalformedRun(projectA);
  await fixtureNoRunsProject(projectB);
  const readyRunId = await fixtureReadyRun(projectC);

  writeFileSync(join(registryDir, 'known-projects.json'), JSON.stringify([projectA, projectB, projectC]));

  const server = await startServer({ projectRoot: projectA, registryDir });
  try {
    await t.test('health endpoint answers', async () => {
      const response = await fetch(`${server.baseUrl}/health`);
      assert.equal(response.status, 200);
    });

    // Early polls fully parse runs and progressively warm the rollup index;
    // the full→lite transition legitimately reshapes capped collections, and
    // the index entry write is asynchronous — on a slow CI disk it can land
    // BETWEEN back-to-back polls, so pause between attempts and require the
    // stable pair inside the loop (a separate post-loop poll raced the
    // write and flaked on Node 22 CI). A fixture that never settles in 15
    // paced polls is a real bug, not slowness.
    let globalState;
    let etag = null;
    let settled = false;
    for (let attempt = 0; attempt < 15 && !settled; attempt++) {
      const next = await getState(server.baseUrl);
      if (etag !== null && next.etag === etag) { globalState = next.state; settled = true; break; }
      etag = next.etag;
      globalState = next.state;
      await new Promise((resolvePause) => setTimeout(resolvePause, 150));
    }
    assert.ok(settled, 'snapshot settles to a stable ETag within 15 paced polls');

    const scopeProjects = globalState.scopeCatalog?.projects ?? [];
    const scopeIdFor = (marker) => scopeProjects.find((project) => (
      String(project.repositoryRoot ?? '').includes(marker)
      || (project.roots ?? []).some((entry) => String(entry.root ?? '').includes(marker))
    ))?.id;

    await t.test('/api/state carries a strong ETag and revalidates 304 once settled', async () => {
      assert.ok(etag, 'ETag header present');
      const revalidated = await fetch(`${server.baseUrl}/api/state`, { headers: { 'If-None-Match': etag } });
      assert.equal(revalidated.status, 304, 'unchanged state revalidates as 304');
    });

    await t.test('global state sees every fixture project and run', async () => {
      assert.ok(scopeProjects.length >= 3, `3 projects in the scope catalog, got ${scopeProjects.length}`);
      const runIds = new Set((globalState.runs ?? []).map((run) => run.runId));
      for (const runId of ['run-fx-active', blockedRunId, staleRunId, damagedRunId, readyRunId]) {
        assert.ok(runIds.has(runId), `run ${runId} visible globally`);
      }
    });

    await t.test('TRUTH: a scope with zero runs NEVER reads Ready — readiness is unknown, overview says so', async () => {
      const projectIdB = scopeIdFor('project-b');
      assert.ok(projectIdB, 'project-b has a scope id');
      const { state: scoped } = await getState(server.baseUrl, `?project=${encodeURIComponent(projectIdB)}`);
      assert.equal((scoped.runs ?? []).length, 0, 'no runs in the empty scope');
      assert.notEqual(String(scoped.readiness?.status ?? ''), 'ready', 'no-data readiness must not be ready');
      assert.equal(String(scoped.readiness?.status ?? 'unknown'), 'unknown', 'no-data readiness is honestly unknown');
      const coveragePercent = scoped.readiness?.coverage?.percent;
      assert.notEqual(coveragePercent, 100, 'no-data coverage must not read 100%');
      assert.equal(scoped.overview?.focusRunId ?? null, null, 'overview has no focus run');
      assert.notEqual(String(scoped.overview?.outcome ?? ''), 'ready', 'overview outcome must not be ready with no data');
    });

    await t.test('SCOPE ISOLATION: the clean project sees none of the noisy project’s blockers or approvals', async () => {
      const projectIdC = scopeIdFor('project-c');
      assert.ok(projectIdC, 'project-c has a scope id');
      const { state: scoped } = await getState(server.baseUrl, `?project=${encodeURIComponent(projectIdC)}`);
      assert.equal((scoped.runs ?? []).length, 1, 'exactly the one ready run in scope');
      assert.equal(scoped.runs[0].runId, readyRunId);
      const leakedApprovals = (scoped.pendingApprovals ?? []).filter((item) => item.runId === blockedRunId);
      assert.equal(leakedApprovals.length, 0, 'project-a pending override must not leak into project-c scope');
      const leakedGates = (scoped.blockedGates ?? []).filter((gate) => gate.runId === blockedRunId);
      assert.equal(leakedGates.length, 0, 'project-a blocked gates must not leak into project-c scope');
      const feedForeign = (scoped.feed ?? []).filter((item) => item.runId && ![readyRunId].includes(item.runId));
      assert.equal(feedForeign.length, 0, 'feed in scope only carries scoped runs');
      // Scoped ETag differs from the global one (#276 per-scope ETags).
      const scopedResponse = await fetch(`${server.baseUrl}/api/state?project=${encodeURIComponent(projectIdC)}`);
      assert.notEqual(scopedResponse.headers.get('etag'), etag, 'scoped projection has its own ETag');
    });

    await t.test('TRUTH: blocked run surfaces its guardrail block and the pending override card globally', async () => {
      const pendingOverride = (globalState.pendingApprovals ?? []).find((item) => item.artifact === 'guardrail-override:07-code');
      assert.ok(pendingOverride, 'the pending override card is served');
      const blocked = (globalState.runs ?? []).find((run) => run.runId === blockedRunId);
      assert.ok(blocked.tasks.some((task) => task.status === 'BLOCKED'), 'blocked task status served');
    });

    await t.test('TRUTH: stale snapshot is flagged stale, never presented as live', async () => {
      const stale = (globalState.runs ?? []).find((run) => run.runId === staleRunId);
      assert.ok(stale?.pipelineRollup, 'stale run has its rollup');
      assert.equal(stale.pipelineRollup.stale, true, 'events newer than the snapshot mark it stale');
      assert.ok(stale.pipelineRollup.events_behind >= 1, 'events_behind counts the lag');
    });

    await t.test('TRUTH: damaged run keeps its integrity badge and does not take the server down', async () => {
      const damaged = (globalState.runs ?? []).find((run) => run.runId === damagedRunId);
      assert.ok(damaged, 'damaged run still served');
      // The v5 index persists the BADGE for lite-served runs; the per-file
      // detail list is consciously lossy on that path — assert the truth
      // that must survive, not the detail that is documented to drop.
      assert.equal(damaged.hasIntegrityErrors, true, 'the #82 data-damaged badge is set');
      assert.ok((damaged.tasks ?? []).length >= 1, 'the rest of the damaged run still serves');
    });

    await t.test('artifact API: allowed file serves, missing 4xx, traversal rejected, unknown run rejected', async () => {
      const allowed = await fetch(`${server.baseUrl}/api/artifact?run=${artifactCase.runId}&path=${encodeURIComponent(artifactCase.allowed)}`);
      assert.equal(allowed.status, 200, 'real stage artifact serves');
      const missing = await fetch(`${server.baseUrl}/api/artifact?run=${artifactCase.runId}&path=${encodeURIComponent(artifactCase.missing)}`);
      assert.ok(missing.status >= 400, `missing artifact rejects (got ${missing.status})`);
      const traversal = await fetch(`${server.baseUrl}/api/artifact?run=${artifactCase.runId}&path=${encodeURIComponent(artifactCase.traversal)}`);
      assert.ok(traversal.status >= 400, `traversal rejects (got ${traversal.status})`);
      const unknownRun = await fetch(`${server.baseUrl}/api/artifact?run=no-such-run&path=x.json`);
      assert.ok(unknownRun.status >= 400, `unknown run rejects (got ${unknownRun.status})`);
    });

    await t.test('approval writes are DISABLED (403) when no approval token is configured', async () => {
      const response = await fetch(`${server.baseUrl}/api/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'q-fx-blocked', resolvedBy: 'attacker' }),
      });
      assert.equal(response.status, 403, 'no token configured = browser approvals off, fail closed');
    });

    await t.test('WebSocket sends the state snapshot on connect, and a reconnect gets it again', async () => {
      const first = JSON.parse(await wsFirstFrame(server.port));
      assert.ok(Array.isArray(first.runs), 'snapshot carries runs');
      assert.ok(first.runs.some((run) => run.runId === readyRunId), 'snapshot sees fixture runs');
      const second = JSON.parse(await wsFirstFrame(server.port));
      assert.ok(Array.isArray(second.runs), 'reconnect receives a fresh snapshot');
    });
  } finally {
    server.stop();
    rmSync(base, { recursive: true, force: true });
  }
});

// ── Approval auth matrix with a token configured (separate boot) ────────────
test('dashboard regression (#96): approval token matrix', async () => {
  const base = mkdtempSync(join(tmpdir(), 'rstack-96-tok-'));
  const registryDir = join(base, 'registry');
  const projectRoot = join(base, 'project');
  mkdirSync(registryDir, { recursive: true });
  mkdirSync(projectRoot, { recursive: true });
  await fixtureBlockedRun(projectRoot);
  writeFileSync(join(registryDir, 'known-projects.json'), JSON.stringify([projectRoot]));

  const server = await startServer({ projectRoot, registryDir, env: { RSTACK_APPROVAL_TOKEN: 'fixture-approval-token' } });
  try {
    const wrongToken = await fetch(`${server.baseUrl}/api/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-rstack-approval-token': 'wrong' },
      body: JSON.stringify({ id: 'q-fx-blocked', resolvedBy: 'Mallory' }),
    });
    assert.ok([401, 403].includes(wrongToken.status), `wrong token rejected (got ${wrongToken.status})`);

    const badContentType = await fetch(`${server.baseUrl}/api/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain', 'x-rstack-approval-token': 'fixture-approval-token' },
      body: JSON.stringify({ id: 'q-fx-blocked', resolvedBy: 'Frank' }),
    });
    assert.ok(badContentType.status >= 400, `non-JSON content type rejected (got ${badContentType.status})`);

    const missingIdentity = await fetch(`${server.baseUrl}/api/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-rstack-approval-token': 'fixture-approval-token' },
      body: JSON.stringify({ id: 'q-fx-blocked' }),
    });
    assert.equal(missingIdentity.status, 400, 'approver identity is required');

    const unknownId = await fetch(`${server.baseUrl}/api/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-rstack-approval-token': 'fixture-approval-token' },
      body: JSON.stringify({ id: 'no-such-approval', resolvedBy: 'Frank' }),
    });
    assert.equal(unknownId.status, 404, 'unknown approval id is a structured 404');

    const success = await fetch(`${server.baseUrl}/api/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-rstack-approval-token': 'fixture-approval-token' },
      body: JSON.stringify({ id: 'q-fx-blocked', resolvedBy: 'Fixture Frank' }),
    });
    assert.equal(success.status, 200, 'valid token + identity + pending id approves');
    const body = await success.json();
    assert.equal(body.ok, true);
  } finally {
    server.stop();
    rmSync(base, { recursive: true, force: true });
  }
});

// ── Nav/container parity + landmark semantics (no server needed) ────────────
test('dashboard regression (#96): every nav destination has a container, landmarks, and honest badges', () => {
  const sidebar = sidebarMarkup();
  const pages = pageMarkup();

  const navIds = [...sidebar.matchAll(/data-page="([^"]+)"/g)].map((match) => match[1]);
  const sectionIds = [...pages.matchAll(/<section class="page[^"]*" id="page-([^"]+)"/g)].map((match) => match[1]);

  assert.ok(navIds.length > 0, 'sidebar renders nav targets');
  for (const id of navIds) {
    assert.ok(sectionIds.includes(id), `nav target "${id}" has a matching #page-${id} container`);
  }
  for (const id of sectionIds) {
    assert.ok(navIds.includes(id), `page container "${id}" is reachable from the nav`);
  }

  // Landmarks: one h1 per destination, aria-current marks the active entry.
  for (const id of sectionIds) {
    const section = pages.slice(pages.indexOf(`id="page-${id}"`));
    assert.match(section.slice(0, 600), /<h1 class="page-title">/, `destination "${id}" leads with an h1`);
  }
  assert.match(sidebar, /aria-current="page"/, 'the active nav entry carries aria-current');
  assert.match(sidebar, /aria-hidden="true"/, 'nav icons are hidden from the accessibility tree');

  // Actionable badges exist for the two attention surfaces.
  assert.match(sidebar, /id="badge-approvals"/);
  assert.match(sidebar, /id="badge-alerts"/);

  // The #279 decision surface keeps its labelled landmarks.
  assert.match(pages, /aria-labelledby="overview-outcome-title"/);
  assert.match(pages, /aria-label="Delivery stage proof"/);
});
