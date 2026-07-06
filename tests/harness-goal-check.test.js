import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  evaluateGoal,
  goalVerdictsFromFeedback,
  mapAgentToStage,
  normalizeGoalDefinition,
  normalizeGoalEvaluation,
  normalizeGoalVerdicts,
  readGoalEvidence,
  summarizeGoalDecision,
  validateGoalEvaluation,
  AGENT_GOAL_JUDGE,
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

test('unstamped judge verdict is stale inside an iteration context, but valid for one-shot evaluation', async () => {
  const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'rstack-goal-'));
  seedRun(projectRoot, 'run-a', {
    tasks: [task('001', 'PASS')],
    feedback: cleanFeedback,
    goal: { goal_id: 'judged', criteria: [{ id: 'arch', kind: 'judge' }] },
    verdict: { criterion_id: 'arch', verdict: 'PASS' },
  });
  // A write-once PASS with no iteration stamp must NOT be consumed forever
  // across loop iterations — even iteration 1 requires a stamp.
  const looped = await evaluateGoal(projectRoot, 'run-a', { iteration: 1 });
  assert.equal(looped.status, 'ASK_USER');
  // One-shot evaluation (no iteration context) still accepts it.
  const oneShot = await evaluateGoal(projectRoot, 'run-a');
  assert.equal(oneShot.status, 'PASS');
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

// ── Agent-11 goal_evaluation writer path (#128, BLE-4.2) ─────────────────────

const judgedGoal = {
  goal_id: 'arch-satisfaction',
  criteria: [{ id: 'design-review', kind: 'judge', question: 'Is the design satisfying?', rerun_stages: ['06-architecture'] }],
};

function seedDesignArtifact(runDir) {
  const stageDir = path.join(runDir, 'artifacts', 'stages', '06-architecture');
  mkdirSync(stageDir, { recursive: true });
  writeFileSync(path.join(stageDir, 'system_design.json'), JSON.stringify({ services: ['api'] }));
  return 'artifacts/stages/06-architecture/system_design.json';
}

function feedbackWithGoalEvaluation(criteria, overrides = {}) {
  return {
    ...cleanFeedback,
    goal_evaluation: {
      goal_id: 'arch-satisfaction',
      status: 'PASS',
      consistency_score: 95,
      critical_count: 0,
      failing_stages: [],
      recommended_rerun_stages: [],
      requires_human_decision: false,
      reason: 'Design covers every FR with evidence.',
      criteria,
      ...overrides,
    },
  };
}

test('agent-11 goal_evaluation "met" with existing evidence satisfies a judge criterion', async () => {
  const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'rstack-goal-'));
  const runDir = seedRun(projectRoot, 'run-a', { tasks: [task('001', 'PASS')], goal: judgedGoal });
  const evidencePath = seedDesignArtifact(runDir);
  const stageDir = path.join(runDir, 'artifacts', 'stages', '11-feedback-loop');
  mkdirSync(stageDir, { recursive: true });
  writeFileSync(path.join(stageDir, 'feedback.json'), JSON.stringify(feedbackWithGoalEvaluation([
    { criterion_id: 'design-review', result: 'met', evidence: [evidencePath], reasoning: 'every FR mapped' },
  ])));

  const evaluation = await evaluateGoal(projectRoot, 'run-a');
  assert.equal(evaluation.status, 'PASS');
  const criterion = evaluation.criteria.find((item) => item.id === 'design-review');
  assert.equal(criterion.status, 'PASS');
  assert.match(criterion.detail, /agent\.11-feedback-loop/);
  assert.deepEqual(evaluation.agent_goal_evaluation.consumed, ['design-review']);
  assert.deepEqual(evaluation.agent_goal_evaluation.rejected, []);
});

test('agent-11 "not_met" with taxonomy-tagged remediation drives RETRY with the recommended stage resets', async () => {
  const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'rstack-goal-'));
  const runDir = seedRun(projectRoot, 'run-a', { tasks: [task('001', 'PASS', '06-architecture')], goal: judgedGoal });
  const evidencePath = seedDesignArtifact(runDir);
  const stageDir = path.join(runDir, 'artifacts', 'stages', '11-feedback-loop');
  mkdirSync(stageDir, { recursive: true });
  writeFileSync(path.join(stageDir, 'feedback.json'), JSON.stringify(feedbackWithGoalEvaluation([
    {
      criterion_id: 'design-review', result: 'not_met', evidence: [evidencePath],
      reasoning: 'FR-003 has no endpoint', maintenance_category: 'corrective',
      recommendation: 'retry', recommended_rerun_stages: ['06-architecture', '07-code'],
    },
  ], { status: 'RETRY', reason: 'FR-003 has no endpoint in the design.' })));

  const evaluation = await evaluateGoal(projectRoot, 'run-a');
  assert.equal(evaluation.status, 'RETRY');
  assert.deepEqual([...evaluation.recommended_rerun_stages].sort(), ['06-architecture', '07-code']);
});

