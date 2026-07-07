/**
 * Environment & Integrations state builder + page module (#238).
 *
 * The builder must be DEFENSIVE against the #237 artifacts: an absent
 * environment_report.json / integrations.json / .env — or a legacy v1
 * report without the v2 fields — yields honest empty state, never a crash.
 * Secrets stay out of the snapshot: env values, webhook URLs, tokens.
 *
 * owner: RStack developed by Richardson Gunde
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { buildEnvironmentState, ENV_WRITE_ARTIFACT_PREFIX } from '../src/observability/dashboard/state/environment.js';
import { environmentScript } from '../src/observability/dashboard/ui/pages/environment.js';
import { clientScript } from '../src/observability/dashboard/ui/client.js';
import { buildActivityFeed } from '../src/observability/dashboard/state/feed.js';
import { liveFeedScript } from '../src/observability/dashboard/ui/pages/live-feed.js';

function tempRoot({ git = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'rstack-env-state-'));
  if (git) {
    execFileSync('git', ['init', '-q'], { cwd: root });
    writeFileSync(join(root, '.gitignore'), '.env\n');
  }
  return root;
}

function seedRun(root, runId, { report } = {}) {
  const runDir = join(root, '.rstack', 'runs', runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, 'manifest.json'), JSON.stringify({ run_id: runId, created_at: `2026-07-0${runId.slice(-1)}T08:00:00.000Z` }));
  if (report !== undefined) {
    const stageDir = join(runDir, 'artifacts', 'stages', '00-environment');
    mkdirSync(stageDir, { recursive: true });
    writeFileSync(join(stageDir, 'environment_report.json'), typeof report === 'string' ? report : JSON.stringify(report));
  }
  return { runId, projectRoot: root, manifest: { created_at: `2026-07-0${runId.slice(-1)}T08:00:00.000Z` } };
}

test('empty project: absent report/integrations/.env is honest empty state, never a crash', async () => {
  const root = tempRoot();
  try {
    const state = await buildEnvironmentState(root, [], []);
    assert.equal(state.report, null);
    assert.equal(state.integrations, null);
    assert.deepEqual(state.env.keys, []);
    assert.equal(state.env.exists, false);
    assert.equal(state.env.gitignored, true, '.gitignore covers .env in the fixture repo');
    assert.deepEqual(state.envApprovals, []);
    assert.deepEqual(state.pendingEnvApprovals, []);
    assert.ok(Array.isArray(state.notifications.channels));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('legacy v1 report: v2 fields come back null/empty, v1 tools normalized', async () => {
  const root = tempRoot();
  try {
    const run = seedRun(root, 'run-1', {
      report: { tools: { git: true, docker: false, node: '20.1.0' }, pipeline_ready: true, status: 'PASS' },
    });
    const state = await buildEnvironmentState(root, [run], []);
    assert.equal(state.report.runId, 'run-1');
    assert.equal(state.report.run_mode, null, 'no fabricated run_mode on a v1 report');
    assert.deepEqual(state.report.run_mode_evidence, []);
    assert.deepEqual(state.report.setup_needs, []);
    assert.deepEqual(state.report.user_preferences, {});
    assert.equal(state.report.pipeline_ready, true);
    assert.deepEqual(state.report.tools, [
      { name: 'git', available: true, detail: null },
      { name: 'docker', available: false, detail: null },
      { name: 'node', available: true, detail: '20.1.0' },
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('v2 report fields (#237) surface; newest run wins; malformed JSON never crashes', async () => {
  const root = tempRoot();
  try {
    const older = seedRun(root, 'run-1', { report: { tools: { git: true } } });
    const corrupt = seedRun(root, 'run-2', { report: '{not json' });
    const newest = seedRun(root, 'run-3', {
      report: {
        run_mode: 'brownfield',
        run_mode_evidence: ['package.json present', 'git history: 214 commits'],
        user_preferences: { ticketing_platform: 'jira', secret_field: 'must-not-copy' },
        setup_needs: [
          { kind: 'ticketing', platform: 'jira', required_vars: ['JIRA_TOKEN'], satisfied: false },
          'junk-entry',
        ],
        tools: { git: true },
      },
    });
    const state = await buildEnvironmentState(root, [older, corrupt, newest], []);
    assert.equal(state.report.runId, 'run-3', 'newest run with a parseable report wins');
    assert.equal(state.report.run_mode, 'brownfield');
    assert.deepEqual(state.report.user_preferences, { ticketing_platform: 'jira' }, 'credential-shaped preference fields are never copied');
    assert.deepEqual(state.report.setup_needs, [
      { kind: 'ticketing', platform: 'jira', required_vars: ['JIRA_TOKEN'], satisfied: false },
    ], 'junk setup_needs entries dropped');
    // A corrupt newest report falls back to the next run's report.
    const fallback = await buildEnvironmentState(root, [corrupt, older], []);
    assert.equal(fallback.report.runId, 'run-1');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('env keys carry names and lengths only; integrations copied selectively; webhook URLs stay behind', async () => {
  const root = tempRoot();
  try {
    writeFileSync(join(root, '.env'), 'API_SECRET="super-secret-value"\n');
    mkdirSync(join(root, '.rstack'), { recursive: true });
    // The shipped #237 schema (INTEGRATIONS_TEMPLATE): ticketing/docs/
    // notifications sections. A stray credential-shaped field must not ride.
    writeFileSync(join(root, '.rstack', 'integrations.json'), JSON.stringify({
      ticketing: { provider: 'jira', base_url: 'https://acme.atlassian.net', project_key: 'RST', api_token: 'oops-a-secret' },
      docs: { provider: 'confluence', space_key: 'ENG' },
      notifications: { channel: 'slack' },
    }));
    writeFileSync(join(root, '.rstack', 'notifications.json'), JSON.stringify({
      channels: { slack: { webhook: 'https://hooks.slack.com/services/T000/B000/supersecret' } },
    }));
    const state = await buildEnvironmentState(root, [], []);
    assert.deepEqual(state.env.keys, [{ key: 'API_SECRET', set: true, length: 18 }]);
    assert.deepEqual(state.integrations.ticketing, { provider: 'jira', base_url: 'https://acme.atlassian.net', project_key: 'RST' });
    assert.deepEqual(state.integrations.docs, { provider: 'confluence', space_key: 'ENG' });
    assert.deepEqual(state.integrations.notifications, { channel: 'slack' });
    assert.deepEqual(state.notifications.channels, ['slack'], 'channel names only');
    const serialized = JSON.stringify(state);
    assert.ok(!serialized.includes('super-secret-value'), 'env value never in the snapshot');
    assert.ok(!serialized.includes('oops-a-secret'), 'stray integrations secret never copied');
    assert.ok(!serialized.includes('hooks.slack.com'), 'webhook URL never in the snapshot');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('env-write queue approvals are filtered by artifact prefix and mapped with the key', async () => {
  const root = tempRoot();
  try {
    const state = await buildEnvironmentState(root, [], [
      { id: 'env-write:JIRA_TOKEN', artifact: `${ENV_WRITE_ARTIFACT_PREFIX}JIRA_TOKEN`, status: 'pending', ts: '2026-07-07T10:00:00.000Z', requestedBy: 'rich' },
      { id: 'env-write:OLD_KEY', artifact: `${ENV_WRITE_ARTIFACT_PREFIX}OLD_KEY`, status: 'consumed', ts: '2026-07-06T10:00:00.000Z' },
      { id: 'gate:run-1::plan.md', artifact: 'plan.md', status: 'pending', ts: '2026-07-07T09:00:00.000Z' },
    ]);
    assert.equal(state.envApprovals.length, 2, 'non-env approvals excluded');
    assert.deepEqual(state.envApprovals.map((a) => a.key), ['JIRA_TOKEN', 'OLD_KEY']);
    assert.deepEqual(state.pendingEnvApprovals.map((a) => a.key), ['JIRA_TOKEN']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('env_key_written feed line carries key/actor/length — never a value field', () => {
  const feed = buildActivityFeed([{
    runId: 'run-1',
    projectRoot: '/tmp/p',
    manifest: { goal: 'g' },
    events: [{
      ts: '2026-07-07T10:00:00.000Z',
      type: 'env_key_written',
      key: 'JIRA_TOKEN',
      actor: 'rich',
      masked_value_length: 26,
    }],
  }]);
  const item = feed.find((entry) => entry.type === 'env_key_written');
  assert.ok(item, 'event renders in the feed');
  assert.match(item.summary, /JIRA_TOKEN/);
  assert.match(item.summary, /rich/);
  assert.match(item.summary, /never logged/);
  assert.deepEqual(item.data, { key: 'JIRA_TOKEN', actor: 'rich', masked_value_length: 26 });
  assert.equal(item.level, 'info');
  // Live-feed icon registered for the type.
  assert.match(liveFeedScript, /env_key_written: 'EV'/);
});

test('page module registers and the bundle stays compilable with it included', () => {
  assert.match(environmentScript, /── page: environment ─/);
  assert.match(environmentScript, /registerPage\('environment',/);
  // The write flow never persists the value client-side either.
  assert.ok(!/localStorage\.setItem\([^)]*VALUE/i.test(environmentScript));
  assert.match(environmentScript, /ENV_HELD_VALUES/, 'value held in tab memory only');
  const bundle = clientScript(3008);
  assert.match(bundle, /registerPage\('environment',/);
  assert.doesNotThrow(() => new Function(bundle));
});
