/**
 * Adapter conformance (docs/integrations/adapter-contract.md §1/§6):
 * every shipped adapter must expose exactly the sdlc_* tool surface the Pi
 * adapter registers. The generic bridge's --list mode IS the Pi registry
 * (it loads the Pi adapter with a mock host and prints the captured names),
 * so comparing each adapter's declared tool table against it catches silent
 * divergence in either direction.
 *
 * owner: RStack developed by Richardson Gunde
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dirname, '..');
const GENERIC_BRIDGE = join(PACKAGE_ROOT, 'bin', 'rstack-bridge.ts');

function runBridge(args, env = {}) {
  return new Promise((resolveRun) => {
    const proc = spawn('npx', ['tsx', GENERIC_BRIDGE, ...args], {
      cwd: PACKAGE_ROOT,
      env: {
        ...process.env,
        RSTACK_PROJECT_ROOT: mkdtempSync(join(tmpdir(), 'rstack-bridge-')),
        RSTACK_NO_BUSINESS_HUB: '1',
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (c) => { stdout += c.toString(); });
    proc.stderr.on('data', (c) => { stderr += c.toString(); });
    proc.on('close', (code) => resolveRun({ code, stdout, stderr }));
  });
}

/** Tool names a Python adapter declares in its `_TOOLS` dict. */
function pythonAdapterTools(relPath) {
  const source = readFileSync(join(PACKAGE_ROOT, relPath), 'utf8');
  const names = [...source.matchAll(/"(sdlc_[a-z_]+)":\s*\(/g)].map((m) => m[1]);
  assert.ok(names.length > 0, `${relPath} declares at least one sdlc_* tool`);
  return names.sort();
}

test('bridge conformance: adapters match the Pi registry', async (t) => {
  const listed = await runBridge(['--list']);
  assert.equal(listed.code, 0, `--list exited ${listed.code}: ${listed.stderr}`);
  const piTools = JSON.parse(listed.stdout);

  await t.test('--list returns the sorted Pi tool registry', () => {
    assert.ok(Array.isArray(piTools), '--list prints a JSON array');
    assert.ok(piTools.length >= 15, `registry has a real tool surface (got ${piTools.length})`);
    assert.deepEqual(piTools, [...piTools].sort(), 'listing is sorted');
    for (const name of ['sdlc_start', 'sdlc_plan', 'sdlc_build_next', 'sdlc_validate', 'sdlc_approve', 'sdlc_status']) {
      assert.ok(piTools.includes(name), `core tool ${name} present`);
    }
  });

  await t.test('Operator adapter tool surface matches the Pi registry exactly', () => {
    assert.deepEqual(
      pythonAdapterTools('src/integrations/operator/rstack_sdlc.py'),
      [...piTools].sort(),
      'src/integrations/operator/rstack_sdlc.py diverged from the Pi adapter — sync its _TOOLS table (adapter-contract.md §1)',
    );
  });

  await t.test('Tau adapter tool surface matches the Pi registry exactly', () => {
    assert.deepEqual(
      pythonAdapterTools('src/integrations/tau/rstack_sdlc.py'),
      [...piTools].sort(),
      'src/integrations/tau/rstack_sdlc.py diverged from the Pi adapter — sync its _TOOLS table (adapter-contract.md §1)',
    );
  });

  await t.test('Hermes adapter tool surface matches the Pi registry exactly', () => {
    assert.deepEqual(
      pythonAdapterTools('src/integrations/hermes/rstack_sdlc.py'),
      [...piTools].sort(),
      'src/integrations/hermes/rstack_sdlc.py diverged from the Pi adapter — sync its _TOOLS table (adapter-contract.md §1)',
    );
  });
});

test('generic bridge runs a tool and returns JSON with text content', async () => {
  const { code, stdout, stderr } = await runBridge(['sdlc_agents', JSON.stringify({ limit: 5 })]);
  assert.equal(code, 0, `bridge exited ${code}: ${stderr}`);
  const result = JSON.parse(stdout);
  assert.ok(Array.isArray(result.content), 'result has a content array');
  assert.equal(result.content[0].type, 'text');
});

test('generic bridge reports unknown tools with a non-zero exit and the available listing', async () => {
  const { code, stderr } = await runBridge(['sdlc_does_not_exist', '{}']);
  assert.notEqual(code, 0);
  assert.match(stderr, /unknown tool/);
  assert.match(stderr, /sdlc_start/, 'stderr names the available tools');
});