test('agent-11 "not_met" with recommendation "block" stops as BLOCK', async () => {
  const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'rstack-goal-'));
  const runDir = seedRun(projectRoot, 'run-a', { tasks: [task('001', 'PASS')], goal: judgedGoal });
  const evidencePath = seedDesignArtifact(runDir);
  const stageDir = path.join(runDir, 'artifacts', 'stages', '11-feedback-loop');
  mkdirSync(stageDir, { recursive: true });
  writeFileSync(path.join(stageDir, 'feedback.json'), JSON.stringify(feedbackWithGoalEvaluation([
    { criterion_id: 'design-review', result: 'not_met', evidence: [evidencePath], recommendation: 'block', maintenance_category: 'corrective' },
  ], { status: 'BLOCK', requires_human_decision: true })));

  const evaluation = await evaluateGoal(projectRoot, 'run-a');
  assert.equal(evaluation.status, 'BLOCK');
});

test('unevidenced agent-11 claim is rejected -> existing ASK_USER path, with the rejection reason surfaced', async () => {
  const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'rstack-goal-'));
  seedRun(projectRoot, 'run-a', {
    tasks: [task('001', 'PASS')],
    goal: judgedGoal,
    feedback: feedbackWithGoalEvaluation([
      { criterion_id: 'design-review', result: 'met', evidence: [] },
    ]),
  });
  const evaluation = await evaluateGoal(projectRoot, 'run-a');
  assert.equal(evaluation.status, 'ASK_USER');
  assert.match(evaluation.reason, /not consumed/);
  assert.match(evaluation.reason, /unevidenced/);
  assert.equal(evaluation.agent_goal_evaluation.rejected.length, 1);
});

test('agent-11 claim whose evidence paths do not exist on disk is rejected -> ASK_USER', async () => {
  const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'rstack-goal-'));
  seedRun(projectRoot, 'run-a', {
    tasks: [task('001', 'PASS')],
    goal: judgedGoal,
    feedback: feedbackWithGoalEvaluation([
      { criterion_id: 'design-review', result: 'met', evidence: ['artifacts/stages/06-architecture/system_design.json'] },
    ]),
  });
  const evaluation = await evaluateGoal(projectRoot, 'run-a');
  assert.equal(evaluation.status, 'ASK_USER');
  assert.match(evaluation.reason, /evidence path\(s\) missing on disk/);
});

test('"unknown" agent-11 result is never consumed -> ASK_USER', async () => {
  const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'rstack-goal-'));
  const runDir = seedRun(projectRoot, 'run-a', { tasks: [task('001', 'PASS')], goal: judgedGoal });
  const evidencePath = seedDesignArtifact(runDir);
  const stageDir = path.join(runDir, 'artifacts', 'stages', '11-feedback-loop');
  mkdirSync(stageDir, { recursive: true });
  writeFileSync(path.join(stageDir, 'feedback.json'), JSON.stringify(feedbackWithGoalEvaluation([
    { criterion_id: 'design-review', result: 'unknown', evidence: [evidencePath] },
  ], { status: 'ASK_USER', requires_human_decision: true })));

  const evaluation = await evaluateGoal(projectRoot, 'run-a');
  assert.equal(evaluation.status, 'ASK_USER');
  assert.match(evaluation.reason, /unknown/);
});

test('stale agent-11 evaluation (older or missing iteration stamp) is ignored inside a loop iteration', async () => {
  const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'rstack-goal-'));
  const runDir = seedRun(projectRoot, 'run-a', { tasks: [task('001', 'PASS')], goal: judgedGoal });
  const evidencePath = seedDesignArtifact(runDir);
  const stageDir = path.join(runDir, 'artifacts', 'stages', '11-feedback-loop');
  mkdirSync(stageDir, { recursive: true });

  // Stamped with iteration 1 — stale for iteration 2, valid for iteration 1.
  writeFileSync(path.join(stageDir, 'feedback.json'), JSON.stringify(feedbackWithGoalEvaluation([
    { criterion_id: 'design-review', result: 'met', evidence: [evidencePath] },
  ], { iteration: 1 })));
  assert.equal((await evaluateGoal(projectRoot, 'run-a', { iteration: 2 })).status, 'ASK_USER');
  assert.equal((await evaluateGoal(projectRoot, 'run-a', { iteration: 1 })).status, 'PASS');

  // Missing stamp = stale in ANY iteration context; still valid one-shot.
  writeFileSync(path.join(stageDir, 'feedback.json'), JSON.stringify(feedbackWithGoalEvaluation([
    { criterion_id: 'design-review', result: 'met', evidence: [evidencePath] },
  ])));
  assert.equal((await evaluateGoal(projectRoot, 'run-a', { iteration: 1 })).status, 'ASK_USER');
  assert.equal((await evaluateGoal(projectRoot, 'run-a')).status, 'PASS');
});

