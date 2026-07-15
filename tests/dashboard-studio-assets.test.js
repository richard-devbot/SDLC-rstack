/**
 * Local and allow-listed assets for Agent Force Studio.
 *
 * owner: RStack developed by Richardson Gunde
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { STUDIO_CAST_MANIFEST } from '../src/observability/dashboard/ui/studio3d/assets.js';

const SERVER_PATH = join(process.cwd(), 'src', 'observability', 'dashboard', 'server.js');

test('human approver is a local seated-capable cast asset', () => {
  assert.deepEqual(STUDIO_CAST_MANIFEST.human, {
    url: '/studio3d/assets/models/human-approver.glb',
    height: 1.66,
    clipPose: 'standing',
  });
  assert.ok(Object.values(STUDIO_CAST_MANIFEST).every((entry) => entry.url.startsWith('/studio3d/')));
  const assetsSource = readFileSync(join(
    process.cwd(),
    'src', 'observability', 'dashboard', 'ui', 'studio3d', 'assets.js',
  ), 'utf8');
  assert.match(assetsSource, /mode === 'sitting'/);
  assert.match(assetsSource, /locomotion\.sit\(\)/);
});

function startServer(projectRoot) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [
      SERVER_PATH,
      '--port', '0',
      '--no-browser',
      '--project', projectRoot,
    ], {
      cwd: projectRoot,
      env: {
        ...process.env,
        RSTACK_APPROVAL_TOKEN: undefined,
        RSTACK_DASHBOARD_READ_TOKEN: undefined,
        RSTACK_BUSINESS_PORT: undefined,
        RSTACK_PROJECT_ROOT: undefined,
        RSTACK_NO_BROWSER: '1',
        RSTACK_REGISTRY_DIR: join(projectRoot, '.registry'),
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
      rejectPromise(new Error(`Studio asset server did not boot\nstdout: ${stdout}\nstderr: ${stderr}`));
    }, 15_000);
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      const match = stdout.match(/Dashboard: http:\/\/localhost:(\d+)/);
      if (!match || settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise({
        baseUrl: `http://127.0.0.1:${match[1]}`,
        stop: () => child.kill('SIGKILL'),
      });
    });
    child.on('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rejectPromise(new Error(`Studio asset server exited early (${code})\nstderr: ${stderr}`));
    });
  });
}

test('Studio serves pinned Three.js locally and rejects unlisted paths', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-studio-assets-'));
  const server = await startServer(projectRoot);
  try {
    const htmlResponse = await fetch(`${server.baseUrl}/studio3d`);
    const html = await htmlResponse.text();
    assert.equal(htmlResponse.status, 200);
    assert.doesNotMatch(html, /https?:\/\/(unpkg|cdn|jsdelivr)/);
    assert.match(html, /"three":\s*"\/studio3d\/vendor\/three\.module\.js"/);

    const three = await fetch(`${server.baseUrl}/studio3d/vendor/three.module.js`);
    assert.equal(three.status, 200);
    assert.match(three.headers.get('content-type'), /javascript/);
    assert.match(await three.text(), /WebGLRenderer/);

    const threeCore = await fetch(`${server.baseUrl}/studio3d/vendor/three.core.js`);
    assert.equal(threeCore.status, 200);
    assert.match(threeCore.headers.get('content-type'), /javascript/);
    assert.match(await threeCore.text(), /class Object3D/);

    const controls = await fetch(`${server.baseUrl}/studio3d/vendor/controls/OrbitControls.js`);
    assert.equal(controls.status, 200);
    assert.match(await controls.text(), /class OrbitControls/);

    for (const asset of [
      'assets.js',
      'behavior.js',
      'locomotion.js',
      'robot-poses.js',
      'robot.js',
      'office.js',
      'animator.js',
      'captions.js',
    ]) {
      const response = await fetch(`${server.baseUrl}/studio3d/assets/${asset}`);
      assert.equal(response.status, 200, asset);
      assert.match(response.headers.get('content-type'), /javascript/);
    }

    const human = await fetch(`${server.baseUrl}${STUDIO_CAST_MANIFEST.human.url}`);
    assert.equal(human.status, 200);
    assert.match(human.headers.get('content-type'), /model\/gltf-binary|application\/octet-stream/);

    // The world-label overlay module is gone and stays un-served.
    assert.equal((await fetch(`${server.baseUrl}/studio3d/assets/overlays.js`)).status, 404);
    assert.equal((await fetch(`${server.baseUrl}/studio3d/vendor/..%2F..%2Fpackage.json`)).status, 404);
    assert.equal((await fetch(`${server.baseUrl}/studio3d/vendor/not-allowed.js`)).status, 404);
    assert.equal((await fetch(`${server.baseUrl}/studio3d/assets/not-allowed.js`)).status, 404);
  } finally {
    server.stop();
    rmSync(projectRoot, { recursive: true, force: true });
  }
});
