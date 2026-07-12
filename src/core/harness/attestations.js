// owner: RStack developed by Richardson Gunde
//
// Attestation envelopes (#73): wrap the business-readable contracts RStack
// already writes (builder.json, validation.json, readiness reports) in a
// DSSE-style envelope so the evidence is tamper-evident and verifiable long
// after the run finished. The envelope records WHAT was attested (subject:
// run, task, commit, file checksums), WHO produced it (agent, harness, model
// — the #72 identity fields), and the contract snapshot itself (predicate).
//
// Signing modes are deliberately modest:
//   - unsigned            — default local mode; the envelope is still useful
//                           (checksums detect drift) but proves no author.
//   - local-dev-signature — HMAC-SHA256 over the canonical envelope payload,
//                           keyed by RSTACK_ATTESTATION_KEY. Shared-secret
//                           integrity for a team that controls the key.
// Sigstore/keyless signing is an intentional extension point, not a
// dependency: `signature.type` is open and verification of unknown types
// reports honestly instead of pretending to verify.

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { BUILDER_STATUSES, VALIDATOR_STATUSES } from './contracts.js';
import { canonicalJson } from './telemetry.js';
import { resolveRunId, runDirectory } from './runs.js';
import { writeJsonAtomic } from './safe-write.js';

export const ATTESTATION_SCHEMA = 'rstack.dev/attestation/v1alpha1';
export const PREDICATE_TYPES = Object.freeze({
  builder: 'rstack.dev/builder-contract/v1alpha1',
  validator: 'rstack.dev/validator-contract/v1alpha1',
  readiness: 'rstack.dev/release-readiness/v1alpha1',
});
export const SIGNATURE_TYPES = Object.freeze(['unsigned', 'local-dev-signature']);
export const ATTESTATION_KEY_ENV = 'RSTACK_ATTESTATION_KEY';

// ── commit identity ───────────────────────────────────────────────────────────

// Read HEAD without shelling out (env-scan.js philosophy): .git/HEAD → ref →
// refs/heads/<branch> or packed-refs. Returns null when the project is not a
// git checkout — an attestation without a commit is still valid evidence.
export function readHeadCommit(projectRoot) {
  try {
    const headPath = join(projectRoot, '.git', 'HEAD');
    if (!existsSync(headPath)) return null;
    const head = readFileSync(headPath, 'utf8').trim();
    if (/^[0-9a-f]{40}$/i.test(head)) return head; // detached HEAD
    const refMatch = head.match(/^ref:\s*(.+)$/);
    if (!refMatch) return null;
    const ref = refMatch[1].trim();
    const refPath = join(projectRoot, '.git', ...ref.split('/'));
    if (existsSync(refPath)) {
      const sha = readFileSync(refPath, 'utf8').trim();
      return /^[0-9a-f]{40}$/i.test(sha) ? sha : null;
    }
    const packedPath = join(projectRoot, '.git', 'packed-refs');
    if (!existsSync(packedPath)) return null;
    for (const line of readFileSync(packedPath, 'utf8').split('\n')) {
      const packed = line.trim().match(/^([0-9a-f]{40})\s+(.+)$/i);
      if (packed && packed[2] === ref) return packed[1];
    }
    return null;
  } catch {
    return null;
  }
}

// ── subject file checksums ────────────────────────────────────────────────────

function hashFileSha256(absolutePath) {
  return createHash('sha256').update(readFileSync(absolutePath)).digest('hex');
}

// Project-relative paths → { path, sha256 } records. A path that does not
// exist at attest time is recorded with sha256: null rather than dropped —
// the subject must say what the contract CLAIMED, not a cleaned-up version.
export function subjectFiles(projectRoot, paths) {
  const records = [];
  for (const path of paths ?? []) {
    if (typeof path !== 'string' || !path.trim()) continue;
    const absolute = resolve(projectRoot, path);
    try {
      records.push({ path, sha256: existsSync(absolute) ? hashFileSha256(absolute) : null });
    } catch {
      records.push({ path, sha256: null });
    }
  }
  return records;
}

