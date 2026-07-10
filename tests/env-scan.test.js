// owner: RStack developed by Richardson Gunde
//
// `rstack-agents env scan` (#237): run-mode proposal follows the run-modes
// contract (OPERATING-STANDARD §8), detection is delegated to the adopt
// scanner (never duplicated), setup_needs derive from integrations.json
// platform choices vs env-var presence, and the whole thing stays read-only.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import { envScan, deriveSetupNeeds, RUN_MODES } from '../src/commands/env-scan.js';

const execFileAsync = promisify(execFile);
const BIN = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'rstack-agents.js');

function seedProject(files = {}) {
  const root = mkdtempSync(join(tmpdir(), 'rstack-env-scan-'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'demo', devDependencies: { jest: '^29' } }));
  for (const [relPath, content] of Object.entries(files)) {
    const filePath = join(root, ...relPath.split('/'));
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, typeof content === 'string' ? content : JSON.stringify(content));
  }
  return root;
}

function seedGitHistory(root) {
  mkdirSync(join(root, '.git', 'refs', 'heads'), { recursive: true });
  writeFileSync(join(root, '.git', 'refs', 'heads', 'main'), 'deadbeef\n');
}

test('greenfield: no runs, no git history — even with manifests present', async () => {
  const root = seedProject();
  const report = await envScan(root);
  assert.equal(report.proposed_run_mode, 'greenfield');
  assert.ok(report.run_mode_evidence.some((item) => /no git commit history/.test(item)));
  assert.deepEqual(report.setup_needs, []);
  // Reuses the adopt scanner shape verbatim — no duplicated detection.
  assert.ok(report.toolchain.languages.some((entry) => entry.language === 'javascript'));
});

test('git init with zero commits is NOT history — stays greenfield', async () => {
  const root = seedProject();
  mkdirSync(join(root, '.git', 'refs', 'heads'), { recursive: true });
  const report = await envScan(root);
  assert.equal(report.proposed_run_mode, 'greenfield');
});

test('brownfield: git history + manifests + no .rstack runs', async () => {
  const root = seedProject();
  seedGitHistory(root);
  const report = await envScan(root);
  assert.equal(report.proposed_run_mode, 'brownfield');
  assert.ok(report.run_mode_evidence.some((item) => /commit history/.test(item)));
  assert.ok(report.run_mode_evidence.some((item) => /package\.json/.test(item)));
  assert.ok(report.run_mode_evidence.some((item) => /never adopted/.test(item)));
});

test('brownfield: latest run carries adoption markers (each marker form)', async () => {
  for (const files of [
    { '.rstack/runs/adopt-1/manifest.json': { run_id: 'adopt-1', mode: 'adopt' } },
    { '.rstack/runs/adopt-1/manifest.json': { run_id: 'adopt-1' }, '.rstack/runs/adopt-1/artifacts/adoption_report.json': { source: 'brownfield-adoption' } },
    { '.rstack/runs/adopt-1/manifest.json': { run_id: 'adopt-1' }, '.rstack/runs/adopt-1/artifacts/stages/00-environment/environment_report.json': { source: 'brownfield-adoption' } },
  ]) {
    const root = seedProject(files);
    const report = await envScan(root);
    assert.equal(report.proposed_run_mode, 'brownfield');
    assert.ok(report.run_mode_evidence.some((item) => /adopt-1/.test(item)));
  }
});

test('feature: an adoption run exists alongside a later non-adoption run', async () => {
  const root = seedProject({
    '.rstack/runs/adopt-1/manifest.json': { run_id: 'adopt-1', mode: 'adopt' },
    '.rstack/runs/run-2/manifest.json': { run_id: 'run-2' },
  });
  const report = await envScan(root);
  assert.equal(report.proposed_run_mode, 'feature');
  assert.ok(report.run_mode_evidence.some((item) => /adopt-1/.test(item)));
  assert.ok(report.run_mode_evidence.some((item) => /run-2/.test(item)));
});

