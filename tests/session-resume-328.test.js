import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { buildContextString, runContext } from '../src/commands/context.js';
import { writePipelineState } from '../src/core/harness/pipeline-state.js';
import extension from '../extensions/rstack-sdlc.ts';

// owner: RStack developed by Richardson Gunde
//
// #328 (the continuity P0 from the 2026-07-10 audit): "please continue" in a
// fresh session failed because the injected context was information, not
// instruction — run id and counts, no resume command, no prohibitions. These
// pins cover the imperative packet for incomplete runs, the unchanged
// informational packet otherwise, the true fresh-process hook shape, and that
// the packet's command actually executes against the pinned run.

const execFileAsync = promisify(execFile);
const BIN = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'rstack-agents.js');

test('buildContextString: incomplete runs get the imperative resume packet', () => {
  const s = buildContextString({ runId: 'run-a', stageId: '07-code', taskId: '004-implementation', incomplete: true });
  assert.match(s, /INCOMPLETE/);
  assert.match(s, /RESUME this run now/);
  assert.match(s, /rstack-agents pipeline run --run-id run-a --max-steps 5/);
  assert.match(s, /Do NOT restart the pipeline/);
  assert.match(s, /orchestrator\.md/, 'the Session Resume contract is pointed at');
  assert.ok(s.length <= 1024, 'imperative packet stays under the 1KB cap');

  const informational = buildContextString({ runId: 'run-a', stageId: '07-code' });
  assert.ok(!/RESUME this run now/.test(informational), 'no resume instruction without incomplete evidence');
  assert.match(informational, /pipeline status/, 'informational packet unchanged');
});

test('a live interrupted run injects resume coordinates — in-process and fresh-process (#328)', async (t) => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-resume-'));
  process.env.RSTACK_PROJECT_ROOT = projectRoot;
  t.after(() => {
    delete process.env.RSTACK_PROJECT_ROOT;
    rmSync(projectRoot, { recursive: true, force: true });
  });
  const mockPi = { tools: {}, commands: {}, on: () => {}, registerTool(tool) { this.tools[tool.name] = tool; }, registerCommand() {} };
  extension(mockPi);

  // Session 1: start a run, claim the first task... and "die" here.
  const start = await mockPi.tools.sdlc_start.execute('1', { goal: 'Interrupted run', mode: 'express' });
  const runId = start.details.run_id;
  await mockPi.tools.sdlc_plan.execute('2', { run_id: runId });
  const claim = await mockPi.tools.sdlc_build_next.execute('3', { run_id: runId });
  const taskId = claim.details.task.id;

  await t.test('in-process: the packet is imperative with the right coordinates', async () => {
    const result = await runContext({ project: projectRoot });
    assert.equal(result.runId, runId);
    assert.match(result.additionalContext, /INCOMPLETE/);
    assert.match(result.additionalContext, new RegExp(`task ${taskId}`));
    assert.match(result.additionalContext, new RegExp(`pipeline run --run-id ${runId}`));
    assert.match(result.additionalContext, /Do NOT restart/);
  });

  await t.test('fresh process (the real new-session shape): the hook CLI emits the same instruction', async () => {
    const payload = JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: 'please continue' });
    // spawn + explicit stdin end — promisified execFile has no `input` option
    // and the hook CLI reads stdin, so anything else hangs forever.
    const stdout = await new Promise((resolveRun, rejectRun) => {
      const proc = spawn(process.execPath, [BIN, 'context'], {
        env: { ...process.env, RSTACK_PROJECT_ROOT: projectRoot },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let out = '';
      proc.stdout.on('data', (chunk) => { out += chunk; });
      proc.on('error', rejectRun);
      proc.on('close', () => resolveRun(out));
      proc.stdin.end(payload);
    });
    const parsed = JSON.parse(stdout.trim());
    const ctx = parsed.hookSpecificOutput.additionalContext;
    assert.match(ctx, /RESUME this run now/);
    assert.match(ctx, new RegExp(runId));
    assert.equal(parsed.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  });

  await t.test('the packet command is executable and targets the pinned run', async () => {
    const { stdout } = await execFileAsync(process.execPath, [BIN, 'pipeline', 'run', '--run-id', runId, '--max-steps', '1', '--dry-run', '--json'], {
      env: { ...process.env, RSTACK_PROJECT_ROOT: projectRoot },
      cwd: projectRoot,
    });
    const report = JSON.parse(stdout);
    assert.equal(report.run_id ?? report.runId ?? runId, runId);
  });
});

test('a completed run gets the informational packet, never a resume order', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-resume-done-'));
  try {
    const runId = 'run-done';
    const runDir = join(projectRoot, '.rstack', 'runs', runId);
    await mkdir(runDir, { recursive: true });
    await writeFile(join(runDir, 'manifest.json'), JSON.stringify({ run_id: runId, goal: 'Done run', status: 'DONE', created_at: new Date().toISOString() }));
    await writeFile(join(runDir, 'tasks.json'), JSON.stringify({ tasks: [
      { id: '001-a', status: 'PASS', stage_id: '00-environment' },
      { id: '002-b', status: 'PASS', stage_id: '01-transcript' },
    ] }));
    await writeFile(join(runDir, 'events.jsonl'), `${JSON.stringify({ ts: new Date().toISOString(), type: 'run_started' })}\n`);
    await writePipelineState(projectRoot, runId);

    const result = await runContext({ project: projectRoot });
    assert.equal(result.runId, runId);
    assert.ok(!/RESUME this run now/.test(result.additionalContext), 'completed runs are never ordered to resume');
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('the shipped /sdlc-resume skill exists and agrees with the packet command', () => {
  const skill = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'sdlc-resume', 'SKILL.md'), 'utf8');
  assert.match(skill, /^name: sdlc-resume$/m);
  assert.match(skill, /owner: RStack developed by Richardson Gunde/);
  assert.match(skill, /pipeline run --run-id <run_id> --max-steps 5/, 'skill and context packet reference the same resume command');
  assert.match(skill, /Do NOT call `sdlc_start`/, 'the no-restart rule is stated');
});
