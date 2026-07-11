/**
 * Tests for the notification channels + router — config resolution,
 * fan-out, text conversion, and per-channel payload shapes.
 *
 * owner: RStack developed by Richardson Gunde
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formatSlackStageMessage } from '../src/notifications/index.js';
import { slackPayloadToText } from '../src/notifications/channels/text.js';
import { convertSlackToDiscord } from '../src/notifications/channels/discord.js';
import { convertSlackToTeams } from '../src/notifications/channels/teams.js';
import { resolveChannels, hasConfiguredChannels, notifyAll, CHANNEL_SENDERS } from '../src/notifications/router.js';

const PAYLOAD = formatSlackStageMessage('run-001', '07-code', 'PASS', {
  message: 'All unit tests passed.',
  attempt: '1/2',
});

test('slackPayloadToText renders blocks as readable plain text', () => {
  const text = slackPayloadToText(PAYLOAD);
  assert.ok(text.includes('RStack SDLC Milestone'), 'headline present');
  assert.ok(text.includes('Run ID: run-001'), 'fields flattened');
  assert.ok(text.includes('Stage: 07-code'));
  assert.ok(text.includes('All unit tests passed.'), 'message included, blockquote stripped');
  assert.ok(!text.includes('*'), 'mrkdwn markers stripped');
});

test('discord and teams converters keep their original behavior', () => {
  const discord = convertSlackToDiscord(PAYLOAD);
  assert.ok(Array.isArray(discord.embeds) && discord.embeds.length === 1);
  assert.equal(discord.embeds[0].fields[0].name, 'Run ID:');

  const teams = convertSlackToTeams(PAYLOAD);
  assert.equal(teams['@type'], 'MessageCard');
  assert.equal(teams.themeColor, '22c55e');
  assert.ok(teams.sections[0].facts.some((fact) => fact.name === 'Run ID:'));
});

test('resolveChannels: env vars, URL sniffing, and file config precedence', () => {
  const root = mkdtempSync(join(tmpdir(), 'rstack-notify-'));
  mkdirSync(join(root, '.rstack'), { recursive: true });
  writeFileSync(join(root, '.rstack', 'notifications.json'), JSON.stringify({
    channels: {
      telegram: { bot_token: 'file-token', chat_id: 'file-chat' },
      slack: { webhook: 'https://hooks.slack.com/from-file' },
    },
  }));

  const env = {
    RSTACK_SLACK_WEBHOOK: 'https://discord.com/api/webhooks/123', // sniffed → discord
    RSTACK_TELEGRAM_BOT_TOKEN: 'env-token',
    RSTACK_TELEGRAM_CHAT_ID: 'env-chat',
    RSTACK_WHATSAPP_TOKEN: 'wa-token',
    RSTACK_WHATSAPP_PHONE_ID: '111',
    RSTACK_WHATSAPP_TO: '15551234567',
  };
  const channels = resolveChannels({ projectRoot: root, env });

  assert.ok(channels.discord, 'discord.com URL in RSTACK_SLACK_WEBHOOK routes to discord');
  assert.equal(channels.slack.webhook, 'https://hooks.slack.com/from-file', 'file config fills unset channels');
  assert.equal(channels.telegram.bot_token, 'env-token', 'env wins over file config');
  assert.equal(channels.whatsapp.to, '15551234567');
  assert.ok(hasConfiguredChannels({ projectRoot: root, env }));
  assert.equal(hasConfiguredChannels({ env: {} }), false);

  rmSync(root, { recursive: true, force: true });
});

test('notifyAll fans out to every configured channel and never throws', async () => {
  const sent = [];
  const senders = {
    slack: async (config, payload) => { sent.push(['slack', config.webhook, payload]); return 'ok'; },
    telegram: async () => { throw new Error('telegram exploded'); },
  };
  const env = {
    RSTACK_SLACK_WEBHOOK: 'https://hooks.slack.com/x',
    RSTACK_TELEGRAM_BOT_TOKEN: 't',
    RSTACK_TELEGRAM_CHAT_ID: 'c',
  };
  const results = await notifyAll(PAYLOAD, { env, senders });
  assert.equal(results.length, 2);
  const slack = results.find((result) => result.channel === 'slack');
  const telegram = results.find((result) => result.channel === 'telegram');
  assert.equal(slack.ok, true);
  assert.equal(telegram.ok, false, 'failing channel reported, not thrown');
  assert.ok(telegram.detail.includes('telegram exploded'));
  assert.equal(sent.length, 1);
});

test('notifyAll with nothing configured is a silent no-op', async () => {
  const results = await notifyAll(PAYLOAD, { env: {} });
  assert.deepEqual(results, []);
});

test('all five channels are registered in the router', () => {
  assert.deepEqual(Object.keys(CHANNEL_SENDERS).sort(), ['discord', 'slack', 'teams', 'telegram', 'whatsapp']);
});

test('postJson rejects a stalled webhook instead of hanging (#291)', async () => {
  const net = await import('node:net');
  const { postJson } = await import('../src/notifications/channels/http.js');
  // Accept the TCP connection but never respond → the TLS handshake stalls,
  // the socket sits idle, and the request must time out (not hang forever).
  const sockets = new Set();
  const server = net.createServer((sock) => {
    sockets.add(sock);
    sock.on('close', () => sockets.delete(sock));
    // intentionally never responds
  });
  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  const { port } = server.address();
  const prev = process.env.RSTACK_WEBHOOK_TIMEOUT_MS;
  process.env.RSTACK_WEBHOOK_TIMEOUT_MS = '300';
  try {
    const start = Date.now();
    await assert.rejects(
      postJson(`https://127.0.0.1:${port}/hook`, { text: 'hi' }),
      /timed out/i,
    );
    assert.ok(Date.now() - start < 5000, 'must reject promptly, not hang on a dead webhook');
  } finally {
    if (prev === undefined) delete process.env.RSTACK_WEBHOOK_TIMEOUT_MS;
    else process.env.RSTACK_WEBHOOK_TIMEOUT_MS = prev;
    // Destroy the lingering server-side socket so server.close() can resolve.
    for (const sock of sockets) sock.destroy();
    await new Promise((res) => server.close(res));
  }
});
