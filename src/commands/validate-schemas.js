// owner: RStack developed by Richardson Gunde
//
// `rstack-agents validate --schemas` (#71): validate the RStack Spec v1alpha1
// schemas and conformance examples, plus (tolerantly) the newest real run of
// the target project. Three passes:
//
//   1. every spec/schemas/*.schema.json parses and compiles;
//   2. the packaged conformance example (examples/spec/business-flex-run/**)
//      validates against its matching schemas — this is also the registry
//      that proves no schema file is dead;
//   3. if the target project has .rstack/runs/, the NEWEST run's
//      manifest/tasks/approvals/builder/validator files are validated against
//      the raw-file schemas. Missing files are SKIP, never FAIL (a fresh or
//      partial run is not a spec violation); invalid files FAIL with the
//      exact field path.
//
// Validation uses typebox's Value module (already a dependency — the same
// package whose Type builders define the Pi tool schemas). Value.Check /
// Value.Errors accept plain JSON-Schema objects (type/required/properties/
// items/enum/const), which is exactly the draft-07 subset the spec schemas
// restrict themselves to. No new dependencies.

import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Value } from 'typebox/value';
import chalk from 'chalk';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(__dirname, '..', '..');

export const SCHEMAS_DIR = path.join(PACKAGE_ROOT, 'spec', 'schemas');
export const EXAMPLE_RUN_DIR = path.join(PACKAGE_ROOT, 'examples', 'spec', 'business-flex-run');

// Every schema the spec ships. The registry-coverage test pins that each of
// these is exercised by at least one example validation below — a schema
// nobody validates against is dead documentation and must not ship silently.
export const SPEC_SCHEMA_FILES = Object.freeze([
  'approval.schema.json',
  'builder-contract.schema.json',
  'evidence.schema.json',
  'rstack-adapter.schema.json',
  'rstack-agent-role.schema.json',
  'rstack-attestation.schema.json',
  'rstack-decision.schema.json',
  'rstack-gate.schema.json',
  'rstack-profile.schema.json',
  'rstack-project.schema.json',
  'rstack-run.schema.json',
  'rstack-task.schema.json',
  'validator-contract.schema.json',
]);

function errorsFor(schema, value) {
  const found = [];
  for (const error of Value.Errors(schema, value)) {
    found.push({ path: error.instancePath || '/', message: error.message });
    if (found.length >= 20) break; // enough to act on; never floods
  }
  return found;
}

function checkValue({ checks, schemaFile, target, schema, value, pathPrefix = '' }) {
  const errors = errorsFor(schema, value).map((error) => ({
    ...error,
    path: `${pathPrefix}${error.path === '/' && pathPrefix ? '' : error.path}` || '/',
  }));
  checks.push({
    name: `${target} matches ${schemaFile}`,
    schema: schemaFile,
    target,
    status: errors.length ? 'FAIL' : 'PASS',
    errors,
  });
}

