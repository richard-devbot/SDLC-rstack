/**
 * Production hardening (#150): approval-token file rotation and TLS
 * misconfiguration behavior, exercised against the real server process
 * (--port 0) with a throwaway project root.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
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
        rejectPromise(new Error(`dashboard server did not boot in time\nstdout: ${stdout}\nstderr: ${stderr}`));
      }
    }, 15_000);
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      const match = stdout.match(/Dashboard: https?:\/\/localhost:(\d+)/);
      if (match && !settled) {
        settled = true;
        clearTimeout(timer);
        resolvePromise({ child, baseUrl: `http://127.0.0.1:${match[1]}`, stop: () => child.kill('SIGKILL') });
      }
    });
    child.on('exit', (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        rejectPromise(new Error(`exited early (code ${code})\nstderr: ${stderr}`));
      }
    });
  });
}

function approve(baseUrl, token) {
  return fetch(`${baseUrl}/api/approve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'x-rstack-approval-token': token } : {}),
    },
    body: JSON.stringify({ id: 'no-such-approval', resolvedBy: 'test' }),
  });
}

test('RSTACK_APPROVAL_TOKEN_FILE rotates the credential without a server restart', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-hardening150-'));
  const tokenFile = join(projectRoot, 'approval-token.txt');
  await writeFile(tokenFile, 'tok-A\n');

  const server = await startServer({ projectRoot, env: { RSTACK_APPROVAL_TOKEN_FILE: tokenFile } });
  try {
    // Correct token passes auth (404 = auth ok, approval id unknown).
    const authorized = await approve(server.baseUrl, 'tok-A');
    assert.notEqual(authorized.status, 401);
    assert.notEqual(authorized.status, 403);

    // Wrong token is rejected via the timing-safe comparison path.
    assert.equal((await approve(server.baseUrl, 'tok-WRONG')).status, 401);

    // Rotate the file: the old token dies and the new one works immediately.
    await writeFile(tokenFile, 'tok-B\n');
    assert.equal((await approve(server.baseUrl, 'tok-A')).status, 401);
    const rotated = await approve(server.baseUrl, 'tok-B');
    assert.notEqual(rotated.status, 401);
    assert.notEqual(rotated.status, 403);
  } finally {
    server.stop();
  }
});

test('half-configured TLS fails loudly at startup instead of silently serving HTTP', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-hardening150-tls-'));
  await assert.rejects(
    startServer({ projectRoot, env: { RSTACK_TLS_CERT: join(projectRoot, 'cert.pem') } }),
    /exited early/,
  );
});
