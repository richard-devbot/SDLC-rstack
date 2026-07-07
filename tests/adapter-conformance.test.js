/**
 * Adapter conformance — the generic bridge must expose exactly the Pi adapter's
 * sdlc_* tool surface. This is the machine-checkable half of
 * docs/integrations/adapter-contract.md: if a new tool is added to (or removed
 * from) the Pi adapter, the bridge tracks it automatically (it loads the Pi
 * adapter), so this test pins that the bridge's advertised surface and the Pi
 * adapter's registered surface can never silently diverge.
 *
 * Adapters (Operator, Tau, custom) drive the bridge by tool name, so this is
 * the single source of truth every Python adapter is written against.
 *
 * owner: RStack developed by Richardson Gunde
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import activate from '../src/integrations/pi/rstack-sdlc.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BRIDGE = resolve(__dirname, '..', 'bin', 'rstack-bridge.ts');

/** Register the Pi adapter against a mock Pi and return its sdlc_* tool names. */
async function piAdapterToolNames() {
  const names = [];
  const mockPi = {
    registerTool: (tool) => { names.push(tool.name); },
    registerCommand: () => {},
    on: () => {},
    config: {},
    tools: new Proxy({}, { get: () => ({ execute: async () => ({}) }) }),
  };
  await activate(mockPi);
  return names.filter((n) => n.startsWith('sdlc_')).sort();
}

function bridgeListTools(projectRoot) {
  return new Promise((resolveRun) => {
    const proc = spawn('npx', ['tsx', BRIDGE, '--list-tools'], {
      cwd: resolve(__dirname, '..'),
      env: { ...process.env, RSTACK_PROJECT_ROOT: projectRoot, RSTACK_NO_BUSINESS_HUB: '1', RSTACK_NO_BROWSER: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (c) => { stdout += c.toString(); });
    proc.stderr.on('data', (c) => { stderr += c.toString(); });
    proc.on('close', (code) => resolveRun({ code, stdout, stderr }));
  });
}

test('bridge exposes exactly the Pi adapter sdlc_* tool surface', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-conf-'));
  const expected = await piAdapterToolNames();
  assert.ok(expected.length > 0, 'Pi adapter registers at least one sdlc_* tool');

  const { code, stdout, stderr } = await bridgeListTools(projectRoot);
  assert.equal(code, 0, `bridge --list-tools exited ${code}: ${stderr}`);

  const advertised = JSON.parse(stdout).filter((n) => n.startsWith('sdlc_')).sort();
  assert.deepEqual(advertised, expected,
    'bridge sdlc_* surface must match the Pi adapter registry exactly — an adapter has silently diverged from the contract');
});

test('operator-bridge shim advertises the same surface as the generic bridge', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-conf-op-'));
  const shim = resolve(__dirname, '..', 'bin', 'rstack-operator-bridge.ts');
  const run = () => new Promise((res) => {
    const proc = spawn('npx', ['tsx', shim, '--list-tools'], {
      cwd: resolve(__dirname, '..'),
      env: { ...process.env, RSTACK_PROJECT_ROOT: projectRoot, RSTACK_NO_BUSINESS_HUB: '1', RSTACK_NO_BROWSER: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (c) => { stdout += c.toString(); });
    proc.stderr.on('data', (c) => { stderr += c.toString(); });
    proc.on('close', (code) => res({ code, stdout, stderr }));
  });

  const { code, stdout, stderr } = await run();
  assert.equal(code, 0, `operator-bridge --list-tools exited ${code}: ${stderr}`);
  const expected = await piAdapterToolNames();
  const advertised = JSON.parse(stdout).filter((n) => n.startsWith('sdlc_')).sort();
  assert.deepEqual(advertised, expected, 'operator-bridge shim must delegate to the generic bridge without changing the tool surface');
});
