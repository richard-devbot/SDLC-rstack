# Agent Force Studio 3D Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a production-ready 3D Agent Force Studio that truthfully visualizes RStack orchestration, mission work, temporary agent sessions, governance, and evidence from server-owned state.

**Architecture:** Add a pure `studio` projection at the existing `buildFullState()` aggregation boundary and allow-list it through `toClientState()`. Normalize delegated-agent lifecycle events at the Pi runtime boundary, then replace the monolithic `/studio3d` document with locally served browser modules: projection model, transport, semantic DOM, Three.js scene, reconciler, and source-driven transitions.

**Tech Stack:** Node.js 18+, ES modules, TypeScript Pi integration, Node test runner through `tsx`, Three.js `0.185.1`, HTML/CSS, WebGL 2, existing Business Hub HTTP/WebSocket server.

## Global Constraints

- The Studio is read-only; state-changing actions remain in the authenticated and audited cockpit.
- Exactly eight mission bays map to the existing Pi lifecycle missions, and exactly fifteen reusable departments map to `CANONICAL_SDLC_STAGES`.
- Unknown, absent, stale, and unsupported data never render as idle, passed, complete, or live.
- Browser code consumes `state.studio`; it does not derive mission or agent semantics from raw run tasks/events.
- Builder/Validator sessions require observed lifecycle evidence or an explicitly labeled `task_derived` identity.
- Skills, plugins, and specialists are capability attachments, not autonomous workers unless a session event identifies them as one.
- Work-object motion occurs only for unseen source-backed lifecycle transitions.
- Three.js is pinned locally at `0.185.1`; no public CDN is required at runtime.
- WebSocket URLs derive from `location.protocol`, `location.host`, and the read-token query context.
- The semantic DOM is the canonical accessibility tree; the canvas is hidden from assistive technology.
- `prefers-reduced-motion`, a persistent motion override, 390px layout, WebGL failure, context loss, stale snapshots, and disconnects have first-class states.
- Baseline: 1,263 tests pass before feature work begins.

---

## File map

### Core and state

- Create `src/core/harness/missions.js`: canonical eight-mission metadata shared by Pi planning and Studio.
- Modify `src/integrations/pi/rstack-sdlc.ts`: consume mission-stage metadata and emit normalized delegated-session lifecycle.
- Create `src/core/harness/agent-lifecycle.js`: lifecycle event names, safe event constructor, terminal-state helpers.
- Create `src/observability/dashboard/state/studio.js`: pure Studio projection and event adaptation.
- Modify `src/observability/dashboard/state/index.js`: attach the Studio projection after shared readiness/actions/run-workspace state exists.
- Modify `src/observability/dashboard/state/client-state.js`: allow-list the compact projection unchanged and continue stripping raw events.

### Browser and server

- Modify `src/observability/dashboard/ui/studio3d.js`: small document shell with local import map and semantic-first markup.
- Create `src/observability/dashboard/ui/studio3d/model.js`: validate snapshots, choose focused run, and compute presentational labels only.
- Create `src/observability/dashboard/ui/studio3d/transport.js`: REST bootstrap, scoped refetch, authenticated same-origin WebSocket, reconnect, freshness.
- Create `src/observability/dashboard/ui/studio3d/dom.js`: run picker, semantic mission/session tree, inspector, timeline, status announcements.
- Create `src/observability/dashboard/ui/studio3d/topology.js`: deterministic coordinates for HQ, eight missions, fifteen departments, governance, validator, and vault.
- Create `src/observability/dashboard/ui/studio3d/geometry.js`: pooled materials/geometries and reusable architectural/session objects.
- Create `src/observability/dashboard/ui/studio3d/scene.js`: renderer, camera, selection, quality tiers, context handling, cleanup.
- Create `src/observability/dashboard/ui/studio3d/reconciler.js`: stable entity registry and snapshot diff.
- Create `src/observability/dashboard/ui/studio3d/transitions.js`: unseen-event transition queue and reduced-motion behavior.
- Create `src/observability/dashboard/ui/studio3d/app.js`: composition root that keeps DOM and scene selection synchronized.
- Create `src/observability/dashboard/ui/studio3d/styles.css`: desktop, compact, 390px, focus, stale, and reduced-motion presentation.
- Modify `src/observability/dashboard/server.js`: exact allow-list for Studio modules, CSS, and local Three.js files.
- Modify `package.json` and `package-lock.json`: exact Three.js dependency.

### Tests

- Create `tests/harness-missions.test.js`.
- Create `tests/dashboard-studio-projection.test.js`.
- Create `tests/agent-lifecycle.test.js`.
- Modify `tests/harness-validator-sandbox-hook.test.js`.
- Replace Studio-specific assertions in `tests/dashboard-stage-meta.test.js` with shell/module contract assertions.
- Create `tests/dashboard-studio-assets.test.js`.
- Create `tests/dashboard-studio-browser-model.test.js`.
- Create `tests/dashboard-studio-responsive.test.js`.

---

### Task 1: Canonical mission topology

**Files:**
- Create: `src/core/harness/missions.js`
- Modify: `src/integrations/pi/rstack-sdlc.ts:241-323`
- Test: `tests/harness-missions.test.js`

**Interfaces:**
- Consumes: `CANONICAL_SDLC_STAGES` from `src/core/harness/stages.js`.
- Produces: `RSTACK_MISSIONS`, `MISSION_STAGE_IDS`, and `getRstackMission(id)`.

- [ ] **Step 1: Write the failing topology test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { CANONICAL_SDLC_STAGES } from '../src/core/harness/stages.js';
import { RSTACK_MISSIONS, MISSION_STAGE_IDS, getRstackMission } from '../src/core/harness/missions.js';

test('eight missions reuse all fifteen canonical departments without copies', () => {
  assert.equal(RSTACK_MISSIONS.length, 8);
  assert.deepEqual(RSTACK_MISSIONS.map((mission) => mission.id), [
    '001-product-clarification', '002-requirements', '003-architecture', '004-implementation',
    '005-testing', '006-security-review', '007-documentation', '008-release-readiness',
  ]);
  const canonical = new Set(CANONICAL_SDLC_STAGES.map((stage) => stage.id));
  const used = new Set(RSTACK_MISSIONS.flatMap((mission) => mission.stageIds));
  assert.deepEqual(used, canonical);
  assert.deepEqual(MISSION_STAGE_IDS['003-architecture'], ['06-architecture', '12-security-threat-model', '14-cost-estimation']);
  assert.deepEqual(MISSION_STAGE_IDS['006-security-review'], ['12-security-threat-model', '13-compliance-checker']);
  assert.equal(getRstackMission('missing'), null);
});
```

- [ ] **Step 2: Run the test and verify the missing-module failure**

Run: `npx tsx --test tests/harness-missions.test.js`

Expected: FAIL with `Cannot find module '../src/core/harness/missions.js'`.

- [ ] **Step 3: Add the immutable mission module**

```js
import { CANONICAL_SDLC_STAGES } from './stages.js';

