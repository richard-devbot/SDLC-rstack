import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  evaluateGoal,
  mapAgentToStage,
  normalizeGoalDefinition,
  normalizeGoalVerdicts,
  readGoalEvidence,
  summarizeGoalDecision,
  GOAL_STATUSES,
} from '../src/core/harness/goal-check.js';

function seedRun(projectRoot, runId, {
  tasks = [], approvals = [], decisions = null, events = [],
  feedback = null, goal = null, verdict = null, metrics = null,
} = {}) {
  const runDir = path.join(projectRoot, '.rstack', 'runs', runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(path.join(runDir, 'manifest.json'), JSON.stringify({ run_id: runId, goal: 'Goal fixture', status: 'IN_PROGRESS' }));
  writeFileSync(path.join(runDir, 'tasks.json'), JSON.stringify({ tasks }));
  writeFileSync(path.join(runDir, 'approvals.json'), JSON.stringify(approvals));
  writeFileSync(path.join(runDir, 'events.jsonl'), events.map((event) => JSON.stringify(event)).join('\n') + (events.length ? '\n' : ''));
  if (decisions) writeFileSync(path.join(runDir, 'decisions.json'), JSON.stringify(decisions));
  if (metrics) writeFileSync(path.join(runDir, 'metrics.json'), JSON.stringify(metrics));
  if (goal) writeFileSync(path.join(runDir, 'goal.json'), JSON.stringify(goal));
  if (verdict) writeFileSync(path.join(runDir, 'goal-verdict.json'), JSON.stringify(verdict));
  if (feedback) {
    const stageDir = path.join(runDir, 'artifacts', 'stages', '11-feedback-loop');
    mkdirSync(stageDir, { recursive: true });
    writeFileSync(path.join(stageDir, 'feedback.json'), JSON.stringify(feedback));
  }
  return runDir;
}

const task = (id, status, stageId = '07-code') => ({ id, title: id, status, stage_artifacts: [{ stage_id: stageId }] });

const cleanFeedback = {
  summary: { total_issues: 0, critical_count: 0, warning_count: 0, overall_consistency_score: 98, pipeline_health: 'HEALTHY' },
  issues: [],
};

test('all tasks passed, no human gates, clean feedback -> PASS', async () => {
  const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'rstack-goal-'));
  seedRun(projectRoot, 'run-a', { tasks: [task('001', 'PASS'), task('002', 'PASS')], feedback: cleanFeedback });

  const evaluation = await evaluateGoal(projectRoot, 'run-a');
  assert.equal(evaluation.status, 'PASS');
  assert.equal(evaluation.score, 100);
  assert.equal(evaluation.critical_count, 0);
  assert.deepEqual(evaluation.failing_stages, []);
  assert.equal(evaluation.schema_version, 1);
  assert.ok(GOAL_STATUSES.includes(evaluation.status));
});

test('evaluator persists nothing — no rollup file, no dashboard required', async () => {
  const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'rstack-goal-'));
  const runDir = seedRun(projectRoot, 'run-a', { tasks: [task('001', 'PASS')] });
  await evaluateGoal(projectRoot, 'run-a');
  assert.ok(!existsSync(path.join(runDir, 'pipeline-state.json')), 'evaluation must not persist the rollup');
});

test('pending approval -> ASK_USER', async () => {
  const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'rstack-goal-'));
  seedRun(projectRoot, 'run-a', {
    tasks: [task('001', 'PASS')],
    approvals: [{ artifact: 'plan.md', status: 'PENDING' }],
  });
  const evaluation = await evaluateGoal(projectRoot, 'run-a');
  assert.equal(evaluation.status, 'ASK_USER');
  assert.match(evaluation.reason, /plan\.md/);
});

test('pending decision or NEEDS_CONTEXT task -> ASK_USER', async () => {
  const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'rstack-goal-'));
  seedRun(projectRoot, 'run-a', {
    tasks: [task('001', 'PASS')],
    decisions: { decisions: [{ decision_id: 'DEC-001', question: 'Which DB?', status: 'pending' }] },
  });
  const evaluation = await evaluateGoal(projectRoot, 'run-a');
  assert.equal(evaluation.status, 'ASK_USER');
  assert.match(evaluation.reason, /DEC-001/);

  const projectRoot2 = mkdtempSync(path.join(os.tmpdir(), 'rstack-goal-'));
  seedRun(projectRoot2, 'run-a', { tasks: [task('001', 'NEEDS_CONTEXT')] });
  const evaluation2 = await evaluateGoal(projectRoot2, 'run-a');
  assert.equal(evaluation2.status, 'ASK_USER');
  assert.match(evaluation2.reason, /human context/);
});