test('over-stamped agent-11 evaluation (iteration ahead of the current one) is rejected as malformed', async () => {
  const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'rstack-goal-'));
  const runDir = seedRun(projectRoot, 'run-a', { tasks: [task('001', 'PASS')], goal: judgedGoal });
  const evidencePath = seedDesignArtifact(runDir);
  const stageDir = path.join(runDir, 'artifacts', 'stages', '11-feedback-loop');
  mkdirSync(stageDir, { recursive: true });
  // A write-once iteration: 99 would satisfy ">= minIteration" on every later
  // iteration and defeat the freshness filter forever. For the agent path a
  // stamp ahead of the current iteration is malformed, never fresh.
  writeFileSync(path.join(stageDir, 'feedback.json'), JSON.stringify(feedbackWithGoalEvaluation([
    { criterion_id: 'design-review', result: 'met', evidence: [evidencePath] },
  ], { iteration: 99 })));

  const evaluation = await evaluateGoal(projectRoot, 'run-a', { iteration: 2 });
  assert.equal(evaluation.status, 'ASK_USER');
  assert.match(evaluation.reason, /iteration stamp 99 is ahead of the current iteration 2/);
  assert.equal(evaluation.agent_goal_evaluation.rejected.length, 1);
  assert.deepEqual(evaluation.agent_goal_evaluation.consumed, []);

  // An exact current stamp is fine — the honest case keeps working.
  writeFileSync(path.join(stageDir, 'feedback.json'), JSON.stringify(feedbackWithGoalEvaluation([
    { criterion_id: 'design-review', result: 'met', evidence: [evidencePath] },
  ], { iteration: 2 })));
  assert.equal((await evaluateGoal(projectRoot, 'run-a', { iteration: 2 })).status, 'PASS');
});

test('an id-less shorthand human verdict outranks an id-matched agent-11 claim (single-judge goal)', async () => {
  // The documented shorthand {"verdict":"FAIL"} carries no criterion_id. In a
  // merged pool the agent's id-matched claim would win the byId lookup and
  // invert precedence — the explicit pool must be consumed fully first.
  const failRoot = mkdtempSync(path.join(os.tmpdir(), 'rstack-goal-'));
  const failRunDir = seedRun(failRoot, 'run-a', {
    tasks: [task('001', 'PASS')],
    goal: judgedGoal,
    verdict: { verdict: 'FAIL', judge: 'human', reasoning: 'design rejected' },
  });
  const failEvidence = seedDesignArtifact(failRunDir);
  const failStageDir = path.join(failRunDir, 'artifacts', 'stages', '11-feedback-loop');
  mkdirSync(failStageDir, { recursive: true });
  writeFileSync(path.join(failStageDir, 'feedback.json'), JSON.stringify(feedbackWithGoalEvaluation([
    { criterion_id: 'design-review', result: 'met', evidence: [failEvidence] },
  ])));
  const failEval = await evaluateGoal(failRoot, 'run-a');
  assert.equal(failEval.status, 'RETRY', 'the shorthand human FAIL wins over the agent met claim');
  assert.match(failEval.criteria[0].detail, /judge human/);

  // And the reverse: a shorthand human PASS wins over an agent not_met claim.
  const passRoot = mkdtempSync(path.join(os.tmpdir(), 'rstack-goal-'));
  const passRunDir = seedRun(passRoot, 'run-a', {
    tasks: [task('001', 'PASS')],
    goal: judgedGoal,
    verdict: { verdict: 'PASS', judge: 'human', reasoning: 'design approved' },
  });
  const passEvidence = seedDesignArtifact(passRunDir);
  const passStageDir = path.join(passRunDir, 'artifacts', 'stages', '11-feedback-loop');
  mkdirSync(passStageDir, { recursive: true });
  writeFileSync(path.join(passStageDir, 'feedback.json'), JSON.stringify(feedbackWithGoalEvaluation([
    { criterion_id: 'design-review', result: 'not_met', evidence: [passEvidence] },
  ], { status: 'RETRY' })));
  const passEval = await evaluateGoal(passRoot, 'run-a');
  assert.equal(passEval.status, 'PASS', 'the shorthand human PASS wins over the agent not_met claim');
  assert.match(passEval.criteria[0].detail, /judge human/);
});

