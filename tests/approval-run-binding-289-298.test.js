import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readSessionPin, writeSessionPin, resolveRunId, sessionPinPath } from '../src/core/harness/runs.js';
import { appendRunApproval } from '../src/core/tracker/approvals.js';
import { auditRunApprovals } from '../src/core/harness/approval-audit.js';
import extension from '../extensions/rstack-sdlc.ts';

// owner: RStack developed by Richardson Gunde
//
// #289 + #298: the bridge runs one process per tool call, so the in-memory
// session id never survived — a no-run_id sdlc_approve silently landed on the
// NEWEST run (the exact #98 misrouting the code forbids). And no approval
// writer stamped run_id, so the #133 cross-run replay-binding audit was inert.
// These pins cover the pin-file primitive, the stamping at every writer, the
// activated replay rejection, and the real cross-process repro via the bridge.

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dirname, '..');
const GENERIC_BRIDGE = join(PACKAGE_ROOT, 'bin', 'rstack-bridge.ts');

async function seedRun(projectRoot, runId) {
  const dir = join(projectRoot, '.rstack', 'runs', runId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'manifest.json'), JSON.stringify({ run_id: runId, goal: `Goal ${runId}`, created_at: new Date().toISOString() }));
  return dir;
}

function runBridge(projectRoot, args, env = {}) {
  return new Promise((resolveRun) => {
    const proc = spawn('npx', ['tsx', GENERIC_BRIDGE, ...args], {
      cwd: PACKAGE_ROOT,
      env: { ...process.env, RSTACK_PROJECT_ROOT: projectRoot, RSTACK_NO_BUSINESS_HUB: '1', RSTACK_NO_BROWSER: '1', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (c) => { stdout += c.toString(); });
    proc.stderr.on('data', (c) => { stderr += c.toString(); });
    proc.on('close', (code) => resolveRun({ code, stdout, stderr }));
  });
}

function runApprovals(projectRoot, runId) {
  const path = join(projectRoot, '.rstack', 'runs', runId, 'approvals.json');
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : [];
}

test('session pin primitive: write/read/staleness and resolveRunId precedence (#289)', async (t) => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-pin-'));
  t.after(() => rmSync(projectRoot, { recursive: true, force: true }));

  await seedRun(projectRoot, 'run-a');
  await seedRun(projectRoot, 'run-b'); // lexically newest

  await t.test('pin roundtrip and precedence over the newest directory', async () => {
    await writeSessionPin(projectRoot, 'run-a');
    assert.equal(readSessionPin(projectRoot), 'run-a');
    assert.equal(await resolveRunId(projectRoot), 'run-a', 'pin outranks the newest run dir');
    assert.equal(await resolveRunId(projectRoot, 'run-b'), 'run-b', 'explicit id always wins');
  });

  await t.test('a stale pin (run dir gone) is ignored, not trusted', async () => {
    await writeSessionPin(projectRoot, 'run-a');
    await rm(join(projectRoot, '.rstack', 'runs', 'run-a'), { recursive: true, force: true });
    assert.equal(readSessionPin(projectRoot), undefined);
    assert.equal(await resolveRunId(projectRoot), 'run-b', 'falls back to newest when the pin is stale');
    await seedRun(projectRoot, 'run-a'); // restore for later subtests
  });

  await t.test('a corrupt or unsafe pin file is ignored', async () => {
    await writeFile(sessionPinPath(projectRoot), 'not json');
    assert.equal(readSessionPin(projectRoot), undefined);
    await writeFile(sessionPinPath(projectRoot), JSON.stringify({ run_id: '../escape' }));
    assert.equal(readSessionPin(projectRoot), undefined, 'unsafe run ids never resolve');
  });
});

test('every approval writer stamps run_id and the replay audit is live (#298)', async (t) => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-stamp-'));
  t.after(() => rmSync(projectRoot, { recursive: true, force: true }));
  await seedRun(projectRoot, 'run-a');
  await seedRun(projectRoot, 'run-b');

  await t.test('appendRunApproval stamps the run it writes to', async () => {
    const written = await appendRunApproval(projectRoot, 'run-a', {
      artifact: 'plan.md', status: 'APPROVED', approver: 'richardson',
    });
    assert.equal(written.run_id, 'run-a');
    assert.equal(runApprovals(projectRoot, 'run-a')[0].run_id, 'run-a');
  });

  await t.test('a record stamped for run-a is REJECTED when audited as run-b (cross-run replay)', async () => {
    const replayed = runApprovals(projectRoot, 'run-a'); // copy run-a's approved record
    const audit = auditRunApprovals(replayed, { runId: 'run-b', runDir: join(projectRoot, '.rstack', 'runs', 'run-b') });
    assert.equal(audit.valid.length, 0, 'replayed record must not validate under another run');
    assert.ok(audit.rejected[0].issues.some((issue) => issue.name === 'approval_run_binding'),
      'rejection names the binding check');
  });

  await t.test('the same record validates under its own run; legacy unstamped records stay valid', async () => {
    const records = runApprovals(projectRoot, 'run-a');
    const own = auditRunApprovals(records, { runId: 'run-a', runDir: join(projectRoot, '.rstack', 'runs', 'run-a') });
    assert.equal(own.valid.length, 1);

    const legacy = [{ id: 'app-legacy', artifact: 'plan.md', status: 'APPROVED', approver: 'r', timestamp: new Date().toISOString() }];
    const grand = auditRunApprovals(legacy, { runId: 'run-b', runDir: join(projectRoot, '.rstack', 'runs', 'run-b') });
    assert.equal(grand.valid.length, 1, 'records predating the stamp are grandfathered');
  });
});

