import { request } from 'node:https';

// owner: RStack developed by Richardson Gunde

function convertSlackToDiscord(slackPayload) {
  if (!slackPayload || !slackPayload.attachments) return slackPayload;
  const embeds = slackPayload.attachments.map((att) => {
    const embed = {
      color: att.color ? parseInt(att.color.replace('#', ''), 16) : 0,
      fields: []
    };
    
    let descriptionLines = [];
    let footerText = '';

    for (const block of (att.blocks || [])) {
      if (block.type === 'section' && block.text) {
        descriptionLines.push(block.text.text);
      }
      if (block.type === 'fields' && block.fields) {
        for (const f of block.fields) {
          const raw = f.text || '';
          const parts = raw.split('\n');
          const name = parts[0] ? parts[0].replace(/\*/g, '') : 'Detail';
          const value = parts.slice(1).join('\n') || '—';
          embed.fields.push({ name, value, inline: true });
        }
      }
      if (block.type === 'context' && block.elements) {
        footerText = block.elements.map(e => e.text || '').join(' | ');
      }
    }
    
    if (descriptionLines.length > 0) {
      embed.description = descriptionLines.join('\n');
    }
    if (footerText) {
      embed.footer = { text: footerText };
    }
    return embed;
  });

  return { embeds };
}

function convertSlackToTeams(slackPayload) {
  if (!slackPayload || !slackPayload.attachments) return slackPayload;
  const att = slackPayload.attachments[0];
  const themeColor = att && att.color ? att.color.replace('#', '') : '3b82f6';
  
  const sections = [];
  let summary = 'RStack SDLC Notification';

  if (att && att.blocks) {
    for (const block of att.blocks) {
      if (block.type === 'section' && block.text) {
        summary = block.text.text.replace(/\*/g, '');
        sections.push({
          activityTitle: block.text.text,
          activitySubtitle: 'RStack System Event',
          facts: []
        });
      }
      if (block.type === 'fields' && block.fields) {
        const currentSection = sections[sections.length - 1] || { facts: [] };
        if (!sections.includes(currentSection)) {
          sections.push(currentSection);
        }
        for (const f of block.fields) {
          const raw = f.text || '';
          const parts = raw.split('\n');
          const name = parts[0] ? parts[0].replace(/\*/g, '') : 'Detail';
          const value = parts.slice(1).join('\n') || '—';
          currentSection.facts.push({ name, value });
        }
      }
    }
  }

  return {
    "@type": "MessageCard",
    "@context": "http://schema.org/extensions",
    themeColor,
    summary,
    sections
  };
}

/**
 * Dispatches an HTTP POST payload to the Slack, Teams, or Discord Webhook URL.
 * Fails gracefully by logging to console if the webhook is not configured.
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

  return new Promise((resolve, reject) => {
    try {
      const url = new URL(webhookUrl);
      const data = JSON.stringify(finalPayload);

      const options = {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
      };

      const req = request(options, (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(body || 'ok');
          } else {
            reject(new Error(`Webhook post failed with status: ${res.statusCode}. Body: ${body}`));
          }
        });
      });

      req.on('error', (e) => reject(e));
      req.write(data);
      req.end();
    } catch (err) {
      reject(err);
    }
  });
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

