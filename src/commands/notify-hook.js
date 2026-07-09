// owner: RStack developed by Richardson Gunde
//
// rstack-agents notify-hook (#255): the framework-neutral NOTIFICATION relay.
//
// Wire it into a harness's Notification hook (Claude Code Notification) and it
// forwards the host's notification to every configured RStack channel
// (Slack/Teams/Discord/Telegram/WhatsApp via src/notifications/router.js) so a
// human is told when an agent needs input or a long task finished — on ANY
// harness, not just Pi.
//
// This is a RELAY, not a gate. The hard rules (deliberate, tested):
//   (a) NEVER blocks — always exit 0, whatever happens. A notification hook must
//       never disrupt the session it is reporting on.
//   (b) NEVER throws out of the handler — everything is wrapped; notifyAll is
//       already fire-and-forget and never throws, but we double-wrap.
//   (c) No channels configured → silent no-op. We don't error when the user
//       hasn't set up notifications.
//   (d) Secret-safe — we forward only the host's short message/title text
//       (redacted + truncated), never tool inputs or file contents. This is the
//       ONE hook that makes a network call, and it is best-effort with a
//       per-channel timeout inside the router.
//   (e) Bounded — the message is truncated so a runaway payload can't be relayed
//       verbatim.

import { resolve } from 'node:path';

import { notifyAll, hasConfiguredChannels } from '../notifications/router.js';

// Hard ceiling on the whole relay so a slow/dead webhook can never stall the
// session (#258 review). The notification is best-effort — missing one is fine.
const NOTIFY_TIMEOUT_MS = 5000;

// `--source` is an env/flag-controlled label that ends up in the message header
// and event fields; constrain it to a safe token so it can't carry a secret,
// control chars, or markup. Unknown → 'custom'. (#258 review)
const KNOWN_SOURCES = new Set(['claude-code', 'tau', 'operator', 'pi', 'custom']);
export function sanitizeSource(source) {
  if (typeof source !== 'string' || !source) return undefined;
  const cleaned = source.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32);
  if (!cleaned) return undefined;
  return KNOWN_SOURCES.has(cleaned) ? cleaned : 'custom';
}

// Match observe's inline-secret sniffers so a message that accidentally carries
// a credential is scrubbed before it leaves the machine. (Kept in sync with
// observe.js on purpose — a message is host free text.)
const INLINE_SECRET_PATTERNS = [
  /[\w.-]*(?:pass(?:word|wd)?|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret|credential)[\w.-]*\s*[:=]\s*\S+/gi,
  /\b(?:bearer|authorization)\b\s*:?\s+\S{8,}/gi,
  /\b(?:AKIA|ASIA)[A-Z0-9]{8,}\b/g,
  /\b(?:gh[pousr]|xox[baprs])_[A-Za-z0-9]{10,}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/g,
];
const REDACTED = '[redacted]';
const MAX_MESSAGE_CHARS = 600;

function redactSecrets(text) {
  if (typeof text !== 'string' || !text) return text;
  let out = text;
  for (const pattern of INLINE_SECRET_PATTERNS) out = out.replace(pattern, REDACTED);
  return out;
}

function safeText(text, max = MAX_MESSAGE_CHARS) {
  const str = redactSecrets(typeof text === 'string' ? text : String(text ?? ''));
  return str.length > max ? `${str.slice(0, max)}…` : str;
}

/**
 * Pull the human message + optional title out of a Notification hook payload.
 * Accepts Claude Code shape ({ message, title, hook_event_name }) and generic
 * shapes ({ text }). Returns { message, title } with safe (redacted+truncated)
 * strings, or null when there is nothing to relay.
 */
export function parseNotification(raw) {
  let parsed = null;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const j = JSON.parse(raw);
      if (j && typeof j === 'object' && !Array.isArray(j)) parsed = j;
    } catch {
      // non-JSON stdin — treat the raw text as the message itself.
      const msg = safeText(raw);
      return msg ? { message: msg, title: null } : null;
    }
  } else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    parsed = raw;
  }
  if (!parsed) return null;
  const rawMessage = parsed.message ?? parsed.text ?? parsed.body ?? '';
  const message = safeText(rawMessage);
  if (!message) return null;
  const rawTitle = parsed.title ?? parsed.hook_event_name ?? parsed.hookEventName ?? null;
  const title = rawTitle != null ? safeText(rawTitle, 120) : null;
  return { message, title };
}

