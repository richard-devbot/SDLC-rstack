// owner: RStack developed by Richardson Gunde
//
// rstack-agents observe (#251): the framework-neutral OBSERVABILITY writer.
//
// The Business Hub derives every timeline, burst, and status from
// `.rstack/runs/<run_id>/events.jsonl`. On Pi the native extension writes a
// `tool_call` / `tool_result` event for every tool the agent runs, so the
// dashboard mirrors the terminal live. On Claude Code / Tau / Operator the
// only wiring was the READ-ONLY `rstack-agents guard` (PreToolUse) — it never
// writes an event — so ordinary terminal work (bash/write/edit) never reached
// the dashboard. This command closes that gap: any harness with a
// post-execution (or pre-execution) tool hook pipes the hook payload here and
// we append a NORMALIZED event, IDENTICAL in shape to Pi's, so the dashboard
// renders harness activity exactly like a Pi run.
//
// This is OBSERVABILITY, not a gate. The hard rules (deliberate, tested):
//   (a) NEVER blocks — always exit 0, whatever happens. A nonzero exit from a
//       post-tool hook must never disrupt the user's session.
//   (b) NEVER throws out of the handler — everything is wrapped, best-effort.
//   (c) Value-safe — inputs/summaries are truncated (~1200 chars, matching
//       Pi's truncateText budget) and any value that looks like a secret path
//       or an inline credential is redacted before it can reach the ledger.
//       We never echo full file contents.
//   (d) Fast — no network, no heavy work, one locked append.
//   (e) No active run → silent no-op. We do NOT create runs; observing must
//       never manufacture state.

import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { withFileLock } from '../core/harness/safe-write.js';
import { resolveRunId, runDirectory } from '../core/harness/runs.js';

// Match Pi's truncateText budget (rstack-sdlc.ts:1161) so harness events and
// Pi events share the exact same size ceiling on disk.
const MAX_CHARS = 1200;

// Env a host sets so the writer targets a specific run (mirrors guard's
// --run-id / latest resolution). Falls through to the latest run otherwise.
export const OBSERVE_RUN_ID_ENV = 'RSTACK_RUN_ID';

// Default source label when the caller does not name its harness.
const DEFAULT_SOURCE = 'unknown';

// Recognized normalized event types. Anything else is coerced to a generic
// tool_call so the dashboard's tool-burst rollup still counts the activity.
const KNOWN_TYPES = new Set(['tool_call', 'tool_result', 'session_shutdown']);

// Inline-secret sniffers: redact obvious credential material even when it is
// not a file path (a `--token=...`, `AWS_SECRET_ACCESS_KEY=...`, bearer token,
// or a long high-entropy-looking key). Best-effort — the primary defense is
// truncation; this catches the common, embarrassing cases.
const INLINE_SECRET_PATTERNS = [
  /\b(?:pass(?:word|wd)?|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret|auth|bearer|credential)s?\b\s*[:=]\s*\S+/gi,
  /\b(?:AKIA|ASIA)[A-Z0-9]{8,}\b/g, // AWS access key ids
  /\b(?:gh[pousr]|xox[baprs])_[A-Za-z0-9]{10,}\b/g, // GitHub / Slack tokens
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/g, // JWTs
];

// File paths that must never be echoed even by name-with-content. We only ever
// keep the path segment; content values touching these are redacted.
const SECRET_PATH_HINT = /(^|[/\\])(\.env(\.\S+)?|\.npmrc|\.pypirc|id_rsa|id_ed25519|id_ecdsa|credentials?|secrets?)($|[/\\.])|\.(pem|key|p12|pfx|keystore)\b/i;

const REDACTED = '[redacted]';

/** Truncate exactly like Pi's truncateText so on-disk shapes match. */
function truncate(text, maxChars = MAX_CHARS) {
  const str = typeof text === 'string' ? text : String(text ?? '');
  if (str.length <= maxChars) return str;
  return `${str.slice(0, maxChars)}\n\n[Truncated by RStack to keep context bounded]`;
}

/** Redact inline credential material from a string (best-effort). */
function redactSecrets(text) {
  if (typeof text !== 'string' || !text) return text;
  let out = text;
  for (const pattern of INLINE_SECRET_PATTERNS) out = out.replace(pattern, REDACTED);
  return out;
}

/**
 * Make ONE value safe to write: strings are redacted then truncated; anything
 * that looks like a secret path is replaced wholesale. Non-strings are
 * shallow-serialized (never the full object graph) and the same rules applied.
 */
