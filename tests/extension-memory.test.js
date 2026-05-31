import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import extension from '../extensions/rstack-sdlc.ts';
import { projectSlug } from '../src/memory/index.js';

function createMockPi() {
  return {
    tools: {},
    commands: {},
    on: () => {},
    registerTool(tool) {
      this.tools[tool.name] = tool;
    },
    registerCommand(cmd, opts) {
      this.commands[cmd] = opts;
    },
  };
}

test('sdlc_validate writes validator-approved agent episode memory', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-mem-'));
  const memoryRoot = mkdtempSync(join(tmpdir(), 'rstack-mem-root-'));
  const previousProjectRoot = process.env.RSTACK_PROJECT_ROOT;
  const previousMemoryDir = process.env.RSTACK_MEMORY_DIR;
  process.env.RSTACK_PROJECT_ROOT = projectRoot;
  process.env.RSTACK_MEMORY_DIR = memoryRoot;

  try {
    const pi = createMockPi();
    extension(pi);
    const start = await pi.tools.sdlc_start.execute('start', { goal: 'Build memory smoke test', mode: 'express' });
    const runId = start.details.run_id;
    await pi.tools.sdlc_plan.execute('plan', { run_id: runId });
    await pi.tools.sdlc_build_next.execute('build', { run_id: runId });

    const builderPath = join(projectRoot, '.rstack', 'runs', runId, 'tasks', '001-product-clarification', 'builder.json');
    writeFileSync(builderPath, JSON.stringify({
      task_id: '001-product-clarification',
      agent: 'builder',
      status: 'PASS',
      summary: 'Created product brief and captured memory smoke test context.',
      files_modified: [],
      tests_run: ['manual smoke test'],
      risks: [],
      next_steps: ['validate memory write'],
      memory_summary: {
        work_done: 'Created product clarification context for memory smoke test.',
        decisions: ['Use express mode for smoke test.'],
        evidence: ['builder.json', 'manual smoke test'],
        context_to_keep: ['memory smoke test should write an episode after validation'],
        context_to_drop: ['temporary run id'],
        next_agent_hints: ['check episodes.jsonl'],
      },
      stage_summaries: [
        {
          stage_id: '00-environment',
          agent_id: 'agent.00-environment',
          work_done: 'Confirmed smoke-test environment setup.',
          evidence: ['manual smoke test'],
          context_to_keep: ['environment supports extension tests'],
          context_to_drop: [],
        },
        {
          stage_id: '01-transcript',
          agent_id: 'agent.01-transcript',
          work_done: 'Captured smoke-test task context.',
          evidence: ['builder.json'],
          context_to_keep: ['goal is Build memory smoke test'],
          context_to_drop: [],
        },
      ],
    }, null, 2));

    await pi.tools.sdlc_validate.execute('validate', { run_id: runId, task_id: '001-product-clarification' });

    const episodePath = join(memoryRoot, projectSlug(projectRoot), 'memory', 'episodes.jsonl');
    assert.ok(existsSync(episodePath), 'episodes.jsonl should be written under configured memory root');
    const episode = JSON.parse(readFileSync(episodePath, 'utf8').trim());
    assert.equal(episode.run_id, runId);
    assert.equal(episode.task_id, '001-product-clarification');
    assert.equal(episode.validator_status, 'PASS');
    assert.equal(episode.trusted, true);
    assert.ok(episode.agent_ids.includes('agent.00-environment'));
    assert.ok(episode.stage_ids.includes('00-environment'));
  } finally {
    if (previousProjectRoot === undefined) delete process.env.RSTACK_PROJECT_ROOT;
    else process.env.RSTACK_PROJECT_ROOT = previousProjectRoot;
    if (previousMemoryDir === undefined) delete process.env.RSTACK_MEMORY_DIR;
    else process.env.RSTACK_MEMORY_DIR = previousMemoryDir;
    rmSync(projectRoot, { recursive: true, force: true });
    rmSync(memoryRoot, { recursive: true, force: true });
  }
});

test('sdlc_validate fails PASS builders without memory summary evidence', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-mem-hard-'));
  const memoryRoot = mkdtempSync(join(tmpdir(), 'rstack-mem-hard-root-'));
  const previousProjectRoot = process.env.RSTACK_PROJECT_ROOT;
  const previousMemoryDir = process.env.RSTACK_MEMORY_DIR;
  process.env.RSTACK_PROJECT_ROOT = projectRoot;
  process.env.RSTACK_MEMORY_DIR = memoryRoot;

  try {
    const pi = createMockPi();
    extension(pi);
    const start = await pi.tools.sdlc_start.execute('start', { goal: 'Validate hardening smoke test', mode: 'express' });
    const runId = start.details.run_id;
    await pi.tools.sdlc_plan.execute('plan', { run_id: runId });
    await pi.tools.sdlc_build_next.execute('build', { run_id: runId });

    const taskDir = join(projectRoot, '.rstack', 'runs', runId, 'tasks', '001-product-clarification');
    writeFileSync(join(taskDir, 'builder.json'), JSON.stringify({
      task_id: '001-product-clarification',
      agent: 'builder',
      status: 'PASS',
      summary: 'This builder intentionally omits memory summary evidence.',
      files_modified: [],
      tests_run: ['manual smoke test'],
      risks: [],
      next_steps: [],
    }, null, 2));

    const result = await pi.tools.sdlc_validate.execute('validate', { run_id: runId, task_id: '001-product-clarification' });
    assert.ok(result.content[0].text.includes('Validation FAIL'));
    const validation = JSON.parse(readFileSync(join(taskDir, 'validation.json'), 'utf8'));
    assert.ok(validation.checks.some((check) => check.name === 'builder_memory_summary_exists' && check.status === 'FAIL'));
  } finally {
    if (previousProjectRoot === undefined) delete process.env.RSTACK_PROJECT_ROOT;
    else process.env.RSTACK_PROJECT_ROOT = previousProjectRoot;
    if (previousMemoryDir === undefined) delete process.env.RSTACK_MEMORY_DIR;
    else process.env.RSTACK_MEMORY_DIR = previousMemoryDir;
    rmSync(projectRoot, { recursive: true, force: true });
    rmSync(memoryRoot, { recursive: true, force: true });
  }
});