function skip(checks, schemaFile, target, reason) {
  checks.push({ name: `${target} matches ${schemaFile}`, schema: schemaFile, target, status: 'SKIP', errors: [], reason });
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

// Sub-schemas live under `definitions` and are addressed directly (no $ref
// resolution required of any consumer — see spec/rstack-spec.md §1).
function definition(schemas, schemaFile, name) {
  const def = schemas.get(schemaFile)?.definitions?.[name];
  if (!def) throw new Error(`${schemaFile} has no definitions.${name} — the spec schema and this validator drifted`);
  return def;
}

async function loadSchemas(checks) {
  const schemas = new Map();
  const onDisk = (await readdir(SCHEMAS_DIR)).filter((name) => name.endsWith('.schema.json')).sort();
  for (const name of onDisk) {
    const target = `spec/schemas/${name}`;
    let parsed;
    try {
      parsed = await readJson(path.join(SCHEMAS_DIR, name));
    } catch (error) {
      checks.push({ name: `${target} parses`, schema: name, target, status: 'FAIL', errors: [{ path: '/', message: `malformed JSON: ${error.message}` }] });
      continue;
    }
    // Compile smoke: Value.Check must accept the schema without throwing.
    try {
      Value.Check(parsed, {});
      checks.push({ name: `${target} parses and compiles`, schema: name, target, status: 'PASS', errors: [] });
      schemas.set(name, parsed);
    } catch (error) {
      checks.push({ name: `${target} compiles`, schema: name, target, status: 'FAIL', errors: [{ path: '/', message: `schema does not compile: ${error.message}` }] });
    }
  }
  return { schemas, onDisk };
}

// One run directory (example or real) validated against the raw-file schemas.
// `strict: true` (the packaged example) fails on missing files — the example
// must stay complete; `strict: false` (a real run) SKIPs them.
async function validateRunDir(checks, schemas, runDir, { label, strict }) {
  const fileTargets = [
    { file: 'manifest.json', schemaFile: 'rstack-run.schema.json', schema: () => definition(schemas, 'rstack-run.schema.json', 'manifest') },
    { file: 'tasks.json', schemaFile: 'rstack-task.schema.json', schema: () => definition(schemas, 'rstack-task.schema.json', 'file') },
    { file: 'approvals.json', schemaFile: 'approval.schema.json', schema: () => schemas.get('approval.schema.json') },
    { file: 'decisions.json', schemaFile: 'rstack-decision.schema.json', schema: () => definition(schemas, 'rstack-decision.schema.json', 'file'), optional: true },
  ];

  for (const { file, schemaFile, schema, optional } of fileTargets) {
    const target = `${label}/${file}`;
    const filePath = path.join(runDir, file);
    if (!schemas.get(schemaFile)) { skip(checks, schemaFile, target, 'schema failed to load'); continue; }
    if (!existsSync(filePath)) {
      if (strict && !optional) checks.push({ name: `${target} exists`, schema: schemaFile, target, status: 'FAIL', errors: [{ path: '/', message: 'file missing from the conformance example' }] });
      else skip(checks, schemaFile, target, 'file not present');
      continue;
    }
    let value;
    try {
      value = await readJson(filePath);
    } catch (error) {
      checks.push({ name: `${target} parses`, schema: schemaFile, target, status: 'FAIL', errors: [{ path: '/', message: `malformed JSON: ${error.message}` }] });
      continue;
    }
    checkValue({ checks, schemaFile, target, schema: schema(), value });

    // Per-entry sub-schemas: each task / decision entry, with an exact path.
    if (file === 'tasks.json' && Array.isArray(value?.tasks)) {
      const taskSchema = definition(schemas, 'rstack-task.schema.json', 'task');
      value.tasks.forEach((task, index) => {
        checkValue({ checks, schemaFile: 'rstack-task.schema.json', target: `${target} tasks[${index}]`, schema: taskSchema, value: task, pathPrefix: `/tasks/${index}` });
      });
    }
    if (file === 'decisions.json' && Array.isArray(value?.decisions)) {
      const decisionSchema = definition(schemas, 'rstack-decision.schema.json', 'decision');
      value.decisions.forEach((decision, index) => {
        checkValue({ checks, schemaFile: 'rstack-decision.schema.json', target: `${target} decisions[${index}]`, schema: decisionSchema, value: decision, pathPrefix: `/decisions/${index}` });
      });
    }
  }

  // Per-task contracts.
  const tasksDir = path.join(runDir, 'tasks');
  const taskIds = existsSync(tasksDir)
    ? (await readdir(tasksDir, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
    : [];
  let contractsSeen = false;
  for (const taskId of taskIds) {
    for (const [file, schemaFile] of [['builder.json', 'builder-contract.schema.json'], ['validation.json', 'validator-contract.schema.json']]) {
      const target = `${label}/tasks/${taskId}/${file}`;
      const filePath = path.join(tasksDir, taskId, file);
      if (!schemas.get(schemaFile)) { skip(checks, schemaFile, target, 'schema failed to load'); continue; }
      if (!existsSync(filePath)) { skip(checks, schemaFile, target, 'contract not present'); continue; }
      contractsSeen = true;
      try {
        checkValue({ checks, schemaFile, target, schema: schemas.get(schemaFile), value: await readJson(filePath) });
      } catch (error) {
        checks.push({ name: `${target} parses`, schema: schemaFile, target, status: 'FAIL', errors: [{ path: '/', message: `malformed JSON: ${error.message}` }] });
      }
    }
  }
  if (strict && !contractsSeen) {
    checks.push({ name: `${label} has task contracts`, schema: 'builder-contract.schema.json', target: `${label}/tasks`, status: 'FAIL', errors: [{ path: '/', message: 'the conformance example must include at least one builder.json/validation.json pair' }] });
  }

  return { taskIds };
}

async function validateExample(checks, schemas) {
  if (!existsSync(EXAMPLE_RUN_DIR)) {
    checks.push({ name: 'conformance example present', schema: null, target: 'examples/spec/business-flex-run', status: 'FAIL', errors: [{ path: '/', message: 'examples/spec/business-flex-run/ is missing from the package' }] });
    return;
  }
  const label = 'examples/spec/business-flex-run';
  await validateRunDir(checks, schemas, EXAMPLE_RUN_DIR, { label, strict: true });

  // Evidence ledger: every line must be a valid evidence event.
  const evidenceSchema = schemas.get('evidence.schema.json');
  const evidencePath = path.join(EXAMPLE_RUN_DIR, 'evidence.jsonl');
  if (evidenceSchema && existsSync(evidencePath)) {
    const lines = (await readFile(evidencePath, 'utf8')).split('\n').filter(Boolean);
    lines.forEach((line, index) => {
      const target = `${label}/evidence.jsonl line ${index + 1}`;
      try {
        checkValue({ checks, schemaFile: 'evidence.schema.json', target, schema: evidenceSchema, value: JSON.parse(line) });
      } catch (error) {
        checks.push({ name: `${target} parses`, schema: 'evidence.schema.json', target, status: 'FAIL', errors: [{ path: '/', message: `malformed JSONL line: ${error.message}` }] });
      }
    });
  } else if (evidenceSchema) {
    checks.push({ name: `${label}/evidence.jsonl exists`, schema: 'evidence.schema.json', target: `${label}/evidence.jsonl`, status: 'FAIL', errors: [{ path: '/', message: 'file missing from the conformance example' }] });
  }

  // Attestation envelopes.
  const attestationSchema = schemas.get('rstack-attestation.schema.json');
  const attestationsDir = path.join(EXAMPLE_RUN_DIR, 'attestations');
  const envelopes = existsSync(attestationsDir)
    ? (await readdir(attestationsDir)).filter((name) => name.endsWith('.attestation.json')).sort()
    : [];
  if (attestationSchema) {
    if (!envelopes.length) {
      checks.push({ name: `${label}/attestations has an envelope`, schema: 'rstack-attestation.schema.json', target: `${label}/attestations`, status: 'FAIL', errors: [{ path: '/', message: 'the conformance example must include at least one attestation envelope' }] });
    }
    for (const name of envelopes) {
      const target = `${label}/attestations/${name}`;
      try {
        checkValue({ checks, schemaFile: 'rstack-attestation.schema.json', target, schema: attestationSchema, value: await readJson(path.join(attestationsDir, name)) });
      } catch (error) {
        checks.push({ name: `${target} parses`, schema: 'rstack-attestation.schema.json', target, status: 'FAIL', errors: [{ path: '/', message: `malformed JSON: ${error.message}` }] });
      }
    }
  }

  // Resource envelopes: one example per Kubernetes-style projection schema.
  const resourceTargets = [
    ['run.json', 'rstack-run.schema.json'],
    ['task.json', 'rstack-task.schema.json'],
    ['decision.json', 'rstack-decision.schema.json'],
    ['gate.json', 'rstack-gate.schema.json'],
    ['profile.json', 'rstack-profile.schema.json'],
    ['project.json', 'rstack-project.schema.json'],
    ['agent-role.json', 'rstack-agent-role.schema.json'],
    ['adapter.json', 'rstack-adapter.schema.json'],
  ];
  for (const [file, schemaFile] of resourceTargets) {
    const target = `${label}/resources/${file}`;
    const filePath = path.join(EXAMPLE_RUN_DIR, 'resources', file);
    const schema = schemas.get(schemaFile);
    if (!schema) { skip(checks, schemaFile, target, 'schema failed to load'); continue; }
    if (!existsSync(filePath)) {
      checks.push({ name: `${target} exists`, schema: schemaFile, target, status: 'FAIL', errors: [{ path: '/', message: 'resource example missing — every envelope schema must be exercised' }] });
      continue;
    }
    try {
      checkValue({ checks, schemaFile, target, schema, value: await readJson(filePath) });
    } catch (error) {
      checks.push({ name: `${target} parses`, schema: schemaFile, target, status: 'FAIL', errors: [{ path: '/', message: `malformed JSON: ${error.message}` }] });
    }
  }
}

async function validateNewestProjectRun(checks, schemas, projectRoot) {
  const stateDir = process.env.RSTACK_STATE_DIR || path.join(projectRoot, '.rstack');
  const runsDir = path.join(stateDir, 'runs');
  if (!existsSync(runsDir)) {
    skip(checks, null, `${path.join(path.basename(projectRoot), '.rstack', 'runs')}`, 'no .rstack/runs in the target project — nothing to validate');
    return;
  }
  const runIds = (await readdir(runsDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  if (!runIds.length) {
    skip(checks, null, 'project runs', 'runs directory is empty — nothing to validate');
    return;
  }
  const newest = runIds[runIds.length - 1];
  await validateRunDir(checks, schemas, path.join(runsDir, newest), { label: `run ${newest}`, strict: false });
}

export async function runValidateSchemas({ project = process.cwd() } = {}) {
  const checks = [];
  const { schemas } = await loadSchemas(checks);
  await validateExample(checks, schemas);
  await validateNewestProjectRun(checks, schemas, path.resolve(project));

  const summary = {
    pass: checks.filter((check) => check.status === 'PASS').length,
    fail: checks.filter((check) => check.status === 'FAIL').length,
    skip: checks.filter((check) => check.status === 'SKIP').length,
  };
  return { ok: summary.fail === 0, checks, summary };
}

export function formatValidateSchemas(report) {
  const lines = [chalk.bold('RStack Spec v1alpha1 — schema validation')];
  for (const check of report.checks) {
    if (check.status === 'PASS') {
      lines.push(`  ${chalk.green('PASS')} ${check.target}${check.schema ? chalk.dim(` (${check.schema})`) : ''}`);
    } else if (check.status === 'SKIP') {
      lines.push(`  ${chalk.yellow('SKIP')} ${check.target} — ${check.reason ?? 'not present'}`);
    } else {
      lines.push(`  ${chalk.red('FAIL')} ${check.target}${check.schema ? chalk.dim(` (${check.schema})`) : ''}`);
      for (const error of check.errors) {
        lines.push(`         ${chalk.red(error.path)}: ${error.message}`);
      }
    }
  }
  const { pass, fail, skip: skipped } = report.summary;
  lines.push('');
  lines.push(`${fail ? chalk.red(`${fail} FAIL`) : chalk.green('0 FAIL')} · ${pass} PASS · ${skipped} SKIP`);
  return lines.join('\n');
}