const definitions = [
  ['001-product-clarification', 'Product clarification', ['product', 'docs'], ['00-environment', '01-transcript']],
  ['002-requirements', 'Requirements and acceptance criteria', ['product', 'sdlc'], ['02-requirements', '04-planning', '05-jira']],
  ['003-architecture', 'Architecture and technical design', ['backend', 'frontend', 'devops', 'data', 'security'], ['06-architecture', '12-security-threat-model', '14-cost-estimation']],
  ['004-implementation', 'Implementation', ['backend', 'frontend', 'data'], ['07-code']],
  ['005-testing', 'Testing and QA', ['qa'], ['08-testing']],
  ['006-security-review', 'Security review', ['security', 'backend', 'devops'], ['12-security-threat-model', '13-compliance-checker']],
  ['007-documentation', 'Documentation', ['docs', 'product'], ['03-documentation', '10-summary']],
  ['008-release-readiness', 'Release readiness', ['devops', 'qa', 'docs', 'security'], ['09-deployment', '10-summary', '11-feedback-loop']],
];

const canonicalIds = new Set(CANONICAL_SDLC_STAGES.map((stage) => stage.id));
export const RSTACK_MISSIONS = Object.freeze(definitions.map(([id, title, domains, stageIds], order) => {
  if (stageIds.some((stageId) => !canonicalIds.has(stageId))) throw new Error(`Mission ${id} references an unknown stage`);
  return Object.freeze({ id, title, domains: Object.freeze(domains), stageIds: Object.freeze(stageIds), order });
}));
export const MISSION_STAGE_IDS = Object.freeze(Object.fromEntries(RSTACK_MISSIONS.map((mission) => [mission.id, mission.stageIds])));
export function getRstackMission(id) { return RSTACK_MISSIONS.find((mission) => mission.id === id) ?? null; }
```

In `rstack-sdlc.ts`, import `MISSION_STAGE_IDS` and replace each literal `stageIds` array in `lifecycleStages` with `stageIds: [...MISSION_STAGE_IDS['mission-id']]`.

- [ ] **Step 4: Run mission and stage tests**

Run: `npx tsx --test tests/harness-missions.test.js tests/dashboard-stage-meta.test.js`

Expected: PASS with eight missions, all canonical stage metadata tests unchanged.

- [ ] **Step 5: Commit the topology checkpoint**

```bash
git add src/core/harness/missions.js src/integrations/pi/rstack-sdlc.ts tests/harness-missions.test.js
git commit -m "refactor: centralize RStack mission topology"
```

---

### Task 2: Pure server-owned Studio projection

**Files:**
- Create: `src/observability/dashboard/state/studio.js`
- Test: `tests/dashboard-studio-projection.test.js`

**Interfaces:**
- Consumes: `buildStudioProjection(state, { evaluatedAt })` input containing scoped `runs`, `scope`, `readiness`, `actions`, `approvals`, `blockedGates`, `evidenceCenter`, and `runWorkspaces`.
- Produces: `buildStudioProjection(state, options) -> StudioProjection` and exported `STUDIO_SCHEMA_VERSION = 1`.

- [ ] **Step 1: Write failing projection fixtures**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStudioProjection } from '../src/observability/dashboard/state/studio.js';

const NOW = '2026-07-13T10:00:00.000Z';
function stateWith(task, events = []) {
  return {
    ts: NOW,
    scope: { type: 'run', runKey: 'project::run-1', projectId: 'project' },
    runs: [{ runId: 'run-1', projectId: 'project', projectRoot: '/repo', manifest: { goal: 'Ship Studio', updated_at: NOW }, derivedStatus: 'active', tasks: [task], events, stageReports: [], timeline: [] }],
    readiness: { state: 'unknown', evaluatedAt: NOW, source: 'readiness' },
    actions: [], approvals: [], blockedGates: [], evidenceCenter: { items: [] }, runWorkspaces: [],
  };
}

test('projection exposes eight missions, fifteen shared departments, and task-derived confidence', () => {
  const studio = buildStudioProjection(stateWith({
    id: '003-architecture', title: 'Architecture', status: 'IN_PROGRESS',
    stage_artifacts: [{ stage_id: '06-architecture' }, { stage_id: '12-security-threat-model' }, { stage_id: '14-cost-estimation' }],
    specialists: ['specialist.backend.api'], pipeline_agents: ['agent.06-architecture'],
  }), { evaluatedAt: NOW });
  assert.equal(studio.schema_version, 1);
  assert.equal(studio.missions.length, 8);
  assert.equal(studio.departments.length, 15);
  assert.equal(studio.departments.filter((item) => item.id === '12-security-threat-model').length, 1);
  assert.equal(studio.sessions[0].identity_confidence, 'task_derived');
  assert.equal(studio.sessions[0].role, 'builder');
  assert.deepEqual(studio.sessions[0].specialist_ids, ['specialist.backend.api']);
});

test('observed lifecycle wins and unknown data remains unavailable', () => {
  const events = [
    { type: 'agent_session_started', agent_session_id: 'session-1', delegation_id: 'delegation-1', task_id: '003-architecture', stage_ids: ['06-architecture'], role: 'validator', timestamp: '2026-07-13T09:59:00.000Z' },
    { type: 'agent_waiting', agent_session_id: 'session-1', reason_class: 'approval', timestamp: '2026-07-13T09:59:30.000Z' },
  ];
  const studio = buildStudioProjection(stateWith({ id: '003-architecture', title: 'Architecture', status: 'BLOCKED', stage_artifacts: [] }, events), { evaluatedAt: NOW });
  assert.equal(studio.sessions[0].identity_confidence, 'observed');
  assert.equal(studio.sessions[0].status, 'waiting');
  assert.equal(studio.sessions[0].role, 'validator');
  assert.equal(studio.availability, 'partial');
  assert.ok(studio.limitations.some((item) => item.code === 'partial_lifecycle_coverage'));
});
```

- [ ] **Step 2: Run the test and verify the missing-module failure**

