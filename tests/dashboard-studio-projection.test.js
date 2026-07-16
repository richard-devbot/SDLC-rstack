/**
 * Server-owned Agent Force Studio projection.
 *
 * owner: RStack developed by Richardson Gunde
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildFullState, toClientState } from '../src/observability/dashboard/state/index.js';
import { buildStudioProjection } from '../src/observability/dashboard/state/studio.js';

const NOW = '2026-07-13T10:00:00.000Z';

function task(overrides = {}) {
  return {
    id: '003-architecture',
    title: 'Architecture',
    status: 'IN_PROGRESS',
    stage_artifacts: [
      { stage_id: '06-architecture', artifact: 'architecture.md' },
      { stage_id: '12-security-threat-model', artifact: 'threat-model.md' },
      { stage_id: '14-cost-estimation', artifact: 'cost-estimate.json' },
    ],
    specialists: ['specialist.backend.api'],
    pipeline_agents: ['agent.06-architecture'],
    builder: null,
    validation: null,
    ...overrides,
  };
}

function stateWith(runTask = task(), events = [], overrides = {}) {
  const run = {
    runId: 'run-1',
    projectId: 'project-1',
    projectRoot: '/repo',
    manifest: {
      goal: 'Ship Agent Force Studio',
      updated_at: '2026-07-13T09:59:40.000Z',
      harness: 'pi',
    },
    derivedStatus: 'active',
    tasks: runTask ? [runTask] : [],
    events,
    stageReports: [],
    timeline: [],
    evidence: [],
  };
  return {
    ts: NOW,
    scope: { type: 'run', runKey: 'project-1::run-1', projectId: 'project-1' },
    runs: [run],
    readiness: {
      state: 'unknown',
      evaluatedAt: NOW,
      source: { kind: 'readiness-projection' },
    },
    actions: [{
      id: 'action-1',
      runId: 'run-1',
      type: 'next_action',
      title: 'Validate architecture',
      source: 'pipeline-rollup',
    }],
    approvals: [],
    blockedGates: [],
    evidenceCenter: { items: [] },
    runWorkspaces: [],
    ...overrides,
  };
}

test('projection exposes eight missions, fifteen shared departments, and task-derived confidence', () => {
  const studio = buildStudioProjection(stateWith(), { evaluatedAt: NOW });

  assert.equal(studio.schema_version, 1);
  assert.equal(studio.missions.length, 8);
  assert.equal(studio.departments.length, 15);
  assert.equal(studio.departments.filter((item) => item.id === '12-security-threat-model').length, 1);
  assert.equal(studio.sessions.length, 1);
  assert.equal(studio.sessions[0].identity_confidence, 'task_derived');
  assert.equal(studio.sessions[0].role, 'builder');
  assert.equal(studio.sessions[0].status, 'active');
  assert.deepEqual(studio.sessions[0].specialist_ids, ['specialist.backend.api']);
  assert.equal(studio.missions.find((mission) => mission.id === '003-architecture').status, 'active');
  assert.equal(studio.orchestrator.next_action.title, 'Validate architecture');
  assert.equal(studio.availability, 'partial');
  assert.ok(studio.limitations.some((item) => item.code === 'partial_lifecycle_coverage'));
});

test('observed lifecycle wins over task-derived identity and preserves waiting truth', () => {
  const events = [
    {
      type: 'agent_session_started',
      agent_session_id: 'session-1',
      delegation_id: 'delegation-1',
      task_id: '003-architecture',
      stage_ids: ['06-architecture'],
      role: 'validator',
      harness: 'pi',
      model: 'gemini-2.5-pro',
      timestamp: '2026-07-13T09:59:00.000Z',
    },
    {
      type: 'agent_capabilities_attached',
      agent_session_id: 'session-1',
      specialist_ids: ['specialist.security.threat-modeler'],
      skill_ids: ['skill.threat-model'],
      plugin_ids: ['plugin.security'],
      timestamp: '2026-07-13T09:59:10.000Z',
    },
    {
      type: 'agent_waiting',
      agent_session_id: 'session-1',
      reason_class: 'approval',
      source: 'approval-gate',
      timestamp: '2026-07-13T09:59:30.000Z',
    },
  ];
  const studio = buildStudioProjection(stateWith(task({ status: 'BLOCKED' }), events), { evaluatedAt: NOW });

  assert.equal(studio.sessions.length, 1);
  assert.equal(studio.sessions[0].identity_confidence, 'observed');
  assert.equal(studio.sessions[0].status, 'waiting');
  assert.equal(studio.sessions[0].role, 'validator');
  assert.equal(studio.sessions[0].waiting_reason, 'approval');
  assert.deepEqual(studio.sessions[0].skill_ids, ['skill.threat-model']);
  assert.equal(studio.availability, 'available');
  assert.deepEqual(studio.limitations, []);
});

test('terminal lifecycle is idempotent and overrides earlier waiting state', () => {
  const started = {
    type: 'agent_session_started',
    agent_session_id: 'session-1',
    delegation_id: 'delegation-1',
    task_id: '003-architecture',
    role: 'builder',
    timestamp: '2026-07-13T09:58:00.000Z',
  };
  const events = [
    started,
    { ...started },
    { type: 'agent_waiting', agent_session_id: 'session-1', reason_class: 'dependency', timestamp: '2026-07-13T09:58:30.000Z' },
    { type: 'agent_session_completed', agent_session_id: 'session-1', status: 'completed', timestamp: '2026-07-13T09:59:00.000Z' },
    { type: 'agent_session_stopped', agent_session_id: 'session-1', reason_class: 'cleanup', timestamp: '2026-07-13T09:59:01.000Z' },
  ];
  const studio = buildStudioProjection(stateWith(task({ status: 'PASS' }), events), { evaluatedAt: NOW });

  assert.equal(studio.sessions.length, 1);
  assert.equal(studio.sessions[0].status, 'completed');
  assert.equal(studio.sessions[0].ended_at, '2026-07-13T09:59:01.000Z');
  assert.equal(studio.timeline.filter((event) => event.type === 'agent_session_started').length, 1);
});

test('governance, evidence, and work objects carry scope, source, and timestamps', () => {
  const events = [
    { type: 'delegation_requested', delegation_id: 'delegation-1', task_id: '003-architecture', stage_ids: ['06-architecture'], role: 'builder', timestamp: '2026-07-13T09:57:00.000Z' },
    { type: 'artifact_emitted', agent_session_id: 'session-1', task_id: '003-architecture', source: 'artifacts/stages/06-architecture/architecture.md', timestamp: '2026-07-13T09:58:00.000Z' },
  ];
  const state = stateWith(task({ status: 'BLOCKED' }), events, {
    blockedGates: [{ id: 'gate-1', runId: 'run-1', taskId: '003-architecture', type: 'approval', title: 'Approve architecture', source: 'approval-gate', ts: '2026-07-13T09:58:30.000Z' }],
    evidenceCenter: { items: [{ id: 'evidence-1', runId: 'run-1', taskId: '003-architecture', kind: 'artifact', title: 'Architecture', source: 'architecture.md', ts: '2026-07-13T09:58:00.000Z' }] },
  });
  const studio = buildStudioProjection(state, { evaluatedAt: NOW });

  assert.equal(studio.governance_items[0].run_id, 'run-1');
  assert.equal(studio.governance_items[0].source, 'approval-gate');
  assert.equal(studio.evidence_items[0].run_id, 'run-1');
  assert.equal(studio.evidence_items[0].source, 'architecture.md');
  assert.deepEqual(studio.work_objects.map((item) => item.kind), ['delegation', 'artifact']);
  assert.ok(studio.work_objects.every((item) => item.timestamp));
});

test('timeline keeps only sanitized facts needed for live action captions', () => {
  const events = [
    {
      type: 'agent_capabilities_attached',
      agent_session_id: 'session-1',
      task_id: '003-architecture',
      skill_ids: ['risk-review', '<script>'],
      timestamp: '2026-07-13T09:57:00.000Z',
    },
    {
      type: 'handoff_created',
      agent_session_id: 'session-1',
      task_id: '003-architecture',
      from: 'builder',
      to: 'validator',
      timestamp: '2026-07-13T09:57:10.000Z',
    },
    {
      type: 'task_retry_scheduled',
      agent_session_id: 'session-1',
      task_id: '003-architecture',
      attempt: 3,
      timestamp: '2026-07-13T09:57:20.000Z',
    },
    {
      type: 'artifact_emitted',
      agent_session_id: 'session-1',
      task_id: '003-architecture',
      evidence_refs: ['evidence/result.json', '<unsafe>'],
      timestamp: '2026-07-13T09:57:30.000Z',
    },
  ];

  const studio = buildStudioProjection(stateWith(task(), events), { evaluatedAt: NOW });
  const byType = new Map(studio.timeline.map((item) => [item.type, item]));

  assert.deepEqual(byType.get('agent_capabilities_attached').skill_ids, ['risk-review']);
  assert.equal(byType.get('handoff_created').from, 'builder');
  assert.equal(byType.get('handoff_created').to, 'validator');
  assert.equal(byType.get('task_retry_scheduled').attempt, 3);
  assert.deepEqual(byType.get('artifact_emitted').evidence_refs, ['evidence/result.json', '<unsafe>']);
});

test('approval summary is projected server-side from governance or approval waiters', () => {
  const governed = buildStudioProjection(stateWith(task(), [], {
    blockedGates: [{
      id: 'gate-1',
      runId: 'run-1',
      taskId: '003-architecture',
      type: 'approval',
      title: 'Release candidate',
      status: 'blocked',
    }],
  }), { evaluatedAt: NOW });
  assert.deepEqual(governed.approval_summary, {
    pending_count: 1,
    artifact: 'Release candidate',
  });

  const waiting = buildStudioProjection(stateWith(task(), [
    {
      type: 'agent_session_started',
      agent_session_id: 'session-1',
      task_id: '003-architecture',
      role: 'validator',
      timestamp: '2026-07-13T09:57:00.000Z',
    },
    {
      type: 'agent_waiting',
      agent_session_id: 'session-1',
      task_id: '003-architecture',
      reason_class: 'approval',
      timestamp: '2026-07-13T09:57:10.000Z',
    },
  ]), { evaluatedAt: NOW });
  assert.deepEqual(waiting.approval_summary, {
    pending_count: 1,
    artifact: '003-architecture',
  });

  assert.equal(buildStudioProjection(stateWith(), { evaluatedAt: NOW }).approval_summary, null);
});

test('real stage-report index strings remain distinct Evidence Vault records', () => {
  const state = stateWith(task(), [], {
    runs: [{
      ...stateWith().runs[0],
      stageReports: ['06-architecture', '12-security-threat-model', '14-cost-estimation'],
    }],
  });
  const studio = buildStudioProjection(state, { evaluatedAt: NOW });

  assert.deepEqual(studio.evidence_items.map((item) => item.stage_id), [
    '06-architecture',
    '12-security-threat-model',
    '14-cost-estimation',
  ]);
  assert.equal(new Set(studio.evidence_items.map((item) => item.id)).size, 3);
  assert.ok(studio.evidence_items.every((item) => item.source === 'stage-reports'));
});

test('no-run and stale states fail honestly', () => {
  const unavailable = buildStudioProjection({ ts: NOW, runs: [], scope: { type: 'global' } }, { evaluatedAt: NOW });
  assert.equal(unavailable.availability, 'unavailable');
  assert.equal(unavailable.freshness.state, 'unknown');
  assert.equal(unavailable.sessions.length, 0);
  assert.ok(unavailable.limitations.some((item) => item.code === 'no_run_selected'));

  const stale = buildStudioProjection(stateWith(null, [], {
    runs: [{
      runId: 'run-old', projectId: 'project-1', projectRoot: '/repo',
      manifest: { goal: 'Old run', updated_at: '2026-07-13T09:00:00.000Z' },
      derivedStatus: 'active', tasks: [], events: [], stageReports: [], timeline: [], evidence: [],
    }],
  }), { evaluatedAt: NOW });
  assert.equal(stale.freshness.state, 'stale');
  assert.equal(stale.freshness.observed_at, '2026-07-13T09:00:00.000Z');
});

test('projection excludes raw prompts, command input, stderr, tokens, and unrestricted paths', () => {
  const events = [{
    type: 'agent_activity',
    agent_session_id: 'session-1',
    activity_class: 'tool',
    summary: 'Checked architecture',
    prompt: 'private chain',
    input: { token: 'RSTACK_APPROVAL_TOKEN=super-secret' },
    stderr: 'failure /repo/.env',
    timestamp: '2026-07-13T09:59:00.000Z',
  }];
  const serialized = JSON.stringify(buildStudioProjection(stateWith(task(), events), { evaluatedAt: NOW }));

  assert.doesNotMatch(serialized, /private chain/);
  assert.doesNotMatch(serialized, /super-secret/);
  assert.doesNotMatch(serialized, /stderr/);
  assert.doesNotMatch(serialized, /\/repo\/\.env/);
  assert.match(serialized, /Checked architecture/);
});

test('full and client states share the exact Studio projection without exposing raw events', async () => {
  const root = mkdtempSync(join(tmpdir(), 'rstack-studio-state-'));
  mkdirSync(join(root, '.rstack', 'runs'), { recursive: true });
  try {
    const full = await buildFullState(root, {
      sourceRoots: [root],
      now: new Date(NOW),
    });
    const client = toClientState(full);

    assert.deepEqual(client.studio, full.studio);
    assert.equal(client.studio.missions.length, 8);
    assert.equal(client.studio.departments.length, 15);
    assert.ok(client.runs.every((run) => !Object.hasOwn(run, 'events')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
