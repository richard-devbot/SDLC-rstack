/**
 * Notifications layer — public API.
 *
 * Channel implementations live in ./channels/ (slack, teams, discord,
 * telegram, whatsapp); config-driven fan-out lives in ./router.js.
 * This module keeps the original exports working (sendSlackNotification,
 * formatters, converters) so existing imports never break.
 *
 * owner: RStack developed by Richardson Gunde
 */

import { postJson } from './channels/http.js';
import { convertSlackToDiscord } from './channels/discord.js';
import { convertSlackToTeams } from './channels/teams.js';

export { convertSlackToDiscord } from './channels/discord.js';
export { convertSlackToTeams } from './channels/teams.js';
export { slackPayloadToText } from './channels/text.js';
export { sendSlack } from './channels/slack.js';
export { sendTeams } from './channels/teams.js';
export { sendDiscord } from './channels/discord.js';
export { sendTelegram } from './channels/telegram.js';
export { sendWhatsApp } from './channels/whatsapp.js';
export { sendEmail } from './channels/email.js';
export { signAcsRequest, sendAcsEmail, parseAcsConnectionString } from './email.js';
export { loadRecipients, loadManagers, resolveApprovalRecipients } from './recipients.js';
export { notifyAll, resolveChannels, hasConfiguredChannels, CHANNEL_SENDERS } from './router.js';

/**
 * Dispatches an HTTP POST payload to the Slack, Teams, or Discord Webhook URL.
 * Fails gracefully by logging to console if the webhook is not configured.
 * (Back-compat single-webhook entry point — prefer notifyAll for fan-out.)
 */
export async function sendSlackNotification(webhookUrl, payload) {
  if (!webhookUrl) {
    console.log(`[RStack Notification] Webhook unconfigured. Payload:`, JSON.stringify(payload, null, 2));
    return 'unconfigured';
  }

  let finalPayload = payload;
  if (webhookUrl.includes('discord.com')) {
    finalPayload = convertSlackToDiscord(payload);
  } else if (webhookUrl.includes('office.com') || webhookUrl.includes('webhook.office.com')) {
    finalPayload = convertSlackToTeams(payload);
  }

  return postJson(webhookUrl, finalPayload);
}

/**
 * Formats stage metrics and progression details into a rich Slack Block payload.
 */
export function formatSlackStageMessage(runId, stageId, status, details = {}) {
  const statusEmoji = {
    'START': '🚀',
    'PASS': '✅',
    'FAIL': '❌',
    'BLOCKED': '⚠️',
    'APPROVAL_PENDING': '🙋',
  }[status] || '🔔';

  const color = {
    'START': '#3b82f6',
    'PASS': '#22c55e',
    'FAIL': '#ef4444',
    'BLOCKED': '#f59e0b',
    'APPROVAL_PENDING': '#8b5cf6',
  }[status] || '#64748b';

  const fields = [
    { type: 'mrkdwn', text: `*Run ID:*\n${runId}` },
    { type: 'mrkdwn', text: `*Stage:*\n${stageId}` },
    { type: 'mrkdwn', text: `*Status:*\n${status}` },
  ];

  if (details.cost) {
    fields.push({ type: 'mrkdwn', text: `*Cost Cap:*\n$${details.cost}` });
  }
  if (details.attempt) {
    fields.push({ type: 'mrkdwn', text: `*Sandbox Attempt:*\n${details.attempt}` });
  }

  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${statusEmoji} RStack SDLC Milestone: Stage ${status}*`,
      },
    },
    {
      type: 'fields',
      fields,
    },
  ];

  if (details.message) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `> ${details.message}`,
      },
    });
  }

  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: 'RStack developed by Richardson Gunde',
      },
    ],
  });

  return {
    attachments: [
      {
        color,
        blocks,
      },
    ],
  };
}

/**
 * Formats a comprehensive task execution report including tool calls, guardrail hits,
 * memory action counters, and validation checks into a high-fidelity Slack payload.
 */
export function formatSlackTaskReportMessage(runId, taskId, trace) {
  const isPass = trace.status === 'PASS';
  const statusEmoji = isPass ? '🟢' : '🔴';
  const color = isPass ? '#22c55e' : '#ef4444';

  const memRecall = trace.memory_events ? trace.memory_events.filter((e) => e.type === 'memory_recalled').length : 0;
  const memWrite  = trace.memory_events ? trace.memory_events.filter((e) => e.type === 'episode_memory_written').length : 0;
  const memFail   = trace.memory_events ? trace.memory_events.filter((e) => e.type === 'episode_memory_write_failed').length : 0;

  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${statusEmoji} RStack SDLC Task Execution Report: ${taskId}*`,
      },
    },
    {
      type: 'fields',
      fields: [
        { type: 'mrkdwn', text: `*Run ID:*\n${runId}` },
        { type: 'mrkdwn', text: `*Task:*\n${taskId}` },
        { type: 'mrkdwn', text: `*Status:*\n${trace.status ?? 'UNKNOWN'}` },
        { type: 'mrkdwn', text: `*Tool Calls:*\n${trace.tool_call_count}` },
        { type: 'mrkdwn', text: `*Guardrail Hits:*\n${trace.guardrail_hit_count}` },
        { type: 'mrkdwn', text: `*Memory Actions:*\n${memRecall} recalled / ${memWrite} written${memFail > 0 ? ` (${memFail} failed)` : ''}` },
      ],
    },
  ];

  if (trace.validation && trace.validation.checks) {
    const checksText = trace.validation.checks.map(c => {
      const icon = c.status === 'PASS' ? '🟢' : '🔴';
      return `${icon} *${c.name}*: ${c.evidence || 'No evidence detail'}`;
    }).join('\n');
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Validation Checks:*\n${checksText}`,
      },
    });
  }

  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: 'RStack developed by Richardson Gunde',
      },
    ],
  });

  return {
    attachments: [
      {
        color,
        blocks,
      },
    ],
  };
}