Run: `npx tsx --test tests/dashboard-studio-projection.test.js`

Expected: FAIL because `state/studio.js` does not exist.

- [ ] **Step 3: Implement the projection with deterministic helpers**

Create `studio.js` with these exports and status rules:

```js
import { CANONICAL_SDLC_STAGES } from '../../../core/harness/stages.js';
import { RSTACK_MISSIONS } from '../../../core/harness/missions.js';

export const STUDIO_SCHEMA_VERSION = 1;
const TERMINAL_SESSION_EVENTS = new Map([
  ['agent_session_completed', 'completed'], ['agent_session_failed', 'failed'], ['agent_session_stopped', 'stopped'],
]);
const TASK_STATES = Object.freeze({ PENDING: 'queued', READY: 'queued', IN_PROGRESS: 'active', BLOCKED: 'blocked', FAIL: 'failed', PASS: 'completed' });

export function buildStudioProjection(state, { evaluatedAt = state?.ts ?? new Date().toISOString() } = {}) {
  const run = chooseRun(state?.runs ?? []);
  if (!run) return emptyStudio(state, evaluatedAt);
  const taskById = new Map((run.tasks ?? []).map((task) => [task.id, task]));
  const events = [...(run.events ?? [])].sort(eventOrder);
  const sessions = buildObservedSessions(events, taskById);
  addTaskDerivedSessions(sessions, run.tasks ?? []);
  const missions = RSTACK_MISSIONS.map((mission) => missionView(mission, taskById.get(mission.id), sessions, run));
  const departments = CANONICAL_SDLC_STAGES.map((stage) => departmentView(stage, missions));
  const latestSourceTime = latestTimestamp(run, events);
  const observedCount = sessions.filter((session) => session.identity_confidence === 'observed').length;
  return {
    schema_version: STUDIO_SCHEMA_VERSION,
    generated_at: evaluatedAt,
    availability: observedCount > 0 ? 'available' : 'partial',
    freshness: freshness(latestSourceTime, evaluatedAt),
    scope: { project_id: run.projectId ?? null, run_id: run.runId, source: 'run-state' },
    orchestrator: { id: `orchestrator:${run.runId}`, goal: run.manifest?.goal ?? null, status: run.derivedStatus ?? 'unknown', next_action: sourceNextAction(state, run.runId) },
    missions, departments,
    sessions: [...sessions.values()].sort(byStartedThenId),
    capability_attachments: capabilityAttachments(sessions),
    work_objects: workObjects(events, run),
    governance_items: governanceItems(state, run.runId),
    evidence_items: evidenceItems(state, run),
    timeline: studioTimeline(events, run),
    limitations: observedCount > 0 ? [] : [{ code: 'partial_lifecycle_coverage', message: 'Agent sessions are derived from task state because normalized lifecycle events are unavailable.' }],
  };
}
```

Implement the named private helpers in the same file. They must use stable IDs, preserve event timestamps, cap timeline/evidence/work objects at 120/80/120, mark task fallbacks `task_derived`, and return `unknown` when timestamps or statuses are absent. Do not copy raw command input, prompt text, stderr, or unrestricted paths into any Studio item.

- [ ] **Step 4: Add no-data, terminal, duplicate-event, and secret-redaction cases**

Extend the test file with assertions that an empty state returns `availability: 'unavailable'`, replayed lifecycle events produce one session, a terminal event overrides waiting, `12-security-threat-model` remains one department, and serialized output excludes `input`, `stderr`, `prompt`, `RSTACK_APPROVAL_TOKEN`, and `/repo/.env`.

- [ ] **Step 5: Run focused projection tests**

Run: `npx tsx --test tests/dashboard-studio-projection.test.js`

Expected: PASS; deterministic output for all fixtures.

- [ ] **Step 6: Commit the projection checkpoint**

```bash
git add src/observability/dashboard/state/studio.js tests/dashboard-studio-projection.test.js
git commit -m "feat: add server-owned Studio projection"
```

---

### Task 3: Attach and allow-list the projection

**Files:**
- Modify: `src/observability/dashboard/state/index.js:180-215`
- Modify: `src/observability/dashboard/state/client-state.js:145-230`
- Modify: `tests/dashboard-studio-projection.test.js`

**Interfaces:**
- Consumes: `buildStudioProjection(stateWithRunWorkspaces, { evaluatedAt })` from Task 2.
- Produces: `buildFullState(...).studio` and `toClientState(...).studio` with no raw-event dependency in the browser.

- [ ] **Step 1: Write the failing integration assertion**

```js
test('full and client states share the exact Studio projection and strip raw events', async () => {
  const full = await buildFullState(root, { now: new Date(NOW), sourceRoots: [root] });
  const client = toClientState(full);
  assert.deepEqual(client.studio, full.studio);
  assert.ok(client.studio.missions.length === 8);
  assert.ok(client.runs.every((run) => !Object.hasOwn(run, 'events')));
});
```

- [ ] **Step 2: Run the test and verify `studio` is absent**

Run: `npx tsx --test tests/dashboard-studio-projection.test.js`

Expected: FAIL because `buildFullState()` does not attach `studio`.

- [ ] **Step 3: Attach projection after Run Workspaces**

```js
import { buildStudioProjection } from './studio.js';

const stateWithStudio = {
  ...stateWithRunWorkspaces,
  studio: buildStudioProjection(stateWithRunWorkspaces, { evaluatedAt: baseState.ts }),
};
return { ...stateWithStudio, layers: buildLayerSummaries(stateWithStudio) };
```

In `toClientState()`, explicitly assign `studio: state.studio ?? null` in the return object. Keep the existing run-event stripping unchanged.

- [ ] **Step 4: Run projection, parity, and scope tests**

Run: `npx tsx --test tests/dashboard-studio-projection.test.js tests/dashboard-index-parity.test.js tests/dashboard-scope-state.test.js`

Expected: PASS.

- [ ] **Step 5: Commit the state-boundary checkpoint**

```bash
git add src/observability/dashboard/state/index.js src/observability/dashboard/state/client-state.js tests/dashboard-studio-projection.test.js
git commit -m "feat: expose compact Studio state to clients"
```

---

### Task 4: Normalized delegated-agent lifecycle

**Files:**
- Create: `src/core/harness/agent-lifecycle.js`
- Modify: `src/integrations/pi/rstack-sdlc.ts:1083-1155`
- Create: `tests/agent-lifecycle.test.js`
- Modify: `tests/harness-validator-sandbox-hook.test.js:115-160`