test('critical feedback issue with an agent_to_rerun remediation -> RETRY with mapped stage', async () => {
  const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'rstack-goal-'));
  seedRun(projectRoot, 'run-a', {
    tasks: [task('001', 'PASS', '06-architecture')],
    feedback: {
      summary: { critical_count: 1, pipeline_health: 'CRITICAL_GAPS' },
      issues: [{
        id: 'FBK-001', severity: 'CRITICAL', title: 'FR-003 has no endpoint',
        remediation: { action: 'redesign', agent_to_rerun: 'architecture_agent', can_auto_remediate: true },
      }],
    },
  });
  const evaluation = await evaluateGoal(projectRoot, 'run-a');
  assert.equal(evaluation.status, 'RETRY');
  assert.equal(evaluation.critical_count, 1);
  assert.ok(evaluation.recommended_rerun_stages.includes('06-architecture'));
});

test('critical feedback issue with no remediation path -> BLOCK', async () => {
  const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'rstack-goal-'));
  seedRun(projectRoot, 'run-a', {
    tasks: [task('001', 'PASS')],
    feedback: {
      summary: { critical_count: 1 },
      issues: [{ id: 'FBK-002', severity: 'CRITICAL', title: 'Security gap' }],
    },
  });
  const evaluation = await evaluateGoal(projectRoot, 'run-a');
  assert.equal(evaluation.status, 'BLOCK');
  assert.match(evaluation.reason, /FBK-002/);
});

test('guardrail-BLOCKED task -> BLOCK naming the override artifact', async () => {
  const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'rstack-goal-'));
  seedRun(projectRoot, 'run-a', { tasks: [task('001', 'BLOCKED')] });
  const evaluation = await evaluateGoal(projectRoot, 'run-a');
  assert.equal(evaluation.status, 'BLOCK');
  assert.match(evaluation.reason, /guardrail-override:001/);
});

test('failing stage tasks -> RETRY listing failing stages', async () => {
  const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'rstack-goal-'));
  seedRun(projectRoot, 'run-a', { tasks: [task('001', 'PASS', '06-architecture'), task('002', 'FAIL', '07-code')] });
  const evaluation = await evaluateGoal(projectRoot, 'run-a');
  assert.equal(evaluation.status, 'RETRY');
  assert.ok(evaluation.failing_stages.includes('07-code'));
  assert.ok(evaluation.recommended_rerun_stages.includes('07-code'));
});

test('missing agent-11 artifact for a feedback metric produces a clear non-pass that recommends stage 11', async () => {
  const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'rstack-goal-'));
  seedRun(projectRoot, 'run-a', {
    tasks: [task('001', 'PASS')],
    goal: {
      goal_id: 'quality-gate',
      criteria: [{ id: 'score', kind: 'metric_threshold', source: 'feedback', metric: 'summary.overall_consistency_score', operator: '>=', value: 90 }],
    },
  });
  const evaluation = await evaluateGoal(projectRoot, 'run-a');
  assert.notEqual(evaluation.status, 'PASS');
  assert.equal(evaluation.status, 'RETRY');
  assert.ok(evaluation.recommended_rerun_stages.includes('11-feedback-loop'));
  const criterion = evaluation.criteria.find((item) => item.id === 'score');
  assert.equal(criterion.status, 'PENDING');
  assert.match(criterion.detail, /feedback artifact missing/);
});