// ── envelope construction and signing ─────────────────────────────────────────

function signaturePayload(envelope) {
  const { signature: _signature, ...payload } = envelope;
  return canonicalJson(payload);
}

export function signEnvelope(envelope, key = process.env[ATTESTATION_KEY_ENV]) {
  if (typeof key === 'string' && key.trim()) {
    return {
      ...envelope,
      signature: {
        type: 'local-dev-signature',
        value: createHmac('sha256', key.trim()).update(signaturePayload(envelope)).digest('hex'),
      },
    };
  }
  return { ...envelope, signature: { type: 'unsigned', value: '' } };
}

export function verifyEnvelopeSignature(envelope, key = process.env[ATTESTATION_KEY_ENV]) {
  const type = envelope?.signature?.type;
  if (type === 'unsigned') return { verified: false, reason: 'unsigned envelope' };
  if (type !== 'local-dev-signature') return { verified: false, reason: `unknown signature type "${type}" — this verifier only checks local-dev-signature` };
  if (typeof key !== 'string' || !key.trim()) return { verified: false, reason: `no signing key — set ${ATTESTATION_KEY_ENV}` };
  const expected = createHmac('sha256', key.trim()).update(signaturePayload(envelope)).digest('hex');
  const actual = String(envelope.signature.value ?? '');
  const matches = expected.length === actual.length
    && timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(actual, 'utf8'));
  return matches ? { verified: true, reason: 'local-dev-signature verified' } : { verified: false, reason: 'signature does not match the envelope payload' };
}

export function buildAttestation({ runId, taskId = null, commit = null, files = [], producer = {}, predicateType, predicate, key }) {
  const envelope = {
    schema: ATTESTATION_SCHEMA,
    subject: { run_id: runId, task_id: taskId, commit, files },
    producer: {
      agent: producer.agent ?? null,
      harness: producer.harness ?? null,
      model: producer.model ?? null,
    },
    predicateType,
    predicate,
    created_at: new Date().toISOString(),
  };
  return signEnvelope(envelope, key);
}

// ── attest a run ──────────────────────────────────────────────────────────────

