/**
 * Tests for the people layer (#40) and approval enforcement (#41):
 * identity on manifests/approvals/guidance, policy gates in express mode.
 *
 * owner: RStack developed by Richardson Gunde
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveUserIdentity } from '../src/core/harness/identity.js';
import extension from '../extensions/rstack-sdlc.ts';

const mockPi = {
  tools: {},
  commands: {},
  on: () => {},
  registerTool(tool) { this.tools[tool.name] = tool; },
  registerCommand(name, command) { this.commands[name] = command; },
};

test('resolveUserIdentity prefers env, falls back to git, never throws', () => {
  const env = { RSTACK_USER: 'Sirisha Rani', RSTACK_USER_EMAIL: 'sirisha@example.com' };
  assert.deepEqual(resolveUserIdentity(process.cwd(), env), { name: 'Sirisha Rani', email: 'sirisha@example.com' });

  const fromGit = resolveUserIdentity(process.cwd(), {});
  assert.ok(typeof fromGit.name === 'string' && fromGit.name.length > 0, 'git fallback yields a name');

  const nowhere = resolveUserIdentity('/nonexistent-dir-xyz', {});
  assert.equal(nowhere.name, 'unknown');
});

test('people layer + policy enforcement E2E', async (t) => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-people-'));
  const previousProjectRoot = process.env.RSTACK_PROJECT_ROOT;
  const previousUser = process.env.RSTACK_USER;
  process.env.RSTACK_PROJECT_ROOT = projectRoot;
  process.env.RSTACK_USER = 'Manager Maya';
  delete process.env.RSTACK_SLACK_WEBHOOK;

  extension(mockPi);

  await t.test('sdlc_start stamps started_by on the manifest and event', async () => {
    const result = await mockPi.tools.sdlc_start.execute('1', { goal: 'People layer test', mode: 'express' });
    const manifest = result.details;
    assert.equal(manifest.started_by.name, 'Manager Maya');

    const events = readFileSync(join(projectRoot, '.rstack', 'runs', manifest.run_id, 'events.jsonl'), 'utf8')
      .split('\n').filter(Boolean).map((line) => JSON.parse(line));
    const started = events.find((event) => event.type === 'run_started');
    assert.equal(started.started_by, 'Manager Maya');
  });

  const runId = (await mockPi.tools.sdlc_status.execute('2', {})).details.manifest.run_id;
  const runDir = join(projectRoot, '.rstack', 'runs', runId);

  await t.test('sdlc_clarify records who answered and what they said', async () => {
    await mockPi.tools.sdlc_clarify.execute('3', { run_id: runId, answers: ['Ship behind a feature flag', 'No PII in logs'] });
    const events = readFileSync(join(runDir, 'events.jsonl'), 'utf8')
      .split('\n').filter(Boolean).map((line) => JSON.parse(line));
    const guidance = events.find((event) => event.type === 'clarification_answers_added');
    assert.equal(guidance.answered_by, 'Manager Maya');
    assert.deepEqual(guidance.answers, ['Ship behind a feature flag', 'No PII in logs']);
  });

  await t.test('sdlc_approve defaults approver to resolved identity, not human-user', async () => {
    await mockPi.tools.sdlc_approve.execute('4', { run_id: runId, artifact: 'plan.md', status: 'APPROVED' });
    const approvals = JSON.parse(readFileSync(join(runDir, 'approvals.json'), 'utf8'));
    assert.equal(approvals[0].approver, 'Manager Maya');
  });

  await t.test('policy.json required_approvals are enforced even in express mode', async () => {
    await mockPi.tools.sdlc_plan.execute('5', { run_id: runId });
    // Express mode normally has zero gates. Policy demands release sign-off
    // on the first task — the gate must block.
    mkdirSync(join(projectRoot, '.rstack'), { recursive: true });
    writeFileSync(join(projectRoot, '.rstack', 'policy.json'), JSON.stringify({
      managers: ['Lead Lena'],
      // #404: the first task is now the canonical stage 00-environment.
      required_approvals: { '00-environment': ['release-readiness.json'] },
    }));

    const res = await mockPi.tools.sdlc_build_next.execute('6', { run_id: runId });
    assert.ok(res.content[0].text.includes('Approval gate blocked'), `expected block, got: ${res.content[0].text.slice(0, 120)}`);
    assert.deepEqual(res.details.missing_approvals, ['release-readiness.json']);

    const events = readFileSync(join(runDir, 'events.jsonl'), 'utf8')
      .split('\n').filter(Boolean).map((line) => JSON.parse(line));
    assert.ok(events.some((event) => event.type === 'approval_gate_blocked'), 'blocked event recorded');

    await assert.rejects(
      () => mockPi.tools.sdlc_approve.execute('7a', { run_id: runId, artifact: 'release-readiness.json', status: 'APPROVED', approver: 'Intern Ivy' }),
      /not allowed by manager policy/,
    );

    // Approve per policy → gate opens, task starts with real agent attribution.
    await mockPi.tools.sdlc_approve.execute('7', { run_id: runId, artifact: 'release-readiness.json', status: 'APPROVED', approver: 'Lead Lena' });
    const approvals = JSON.parse(readFileSync(join(runDir, 'approvals.json'), 'utf8'));
    assert.equal(approvals.at(-1).approver, 'Lead Lena');

    const res2 = await mockPi.tools.sdlc_build_next.execute('8', { run_id: runId });
    assert.ok(!res2.content[0].text.includes('Approval gate blocked'), 'gate opens after approval');
    const tasks = JSON.parse(readFileSync(join(runDir, 'tasks.json'), 'utf8')).tasks;
    const started = tasks.find((task) => task.status === 'IN_PROGRESS');
    assert.ok(started.agent, 'started task carries real agent attribution');
  });

  rmSync(projectRoot, { recursive: true, force: true });
  if (previousProjectRoot) process.env.RSTACK_PROJECT_ROOT = previousProjectRoot;
  else delete process.env.RSTACK_PROJECT_ROOT;
  if (previousUser) process.env.RSTACK_USER = previousUser;
  else delete process.env.RSTACK_USER;
});
