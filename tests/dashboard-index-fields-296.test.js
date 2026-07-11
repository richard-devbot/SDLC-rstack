import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildFullState } from '../src/observability/dashboard/state/index.js';

// owner: RStack developed by Richardson Gunde
//
// #296 (generalizes #264): entryFromRun never captured evidence, artifactIndex,
// timeline, activityTimeline, or requirements, and liteRunFromEntry hardcoded
// all five to []. So every index-served (completed) run rehydrated them empty,
// and Business Hub aggregates (evidence counts, artifact index, run timeline,
// requirement coverage, the drawer's activity timeline) silently undercounted
// every completed run. This pins that index-served runs keep all five.

async function writeJson(filePath, value) {
  await writeFile(filePath, JSON.stringify(value, null, 2));
}

function isoDaysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

// A COMPLETED run (so cycle 2 serves it from the index) carrying real evidence,
// artifacts, requirements, and an event stream that derives a timeline.
async function writeRichCompletedRun(projectRoot, runId) {
  const runDir = join(projectRoot, '.rstack', 'runs', runId);
  const stagesDir = join(runDir, 'artifacts', 'stages');
  await mkdir(join(stagesDir, '02-requirements'), { recursive: true });
  await mkdir(join(stagesDir, '07-code'), { recursive: true });

  await writeJson(join(runDir, 'manifest.json'), {
    run_id: runId, goal: `Goal for ${runId}`,
    created_at: isoDaysAgo(9), completed_at: isoDaysAgo(8), framework: 'pi',
  });
  await writeJson(join(runDir, 'tasks.json'), {
    tasks: [
      { id: '02-requirements', title: 'Requirements', status: 'PASS' },
      { id: '07-code', title: 'Code', status: 'PASS' },
    ],
  });
  await writeFile(join(runDir, 'events.jsonl'), [
    { ts: isoDaysAgo(9), type: 'task_started', task_id: '02-requirements' },
    { ts: isoDaysAgo(9), type: 'task_validated', task_id: '02-requirements', status: 'PASS' },
    { ts: isoDaysAgo(8), type: 'task_started', task_id: '07-code' },
    { ts: isoDaysAgo(8), type: 'task_validated', task_id: '07-code', status: 'PASS' },
  ].map((e) => JSON.stringify(e)).join('\n') + '\n');
  // Evidence ledger — feeds run.evidence (→ evidenceCount / evidenceRecent).
  await writeFile(join(runDir, 'evidence.jsonl'), [
    { ts: isoDaysAgo(9), task_id: '02-requirements', kind: 'validation', status: 'PASS', evidence: 'requirements.json' },
    { ts: isoDaysAgo(8), task_id: '07-code', kind: 'validation', status: 'PASS', evidence: 'code_report.json' },
  ].map((e) => JSON.stringify(e)).join('\n') + '\n');
  // Requirements artifact — feeds run.requirements.
  await writeJson(join(stagesDir, '02-requirements', 'requirements.json'), [
    { id: 'R1', area: 'auth', priority: 'must', description: 'Users can log in' },
    { id: 'R2', area: 'api', priority: 'should', description: 'Health endpoint responds 200' },
  ]);
  // A stage artifact — feeds run.artifactIndex (indexArtifacts scans artifacts/).
  await writeJson(join(stagesDir, '07-code', 'code_report.json'), { status: 'PASS', files: ['src/app.js'] });
  return runDir;
}

test('#296 index-served runs keep evidence, timeline, requirements, and artifactIndex', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-index-fields-296-'));
  try {
    const runId = '2026-07-02T10-00-00-rich';
    await writeRichCompletedRun(projectRoot, runId);

    // Cycle 1 fully parses and indexes; cycle 2 serves the completed run from
    // the index (the exact path that dropped these fields before the fix).
    await buildFullState(projectRoot, { includeRegistry: false });
    const second = await buildFullState(projectRoot, { includeRegistry: false });
    const run = second.runs.find((candidate) => candidate.runId === runId);

    assert.ok(run, 'run must be present in the state');
    assert.ok(run.fromIndex, 'completed run must be served from the index on cycle 2');

    assert.ok(run.evidence.length >= 2, 'index-served run keeps its evidence records (was [] before #296)');
    assert.equal(run.evidence[0].kind, 'validation');
    assert.ok(run.timeline.length > 0, 'index-served run keeps its derived timeline (was [] before #296)');
    assert.ok(run.requirements.length >= 2, 'index-served run keeps its requirements (was [] before #296)');
    assert.equal(run.requirements[0].id, 'R1');
    assert.ok(run.artifactIndex.length > 0, 'index-served run keeps its artifact index (was [] before #296)');
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('#296 an in-place evidence.jsonl append invalidates a stalled run entry', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-index-evi-inval-'));
  try {
    // A non-completed, inactive (stalled) run: served from the index on cycle 2.
    const runId = '2026-07-02T10-00-00-stalled';
    const runDir = join(projectRoot, '.rstack', 'runs', runId);
    await mkdir(runDir, { recursive: true });
    await writeJson(join(runDir, 'manifest.json'), {
      run_id: runId, goal: 'Bridge-driven run', created_at: isoDaysAgo(1), framework: 'claude-code',
    });
    await writeJson(join(runDir, 'tasks.json'), { tasks: [{ id: '001-clarify', title: 'Clarify', status: 'IN_PROGRESS' }] });
    await writeFile(join(runDir, 'events.jsonl'), `${JSON.stringify({ ts: isoDaysAgo(1), type: 'task_started', task_id: '001-clarify' })}\n`);
    await writeFile(join(runDir, 'evidence.jsonl'), `${JSON.stringify({ ts: isoDaysAgo(1), task_id: '001-clarify', kind: 'validation', status: 'INFO', evidence: 'first' })}\n`);

    await buildFullState(projectRoot, { includeRegistry: false });
    const second = await buildFullState(projectRoot, { includeRegistry: false });
    assert.ok(second.runs[0].fromIndex, 'stalled unchanged run is index-served');
    assert.equal(second.runs[0].evidence.length, 1);

    // Append evidence in place — events/tasks/manifest untouched. The signature
    // (which now includes evidence.jsonl, #296) must notice and re-parse.
    await writeFile(join(runDir, 'evidence.jsonl'),
      `${JSON.stringify({ ts: isoDaysAgo(1), task_id: '001-clarify', kind: 'validation', status: 'INFO', evidence: 'first' })}\n` +
      `${JSON.stringify({ ts: new Date().toISOString(), task_id: '001-clarify', kind: 'validation', status: 'PASS', evidence: 'second' })}\n`);
    const third = await buildFullState(projectRoot, { includeRegistry: false });
    const run = third.runs.find((candidate) => candidate.runId === runId);
    assert.equal(run.evidence.length, 2, 'an in-place evidence append must invalidate the cached entry');
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});