**Interfaces:**
- Produces: `AGENT_LIFECYCLE_TYPES`, `agentLifecycleEvent(type, fields, options)`, `isTerminalAgentLifecycle(type)`.
- Pi emits safe persisted events without changing the return shape of `sdlc_delegate`.

- [ ] **Step 1: Write lifecycle-constructor failures first**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { AGENT_LIFECYCLE_TYPES, agentLifecycleEvent, isTerminalAgentLifecycle } from '../src/core/harness/agent-lifecycle.js';

test('agent lifecycle constructor allow-lists fields and normalizes ids', () => {
  const event = agentLifecycleEvent('agent_session_started', {
    run_id: 'run-1', task_id: '004-implementation', stage_ids: ['07-code', '../secret'],
    agent_session_id: 'session-1', delegation_id: 'delegation-1', role: 'builder', harness: 'pi',
    model: 'model-a', sandbox_id: '/private/worktree', prompt: 'secret', stderr: 'secret',
  }, { now: '2026-07-13T10:00:00.000Z' });
  assert.equal(event.type, 'agent_session_started');
  assert.deepEqual(event.stage_ids, ['07-code']);
  assert.equal(event.sandbox_id, 'worktree');
  assert.ok(!Object.hasOwn(event, 'prompt'));
  assert.ok(!Object.hasOwn(event, 'stderr'));
  assert.equal(AGENT_LIFECYCLE_TYPES.size, 11);
  assert.equal(isTerminalAgentLifecycle('agent_session_failed'), true);
});
```

- [ ] **Step 2: Run and verify the missing-module failure**

Run: `npx tsx --test tests/agent-lifecycle.test.js`

Expected: FAIL because `agent-lifecycle.js` does not exist.

- [ ] **Step 3: Implement the lifecycle allow-list**

```js
const TYPES = [
  'delegation_requested', 'agent_session_started', 'agent_session_ready', 'agent_capabilities_attached',
  'agent_activity', 'agent_waiting', 'handoff_created', 'artifact_emitted',
  'agent_session_completed', 'agent_session_failed', 'agent_session_stopped',
];
export const AGENT_LIFECYCLE_TYPES = new Set(TYPES);
const TERMINAL = new Set(['agent_session_completed', 'agent_session_failed', 'agent_session_stopped']);
const FIELDS = ['run_id', 'task_id', 'stage_ids', 'delegation_id', 'agent_session_id', 'agent_id', 'role', 'harness', 'model', 'sandbox_id', 'specialist_ids', 'skill_ids', 'plugin_ids', 'status', 'activity_class', 'reason_class', 'summary', 'source'];
const safeId = (value) => typeof value === 'string' && /^[a-zA-Z0-9._:@-]{1,160}$/.test(value) ? value : null;

export function agentLifecycleEvent(type, fields = {}, { now = new Date().toISOString() } = {}) {
  if (!AGENT_LIFECYCLE_TYPES.has(type)) throw new TypeError(`Unknown agent lifecycle event: ${type}`);
  const event = { type, timestamp: now };
  for (const key of FIELDS) {
    if (fields[key] === undefined || fields[key] === null) continue;
    if (key.endsWith('_ids') || key === 'stage_ids') event[key] = [...new Set(fields[key].map(safeId).filter(Boolean))].slice(0, 32);
    else if (key === 'summary') event[key] = String(fields[key]).replace(/[\r\n]+/g, ' ').slice(0, 240);
    else if (key === 'sandbox_id') event[key] = String(fields[key]).split(/[\\/]/).filter(Boolean).at(-1)?.slice(0, 120) ?? null;
    else event[key] = safeId(fields[key]);
  }
  return Object.fromEntries(Object.entries(event).filter(([, value]) => value !== null));
}
export function isTerminalAgentLifecycle(type) { return TERMINAL.has(type); }
```

- [ ] **Step 4: Add Pi emission assertions to the existing fake-worker test**

After each `sdlc_delegate.execute`, read `events.jsonl` and assert the same `delegation_id` and `agent_session_id` join this ordered subsequence:

```js
assert.deepEqual(lifecycle.map((event) => event.type), [
  'delegation_requested', 'agent_session_started', 'agent_session_ready',
  'agent_capabilities_attached', 'agent_session_completed', 'agent_session_stopped',
]);
assert.equal(lifecycle.find((event) => event.type === 'agent_session_started').role, 'validator');
assert.deepEqual(lifecycle.find((event) => event.type === 'agent_capabilities_attached').skill_ids, []);
```

Make the fake worker exit `7` for one delegation and assert `agent_session_failed` followed by `agent_session_stopped`.

- [ ] **Step 5: Emit lifecycle around the Pi subprocess**

Import `randomUUID` from `node:crypto`, `agentLifecycleEvent`, and mission lookup. Resolve the active task once. Before spawn append `delegation_requested`; immediately after `spawn()` append `agent_session_started`, `agent_session_ready`, and `agent_capabilities_attached`; after close append completed/failed; in `finally` append stopped. Use one generated delegation/session pair and fields:

```ts
const lifecycleBase = {
  run_id: runId,
  task_id: activeTask?.id ?? null,
  stage_ids: taskStageIds(activeTask ?? {}),
  delegation_id: `delegation-${randomUUID()}`,
  agent_session_id: `session-${randomUUID()}`,
  agent_id: agent.id,
  role: validatorRole ? 'validator' : 'builder',
  harness: 'pi', model,
  sandbox_id: task.cwd || projectRoot,
  specialist_ids: activeTask?.specialists ?? [],
  skill_ids: [], plugin_ids: [],
};
```

Persist lifecycle only when `runId` exists. Await pending event writes before returning, and preserve the current delegation result object exactly.

- [ ] **Step 6: Run lifecycle, sandbox, and signature tests**

Run: `npx tsx --test tests/agent-lifecycle.test.js tests/harness-validator-sandbox-hook.test.js tests/harness-checkpoints-signatures.test.js`

Expected: PASS; validator policies and delegate result signatures remain unchanged.

- [ ] **Step 7: Commit lifecycle telemetry**

```bash
git add src/core/harness/agent-lifecycle.js src/integrations/pi/rstack-sdlc.ts tests/agent-lifecycle.test.js tests/harness-validator-sandbox-hook.test.js
git commit -m "feat: persist delegated agent lifecycle"
```

---

### Task 5: Local Three.js runtime and exact static routes

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/observability/dashboard/server.js:991-1115`
- Create: `tests/dashboard-studio-assets.test.js`

