import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildFullState } from '../src/observability/dashboard/state/index.js';

// owner: RStack developed by Richardson Gunde
//
// Golden-path e2e (#275): the 2026-07-10 dogfooding wave (#261–#266, then
// #289/#298) shared one root cause — nobody re-ran the documented quick-start
// as a new user after internals changed underneath it. This test IS that
// journey: the bridge-only flow from docs/quick-start-guide.md, one real
// subprocess per tool call (exactly what Claude Code / Tau / Operator / the
// bare terminal do), asserting every documented outcome so the class cannot
// regress silently. Deliberately NOT mock-pi: the mocks share a process and
// would hide cross-process bugs like #289.
//
// #274 landed: validate-time retry exhaustion enqueues the guardrail-override
// approval card — asserted in the "budget exhaustion" step below.

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dirname, '..');
const GENERIC_BRIDGE = join(PACKAGE_ROOT, 'bin', 'rstack-bridge.ts');
const CLI = join(PACKAGE_ROOT, 'bin', 'rstack-agents.js');
const PKG = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'));

function spawnCollect(cmd, args, env = {}) {
  return new Promise((resolveRun) => {
    const proc = spawn(cmd, args, {
      cwd: PACKAGE_ROOT,
      env: { ...process.env, RSTACK_NO_BUSINESS_HUB: '1', RSTACK_NO_BROWSER: '1', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (c) => { stdout += c.toString(); });
    proc.stderr.on('data', (c) => { stderr += c.toString(); });
    proc.on('close', (code) => resolveRun({ code, stdout, stderr }));
  });
}

test('golden path: the documented bridge-driven quick-start works end to end', { timeout: 300_000 }, async (t) => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-golden-path-'));
  t.after(() => rmSync(projectRoot, { recursive: true, force: true }));

  const bridge = (tool, params) =>
    spawnCollect('npx', ['tsx', GENERIC_BRIDGE, tool, JSON.stringify(params)], { RSTACK_PROJECT_ROOT: projectRoot });
  const cli = (...args) => spawnCollect(process.execPath, [CLI, ...args]);

  let runId;
  const runFile = (rel) => join(projectRoot, '.rstack', 'runs', runId, rel);
  const readRunJson = (rel) => JSON.parse(readFileSync(runFile(rel), 'utf8'));

  await t.test('sdlc_start: real version stamp (#261), persisted state (#262), session pin (#289)', async () => {
    const res = await bridge('sdlc_start', { goal: 'Build a health-check API endpoint' });
    assert.equal(res.code, 0, res.stderr);
    const details = JSON.parse(res.stdout).details;
    runId = details.run_id;
    assert.equal(details.rstack_version, PKG.version, 'response reports the real package version');
    assert.equal(readRunJson('manifest.json').rstack_version, PKG.version, 'manifest stamps the real package version');
    assert.ok(existsSync(runFile('pipeline-state.json')), 'pipeline state is persisted from the very first tool call');
    const pin = JSON.parse(readFileSync(join(projectRoot, '.rstack', 'session.json'), 'utf8'));
    assert.equal(pin.run_id, runId, 'the session pin survives to the next process');
  });

  await t.test('quick-start "Minute 4": plain pipeline status works, no --regenerate (#262)', async () => {
    const plan = await bridge('sdlc_plan', {});
    assert.equal(plan.code, 0, plan.stderr);
    const status = await cli('pipeline', 'status', '--project', projectRoot, '--json');
    assert.equal(status.code, 0, status.stderr);
    assert.equal(JSON.parse(status.stdout).run.run_id, runId);
    assert.ok(!/built in memory/.test(status.stderr), 'status is served from persisted state, not the fallback');
  });

  await t.test('approval gate blocks, sdlc_approve lands run-bound (#298) on the pinned run (#289)', async () => {
    const blocked = await bridge('sdlc_build_next', {});
    assert.equal(blocked.code, 0, blocked.stderr);
    assert.match(JSON.parse(blocked.stdout).content[0].text, /Approval gate blocked/);

    const approve = await bridge('sdlc_approve', { artifact: 'plan.md', status: 'APPROVED', comments: 'Looks right' });
    assert.equal(approve.code, 0, approve.stderr);
    const record = JSON.parse(approve.stdout).details;
    assert.equal(record.run_id, runId, 'the approval record is stamped with the run it belongs to');
    assert.ok(readRunJson('approvals.json').some((entry) => entry.artifact === 'plan.md' && entry.run_id === runId));
  });

  let firstTaskId;
  await t.test('the governed loop: FAIL is re-claimed, not skipped (#265); no-task validate is structured (#266)', async () => {
    const claim = await bridge('sdlc_build_next', {});
    firstTaskId = JSON.parse(claim.stdout).details.task.id;

    const fail1 = await bridge('sdlc_validate', {});
    assert.equal(JSON.parse(fail1.stdout).details.status, 'FAIL');
    assert.equal(JSON.parse(fail1.stdout).details.retry_recommendation, 'retry_builder');

    // The organic #266 repro: probing validate again after the FAIL.
    const probe = await bridge('sdlc_validate', {});
    assert.equal(probe.code, 0, 'no raw throw — the bridge exits 0 with a structured payload');
    assert.match(JSON.parse(probe.stdout).content[0].text, /No task is currently IN_PROGRESS/);

    const reclaim = await bridge('sdlc_build_next', {});
    assert.equal(JSON.parse(reclaim.stdout).details.task.id, firstTaskId,
      'the FAILED task is re-claimed before any later PENDING task');
  });

  await t.test('budget exhaustion hard-blocks with the override named; the plan does not advance (#265)', async () => {
    const fail2 = await bridge('sdlc_validate', {});
    assert.equal(JSON.parse(fail2.stdout).details.status, 'FAIL');

    const blocked = await bridge('sdlc_build_next', {});
    const details = JSON.parse(blocked.stdout).details;
    assert.equal(details.task.id, firstTaskId);
    assert.equal(details.override_artifact, `guardrail-override:${firstTaskId}`);
    const tasks = readRunJson('tasks.json').tasks;
    assert.equal(tasks.find((task) => task.id === firstTaskId).status, 'BLOCKED');
    assert.ok(tasks.slice(1).every((task) => task.status === 'PENDING'), 'later tasks stay untouched');

    // #274: the exhaustion itself enqueued the one-click override card — the
    // human sees it on the Hub without needing another claim attempt first.
    const queuePath = join(projectRoot, '.rstack', 'approvals.jsonl');
    const queue = readFileSync(queuePath, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
    const card = queue.find((entry) => entry.artifact === `guardrail-override:${firstTaskId}`);
    assert.ok(card, 'the guardrail-override approval card is in the queue');
    assert.equal(card.status, 'pending');
    assert.equal(card.runId, runId);
  });

  await t.test('an approved override resumes the blocked task and is consumed one-shot', async () => {
    await bridge('sdlc_approve', { artifact: `guardrail-override:${firstTaskId}`, status: 'APPROVED', comments: 'one more attempt' });
    const resume = await bridge('sdlc_build_next', {});
    assert.equal(JSON.parse(resume.stdout).details.task.id, firstTaskId);
    const history = readRunJson('approvals.json').filter((entry) => entry.artifact === `guardrail-override:${firstTaskId}`);
    assert.deepEqual(history.map((entry) => entry.status), ['APPROVED', 'CONSUMED'], 'override is burned in-lock at the claim');
  });

  await t.test('the Hub state layer agrees with the terminal (#264)', async () => {
    const state = await buildFullState(projectRoot, { includeRegistry: false });
    const run = state.runs.find((candidate) => candidate.runId === runId);
    assert.ok(run, 'the run is visible to the dashboard');
    assert.ok(run.approvals.some((entry) => entry.artifact === 'plan.md' && entry.status === 'APPROVED'),
      'terminal-granted approvals are visible');
    const task = run.tasks.find((candidate) => candidate.id === firstTaskId);
    assert.equal(task.status, 'IN_PROGRESS', 'task state matches disk exactly');
  });
});
