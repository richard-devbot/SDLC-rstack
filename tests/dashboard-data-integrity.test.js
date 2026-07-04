import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getRunsForRoot } from '../src/observability/dashboard/state/runs.js';
import { buildDiagnostics } from '../src/observability/dashboard/state/layers.js';

function seedProject() {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-integrity-'));
  const runDir = join(projectRoot, '.rstack', 'runs', 'run-damaged');
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, 'manifest.json'), JSON.stringify({ run_id: 'run-damaged', goal: 'Integrity check', status: 'IN_PROGRESS' }));
  // Deliberate damage: unparseable metrics + one malformed events line.
  writeFileSync(join(runDir, 'metrics.json'), '{ truncated');
  writeFileSync(join(runDir, 'events.jsonl'), `${JSON.stringify({ ts: '2026-07-04T00:00:00.000Z', type: 'run_started' })}\n{oops not json\n`);
  writeFileSync(join(runDir, 'tasks.json'), JSON.stringify({ tasks: [] }));
  return projectRoot;
}

test('corrupt run files are recorded per run and surfaced in diagnostics, never silent zeros', async () => {
  const projectRoot = seedProject();
  const runs = await getRunsForRoot(projectRoot);
  assert.equal(runs.length, 1);
  const run = runs[0];

  assert.equal(run.hasIntegrityErrors, true);
  const files = run.integrity.map((issue) => issue.file);
  assert.ok(files.some((file) => file.endsWith('metrics.json')), 'corrupt metrics.json must be recorded');
  assert.ok(files.some((file) => file.endsWith('events.jsonl')), 'malformed events line must be recorded');
  const eventsIssue = run.integrity.find((issue) => issue.file.endsWith('events.jsonl'));
  assert.match(eventsIssue.error, /1 malformed JSONL line/);
  // Valid lines still parse — damage is reported, not amplified.
  assert.equal(run.events.length, 1);

  const diagnostics = buildDiagnostics(runs, [projectRoot]);
  assert.equal(diagnostics.integrityErrorCount, 2);
  assert.ok(diagnostics.integrity.every((issue) => issue.runId === 'run-damaged'));
  assert.ok(diagnostics.integrity.every((issue) => issue.file && issue.error));
});

test('healthy runs carry no integrity errors and no badge flag', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-integrity-ok-'));
  const runDir = join(projectRoot, '.rstack', 'runs', 'run-ok');
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, 'manifest.json'), JSON.stringify({ run_id: 'run-ok', goal: 'Healthy run', status: 'DONE' }));
  writeFileSync(join(runDir, 'events.jsonl'), `${JSON.stringify({ ts: '2026-07-04T00:00:00.000Z', type: 'run_started' })}\n`);

  const runs = await getRunsForRoot(projectRoot);
  assert.equal(runs[0].hasIntegrityErrors, false);
  assert.deepEqual(runs[0].integrity, []);
  // Missing optional files (metrics.json, tasks.json) are NOT damage.
  assert.equal(buildDiagnostics(runs, [projectRoot]).integrityErrorCount, 0);
});