function safeValue(value) {
  if (value == null) return value;
  if (typeof value === 'string') {
    if (SECRET_PATH_HINT.test(value) && /[=:]/.test(value)) return REDACTED;
    return truncate(redactSecrets(value));
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  // Objects/arrays: keep them small and safe. Stringify a shallow copy, cap it.
  try {
    return truncate(redactSecrets(JSON.stringify(value)));
  } catch {
    return REDACTED;
  }
}

/**
 * Sanitize a tool input object so no field carries a full secret or blows the
 * size budget. Returns a plain object with the same keys, safe values. A
 * secret-looking KEY (e.g. `password`) is dropped to [redacted] regardless of
 * value. Non-object inputs collapse to {}.
 */
export function sanitizeInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return typeof input === 'string' ? { value: safeValue(input) } : {};
  }
  const out = {};
  for (const [key, value] of Object.entries(input)) {
    if (/(pass(word|wd)?|secret|token|api[_-]?key|credential|private[_-]?key)/i.test(key)) {
      out[key] = REDACTED;
      continue;
    }
    // file_path / path: keep the path itself (it is useful and non-secret in
    // the common case), but never keep the CONTENT field of a write verbatim.
    if (/(content|contents|body|data|new_string|old_string)/i.test(key)) {
      out[key] = typeof value === 'string' ? `[${value.length} chars omitted]` : REDACTED;
      continue;
    }
    out[key] = safeValue(value);
  }
  return out;
}

/**
 * Parse an observability hook payload. Accepts:
 *   - Claude Code PostToolUse JSON: { tool_name, tool_input, tool_response, ... }
 *   - Claude Code Stop / SessionEnd JSON: { hook_event_name: "Stop" | ... }
 *   - Pi-style: { type, tool, input, summary }
 *   - Generic: { toolName, input }
 * plus explicit flags via `overrides` ({ eventType, tool, summary, isError }).
 * Returns a normalized { type, tool, input?, summary?, isError? } or null when
 * there is nothing worth recording.
 */
export function normalizeObservation(raw, overrides = {}) {
  let parsed = null;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const j = JSON.parse(raw);
      if (j && typeof j === 'object' && !Array.isArray(j)) parsed = j;
    } catch {
      // non-JSON stdin — flags may still carry a valid observation
    }
  } else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    parsed = raw;
  }

  // Explicit flags win over stdin.
  const hookEvent = String(parsed?.hook_event_name ?? parsed?.hookEventName ?? '').trim();
  let type = String(overrides.eventType ?? parsed?.type ?? '').trim();

  // Map Claude Code lifecycle hooks to our normalized vocabulary.
  if (!type) {
    if (hookEvent === 'Stop' || hookEvent === 'SessionEnd' || hookEvent === 'SubagentStop') {
      type = 'session_shutdown';
    } else if (hookEvent === 'PostToolUse' || hookEvent === 'PreToolUse') {
      type = hookEvent === 'PostToolUse' ? 'tool_result' : 'tool_call';
    }
  }

  const tool = overrides.tool
    ?? parsed?.tool
    ?? parsed?.tool_name
    ?? parsed?.toolName
    ?? null;

  // Session-lifecycle events carry no tool.
  if (type === 'session_shutdown') {
    return { type: 'session_shutdown' };
  }

  // Default: if we have a tool name (from flags or payload) treat it as a
  // tool_call; if we also have a result/summary, it's a tool_result.
  const rawSummary = overrides.summary
    ?? parsed?.summary
    ?? extractResponseText(parsed?.tool_response ?? parsed?.tool_result ?? parsed?.toolResult ?? parsed?.result ?? parsed?.content);

  const hasResult = overrides.summary !== undefined
    || overrides.eventType === 'tool_result'
    || parsed?.type === 'tool_result'
    || hookEvent === 'PostToolUse'
    || rawSummary != null;

  if (!type) type = hasResult ? 'tool_result' : (tool ? 'tool_call' : '');

  if (!KNOWN_TYPES.has(type)) {
    // Unknown/unsupported type but we do have a tool → record as a tool_call so
    // it still shows in the burst rollup. Otherwise nothing to record.
    if (tool) type = 'tool_call';
    else return null;
  }

  if (type === 'tool_result') {
    const isError = overrides.isError
      ?? parsed?.isError
      ?? parsed?.is_error
      ?? (typeof parsed?.tool_response === 'object' ? Boolean(parsed.tool_response?.is_error) : undefined)
      ?? false;
    return {
      type: 'tool_result',
      tool: tool ?? null,
      isError: Boolean(isError),
      summary: truncate(redactSecrets(String(rawSummary ?? ''))),
    };
  }

  // tool_call
  if (!tool) return null;
  return {
    type: 'tool_call',
    tool,
    input: sanitizeInput(parsed?.tool_input ?? parsed?.input ?? overrides.input ?? {}),
  };
}