/** Build a minimal Slack-format payload the router can fan out to any channel. */
export function buildNotifyPayload({ message, title }, source) {
  const header = title ? `*RStack · ${title}*` : '*RStack notification*';
  const src = source ? ` _(${source})_` : '';
  return { text: `${header}${src}\n${message}` };
}

/**
 * The whole notify operation, wrapped so it NEVER throws. Returns
 * { notified, reason, results? }. Callers translate this to always-exit-0.
 */
export async function runNotifyHook({
  stdinText = '', source, project, message, title, env = process.env, cwd = process.cwd(), senders,
  timeoutMs = NOTIFY_TIMEOUT_MS,
} = {}) {
  try {
    const projectRoot = resolve(project ?? env.RSTACK_PROJECT_ROOT ?? cwd);

    // No channels configured anywhere (file or env) → silent no-op. Don't parse,
    // don't network, don't error.
    if (!hasConfiguredChannels({ projectRoot, env })) {
      return { notified: false, reason: 'no notification channels configured (silent no-op)' };
    }

    let notification = null;
    if (message !== undefined) {
      const msg = safeText(message);
      if (msg) notification = { message: msg, title: title != null ? safeText(title, 120) : null };
    } else {
      notification = parseNotification(stdinText);
    }
    if (!notification) {
      return { notified: false, reason: 'nothing to notify (empty/unparseable payload)' };
    }

    const payload = buildNotifyPayload(notification, sanitizeSource(source));
    // notifyAll captures per-channel errors, but the underlying webhook senders
    // have no network timeout — a slow/dead endpoint would hang this hook and
    // stall the session. Bound the whole relay with a hard race so the hook
    // always returns promptly; a laggy webhook just misses this one notice. (#258 review)
    let timerHandle;
    const timer = new Promise((res) => { timerHandle = setTimeout(() => res('__timeout__'), timeoutMs); });
    const results = await Promise.race([
      notifyAll(payload, { projectRoot, env, ...(senders ? { senders } : {}) }),
      timer,
    ]);
    clearTimeout(timerHandle);
    if (results === '__timeout__') {
      return { notified: false, reason: `notify timed out after ${timeoutMs}ms (ignored)` };
    }
    return { notified: results.some((r) => r.ok), reason: 'relayed', results };
  } catch (error) {
    return { notified: false, reason: `notify failed (ignored): ${error?.message ?? error}` };
  }
}

/** Read the hook payload from stdin (capped); empty string when stdin is a TTY. */
const MAX_STDIN_BYTES = 1_000_000;
export async function readStdinText(stream = process.stdin) {
  if (stream.isTTY) return '';
  let data = '';
  stream.setEncoding('utf8');
  for await (const chunk of stream) {
    data += chunk;
    if (data.length >= MAX_STDIN_BYTES) return data.slice(0, MAX_STDIN_BYTES);
  }
  return data;
}

/**
 * CLI wrapper. ALWAYS resolves to exit code 0 (a notification relay never
 * blocks). Silent unless --verbose.
 */
export async function runNotifyHookCommand(opts = {}, { stdinText = '', env = process.env, cwd = process.cwd(), stderr = process.stderr } = {}) {
  const result = await runNotifyHook({
    stdinText,
    // Own env var (notify is a distinct system from observe); accept the
    // observe var as back-compat. sanitizeSource whitelists the result. (#258 review)
    source: opts.source ?? env.RSTACK_NOTIFY_SOURCE ?? env.RSTACK_OBSERVE_SOURCE,
    project: opts.project,
    message: opts.message,
    title: opts.title,
    env,
    cwd,
  });
  if (opts.verbose) {
    stderr.write(`[rstack notify-hook] ${result.notified ? 'relayed' : 'skipped'}: ${result.reason}\n`);
  }
  return 0; // rule (a): never blocks, always exit 0.
}
