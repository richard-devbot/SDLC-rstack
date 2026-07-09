// owner: RStack developed by Richardson Gunde
//
// Tests for `rstack-agents notify-hook` (#255) — the framework-neutral
// Notification relay. The CLI path (spawned) covers the ALWAYS-exit-0 contract
// and the no-channels no-op; the in-process path (with an injected fake sender)
// covers the actual fan-out, secret redaction, and payload shape without any
// real network call.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseNotification, buildNotifyPayload, runNotifyHook } from '../src/commands/notify-hook.js';

const BIN = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'rstack-agents.js');

function cleanEnv(overrides = {}) {
  const env = { ...process.env };
  for (const key of ['RSTACK_SLACK_WEBHOOK', 'RSTACK_TEAMS_WEBHOOK', 'RSTACK_DISCORD_WEBHOOK',
    'RSTACK_TELEGRAM_BOT_TOKEN', 'RSTACK_TELEGRAM_CHAT_ID', 'RSTACK_WHATSAPP_TOKEN',
    'RSTACK_WHATSAPP_PHONE_ID', 'RSTACK_WHATSAPP_TO', 'RSTACK_PROJECT_ROOT', 'RSTACK_OBSERVE_SOURCE']) {
    delete env[key];
  }
  return { ...env, ...overrides };
}

function runCli(args, { input = '', env = {} } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [BIN, 'notify-hook', ...args], {
      cwd: tmpdir(), env: cleanEnv(env), stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('error', rejectPromise);
    child.on('close', (code) => resolvePromise({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}

test('notify-hook CLI: no channels configured is a silent no-op, exit 0', async () => {
  const payload = JSON.stringify({ hook_event_name: 'Notification', message: 'Claude needs your input' });
  const { code, stdout } = await runCli(['--project', tmpdir()], { input: payload });
  assert.equal(code, 0, 'always exits 0');
  assert.equal(stdout.trim(), '', 'no output when there is nothing to relay');
});

test('notify-hook CLI: malformed stdin still exits 0 (never throws)', async () => {
  const { code, stderr } = await runCli(['--project', tmpdir()], { input: 'not json }{' });
  assert.equal(code, 0);
  assert.ok(!/throw|TypeError|SyntaxError/i.test(stderr), 'no stack trace leaked');
});

test('parseNotification: pulls message + title from Claude Code shape', () => {
  const n = parseNotification(JSON.stringify({ hook_event_name: 'Notification', message: 'Task done', title: 'RStack' }));
  assert.equal(n.message, 'Task done');
  assert.equal(n.title, 'RStack');
});

test('parseNotification: falls back to hook_event_name as the title, raw text as message', () => {
  const n = parseNotification(JSON.stringify({ hook_event_name: 'Notification', message: 'hi' }));
  assert.equal(n.title, 'Notification');
  assert.equal(parseNotification('plain string message').message, 'plain string message');
});

test('parseNotification: empty / no-message payloads → null', () => {
  assert.equal(parseNotification(''), null);
  assert.equal(parseNotification(JSON.stringify({ hook_event_name: 'Notification' })), null);
});

test('parseNotification: redacts secrets and truncates long messages', () => {
  const n = parseNotification(JSON.stringify({ message: 'deploy token=AKIAIOSFODNN7EXAMPLE123 now' }));
  assert.ok(!n.message.includes('AKIAIOSFODNN7EXAMPLE123'), 'AWS key redacted');
  assert.ok(n.message.includes('[redacted]'));
  const long = parseNotification(JSON.stringify({ message: 'x'.repeat(5000) }));
  assert.ok(long.message.length <= 601, 'message truncated');
});

test('buildNotifyPayload: produces a Slack-format text payload with title + source', () => {
  const p = buildNotifyPayload({ message: 'done', title: 'Stop' }, 'claude-code');
  assert.ok(p.text.includes('Stop'));
  assert.ok(p.text.includes('claude-code'));
  assert.ok(p.text.includes('done'));
});

test('runNotifyHook: fans out to a configured channel via an injected sender (no network)', async () => {
  const sent = [];
  const senders = { slack: async (config, payload) => { sent.push({ config, payload }); return 'ok'; } };
  const env = cleanEnv({ RSTACK_SLACK_WEBHOOK: 'https://hooks.slack.com/services/T/B/xyz' });
  const result = await runNotifyHook({
    stdinText: JSON.stringify({ hook_event_name: 'Notification', message: 'Claude needs input' }),
    source: 'claude-code', project: tmpdir(), env, senders,
  });
  assert.equal(result.notified, true, 'reports a successful relay');
  assert.equal(sent.length, 1, 'the slack sender was invoked once');
  assert.ok(sent[0].payload.text.includes('Claude needs input'));
});

test('runNotifyHook: no channels → no-op even with a valid message', async () => {
  const senders = { slack: async () => { throw new Error('should not be called'); } };
  const result = await runNotifyHook({
    stdinText: JSON.stringify({ message: 'hello' }), project: tmpdir(), env: cleanEnv(), senders,
  });
  assert.equal(result.notified, false);
  assert.match(result.reason, /no notification channels/);
});

test('runNotifyHook: a throwing sender never surfaces (best-effort)', async () => {
  const senders = { slack: async () => { throw new Error('boom'); } };
  const env = cleanEnv({ RSTACK_SLACK_WEBHOOK: 'https://hooks.slack.com/services/T/B/xyz' });
  const result = await runNotifyHook({
    stdinText: JSON.stringify({ message: 'hi' }), project: tmpdir(), env, senders,
  });
  // notifyAll captures the per-channel failure; the relay itself never throws.
  assert.equal(result.notified, false, 'a failed channel is reported as not-notified, not an exception');
  assert.equal(result.reason, 'relayed');
});
