// Attestation envelopes (#73): attest wraps builder/validator/readiness
// contracts in signed-or-signable envelopes; verify detects valid, missing,
// stale, mismatched-subject, and invalid-predicate cases.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  ATTESTATION_SCHEMA,
  PREDICATE_TYPES,
  attestRun,
  buildAttestation,
  readHeadCommit,
  signEnvelope,
  subjectFiles,
  verifyEnvelopeSignature,
  verifyRunAttestations,
} from '../src/core/harness/attestations.js';
import { runVerifyAttestations, formatVerifyAttestations } from '../src/commands/attest.js';

const KEY = 'test-signing-key';

function seedRun(projectRoot, runId, { tasks = [], taskFiles = {}, runFiles = {} } = {}) {
  const runDir = path.join(projectRoot, '.rstack', 'runs', runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(path.join(runDir, 'manifest.json'), JSON.stringify({ run_id: runId, goal: 'Attestation fixture', status: 'IN_PROGRESS' }));
  writeFileSync(path.join(runDir, 'tasks.json'), JSON.stringify({ tasks }));
  for (const [name, content] of Object.entries(runFiles)) {
    writeFileSync(path.join(runDir, name), typeof content === 'string' ? content : JSON.stringify(content));
  }
  for (const [taskId, files] of Object.entries(taskFiles)) {
    const taskDir = path.join(runDir, 'tasks', taskId);
    mkdirSync(taskDir, { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(path.join(taskDir, name), typeof content === 'string' ? content : JSON.stringify(content));
    }
  }
  return runDir;
}

const RUN_ID = 'run-20260712-attest';
const outputDir = (taskId) => `.rstack/runs/${RUN_ID}/tasks/${taskId}`;

function seedTypicalRun(projectRoot) {
  const builder = {
    task_id: '001-code', agent: 'backend-builder', harness: 'claude-code', model: 'claude-sonnet-5',
    status: 'PASS', summary: 'implemented the endpoint', files_modified: ['src/app.js'],
    tests_run: ['npm test'], risks: [], next_steps: [],
  };
  const validation = {
    task_id: '001-code', validator: 'rstack-pi-extension', harness: 'pi', validator_type: 'code',
    status: 'PASS', checks: [], issues: [], retry_recommendation: 'none',
  };
  mkdirSync(path.join(projectRoot, 'src'), { recursive: true });
  writeFileSync(path.join(projectRoot, 'src', 'app.js'), 'export const app = 1;\n');
  return seedRun(projectRoot, RUN_ID, {
    tasks: [{ id: '001-code', output_dir: outputDir('001-code') }],
    taskFiles: { '001-code': { 'builder.json': builder, 'validation.json': validation } },
    runFiles: {
      'readiness.json': { run_id: RUN_ID, status: 'READY', score: 1 },
      'dor-report.json': { status: 'READY', pending_required: [] },
    },
  });
}

test('attest wraps builder, validator, and readiness evidence; verify passes', async () => {
  const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'rstack-attest-'));
  seedTypicalRun(projectRoot);

  const attested = await attestRun(projectRoot, RUN_ID);
  assert.equal(attested.written.length, 3);
  assert.deepEqual(attested.written.map((w) => w.kind).sort(), ['builder', 'release-readiness', 'validator']);
  assert.equal(attested.signed, false);

  const builderEnvelope = JSON.parse(readFileSync(
    path.join(projectRoot, '.rstack', 'runs', RUN_ID, 'attestations', '001-code.builder.attestation.json'), 'utf8'));
  assert.equal(builderEnvelope.schema, ATTESTATION_SCHEMA);
  assert.equal(builderEnvelope.predicateType, PREDICATE_TYPES.builder);
  assert.equal(builderEnvelope.subject.run_id, RUN_ID);
  assert.equal(builderEnvelope.producer.harness, 'claude-code');
  assert.equal(builderEnvelope.signature.type, 'unsigned');
  // subject covers the contract itself plus every claimed file, checksummed
  const paths = builderEnvelope.subject.files.map((f) => f.path);
  assert.ok(paths.some((p) => p.endsWith('builder.json')));
  assert.ok(paths.includes('src/app.js'));
  assert.ok(builderEnvelope.subject.files.every((f) => typeof f.sha256 === 'string'));

  const verified = await verifyRunAttestations(projectRoot, RUN_ID);
  assert.equal(verified.ok, true);
  assert.equal(verified.valid, 3);
  assert.deepEqual(verified.missing, []);
});