test('sdlc_start persists the pin and sdlc_approve stamps + names the run (in-process)', async (t) => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-pin-ext-'));
  process.env.RSTACK_PROJECT_ROOT = projectRoot;
  t.after(() => {
    delete process.env.RSTACK_PROJECT_ROOT;
    rmSync(projectRoot, { recursive: true, force: true });
  });

  const mockPi = { tools: {}, commands: {}, on: () => {}, registerTool(tool) { this.tools[tool.name] = tool; }, registerCommand() {} };
  extension(mockPi);

  const start = await mockPi.tools.sdlc_start.execute('1', { goal: 'Pin persistence check' });
  const runId = start.details.run_id;
  assert.equal(readSessionPin(projectRoot), runId, 'sdlc_start writes .rstack/session.json');

  const approve = await mockPi.tools.sdlc_approve.execute('2', { artifact: 'plan.md', status: 'APPROVED' });
  assert.equal(approve.details.run_id, runId, 'approval record carries the run stamp');
  assert.match(approve.content[0].text, new RegExp(runId), 'response names the run the sign-off landed on');
});

test('cross-process repro via the real bridge: pin routes, ambiguity refuses, env overrides (#289)', { timeout: 240_000 }, async (t) => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-bridge-pin-'));
  t.after(() => rmSync(projectRoot, { recursive: true, force: true }));

  const startA = await runBridge(projectRoot, ['sdlc_start', JSON.stringify({ goal: 'Run A' })]);
  assert.equal(startA.code, 0, startA.stderr);
  const runA = JSON.parse(startA.stdout).details.run_id;
  const startB = await runBridge(projectRoot, ['sdlc_start', JSON.stringify({ goal: 'Run B' })]);
  assert.equal(startB.code, 0, startB.stderr);
  const runB = JSON.parse(startB.stdout).details.run_id;
  assert.notEqual(runA, runB);

  await t.test('the pin (not the newest dir) routes a fresh-process no-run_id approval', async () => {
    // Pin run A while run B is newest — the pre-fix behavior sent this to B.
    await writeSessionPin(projectRoot, runA);
    const res = await runBridge(projectRoot, ['sdlc_approve', JSON.stringify({ artifact: 'plan.md', status: 'APPROVED', comments: 'pin routing' })]);
    assert.equal(res.code, 0, res.stderr);
    assert.ok(runApprovals(projectRoot, runA).some((record) => record.artifact === 'plan.md' && record.run_id === runA),
      'approval landed on the pinned run, stamped');
    assert.equal(runApprovals(projectRoot, runB).length, 0, 'the newest run got NOTHING');
  });

  await t.test('no pin + multiple runs → structured ambiguity refusal, nothing written', async () => {
    await rm(sessionPinPath(projectRoot), { force: true });
    const before = runApprovals(projectRoot, runA).length;
    const res = await runBridge(projectRoot, ['sdlc_approve', JSON.stringify({ artifact: 'requirements.json', status: 'APPROVED' })]);
    assert.equal(res.code, 0, res.stderr);
    const payload = JSON.parse(res.stdout);
    assert.equal(payload.details.error, 'ambiguous_run');
    assert.ok(payload.details.candidates.length >= 2);
    assert.equal(runApprovals(projectRoot, runA).length, before, 'no approval written anywhere');
    assert.ok(!runApprovals(projectRoot, runB).some((record) => record.artifact === 'requirements.json'));
  });

  await t.test('RSTACK_RUN_ID env override pins a single call', async () => {
    const res = await runBridge(projectRoot, ['sdlc_approve', JSON.stringify({ artifact: 'requirements.json', status: 'APPROVED' })], { RSTACK_RUN_ID: runA });
    assert.equal(res.code, 0, res.stderr);
    assert.ok(runApprovals(projectRoot, runA).some((record) => record.artifact === 'requirements.json' && record.run_id === runA));
  });
});