test('verifiable criteria: file_exists, command exit code, metric threshold', async () => {
  const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'rstack-goal-'));
  writeFileSync(path.join(projectRoot, 'present.md'), 'hello');
  seedRun(projectRoot, 'run-a', {
    tasks: [task('001', 'PASS')],
    feedback: cleanFeedback,
    goal: {
      goal_id: 'verifiable',
      criteria: [
        { id: 'doc', kind: 'file_exists', path: 'present.md' },
        { id: 'missing-doc', kind: 'file_exists', path: 'absent.md', rerun_stages: ['03-documentation'] },
        { id: 'tests', kind: 'command', command: 'exit 0' },
        { id: 'score', kind: 'metric_threshold', source: 'feedback', metric: 'summary.overall_consistency_score', operator: '>=', value: 90 },
      ],
    },
  });
  const commands = [];
  const evaluation = await evaluateGoal(projectRoot, 'run-a', {
    runCommand: async (command) => { commands.push(command); return { exit_code: 0 }; },
  });
  assert.deepEqual(commands, ['exit 0'], 'command criteria run through the injected runner');
  const byId = Object.fromEntries(evaluation.criteria.map((criterion) => [criterion.id, criterion]));
  assert.equal(byId.doc.status, 'PASS');
  assert.equal(byId['missing-doc'].status, 'FAIL');
  assert.equal(byId.tests.status, 'PASS');
  assert.equal(byId.score.status, 'PASS');
  assert.equal(evaluation.status, 'RETRY', 'one failing criterion keeps the goal unmet');
  assert.ok(evaluation.recommended_rerun_stages.includes('03-documentation'), 'criterion rerun hint is honored');
});

test('command criterion failing exit code -> criterion FAIL', async () => {
  const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'rstack-goal-'));
  seedRun(projectRoot, 'run-a', {
    tasks: [task('001', 'PASS')],
    feedback: cleanFeedback,
    goal: { goal_id: 'cmd', criteria: [{ id: 'tests', kind: 'command', command: 'npm test' }] },
  });
  const evaluation = await evaluateGoal(projectRoot, 'run-a', {
    runCommand: async () => ({ exit_code: 1 }),
  });
  assert.equal(evaluation.criteria[0].status, 'FAIL');
  assert.match(evaluation.criteria[0].detail, /exited 1/);
  assert.equal(evaluation.status, 'RETRY');
});

test('judge criterion without a verdict -> ASK_USER (model-free: harness never judges)', async () => {
  const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'rstack-goal-'));
  seedRun(projectRoot, 'run-a', {
    tasks: [task('001', 'PASS')],
    feedback: cleanFeedback,
    goal: { goal_id: 'judged', criteria: [{ id: 'arch', kind: 'judge', question: 'Is the design satisfying?' }] },
  });
  const evaluation = await evaluateGoal(projectRoot, 'run-a');
  assert.equal(evaluation.status, 'ASK_USER');
  assert.match(evaluation.reason, /goal-verdict\.json/);
});

test('judge verdict PASS -> PASS; FAIL -> RETRY with the verdict rerun stages; block recommendation -> BLOCK', async () => {
  const goal = { goal_id: 'judged', criteria: [{ id: 'arch', kind: 'judge', rerun_stages: ['06-architecture'] }] };

  const passRoot = mkdtempSync(path.join(os.tmpdir(), 'rstack-goal-'));
  seedRun(passRoot, 'run-a', {
    tasks: [task('001', 'PASS')], feedback: cleanFeedback, goal,
    verdict: { criterion_id: 'arch', verdict: 'PASS', judge: 'host-framework', reasoning: 'design holds' },
  });
  assert.equal((await evaluateGoal(passRoot, 'run-a')).status, 'PASS');

  const retryRoot = mkdtempSync(path.join(os.tmpdir(), 'rstack-goal-'));
  seedRun(retryRoot, 'run-a', {
    tasks: [task('001', 'PASS')], feedback: cleanFeedback, goal,
    verdict: { criterion_id: 'arch', verdict: 'FAIL', judge: 'host-framework', recommended_rerun_stages: ['06-architecture', '07-code'] },
  });
  const retryEval = await evaluateGoal(retryRoot, 'run-a');
  assert.equal(retryEval.status, 'RETRY');
  assert.deepEqual([...retryEval.recommended_rerun_stages].sort(), ['06-architecture', '07-code']);

  const blockRoot = mkdtempSync(path.join(os.tmpdir(), 'rstack-goal-'));
  seedRun(blockRoot, 'run-a', {
    tasks: [task('001', 'PASS')], feedback: cleanFeedback, goal,
    verdict: { criterion_id: 'arch', verdict: 'FAIL', recommendation: 'block', judge: 'human' },
  });
  assert.equal((await evaluateGoal(blockRoot, 'run-a')).status, 'BLOCK');
});

