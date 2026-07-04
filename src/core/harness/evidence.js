import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { withFileLock } from './safe-write.js';

export const EVIDENCE_REQUIRED_FIELDS = Object.freeze(['task_id', 'kind', 'status', 'evidence']);
export const EVIDENCE_STATUSES = Object.freeze(['PASS', 'FAIL', 'BLOCKED', 'INFO']);

function hasOwn(value, field) {
  return Object.prototype.hasOwnProperty.call(value, field);
}

export function validateEvidenceEvent(event) {
  const checks = EVIDENCE_REQUIRED_FIELDS.map((field) => ({
    name: `evidence_has_${field}`,
    status: event && hasOwn(event, field) ? 'PASS' : 'FAIL',
    evidence: event && hasOwn(event, field) ? 'present' : 'missing',
  }));

  if (event && hasOwn(event, 'status')) {
    checks.push({
      name: 'evidence_status_allowed',
      status: EVIDENCE_STATUSES.includes(event.status) ? 'PASS' : 'FAIL',
      evidence: String(event.status),
    });
  }

  const issues = checks.filter((check) => check.status === 'FAIL');
  return { ok: issues.length === 0, checks, issues };
}

export async function appendEvidenceEvent(runDir, event) {
  const result = validateEvidenceEvent(event);
  if (!result.ok) {
    const missing = result.issues.map((issue) => issue.name.replace('evidence_has_', '')).join(', ');
    throw new Error(`Invalid evidence event: ${missing}`);
  }

  const eventPath = join(runDir, 'evidence.jsonl');
  await mkdir(dirname(eventPath), { recursive: true });
  // The evidence ledger is the audit surface — hold the same lock every other
  // canonical state file uses so parallel agents can never interleave a line.
  await withFileLock(eventPath, async () => {
    await appendFile(eventPath, `${JSON.stringify({ ts: new Date().toISOString(), ...event })}\n`);
  });
  return eventPath;
}

export async function readEvidenceEvents(runDir) {
  const eventPath = join(runDir, 'evidence.jsonl');
  const raw = await readFile(eventPath, 'utf8').catch((error) => {
    if (error?.code === 'ENOENT') return '';
    throw error;
  });
  return raw
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((entry) => validateEvidenceEvent(entry).ok);
}
