import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import extension from '../extensions/rstack-sdlc.ts';

// owner: RStack developed by Richardson Gunde
//
// #261: RSTACK_VERSION was a hand-maintained literal that drifted (0.3.0
// stamped into every manifest while the package shipped 2.0.0). The stamp is
// now derived from package.json; this pin fails on any future drift by
// construction.

const PKG = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'));

const mockPi = {
  tools: {},
  commands: {},
  on: () => {},
  registerTool(tool) {
    this.tools[tool.name] = tool;
  },
  registerCommand(cmd, opts) {
    this.commands[cmd] = opts;
  }
};

test('run manifests stamp rstack_version from package.json, never a drifting literal', async (t) => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-version-stamp-'));
  process.env.RSTACK_PROJECT_ROOT = projectRoot;
  t.after(() => {
    delete process.env.RSTACK_PROJECT_ROOT;
    rmSync(projectRoot, { recursive: true, force: true });
  });

  extension(mockPi);

  const start = await mockPi.tools.sdlc_start.execute('1', { goal: 'Version stamp check' });
  assert.equal(start.details.rstack_version, PKG.version,
    'sdlc_start response reports the real package version');

  const manifest = JSON.parse(readFileSync(join(projectRoot, '.rstack', 'runs', start.details.run_id, 'manifest.json'), 'utf8'));
  assert.equal(manifest.rstack_version, PKG.version,
    'the persisted manifest stamps the real package version');
  assert.match(PKG.version, /^\d+\.\d+\.\d+/, 'sanity: package.json version is a real semver');
});
