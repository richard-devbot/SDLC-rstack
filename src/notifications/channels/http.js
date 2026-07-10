/**
 * Shared HTTPS JSON POST for webhook channels.
 *
 * owner: RStack developed by Richardson Gunde
 */

import { request } from 'node:https';

// Hard per-request timeout (#291): node:https has NO default timeout, so a
// webhook host that accepts the connection but never responds would hang the
// caller forever. notify-hook.js additionally races the whole relay, but the
// direct sdlc_start/approve/validate callers rely on this socket-level cap.
// Overridable via RSTACK_WEBHOOK_TIMEOUT_MS.
const DEFAULT_WEBHOOK_TIMEOUT_MS = 10_000;

function resolveTimeoutMs(env = process.env) {
  const raw = Number(env.RSTACK_WEBHOOK_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_WEBHOOK_TIMEOUT_MS;
}

export function postJson(urlString, payload, headers = {}) {
  return new Promise((resolvePromise, reject) => {
    try {
      const url = new URL(urlString);
      const data = JSON.stringify(payload);
      const timeoutMs = resolveTimeoutMs();
      const options = {
        hostname: url.hostname,
        port: url.port || undefined,
        path: url.pathname + url.search,
        method: 'POST',
        timeout: timeoutMs,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
          ...headers,
        },
      };
      // Guard against double-settle (timeout firing after a late response, etc).
      let settled = false;
      const finishOk = (value) => { if (!settled) { settled = true; resolvePromise(value); } };
      const finishErr = (err) => { if (!settled) { settled = true; reject(err); } };

      const req = request(options, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            finishOk(body || 'ok');
          } else {
            finishErr(new Error(`Webhook post failed with status: ${res.statusCode}. Body: ${body}`));
          }
        });
      });
      // The socket idle-timeout fires 'timeout'; node does NOT auto-abort, so
      // destroy the request — that surfaces as an 'error' and rejects below.
      req.on('timeout', () => {
        req.destroy(new Error(`Webhook post timed out after ${timeoutMs}ms`));
      });
      req.on('error', finishErr);
      req.write(data);
      req.end();
    } catch (err) {
      reject(err);
    }
  });
}
