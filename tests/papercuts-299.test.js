import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import extension from '../extensions/rstack-sdlc.ts';

// owner: RStack developed by Richardson Gunde
//
// #299 papercuts — behavioural pins for the two user-facing items:
//   (7) sdlc_status excluded BLOCKED from its next-action finder, so a
//       guardrail-blocked run reported "No pending tasks" and never named the
//       guardrail-override that unblocks it.
//   (2) validate only existence-checked the first 20 files_modified, so a
//       nonexistent file at index >=20 passed silently.

const mockPi = {
  tools: {}, commands: {}, on: () => {},
  registerTool(tool) { this.tools[tool.name] = tool; },
  registerCommand(cmd, opts) { this.commands[cmd] = opts; },
};

function readJson(path) { return JSON.parse(readFileSync(path, 'utf8')); }

test('#299(7) sdlc_status surfaces a BLOCKED task and names its guardrail-override', async (t) => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-299-blocked-'));
  process.env.RSTACK_PROJECT_ROOT = projectRoot;
  t.after(() => { delete process.env.RSTACK_PROJECT_ROOT; rmSync(projectRoot, { recursive: true, force: true }); });

  extension(mockPi);
  const start = await mockPi.tools.sdlc_start.execute('1', { goal: 'BLOCKED visibility regression', mode: 'express' });
  const runId = start.details.run_id;
  const runDir = join(projectRoot, '.rstack', 'runs', runId);
  await mockPi.tools.sdlc_plan.execute('2', { run_id: runId });
  const firstTaskId = readJson(join(runDir, 'tasks.json')).tasks[0].id;

  // Exhaust the attempt budget (default maxTaskAttempts = 2): each build_next
  // claims the task, each validate FAILs (no builder.json) — after the budget
  // is spent the next claim stamps the task BLOCKED.
  for (let i = 0; i < 3; i++) {
    await mockPi.tools.sdlc_build_next.execute(`b${i}`, { run_id: runId });
    await mockPi.tools.sdlc_validate.execute(`v${i}`, { run_id: runId, task_id: firstTaskId }).catch(() => {});
  }
  const blocked = readJson(join(runDir, 'tasks.json')).tasks.find((task) => task.id === firstTaskId);
  assert.equal(blocked.status, 'BLOCKED', 'the task must be BLOCKED after the attempt budget is spent');

  const status = await mockPi.tools.sdlc_status.execute('s', { run_id: runId });
  assert.equal(status.details.next?.id, firstTaskId, 'sdlc_status must surface the BLOCKED task as next (not skip it)');
  assert.match(status.details.recommended, /BLOCKED/, 'recommendation names the blocked state');
  assert.match(status.details.recommended, new RegExp(`guardrail-override:${firstTaskId}`), 'recommendation names the override artifact that unblocks it');
});

test('#299(2) validate existence-checks files_modified beyond the first 20', async (t) => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-299-files-'));
  process.env.RSTACK_PROJECT_ROOT = projectRoot;
  t.after(() => { delete process.env.RSTACK_PROJECT_ROOT; rmSync(projectRoot, { recursive: true, force: true }); });

  extension(mockPi);
  const start = await mockPi.tools.sdlc_start.execute('1', { goal: 'files_modified cap regression', mode: 'express' });
  const runId = start.details.run_id;
  const runDir = join(projectRoot, '.rstack', 'runs', runId);
  await mockPi.tools.sdlc_plan.execute('2', { run_id: runId });
  const claim = await mockPi.tools.sdlc_build_next.execute('3', { run_id: runId });
  const task = claim.details.task;

  // 21 real files that exist + one nonexistent file at index 21 (beyond the
  // old 20-file cap). Pre-fix, the missing tail file was never checked.
  const files = [];
  for (let i = 0; i < 21; i++) {
    const rel = `src/gen/f${i}.txt`;
    mkdirSync(join(projectRoot, 'src', 'gen'), { recursive: true });
    writeFileSync(join(projectRoot, rel), 'x');
    files.push(rel);
  }
  files.push('src/gen/does-not-exist.txt'); // index 21, missing

  writeFileSync(join(projectRoot, task.output_dir, 'builder.json'), JSON.stringify({
    task_id: task.id, agent: 'builder', status: 'PASS',
    summary: 'Generated files for the cap regression test.',
    files_modified: files, tests_run: ['SKIPPED: regression fixture'],
    risks: [], next_steps: [],
    memory_summary: { work_done: 'Wrote 21 real files plus one missing entry.', evidence: ['src/gen/f0.txt'] },
    stage_summaries: (task.stage_artifacts ?? []).map((a) => ({ stage_id: a.stage_id, agent_id: 'builder', work_done: 'covered', evidence: ['src/gen/f0.txt'] })),
  }));

  const validation = await mockPi.tools.sdlc_validate.execute('v', { run_id: runId, task_id: task.id });
  const checks = validation.details.checks;
  const overflow = checks.find((c) => c.name === 'modified_file_exists_overflow');
  assert.ok(overflow, 'a missing file beyond index 20 must be reported (overflow check present)');
  assert.equal(overflow.status, 'FAIL');
  assert.equal(validation.details.status, 'FAIL', 'the run must FAIL when a claimed file past the cap is missing');
});