/** Pull a text summary out of a Claude Code tool_response / Pi content shape. */
function extractResponseText(response) {
  if (response == null) return undefined;
  if (typeof response === 'string') return response;
  if (Array.isArray(response)) {
    return response.map((part) => (typeof part === 'string' ? part : part?.text ?? '')).join('\n');
  }
  if (typeof response === 'object') {
    if (typeof response.stdout === 'string' || typeof response.stderr === 'string') {
      return [response.stdout, response.stderr].filter(Boolean).join('\n');
    }
    if (typeof response.text === 'string') return response.text;
    if (typeof response.content === 'string') return response.content;
    if (Array.isArray(response.content)) return extractResponseText(response.content);
    try { return JSON.stringify(response); } catch { return undefined; }
  }
  return undefined;
}

/**
 * Append a normalized observation to a run's events.jsonl, matching Pi's shape
 * EXACTLY ({ ts, type, tool, ... }) plus a `source` label. Locked + best-effort
 * (Pi uses a bare appendFile; we hold the same lock the evidence ledger uses so
 * a parallel writer can never interleave a line). Returns the event path on
 * success, null if nothing was written.
 */
export async function appendObservation(runDir, observation, source) {
  if (!observation) return null;
  const eventPath = join(runDir, 'events.jsonl');
  const event = { ts: new Date().toISOString(), source: source || DEFAULT_SOURCE, ...observation };
  await mkdir(dirname(eventPath), { recursive: true });
  await withFileLock(eventPath, async () => {
    await appendFile(eventPath, `${JSON.stringify(event)}\n`);
  });
  return eventPath;
}

/**
 * The whole observe operation, wrapped so it NEVER throws. Returns
 * { written, reason, event?, runId? }. Callers translate this to always-exit-0.
 */
export async function runObserve({
  stdinText = '', eventType, tool, summary, isError, source,
  project, runId, env = process.env, cwd = process.cwd(),
} = {}) {
  try {
    const observation = normalizeObservation(stdinText, {
      eventType, tool, summary,
      isError: isError === undefined ? undefined : isError,
    });
    if (!observation) {
      return { written: false, reason: 'nothing observable in the payload (no tool, no lifecycle event)' };
    }

    const projectRoot = resolve(project ?? env.RSTACK_PROJECT_ROOT ?? cwd);
    let selectedRun;
    try {
      selectedRun = await resolveRunId(projectRoot, runId ?? env[OBSERVE_RUN_ID_ENV]);
    } catch {
      // No active run (or an invalid id): silent no-op. Observability must
      // never create or demand run state.
      return { written: false, reason: 'no active run — nothing to observe (silent no-op)' };
    }

    const runDir = runDirectory(projectRoot, selectedRun);
    const eventPath = await appendObservation(runDir, observation, source);
    return { written: Boolean(eventPath), reason: 'observed', event: observation, runId: selectedRun };
  } catch (error) {
    // Best-effort: a failed observation must NEVER surface as an error to the
    // hook. Report it for the (opt-in) stderr path and move on.
    return { written: false, reason: `observe failed (ignored): ${error?.message ?? error}` };
  }
}

/** Read the full hook payload from stdin; empty string when stdin is a TTY. */
export async function readStdinText(stream = process.stdin) {
  if (stream.isTTY) return '';
  let data = '';
  stream.setEncoding('utf8');
  for await (const chunk of stream) data += chunk;
  return data;
}

/**
 * CLI wrapper. ALWAYS resolves to exit code 0 (observability never blocks).
 * With --verbose, prints a one-line result to stderr; otherwise stays silent
 * so it never clutters a user's terminal on every tool call.
 */
export async function runObserveCommand(opts = {}, { stdinText = '', env = process.env, cwd = process.cwd(), stderr = process.stderr } = {}) {
  const result = await runObserve({
    stdinText,
    eventType: opts.eventType,
    tool: opts.tool,
    summary: opts.summary,
    isError: opts.isError,
    source: opts.source ?? env.RSTACK_OBSERVE_SOURCE,
    project: opts.project,
    runId: opts.runId,
    env,
    cwd,
  });
  if (opts.verbose) {
    stderr.write(`[rstack observe] ${result.written ? 'wrote' : 'skipped'}: ${result.reason}\n`);
  }
  return 0; // rule (a): never blocks, always exit 0.
}