test('stale subject: editing a claimed file after attestation is detected', async () => {
  const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'rstack-attest-'));
  seedTypicalRun(projectRoot);
  await attestRun(projectRoot, RUN_ID);
  writeFileSync(path.join(projectRoot, 'src', 'app.js'), 'export const app = 2; // tampered\n');

  const verified = await verifyRunAttestations(projectRoot, RUN_ID);
  assert.equal(verified.ok, false);
  const builderFinding = verified.findings.find((f) => f.file.includes('builder'));
  assert.equal(builderFinding.valid, false);
  assert.ok(builderFinding.issues.some((i) => i.type === 'stale' && i.message.includes('src/app.js')));
  // the untouched validator + readiness envelopes stay valid
  assert.equal(verified.valid, 2);
});

test('mismatched subject: an envelope copied from another run is rejected', async () => {
  const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'rstack-attest-'));
  seedTypicalRun(projectRoot);
  await attestRun(projectRoot, RUN_ID);
  const dir = path.join(projectRoot, '.rstack', 'runs', RUN_ID, 'attestations');
  const envelope = JSON.parse(readFileSync(path.join(dir, '001-code.builder.attestation.json'), 'utf8'));
  envelope.subject.run_id = 'some-other-run';
  writeFileSync(path.join(dir, '001-code.builder.attestation.json'), JSON.stringify(envelope));

  const verified = await verifyRunAttestations(projectRoot, RUN_ID);
  const finding = verified.findings.find((f) => f.file.includes('builder'));
  assert.ok(finding.issues.some((i) => i.type === 'mismatched-subject'));
});

test('invalid predicate: an illegal contract status is rejected', async () => {
  const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'rstack-attest-'));
  seedTypicalRun(projectRoot);
  await attestRun(projectRoot, RUN_ID);
  const file = path.join(projectRoot, '.rstack', 'runs', RUN_ID, 'attestations', '001-code.validator.attestation.json');
  const envelope = JSON.parse(readFileSync(file, 'utf8'));
  envelope.predicate.status = 'MAYBE';
  writeFileSync(file, JSON.stringify(envelope));

  const verified = await verifyRunAttestations(projectRoot, RUN_ID);
  const finding = verified.findings.find((f) => f.file.includes('validator'));
  assert.ok(finding.issues.some((i) => i.type === 'invalid-predicate' && i.message.includes('MAYBE')));
});

test('missing: contracts without envelopes are reported informationally', async () => {
  const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'rstack-attest-'));
  seedTypicalRun(projectRoot);
  // no attest run — everything is missing, but nothing is invalid
  const verified = await verifyRunAttestations(projectRoot, RUN_ID);
  assert.equal(verified.ok, true);
  assert.equal(verified.total, 0);
  assert.deepEqual(verified.missing.map((m) => m.kind).sort(), ['builder', 'validator']);
  const text = formatVerifyAttestations(await runVerifyAttestations(projectRoot, { runId: RUN_ID }));
  assert.match(text, /missing: 001-code builder/);
});

