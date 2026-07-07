// owner: RStack developed by Richardson Gunde
//
// .env file primitives for the Business Hub environment page (#238).
//
// Trust rules this module enforces:
//   - Plaintext values NEVER leave this module through any listing API —
//     listEnvKeys returns key names + set/length only (no "first 3 chars"
//     leaks, no value echoes).
//   - Writes are crash-safe and lost-update-safe: withFileLock + atomic
//     rename (safe-write.js), untouched lines preserved VERBATIM (comments,
//     blank lines, quoting, ordering, CRLF vs LF).
//   - Key names are validated against a strict pattern; values are size
//     capped. Malformed input throws with .statusCode = 400 so HTTP callers
//     can map it directly.
//   - isEnvGitignored answers "would committing this repo leak the file" —
//     the env-write route REFUSES to write until .env is gitignored.

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { withFileLock, writeFileAtomic } from './safe-write.js';

const execFileAsync = promisify(execFile);

// Uppercase, digits and underscores only, starting with a letter — the
// conventional env-var shape. Anything else (lowercase, dots, dashes, shell
// metacharacters) is rejected outright rather than "cleaned up".
export const ENV_KEY_PATTERN = /^[A-Z][A-Z0-9_]*$/;

// Values are secrets/config strings, not documents. 4 KiB is generous for
// any real credential; anything larger is almost certainly a mistake (or an
// attempt to stuff a payload through the approval gate).
export const ENV_VALUE_MAX_BYTES = 4 * 1024;

export function isValidEnvKey(key) {
  return typeof key === 'string' && ENV_KEY_PATTERN.test(key);
}

export function envFilePath(projectRoot) {
  return join(projectRoot, '.env');
}

