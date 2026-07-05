import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import extension from '../extensions/rstack-sdlc.ts';

// Mock Pi Extension API — extended with handler capture so tests can invoke
// the tool_call hook directly.
const mockPi = {
  tools: {},
  commands: {},
  handlers: {},
  on(name, fn) {
    this.handlers[name] = fn;
  },
  registerTool(tool) {
    this.tools[tool.name] = tool;
  },
  registerCommand(cmd, opts) {
    this.commands[cmd] = opts;
  }
};

function readEvents(runDir) {
  const path = join(runDir, 'events.jsonl');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

test('Validator sandbox enforcement in the Pi tool_call hook', async (t) => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-validator-sandbox-'));
  process.env.RSTACK_PROJECT_ROOT = projectRoot;
  delete process.env.RSTACK_VALIDATOR_CONTEXT;
  delete process.env.RSTACK_VALIDATOR_RUN_ID;
  delete process.env.RSTACK_VALIDATOR_SANDBOX_DEBUG;
  delete process.env.RSTACK_ALLOW_DESTRUCTIVE;

  extension(mockPi);
  const toolCall = mockPi.handlers.tool_call;
  assert.equal(typeof toolCall, 'function', 'tool_call hook must be registered');

  const start = await mockPi.tools.sdlc_start.execute('1', { goal: 'Validator sandbox check' });
  const runDir = join(projectRoot, '.rstack', 'runs', start.details.run_id);

  await t.test('validator context: write tool is blocked and evented', async () => {
    process.env.RSTACK_VALIDATOR_CONTEXT = '1';
    const res = await toolCall({ toolName: 'write', input: { path: 'src/app.js', content: 'x' } });
    assert.equal(res.block, true);
    assert.match(res.reason, /validator sandbox/i);
    const denied = readEvents(runDir).filter((event) => event.type === 'validator_sandbox_denied');
    assert.equal(denied.length, 1);
    assert.equal(denied[0].tool, 'write');
    assert.match(denied[0].reason, /read-only/);
  });

  await t.test('validator context: destructive bash is blocked even with RSTACK_ALLOW_DESTRUCTIVE=1', async () => {
    process.env.RSTACK_VALIDATOR_CONTEXT = '1';
    process.env.RSTACK_ALLOW_DESTRUCTIVE = '1';
    const res = await toolCall({ toolName: 'bash', input: { command: 'rm -rf build/' } });
    assert.equal(res.block, true);
    assert.match(res.reason, /validator sandbox/i);
    delete process.env.RSTACK_ALLOW_DESTRUCTIVE;
    const denied = readEvents(runDir).filter((event) => event.type === 'validator_sandbox_denied');
    assert.equal(denied.length, 2);
    assert.equal(denied[1].tool, 'bash');
  });

  await t.test('validator context: read tools and safe bash pass through without flooding events', async () => {
    process.env.RSTACK_VALIDATOR_CONTEXT = '1';
    assert.equal(await toolCall({ toolName: 'read', input: { path: 'src/app.js' } }), undefined);
    assert.equal(await toolCall({ toolName: 'grep', input: { pattern: 'export' } }), undefined);
    assert.equal(await toolCall({ toolName: 'bash', input: { command: 'git status' } }), undefined);
    assert.equal(await toolCall({ toolName: 'bash', input: { command: 'npm test' } }), undefined);
    // Reads are NOT logged by default — only the opt-in debug flag logs them.
    assert.equal(readEvents(runDir).filter((event) => event.type === 'validator_sandbox_allowed_read').length, 0);
  });

  await t.test('validator context: debug flag opts in to allowed-read events', async () => {
    process.env.RSTACK_VALIDATOR_CONTEXT = '1';
    process.env.RSTACK_VALIDATOR_SANDBOX_DEBUG = '1';
    assert.equal(await toolCall({ toolName: 'read', input: { path: 'package.json' } }), undefined);
    delete process.env.RSTACK_VALIDATOR_SANDBOX_DEBUG;
    const allowed = readEvents(runDir).filter((event) => event.type === 'validator_sandbox_allowed_read');
    assert.equal(allowed.length, 1);
    assert.equal(allowed[0].tool, 'read');
  });

  await t.test('builder context (env unset): write tool is NOT blocked', async () => {
    delete process.env.RSTACK_VALIDATOR_CONTEXT;
    const before = readEvents(runDir).filter((event) => event.type === 'validator_sandbox_denied').length;
    assert.equal(await toolCall({ toolName: 'write', input: { path: 'src/app.js', content: 'x' } }), undefined);
    assert.equal(await toolCall({ toolName: 'edit', input: { path: 'src/app.js' } }), undefined);
    const after = readEvents(runDir).filter((event) => event.type === 'validator_sandbox_denied').length;
    assert.equal(after, before, 'builder writes must not produce sandbox events');
  });

  await t.test('regression: builder destructive-bash and protected-path gates still work', async () => {
    delete process.env.RSTACK_VALIDATOR_CONTEXT;
    const bash = await toolCall({ toolName: 'bash', input: { command: 'rm -rf build/' } });
    assert.equal(bash.block, true);
    assert.match(bash.reason, /destructive/i);
    assert.doesNotMatch(bash.reason, /validator sandbox/i);

    const secret = await toolCall({ toolName: 'write', input: { path: '.env', content: 'KEY=1' } });
    assert.equal(secret.block, true);
    assert.doesNotMatch(secret.reason, /validator sandbox/i);

    // Builder escape hatch still honored outside validator context.
    process.env.RSTACK_ALLOW_DESTRUCTIVE = '1';
    assert.equal(await toolCall({ toolName: 'bash', input: { command: 'rm -rf build/' } }), undefined);
    delete process.env.RSTACK_ALLOW_DESTRUCTIVE;
  });

  await t.test('sdlc_delegate: validator roles default to read-only tools and get the sandbox env; builders do not', async () => {
    // Fake Pi worker: emits one assistant message reporting the sandbox env
    // vars it inherited, ignoring all CLI args.
    const workerPath = join(projectRoot, 'fake-pi.sh');
    const reporterPath = join(projectRoot, 'fake-pi-report.mjs');
    writeFileSync(reporterPath, [
      'const text = JSON.stringify({',
      '  context: process.env.RSTACK_VALIDATOR_CONTEXT || "unset",',
      '  run_id: process.env.RSTACK_VALIDATOR_RUN_ID || "unset",',
      '});',
      'console.log(JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text }] } }));',
    ].join('\n'));
    writeFileSync(workerPath, `#!/bin/sh\nexec node ${JSON.stringify(reporterPath)}\n`);
    chmodSync(workerPath, 0o755);
    process.env.RSTACK_WORKER_COMMAND = workerPath;
    // Guard against stale inherited context leaking into builder children.
    process.env.RSTACK_VALIDATOR_CONTEXT = '1';
    process.env.RSTACK_VALIDATOR_RUN_ID = 'stale-run';

    const validatorRun = await mockPi.tools.sdlc_delegate.execute('d1', { agent: 'validator', task: 'Check the build' });
    const validatorResult = validatorRun.details.results[0];
    assert.deepEqual(validatorResult.tools, ['read', 'grep', 'find', 'ls', 'bash'], 'validator defaults to read-only tool set');
    assert.equal(validatorResult.validator_sandbox, true);
    const validatorEnv = JSON.parse(validatorResult.output);
    assert.equal(validatorEnv.context, '1', 'validator child gets RSTACK_VALIDATOR_CONTEXT=1');
    assert.equal(validatorEnv.run_id, start.details.run_id, 'validator child gets the owning run id');

    const builderRun = await mockPi.tools.sdlc_delegate.execute('d2', { agent: 'builder', task: 'Implement the thing' });
    const builderResult = builderRun.details.results[0];
    assert.ok(builderResult.tools.includes('write'), 'builder default tools include write');
    assert.equal(builderResult.validator_sandbox, false);
    const builderEnv = JSON.parse(builderResult.output);
    assert.equal(builderEnv.context, 'unset', 'builder child never inherits validator context');
    assert.equal(builderEnv.run_id, 'unset', 'builder child never inherits validator run id');

    // Explicit caller tools still win over the validator default.
    const explicitRun = await mockPi.tools.sdlc_delegate.execute('d3', { tasks: [{ agent: 'validator', task: 'Check again', tools: ['read', 'grep'] }] });
    assert.deepEqual(explicitRun.details.results[0].tools, ['read', 'grep']);

    delete process.env.RSTACK_WORKER_COMMAND;
    delete process.env.RSTACK_VALIDATOR_CONTEXT;
    delete process.env.RSTACK_VALIDATOR_RUN_ID;
  });

  delete process.env.RSTACK_VALIDATOR_CONTEXT;
  delete process.env.RSTACK_VALIDATOR_RUN_ID;
  delete process.env.RSTACK_VALIDATOR_SANDBOX_DEBUG;
  delete process.env.RSTACK_ALLOW_DESTRUCTIVE;
  rmSync(projectRoot, { recursive: true, force: true });
});