**Interfaces:**
- Produces read-only GET routes `/studio3d/assets/<allow-listed-file>` and `/studio3d/vendor/<allow-listed-file>`.
- The allow-list maps URL paths to exact files; no user-provided filesystem path is resolved.

- [ ] **Step 1: Write failing real-server asset tests**

```js
test('Studio serves local Three.js and rejects unlisted paths', async () => {
  const html = await (await fetch(`${server.baseUrl}/studio3d`)).text();
  assert.doesNotMatch(html, /https?:\/\/(unpkg|cdn|jsdelivr)/);
  assert.match(html, /"three":"\/studio3d\/vendor\/three\.module\.js"/);
  const three = await fetch(`${server.baseUrl}/studio3d/vendor/three.module.js`);
  assert.equal(three.status, 200);
  assert.match(three.headers.get('content-type'), /javascript/);
  assert.equal((await fetch(`${server.baseUrl}/studio3d/vendor/..%2F..%2Fpackage.json`)).status, 404);
  assert.equal((await fetch(`${server.baseUrl}/studio3d/assets/missing.js`)).status, 404);
});
```

- [ ] **Step 2: Run and verify the route failure**

Run: `npx tsx --test tests/dashboard-studio-assets.test.js`

Expected: FAIL because local vendor and module routes return the dashboard document or 404.

- [ ] **Step 3: Pin Three.js and refresh the lockfile**

Add `"three": "0.185.1"` to `dependencies` in `package.json` with `apply_patch`, then run:

Run: `npm install --package-lock-only --ignore-scripts`

Expected: `package-lock.json` contains `node_modules/three` version `0.185.1` and no unrelated dependency updates.

- [ ] **Step 4: Add an exact static allow-list**

Add `import { fileURLToPath } from 'node:url';` beside the server's Node imports, then define:

```js
const DASHBOARD_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(DASHBOARD_DIR, '../../..');
const STUDIO_STATIC = new Map([
  ['/studio3d/assets/app.js', { path: join(DASHBOARD_DIR, 'ui/studio3d/app.js'), type: 'text/javascript; charset=utf-8' }],
  ['/studio3d/assets/model.js', { path: join(DASHBOARD_DIR, 'ui/studio3d/model.js'), type: 'text/javascript; charset=utf-8' }],
  ['/studio3d/assets/transport.js', { path: join(DASHBOARD_DIR, 'ui/studio3d/transport.js'), type: 'text/javascript; charset=utf-8' }],
  ['/studio3d/assets/dom.js', { path: join(DASHBOARD_DIR, 'ui/studio3d/dom.js'), type: 'text/javascript; charset=utf-8' }],
  ['/studio3d/assets/topology.js', { path: join(DASHBOARD_DIR, 'ui/studio3d/topology.js'), type: 'text/javascript; charset=utf-8' }],
  ['/studio3d/assets/geometry.js', { path: join(DASHBOARD_DIR, 'ui/studio3d/geometry.js'), type: 'text/javascript; charset=utf-8' }],
  ['/studio3d/assets/scene.js', { path: join(DASHBOARD_DIR, 'ui/studio3d/scene.js'), type: 'text/javascript; charset=utf-8' }],
  ['/studio3d/assets/reconciler.js', { path: join(DASHBOARD_DIR, 'ui/studio3d/reconciler.js'), type: 'text/javascript; charset=utf-8' }],
  ['/studio3d/assets/transitions.js', { path: join(DASHBOARD_DIR, 'ui/studio3d/transitions.js'), type: 'text/javascript; charset=utf-8' }],
  ['/studio3d/assets/styles.css', { path: join(DASHBOARD_DIR, 'ui/studio3d/styles.css'), type: 'text/css; charset=utf-8' }],
  ['/studio3d/vendor/three.module.js', { path: join(PACKAGE_ROOT, 'node_modules/three/build/three.module.js'), type: 'text/javascript; charset=utf-8' }],
  ['/studio3d/vendor/OrbitControls.js', { path: join(PACKAGE_ROOT, 'node_modules/three/examples/jsm/controls/OrbitControls.js'), type: 'text/javascript; charset=utf-8' }],
]);
```

Before the `/studio3d` HTML route, return only exact map matches using `readFile`; set `Cache-Control: public, max-age=3600` for vendor and `no-cache` for app assets. Return 404 for any other `/studio3d/assets/` or `/studio3d/vendor/` path.

- [ ] **Step 5: Run asset and server-hardening tests**

Run: `npx tsx --test tests/dashboard-studio-assets.test.js tests/dashboard-server-hardening.test.js tests/dashboard-read-auth.test.js`

Expected: PASS; existing read auth and ETag behavior remain unchanged.

- [ ] **Step 6: Commit local asset delivery**

```bash
git add package.json package-lock.json src/observability/dashboard/server.js tests/dashboard-studio-assets.test.js
git commit -m "feat: serve Studio 3D runtime locally"
```

---

### Task 6: Semantic-first Studio shell, model, and transport

**Files:**
- Modify: `src/observability/dashboard/ui/studio3d.js`
- Create: `src/observability/dashboard/ui/studio3d/model.js`
- Create: `src/observability/dashboard/ui/studio3d/transport.js`
- Create: `src/observability/dashboard/ui/studio3d/app.js`
- Modify: `tests/dashboard-stage-meta.test.js`
- Create: `tests/dashboard-studio-browser-model.test.js`

**Interfaces:**
- `validateStudioSnapshot(snapshot) -> { ok, studio, error }`.
- `createStudioTransport({ onSnapshot, onConnection, fetchImpl, WebSocketImpl, location }) -> { start, selectRun, stop }`.
- `studio3dHtml() -> string`; port is no longer embedded in browser transport.

- [ ] **Step 1: Write shell and pure-model failures**

```js
test('Studio shell is semantic-first and same-origin', () => {
  const html = studio3dHtml();
  assert.match(html, /<main id="studio-app"/);
  assert.match(html, /<canvas id="studio-canvas" aria-hidden="true"/);
  assert.match(html, /<section id="semantic-studio"/);
  assert.match(html, /<div id="studio-announcer"[^>]+aria-live="polite"/);
  assert.match(html, /\/studio3d\/assets\/app\.js/);
  assert.doesNotMatch(html, /localhost|unpkg|new WebSocket\('ws:/);
});

test('snapshot validator fails closed', () => {
  assert.deepEqual(validateStudioSnapshot({}), { ok: false, studio: null, error: 'Studio projection unavailable' });
  const valid = validateStudioSnapshot({ studio: { schema_version: 1, missions: [], departments: [], sessions: [], timeline: [] } });
  assert.equal(valid.ok, true);
});

test('transport derives secure WebSocket and preserves token', () => {
  assert.equal(webSocketUrl({ protocol: 'https:', host: 'hub.example', search: '?token=abc' }), 'wss://hub.example/?token=abc');
  assert.equal(webSocketUrl({ protocol: 'http:', host: '127.0.0.1:3008', search: '' }), 'ws://127.0.0.1:3008/');
});
```

