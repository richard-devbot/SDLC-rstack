/**
 * #212 (#136 AC-2 remainder): context-pressure is classified at prompt-assembly
 * time (pre-execution), not only detect-only at validate. sdlc_build_next
 * assembles the builder prompt + injected memory; an oversized assembled prompt
 * must emit a context_pressure_warning stamped phase:"pre_execution" BEFORE the
 * builder runs, so the operator sees the bloat ahead of model spend.
 *
 * Advisory + non-blocking: the warning never fails assembly.
 *
 * owner: RStack developed by Richardson Gunde
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import extension from '../extensions/rstack-sdlc.ts';

function createMockPi() {
  return {
    tools: {}, commands: {}, on: () => {},
    registerTool(tool) { this.tools[tool.name] = tool; },
    registerCommand(cmd, opts) { this.commands[cmd] = opts; },
  };
}

function readEvents(runDir) {
  const path = join(runDir, 'events.jsonl');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function writePressureConfig(projectRoot, thresholds) {
  const dir = join(projectRoot, '.rstack');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'rstack.config.json'), JSON.stringify({ context_pressure: { thresholds } }));
}

test('context-pressure fires at prompt assembly when the builder prompt is oversized (#212)', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-ctxpress-assembly-'));
  process.env.RSTACK_PROJECT_ROOT = projectRoot;
  try {
    // A tiny builder_prompt_chars threshold — the assembled prompt (template +
    // embedded core instructions) always exceeds this, so assembly must warn.
    writePressureConfig(projectRoot, { builder_prompt_chars: 100 });

    const pi = createMockPi();
    extension(pi);
    const start = await pi.tools.sdlc_start.execute('start', { goal: 'Context pressure assembly check', mode: 'express' });
    const runId = start.details.run_id;
    const runDir = join(projectRoot, '.rstack', 'runs', runId);
    await pi.tools.sdlc_plan.execute('plan', { run_id: runId });
    await pi.tools.sdlc_build_next.execute('build', { run_id: runId });

    const pressure = readEvents(runDir).filter((e) => e.type === 'context_pressure_warning');
    const preExec = pressure.filter((e) => e.phase === 'pre_execution');
    assert.ok(preExec.length >= 1, 'assembly emitted a pre_execution context_pressure_warning');
    const promptWarn = preExec.find((e) => e.source === 'builder_prompt');
    assert.ok(promptWarn, 'the oversized assembled prompt is flagged (source builder_prompt)');
    assert.equal(promptWarn.blocking, false, 'advisory, never blocking');
    assert.ok(promptWarn.size > promptWarn.threshold, 'reports the measured size over the threshold');
  } finally {
    delete process.env.RSTACK_PROJECT_ROOT;
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('context-pressure stays quiet at assembly under a normal threshold (no false alarms)', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-ctxpress-quiet-'));
  process.env.RSTACK_PROJECT_ROOT = projectRoot;
  try {
    // Default-scale threshold: a normal express-run prompt must not trip it.
    writePressureConfig(projectRoot, { builder_prompt_chars: 120000 });

    const pi = createMockPi();
    extension(pi);
    const start = await pi.tools.sdlc_start.execute('start', { goal: 'Context pressure quiet check', mode: 'express' });
    const runId = start.details.run_id;
    const runDir = join(projectRoot, '.rstack', 'runs', runId);
    await pi.tools.sdlc_plan.execute('plan', { run_id: runId });
    await pi.tools.sdlc_build_next.execute('build', { run_id: runId });

    const preExec = readEvents(runDir).filter((e) => e.type === 'context_pressure_warning' && e.phase === 'pre_execution');
    assert.equal(preExec.length, 0, 'a normal assembled prompt raises no pre-execution warning');
  } finally {
    delete process.env.RSTACK_PROJECT_ROOT;
    rmSync(projectRoot, { recursive: true, force: true });
  }
});