test('an explicit goal-verdict.json outranks the agent-11 evaluation for the same criterion', async () => {
  const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'rstack-goal-'));
  const runDir = seedRun(projectRoot, 'run-a', {
    tasks: [task('001', 'PASS')],
    goal: judgedGoal,
    verdict: { criterion_id: 'design-review', verdict: 'FAIL', judge: 'human', reasoning: 'not good enough', recommended_rerun_stages: ['06-architecture'] },
  });
  const evidencePath = seedDesignArtifact(runDir);
  const stageDir = path.join(runDir, 'artifacts', 'stages', '11-feedback-loop');
  mkdirSync(stageDir, { recursive: true });
  writeFileSync(path.join(stageDir, 'feedback.json'), JSON.stringify(feedbackWithGoalEvaluation([
    { criterion_id: 'design-review', result: 'met', evidence: [evidencePath] },
  ])));

  const evaluation = await evaluateGoal(projectRoot, 'run-a');
  assert.equal(evaluation.status, 'RETRY', 'the human FAIL verdict wins over the agent PASS claim');
  const criterion = evaluation.criteria.find((item) => item.id === 'design-review');
  assert.match(criterion.detail, /judge human/);
});

test('goalVerdictsFromFeedback maps results into the verdict protocol and rejects with reasons', () => {
  const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'rstack-goal-'));
  writeFileSync(path.join(projectRoot, 'proof.md'), 'evidence');
  const { present, verdicts, rejected } = goalVerdictsFromFeedback({
    goal_evaluation: {
      status: 'RETRY', iteration: 3,
      criteria: [
        { criterion_id: 'ok', result: 'not_met', evidence: ['proof.md'], maintenance_category: 'corrective', recommended_rerun_stages: ['07-code'] },
        { criterion_id: 'noproof', result: 'met', evidence: [] },
        { criterion_id: 'dunno', result: 'unknown', evidence: ['proof.md'] },
      ],
    },
  }, { projectRoot });
  assert.equal(present, true);
  assert.equal(verdicts.length, 1);
  assert.equal(verdicts[0].verdict, 'FAIL');
  assert.equal(verdicts[0].judge, AGENT_GOAL_JUDGE);
  assert.equal(verdicts[0].iteration, 3, 'section iteration stamp flows onto each verdict');
  assert.equal(verdicts[0].maintenance_category, 'corrective');
  assert.deepEqual(verdicts[0].recommended_rerun_stages, ['07-code']);
  assert.deepEqual(rejected.map((item) => item.criterion_id).sort(), ['dunno', 'noproof']);
});

test('normalizeGoalEvaluation tolerates junk shapes and reports issues instead of throwing', () => {
  assert.equal(normalizeGoalEvaluation(null).present, false);
  assert.equal(normalizeGoalEvaluation('nonsense').criteria.length, 0);
  const normalized = normalizeGoalEvaluation({
    status: 'MAYBE', iteration: 'two',
    criteria: [{ result: 'met' }, { criterion_id: 'x', result: 'sorta' }, 'junk'],
  });
  assert.equal(normalized.status, null);
  assert.equal(normalized.iteration, null);
  assert.equal(normalized.criteria.length, 0);
  assert.ok(normalized.issues.length >= 4);
});

test('validateGoalEvaluation: complete section passes; missing fields fail with named checks', () => {
  const good = validateGoalEvaluation({
    status: 'PASS', consistency_score: 92.5, critical_count: 0,
    failing_stages: [], recommended_rerun_stages: [], requires_human_decision: false,
    reason: 'All criteria met with evidence.',
    criteria: [{ criterion_id: 'c1', result: 'met', evidence: ['artifacts/x.json'] }],
  });
  assert.equal(good.ok, true);
  assert.equal(good.issues.length, 0);

  const bad = validateGoalEvaluation({ status: 'GREAT', consistency_score: 'high' });
  assert.equal(bad.ok, false);
  const failed = bad.issues.map((check) => check.name);
  assert.ok(failed.includes('goal_evaluation_status_allowed'));
  assert.ok(failed.includes('goal_evaluation_consistency_score_numeric'));
  assert.ok(failed.includes('goal_evaluation_has_reason'));

  const absent = validateGoalEvaluation(null);
  assert.equal(absent.ok, false);
  assert.equal(absent.checks[0].name, 'goal_evaluation_is_object');
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