- [ ] **Step 2: Run and verify model/shell failures**

Run: `npx tsx --test tests/dashboard-stage-meta.test.js tests/dashboard-studio-browser-model.test.js`

Expected: FAIL because the model/transport modules are absent and the old shell embeds localhost/CDN behavior.

- [ ] **Step 3: Replace `studio3dHtml` with a small document shell**

The shell must contain top rail, canvas region, semantic view, inspector dialog/sheet, timeline, announcer, fallback, motion control, and this local import map:

```html
<script type="importmap">{"imports":{"three":"/studio3d/vendor/three.module.js","three/addons/":"/studio3d/vendor/"}}</script>
<script type="module" src="/studio3d/assets/app.js"></script>
```

Remove injected personas and port. Update the stage-meta test to assert canonical stages remain tested in `stage-meta.js` while the Studio consumes `state.studio.departments`.

- [ ] **Step 4: Implement pure validation and URL helpers**

```js
export function validateStudioSnapshot(snapshot) {
  const studio = snapshot?.studio;
  const valid = studio?.schema_version === 1
    && Array.isArray(studio.missions) && Array.isArray(studio.departments)
    && Array.isArray(studio.sessions) && Array.isArray(studio.timeline);
  return valid ? { ok: true, studio, error: null } : { ok: false, studio: null, error: 'Studio projection unavailable' };
}
export function webSocketUrl(locationLike) {
  const protocol = locationLike.protocol === 'https:' ? 'wss:' : 'ws:';
  const token = new URLSearchParams(locationLike.search ?? '').get('token');
  return `${protocol}//${locationLike.host}/${token ? `?token=${encodeURIComponent(token)}` : ''}`;
}
```

`createStudioTransport` fetches `/api/state` first, opens the derived socket, ignores duplicate `generated_at` snapshots, reconnects with delays `[1000, 2000, 5000, 10000]`, refetches `/api/state?run=<opaque-key>` on selection, and reports `connecting | live | stale | disconnected | error`. `stop()` clears timers and closes the socket.

- [ ] **Step 5: Add `app.js` semantic boot path**

`app.js` must render the semantic projection immediately after REST, then dynamically import `scene.js` only when WebGL 2 is available and semantic-only mode is not selected. A 3D load failure must set `data-renderer="semantic"` and leave DOM facts usable.

- [ ] **Step 6: Run shell/model tests**

Run: `npx tsx --test tests/dashboard-stage-meta.test.js tests/dashboard-studio-browser-model.test.js tests/dashboard-studio-assets.test.js`

Expected: PASS with no CDN or hard-coded socket.

- [ ] **Step 7: Commit the semantic bootstrap**

```bash
git add src/observability/dashboard/ui/studio3d.js src/observability/dashboard/ui/studio3d/model.js src/observability/dashboard/ui/studio3d/transport.js src/observability/dashboard/ui/studio3d/app.js tests/dashboard-stage-meta.test.js tests/dashboard-studio-browser-model.test.js
git commit -m "feat: add semantic-first Studio bootstrap"
```

---

### Task 7: Accessible operational DOM and responsive layout

**Files:**
- Create: `src/observability/dashboard/ui/studio3d/dom.js`
- Create: `src/observability/dashboard/ui/studio3d/styles.css`
- Modify: `src/observability/dashboard/ui/studio3d/app.js`
- Create: `tests/dashboard-studio-responsive.test.js`

**Interfaces:**
- `createStudioDom(root, callbacks) -> { render(snapshot), select(id), setConnection(state), destroy() }`.
- Selection callback shape: `{ kind: 'orchestrator'|'mission'|'department'|'session'|'governance'|'evidence', id }`.

- [ ] **Step 1: Write failing DOM-contract assertions**

```js
test('responsive stylesheet preserves semantic controls at 390px', () => {
  assert.match(css, /@media\s*\(max-width:\s*600px\)/);
  assert.match(css, /#semantic-studio\s*\{[^}]*display:/s);
  assert.match(css, /\.studio-inspector[^}]*inset:/s);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.doesNotMatch(css, /width:\s*380px/);
});

