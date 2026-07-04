/**
 * Read-path authentication (#164): read token on GET APIs, foreign-Origin
 * rejection on reads and WebSocket upgrades — against the real server
 * process (--port 0) with a throwaway project root.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SERVER_PATH = join(process.cwd(), 'src', 'observability', 'dashboard', 'server.js');

function startServer({ projectRoot, env = {} }) {
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
        RSTACK_REGISTRY_DIR: join(projectRoot, '.registry'),
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill('SIGKILL');
        rejectPromise(new Error(`server did not boot\nstderr: ${stderr}`));
      }
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
    child.on('exit', (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        rejectPromise(new Error(`exited early (${code})\nstderr: ${stderr}`));
      }
    });
  });
}

// Raw upgrade attempt: resolves 'upgraded' on a 101, otherwise the denial
// status line or socket close.
function tryWebSocketUpgrade(port, { origin, path = '/' } = {}) {
  return new Promise((resolvePromise) => {
    const req = request({
      host: '127.0.0.1',
      port,
      path,
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Key': Buffer.from('0123456789abcdef').toString('base64'),
        'Sec-WebSocket-Version': '13',
        ...(origin ? { Origin: origin } : {}),
      },
    });
    req.on('upgrade', (res, socket) => { socket.destroy(); resolvePromise('upgraded'); });
    req.on('response', (res) => resolvePromise(`denied:${res.statusCode}`));
    req.on('error', () => resolvePromise('closed'));
    req.end();
    setTimeout(() => resolvePromise('timeout'), 5000);
  });
}

test('read token gates state, artifact, and run-report APIs; header and query param both work', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-read-auth-'));
  const server = await startServer({ projectRoot, env: { RSTACK_DASHBOARD_READ_TOKEN: 'read-tok' } });
  try {
    for (const path of ['/api/state', '/api/artifact?run=x&path=y', '/api/run-report?run=x']) {
      const denied = await fetch(`${server.baseUrl}${path}`);
      assert.equal(denied.status, 401, `${path} must 401 without the read token`);
    }
    const viaHeader = await fetch(`${server.baseUrl}/api/state`, { headers: { 'x-rstack-read-token': 'read-tok' } });
    assert.equal(viaHeader.status, 200);
    const viaParam = await fetch(`${server.baseUrl}/api/state?token=read-tok`);
    assert.equal(viaParam.status, 200);
    assert.equal((await fetch(`${server.baseUrl}/api/state`, { headers: { 'x-rstack-read-token': 'wrong' } })).status, 401);
  } finally {
    server.stop();
  }
});

test('without a configured read token, reads stay open (back-compat) but foreign origins are rejected', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-read-auth-open-'));
  const server = await startServer({ projectRoot });
  try {
    assert.equal((await fetch(`${server.baseUrl}/api/state`)).status, 200);
    const foreign = await fetch(`${server.baseUrl}/api/state`, { headers: { Origin: 'https://evil.example.com' } });
    assert.equal(foreign.status, 403, 'foreign-Origin reads must be rejected even without a token configured');
  } finally {
    server.stop();
  }
});

test('WebSocket upgrades reject foreign origins always, and require the read token when configured', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-read-auth-ws-'));
  const server = await startServer({ projectRoot, env: { RSTACK_DASHBOARD_READ_TOKEN: 'read-tok' } });
  try {
    assert.match(await tryWebSocketUpgrade(server.port, { origin: 'https://evil.example.com', path: '/?token=read-tok' }), /denied:403|closed/);
    assert.match(await tryWebSocketUpgrade(server.port, {}), /denied:401|closed/, 'missing token must not upgrade');
    assert.equal(await tryWebSocketUpgrade(server.port, { path: '/?token=read-tok' }), 'upgraded');
    assert.equal(await tryWebSocketUpgrade(server.port, { origin: 'http://localhost:3008', path: '/?token=read-tok' }), 'upgraded');
  } finally {
    server.stop();
  }
});