test('signing: key produces local-dev-signature; wrong key and tampering fail verification', async () => {
  const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'rstack-attest-'));
  seedTypicalRun(projectRoot);
  const attested = await attestRun(projectRoot, RUN_ID, { key: KEY });
  assert.equal(attested.signed, true);

  const file = path.join(projectRoot, '.rstack', 'runs', RUN_ID, 'attestations', '001-code.builder.attestation.json');
  const envelope = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(envelope.signature.type, 'local-dev-signature');
  assert.equal(verifyEnvelopeSignature(envelope, KEY).verified, true);
  assert.equal(verifyEnvelopeSignature(envelope, 'wrong-key').verified, false);

  // full-run verification with the right key passes…
  assert.equal((await verifyRunAttestations(projectRoot, RUN_ID, { key: KEY })).ok, true);
  // …and a payload edit invalidates the signature even with the right key
  envelope.predicate.summary = 'rewritten history';
  writeFileSync(file, JSON.stringify(envelope));
  const verified = await verifyRunAttestations(projectRoot, RUN_ID, { key: KEY });
  const finding = verified.findings.find((f) => f.file.includes('builder'));
  assert.ok(finding.issues.some((i) => i.type === 'signature'));
});

test('requireSignature fails unsigned envelopes', async () => {
  const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'rstack-attest-'));
  seedTypicalRun(projectRoot);
  await attestRun(projectRoot, RUN_ID);
  const verified = await verifyRunAttestations(projectRoot, RUN_ID, { requireSignature: true });
  assert.equal(verified.ok, false);
  assert.ok(verified.invalid.every((f) => f.issues.some((i) => i.type === 'signature')));
});

test('signature is order-independent: reordered envelope keys still verify', () => {
  const envelope = signEnvelope({
    schema: ATTESTATION_SCHEMA,
    subject: { run_id: 'r', task_id: 't', commit: null, files: [] },
    producer: { agent: 'a', harness: 'h', model: null },
    predicateType: PREDICATE_TYPES.builder,
    predicate: { task_id: 't', status: 'PASS' },
    created_at: '2026-07-12T00:00:00.000Z',
  }, KEY);
  const reordered = JSON.parse(JSON.stringify({
    predicate: envelope.predicate,
    subject: envelope.subject,
    schema: envelope.schema,
    created_at: envelope.created_at,
    predicateType: envelope.predicateType,
    producer: envelope.producer,
    signature: envelope.signature,
  }));
  assert.equal(verifyEnvelopeSignature(reordered, KEY).verified, true);
});

test('subjectFiles records missing files with a null checksum instead of dropping them', () => {
  const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'rstack-attest-'));
  writeFileSync(path.join(projectRoot, 'real.txt'), 'content');
  const files = subjectFiles(projectRoot, ['real.txt', 'ghost.txt', '', null]);
  assert.equal(files.length, 2);
  assert.equal(typeof files.find((f) => f.path === 'real.txt').sha256, 'string');
  assert.equal(files.find((f) => f.path === 'ghost.txt').sha256, null);
});

test('readHeadCommit resolves a branch ref without shelling out, null outside git', () => {
  const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'rstack-attest-git-'));
  assert.equal(readHeadCommit(projectRoot), null);
  const sha = 'a'.repeat(40);
  mkdirSync(path.join(projectRoot, '.git', 'refs', 'heads'), { recursive: true });
  writeFileSync(path.join(projectRoot, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  writeFileSync(path.join(projectRoot, '.git', 'refs', 'heads', 'main'), `${sha}\n`);
  assert.equal(readHeadCommit(projectRoot), sha);
  // detached HEAD
  writeFileSync(path.join(projectRoot, '.git', 'HEAD'), `${sha}\n`);
  assert.equal(readHeadCommit(projectRoot), sha);
});

test('buildAttestation stamps commit and producer identity into the envelope', () => {
  const envelope = buildAttestation({
    runId: 'r1', taskId: 't1', commit: 'b'.repeat(40), files: [],
    producer: { agent: 'builder', harness: 'codex', model: 'gpt-5' },
    predicateType: PREDICATE_TYPES.builder,
    predicate: { task_id: 't1', status: 'PASS' },
  });
  assert.equal(envelope.subject.commit, 'b'.repeat(40));
  assert.equal(envelope.producer.harness, 'codex');
  assert.ok(envelope.created_at);
});
