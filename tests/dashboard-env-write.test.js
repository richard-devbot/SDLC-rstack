/**
 * Approval-gated .env writes + decision resolution from the Business Hub
 * (#238). Boots the real server as a child process (--port 0) against a
 * throwaway git repo and exercises the full two-step contract:
 *
 *   - routes fail closed (403) with no approval token configured
 *   - cross-origin and bad-key requests rejected
 *   - a non-gitignored .env refuses the write (409 gitignore_required)
 *   - step 1 creates a PENDING queue approval and persists NO value
 *   - step 2 (after /api/approve) writes .env, consumes the approval
 *     one-shot, audits key/actor/length — never the value
 *   - forged and replayed queue records never unblock
 *   - POST /api/decide resolves/waives Decision Queue items, 404s unknowns
 *
 * owner: RStack developed by Richardson Gunde
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, existsSync, appendFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { classifyDestructiveAction, DESTRUCTIVE_CATEGORIES } from '../src/core/harness/destructive-actions.js';

const SERVER_PATH = join(process.cwd(), 'src', 'observability', 'dashboard', 'server.js');
const TOKEN = 'env-write-test-token';

// The route's gate invariant: a .env write MUST classify as destructive
// (secret-write) through the central classifier the server imports.
test('.env write classifies destructive via the central classifier', () => {
  const verdict = classifyDestructiveAction({ toolName: 'write', input: { file_path: '.env' } });
  assert.equal(verdict.destructive, true);
  assert.equal(verdict.category, DESTRUCTIVE_CATEGORIES.SECRET_WRITE);
});

function startServer({ projectRoot, env = {} }) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [SERVER_PATH, '--port', '0', '--no-browser', '--project', projectRoot], {
      cwd: projectRoot,
      env: {
        ...process.env,
        RSTACK_APPROVAL_TOKEN: undefined,
        RSTACK_BUSINESS_PORT: undefined,
        RSTACK_PROJECT_ROOT: undefined,
        RSTACK_STATE_DIR: undefined,
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
      const match = stdout.match(/Dashboard: http:\/\/localhost:(\d+)/);
      if (match && !settled) {
        settled = true;
        clearTimeout(timer);
        resolvePromise({
          child,
          baseUrl: `http://127.0.0.1:${match[1]}`,
          stop: () => child.kill('SIGKILL'),
        });
      }
    });
    child.on('exit', (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        rejectPromise(new Error(`dashboard server exited early (code ${code})\nstdout: ${stdout}\nstderr: ${stderr}`));
      }
    });
  });
}

// Throwaway git repo with .env ignored — the compliant baseline.
function makeProjectRoot({ gitignoreEnv = true, gitRepo = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'rstack-env-write-'));
  if (gitRepo) execFileSync('git', ['init', '-q'], { cwd: root });
  if (gitignoreEnv) appendFileSync(join(root, '.gitignore'), '.env\nnode_modules/\n');
  return root;
}

async function seedRun(projectRoot, runId = 'run-env-238') {
  const runDir = join(projectRoot, '.rstack', 'runs', runId);
  await mkdir(runDir, { recursive: true });
  await writeFile(join(runDir, 'manifest.json'), JSON.stringify({
    run_id: runId, goal: 'env fixture', created_at: '2026-07-07T08:00:00.000Z', framework: 'pi',
  }, null, 2));
  await writeFile(join(runDir, 'tasks.json'), JSON.stringify({ tasks: [] }, null, 2));
  await writeFile(join(runDir, 'events.jsonl'), '');
  return { runId, runDir };
}

function post(baseUrl, path, body, { token = TOKEN, headers = {} } = {}) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'x-rstack-approval-token': token } : {}),
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function envWrite(baseUrl, body, opts) {
  return post(baseUrl, '/api/env-write', body, opts);
}

function readQueue(projectRoot) {
  const path = join(projectRoot, '.rstack', 'approvals.jsonl');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

const SECRET = 'plaintext-secret-value-238';

// Assert the plaintext value appears nowhere in persisted .rstack state.
async function assertValueNotPersisted(projectRoot, { exceptEnvFile = false } = {}) {
  const paths = [
    join(projectRoot, '.rstack', 'approvals.jsonl'),
    join(projectRoot, '.rstack', 'env-writes-audit.jsonl'),
    join(projectRoot, '.rstack', 'approvals-audit.jsonl'),
  ];
  for (const path of paths) {
    const raw = await readFile(path, 'utf8').catch(() => '');
    assert.ok(!raw.includes(SECRET), `${path} must never contain the plaintext value`);
  }
  if (!exceptEnvFile) {
    const env = await readFile(join(projectRoot, '.env'), 'utf8').catch(() => '');
    assert.ok(!env.includes(SECRET), '.env must not carry the value before approval');
  }
}

test('env-write routes are disabled (403) when no approval token is configured', async () => {
  const root = makeProjectRoot();
  const server = await startServer({ projectRoot: root });
  try {
    for (const path of ['/api/env-write', '/api/decide']) {
      const response = await post(server.baseUrl, path, { key: 'A_KEY', value: 'x', resolvedBy: 'rich' }, { token: null });
      assert.equal(response.status, 403, `${path} fails closed without a configured token`);
    }
  } finally {
    server.stop();
    rmSync(root, { recursive: true, force: true });
  }
});

test('cross-origin and wrong-token env-write requests are rejected', async () => {
  const root = makeProjectRoot();
  const server = await startServer({ projectRoot: root, env: { RSTACK_APPROVAL_TOKEN: TOKEN } });
  try {
    const foreign = await envWrite(server.baseUrl, { key: 'A_KEY', value: 'x', resolvedBy: 'rich' }, {
      headers: { Origin: 'https://evil.example.com' },
    });
    assert.equal(foreign.status, 403, 'foreign Origin rejected (CSRF)');
    const badToken = await envWrite(server.baseUrl, { key: 'A_KEY', value: 'x', resolvedBy: 'rich' }, { token: 'wrong' });
    assert.equal(badToken.status, 401, 'wrong token rejected');
    assert.ok(!existsSync(join(root, '.env')), 'nothing written');
  } finally {
    server.stop();
    rmSync(root, { recursive: true, force: true });
  }
});

test('invalid keys and missing fields are 400; nothing is written or queued', async () => {
  const root = makeProjectRoot();
  const server = await startServer({ projectRoot: root, env: { RSTACK_APPROVAL_TOKEN: TOKEN } });
  try {
    for (const body of [
      { key: 'lower_case', value: 'x', resolvedBy: 'rich' },
      { key: 'HAS SPACE', value: 'x', resolvedBy: 'rich' },
      { key: 'PATH=INJECT', value: 'x', resolvedBy: 'rich' },
      { key: 'GOOD_KEY', value: 'x' },
      { key: 'GOOD_KEY', resolvedBy: 'rich' },
      { key: 'GOOD_KEY', value: 42, resolvedBy: 'rich' },
      { key: 'GOOD_KEY', value: 'y'.repeat(5000), resolvedBy: 'rich' },
    ]) {
      const response = await envWrite(server.baseUrl, body);
      assert.equal(response.status, 400, `rejected: ${JSON.stringify(body).slice(0, 60)}`);
    }
    assert.ok(!existsSync(join(root, '.env')), 'no .env created');
    assert.equal(readQueue(root).length, 0, 'no approval queued for invalid requests');
  } finally {
    server.stop();
    rmSync(root, { recursive: true, force: true });
  }
});

test('a .env that is not gitignored refuses the write with 409 gitignore_required', async () => {
  const root = makeProjectRoot({ gitignoreEnv: false });
  const server = await startServer({ projectRoot: root, env: { RSTACK_APPROVAL_TOKEN: TOKEN } });
  try {
    const response = await envWrite(server.baseUrl, { key: 'API_KEY', value: SECRET, resolvedBy: 'rich' });
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.error, 'gitignore_required');
    assert.ok(!existsSync(join(root, '.env')));
    await assertValueNotPersisted(root);
  } finally {
    server.stop();
    rmSync(root, { recursive: true, force: true });
  }
});

test('two-step happy path: 409 pending approval → approve → write → consumed one-shot', async () => {
  const root = makeProjectRoot();
  const { runDir } = await seedRun(root);
  const server = await startServer({ projectRoot: root, env: { RSTACK_APPROVAL_TOKEN: TOKEN } });
  try {
    // Step 1: no approval yet → 409, pending queue entry, value NOT persisted.
    const first = await envWrite(server.baseUrl, { key: 'API_KEY', value: SECRET, resolvedBy: 'rich' });
    assert.equal(first.status, 409);
    const firstBody = await first.json();
    assert.equal(firstBody.error, 'approval_required');
    assert.equal(firstBody.artifact, 'destructive-action:env-write:API_KEY');
    const queued = readQueue(root);
    assert.equal(queued.length, 1);
    assert.equal(queued[0].status, 'pending');
    assert.equal(queued[0].artifact, 'destructive-action:env-write:API_KEY');
    await assertValueNotPersisted(root);

    // A repeat submit stays 409 and does not duplicate the queue entry.
    const repeat = await envWrite(server.baseUrl, { key: 'API_KEY', value: SECRET, resolvedBy: 'rich' });
    assert.equal(repeat.status, 409);
    assert.equal(readQueue(root).length, 1, 'pending entry is idempotent');

    // Manager approves via the EXISTING approve endpoint.
    const approve = await post(server.baseUrl, '/api/approve', { id: queued[0].id, resolvedBy: 'manager-margo' });
    assert.equal(approve.status, 200);

    // Step 2: the write lands, value only in .env.
    const second = await envWrite(server.baseUrl, { key: 'API_KEY', value: SECRET, resolvedBy: 'rich' });
    assert.equal(second.status, 200);
    const secondBody = await second.json();
    assert.equal(secondBody.ok, true);
    assert.equal(secondBody.written, true);
    assert.equal(secondBody.approvedBy, 'manager-margo');
    assert.ok(!JSON.stringify(secondBody).includes(SECRET), 'value never echoed in the response');
    assert.equal(readFileSync(join(root, '.env'), 'utf8'), `API_KEY=${SECRET}\n`);
    await assertValueNotPersisted(root, { exceptEnvFile: true });

    // One-shot: the approval is consumed; a third write goes back to 409.
    const consumed = readQueue(root).find((entry) => entry.id === queued[0].id);
    assert.equal(consumed.status, 'consumed');
    const third = await envWrite(server.baseUrl, { key: 'API_KEY', value: 'another-value', resolvedBy: 'rich' });
    assert.equal(third.status, 409, 'a second write needs re-approval');
    assert.equal(readFileSync(join(root, '.env'), 'utf8'), `API_KEY=${SECRET}\n`, 'value unchanged');
    const repended = readQueue(root).find((entry) => entry.id === queued[0].id);
    assert.equal(repended.status, 'pending', 'consumed entry re-pends for the new request');

    // Audit trail: key/actor/length recorded, never the value.
    const audit = readFileSync(join(root, '.rstack', 'env-writes-audit.jsonl'), 'utf8')
      .split('\n').filter(Boolean).map((line) => JSON.parse(line));
    const written = audit.find((entry) => entry.outcome === 'written');
    assert.equal(written.key, 'API_KEY');
    assert.equal(written.actor, 'rich');
    assert.equal(written.valueLength, SECRET.length);
    assert.equal(written.approvedBy, 'manager-margo');

    // Pinned run event: env_key_written with masked length only.
    const events = readFileSync(join(runDir, 'events.jsonl'), 'utf8')
      .split('\n').filter(Boolean).map((line) => JSON.parse(line));
    const event = events.find((entry) => entry.type === 'env_key_written');
    assert.equal(event.key, 'API_KEY');
    assert.equal(event.actor, 'rich');
    assert.equal(event.masked_value_length, SECRET.length);
    assert.ok(!JSON.stringify(events).includes(SECRET), 'events never carry the value');

    // The state snapshot exposes key names/lengths, never values.
    const state = await (await fetch(`${server.baseUrl}/api/state`)).json();
    assert.ok(!JSON.stringify(state).includes(SECRET), '/api/state never leaks the value');
  } finally {
    server.stop();
    rmSync(root, { recursive: true, force: true });
  }
});

test('forged and replayed queue approvals never unblock the write', async () => {
  const root = makeProjectRoot();
  const server = await startServer({ projectRoot: root, env: { RSTACK_APPROVAL_TOKEN: TOKEN } });
  try {
    mkdirSync(join(root, '.rstack'), { recursive: true });
    // Forged: an "approved" record missing resolver evidence (no resolvedBy /
    // resolvedAt) fails the per-record queue audit → treated as absent.
    appendFileSync(join(root, '.rstack', 'approvals.jsonl'), JSON.stringify({
      id: 'env-write:FORGED_KEY',
      artifact: 'destructive-action:env-write:FORGED_KEY',
      status: 'approved',
      ts: new Date().toISOString(),
    }) + '\n');
    const forged = await envWrite(server.baseUrl, { key: 'FORGED_KEY', value: SECRET, resolvedBy: 'rich' });
    assert.equal(forged.status, 409, 'forged approval rejected');
    assert.ok(!existsSync(join(root, '.env')), 'nothing written on a forged approval');

    // Replayed: a verbatim copy of a well-formed approved record re-appended
    // under the same id trips the history replay audit → poisoned artifact.
    const record = {
      id: 'env-write:REPLAY_KEY',
      artifact: 'destructive-action:env-write:REPLAY_KEY',
      status: 'approved',
      ts: '2026-07-07T09:00:00.000Z',
      resolvedBy: 'manager-margo',
      resolvedAt: '2026-07-07T09:01:00.000Z',
    };
    appendFileSync(join(root, '.rstack', 'approvals.jsonl'),
      JSON.stringify(record) + '\n' + JSON.stringify(record) + '\n');
    const replayed = await envWrite(server.baseUrl, { key: 'REPLAY_KEY', value: SECRET, resolvedBy: 'rich' });
    assert.equal(replayed.status, 409, 'replayed approval rejected');
    assert.ok(!existsSync(join(root, '.env')), 'nothing written on a replayed approval');
  } finally {
    server.stop();
    rmSync(root, { recursive: true, force: true });
  }
});

test('POST /api/decide resolves and waives decisions; unknown ids are 404', async () => {
  const root = makeProjectRoot();
  const { runId, runDir } = await seedRun(root);
  await writeFile(join(runDir, 'decisions.json'), JSON.stringify({
    run_id: runId,
    decisions: [
      { decision_id: 'DEC-001', question: 'Which tracker?', impact: 'scope', status: 'pending' },
      { decision_id: 'DEC-002', question: 'Deploy target?', impact: 'delivery', status: 'pending' },
    ],
  }, null, 2));
  const server = await startServer({ projectRoot: root, env: { RSTACK_APPROVAL_TOKEN: TOKEN } });
  try {
    const resolved = await post(server.baseUrl, '/api/decide', {
      runId, decisionId: 'DEC-001', status: 'resolved', resolution: 'Jira', resolvedBy: 'rich',
    });
    assert.equal(resolved.status, 200);
    const resolvedBody = await resolved.json();
    assert.equal(resolvedBody.decision.status, 'resolved');
    assert.equal(resolvedBody.decision.resolution, 'Jira');
    assert.equal(resolvedBody.decision.resolved_by, 'rich');

    const waived = await post(server.baseUrl, '/api/decide', {
      runId, decisionId: 'DEC-002', status: 'waived', resolvedBy: 'rich',
    });
    assert.equal(waived.status, 200);
    assert.equal((await waived.json()).decision.status, 'waived');

    const persisted = JSON.parse(readFileSync(join(runDir, 'decisions.json'), 'utf8'));
    assert.deepEqual(persisted.decisions.map((d) => d.status), ['resolved', 'waived']);

    const missing = await post(server.baseUrl, '/api/decide', {
      runId, decisionId: 'DEC-999', status: 'resolved', resolvedBy: 'rich',
    });
    assert.equal(missing.status, 404, 'unknown decision id is 404');

    const badRun = await post(server.baseUrl, '/api/decide', {
      runId: 'no-such-run', decisionId: 'DEC-001', status: 'resolved', resolvedBy: 'rich',
    });
    assert.equal(badRun.status, 404, 'unknown run is 404');

    const badStatus = await post(server.baseUrl, '/api/decide', {
      runId, decisionId: 'DEC-001', status: 'approved', resolvedBy: 'rich',
    });
    assert.equal(badStatus.status, 400, 'only resolved|waived are accepted');
  } finally {
    server.stop();
    rmSync(root, { recursive: true, force: true });
  }
});