test('DOM renderer exposes keyboard buttons and source metadata', () => {
  const source = readFileSync(domPath, 'utf8');
  assert.match(source, /data-entity-kind/);
  assert.match(source, /aria-current/);
  assert.match(source, /identity_confidence/);
  assert.match(source, /freshness/);
});
```

- [ ] **Step 2: Run and verify absent DOM/CSS modules**

Run: `npx tsx --test tests/dashboard-studio-responsive.test.js`

Expected: FAIL because the files do not exist.

- [ ] **Step 3: Implement DOM rendering with safe text nodes**

Use `document.createElement`, `textContent`, and explicit attributes; do not insert projection values with `innerHTML`. Render:

- run/source/freshness top rail;
- orchestrator next action;
- ordered mission buttons with state text and counts;
- department list grouped under missions but keyed to unique department IDs;
- session list with role, confidence, harness/model availability, task, waiting reason, and capabilities;
- governance and evidence lists;
- timeline with timestamp, source, and event class;
- inspector with matching source fields and existing safe deep links.

Only new blocker/failure/human-action/handoff IDs enter the polite live region. `select()` sets `aria-current`, opens inspector, and focuses its heading; closing restores focus to the triggering button.

- [ ] **Step 4: Implement responsive and reduced-motion CSS**

Desktop uses a top rail, full scene, right inspector, and bottom timeline. At `max-width: 900px`, inspector becomes overlay. At `max-width: 600px`, semantic view is primary, canvas is limited to a 220px optional overview, inspector becomes a full-width bottom sheet, and the page has `overflow-x: clip`. Provide visible `:focus-visible`, non-color state icons, minimum 44px controls, `[data-motion="reduced"]` overrides, and the system media query.

- [ ] **Step 5: Connect DOM selection and persistent motion preference**

In `app.js`, persist only `rstack.studio.motion = 'full'|'reduced'`; system preference is the default when no override exists. Pass selection events to the future scene API and scene selections back to `dom.select()`.

- [ ] **Step 6: Run responsive, shell, and accessibility contract tests**

Run: `npx tsx --test tests/dashboard-studio-responsive.test.js tests/dashboard-studio-browser-model.test.js tests/dashboard-stage-meta.test.js`

Expected: PASS.

- [ ] **Step 7: Commit the accessible UI**

```bash
git add src/observability/dashboard/ui/studio3d/dom.js src/observability/dashboard/ui/studio3d/styles.css src/observability/dashboard/ui/studio3d/app.js tests/dashboard-studio-responsive.test.js
git commit -m "feat: build accessible responsive Studio UI"
```

---

### Task 8: Modular Three.js company floor and reconciler

**Files:**
- Create: `src/observability/dashboard/ui/studio3d/topology.js`
- Create: `src/observability/dashboard/ui/studio3d/geometry.js`
- Create: `src/observability/dashboard/ui/studio3d/scene.js`
- Create: `src/observability/dashboard/ui/studio3d/reconciler.js`
- Modify: `tests/dashboard-studio-browser-model.test.js`

**Interfaces:**
- `STUDIO_TOPOLOGY` contains deterministic coordinates keyed by semantic IDs.
- `createStudioScene(canvas, options) -> { reconcile(studio), select(ref), setMotion(mode), diagnostics(), destroy() }`.
- `createEntityReconciler(sceneFactories) -> { apply(projection), get(ref), clear() }`.

- [ ] **Step 1: Write topology and module-contract failures**

```js
test('topology has one HQ, eight mission bays, and fifteen unique departments', async () => {
  assert.deepEqual(STUDIO_TOPOLOGY.orchestrator.id, 'orchestrator-hq');
  assert.equal(STUDIO_TOPOLOGY.missions.length, 8);
  assert.equal(new Set(STUDIO_TOPOLOGY.missions.map((item) => item.id)).size, 8);
  assert.equal(STUDIO_TOPOLOGY.departments.length, 15);
  assert.equal(new Set(STUDIO_TOPOLOGY.departments.map((item) => item.id)).size, 15);
  assert.notDeepEqual(STUDIO_TOPOLOGY.validator.position, STUDIO_TOPOLOGY.builderPool.position);
});

