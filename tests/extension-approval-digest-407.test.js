/**
 * Approval content binding (#407): an APPROVED sign-off is bound to the
 * SHA-256 of the approved artifact's bytes. If the artifact is edited after
 * approval, the claim gate's digest re-check demotes the approval so the gate
 * re-blocks — "approved, then changed" can never stay green. Non-file-backed
 * artifacts (stage ids) carry no digest and are unaffected.
 *
 * owner: RStack developed by Richardson Gunde
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import extension from '../extensions/rstack-sdlc.ts';

function createMockPi() {
  return {
    tools: {},
    commands: {},
    on: () => {},
    registerTool(tool) { this.tools[tool.name] = tool; },
    registerCommand(name, command) { this.commands[name] = command; },
  };
}

test('sdlc_approve binds a SHA-256 digest and the claim gate re-blocks when the artifact changes', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-approval-digest-'));
  const previousProjectRoot = process.env.RSTACK_PROJECT_ROOT;
  const previousWebhook = process.env.RSTACK_SLACK_WEBHOOK;
  process.env.RSTACK_PROJECT_ROOT = projectRoot;
  delete process.env.RSTACK_SLACK_WEBHOOK;

  try {
    const pi = createMockPi();
    extension(pi);
    const start = await pi.tools.sdlc_start.execute('1', { goal: 'Approval digest binding regression' });
    const runId = start.details.run_id;
    const runDir = join(projectRoot, '.rstack', 'runs', runId);
    await pi.tools.sdlc_plan.execute('2', { run_id: runId });

    // Approve plan.md — the first task's default gate. The record must capture
    // the SHA-256 of the plan.md the manager actually saw.
    await pi.tools.sdlc_approve.execute('3', { run_id: runId, artifact: 'plan.md', status: 'APPROVED' });
    const approvals = JSON.parse(readFileSync(join(runDir, 'approvals.json'), 'utf8'));
    const planApproval = approvals.find((record) => record.artifact === 'plan.md');
    assert.ok(planApproval, 'plan.md approval recorded');
    assert.match(planApproval.artifact_sha256 ?? '', /^[a-f0-9]{64}$/, 'approval binds a sha-256 of the artifact');

    // With the approval intact, the first task claims cleanly (gate open).
    const claim1 = await pi.tools.sdlc_build_next.execute('4', { run_id: runId });
    assert.equal(claim1.details.task.id, '00-environment', 'gate opens with a valid approval');
    assert.equal(claim1.details.task.status, 'IN_PROGRESS');

    // Tamper: edit plan.md AFTER approval. The bound digest no longer matches.
    const planPath = join(runDir, 'plan.md');
    writeFileSync(planPath, readFileSync(planPath, 'utf8') + '\n\n## Injected after approval\nSmuggled scope.\n');

    // A fresh claim attempt (reset the task to PENDING to force re-evaluation)
    // must now re-block: the approval is demoted because its content changed.
    const tasksPath = join(runDir, 'tasks.json');
    const state = JSON.parse(readFileSync(tasksPath, 'utf8'));
    for (const task of state.tasks) { delete task._claim; task.status = 'PENDING'; }
    writeFileSync(tasksPath, JSON.stringify(state, null, 2));

    const claim2 = await pi.tools.sdlc_build_next.execute('5', { run_id: runId });
    assert.ok(
      claim2.content[0].text.includes('Approval gate blocked'),
      `edited artifact must re-block the gate, got: ${claim2.content[0].text.slice(0, 140)}`,
    );
    assert.deepEqual(claim2.details.missing_approvals, ['plan.md'], 'the changed artifact is the missing approval again');

    // Re-approving against the new content restores the gate.
    await pi.tools.sdlc_approve.execute('6', { run_id: runId, artifact: 'plan.md', status: 'APPROVED' });
    const claim3 = await pi.tools.sdlc_build_next.execute('7', { run_id: runId });
    assert.equal(claim3.details.task.status, 'IN_PROGRESS', 're-approval against new content reopens the gate');
  } finally {
    if (previousProjectRoot === undefined) delete process.env.RSTACK_PROJECT_ROOT;
    else process.env.RSTACK_PROJECT_ROOT = previousProjectRoot;
    if (previousWebhook !== undefined) process.env.RSTACK_SLACK_WEBHOOK = previousWebhook;
    rmSync(projectRoot, { recursive: true, force: true });
  }
});
