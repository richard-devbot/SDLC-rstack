/**
 * Notification router — one event, fan-out to every configured channel.
 *
 * Configuration precedence (per channel): environment variables first, then
 * .rstack/notifications.json in the project root:
 *
 *   {
 *     "channels": {
 *       "slack":    { "webhook": "https://hooks.slack.com/..." },
 *       "teams":    { "webhook": "https://....webhook.office.com/..." },
 *       "discord":  { "webhook": "https://discord.com/api/webhooks/..." },
 *       "telegram": { "bot_token": "123:abc", "chat_id": "-100123" },
 *       "whatsapp": { "token": "...", "phone_number_id": "...", "to": "15551234567" },
 *       "email":    { "sender": "DoNotReply@....azurecomm.net", "endpoint": "https://... (optional)" }
 *     }
 *   }
 *
 * The email channel (#353) additionally requires the RSTACK_ACS_CONNECTION_STRING
 * environment variable (the ACS access key NEVER lives in this file) and routes
 * per person via the `recipients` + `routing` maps (see recipients.js).
 *
 * Layer rule: notifications are fire-and-forget — a webhook failure must never
 * fail a run. notifyAll never throws; it returns per-channel results.
 *
 * owner: RStack developed by Richardson Gunde
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sendSlack } from './channels/slack.js';
import { sendTeams } from './channels/teams.js';
import { sendDiscord } from './channels/discord.js';
import { sendTelegram } from './channels/telegram.js';
import { sendWhatsApp } from './channels/whatsapp.js';
import { sendEmail } from './channels/email.js';

export const CHANNEL_SENDERS = Object.freeze({
  slack: sendSlack,
  teams: sendTeams,
  discord: sendDiscord,
  telegram: sendTelegram,
  whatsapp: sendWhatsApp,
  email: sendEmail,
});

function fileConfig(projectRoot) {
  if (!projectRoot) return {};
  const path = join(projectRoot, '.rstack', 'notifications.json');
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return parsed?.channels && typeof parsed.channels === 'object' ? parsed.channels : {};
  } catch {
    return {};
  }
}

function envChannels(env) {
  const channels = {};
  // RSTACK_SLACK_WEBHOOK keeps its historical behavior: URL sniffing routes
  // Teams/Discord URLs to the right converter.
  if (env.RSTACK_SLACK_WEBHOOK) {
    const url = env.RSTACK_SLACK_WEBHOOK;
    if (url.includes('discord.com')) channels.discord = { webhook: url };
    else if (url.includes('office.com')) channels.teams = { webhook: url };
    else channels.slack = { webhook: url };
  }
  if (env.RSTACK_TEAMS_WEBHOOK) channels.teams = { webhook: env.RSTACK_TEAMS_WEBHOOK };
  if (env.RSTACK_DISCORD_WEBHOOK) channels.discord = { webhook: env.RSTACK_DISCORD_WEBHOOK };
  if (env.RSTACK_TELEGRAM_BOT_TOKEN && env.RSTACK_TELEGRAM_CHAT_ID) {
    channels.telegram = { bot_token: env.RSTACK_TELEGRAM_BOT_TOKEN, chat_id: env.RSTACK_TELEGRAM_CHAT_ID };
  }
  if (env.RSTACK_WHATSAPP_TOKEN && env.RSTACK_WHATSAPP_PHONE_ID && env.RSTACK_WHATSAPP_TO) {
    channels.whatsapp = {
      token: env.RSTACK_WHATSAPP_TOKEN,
      phone_number_id: env.RSTACK_WHATSAPP_PHONE_ID,
      to: env.RSTACK_WHATSAPP_TO,
    };
  }
  return channels;
}

/** Resolve the effective channel configuration. Env wins over file config. */
export function resolveChannels({ projectRoot, env = process.env } = {}) {
  const channels = { ...fileConfig(projectRoot), ...envChannels(env) };
  // Email (#353) is split across two sources by design: the access key lives
  // ONLY in the RSTACK_ACS_CONNECTION_STRING env var (never in .rstack json),
  // while the committable half (sender address + optional endpoint override)
  // lives in channels.email of notifications.json. The channel is enabled
  // only when BOTH halves are present — otherwise it is dropped entirely so
  // hasConfiguredChannels stays honest.
  const connectionString = env.RSTACK_ACS_CONNECTION_STRING;
  const emailFile = channels.email && typeof channels.email === 'object' && !Array.isArray(channels.email) ? channels.email : null;
  const sender = typeof emailFile?.sender === 'string' ? emailFile.sender.trim() : '';
  if (connectionString && sender) {
    channels.email = { ...emailFile, sender, connection_string: connectionString, projectRoot };
  } else {
    delete channels.email;
  }
  return channels;
}

export function hasConfiguredChannels(options = {}) {
  return Object.keys(resolveChannels(options)).length > 0;
}

/**
 * Send a Slack-format payload to every configured channel.
 * Never throws. Returns [{ channel, ok, detail }].
 *
 * `options.meta` (#353) carries structured context ADDITIVELY — it is passed
 * to every sender as a third argument the existing webhook channels simply
 * ignore, so their payloads are byte-identical to before. The email channel
 * uses it for per-person approval routing:
 *   { kind: 'approval_required', run_id, task_id, artifacts, stage_ids?, reason? }
 */
export async function notifyAll(slackPayload, options = {}) {
  const channels = resolveChannels(options);
  const senders = options.senders ?? CHANNEL_SENDERS;
  const names = Object.keys(channels).filter((name) => senders[name]);
  const results = await Promise.all(names.map(async (name) => {
    try {
      const detail = await senders[name](channels[name], slackPayload, options.meta);
      return { channel: name, ok: true, detail: String(detail).slice(0, 200) };
    } catch (err) {
      return { channel: name, ok: false, detail: String(err?.message ?? err).slice(0, 200) };
    }
  }));
  return results;
}
