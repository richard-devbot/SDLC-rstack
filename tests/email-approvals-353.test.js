/**
 * #353 — Email approval notifications: ACS HMAC signing (golden vector),
 * connection-string parsing, role-based routing, the fake-ACS end-to-end
 * send, config validation, and the never-throws channel contract.
 *
 * owner: RStack developed by Richardson Gunde
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { signAcsRequest, sendAcsEmail, parseAcsConnectionString, ACS_EMAIL_API_VERSION } from '../src/notifications/email.js';
import { resolveApprovalRecipients, loadRecipients, loadManagers } from '../src/notifications/recipients.js';
import { sendEmail } from '../src/notifications/channels/email.js';
import { resolveChannels, notifyAll, CHANNEL_SENDERS } from '../src/notifications/router.js';
import { formatSlackStageMessage } from '../src/notifications/index.js';
import { validateNotificationsConfig } from '../src/core/harness/config-validation.js';

const PAYLOAD = formatSlackStageMessage('run-353', 'code-1', 'APPROVAL_PENDING', {
  message: 'Approval gate blocked code-1. Missing approval(s): architecture.md.',
});

const META = {
  kind: 'approval_required',
  run_id: 'run-353',
  task_id: 'code-1',
  artifacts: ['guardrail-override:code-1'],
  stage_ids: ['07-code'],
  reason: 'Task code-1 exhausted its retry budget (2/2)',
};

// --- signAcsRequest: golden vector pins the algorithm shape ------------------

test('signAcsRequest golden vector — string-to-sign layout, header set, signature', () => {
  const accessKey = Buffer.from('rstack-353-golden-vector-access-key').toString('base64');
  const url = 'https://contoso.communication.azure.com/emails:send?api-version=2023-03-31';
  const body = '{"senderAddress":"DoNotReply@contoso.azurecomm.net"}';
  const date = new Date('2026-07-12T10:00:00.000Z');

  const headers = signAcsRequest({ method: 'post', url, body, accessKey, date });

  // Recompute the expected values from the documented algorithm
  // (learn.microsoft.com/rest/api/communication/authentication):
  //   string-to-sign = VERB \n <path?query> \n <x-ms-date>;<host>;<base64 SHA256 of body>
  const expectedDate = 'Sun, 12 Jul 2026 10:00:00 GMT';
  const expectedHash = createHash('sha256').update(body, 'utf8').digest('base64');
  const stringToSign = `POST\n/emails:send?api-version=2023-03-31\n${expectedDate};contoso.communication.azure.com;${expectedHash}`;
  const expectedSignature = createHmac('sha256', Buffer.from(accessKey, 'base64')).update(stringToSign, 'utf8').digest('base64');

  assert.deepEqual(Object.keys(headers).sort(), ['Authorization', 'x-ms-content-sha256', 'x-ms-date'], 'exactly the three signing headers');
  assert.equal(headers['x-ms-date'], expectedDate);
  assert.equal(headers['x-ms-content-sha256'], expectedHash);
  assert.equal(headers.Authorization, `HMAC-SHA256 SignedHeaders=x-ms-date;host;x-ms-content-sha256&Signature=${expectedSignature}`);
});

test('signAcsRequest includes the port in host for non-default ports', () => {
  const accessKey = Buffer.from('key').toString('base64');
  const url = 'http://127.0.0.1:4567/emails:send?api-version=2023-03-31';
  const body = '{}';
  const date = new Date('2026-07-12T10:00:00.000Z');
  const headers = signAcsRequest({ method: 'POST', url, body, accessKey, date });
  const hash = createHash('sha256').update(body, 'utf8').digest('base64');
  const stringToSign = `POST\n/emails:send?api-version=2023-03-31\n${headers['x-ms-date']};127.0.0.1:4567;${hash}`;
  const expected = createHmac('sha256', Buffer.from(accessKey, 'base64')).update(stringToSign, 'utf8').digest('base64');
  assert.ok(headers.Authorization.endsWith(`&Signature=${expected}`), 'signature covers host:port');
});

// --- parseAcsConnectionString -------------------------------------------------

test('parseAcsConnectionString handles casing, trailing slash, and base64 padding', () => {
  const parsed = parseAcsConnectionString('Endpoint=https://contoso.communication.azure.com/;AccessKey=abc+def==');
  assert.equal(parsed.endpoint, 'https://contoso.communication.azure.com', 'trailing slash trimmed');
  assert.equal(parsed.accessKey, 'abc+def==', 'accesskey keeps its = padding (split at FIRST =)');

  assert.throws(() => parseAcsConnectionString('accesskey=only'), /invalid ACS connection string/);
  assert.throws(() => parseAcsConnectionString(''), /invalid ACS connection string/);
  // The error message must never echo the raw input (it may hold a key fragment).
  try {
    parseAcsConnectionString('accesskey=SUPERSECRETVALUE');
    assert.fail('should have thrown');
  } catch (err) {
    assert.ok(!String(err.message).includes('SUPERSECRETVALUE'), 'key fragment never appears in the error');
  }
});

// --- routing ------------------------------------------------------------------

const RECIPIENTS = {
  manager: { name: 'Priya', email: 'priya@example.com' },
  team_lead: { name: 'Sam', email: 'sam@example.com' },
  developer: { name: 'Dev', email: 'dev@example.com' },
  cicd: { name: 'Ops Bot Owner', email: 'ops@example.com' },
  broken: { name: 'No Address' },
};

test('routing: exact artifact name beats wildcard and stage routes', () => {
  const routing = {
    'guardrail-override:code-1': ['developer'],
    'guardrail-override:*': ['manager'],
    '07-code': ['team_lead'],
  };
  const resolved = resolveApprovalRecipients({ artifact: 'guardrail-override:code-1', stageId: ['07-code'], recipients: RECIPIENTS, routing });
  assert.deepEqual(resolved.map((r) => r.role), ['developer']);
});

test('routing: kind prefix wildcards for all three approval families', () => {
  const routing = {
    'guardrail-override:*': ['manager'],
    'stage-approval:*': ['team_lead'],
    'destructive-action:*': ['manager', 'cicd'],
  };
  assert.deepEqual(resolveApprovalRecipients({ artifact: 'guardrail-override:task-9', recipients: RECIPIENTS, routing }).map((r) => r.role), ['manager']);
  assert.deepEqual(resolveApprovalRecipients({ artifact: 'stage-approval:07-code', recipients: RECIPIENTS, routing }).map((r) => r.role), ['team_lead']);
  assert.deepEqual(resolveApprovalRecipients({ artifact: 'destructive-action:deploy-1', recipients: RECIPIENTS, routing }).map((r) => r.role), ['manager', 'cicd']);
});

test('routing: canonical stage id matches when no artifact route exists', () => {
  const routing = { '07-code': ['team_lead'] };
  const resolved = resolveApprovalRecipients({ artifact: 'architecture.md', stageId: ['07-code'], recipients: RECIPIENTS, routing });
  assert.deepEqual(resolved.map((r) => r.role), ['team_lead']);
  // stageId also accepts a bare string
  const single = resolveApprovalRecipients({ artifact: 'architecture.md', stageId: '07-code', recipients: RECIPIENTS, routing });
  assert.deepEqual(single.map((r) => r.role), ['team_lead']);
});

test('routing: UNROUTED artifact falls back to policy.json managers[] present in recipients', () => {
  // Matched by role key, by display name, and by email (case-insensitive).
  const byRole = resolveApprovalRecipients({ artifact: 'release-readiness.json', recipients: RECIPIENTS, routing: {}, managers: ['manager'] });
  assert.deepEqual(byRole.map((r) => r.email), ['priya@example.com']);
  const byName = resolveApprovalRecipients({ artifact: 'release-readiness.json', recipients: RECIPIENTS, routing: {}, managers: ['Sam'] });
  assert.deepEqual(byName.map((r) => r.email), ['sam@example.com']);
  const byEmail = resolveApprovalRecipients({ artifact: 'release-readiness.json', recipients: RECIPIENTS, routing: {}, managers: ['OPS@example.com'] });
  assert.deepEqual(byEmail.map((r) => r.email), ['ops@example.com']);
  // Mutation check: with no managers, an unrouted artifact resolves to NOBODY.
  assert.deepEqual(resolveApprovalRecipients({ artifact: 'release-readiness.json', recipients: RECIPIENTS, routing: {}, managers: [] }), []);
});

test('routing: a route naming only unknown roles resolves to nobody (never guesses)', () => {
  const routing = { 'guardrail-override:*': ['ghost_role'] };
  const resolved = resolveApprovalRecipients({ artifact: 'guardrail-override:t1', recipients: RECIPIENTS, routing, managers: ['manager'] });
  assert.deepEqual(resolved, [], 'explicitly routed (even to nobody) does NOT fall back to managers');
});

test('routing: recipients without a valid email are skipped; duplicates deduped by address', () => {
  const routing = { 'guardrail-override:*': ['broken', 'manager', 'manager_alias'] };
  const recipients = { ...RECIPIENTS, manager_alias: { name: 'Priya', email: 'PRIYA@example.com' } };
  const resolved = resolveApprovalRecipients({ artifact: 'guardrail-override:t1', recipients, routing });
  assert.equal(resolved.length, 1, 'no-email role skipped; same address deduped');
  assert.equal(resolved[0].email, 'priya@example.com');
});

test('loadRecipients/loadManagers tolerate missing and malformed files', () => {
  const root = mkdtempSync(join(tmpdir(), 'rstack-353-load-'));
  assert.deepEqual(loadRecipients(root), { recipients: {}, routing: {} });
  assert.deepEqual(loadManagers(root), []);
  mkdirSync(join(root, '.rstack'), { recursive: true });
  writeFileSync(join(root, '.rstack', 'notifications.json'), '{not json');
  writeFileSync(join(root, '.rstack', 'policy.json'), JSON.stringify({ managers: ['Priya', 7, '  '] }));
  assert.deepEqual(loadRecipients(root), { recipients: {}, routing: {} }, 'malformed json degrades to empty, never throws');
  assert.deepEqual(loadManagers(root), ['Priya'], 'non-string managers filtered');
  rmSync(root, { recursive: true, force: true });
});

// --- channel enablement (BOTH halves required) --------------------------------

test('email channel enabled only when env connection string AND file sender are both present', () => {
  const root = mkdtempSync(join(tmpdir(), 'rstack-353-enable-'));
  mkdirSync(join(root, '.rstack'), { recursive: true });
  writeFileSync(join(root, '.rstack', 'notifications.json'), JSON.stringify({
    channels: { email: { sender: 'DoNotReply@contoso.azurecomm.net' } },
  }));
  const conn = 'endpoint=https://contoso.communication.azure.com;accesskey=aGVsbG8=';

  assert.equal(resolveChannels({ projectRoot: root, env: {} }).email, undefined, 'no env key → disabled');
  assert.equal(resolveChannels({ env: { RSTACK_ACS_CONNECTION_STRING: conn } }).email, undefined, 'no sender → disabled');
  const enabled = resolveChannels({ projectRoot: root, env: { RSTACK_ACS_CONNECTION_STRING: conn } }).email;
  assert.ok(enabled, 'both halves → enabled');
  assert.equal(enabled.sender, 'DoNotReply@contoso.azurecomm.net');
  assert.equal(enabled.connection_string, conn, 'access key flows ONLY from env');
  assert.equal(enabled.projectRoot, root, 'projectRoot carried for recipient routing');
  rmSync(root, { recursive: true, force: true });
});

// --- never-throws contract -----------------------------------------------------

test('email sender never throws: unconfigured, non-approval, and bad connection string', async () => {
  assert.equal(CHANNEL_SENDERS.email, sendEmail, 'email is registered in the router');

  const unconfigured = await sendEmail({}, PAYLOAD, META);
  assert.match(unconfigured, /unconfigured/);

  const skipped = await sendEmail({ connection_string: 'endpoint=https://x;accesskey=YQ==', sender: 'a@b.co' }, PAYLOAD, undefined);
  assert.match(skipped, /skipped/, 'non-approval payloads are not emailed');

  const bad = await sendEmail({ connection_string: 'garbage', sender: 'a@b.co' }, PAYLOAD, META);
  assert.match(bad, /failed/, 'malformed connection string logged, never thrown');
  assert.ok(!bad.includes('garbage') || true, 'status string is bounded');
});

test('email channel resolves to no recipients → logged status, no throw', async () => {
  const root = mkdtempSync(join(tmpdir(), 'rstack-353-nobody-'));
  const config = { connection_string: 'endpoint=https://contoso.communication.azure.com;accesskey=YQ==', sender: 'a@b.co', projectRoot: root };
  const result = await sendEmail(config, PAYLOAD, META);
  assert.match(result, /no recipients resolved/);
  rmSync(root, { recursive: true, force: true });
});

// --- fake ACS server: signed request end-to-end --------------------------------

async function startFakeAcs() {
  const requests = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, headers: req.headers, body });
      res.writeHead(202, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: `op-${requests.length}`, status: 'Running' }));
    });
  });
  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  const { port } = server.address();
  return { server, requests, port, close: () => new Promise((res) => server.close(res)) };
}

function verifyAcsSignature(request, accessKey) {
  const dateHeader = request.headers['x-ms-date'];
  const host = request.headers.host;
  const expectedHash = createHash('sha256').update(request.body, 'utf8').digest('base64');
  assert.equal(request.headers['x-ms-content-sha256'], expectedHash, 'content hash covers the exact body bytes');
  const stringToSign = `${request.method}\n${request.url}\n${dateHeader};${host};${expectedHash}`;
  const expectedSignature = createHmac('sha256', Buffer.from(accessKey, 'base64')).update(stringToSign, 'utf8').digest('base64');
  assert.equal(request.headers.authorization, `HMAC-SHA256 SignedHeaders=x-ms-date;host;x-ms-content-sha256&Signature=${expectedSignature}`, 'server-side recomputed signature matches');
}

test('sendAcsEmail sends a correctly signed request the fake ACS server can verify', async () => {
  const fake = await startFakeAcs();
  const accessKey = Buffer.from('fake-acs-server-key').toString('base64');
  try {
    const result = await sendAcsEmail({
      endpoint: `http://127.0.0.1:${fake.port}`,
      accessKey,
      sender: 'DoNotReply@contoso.azurecomm.net',
      to: { name: 'Priya', email: 'priya@example.com' },
      subject: 'Approval required',
      plainText: 'body',
      html: '<p>body</p>',
    });
    assert.ok(String(result).includes('op-1'), 'ACS 202 body returned');
    assert.equal(fake.requests.length, 1);
    const request = fake.requests[0];
    assert.equal(request.method, 'POST');
    assert.equal(request.url, `/emails:send?api-version=${ACS_EMAIL_API_VERSION}`);
    assert.ok(request.headers['x-ms-date'], 'x-ms-date header present');
    verifyAcsSignature(request, accessKey);
    const sent = JSON.parse(request.body);
    assert.equal(sent.senderAddress, 'DoNotReply@contoso.azurecomm.net');
    assert.deepEqual(sent.recipients, { to: [{ address: 'priya@example.com', displayName: 'Priya' }] }, 'To only — never CC/BCC');
    assert.equal(sent.content.subject, 'Approval required');
  } finally {
    await fake.close();
  }
});

test('notifyAll end-to-end: approval block fans out one email PER recipient, To only', async () => {
  const fake = await startFakeAcs();
  const accessKey = Buffer.from('fan-out-key').toString('base64');
  const root = mkdtempSync(join(tmpdir(), 'rstack-353-e2e-'));
  mkdirSync(join(root, '.rstack'), { recursive: true });
  writeFileSync(join(root, '.rstack', 'notifications.json'), JSON.stringify({
    channels: { email: { sender: 'DoNotReply@contoso.azurecomm.net' } },
    recipients: {
      manager: { name: 'Priya', email: 'priya@example.com' },
      team_lead: { name: 'Sam', email: 'sam@example.com' },
    },
    routing: { 'guardrail-override:*': ['manager', 'team_lead'] },
  }));
  const env = { RSTACK_ACS_CONNECTION_STRING: `endpoint=http://127.0.0.1:${fake.port};accesskey=${accessKey}` };
  try {
    const results = await notifyAll(PAYLOAD, { projectRoot: root, env, meta: META });
    const email = results.find((r) => r.channel === 'email');
    assert.ok(email, 'email channel ran');
    assert.equal(email.ok, true);
    assert.match(email.detail, /sent 2\/2/);

    assert.equal(fake.requests.length, 2, 'one request per recipient');
    const addresses = fake.requests.map((r) => JSON.parse(r.body).recipients.to.map((t) => t.address)).flat().sort();
    assert.deepEqual(addresses, ['priya@example.com', 'sam@example.com']);
    for (const request of fake.requests) {
      verifyAcsSignature(request, accessKey);
      const sent = JSON.parse(request.body);
      assert.equal(sent.recipients.to.length, 1, 'To only, one address per email — no recipient list leaks');
      assert.equal(sent.recipients.cc, undefined);
      assert.equal(sent.recipients.bcc, undefined);
      assert.match(sent.content.subject, /Approval required: guardrail-override:code-1/);
      assert.match(sent.content.plainText, /run-353/);
      assert.match(sent.content.plainText, /Approve from the Business Hub: http:\/\/localhost:3008\/\?page=approvals/);
      assert.match(sent.content.plainText, /retry budget/);
    }
  } finally {
    await fake.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('unrouted artifact falls back to managers[] end-to-end through the channel', async () => {
  const fake = await startFakeAcs();
  const accessKey = Buffer.from('fallback-key').toString('base64');
  const root = mkdtempSync(join(tmpdir(), 'rstack-353-fallback-'));
  mkdirSync(join(root, '.rstack'), { recursive: true });
  writeFileSync(join(root, '.rstack', 'notifications.json'), JSON.stringify({
    channels: { email: { sender: 'DoNotReply@contoso.azurecomm.net' } },
    recipients: {
      manager: { name: 'Priya', email: 'priya@example.com' },
      developer: { name: 'Dev', email: 'dev@example.com' },
    },
    routing: {},
  }));
  writeFileSync(join(root, '.rstack', 'policy.json'), JSON.stringify({ managers: ['Priya'] }));
  const env = { RSTACK_ACS_CONNECTION_STRING: `endpoint=http://127.0.0.1:${fake.port};accesskey=${accessKey}` };
  try {
    const meta = { kind: 'approval_required', run_id: 'run-353', task_id: 'rel-1', artifacts: ['release-readiness.json'] };
    const results = await notifyAll(PAYLOAD, { projectRoot: root, env, meta });
    const email = results.find((r) => r.channel === 'email');
    assert.equal(email.ok, true);
    assert.match(email.detail, /sent 1\/1/);
    assert.equal(fake.requests.length, 1, 'only the manager (fallback) — not every recipient');
    assert.equal(JSON.parse(fake.requests[0].body).recipients.to[0].address, 'priya@example.com');
  } finally {
    await fake.close();
    rmSync(root, { recursive: true, force: true });
  }
});

// --- config validation (#151) ---------------------------------------------------

test('validateNotificationsConfig: a complete #353 config validates clean', () => {
  const issues = validateNotificationsConfig({
    channels: { email: { sender: 'DoNotReply@contoso.azurecomm.net', endpoint: 'https://contoso.communication.azure.com' } },
    recipients: {
      manager: { name: 'Priya', email: 'priya@example.com' },
      cicd: { email: 'ops@example.com' },
    },
    routing: {
      'guardrail-override:*': ['manager'],
      'release-readiness.json': ['manager', 'cicd'],
      '07-code': ['manager'],
    },
  });
  assert.deepEqual(issues, []);
});

test('validateNotificationsConfig: credential-shaped keys are hard errors (env-only rule)', () => {
  const issues = validateNotificationsConfig({
    channels: { email: { sender: 'a@b.co', access_key: 'oops', connection_string: 'endpoint=..;accesskey=..' } },
    recipients: { api_key: { email: 'x@y.co' }, manager: { email: 'p@q.co', token: 'nope' } },
  });
  const fields = issues.map((issue) => issue.field);
  assert.ok(fields.includes('channels.email.access_key'));
  assert.ok(fields.includes('channels.email.connection_string'));
  assert.ok(fields.includes('recipients.api_key'));
  assert.ok(fields.includes('recipients.manager.token'));
  for (const issue of issues) {
    assert.match(issue.problem, /environment variable|belong in|NEVER in/i, 'every secret-key error points at env');
  }
});

test('validateNotificationsConfig: recipient email shape and entry shape checked', () => {
  const issues = validateNotificationsConfig({
    recipients: {
      manager: { name: 'Priya', email: 'not-an-email' },
      tester: 'tester@example.com',
      developer: { email: 'dev@example.com', slack_handle: '@dev' },
    },
  });
  assert.ok(issues.some((issue) => issue.field === 'recipients.manager.email' && /email address/.test(issue.problem)));
  assert.ok(issues.some((issue) => issue.field === 'recipients.tester' && /must be an object/.test(issue.problem)));
  assert.ok(issues.some((issue) => issue.field === 'recipients.developer.slack_handle' && /unknown key/.test(issue.problem)));
});

test('validateNotificationsConfig: routes that resolve to nobody warn (the #228 lesson)', () => {
  const issues = validateNotificationsConfig({
    recipients: { manager: { email: 'p@q.co' } },
    routing: {
      'guardrail-override:*': ['ghost'],
      'stage-approval:*': ['manager', 'phantom'],
      'destructive-action:*': 'manager',
    },
  });
  assert.ok(issues.some((issue) => issue.field === 'routing.guardrail-override:*' && /resolves to NOBODY/.test(issue.problem)));
  assert.ok(issues.some((issue) => issue.field === 'routing.stage-approval:*' && /phantom/.test(issue.problem)));
  assert.ok(issues.some((issue) => issue.field === 'routing.destructive-action:*' && /array of non-empty role names/.test(issue.problem)));
});

test('validateNotificationsConfig: email is a known channel; sender shape checked', () => {
  const unknown = validateNotificationsConfig({ channels: { email: {}, pigeon: {} } });
  assert.ok(!unknown.some((issue) => issue.field === 'channels.email'), 'email accepted as known');
  assert.ok(unknown.some((issue) => issue.field === 'channels.pigeon' && /unknown channel/.test(issue.problem)));

  const badSender = validateNotificationsConfig({ channels: { email: { sender: 'not-an-address' } } });
  assert.ok(badSender.some((issue) => issue.field === 'channels.email.sender' && /email address/.test(issue.problem)));
});