test('stale judge verdict (iteration below the current one) is ignored -> ASK_USER', async () => {
  const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'rstack-goal-'));
  seedRun(projectRoot, 'run-a', {
    tasks: [task('001', 'PASS')],
    feedback: cleanFeedback,
    goal: { goal_id: 'judged', criteria: [{ id: 'arch', kind: 'judge' }] },
    verdict: { criterion_id: 'arch', verdict: 'PASS', iteration: 1 },
  });
  const evaluation = await evaluateGoal(projectRoot, 'run-a', { iteration: 2 });
  assert.equal(evaluation.status, 'ASK_USER');
});

test('min_score threshold: passing checks below min_score keep the goal at RETRY', async () => {
  const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'rstack-goal-'));
  seedRun(projectRoot, 'run-a', {
    tasks: [task('001', 'PASS')],
    feedback: cleanFeedback,
    goal: {
      goal_id: 'strict',
      min_score: 100,
      criteria: [
        { id: 'a', kind: 'file_exists', path: 'missing-a.md' },
        { id: 'b', kind: 'file_exists', path: 'missing-b.md' },
      ],
    },
  });
  const evaluation = await evaluateGoal(projectRoot, 'run-a');
  assert.equal(evaluation.status, 'RETRY');
  assert.ok(evaluation.score < 100);
  assert.match(evaluation.reason, /criteria failing/);
});

test('malformed goal definitions degrade loudly, never silently pass', async () => {
  const normalized = normalizeGoalDefinition({ goal_id: 'bad', min_score: 'lots', criteria: [{ kind: 'teleport' }, { kind: 'file_exists' }] });
  assert.equal(normalized.min_score, 100);
  assert.equal(normalized.issues.length, 3);
  assert.equal(normalized.criteria.filter((criterion) => criterion.kind === 'invalid').length, 2);

  const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'rstack-goal-'));
  seedRun(projectRoot, 'run-a', {
    tasks: [task('001', 'PASS')],
    feedback: cleanFeedback,
    goal: { goal_id: 'bad', criteria: [{ kind: 'teleport' }] },
  });
  const evaluation = await evaluateGoal(projectRoot, 'run-a');
  assert.notEqual(evaluation.status, 'PASS');
  assert.ok(evaluation.goal_issues.length > 0);
});

test('readGoalEvidence gathers goal, feedback, verdicts, tasks, approvals, decisions', async () => {
  const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'rstack-goal-'));
  const runDir = seedRun(projectRoot, 'run-a', {
    tasks: [task('001', 'PASS')],
    approvals: [{ artifact: 'x', status: 'APPROVED' }],
    decisions: { decisions: [{ decision_id: 'DEC-001', status: 'resolved' }] },
    feedback: cleanFeedback,
    goal: { goal_id: 'g' },
    verdict: { verdict: 'PASS' },
  });
  const evidence = await readGoalEvidence(runDir);
  assert.equal(evidence.goal.goal_id, 'g');
  assert.equal(evidence.feedback.summary.overall_consistency_score, 98);
  assert.equal(evidence.verdicts.length, 1);
  assert.equal(evidence.tasks.length, 1);
  assert.equal(evidence.approvals.length, 1);
  assert.equal(evidence.decisions.length, 1);
});

test('verdict normalization tolerates junk shapes', () => {
  assert.deepEqual(normalizeGoalVerdicts(null), []);
  assert.deepEqual(normalizeGoalVerdicts('nonsense'), []);
  assert.equal(normalizeGoalVerdicts([{ verdict: 'MAYBE' }])[0].verdict, null);
  assert.equal(normalizeGoalVerdicts({ verdicts: [{ verdict: 'PASS', criterion_id: 'c1' }] })[0].criterion_id, 'c1');
});

test('mapAgentToStage resolves agent names, stage agents, and stage ids', () => {
  assert.equal(mapAgentToStage('architecture_agent'), '06-architecture');
  assert.equal(mapAgentToStage('agent.07-code'), '07-code');
  assert.equal(mapAgentToStage('11-feedback-loop'), '11-feedback-loop');
  assert.equal(mapAgentToStage('unknown_wizard'), null);
});

test('summarizeGoalDecision is one operator-readable line', async () => {
  const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'rstack-goal-'));
  seedRun(projectRoot, 'run-a', { tasks: [task('001', 'FAIL')] });
  const evaluation = await evaluateGoal(projectRoot, 'run-a');
  const line = summarizeGoalDecision(evaluation);
  assert.match(line, /^\[RETRY\]/);
  assert.match(line, /score/);
  assert.equal(summarizeGoalDecision(null), '[UNKNOWN] goal evaluation is missing or malformed.');
});
