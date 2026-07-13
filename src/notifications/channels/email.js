/**
 * Email channel (#353) — approval notifications via Azure Communication
 * Services, routed per person through the role map in
 * .rstack/notifications.json.
 *
 * Contract (stricter than the other senders): this sender NEVER throws. A
 * failed or unconfigured email logs to stderr and returns a status string —
 * a notification must never fail or block the calling tool. Email is a
 * notification layer only: the approval itself always goes through the
 * audited claim-gate path (#133), never through the email.
 *
 * Config (resolveChannels): { sender, endpoint?, connection_string, projectRoot }
 *   - sender + optional endpoint come from notifications.json (committable);
 *   - connection_string comes ONLY from RSTACK_ACS_CONNECTION_STRING (env);
 *   - the channel is enabled only when both halves are present.
 *
 * owner: RStack developed by Richardson Gunde
 */

import { parseAcsConnectionString, sendAcsEmail } from '../email.js';
import { loadRecipients, loadManagers, resolveApprovalRecipients } from '../recipients.js';
import { slackPayloadToText } from './text.js';

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function businessHubApprovalsLink(env = process.env) {
  const raw = Number(env.RSTACK_BUSINESS_PORT);
  const port = Number.isFinite(raw) && raw > 0 ? raw : 3008;
  return `http://localhost:${port}/?page=approvals`;
}

function formatApprovalEmail({ meta, slackPayload, link }) {
  const artifacts = Array.isArray(meta.artifacts) && meta.artifacts.length
    ? meta.artifacts
    : [meta.artifact].filter(Boolean);
  const subjectTarget = artifacts.length ? artifacts.join(', ') : `run ${meta.run_id ?? 'unknown'}`;
  const subject = `[RStack] Approval required: ${subjectTarget}`;
  const reason = meta.reason || slackPayloadToText(slackPayload) || 'A governed task is blocked pending human approval.';

  const lines = [
    `Approval required in RStack run ${meta.run_id ?? 'unknown'}.`,
    '',
    ...(meta.task_id ? [`Task: ${meta.task_id}`] : []),
    ...(artifacts.length ? [`Blocked on: ${artifacts.join(', ')}`] : []),
    `Why: ${reason}`,
    '',
    `Approve from the Business Hub: ${link}`,
    '',
    'This email is a notification only — the approval itself is recorded through',
    "RStack's audited, token-verified approval path, never from this email.",
  ];
  const plainText = lines.join('\n');
  const html = [
    `<p>Approval required in RStack run <strong>${escapeHtml(meta.run_id ?? 'unknown')}</strong>.</p>`,
    '<p>',
    ...(meta.task_id ? [`Task: <strong>${escapeHtml(meta.task_id)}</strong><br/>`] : []),
    ...(artifacts.length ? [`Blocked on: <strong>${escapeHtml(artifacts.join(', '))}</strong><br/>`] : []),
    `Why: ${escapeHtml(reason)}`,
    '</p>',
    `<p><a href="${escapeHtml(link)}">Approve from the Business Hub</a> (${escapeHtml(link)})</p>`,
    "<p><em>This email is a notification only — the approval itself is recorded through RStack's audited approval path.</em></p>",
  ].join('\n');
  return { subject, plainText, html, artifacts };
}

/**
 * CHANNEL_SENDERS entry. `meta` is the approval context notifyAll passes
 * through untouched to every sender (existing channels ignore it):
 * { kind: 'approval_required', run_id, task_id, artifact|artifacts, stage_ids?, reason? }.
 */
export async function sendEmail(config, slackPayload, meta) {
  try {
    if (!config?.connection_string || !config?.sender) {
      return 'email: unconfigured (set RSTACK_ACS_CONNECTION_STRING and channels.email.sender in .rstack/notifications.json)';
    }
    // Only approval notifications are emailed — people registered for
    // sign-offs must not be spammed with every stage PASS/FAIL webhooks get.
    if (meta?.kind !== 'approval_required') {
      return 'email: skipped (only approval_required notifications are emailed)';
    }

    const { endpoint: connEndpoint, accessKey } = parseAcsConnectionString(config.connection_string);
    const endpoint = config.endpoint || connEndpoint;

    const projectRoot = config.projectRoot;
    const { recipients, routing } = loadRecipients(projectRoot);
    const managers = loadManagers(projectRoot);

    const artifacts = Array.isArray(meta.artifacts) && meta.artifacts.length
      ? meta.artifacts
      : [meta.artifact].filter(Boolean);
    const resolved = new Map();
    for (const artifact of artifacts.length ? artifacts : [null]) {
      for (const person of resolveApprovalRecipients({ artifact, stageId: meta.stage_ids, recipients, routing, managers })) {
        resolved.set(person.email.toLowerCase(), person);
      }
    }
    if (resolved.size === 0) {
      console.error(`[rstack email] no email recipients resolved for ${artifacts.join(', ') || 'approval'} — add recipients/routing to .rstack/notifications.json`);
      return 'email: no recipients resolved';
    }

    const link = businessHubApprovalsLink();
    const { subject, plainText, html } = formatApprovalEmail({ meta, slackPayload, link });

    // One email per recipient, To only — recipient lists must never leak
    // between people (no CC/BCC fan-out).
    let sent = 0;
    const failures = [];
    for (const person of resolved.values()) {
      try {
        await sendAcsEmail({ endpoint, accessKey, sender: config.sender, to: person, subject, plainText, html });
        sent += 1;
      } catch (err) {
        failures.push(person.role);
        console.error(`[rstack email] send to ${person.role} failed: ${String(err?.message ?? err).slice(0, 200)}`);
      }
    }
    return failures.length
      ? `email: sent ${sent}/${resolved.size} (failed: ${failures.join(', ')})`
      : `email: sent ${sent}/${resolved.size}`;
  } catch (err) {
    // Best-effort by contract: never throw, never block the calling tool.
    console.error(`[rstack email] channel error: ${String(err?.message ?? err).slice(0, 200)}`);
    return `email: failed (${String(err?.message ?? err).slice(0, 120)})`;
  }
}