test('greenfield: runs exist but none are adoption runs — git history does not flip it', async () => {
  const root = seedProject({ '.rstack/runs/run-1/manifest.json': { run_id: 'run-1' } });
  seedGitHistory(root);
  const report = await envScan(root);
  assert.equal(report.proposed_run_mode, 'greenfield');
  assert.ok(report.run_mode_evidence.some((item) => /no adoption markers/.test(item)));
});

test('proposed mode is always one of the contract run modes', async () => {
  const root = seedProject();
  const report = await envScan(root);
  assert.ok(RUN_MODES.includes(report.proposed_run_mode));
});

test('setup_needs derive from integrations.json platforms vs env presence', () => {
  const integrations = {
    ticketing: { provider: 'jira', base_url: 'https://x.atlassian.net' },
    docs: { provider: 'confluence' },
    notifications: { channel: 'slack' },
  };
  const needs = deriveSetupNeeds(integrations, { JIRA_API_TOKEN: 'set', JIRA_PROJECT_KEY: 'KEY', RSTACK_SLACK_WEBHOOK: 'https://hooks' });
  const ticketing = needs.find((need) => need.kind === 'ticketing');
  // base_url comes from the config file, so it is NOT a required env var.
  assert.deepEqual(ticketing, { kind: 'ticketing', platform: 'jira', required_vars: ['JIRA_API_TOKEN', 'JIRA_PROJECT_KEY'], satisfied: true });
  const docs = needs.find((need) => need.kind === 'docs');
  assert.equal(docs.satisfied, false);
  assert.deepEqual(docs.required_vars, ['CONFLUENCE_BASE_URL', 'CONFLUENCE_API_TOKEN']);
  const notifications = needs.find((need) => need.kind === 'notifications');
  assert.deepEqual(notifications, { kind: 'notifications', platform: 'slack', required_vars: ['RSTACK_SLACK_WEBHOOK'], satisfied: true });
});

test('setup_needs: file-based ticketing is satisfied with no vars; none/unset sections are skipped', () => {
  const needs = deriveSetupNeeds({ ticketing: { provider: 'file-based' }, docs: { provider: 'none' }, notifications: { channel: 'none' } }, {});
  assert.deepEqual(needs, [{ kind: 'ticketing', platform: 'file-based', required_vars: [], satisfied: true }]);
  assert.deepEqual(deriveSetupNeeds(null, {}), []);
  assert.deepEqual(deriveSetupNeeds({}, {}), []);
  // Unknown providers derive nothing — config validation flags them.
  assert.deepEqual(deriveSetupNeeds({ ticketing: { provider: 'carrier-pigeon' } }, {}), []);
});

test('envScan reads .rstack/integrations.json for setup_needs', async () => {
  const root = seedProject({ '.rstack/integrations.json': { ticketing: { provider: 'linear' } } });
  const report = await envScan(root, { env: {} });
  assert.deepEqual(report.setup_needs, [{ kind: 'ticketing', platform: 'linear', required_vars: ['LINEAR_API_KEY'], satisfied: false }]);
});

test('CLI: env scan --json prints the machine shape and writes nothing', async () => {
  const root = seedProject();
  const before = readdirSync(root).sort();
  const { stdout } = await execFileAsync(process.execPath, [BIN, 'env', 'scan', '--project', root, '--json']);
  const report = JSON.parse(stdout);
  assert.equal(report.proposed_run_mode, 'greenfield');
  assert.ok(Array.isArray(report.run_mode_evidence));
  assert.ok(Array.isArray(report.setup_needs));
  assert.deepEqual(readdirSync(root).sort(), before, 'env scan must be read-only');
  assert.ok(!existsSync(join(root, '.rstack')), 'env scan must not create .rstack');
});

test('CLI: env scan text output names the run mode and next step', async () => {
  const root = seedProject();
  seedGitHistory(root);
  const { stdout } = await execFileAsync(process.execPath, [BIN, 'env', 'scan', '--project', root]);
  assert.match(stdout, /Proposed run mode: brownfield/);
  assert.match(stdout, /ONE Decision Queue item/);
});