async function readJsonQuiet(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function attestationsDir(projectRoot, runId) {
  return join(runDirectory(projectRoot, runId), 'attestations');
}

// Wrap every contract the run has produced. Layout is per-task (the issue's
// flat builder.attestation.json cannot address a multi-task run):
//   attestations/<task-id>.builder.attestation.json
//   attestations/<task-id>.validator.attestation.json
//   attestations/release-readiness.attestation.json
export async function attestRun(projectRoot, runId, { key } = {}) {
  const selected = await resolveRunId(projectRoot, runId);
  const runDir = runDirectory(projectRoot, selected);
  const outDir = attestationsDir(projectRoot, selected);
  const commit = readHeadCommit(projectRoot);
  const taskState = await readJsonQuiet(join(runDir, 'tasks.json'));
  const tasks = Array.isArray(taskState?.tasks) ? taskState.tasks : [];
  const written = [];
  const skipped = [];

  for (const task of tasks) {
    if (!task?.id || !task?.output_dir) continue;
    const taskDir = join(projectRoot, task.output_dir);
    const builderPath = join(task.output_dir, 'builder.json');
    const builder = await readJsonQuiet(join(projectRoot, builderPath));
    if (builder) {
      const files = subjectFiles(projectRoot, [
        builderPath,
        ...(Array.isArray(builder.files_modified) ? builder.files_modified : []),
      ]);
      const envelope = buildAttestation({
        runId: selected,
        taskId: task.id,
        commit,
        files,
        producer: { agent: builder.agent ?? 'builder', harness: builder.harness ?? null, model: builder.model ?? null },
        predicateType: PREDICATE_TYPES.builder,
        predicate: builder,
        key,
      });
      const outFile = join(outDir, `${task.id}.builder.attestation.json`);
      await writeJsonAtomic(outFile, envelope);
      written.push({ task_id: task.id, kind: 'builder', file: outFile });
    } else {
      skipped.push({ task_id: task.id, kind: 'builder', reason: 'no builder.json' });
    }

    const validationPath = join(task.output_dir, 'validation.json');
    const validation = await readJsonQuiet(join(taskDir, 'validation.json'));
    if (validation) {
      const envelope = buildAttestation({
        runId: selected,
        taskId: task.id,
        commit,
        // The validator attests OVER the builder contract — its subject is the
        // contract it judged, plus its own report.
        files: subjectFiles(projectRoot, [validationPath, builderPath]),
        producer: { agent: validation.validator ?? 'validator', harness: validation.harness ?? null, model: validation.model ?? null },
        predicateType: PREDICATE_TYPES.validator,
        predicate: validation,
        key,
      });
      const outFile = join(outDir, `${task.id}.validator.attestation.json`);
      await writeJsonAtomic(outFile, envelope);
      written.push({ task_id: task.id, kind: 'validator', file: outFile });
    } else {
      skipped.push({ task_id: task.id, kind: 'validator', reason: 'no validation.json' });
    }
  }

  // Release readiness: wrap the persisted readiness reports when present
  // (dorCheck writes readiness.json + dor-report.json into the run dir).
  const readiness = await readJsonQuiet(join(runDir, 'readiness.json'));
  if (readiness) {
    const runRelative = (name) => join(projectRelativePath(projectRoot, runDir), name);
    const envelope = buildAttestation({
      runId: selected,
      taskId: null,
      commit,
      files: subjectFiles(projectRoot, [runRelative('readiness.json'), runRelative('dor-report.json')]),
      producer: { agent: 'rstack-harness', harness: process.env.RSTACK_HARNESS ?? null, model: null },
      predicateType: PREDICATE_TYPES.readiness,
      predicate: readiness,
      key,
    });
    const outFile = join(outDir, 'release-readiness.attestation.json');
    await writeJsonAtomic(outFile, envelope);
    written.push({ task_id: null, kind: 'release-readiness', file: outFile });
  } else {
    skipped.push({ task_id: null, kind: 'release-readiness', reason: 'no readiness.json' });
  }

  return { run_id: selected, commit, written, skipped, signed: Boolean((key ?? process.env[ATTESTATION_KEY_ENV] ?? '').trim()) };
}

// Run-dir path → project-relative prefix for subject files.
function projectRelativePath(projectRoot, runDir) {
  return runDir.startsWith(projectRoot) ? runDir.slice(projectRoot.length).replace(/^[\\/]/, '') : runDir;
}

// ── verify a run's attestations ───────────────────────────────────────────────

function predicateIssues(envelope) {
  const issues = [];
  const predicate = envelope.predicate;
  if (!predicate || typeof predicate !== 'object' || Array.isArray(predicate)) {
    return [{ type: 'invalid-predicate', message: 'predicate must be an object' }];
  }
  if (envelope.predicateType === PREDICATE_TYPES.builder) {
    if (!BUILDER_STATUSES.includes(predicate.status)) {
      issues.push({ type: 'invalid-predicate', message: `builder predicate status "${predicate.status}" is not one of ${BUILDER_STATUSES.join(' | ')}` });
    }
    if (envelope.subject?.task_id && predicate.task_id !== envelope.subject.task_id) {
      issues.push({ type: 'invalid-predicate', message: `predicate task_id "${predicate.task_id}" does not match subject task_id "${envelope.subject.task_id}"` });
    }
  } else if (envelope.predicateType === PREDICATE_TYPES.validator) {
    if (!VALIDATOR_STATUSES.includes(predicate.status)) {
      issues.push({ type: 'invalid-predicate', message: `validator predicate status "${predicate.status}" is not one of ${VALIDATOR_STATUSES.join(' | ')}` });
    }
  } else if (envelope.predicateType !== PREDICATE_TYPES.readiness) {
    issues.push({ type: 'invalid-predicate', message: `unknown predicateType "${envelope.predicateType}"` });
  }
  return issues;
}

export async function verifyRunAttestations(projectRoot, runId, { key, requireSignature = false } = {}) {
  const selected = await resolveRunId(projectRoot, runId);
  const runDir = runDirectory(projectRoot, selected);
  const dir = attestationsDir(projectRoot, selected);
  const findings = [];
  let entries = [];
  try {
    entries = (await readdir(dir)).filter((name) => name.endsWith('.attestation.json')).sort();
  } catch { /* no attestations dir — reported below as empty, not a crash */ }

  for (const name of entries) {
    const issues = [];
    let envelope = null;
    try {
      envelope = JSON.parse(await readFile(join(dir, name), 'utf8'));
    } catch (error) {
      findings.push({ file: name, valid: false, issues: [{ type: 'malformed', message: `unreadable envelope: ${error.message}` }] });
      continue;
    }
    if (envelope?.schema !== ATTESTATION_SCHEMA) {
      issues.push({ type: 'schema', message: `unknown schema "${envelope?.schema}" — expected ${ATTESTATION_SCHEMA}` });
    }
    if (!envelope?.subject || typeof envelope.subject !== 'object') {
      issues.push({ type: 'mismatched-subject', message: 'envelope has no subject' });
    } else {
      if (envelope.subject.run_id !== selected) {
        issues.push({ type: 'mismatched-subject', message: `subject run_id "${envelope.subject.run_id}" does not match run "${selected}"` });
      }
      for (const record of Array.isArray(envelope.subject.files) ? envelope.subject.files : []) {
        if (typeof record?.path !== 'string' || record.sha256 == null) continue; // recorded-missing at attest time
        const absolute = resolve(projectRoot, record.path);
        if (!existsSync(absolute)) {
          issues.push({ type: 'stale', message: `subject file ${record.path} no longer exists` });
          continue;
        }
        try {
          const current = hashFileSha256(absolute);
          if (current !== record.sha256) {
            issues.push({ type: 'stale', message: `subject file ${record.path} changed after attestation (checksum mismatch)` });
          }
        } catch {
          issues.push({ type: 'stale', message: `subject file ${record.path} is unreadable` });
        }
      }
    }
    if (envelope) issues.push(...predicateIssues(envelope));
    if (envelope?.signature?.type && envelope.signature.type !== 'unsigned') {
      const signature = verifyEnvelopeSignature(envelope, key);
      if (!signature.verified) issues.push({ type: 'signature', message: signature.reason });
    } else if (requireSignature) {
      issues.push({ type: 'signature', message: 'unsigned envelope but signatures are required' });
    }
    findings.push({
      file: name,
      valid: issues.length === 0,
      issues,
      // Envelope metadata for timelines (Business Hub) — never trusted for
      // the verdict, only for display.
      predicate_type: envelope?.predicateType ?? null,
      task_id: envelope?.subject?.task_id ?? null,
      created_at: envelope?.created_at ?? null,
      signature_type: envelope?.signature?.type ?? null,
      producer: envelope?.producer ?? null,
    });
  }

  // Completeness: contracts on disk that have no envelope yet.
  const missing = [];
  const taskState = await readJsonQuiet(join(runDir, 'tasks.json'));
  for (const task of Array.isArray(taskState?.tasks) ? taskState.tasks : []) {
    if (!task?.id || !task?.output_dir) continue;
    for (const [kind, contract] of [['builder', 'builder.json'], ['validator', 'validation.json']]) {
      if (existsSync(join(projectRoot, task.output_dir, contract))
        && !entries.includes(`${task.id}.${kind}.attestation.json`)) {
        missing.push({ task_id: task.id, kind, reason: `${contract} exists but has no attestation — run \`rstack-agents attest\`` });
      }
    }
  }

  const invalid = findings.filter((finding) => !finding.valid);
  return {
    run_id: selected,
    total: findings.length,
    valid: findings.length - invalid.length,
    invalid,
    findings,
    missing,
    ok: invalid.length === 0,
  };
}
