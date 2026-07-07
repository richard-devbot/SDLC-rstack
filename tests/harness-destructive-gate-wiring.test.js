/**
 * #210: the live builder tool_call gate is converged onto the centralized
 * destructive-action classifier (#131) and the audited per-task approval path
 * (#133). These tests exercise the ACTUAL Pi hook (not the classifier in
 * isolation) so "built but not wired" can never regress: the running harness
 * must enforce the same definition the unit tests pin.
 *
 * owner: RStack developed by Richardson Gunde
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import extension from '../extensions/rstack-sdlc.ts';

const mockPi = {
  tools: {}, commands: {}, handlers: {},
  on(name, fn) { this.handlers[name] = fn; },
  registerTool(tool) { this.tools[tool.name] = tool; },
  registerCommand(cmd, opts) { this.commands[cmd] = opts; },
};

function readEvents(runDir) {
  const path = join(runDir, 'events.jsonl');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

test('Destructive-action gate wired into the tool_call hook (#210)', async (t) => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-destructive-gate-'));
  process.env.RSTACK_PROJECT_ROOT = projectRoot;
  delete process.env.RSTACK_VALIDATOR_CONTEXT;
  delete process.env.RSTACK_ALLOW_DESTRUCTIVE;

  extension(mockPi);
  const toolCall = mockPi.handlers.tool_call;
  const start = await mockPi.tools.sdlc_start.execute('1', { goal: 'Destructive gate check' });
  const runId = start.details.run_id;
  const runDir = join(projectRoot, '.rstack', 'runs', runId);
  const setTask = (id) => writeFileSync(join(runDir, 'tasks.json'), JSON.stringify({ tasks: [{ id, status: 'IN_PROGRESS', stage_artifacts: [{ stage_id: '07-code' }] }] }));
  const setApprovals = (records) => writeFileSync(join(runDir, 'approvals.json'), JSON.stringify(records));

  await t.test('blocks obfuscated/broader destructive shell forms the old inline regex missed', async () => {
    // git reset --hard, rm --recursive, prisma migrate reset, terraform destroy
    // — none matched the previous isDestructiveBash regex.
    for (const command of ['git reset --hard HEAD~5', 'rm --recursive /data', 'prisma migrate reset --force', 'terraform destroy -auto-approve']) {
      const res = await toolCall({ toolName: 'bash', input: { command } });
      assert.equal(res?.block, true, `should block: ${command}`);
      assert.match(res.reason, /destructive/i);
      assert.doesNotMatch(res.reason, /validator sandbox/i);
    }
  });

  await t.test('blocks writes to protected-config paths, not just secrets', async () => {
    for (const path of ['.github/workflows/ci.yml', 'Dockerfile', 'infra/main.tf']) {
      const res = await toolCall({ toolName: 'write', input: { path, content: 'x' } });
      assert.equal(res?.block, true, `should block write: ${path}`);
    }
  });

  await t.test('emits destructive_action_blocked with category + per-task approval artifact', async () => {
    setTask('007-code');
    await toolCall({ toolName: 'bash', input: { command: 'rm -rf dist/' } });
    const blocked = readEvents(runDir).filter((e) => e.type === 'destructive_action_blocked');
    assert.ok(blocked.length >= 1, 'block event recorded');
    const last = blocked[blocked.length - 1];
    assert.equal(last.category, 'broad-delete');
    assert.equal(last.task_id, '007-code');
    assert.equal(last.approval_artifact, 'destructive-action:007-code');
  });

  await t.test('an audited per-task approval unblocks exactly that task', async () => {
    setTask('007-code');
    setApprovals([{ id: 'app-1', artifact: 'destructive-action:007-code', status: 'APPROVED', approver: 'Richardson', timestamp: '2026-07-06T12:00:00.000Z', run_id: runId }]);
    assert.equal(await toolCall({ toolName: 'bash', input: { command: 'rm -rf dist/' } }), undefined, 'approved task proceeds');
  });

  await t.test('per-task scoping: one task\'s approval does NOT unblock another', async () => {
    // approvals still hold only destructive-action:007-code; current task is 008.
    setTask('008-testing');
    const res = await toolCall({ toolName: 'bash', input: { command: 'rm -rf dist/' } });
    assert.equal(res?.block, true, 'approval scoped to 007-code must not unblock 008-testing');
  });

  await t.test('backward-compat: a run-level destructive-action approval still unblocks', async () => {
    setApprovals([{ id: 'app-2', artifact: 'destructive-action', status: 'APPROVED', approver: 'Richardson', timestamp: '2026-07-06T12:00:00.000Z', run_id: runId }]);
    assert.equal(await toolCall({ toolName: 'bash', input: { command: 'rm -rf dist/' } }), undefined);
  });

  await t.test('non-destructive tool calls pass through untouched', async () => {
    assert.equal(await toolCall({ toolName: 'bash', input: { command: 'npm test' } }), undefined);
    assert.equal(await toolCall({ toolName: 'write', input: { path: 'src/app.js', content: 'x' } }), undefined);
  });

  await t.test('RSTACK_ALLOW_DESTRUCTIVE=1 still overrides for builder context', async () => {
    setApprovals([]);
    setTask('007-code');
    process.env.RSTACK_ALLOW_DESTRUCTIVE = '1';
    assert.equal(await toolCall({ toolName: 'bash', input: { command: 'rm -rf dist/' } }), undefined);
    delete process.env.RSTACK_ALLOW_DESTRUCTIVE;
  });

  delete process.env.RSTACK_PROJECT_ROOT;
  rmSync(projectRoot, { recursive: true, force: true });
});
