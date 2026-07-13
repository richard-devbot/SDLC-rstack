/**
 * Azure Communication Services (ACS) Email — dependency-free REST client (#353).
 *
 * ACS Email is called directly over HTTPS with HMAC-SHA256 access-key request
 * signing (learn.microsoft.com/rest/api/communication/authentication), the
 * same node:crypto pattern as the #73 attestation signing — zero new deps.
 *
 * Secret handling (non-negotiable): the access key arrives ONLY via the
 * RSTACK_ACS_CONNECTION_STRING environment variable
 * (`endpoint=https://...;accesskey=...`). It is never read from any
 * .rstack/*.json file, never logged, and never included in an error message —
 * config files carry the endpoint and sender address only.
 *
 * owner: RStack developed by Richardson Gunde
 */

import { createHash, createHmac } from 'node:crypto';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';

export const ACS_EMAIL_API_VERSION = '2023-03-31';

// Hard per-request timeout mirroring the #291 postJson hardening: node's
// http(s) request has NO default timeout, so a black-holed ACS endpoint would
// otherwise hang the calling tool. Overridable via RSTACK_WEBHOOK_TIMEOUT_MS
// (same knob as the webhook channels — one timeout policy for notifications).
const DEFAULT_TIMEOUT_MS = 10_000;

function resolveTimeoutMs(env = process.env) {
  const raw = Number(env.RSTACK_WEBHOOK_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
}

/**
 * Parse an ACS connection string (`endpoint=https://...;accesskey=...`) into
 * { endpoint, accessKey }. Keys are case-insensitive; the accesskey value may
 * itself contain '=' (base64 padding), so each part splits at the FIRST '='.
 * Throws on a malformed string — callers treat that as "unconfigured".
 */
export function parseAcsConnectionString(str) {
  const out = {};
  for (const part of String(str ?? '').split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim().toLowerCase();
    const value = part.slice(idx + 1).trim();
    if (key === 'endpoint' && value) out.endpoint = value.replace(/\/+$/, '');
    if (key === 'accesskey' && value) out.accessKey = value;
  }
  if (!out.endpoint || !out.accessKey) {
    // Deliberately does NOT echo the input: a malformed connection string may
    // still contain a valid key fragment, which must never reach a log line.
    throw new Error('invalid ACS connection string — expected "endpoint=https://...;accesskey=..." (set RSTACK_ACS_CONNECTION_STRING)');
  }
  return out;
}

/**
 * Sign an ACS REST request per the Communication Services HMAC scheme (pure —
 * fixed inputs produce fixed headers, pinned by a golden-vector test):
 *
 *   string-to-sign = VERB \n <path?query> \n <x-ms-date>;<host>;<base64 SHA256 of body>
 *   Authorization  = HMAC-SHA256 SignedHeaders=x-ms-date;host;x-ms-content-sha256&Signature=<sig>
 *
 * where <sig> = base64(HMAC-SHA256(base64-decoded access key, string-to-sign)).
 * `host` includes the port when non-default (it must equal the Host header
 * node sends). Returns the three headers the request must carry.
 */
export function signAcsRequest({ method, url, body, accessKey, date = new Date() }) {
  const parsed = new URL(url);
  const dateHeader = (date instanceof Date ? date : new Date(date)).toUTCString();
  const contentHash = createHash('sha256').update(body ?? '', 'utf8').digest('base64');
  const stringToSign = `${String(method).toUpperCase()}\n${parsed.pathname}${parsed.search}\n${dateHeader};${parsed.host};${contentHash}`;
  const signature = createHmac('sha256', Buffer.from(accessKey, 'base64')).update(stringToSign, 'utf8').digest('base64');
  return {
    'x-ms-date': dateHeader,
    'x-ms-content-sha256': contentHash,
    Authorization: `HMAC-SHA256 SignedHeaders=x-ms-date;host;x-ms-content-sha256&Signature=${signature}`,
  };
}

// Signed POST mirroring the #291-hardened postJson in channels/http.js:
// socket timeout with destroy-on-timeout, double-settle guard, 2xx = ok.
// Local (not reused) because the body must be the EXACT string that was
// hashed into x-ms-content-sha256, and tests need plain-http fake servers.
function postSigned(urlString, bodyString, headers) {
  return new Promise((resolvePromise, reject) => {
    try {
      const url = new URL(urlString);
      const timeoutMs = resolveTimeoutMs();
      const requestFn = url.protocol === 'http:' ? httpRequest : httpsRequest;
      const options = {
        hostname: url.hostname,
        port: url.port || undefined,
        path: url.pathname + url.search,
        method: 'POST',
        timeout: timeoutMs,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyString),
          ...headers,
        },
      };
      let settled = false;
      const finishOk = (value) => { if (!settled) { settled = true; resolvePromise(value); } };
      const finishErr = (err) => { if (!settled) { settled = true; reject(err); } };

      const req = requestFn(options, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            finishOk(body || 'ok');
          } else {
            finishErr(new Error(`ACS email send failed with status ${res.statusCode}. Body: ${String(body).slice(0, 300)}`));
          }
        });
      });
      // Node does NOT auto-abort on the socket 'timeout' event — destroy the
      // request so it surfaces as an 'error' and rejects.
      req.on('timeout', () => {
        req.destroy(new Error(`ACS email send timed out after ${timeoutMs}ms`));
      });
      req.on('error', finishErr);
      req.write(bodyString);
      req.end();
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Send one email through ACS Email REST (`POST /emails:send`). `to` is a
 * single recipient ({ email, name? } or a bare address string) — approval
 * notifications go out one email per person, To only, so recipient lists
 * never leak between people. Rejects on failure; the channel layer converts
 * that into a logged, non-throwing status (notifications are best-effort).
 */
export async function sendAcsEmail({ endpoint, accessKey, sender, to, subject, plainText, html }) {
  if (!endpoint || !accessKey || !sender) {
    throw new Error('ACS email: endpoint, access key, and sender are required');
  }
  const address = typeof to === 'string' ? to : to?.email ?? to?.address;
  if (!address) throw new Error('ACS email: recipient address is required');
  const displayName = typeof to === 'object' && to?.name ? { displayName: String(to.name) } : {};

  const base = String(endpoint).replace(/\/+$/, '');
  const url = `${base}/emails:send?api-version=${ACS_EMAIL_API_VERSION}`;
  const payload = {
    senderAddress: sender,
    content: { subject, plainText, ...(html ? { html } : {}) },
    recipients: { to: [{ address, ...displayName }] },
  };
  const body = JSON.stringify(payload);
  const headers = signAcsRequest({ method: 'POST', url, body, accessKey });
  return postSigned(url, body, headers);
}
