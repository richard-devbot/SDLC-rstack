import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

// owner: RStack developed by Richardson Gunde

export function safeJson(str) {
  try { return JSON.parse(str); } catch { return null; }
}

export async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

// Tracked readers (#82): a missing file is normal, but a file that exists and
// cannot be parsed is damage the operator must see — record it instead of
// silently rendering confident-looking zeros.
export async function readJsonTracked(filePath, fallback, integrity, label) {
  let raw;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch {
    return fallback;
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    integrity?.push({ file: label ?? filePath, error: `malformed JSON: ${error.message}` });
    return fallback;
  }
}

export function readJsonlTracked(filePath, integrity, label) {
  if (!existsSync(filePath)) return [];
  let raw;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (error) {
    integrity?.push({ file: label ?? filePath, error: `unreadable: ${error.message}` });
    return [];
  }
  const parsed = [];
  let malformed = 0;
  for (const line of raw.split('\n').filter(Boolean)) {
    const entry = safeJson(line);
    if (entry) parsed.push(entry);
    else malformed += 1;
  }
  if (malformed) {
    integrity?.push({ file: label ?? filePath, error: `${malformed} malformed JSONL line(s) dropped` });
  }
  return parsed;
}