test('scene module exposes reconciliation, selection, diagnostics, and cleanup', () => {
  const source = readFileSync(scenePath, 'utf8');
  for (const name of ['reconcile', 'select', 'setMotion', 'diagnostics', 'destroy']) assert.match(source, new RegExp(`${name}\\b`));
  assert.match(source, /webglcontextlost/);
  assert.match(source, /webglcontextrestored/);
  assert.match(source, /setAnimationLoop/);
});
```

- [ ] **Step 2: Run and verify absent 3D modules**

Run: `npx tsx --test tests/dashboard-studio-browser-model.test.js`

Expected: FAIL because topology and scene modules do not exist.

- [ ] **Step 3: Add deterministic topology**

Use an elliptical mission ring around HQ, a lower department ring, Builder pool beside active bays, Validator Lab at the opposite edge, Governance Deck above HQ, and Evidence Vault behind HQ. Export frozen `{ id, position:[x,y,z], rotation:[x,y,z] }` records. Mission IDs come from literal stable IDs matching `RSTACK_MISSIONS`; department IDs match canonical stage IDs.

- [ ] **Step 4: Add geometry and material pools**

Create shared box/cylinder/plane geometries, status materials for `unknown|queued|active|waiting|blocked|failed|completed`, and factories `createHeadquarters`, `createMissionBay`, `createDepartment`, `createSessionPod`, `createGovernanceDeck`, `createValidatorLab`, `createEvidenceVault`, `createWorkCapsule`. Repeated floor markers, department pylons, and capability modules use `InstancedMesh`. Every factory stamps `userData.entityRef` for raycast selection and exposes `dispose()` only for owned resources.

- [ ] **Step 5: Implement stable reconciliation**

Key entities by `${kind}:${id}`. `apply(projection)` adds missing entities, updates semantic status/material and visible counts, retains unchanged objects, removes ended temporary entities only after their terminal transition is acknowledged, and never recreates the whole scene for a new snapshot.

- [ ] **Step 6: Implement renderer, camera, and failure recovery**

Use `WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })`, clamp pixel ratio to `1.5`, `setAnimationLoop`, bounded `OrbitControls`, raycast selection, and focus/overview camera targets. Pause while hidden, stale/disconnected, or semantic-only. On context loss prevent default and notify `onRendererState('context-lost')`; on restore rebuild GPU resources from the retained projection; after a failed restore notify `semantic-fallback`. `destroy()` clears the loop, controls, observers, entities, pooled resources, and renderer.

- [ ] **Step 7: Run topology and module tests**

Run: `npx tsx --test tests/dashboard-studio-browser-model.test.js tests/dashboard-studio-assets.test.js`

Expected: PASS and every imported module is served by the real server.

- [ ] **Step 8: Commit the 3D floor**

```bash
git add src/observability/dashboard/ui/studio3d/topology.js src/observability/dashboard/ui/studio3d/geometry.js src/observability/dashboard/ui/studio3d/scene.js src/observability/dashboard/ui/studio3d/reconciler.js tests/dashboard-studio-browser-model.test.js
git commit -m "feat: build modular Agent Force company floor"
```

---

### Task 9: Source-driven transitions and performance guardrails

**Files:**
- Create: `src/observability/dashboard/ui/studio3d/transitions.js`
- Modify: `src/observability/dashboard/ui/studio3d/scene.js`
- Modify: `src/observability/dashboard/ui/studio3d/reconciler.js`
- Modify: `src/observability/dashboard/ui/studio3d/app.js`
- Modify: `tests/dashboard-studio-browser-model.test.js`

**Interfaces:**
- `createTransitionScheduler(options) -> { ingest(timeline), tick(time), setMotion(mode), pause(reason), resume(reason), clear() }`.
- Transition identity is `${source}:${event_id || timestamp + ':' + type + ':' + entity_id}`.

- [ ] **Step 1: Write transition idempotency failures**

```js
test('transition scheduler animates unseen source events once', () => {
  const seen = [];
  const values = new Map();
  const memoryStorage = () => ({
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  });
  const scheduler = createTransitionScheduler({ apply: (transition) => seen.push(transition), storage: memoryStorage() });
  const timeline = [{ id: 'event-1', type: 'delegation_requested', timestamp: '2026-07-13T10:00:00.000Z', source: 'events.jsonl', entity_id: 'session-1' }];
  scheduler.ingest(timeline);
  scheduler.tick(0);
  scheduler.ingest(timeline);
  scheduler.tick(16);
  assert.equal(seen.length, 1);
  scheduler.setMotion('reduced');
  scheduler.ingest([{ ...timeline[0], id: 'event-2' }]);
  scheduler.tick(32);
  assert.equal(seen[1].duration_ms, 0);
});
```

- [ ] **Step 2: Run and verify the absent scheduler**

Run: `npx tsx --test tests/dashboard-studio-browser-model.test.js`

Expected: FAIL because `transitions.js` does not exist.

- [ ] **Step 3: Implement event-to-transition mapping**

Map only:

- `delegation_requested` -> HQ-to-mission work capsule;
- `agent_session_started` -> materialize the corresponding pod;
- `agent_capabilities_attached` -> dock capability modules;
- `agent_activity` -> one restrained session pulse;
- `handoff_created` and `artifact_emitted` -> proof capsule to Validator/Vault;
- `agent_waiting`, approval, guardrail, retry exhaustion -> pause route and surface Governance;
- retry scheduled -> return capsule with attempt label;
- terminal session events -> evidence handoff then pod power-down.

Ignore unknown event types. Persist at most 500 seen transition IDs per run in `sessionStorage`, not `localStorage`, so reload does not replay recent work during the same browser session.

- [ ] **Step 4: Add quality-tier monitoring**

Sample frame cost over 120 rendered frames. Tier `high` clamps DPR to 1.5 and enables static shadows; `balanced` clamps to 1.25 and hides distant labels; `low` clamps to 1.0, disables shadows, and uses semantic labels only. Move down one tier when the rolling average exceeds 24ms for two windows; never move up more than once per 30 seconds. `diagnostics()` returns only `{ qualityTier, drawCalls, triangles, geometries, textures }` from `renderer.info`.

- [ ] **Step 5: Wire transport state to motion truth**

In `app.js`, pause the transition scheduler and render loop for `stale`, `disconnected`, `error`, hidden page, semantic-only, or reduced motion. Resume on `live` without replaying already-seen timeline items.

- [ ] **Step 6: Run transition and UI contract tests**

Run: `npx tsx --test tests/dashboard-studio-browser-model.test.js tests/dashboard-studio-responsive.test.js`

Expected: PASS; duplicate snapshots produce one transition and reduced motion produces instant final state.

- [ ] **Step 7: Commit transitions and performance protection**

```bash
git add src/observability/dashboard/ui/studio3d/transitions.js src/observability/dashboard/ui/studio3d/scene.js src/observability/dashboard/ui/studio3d/reconciler.js src/observability/dashboard/ui/studio3d/app.js tests/dashboard-studio-browser-model.test.js
git commit -m "feat: animate source-backed Studio lifecycle"
```

---

### Task 10: End-to-end production verification

**Files:**
- Modify: `tests/dashboard-studio-assets.test.js`
- Modify: `tests/dashboard-studio-responsive.test.js`
- Modify: `docs/superpowers/specs/2026-07-13-agent-force-studio-3d-design.md` only if verified behavior differs from an approved detail.

**Interfaces:**
- Verifies the complete public `/studio3d` route and `/api/state`/WebSocket projection contract.

- [ ] **Step 1: Add full-load deterministic server fixture**

Seed one run with eight mission tasks, observed Builder and Validator sessions, capability attachments, a pending approval, a retry, a failed validation, checkpoints, and evidence. Assert `/api/state` returns `studio.schema_version === 1`, eight missions, fifteen unique departments, observed session identity, governance/evidence items, and no raw events, prompt, stderr, token, or secret path.

- [ ] **Step 2: Run every focused Studio test**

Run: `npx tsx --test tests/harness-missions.test.js tests/agent-lifecycle.test.js tests/dashboard-studio-projection.test.js tests/dashboard-studio-assets.test.js tests/dashboard-studio-browser-model.test.js tests/dashboard-studio-responsive.test.js tests/harness-validator-sandbox-hook.test.js tests/dashboard-stage-meta.test.js`

Expected: PASS.

- [ ] **Step 3: Run static verification**

Run: `npm run lint`

Expected: exit 0.

Run: `npm run typecheck`

Expected: exit 0.

Run: `npm run validate`

Expected: exit 0.

- [ ] **Step 4: Run the complete regression suite**

Run: `npm test`

Expected: all tests pass with zero failures.

- [ ] **Step 5: Run browser verification against the real server**

Start: `RSTACK_NO_BROWSER=1 npm run business -- --port 3018 --project /Users/richardsongunde/projects/SDLC-rstack/.rstack/worktrees/studio-agent-force`

Verify and capture desktop 1440x1000 and mobile 390x844 for: no run, active delegation, selected Validator, approval blocker, evidence handoff, stale/disconnected, reduced motion, WebGL unavailable, and forced context loss. Keyboard-only checks must select a mission, open/close the inspector with focus restoration, change run scope, and reach the same evidence link from semantic view. On the full-load fixture, diagnostics must report at most 90 draw calls and 200,000 triangles in overview.

- [ ] **Step 6: Inspect branch scope and commit verification changes**

Run: `git diff --check`

Expected: no whitespace errors.

Run: `git status --short`

Expected: only intended Studio files and test fixtures are modified.

```bash
git add tests/dashboard-studio-assets.test.js tests/dashboard-studio-responsive.test.js docs/superpowers/specs/2026-07-13-agent-force-studio-3d-design.md
git commit -m "test: verify Agent Force Studio production states"
```

- [ ] **Step 7: Request review and publish a draft PR**

Use `superpowers:requesting-code-review`, address verified findings, rerun affected checks, then use the GitHub publishing workflow. The PR description must name the server projection, lifecycle adapter coverage, 3D performance budgets, semantic fallback, screenshots, commands run, and known Tau lifecycle limitation.

---

## Completion evidence

- Every acceptance criterion in the approved design spec maps to Tasks 1–10.
- The server projection and lifecycle telemetry are independently testable before Three.js loads.
- The semantic interface is usable before and without the canvas.
- The 3D layer reconciles stable entities rather than rebuilding a decorative scene.
- All motion is joined to a persisted timeline identity and is idempotent.
- Production delivery includes local assets, same-origin secure transport, responsive/accessibility states, context recovery, performance ceilings, full regression, and a reviewable PR.
