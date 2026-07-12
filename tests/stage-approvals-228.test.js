/**
 * Blanket per-stage human gates (#228): required_stage_approvals (stage-id
 * keyed, no task ids needed) + approvals.every_stage (stage-approval:<stage>
 * sign-off before any task entering the stage), enforced at the claim gate
 * through the audited approval path — in EVERY mode, express included.
 *
 * owner: RStack developed by Richardson Gunde
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { requiredStageApprovalArtifacts, stageApprovalArtifact, STAGE_APPROVAL_PREFIX } from '../src/core/harness/stage-approvals.js';
import { validatePolicyConfig } from '../src/core/harness/config-validation.js';
import { taskStageIds } from '../src/core/harness/pipeline-state.js';
import extension from '../extensions/rstack-sdlc.ts';

test('requiredStageApprovalArtifacts — pure gate derivation', async (t) => {
  await t.test('every_stage requires one sign-off artifact per canonical stage, deduped', () => {
    const artifacts = requiredStageApprovalArtifacts(
      { approvals: { every_stage: true } },
      ['07-code', '08-testing', '07-code', 'not-a-stage'],
      { taskId: '004-implementation' },
    );
    assert.deepEqual(artifacts.sort(), ['stage-approval:07-code', 'stage-approval:08-testing']);
  });

  await t.test('every_stage fails CLOSED on a task with no canonical stage — gates on the task id', () => {
    const artifacts = requiredStageApprovalArtifacts(
      { approvals: { every_stage: true } },
      ['not-a-stage'],
      { taskId: '001-product-clarification' },
    );
    assert.deepEqual(artifacts, ['stage-approval:001-product-clarification']);
  });

  await t.test('every_stage only honors the literal true', () => {
    for (const value of ['true', 1, 'yes', {}, null]) {
      assert.deepEqual(
        requiredStageApprovalArtifacts({ approvals: { every_stage: value } }, ['07-code'], { taskId: 'x' }),
        [],
        `every_stage=${JSON.stringify(value)} must not enable the gate`,
      );
    }
  });

  await t.test('required_stage_approvals gates only the stages the task actually enters', () => {
    const policy = { required_stage_approvals: { '07-code': ['architecture.md', 'threat-model.md'], '09-deployment': ['release-readiness.json'] } };
    assert.deepEqual(
      requiredStageApprovalArtifacts(policy, ['07-code'], { taskId: 't' }).sort(),
      ['architecture.md', 'threat-model.md'],
    );
    assert.deepEqual(requiredStageApprovalArtifacts(policy, ['08-testing'], { taskId: 't' }), []);
  });

  await t.test('malformed policy shapes never throw and never gate', () => {
    assert.deepEqual(requiredStageApprovalArtifacts(null, ['07-code'], { taskId: 't' }), []);
    assert.deepEqual(requiredStageApprovalArtifacts({ required_stage_approvals: ['07-code'] }, ['07-code'], { taskId: 't' }), []);
    assert.deepEqual(requiredStageApprovalArtifacts({ required_stage_approvals: { '07-code': 'architecture.md' } }, ['07-code'], { taskId: 't' }), []);
    assert.deepEqual(requiredStageApprovalArtifacts({ required_stage_approvals: { '07-code': ['', '   ', 42] } }, ['07-code'], { taskId: 't' }), []);
  });

  await t.test('both surfaces combine and dedupe', () => {
    const artifacts = requiredStageApprovalArtifacts(
      { approvals: { every_stage: true }, required_stage_approvals: { '07-code': ['architecture.md', stageApprovalArtifact('07-code')] } },
      ['07-code'],
      { taskId: 't' },
    );
    assert.deepEqual(artifacts.sort(), ['architecture.md', 'stage-approval:07-code']);
  });
});

test('validatePolicyConfig — #228 fields', () => {
  assert.deepEqual(validatePolicyConfig({ required_stage_approvals: { '07-code': ['architecture.md'] }, approvals: { every_stage: true } }), []);

  const badShape = validatePolicyConfig({ required_stage_approvals: ['07-code'] });
  assert.ok(badShape.some((issue) => issue.field === 'required_stage_approvals'), 'non-object shape flagged');

  const unknownStage = validatePolicyConfig({ required_stage_approvals: { 'code-stage': ['architecture.md'] } });
  assert.ok(unknownStage.some((issue) => issue.field === 'required_stage_approvals.code-stage' && issue.problem.includes('NEVER fire')), 'unknown stage id warns that the gate never fires');

  const badArtifacts = validatePolicyConfig({ required_stage_approvals: { '07-code': ['architecture.md', ''] } });
  assert.ok(badArtifacts.some((issue) => issue.field === 'required_stage_approvals.07-code'), 'blank artifact names flagged');

  const badApprovals = validatePolicyConfig({ approvals: 'every_stage' });
  assert.ok(badApprovals.some((issue) => issue.field === 'approvals'), 'non-object approvals flagged');

  const badFlag = validatePolicyConfig({ approvals: { every_stage: 'true' } });
  assert.ok(badFlag.some((issue) => issue.field === 'approvals.every_stage'), 'stringly-typed flag flagged');
});

const mockPi = {
  tools: {},
  commands: {},
  on: () => {},
  registerTool(tool) { this.tools[tool.name] = tool; },
  registerCommand(name, command) { this.commands[name] = command; },
};

test('claim gate enforces stage-keyed policy end-to-end (express mode)', async (t) => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-228-'));
  const previousProjectRoot = process.env.RSTACK_PROJECT_ROOT;
  process.env.RSTACK_PROJECT_ROOT = projectRoot;
  delete process.env.RSTACK_SLACK_WEBHOOK;

  extension(mockPi);

  const approveAll = async (runId, artifacts) => {
    for (const artifact of artifacts) {
      await mockPi.tools.sdlc_approve.execute('a', { run_id: runId, artifact, status: 'APPROVED' });
    }
  };

  await t.test('approvals.every_stage blocks every claim until the stage sign-off lands', async () => {
    const runId = (await mockPi.tools.sdlc_start.execute('1', { goal: 'Blanket gate test', mode: 'express' })).details.run_id;
    await mockPi.tools.sdlc_plan.execute('2', { run_id: runId });
    const runDir = join(projectRoot, '.rstack', 'runs', runId);

    mkdirSync(join(projectRoot, '.rstack'), { recursive: true });
    writeFileSync(join(projectRoot, '.rstack', 'policy.json'), JSON.stringify({ approvals: { every_stage: true } }));

    // Express mode has zero default gates — the block below is purely #228.
    const blocked = await mockPi.tools.sdlc_build_next.execute('3', { run_id: runId });
    assert.ok(blocked.content[0].text.includes('Approval gate blocked'), `expected block, got: ${blocked.content[0].text.slice(0, 120)}`);
    assert.ok(blocked.details.missing_approvals.length > 0, 'missing approvals listed');
    assert.ok(
      blocked.details.missing_approvals.every((artifact) => artifact.startsWith(STAGE_APPROVAL_PREFIX)),
      `every missing artifact is a stage sign-off: ${blocked.details.missing_approvals.join(', ')}`,
    );

    // The queue card + event fire through the existing audited path.
    const events = readFileSync(join(runDir, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
    assert.ok(events.some((event) => event.type === 'approval_gate_blocked'), 'approval_gate_blocked recorded');

    // Task stays unclaimed until a human signs off the stage(s).
    let tasks = JSON.parse(readFileSync(join(runDir, 'tasks.json'), 'utf8')).tasks;
    assert.ok(!tasks.some((task) => task.status === 'IN_PROGRESS'), 'no task claimed while blocked');

    await approveAll(runId, blocked.details.missing_approvals);
    const opened = await mockPi.tools.sdlc_build_next.execute('4', { run_id: runId });
    assert.ok(!opened.content[0].text.includes('Approval gate blocked'), 'gate opens after stage sign-off');
    tasks = JSON.parse(readFileSync(join(runDir, 'tasks.json'), 'utf8')).tasks;
    const started = tasks.find((task) => task.status === 'IN_PROGRESS');
    assert.ok(started, 'task claimed after approval');
    // The gate keyed off the task's canonical stages — the approved artifacts
    // must be exactly the sign-offs for the stages this task enters.
    const expected = taskStageIds(started).map((stageId) => stageApprovalArtifact(stageId)).sort();
    if (expected.length) assert.deepEqual([...blocked.details.missing_approvals].sort(), expected);
  });

  await t.test('required_stage_approvals gates a stage without knowing task ids, even in express', async () => {
    const runId = (await mockPi.tools.sdlc_start.execute('5', { goal: 'Stage-keyed gate test', mode: 'express' })).details.run_id;
    await mockPi.tools.sdlc_plan.execute('6', { run_id: runId });
    const runDir = join(projectRoot, '.rstack', 'runs', runId);

    const tasks = JSON.parse(readFileSync(join(runDir, 'tasks.json'), 'utf8')).tasks;
    const firstStage = taskStageIds(tasks[0])[0];
    assert.ok(firstStage, 'first plan task maps to a canonical stage');
    writeFileSync(join(projectRoot, '.rstack', 'policy.json'), JSON.stringify({
      required_stage_approvals: { [firstStage]: ['custom-signoff.md'] },
    }));

    const blocked = await mockPi.tools.sdlc_build_next.execute('7', { run_id: runId });
    assert.ok(blocked.content[0].text.includes('Approval gate blocked'), `expected block, got: ${blocked.content[0].text.slice(0, 120)}`);
    assert.deepEqual(blocked.details.missing_approvals, ['custom-signoff.md']);

    await approveAll(runId, ['custom-signoff.md']);
    const opened = await mockPi.tools.sdlc_build_next.execute('8', { run_id: runId });
    assert.ok(!opened.content[0].text.includes('Approval gate blocked'), 'gate opens after the stage-keyed artifact is approved');
  });

  await t.test('sdlc_status names the stage-keyed gate in next_missing_approvals', async () => {
    const runId = (await mockPi.tools.sdlc_start.execute('9', { goal: 'Status surfaces gate', mode: 'express' })).details.run_id;
    await mockPi.tools.sdlc_plan.execute('10', { run_id: runId });
    writeFileSync(join(projectRoot, '.rstack', 'policy.json'), JSON.stringify({ approvals: { every_stage: true } }));

    const status = await mockPi.tools.sdlc_status.execute('11', { run_id: runId });
    assert.ok(status.details.next_missing_approvals.length > 0, 'status lists the pending stage sign-offs');
    assert.ok(status.details.next_missing_approvals.every((artifact) => artifact.startsWith(STAGE_APPROVAL_PREFIX)));
    assert.ok(status.details.recommended.startsWith('Approve '), 'recommended action is the approval');
  });

  rmSync(projectRoot, { recursive: true, force: true });
  if (previousProjectRoot) process.env.RSTACK_PROJECT_ROOT = previousProjectRoot;
  else delete process.env.RSTACK_PROJECT_ROOT;
});
