import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

// owner: RStack developed by Richardson Gunde

export function safeJson(str) {
  try { return JSON.parse(str); } catch { return null; }
}

export function readJsonlSync(filePath) {
  if (!existsSync(filePath)) return [];
  try {
    return readFileSync(filePath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .flatMap((line) => {
        const parsed = safeJson(line);
        return parsed ? [parsed] : [];
      });
  } catch {
    return [];
  }
}

export async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}