function badRequest(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

// One line of a .env file. `raw` is the exact original text (no EOL);
// assignment lines additionally carry { key, value } with the value
// unquoted/unescaped. Comments and blank lines have key = null.
const ASSIGNMENT = /^(\s*)(export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=(.*)$/;

function unquote(rawValue) {
  const trimmed = rawValue.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    // Single left-to-right pass so escape sequences cannot interfere with
    // each other (e.g. a literal backslash followed by an 'n').
    return trimmed.slice(1, -1).replace(/\\([\\"nr])/g, (_, ch) =>
      ch === 'n' ? '\n' : ch === 'r' ? '\r' : ch);
  }
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1);
  }
  // Unquoted: strip a trailing ` # comment` (dotenv-style inline comment).
  const hash = trimmed.search(/\s+#/);
  return (hash === -1 ? trimmed : trimmed.slice(0, hash)).trim();
}

/**
 * Parse .env file content. Returns { lines, entries }:
 *   lines   — every physical line as { raw, key, value } (key null for
 *             comments/blank lines); raw is verbatim, EOL excluded.
 *   entries — [{ key, value }] deduplicated, LAST assignment wins (matches
 *             plain object-assignment parse semantics).
 * Never throws on junk content — unparseable lines are preserved as raw.
 */
export function parseEnvFile(content) {
  const text = typeof content === 'string' ? content : '';
  const lines = text.split(/\r?\n/).map((raw) => {
    const match = ASSIGNMENT.exec(raw);
    if (!match || raw.trim().startsWith('#')) return { raw, key: null, value: null };
    return { raw, key: match[3], value: unquote(match[4]) };
  });
  // A trailing newline produces one empty trailing element — that is the
  // "file ends with a newline" marker, kept so rewrites round-trip exactly.
  const byKey = new Map();
  for (const line of lines) {
    if (line.key) byKey.set(line.key, line.value);
  }
  return { lines, entries: [...byKey].map(([key, value]) => ({ key, value })) };
}

// Serialize a value for a KEY=value line. Simple values stay bare; anything
// with whitespace, quotes, '#' or control characters is double-quoted with
// escapes so it survives a round-trip through parseEnvFile/dotenv.
export function formatEnvValue(value) {
  const str = String(value ?? '');
  if (str !== '' && /^[A-Za-z0-9_@%+=:,./-]+$/.test(str)) return str;
  return '"' + str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r') + '"';
}

/**
 * List the keys defined in <projectRoot>/.env — NEVER the values.
 * Returns [{ key, set: true, length }] in file order (last duplicate wins).
 * A missing or unreadable file is an honest empty list.
 */
export async function listEnvKeys(projectRoot) {
  let content;
  try {
    content = await readFile(envFilePath(projectRoot), 'utf8');
  } catch {
    return [];
  }
  return parseEnvFile(content).entries.map(({ key, value }) => ({
    key,
    set: true,
    length: String(value ?? '').length,
  }));
}

/**
 * Set (create or update) one key in <projectRoot>/.env.
 *   - lock + atomic write (safe-write.js) — no torn files, no lost updates
 *   - untouched lines byte-identical (comments, blanks, quoting, order)
 *   - original EOL convention (CRLF vs LF) preserved
 *   - every existing assignment line for the key is rewritten (so no parser
 *     semantics — first-wins or last-wins — can resurrect the old value);
 *     a missing key is appended at the end
 *   - a missing .env is created
 * Throws (.statusCode = 400) on an invalid key or oversized/non-string value.
 * Returns { key, created, length } — never the value.
 */
export async function updateEnvKey(projectRoot, key, value) {
  if (!isValidEnvKey(key)) {
    throw badRequest(`invalid env key ${JSON.stringify(String(key ?? ''))} — keys must match ${ENV_KEY_PATTERN}`);
  }
  if (typeof value !== 'string') {
    throw badRequest('env value must be a string');
  }
  if (Buffer.byteLength(value, 'utf8') > ENV_VALUE_MAX_BYTES) {
    throw badRequest(`env value exceeds ${ENV_VALUE_MAX_BYTES} bytes`);
  }

  const path = envFilePath(projectRoot);
  return withFileLock(path, async () => {
    let content = '';
    try {
      content = await readFile(path, 'utf8');
    } catch {
      // Missing file: created below.
    }
    const eol = content.includes('\r\n') ? '\r\n' : '\n';
    const { lines } = parseEnvFile(content);
    const formatted = formatEnvValue(value);
    let replaced = false;
    const nextLines = lines.map((line) => {
      if (line.key !== key) return line.raw;
      replaced = true;
      // Preserve the original line's leading whitespace and `export ` prefix.
      const match = ASSIGNMENT.exec(line.raw);
      const prefix = match ? `${match[1]}${match[2] ?? ''}` : '';
      return `${prefix}${key}=${formatted}`;
    });
    if (!replaced) {
      // Drop the trailing empty element (the end-of-file newline marker) so
      // the appended line lands before it, then restore it below.
      while (nextLines.length && nextLines[nextLines.length - 1] === '') nextLines.pop();
      nextLines.push(`${key}=${formatted}`);
    }
    let output = nextLines.join(eol);
    if (!output.endsWith(eol)) output += eol;
    await writeFileAtomic(path, output);
    return { key, created: !replaced, length: value.length };
  });
}

// Match the .gitignore patterns that actually cover a root-level .env file.
// Deliberately narrow: this is a fallback for hosts without a git binary,
// not a general gitignore engine.
const GITIGNORE_ENV_PATTERNS = new Set(['.env', '/.env', '*.env', '.env*', '.env.*']);

function gitignoreCoversDotEnv(content) {
  return String(content ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !line.startsWith('!'))
    .some((line) => GITIGNORE_ENV_PATTERNS.has(line));
}

/**
 * Is <projectRoot>/.env ignored by git? Authoritative check is
 * `git check-ignore -q .env` (exit 0 = ignored, 1 = not ignored). When the
 * git binary is unavailable, fall back to scanning .gitignore for the
 * standard `.env` patterns — but only inside a real repo (`.git` present).
 * No repo means no gitignore semantics at all → NOT ignored (the env-write
 * route refuses, fail closed).
 */
export async function isEnvGitignored(projectRoot) {
  try {
    await execFileAsync('git', ['check-ignore', '-q', '.env'], { cwd: projectRoot, timeout: 5000 });
    return true;
  } catch (err) {
    if (err && err.code === 1) return false; // definitive: not ignored
    if (err && (err.code === 'ENOENT' || err.code === 'EACCES')) {
      // git binary unavailable — manual .gitignore scan, repo required.
      if (!existsSync(join(projectRoot, '.git'))) return false;
      try {
        const gitignore = await readFile(join(projectRoot, '.gitignore'), 'utf8');
        return gitignoreCoversDotEnv(gitignore);
      } catch {
        return false;
      }
    }
    // Exit 128 (not a repo) or anything else unexpected: fail closed.
    return false;
  }
}

// Exported for direct unit testing of the fallback matcher.
export { gitignoreCoversDotEnv };
