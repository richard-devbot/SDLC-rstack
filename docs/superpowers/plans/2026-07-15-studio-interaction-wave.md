# RStack Agent Force Studio Interaction Wave Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing Agent Force Studio into an honest, company-like operating floor with an overhead lifecycle gantry, seated management, event-driven delegation and handoff movement, human approval conversations, and clean source-backed captions.

**Architecture:** Keep business truth in the server projection, add authored company anchors to topology, and let the client render only projection facts or lifecycle transitions. A serial manager arbiter owns every orchestrator movement so delegation, teammate check-ins, and approval visits cannot fight; fixed manager and human rigs reserve two of the sixteen detailed-rig slots. A focused pure caption module builds bounded text descriptors, while `scene.js` owns Three.js sprite caching, positioning, fading, and disposal.

**Tech Stack:** Node.js ESM, Three.js, canvas sprites, `node:test`, Playwright Core with local Chromium, GitHub CLI, existing RStack dashboard projection and static server.

## Global Constraints

- Start from remote `codex/studio-agent-force` at `b10f560792156de47a2a412b25addcff3ef05ad3` or later; work only on `codex/studio-interaction-wave`.
- GitHub issue #385 was filed and claimed before implementation; the PR must use base `codex/studio-agent-force` and include `Closes #385`, epic #361, and PR #377.
- Lifecycle movement and status text must come from real events or server projection state; ambient movement must carry no status UI and freeze under reduced motion.
- Keep the ceilings at `200` draw calls and `200_000` triangles unless measured evidence and an inline rationale justify a pin change.
- Reduced motion applies final state immediately; stale or disconnected state pauses the scene.
- Canvas captions must have semantic DOM parity, use local assets only, and never use client-side formulas to invent backend facts.
- Every GLB consumer needs a procedural fallback; `human-approver.glb` is local and its attribution remains covered by `models/ATTRIBUTIONS.md`.
- Keep at most `16` detailed rigs total: manager + human approver + at most `14` detailed session agents; overflow remains aggregated.
- Cap concurrent captions at `8`; captions are text-only, non-interactive, cached by content/style key, and disposed on removal.
- Use explicit `git add` paths only and make one logical, bisectable commit per task with its tests.
- Before the PR, verify `npm test` reports `# fail 0`, then run `npm run lint`, `npm run typecheck`, `npm run validate`, `node scripts/security-audit.mjs`, and `git diff --check`.

## Locked file structure and interfaces

- `src/observability/dashboard/ui/studio3d/topology.js` owns `STUDIO_TOPOLOGY.pipelineGantry`, `managerSeat`, `strategyApproval`, and authored routes/anchors.
- `src/observability/dashboard/ui/studio3d/office.js` consumes `pipelineGantry` and creates the canonical fifteen adopted `stageSignals` above the corridor.
- `src/observability/dashboard/ui/studio3d/locomotion.js` exposes `sit()` alongside `stand()` and `walk()` for Mixamo, suffixed Mixamo, and low-poly worker bones.
- `src/observability/dashboard/ui/studio3d/assets.js` exports the local cast manifest, loads `human-approver.glb`, and accepts `setMode('sitting')`.
- `src/observability/dashboard/ui/studio3d/behavior.js` exposes `managerIntent(event)` without changing the established `behaviorIntent(event)` return contract.
- `src/observability/dashboard/ui/studio3d/transitions.js` emits a second manager check-in transition for genuine handoff/retry events.
- `src/observability/dashboard/ui/studio3d/animator.js` serializes manager work and exposes `reconcileManager({ approvalActive, approvalSummary })`.
- `src/observability/dashboard/ui/studio3d/captions.js` is renderer-free and exports all text/truncation/ranking helpers.
- `src/observability/dashboard/ui/studio3d/scene.js` owns fixed cast placement, caption sprites, caption fade/disposal, gantry packets, and reconciliation wiring.
- `src/observability/dashboard/state/studio.js` projects sanitized caption facts; `ui/studio3d/dom.js` renders waiting and approval parity.

---

### Task 1: Project source-backed lifecycle facts for clean captions

**Files:**
- Modify: `src/observability/dashboard/state/studio.js`
- Modify: `tests/dashboard-studio-projection.test.js`

**Interfaces:**
- Consumes: sanitized lifecycle event objects already accepted by `timelineItems(events, runId)`.
- Produces: timeline items with optional `skill_ids: string[]`, `from: string`, `to: string`, `attempt: number`, and `evidence_refs: string[]`, plus top-level `approval_summary: null | { pending_count: number, artifact: string }`; these are the only action/approval facts `captions.js` may consume.

- [ ] **Step 1: Write failing projection assertions**

Add lifecycle fixtures and assertions that preserve safe facts while stripping unsafe values:

```js
events.push(
  { type: 'agent_capabilities_attached', run_id: 'run-1', agent_session_id: 'session-a', skill_ids: ['risk-review', '<script>'], timestamp: '2026-07-15T10:00:00Z' },
  { type: 'handoff_created', run_id: 'run-1', agent_session_id: 'session-a', from: 'builder', to: 'validator', timestamp: '2026-07-15T10:00:01Z' },
  { type: 'task_retry_scheduled', run_id: 'run-1', agent_session_id: 'session-a', attempt: 3, timestamp: '2026-07-15T10:00:02Z' },
  { type: 'artifact_emitted', run_id: 'run-1', agent_session_id: 'session-a', evidence_refs: ['evidence/result.json'], timestamp: '2026-07-15T10:00:03Z' },
);

assert.deepEqual(timeline.find((item) => item.type === 'agent_capabilities_attached').skill_ids, ['risk-review']);
assert.equal(timeline.find((item) => item.type === 'handoff_created').to, 'validator');
assert.equal(timeline.find((item) => item.type === 'task_retry_scheduled').attempt, 3);
assert.deepEqual(timeline.find((item) => item.type === 'artifact_emitted').evidence_refs, ['evidence/result.json']);
assert.deepEqual(projection.approval_summary, { pending_count: 1, artifact: 'Release candidate' });
```

Build one projection with a pending governance item titled `Release candidate`, and a second with only an `agent_waiting` event whose `reason_class` is `approval`; assert the latter summary uses `{ pending_count: 1, artifact: 'task-a' }` so the client never invents the fallback count.

- [ ] **Step 2: Run the projection test and confirm RED**

Run: `npx tsx --test tests/dashboard-studio-projection.test.js`

Expected: FAIL because the timeline item does not yet retain one or more of `skill_ids`, `to`, `attempt`, or `evidence_refs`.

- [ ] **Step 3: Add a narrowly typed timeline fact copier**

Implement the copy at the projection boundary, using the existing lifecycle sanitizers:

```js
function captionFacts(event) {
  const facts = {};
  const skillIds = safeIds(event?.skill_ids);
  const evidenceRefs = Array.isArray(event?.evidence_refs)
    ? [...new Set(event.evidence_refs.map((value) => safeText(value, 180)).filter(Boolean))].slice(0, 32)
    : [];
  const from = safeId(event?.from);
  const to = safeId(event?.to);
  const attempt = Number.isSafeInteger(event?.attempt) && event.attempt >= 0 ? event.attempt : undefined;

  if (skillIds.length) facts.skill_ids = skillIds;
  if (evidenceRefs.length) facts.evidence_refs = evidenceRefs;
  if (from) facts.from = from;
  if (to) facts.to = to;
  if (attempt !== undefined) facts.attempt = attempt;
  return facts;
}

return {
  id: eventIdentity(event),
  type: event.type,
  run_id: runId,
  task_id: safeId(event.task_id),
  stage_ids: safeIds(event.stage_ids ?? (event.stage_id ? [event.stage_id] : [])),
  delegation_id: safeId(event.delegation_id),
  session_id: safeId(event.agent_session_id),
  role: safeId(event.role),
  status: safeId(event.status),
  activity_class: safeId(event.activity_class),
  reason_class: safeId(event.reason_class),
  summary: safeText(event.summary),
  source: safeSource(event.source) ?? 'events.jsonl',
  timestamp: eventTimestamp(event),
  entity_id: safeId(event.agent_session_id ?? event.delegation_id ?? event.task_id),
  ...captionFacts(event),
};
```

Spread `captionFacts(event)` into the existing `timelineItems()` object shown above; do not copy raw event strings.

Add a server-side approval summary and reuse the already-sanitized governance/session fields:

```js
function approvalSummary(items, sessions) {
  const approvalWaiters = sessions.filter((session) => (
    session.status === 'waiting' && session.waiting_reason === 'approval'
  ));
  const pendingCount = items.length || approvalWaiters.length;
  if (!pendingCount) return null;
  return {
    pending_count: pendingCount,
    artifact: safeText(items[0]?.title ?? approvalWaiters[0]?.task_id ?? `${pendingCount} pending`, 80),
  };
}

const sessionItems = [...sessions.values()].sort((a, b) => (
  (timestampMs(a.started_at) ?? 0) - (timestampMs(b.started_at) ?? 0)
  || a.id.localeCompare(b.id)
));
const governance = governanceItems(state, run.runId);

// Replace the existing `sessions` and `governance_items` members inside the
// current buildStudioProjection() return object with these adjacent members.
sessions: sessionItems,
approval_summary: approvalSummary(governance, sessionItems),
governance_items: governance,
```

In the actual return object, keep every current projection field in its current order, replace only the inline session sort/governance calls with the two locals, and add `approval_summary`. Add `approval_summary: null` to `emptyStudio()`.

- [ ] **Step 4: Verify projection and lifecycle tests are GREEN**

Run: `npx tsx --test tests/dashboard-studio-projection.test.js tests/dashboard-studio-behavior.test.js`

Expected: both files pass with `# fail 0`.

- [ ] **Step 5: Commit the projection contract**

```bash
git add src/observability/dashboard/state/studio.js tests/dashboard-studio-projection.test.js
git commit -m "feat(studio): project lifecycle caption facts"
```

---

### Task 2: Relocate the canonical pipeline to an overhead corridor gantry

**Files:**
- Modify: `src/observability/dashboard/ui/studio3d/topology.js`
- Modify: `src/observability/dashboard/ui/studio3d/office.js`
- Modify: `src/observability/dashboard/ui/studio3d/scene.js`
- Modify: `tests/dashboard-studio-office.test.js`
- Modify: `tests/dashboard-studio-browser-model.test.js`

**Interfaces:**
- Consumes: `STUDIO_TOPOLOGY.corridor` with spine `z = -5.5` and the existing fifteen `departments` in canonical order.
- Produces: `STUDIO_TOPOLOGY.pipelineGantry` with `startX`, `endX`, `z`, `frameY`, `panelY`, `minClearanceY`, and `panelTiltX`, plus `pipelineStageX(index, count)`; `createPipelineWall()` keeps returning `{ group, stageSignals }` with `stageSignals.size === 15`.

- [ ] **Step 1: Write failing gantry tests**

Extend the office test to verify adoption, order, clearance, corridor placement, and a clean east wall:

```js
const pool = createResourcePool();
const office = createOfficeEnvironment(pool);
const group = office.object.getObjectByName('Fifteen-stage pipeline gantry');
const { stageSignals } = office;
const signals = [...stageSignals.values()];

assert.equal(stageSignals.size, 15);
assert.deepEqual([...stageSignals.keys()], STUDIO_TOPOLOGY.departments.map((department) => department.id));
assert.ok(signals.every((signal) => signal.position.y >= 2.6));
assert.ok(signals.every((signal) => Math.abs(signal.position.z - STUDIO_TOPOLOGY.corridor.z) < 0.8));
assert.ok(signals.every((signal, index) => index === 0 || signal.position.x > signals[index - 1].position.x));
assert.ok(group instanceof THREE.Group);
assert.equal(office.object.getObjectByName('Fifteen-stage pipeline wall'), undefined);
office.dispose();
pool.dispose();
```

In the browser-model source contract, pin the single-strip readable label treatment:

```js
assert.match(sceneSource, /Gantry stage legend/);
assert.match(sceneSource, /paintGantryLegend\(\)/);
assert.match(sceneSource, /pipelineGantry/);
```

Add route clearance assertions for `enter`, `collect_capabilities`, and `wait`: every floor waypoint remains below `pipelineGantry.minClearanceY` and does not intersect a support footprint.

- [ ] **Step 2: Run the office test and confirm RED**

Run: `npx tsx --test tests/dashboard-studio-office.test.js tests/dashboard-studio-browser-model.test.js`

Expected: FAIL because the pipeline panels are still arranged vertically on the east wall.

- [ ] **Step 3: Author one shared gantry topology**

Add frozen authored values to `STUDIO_TOPOLOGY`:

```js
pipelineGantry: Object.freeze({
  startX: -15.4,
  endX: 15.4,
  z: CORRIDOR_Z,
  frameY: 3.55,
  panelY: 3.06,
  minClearanceY: 2.6,
  panelTiltX: -0.3,
}),
```

Export a pure helper so office fixtures and scene packets use identical coordinates:

```js
export function pipelineStageX(index, count = STUDIO_TOPOLOGY.departments.length) {
  const { startX, endX } = STUDIO_TOPOLOGY.pipelineGantry;
  return count <= 1 ? startX : startX + ((endX - startX) * index) / (count - 1);
}
```

- [ ] **Step 4: Rebuild the fixture as an instanced roller gantry**

Keep `createPipelineWall` for API compatibility, but build suspended supports, rollers, and readable south-facing panels:

```js
const gantry = STUDIO_TOPOLOGY.pipelineGantry;
const panel = new THREE.Mesh(pool.geometries.slab, pool.statusMaterial('unknown'));
panel.name = `Stage signal · ${department.id}`;
panel.scale.set(0.86, 0.42, 0.08);
panel.position.set(pipelineStageX(index), gantry.panelY, gantry.z + 0.08);
panel.rotation.x = gantry.panelTiltX;
panel.userData.fixture = 'pipeline-stage';
stageSignals.set(department.id, panel);
group.add(panel);
```

Use shared geometries/materials and instanced support/roller meshes so the move does not materially raise draw calls. Keep the central floor corridor unobstructed below `minClearanceY`.

- [ ] **Step 5: Move packets and room label to the gantry**

Replace the east-wall conveyor constants in `scene.js` with the topology anchor:

```js
const CONVEYOR = Object.freeze({
  startX: STUDIO_TOPOLOGY.pipelineGantry.startX,
  endX: STUDIO_TOPOLOGY.pipelineGantry.endX,
  y: STUDIO_TOPOLOGY.pipelineGantry.panelY - 0.42,
  z: STUDIO_TOPOLOGY.pipelineGantry.z + 0.2,
  packets: 6,
});
```

Interpolate packet `x`, not `z`, and keep progress capped to the furthest reached projected stage. Update `ROOM_LABELS`:

```js
['15-STAGE PIPELINE', 0, 4.25, -5.55]
```

Paint the fifteen projected stage titles into one shared physical legend rail so the default overview can read the panels without fifteen new draw calls:

```js
let gantryLegendMaterial = null;
const gantryLegend = new THREE.Mesh(pool.geometries.slab, pool.materials.graphite);
gantryLegend.name = 'Gantry stage legend';
gantryLegend.position.set(0, STUDIO_TOPOLOGY.pipelineGantry.panelY + 0.72, STUDIO_TOPOLOGY.pipelineGantry.z);
gantryLegend.scale.set(15.45, 0.52, 0.035);
gantryLegend.rotation.x = STUDIO_TOPOLOGY.pipelineGantry.panelTiltX;
scene.add(gantryLegend);

function paintGantryLegend() {
  const canvasEl = makeCanvas(2048, 144);
  const context = canvasEl.getContext('2d');
  context.fillStyle = '#111a24';
  context.fillRect(0, 0, canvasEl.width, canvasEl.height);
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.font = '700 22px ui-sans-serif, system-ui';
  (projection.departments ?? []).slice(0, 15).forEach((department, index) => {
    const width = canvasEl.width / 15;
    context.fillStyle = '#f4f6f8';
    context.fillText(`${String(index + 1).padStart(2, '0')} ${String(department.title ?? department.id).slice(0, 14)}`, width * (index + 0.5), 72, width - 10);
  });
  const texture = new THREE.CanvasTexture(canvasEl);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicMaterial({ map: texture });
  gantryLegendMaterial?.map?.dispose();
  gantryLegendMaterial?.dispose();
  gantryLegendMaterial = material;
  gantryLegend.material = material;
}
```

Call `paintGantryLegend()` during projection reconciliation and dispose the legend texture/material during scene destruction. Do not add a replacement east-wall pipeline object; Evidence Vault remains.

- [ ] **Step 6: Verify gantry and topology tests are GREEN**

Run: `npx tsx --test tests/dashboard-studio-office.test.js`

Expected: both files pass with `# fail 0` and fifteen adopted fixtures ordered west-to-east.

- [ ] **Step 7: Commit the gantry**

```bash
git add src/observability/dashboard/ui/studio3d/topology.js src/observability/dashboard/ui/studio3d/office.js src/observability/dashboard/ui/studio3d/scene.js tests/dashboard-studio-office.test.js tests/dashboard-studio-browser-model.test.js
git commit -m "feat(studio): suspend pipeline over corridor"
```

---

### Task 3: Add a real seated locomotion mode and local human cast member

**Files:**
- Modify: `src/observability/dashboard/ui/studio3d/locomotion.js`
- Modify: `src/observability/dashboard/ui/studio3d/assets.js`
- Modify: `tests/dashboard-studio-assets.test.js`
- Create: `tests/dashboard-studio-locomotion.test.js`

**Interfaces:**
- Consumes: named rig bones captured at their rest transforms.
- Produces: `createLocomotion(root).sit()` and `castAgent.setMode('sitting')`; `STUDIO_CAST_MANIFEST.human` points to `/studio3d/assets/models/human-approver.glb` at height `1.66`, `clipPose: 'standing'`.

- [ ] **Step 1: Write failing sit-pose tests for all supported naming patterns**

Create minimal `THREE.Bone` rigs and assert relative pose changes:

```js
for (const rig of [mixamoRig(), suffixedMixamoRig(), lowPolyWorkerRig()]) {
  const locomotion = createLocomotion(rig.root);
  const hipY = rig.hips.position.y;
  locomotion.sit();
  assert.ok(rig.hips.position.y < hipY, `${rig.name} lowers hips`);
  assert.ok(Math.abs(rig.leftUpLeg.rotation.x) > 1.2, `${rig.name} bends thighs near ninety degrees`);
  assert.ok(Math.abs(rig.leftLeg.rotation.x) > 1.2, `${rig.name} bends knees near ninety degrees`);
  assert.ok(Math.abs(rig.leftArm.rotation.x) > 0.25, `${rig.name} reaches toward desk`);
  locomotion.stand();
  assert.ok(Math.abs(rig.hips.position.y - hipY) < 1e-6, `${rig.name} restores rest pose`);
}
```

Use the parsed human names such as `mixamorig:Hips_01`, `mixamorig:LeftUpLeg_055`, and `mixamorig:LeftLeg_056`; do not invent a third family when the existing suffix-tolerant Mixamo pattern matches.

- [ ] **Step 2: Write failing asset manifest/mode tests**

Assert the human URL is served, the manifest is local, and source wiring recognizes sitting:

```js
assert.deepEqual(STUDIO_CAST_MANIFEST.human, {
  url: '/studio3d/assets/models/human-approver.glb',
  height: 1.66,
  clipPose: 'standing',
});
assert.match(assetsSource, /mode === ['"]sitting['"]/);
assert.equal((await fetch(`${origin}${STUDIO_CAST_MANIFEST.human.url}`)).status, 200);
```

- [ ] **Step 3: Run the focused tests and confirm RED**

Run: `npx tsx --test tests/dashboard-studio-locomotion.test.js tests/dashboard-studio-assets.test.js`

Expected: FAIL because `sit`, `STUDIO_CAST_MANIFEST.human`, and sitting mode are absent.

- [ ] **Step 4: Implement family-specific seated joint offsets**

Add a `sit` configuration to each `RIG_FAMILIES` member next to its walk values:

```js
sit: Object.freeze({
  hipsDrop: 0.42,
  thighPitch: -Math.PI / 2,
  kneePitch: Math.PI / 2,
  armPitch: -0.48,
}),
```

Use a smaller `hipsDrop` only if the low-poly test/model contact requires it, and implement the driver with the module's existing `pose(key, angle)` helper:

```js
return {
  family: family.id,
  walk(phase) {
    const stride = Math.sin(phase * Math.PI * 2);
    pose('thighL', -stride * family.thighSwing);
    pose('thighR', stride * family.thighSwing);
    pose('kneeL', Math.max(0, stride) * family.kneeBend);
    pose('kneeR', Math.max(0, -stride) * family.kneeBend);
    pose('armL', stride * family.armSwing);
    pose('armR', -stride * family.armSwing);
    pose('spine', 0.05);
    if (rig.hips) {
      rig.hips.position.copy(rest.get(rig.hips).position);
      rig.hips.position.y += Math.abs(Math.cos(phase * Math.PI * 2)) * 0.015;
    }
  },

  sit() {
    for (const key of Object.keys(rig)) pose(key, 0);
    pose('thighL', family.sit.thighPitch);
    pose('thighR', family.sit.thighPitch);
    pose('kneeL', family.sit.kneePitch);
    pose('kneeR', family.sit.kneePitch);
    pose('armL', family.sit.armPitch);
    pose('armR', family.sit.armPitch);
    if (rig.hips) {
      rig.hips.position.copy(rest.get(rig.hips).position);
      rig.hips.position.y -= family.sit.hipsDrop;
    }
  },

  stand() {
    for (const key of Object.keys(rig)) pose(key, 0);
    if (rig.hips) rig.hips.position.copy(rest.get(rig.hips).position);
  },
};
```

Every offset is now applied around captured rest transforms, so repeated sitting/standing cannot accumulate drift.

- [ ] **Step 5: Add the human manifest and sitting mode**

Export the manifest and add the local entry:

```js
human: Object.freeze({
  url: '/studio3d/assets/models/human-approver.glb',
  height: 1.66,
  clipPose: 'standing',
}),
```

Export the existing manifest as `STUDIO_CAST_MANIFEST`, insert the `human` member beside `manager`, `worker`, `librarian`, `station`, and `chair`, and update internal reads from `MANIFEST` to `STUDIO_CAST_MANIFEST`.

Update the cast handle mode switch:

```js
const useClip = Boolean(action) && mode === clipPose;
if (action) action.paused = !useClip;
if (useClip || !locomotion) return;
if (mode === 'sitting') locomotion.sit();
else if (mode === 'walking') locomotion.walk(phase);
else locomotion.stand();
```

- [ ] **Step 6: Verify locomotion and assets are GREEN**

Run: `npx tsx --test tests/dashboard-studio-locomotion.test.js tests/dashboard-studio-assets.test.js tests/dashboard-studio-robot.test.js`

Expected: all pass with `# fail 0`.

- [ ] **Step 7: Commit seated locomotion and the human asset contract**

```bash
git add src/observability/dashboard/ui/studio3d/locomotion.js src/observability/dashboard/ui/studio3d/assets.js tests/dashboard-studio-assets.test.js tests/dashboard-studio-locomotion.test.js
git commit -m "feat(studio): add seated cast locomotion"
```

---

### Task 4: Seat management and the human approver at authored company anchors

**Files:**
- Modify: `src/observability/dashboard/ui/studio3d/topology.js`
- Modify: `src/observability/dashboard/ui/studio3d/geometry.js`
- Modify: `src/observability/dashboard/ui/studio3d/scene.js`
- Modify: `src/observability/dashboard/ui/studio3d/reconciler.js`
- Modify: `tests/dashboard-studio-office.test.js`
- Modify: `tests/dashboard-studio-robot.test.js`

**Interfaces:**
- Consumes: the normalized battlestation chair bounds and strategy-table casework location.
- Produces: `STUDIO_TOPOLOGY.managerSeat`, `STUDIO_TOPOLOGY.strategyApproval`, `createProceduralHumanApprover(pool)`, and a scene capacity of fourteen session rigs plus manager and human.

- [ ] **Step 1: Write failing authored-anchor and rig-budget tests**

Add exact topology and reconciliation assertions:

```js
assert.deepEqual(STUDIO_TOPOLOGY.managerSeat.position, [-4.56, 0.54, -11.15]);
assert.equal(STUDIO_TOPOLOGY.managerSeat.rotationY, Math.PI / 2);
assert.deepEqual(STUDIO_TOPOLOGY.strategyApproval.chairPosition, [-2, 0, -10.72]);
assert.equal(STUDIO_TOPOLOGY.strategyApproval.chairRotationY, Math.PI);

const reconciler = createEntityReconciler({
  scene,
  maxDetailedSessions: 14,
  factories: { orchestrator: factory, session: factory, aggregate: factory },
});
const registry = reconciler.apply({
  orchestrator: { id: 'orchestrator-hq', status: 'active' },
  missions: [],
  departments: [],
  sessions: Array.from({ length: 18 }, (_, index) => ({ id: `session-${index + 1}`, role: 'builder', status: 'active' })),
  governance_items: [],
  evidence_items: [],
});
assert.equal([...registry.keys()].filter((key) => key.startsWith('session:')).length, 14);
assert.equal(registry.get('aggregate:overflow-sessions').object.userData.data.count, 4);
```

Assert `createCastRobotEntity().setPose('sitting')` sends `sitting`, while ordinary `seated_work` still maps to the worker's existing `seated` clip pose.

- [ ] **Step 2: Run office/robot/reconciler tests and confirm RED**

Run: `npx tsx --test tests/dashboard-studio-office.test.js tests/dashboard-studio-robot.test.js`

Expected: FAIL because fixed anchors, a fourteen-session limit, and the orchestrator sitting pose are not present.

- [ ] **Step 3: Add the manager seat and approval-table anchors**

Document the battlestation bounds calculation beside the constant:

```js
managerSeat: Object.freeze({
  // chair mesh center (0.813, 0.819, 0.732), normalized seat contact y ~= 0.54,
  // transformed by station at (-5.2, 0, -10.4), rotation PI / 2.
  position: Object.freeze([-4.56, 0.54, -11.15]),
  rotationY: Math.PI / 2,
}),
strategyApproval: Object.freeze({
  chairPosition: Object.freeze([-2, 0, -10.72]),
  chairRotationY: Math.PI,
  humanSeat: Object.freeze([-2, 0.54, -10.72]),
  managerStand: Object.freeze([-2, 0, -9.55]),
  managerRotationY: Math.PI,
}),
```

The brown chair faces south into the room, while manager and human face one another across the strategy table.

- [ ] **Step 4: Build a procedural human fallback from pooled geometry**

Create a restrained fixed fixture, reusing the pool:

```js
export function createProceduralHumanApprover(pool) {
  const group = new THREE.Group();
  group.name = 'Human approver fallback';
  const part = (geometry, material, position, scale, rotation = [0, 0, 0]) => {
    const object = new THREE.Mesh(geometry, material);
    object.position.set(...position);
    object.scale.set(...scale);
    object.rotation.set(...rotation);
    object.castShadow = true;
    group.add(object);
    return object;
  };
  part(pool.geometries.sphere, pool.materials.robotShell, [0, 1.1, 0], [0.42, 0.72, 0.28]);
  part(pool.geometries.sphere, pool.materials.wall, [0, 1.62, 0], [0.28, 0.3, 0.28]);
  part(pool.geometries.cylinder, pool.materials.graphite, [-0.2, 0.67, 0.22], [0.12, 0.38, 0.12], [Math.PI / 2, 0, 0]);
  part(pool.geometries.cylinder, pool.materials.graphite, [0.2, 0.67, 0.22], [0.12, 0.38, 0.12], [Math.PI / 2, 0, 0]);
  part(pool.geometries.cylinder, pool.materials.graphite, [-0.2, 0.35, 0.5], [0.12, 0.32, 0.12]);
  part(pool.geometries.cylinder, pool.materials.graphite, [0.2, 0.35, 0.5], [0.12, 0.32, 0.12]);
  return {
    object: group,
    setMode(mode) { group.userData.mode = mode; },
    setPose(mode) { group.userData.mode = mode; },
    dispose() {},
  };
}
```

Use the module's existing factory helpers and shared materials; do not create unmanaged geometry/material instances.

- [ ] **Step 5: Place and seat the fixed cast without guessing**

In `scene.js`, position the station and embedded manager, move the cast chair, and replace the always-present procedural human only after the GLB template loads:

```js
const approval = STUDIO_TOPOLOGY.strategyApproval;
let humanApprover = createProceduralHumanApprover(pool);

function placeHumanApprover(handle) {
  handle.object.position.fromArray(approval.humanSeat);
  handle.object.rotation.y = approval.chairRotationY;
  handle.setMode?.('sitting');
  castProps.add(handle.object);
}

function replaceHumanApprover() {
  if (!cast?.human) return;
  humanApprover.object.removeFromParent();
  humanApprover.dispose?.();
  humanApprover = createCastAgent(cast.human);
  placeHumanApprover(humanApprover);
}

const station = createCastProp(cast.station);
station.position.set(-5.2, 0, -10.4);
station.rotation.y = Math.PI / 2;
const chair = createCastProp(cast.chair);
chair.position.fromArray(approval.chairPosition);
chair.rotation.y = approval.chairRotationY;
castProps.add(station, chair);

const orchestrator = reconciler.get({ kind: 'orchestrator', id: projection.orchestrator.id });
orchestrator.object.position.fromArray(STUDIO_TOPOLOGY.managerSeat.position);
orchestrator.object.rotation.y = STUDIO_TOPOLOGY.managerSeat.rotationY;
orchestrator.setPose('sitting');
```

Call `placeHumanApprover(humanApprover)` before async loading, `replaceHumanApprover()` from the successful cast load, and remove/dispose `humanApprover` during scene destruction. Keep the manager seated only when no manager transition or approval conversation owns him.

Preserve the worker's authored typing clip while giving the manager the new locomotion pose in `createCastRobotEntity`:

```js
setPose(pose) {
  handle.pose = pose;
  if (pose === 'sitting') body.setMode('sitting');
  else if (pose === 'seated_work' || pose === 'validating') body.setMode('seated');
  else body.setMode('standing');
},
```

- [ ] **Step 6: Reserve fixed detailed-rig capacity**

Add an option to the reconciler:

```js
export function createEntityReconciler({
  scene,
  factories,
  onAdded = () => {},
  onRemoved = () => {},
  maxDetailedSessions = 16,
} = {}) {
  // apply() calls desiredEntities(projection, maxDetailedSessions)
}
```

Change `desiredEntities` to accept that number and use `projection.sessions.slice(-maxDetailedSessions)`; keep the existing aggregate entity count as `projection.sessions.length - detailedSessions.length`.

In the scene:

```js
const MAX_DETAILED_RIGS = 16;
const FIXED_DETAILED_RIGS = 2;
const MAX_DETAILED_SESSIONS = MAX_DETAILED_RIGS - FIXED_DETAILED_RIGS;
```

Pass `14` to reconciler/fleet and report diagnostics as fixed cast + session rigs, never above sixteen.

- [ ] **Step 7: Verify fixed cast and capacity are GREEN**

Run: `npx tsx --test tests/dashboard-studio-office.test.js tests/dashboard-studio-robot.test.js tests/dashboard-studio-browser-model.test.js`

Expected: all pass with `# fail 0`, the detailed session limit is fourteen, and the total ceiling remains sixteen.

- [ ] **Step 8: Commit company seating and rig capacity**

```bash
git add src/observability/dashboard/ui/studio3d/topology.js src/observability/dashboard/ui/studio3d/geometry.js src/observability/dashboard/ui/studio3d/scene.js src/observability/dashboard/ui/studio3d/reconciler.js tests/dashboard-studio-office.test.js tests/dashboard-studio-robot.test.js tests/dashboard-studio-browser-model.test.js
git commit -m "feat(studio): seat manager and human approver"
```

---

### Task 5: Drive teammate check-ins from genuine handoff and retry events

**Files:**
- Modify: `src/observability/dashboard/ui/studio3d/behavior.js`
- Modify: `src/observability/dashboard/ui/studio3d/transitions.js`
- Modify: `src/observability/dashboard/ui/studio3d/animator.js`
- Modify: `tests/dashboard-studio-behavior.test.js`
- Create: `tests/dashboard-studio-transitions.test.js`
- Modify: `tests/dashboard-studio-animator.test.js`

**Interfaces:**
- Consumes: `handoff_created` and `task_retry_scheduled` lifecycle events with `agent_session_id`.
- Produces: `managerIntent(event) -> null | { action: 'manager_check_in', sessionId, taskId, trigger, attempt }`; animator callbacks `onTransitionStart(transition)` and `onTransitionComplete(transition, { reducedMotion })`; `isSessionActive(sessionId)` for resting-state ownership.

- [ ] **Step 1: Write failing manager-intent tests**

Keep the existing behavior contract unchanged and test the new helper separately:

```js
assert.deepEqual(managerIntent({
  type: 'handoff_created',
  agent_session_id: 'session-a',
  task_id: 'task-a',
  to: 'validator',
}), {
  action: 'manager_check_in',
  sessionId: 'session-a',
  taskId: 'task-a',
  trigger: 'handoff_created',
  attempt: undefined,
});

assert.deepEqual(managerIntent({
  type: 'task_retry_scheduled',
  agent_session_id: 'session-b',
  task_id: 'task-b',
  attempt: 2,
}), {
  action: 'manager_check_in',
  sessionId: 'session-b',
  taskId: 'task-b',
  trigger: 'task_retry_scheduled',
  attempt: 2,
});
assert.equal(managerIntent({ type: 'agent_session_started' }), null);
```

- [ ] **Step 2: Write failing transition fan-out tests**

Assert a single real handoff event produces its session transition and one manager transition, with no synthetic timestamps:

```js
const applied = [];
const scheduler = createTransitionScheduler({ apply: (transition) => applied.push(transition) });
assert.equal(scheduler.ingest([handoffEvent]), 2);
assert.deepEqual(applied, []);
scheduler.tick(1_000);
scheduler.tick(1_001);
assert.deepEqual(applied.map((item) => item.intent.action), ['handoff', 'manager_check_in']);
assert.equal(applied[1].event, handoffEvent);
assert.deepEqual(applied.map((item) => item.started_at_ms), [1_000, 1_001]);
```

- [ ] **Step 3: Write failing route, dwell, return, and callback tests**

Use animator harnesses for manager, session desk, and authored seat:

```js
animator.play({ ...managerCheckInTransition, started_at_ms: 1_000 });
animator.update(2_000);
assert.equal(manager.mode, 'walking');
assert.ok(manager.position.distanceTo(workerDesk) < manager.position.distanceTo(managerSeat));

animator.update(3_000); // dwell window at the desk
assert.equal(manager.mode, 'standing');
assert.ok(Math.abs(manager.rotationY - facingWorker) < 0.2);

animator.update(5_500);
assert.deepEqual(manager.position.toArray(), managerSeat);
assert.equal(manager.mode, 'sitting');
assert.deepEqual(callbacks, ['start:manager_check_in', 'complete:manager_check_in']);
```

Also assert delegation returns to `managerSeat` and ends in `sitting`, not the old standing topology point.

- [ ] **Step 4: Run focused tests and confirm RED**

Run: `npx tsx --test tests/dashboard-studio-behavior.test.js tests/dashboard-studio-transitions.test.js tests/dashboard-studio-animator.test.js`

Expected: FAIL because manager intents, dual transitions, sitting final state, and callbacks are absent.

- [ ] **Step 5: Implement the new manager intent and transition fan-out**

In `behavior.js`:

```js
export function managerIntent(event) {
  if (!['handoff_created', 'task_retry_scheduled'].includes(event?.type)) return null;
  return {
    action: 'manager_check_in',
    sessionId: event.agent_session_id ?? null,
    taskId: event.task_id ?? null,
    trigger: event.type,
    attempt: Number.isSafeInteger(event.attempt) ? event.attempt : undefined,
  };
}
```

In `transitions.js`, append the manager transition after the normal transition and assign a stable `:manager` suffix; stamp `started_at_ms` only when `next()` hands it to playback.

- [ ] **Step 6: Implement a serialized event-driven check-in route**

Add manager action handling to `animator.js`:

```js
const MANAGER_CHECK_IN_DURATION_MS = 4_500;
const MANAGER_CHECK_IN_DWELL_MS = 1_500;

function managerCheckInRoutes(intent, handle) {
  const workstation = getWorkstation(intent.sessionId);
  const deskAnchor = worldPosition(workstation?.handoff ?? workstation?.seat);
  if (!deskAnchor) return null;
  deskAnchor.y = 0;
  const [seatX, , seatZ] = STUDIO_TOPOLOGY.managerSeat.position;
  const seat = [seatX, 0, seatZ];
  const start = [handle.object.position.x, 0, handle.object.position.z];
  const desk = deskAnchor.toArray();
  return {
    outbound: corridorRoute(start, desk).map((point) => [...point]),
    inbound: corridorRoute(desk, seat).map((point) => [...point]),
    desk,
    worker: worldPosition(workstation?.seat)?.toArray() ?? desk,
  };
}

function applyManagerCheckIn(item, progress, now) {
  const outboundEnd = 1 / 3;
  const dwellEnd = 2 / 3;
  if (progress < outboundEnd) {
    moveWalkingHandle(item.handle, sampleWaypointRoute(item.managerRoutes.outbound, progress / outboundEnd), now, item.startedAt);
    return;
  }
  if (progress < dwellEnd) {
    item.handle.object.position.fromArray(item.managerRoutes.desk);
    facePoint(item.handle, item.managerRoutes.worker);
    item.handle.setPose('standing');
    return;
  }
  moveWalkingHandle(item.handle, sampleWaypointRoute(item.managerRoutes.inbound, (progress - dwellEnd) / (1 - dwellEnd)), now, item.startedAt);
}
```

`moveWalkingHandle` extracts the existing heading/`setWalking` block from `update`; `facePoint` applies the same `Math.atan2(dx, dz)` orientation. Serialize all manager actions through one active slot and a FIFO queue. Set check-in duration to `MANAGER_CHECK_IN_DURATION_MS`; because the middle third is stationary, the pause is exactly `1_500 ms`. Missing/overflow desks end safely at the seat without a fabricated patrol. Invoke start/complete callbacks exactly once.

Update delegation to depart from the manager's current floor position, route through Dispatch, and use this manager final state for both delegation and check-in:

```js
function applyManagerSeat(handle) {
  handle.object.position.fromArray(STUDIO_TOPOLOGY.managerSeat.position);
  handle.object.rotation.set(0, STUDIO_TOPOLOGY.managerSeat.rotationY, 0);
  handle.setPose('sitting');
}
```

Manager routes travel at `y = 0`; only `applyManagerSeat` restores the authored `y = 0.54` contact anchor.

- [ ] **Step 7: Verify teammate check-ins are GREEN**

Run: `npx tsx --test tests/dashboard-studio-behavior.test.js tests/dashboard-studio-transitions.test.js tests/dashboard-studio-animator.test.js`

Expected: all pass with `# fail 0`.

- [ ] **Step 8: Commit event-driven manager check-ins**

```bash
git add src/observability/dashboard/ui/studio3d/behavior.js src/observability/dashboard/ui/studio3d/transitions.js src/observability/dashboard/ui/studio3d/animator.js tests/dashboard-studio-behavior.test.js tests/dashboard-studio-transitions.test.js tests/dashboard-studio-animator.test.js
git commit -m "feat(studio): animate manager teammate check-ins"
```

---

### Task 6: Reconcile the approval conversation through the manager arbiter

**Files:**
- Modify: `src/observability/dashboard/ui/studio3d/animator.js`
- Modify: `src/observability/dashboard/ui/studio3d/scene.js`
- Modify: `tests/dashboard-studio-animator.test.js`

**Interfaces:**
- Consumes: the latest server-projected `projection.approval_summary` (derived from governance items and approval waiters) and `STUDIO_TOPOLOGY.strategyApproval.managerStand`.
- Produces: `animator.reconcileManager({ approvalActive, approvalSummary }, now)`; `animator.managerState()` returns `'seated' | 'event' | 'approval-walk' | 'approval' | 'approval-return'`.

- [ ] **Step 1: Write failing projection-delta approval tests**

Cover start, hold, return, reduced motion, and the approved arbitration rule:

```js
animator.reconcileManager({ approvalActive: true, approvalSummary: { pending_count: 1, artifact: 'Release plan' } }, 1_000);
animator.update(2_000);
assert.equal(animator.managerState(), 'approval-walk');
animator.update(4_000);
assert.equal(animator.managerState(), 'approval');
assert.deepEqual(manager.position.toArray(), approvalTarget);
assert.equal(manager.mode, 'standing');

animator.reconcileManager({ approvalActive: false, approvalSummary: null }, 5_000);
animator.update(8_000);
assert.equal(animator.managerState(), 'seated');
assert.equal(manager.mode, 'sitting');
```

For arbitration:

```js
animator.play({ ...delegationTransition, started_at_ms: 1_000 });
animator.reconcileManager({ approvalActive: true, approvalSummary: { pending_count: 1, artifact: 'Release plan' } }, 1_100);
assert.equal(animator.managerState(), 'event');
animator.reconcileManager({ approvalActive: false, approvalSummary: null }, 2_000);
animator.update(8_000);
assert.equal(animator.managerState(), 'seated'); // stale approval walk never starts
```

Then repeat with approval still true when the real event ends and assert the approval walk starts only after event completion.

- [ ] **Step 2: Run animator tests and confirm RED**

Run: `npx tsx --test tests/dashboard-studio-animator.test.js`

Expected: FAIL because approval reconciliation and manager state do not exist.

- [ ] **Step 3: Implement latest-state manager arbitration**

Keep the latest desired projection state, never enqueue a timer-created conversation:

```js
let desiredApproval = { active: false, summary: null };

function reconcileManager({ approvalActive, approvalSummary = null }, now = performance.now()) {
  desiredApproval = { active: Boolean(approvalActive), summary: approvalSummary };
  if (reducedMotion) return applyManagerFinalState(desiredApproval.active ? 'approval' : 'seated');
  if (managerEventActive()) return;
  settleManagerProjectionState(now);
}

function settleManagerProjectionState(now) {
  if (desiredApproval.active && managerStateValue === 'seated') startApprovalWalk(now);
  if (!desiredApproval.active && managerStateValue === 'approval') startApprovalReturn(now);
}
```

When a delegation/check-in completes, call `settleManagerProjectionState(now)` using the latest state. Do not remember the state that existed when the patrol began.

Build both projection-driven routes from authored floor points and apply explicit final poses:

```js
function startApprovalWalk(now) {
  const handle = getOrchestrator();
  if (!handle) return;
  const target = [...STUDIO_TOPOLOGY.strategyApproval.managerStand];
  const from = [handle.object.position.x, 0, handle.object.position.z];
  managerStateValue = 'approval-walk';
  startManagerItem({
    id: 'manager:approval-walk',
    intent: { action: 'approval_walk' },
    handle,
    route: corridorRoute(from, target),
    startedAt: now,
    duration: 2_200,
  });
}

function applyApprovalFinal(handle) {
  handle.object.position.fromArray(STUDIO_TOPOLOGY.strategyApproval.managerStand);
  handle.object.rotation.set(0, STUDIO_TOPOLOGY.strategyApproval.managerRotationY, 0);
  handle.setPose('standing');
  managerStateValue = 'approval';
}

function startApprovalReturn(now) {
  const handle = getOrchestrator();
  if (!handle) return;
  const [seatX, , seatZ] = STUDIO_TOPOLOGY.managerSeat.position;
  managerStateValue = 'approval-return';
  startManagerItem({
    id: 'manager:approval-return',
    intent: { action: 'approval_return' },
    handle,
    route: corridorRoute(handle.object.position.toArray(), [seatX, 0, seatZ]),
    startedAt: now,
    duration: 2_200,
  });
}
```

`approval_walk` completes through `applyApprovalFinal`; `approval_return` completes through `applyManagerSeat`. These internal motion labels never become lifecycle captions and do not claim work.

- [ ] **Step 4: Wire real projection deltas in scene reconciliation**

Calculate approval activity only from projection values:

```js
animator.reconcileManager({
  approvalActive: (projection.approval_summary?.pending_count ?? 0) > 0,
  approvalSummary: projection.approval_summary ?? null,
});
```

Update `applyRestingStates` so it applies the manager seat only when `animator.managerState() === 'seated'`; the orchestrator remains outside session resting-state logic.

- [ ] **Step 5: Verify approval arbitration is GREEN**

Run: `npx tsx --test tests/dashboard-studio-animator.test.js tests/dashboard-studio-projection.test.js tests/dashboard-studio-robot.test.js`

Expected: all pass with `# fail 0`; approval is projection-driven and never loops on a timer.

- [ ] **Step 6: Commit approval movement**

```bash
git add src/observability/dashboard/ui/studio3d/animator.js src/observability/dashboard/ui/studio3d/scene.js tests/dashboard-studio-animator.test.js
git commit -m "feat(studio): reconcile human approval visits"
```

---

### Task 7: Build pure dialogue, thought, and action caption facts

**Files:**
- Create: `src/observability/dashboard/ui/studio3d/captions.js`
- Create: `tests/dashboard-studio-captions.test.js`

**Interfaces:**
- Consumes: projected sessions/governance items and transition `{ intent, event, started_at_ms }` objects.
- Produces: `truncateCaption`, `approvalCaptionFacts`, `waitingCaptionFacts`, `transitionCaptionFact`, `selectCaptionFacts`, `waitingSemanticText`, and `approvalSemanticText`; every returned fact has `{ id, ownerKind, ownerId, kind, text, priority, timestamp }`.

- [ ] **Step 1: Write failing pure copy and truncation tests**

Cover all required captions and pluralization:

```js
assert.deepEqual(approvalCaptionFacts({ pending_count: 1, artifact: 'Release candidate' }).map((fact) => fact.text), [
  'Requesting approval · Release candidate',
  'Reviewing 1 pending approval',
  'Awaiting human sign-off',
]);
assert.equal(approvalCaptionFacts({ pending_count: 2, artifact: '2 pending' })[1].text, 'Reviewing 2 pending approvals');
assert.equal(waitingCaptionFacts([{ id: 's-1', status: 'waiting', waiting_reason: 'approval' }])[0].text, 'Waiting · approval');
assert.equal(approvalSemanticText({ pending_count: 1, artifact: 'Release candidate' }), 'Human approval · 1 pending approval · Release candidate');
assert.equal(truncateCaption('x'.repeat(80), 32), `${'x'.repeat(31)}…`);
```

- [ ] **Step 2: Write failing real-action caption tests**

```js
assert.equal(transitionCaptionFact(transition('collect_capabilities', { skill_ids: ['risk-review'] })).text, 'collecting risk-review');
assert.equal(transitionCaptionFact(transition('delegate', { role: 'builder' })).text, 'delegating → builder');
assert.equal(transitionCaptionFact(transition('handoff', { to: 'validator' })).text, 'handoff → validator');
assert.equal(transitionCaptionFact(transition('return_evidence', { evidence_refs: ['result.json'] })).text, 'delivering evidence');
assert.equal(transitionCaptionFact(transition('retry', { attempt: 3 })).text, 'retrying (attempt 3)');
assert.equal(transitionCaptionFact(transition('manager_check_in', {})).text, 'walking to desk');
assert.equal(transitionCaptionFact(transition('idle', {})), null);
```

Assert the selector returns at most eight facts, preferring higher priority, most recent, then shortest camera distance.

- [ ] **Step 3: Run caption tests and confirm RED**

Run: `npx tsx --test tests/dashboard-studio-captions.test.js`

Expected: FAIL with module-not-found because `captions.js` does not exist.

- [ ] **Step 4: Implement the renderer-free caption builder**

Define fixed kinds/priorities and text-only normalization:

```js
export const MAX_CAPTIONS = 8;

export function truncateCaption(value, max = 48) {
  const text = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}

function fact(id, ownerKind, ownerId, kind, text, priority, timestamp = 0) {
  return { id, ownerKind, ownerId, kind, text: truncateCaption(text), priority, timestamp };
}

export function approvalCaptionFacts(summary) {
  const count = Number.isSafeInteger(summary?.pending_count) ? summary.pending_count : 0;
  if (count < 1) return [];
  const artifact = truncateCaption(summary?.artifact || `${count} pending`, 40);
  return [
    fact('approval-manager-speech', 'orchestrator', 'orchestrator', 'speech', `Requesting approval · ${artifact}`, 100),
    fact('approval-human-speech', 'human', 'human-approver', 'speech', `Reviewing ${count} pending approval${count === 1 ? '' : 's'}`, 100),
    fact('approval-manager-thought', 'orchestrator', 'orchestrator', 'thought', 'Awaiting human sign-off', 90),
  ];
}

export function waitingCaptionFacts(sessions = []) {
  return sessions
    .filter((session) => session?.status === 'waiting' && session.waiting_reason)
    .map((session) => fact(
      `waiting:${session.id}`,
      'session',
      session.id,
      'thought',
      `Waiting · ${truncateCaption(session.waiting_reason, 32)}`,
      60,
      Date.parse(session.last_activity_at ?? '') || 0,
    ));
}

export function transitionCaptionFact(transition) {
  const action = transition?.intent?.action;
  const event = transition?.event ?? {};
  let text = null;
  if (action === 'collect_capabilities') text = `collecting ${event.skill_ids?.[0] ?? 'capabilities'}`;
  else if (action === 'delegate') text = event.role ? `delegating → ${event.role}` : 'delegating';
  else if (action === 'handoff') text = event.to ? `handoff → ${event.to}` : 'handoff';
  else if (action === 'return_evidence') text = 'delivering evidence';
  else if (action === 'retry') text = Number.isSafeInteger(event.attempt) ? `retrying (attempt ${event.attempt})` : 'retrying';
  else if (action === 'manager_check_in') text = 'walking to desk';
  if (!text) return null;
  const managerAction = action === 'manager_check_in' || action === 'delegate';
  return fact(
    `action:${transition.id}`,
    managerAction ? 'orchestrator' : 'session',
    managerAction ? 'orchestrator' : transition.intent.sessionId,
    'action',
    text,
    80,
    transition.started_at_ms ?? 0,
  );
}
```

Missing action fields use honest generic wording or return `null`; they never invent a skill, attempt, or handoff role.

- [ ] **Step 5: Implement stable caption selection and semantic helpers**

```js
export function selectCaptionFacts(facts, { limit = MAX_CAPTIONS } = {}) {
  return [...facts]
    .sort((a, b) => b.priority - a.priority || b.timestamp - a.timestamp || (a.distance ?? Infinity) - (b.distance ?? Infinity) || a.id.localeCompare(b.id))
    .slice(0, limit);
}

export const waitingSemanticText = (session) => waitingCaptionFacts([session])[0]?.text ?? '';
export const approvalSemanticText = (summary) => {
  const count = Number.isSafeInteger(summary?.pending_count) ? summary.pending_count : 0;
  if (count < 1) return '';
  const artifact = truncateCaption(summary?.artifact || `${count} pending`, 48);
  return `Human approval · ${count} pending approval${count === 1 ? '' : 's'} · ${artifact}`;
};
```

- [ ] **Step 6: Verify pure caption logic is GREEN**

Run: `npx tsx --test tests/dashboard-studio-captions.test.js`

Expected: PASS with `# fail 0`.

- [ ] **Step 7: Commit caption facts**

```bash
git add src/observability/dashboard/ui/studio3d/captions.js tests/dashboard-studio-captions.test.js
git commit -m "feat(studio): build source-backed caption facts"
```

---

### Task 8: Render restrained canvas bubbles with semantic parity

**Files:**
- Modify: `src/observability/dashboard/ui/studio3d/scene.js`
- Modify: `src/observability/dashboard/ui/studio3d/dom.js`
- Modify: `src/observability/dashboard/server.js`
- Modify: `tests/dashboard-studio-assets.test.js`
- Modify: `tests/dashboard-studio-browser-model.test.js`
- Modify: `tests/dashboard-studio-captions.test.js`
- Create: `tests/dashboard-studio-dom.test.js`

**Interfaces:**
- Consumes: caption facts from Task 7 plus animator start/complete callbacks from Task 5.
- Produces: at most eight non-interactive caption sprites; action captions fade for `1_000 ms` after completion; reduced motion removes completed captions on the next reconcile with no fade.

- [ ] **Step 1: Write failing static-route, semantic, and renderer-contract tests**

Add assertions for the new local module and safe UI rules:

```js
assert.equal((await fetch(`${origin}/studio3d/assets/captions.js`)).status, 200);
assert.match(sceneSource, /MAX_CAPTIONS/);
assert.match(sceneSource, /depthTest:\s*false/);
assert.doesNotMatch(sceneSource, /userData\.interactive\s*=\s*true/);
assert.match(domSource, /waitingSemanticText/);
assert.match(domSource, /approvalSemanticText/);
```

Extend pure tests so unsafe-looking strings remain literal text, are control-character cleaned/truncated, and never become HTML. In `dashboard-studio-dom.test.js`, read `dom.js` and assert both helpers are invoked with their projected owner and the result is passed to `element()` rather than HTML parsing:

```js
assert.match(domSource, /waitingSemanticText\(session\)/);
assert.match(domSource, /approvalSemanticText\(studio\.approval_summary \?\? null\)/);
assert.match(domSource, /element\(doc, 'span', 'studio-session__waiting', waitingLine\)/);
assert.match(domSource, /element\(doc, 'span', 'studio-orchestrator__approval', approvalLine\)/);
```

- [ ] **Step 2: Run assets/browser/caption tests and confirm RED**

Run: `npx tsx --test tests/dashboard-studio-assets.test.js tests/dashboard-studio-browser-model.test.js tests/dashboard-studio-captions.test.js tests/dashboard-studio-dom.test.js`

Expected: FAIL because the server route, sprite layer, and semantic lines are absent.

- [ ] **Step 3: Add the fail-closed local module route**

Add exactly one allowlist mapping in `server.js`:

```js
['/studio3d/assets/captions.js', path.join(STUDIO3D_DIR, 'captions.js')],
```

The human GLB route already exists; retain it and do not add a wildcard directory route.

- [ ] **Step 4: Add cached company-style sprite materials**

Reuse `makeCanvas`, `canvasSprite`, `panelMaterial`, and `panelCache` discipline. Add a dedicated `captionMaterialCache` keyed by serialized `{ kind, text, opacityBucket }` and draw:

```js
function drawCaptionShape(context, kind, width, height) {
  context.fillStyle = kind === 'action'
    ? 'rgba(12, 25, 35, 0.92)'
    : kind === 'speech' ? 'rgba(248, 245, 237, 0.97)' : 'rgba(239, 244, 247, 0.96)';
  context.strokeStyle = kind === 'speech' ? '#d6a85c' : kind === 'thought' ? '#8fa2b3' : '#5f7487';
  context.lineWidth = kind === 'action' ? 2 : 4;
  context.setLineDash(kind === 'thought' ? [12, 9] : []);
  context.beginPath();
  context.roundRect(8, 8, width - 16, height - 30, kind === 'action' ? 18 : 28);
  context.fill();
  context.stroke();
  if (kind === 'speech') {
    context.setLineDash([]);
    context.beginPath();
    context.moveTo(62, height - 24);
    context.lineTo(86, height - 2);
    context.lineTo(104, height - 24);
    context.closePath();
    context.fill();
    context.stroke();
  }
}

function captionMaterial(fact, opacity = 1) {
  const key = JSON.stringify([fact.kind, fact.text, Math.round(opacity * 10)]);
  if (captionMaterialCache.has(key)) {
    const entry = captionMaterialCache.get(key);
    entry.used = true;
    return entry.material;
  }
  const height = fact.kind === 'action' ? 112 : 176;
  const canvas = makeCanvas(512, height);
  const context = canvas.getContext('2d');
  drawCaptionShape(context, fact.kind, 512, height);
  context.textBaseline = 'middle';
  context.fillStyle = fact.kind === 'action' ? '#f5f7fb' : '#17202a';
  context.font = fact.kind === 'action' ? '600 28px system-ui' : '600 30px system-ui';
  context.fillText(fact.text, 28, fact.kind === 'action' ? 53 : 72);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, opacity });
  captionMaterialCache.set(key, { material, used: true });
  return material;
}
```

At the beginning of each caption sync mark every cache entry `used = false`; after sprites are reconciled, dispose each unused `entry.material.map` and `entry.material` and delete its key, exactly as `panelCache` does. Captions must not set an interactive flag and must be excluded from raycast targets.

- [ ] **Step 5: Reconcile fixed, waiting, and transition caption lifecycles**

Maintain a map of transient transition captions:

```js
function onTransitionStart(transition) {
  const fact = transitionCaptionFact(transition);
  if (fact) transientCaptions.set(transition.id, { fact, completedAt: null, removeOnReconcile: false });
}

function onTransitionComplete(transition, { reducedMotion }) {
  const record = transientCaptions.get(transition.id);
  if (!record) return;
  if (reducedMotion) record.removeOnReconcile = true;
  else record.completedAt = performance.now();
}
```

On each reconcile, combine active approval facts, waiting facts, and transition facts; remove reduced-motion completed records, rank to eight, anchor them above the manager/human/session world positions, and release cache references for removed or changed sprites. During frames, action opacity is `1 - elapsed / 1_000`; remove and dispose/release at zero.

Only create speech/thought conversation facts after the manager reaches the table:

```js
const approvalFacts = animator.managerState() === 'approval'
  ? approvalCaptionFacts(projection.approval_summary ?? null)
  : [];
const waitingFacts = waitingCaptionFacts(projection.sessions ?? []);
const candidateFacts = [...approvalFacts, ...waitingFacts, ...transitionFacts()]
  .map((fact) => ({
    ...fact,
    distance: captionOwnerPosition(fact).distanceTo(camera.position),
  }));
syncCaptionSprites(selectCaptionFacts(candidateFacts));
```

`captionOwnerPosition(fact)` resolves the current world position from the orchestrator handle, `humanApprover.object`, or the fact's session handle and adds a kind-specific head offset before the sprite is placed.

- [ ] **Step 6: Add semantic waiting and approval lines**

Import the same pure helpers into `dom.js` and append only via `textContent`/the existing element helper:

```js
const waitingLine = waitingSemanticText(session);
if (waitingLine) body.append(element(doc, 'span', 'studio-session__waiting', waitingLine));

const approvalLine = approvalSemanticText(studio.approval_summary ?? null);
if (approvalLine) body.append(element(doc, 'span', 'studio-orchestrator__approval', approvalLine));
```

Timeline events remain the semantic source for action captions; do not duplicate every transient action into the session list.

- [ ] **Step 7: Verify caption rendering contracts are GREEN**

Run: `npx tsx --test tests/dashboard-studio-assets.test.js tests/dashboard-studio-browser-model.test.js tests/dashboard-studio-captions.test.js tests/dashboard-studio-dom.test.js tests/dashboard-studio-responsive.test.js`

Expected: all pass with `# fail 0`.

- [ ] **Step 8: Commit dialogue, captions, and semantic parity**

```bash
git add src/observability/dashboard/ui/studio3d/scene.js src/observability/dashboard/ui/studio3d/dom.js src/observability/dashboard/server.js tests/dashboard-studio-assets.test.js tests/dashboard-studio-browser-model.test.js tests/dashboard-studio-captions.test.js tests/dashboard-studio-dom.test.js
git commit -m "feat(studio): show delegation dialogue captions"
```

---

### Task 9: Integrate the full company-floor lifecycle without state fights

**Files:**
- Modify: `src/observability/dashboard/ui/studio3d/scene.js`
- Modify: `src/observability/dashboard/ui/studio3d/animator.js`
- Modify: `tests/dashboard-studio-animator.test.js`
- Modify: `tests/dashboard-studio-browser-model.test.js`

**Interfaces:**
- Consumes: all prior task interfaces.
- Produces: a single stable scene reconciliation path in which stale/disconnected pauses, reduced motion applies final state, session resting states never overwrite active transitions, and manager resting state never overwrites the serial manager arbiter.

- [ ] **Step 1: Add failing integration assertions**

Add tests for these sequences:

```js
test('latest approval state is reconciled after real manager work', () => {
  const { animator, manager, delegation, approvalSummary } = createAnimatorHarness();
  animator.play({ ...delegation, started_at_ms: 1_000 });
  animator.reconcileManager({ approvalActive: true, approvalSummary }, 1_100);
  animator.update(8_000);
  assert.equal(animator.managerState(), 'approval-walk');
  animator.update(11_000);
  assert.equal(animator.managerState(), 'approval');
  assert.equal(manager.mode, 'standing');
});

test('cleared approval does not replay after a check-in', () => {
  const { animator, manager, checkIn } = createAnimatorHarness();
  animator.play({ ...checkIn, started_at_ms: 1_000 });
  animator.reconcileManager({ approvalActive: true, approvalSummary: { pending_count: 1, artifact: 'Release plan' } }, 1_100);
  animator.reconcileManager({ approvalActive: false, approvalSummary: null }, 2_000);
  animator.update(8_000);
  assert.equal(animator.managerState(), 'seated');
  assert.equal(manager.mode, 'sitting');
});

test('reduced motion applies the current manager final state', () => {
  const { animator, manager, approvalSummary, approvalTarget } = createAnimatorHarness({ reducedMotion: true });
  animator.reconcileManager({ approvalActive: true, approvalSummary }, 1_000);
  assert.deepEqual(manager.position.toArray(), approvalTarget);
  assert.equal(manager.mode, 'standing');
  assert.equal(animator.activeCount(), 0);
});

test('freeze and resume preserve transition progress', () => {
  const { animator, session, handoff } = createAnimatorHarness();
  animator.play({ ...handoff, started_at_ms: 1_000 });
  animator.update(1_500);
  const pausedPosition = session.position.clone();
  animator.freeze(1_500);
  animator.update(5_000);
  assert.ok(session.position.equals(pausedPosition));
  animator.resume(5_000);
  animator.update(5_250);
  assert.ok(!session.position.equals(pausedPosition));
});
```

In the browser-model source test, pin all three resource limits:

```js
assert.match(sceneSource, /const MAX_DETAILED_RIGS = 16/);
assert.match(sceneSource, /const MAX_DRAW_CALLS = 200/);
assert.match(sceneSource, /const MAX_TRIANGLES = 200_000/);
```

- [ ] **Step 2: Run animator/browser model tests and confirm RED**

Run: `npx tsx --test tests/dashboard-studio-animator.test.js tests/dashboard-studio-browser-model.test.js`

Expected: at least one new lifecycle integration assertion fails before the reconciliation guards are complete.

- [ ] **Step 3: Centralize resting and pause ownership**

Use explicit ownership checks in `scene.js`:

```js
function applyRestingStates(projection) {
  for (const session of projection.sessions ?? []) {
    if (!animator.isSessionActive(session.id)) applySessionRestingState(session);
  }
  if (animator.managerState() === 'seated') applyManagerSeat();
}

function applySceneFreshness(projection) {
  const paused = projection.connection?.status === 'disconnected' || projection.stale === true;
  if (paused) pause();
  else resume();
}
```

The actual freshness fields must follow the existing projection contract. Gantry packet motion, ambience, action fades, and locomotion all use the scene's existing paused/reduced flags.

- [ ] **Step 4: Verify the complete studio test slice**

Run:

```bash
npx tsx --test \
  tests/dashboard-studio-office.test.js \
  tests/dashboard-studio-locomotion.test.js \
  tests/dashboard-studio-assets.test.js \
  tests/dashboard-studio-robot.test.js \
  tests/dashboard-studio-behavior.test.js \
  tests/dashboard-studio-transitions.test.js \
  tests/dashboard-studio-animator.test.js \
  tests/dashboard-studio-captions.test.js \
  tests/dashboard-studio-projection.test.js \
  tests/dashboard-studio-browser-model.test.js \
  tests/dashboard-studio-dom.test.js \
  tests/dashboard-studio-responsive.test.js
```

Expected: every selected file passes and the summary reports `# fail 0`.

- [ ] **Step 5: Commit reconciliation safeguards**

```bash
git add src/observability/dashboard/ui/studio3d/scene.js src/observability/dashboard/ui/studio3d/animator.js tests/dashboard-studio-animator.test.js tests/dashboard-studio-browser-model.test.js
git commit -m "fix(studio): preserve interaction state ownership"
```

---

### Task 10: Capture live browser evidence and measured diagnostics

**Files:**
- Create: `docs/evidence/studio-interaction-wave/manager-seated.png`
- Create: `docs/evidence/studio-interaction-wave/manager-check-in.png`
- Create: `docs/evidence/studio-interaction-wave/approval-conversation.png`
- Create: `docs/evidence/studio-interaction-wave/action-caption.png`
- Create: `docs/evidence/studio-interaction-wave/corridor-gantry.png`
- Create: `docs/evidence/studio-interaction-wave/reduced-motion.png`
- Create: `docs/evidence/studio-interaction-wave/verification.md`

**Interfaces:**
- Consumes: a scratch RStack project with a manifest, tasks, and append-only lifecycle event log.
- Produces: six reviewable screenshots and a diagnostics table with sampled draw calls, triangles, tier, renderer, motion mode, and scene state.

- [ ] **Step 1: Seed a scratch live run using real projection event shapes**

Create the scratch files under `/tmp/rstack-studio-interaction-wave` (not in git) with run id `interaction-wave-proof`. Use the exact event keys already covered in `tests/dashboard-studio-projection.test.js`, including at least:

```json
{"type":"agent_session_started","run_id":"interaction-wave-proof","agent_session_id":"builder-1","task_id":"task-build","role":"builder","timestamp":"2026-07-15T10:00:00.000Z"}
{"type":"agent_waiting","run_id":"interaction-wave-proof","agent_session_id":"validator-1","task_id":"task-validate","role":"validator","reason_class":"approval","timestamp":"2026-07-15T10:00:01.000Z"}
```

The initial projection should show an active office with the manager seated and no pending governance item. Later events must be appended after the page is loaded so transition playback stamps `started_at_ms` on arrival.

- [ ] **Step 2: Start the local dashboard with the required environment**

Run:

```bash
RSTACK_NO_BROWSER=1 \
RSTACK_REGISTRY_DIR=/tmp/rstack-studio-interaction-wave/.registry \
node src/observability/dashboard/server.js \
  --port 3377 \
  --no-browser \
  --project /tmp/rstack-studio-interaction-wave
```

Expected: server listens on `http://127.0.0.1:3377` without opening a GUI browser.

- [ ] **Step 3: Load Chromium with software WebGL and wait for Three.js**

Launch Playwright Chromium with:

```js
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
await page.goto('http://127.0.0.1:3377');
await page.waitForSelector('#studio-app[data-renderer="three"]');
```

Use a desktop viewport large enough for the default overview camera and semantic UI, such as `1600x1000`.

- [ ] **Step 4: Capture all six required states**

Capture in this order, appending events between shots and polling until the matching caption/motion state is visible:

1. `manager-seated.png`: manager seated in the embedded red battlestation chair.
2. `manager-check-in.png`: append a real `handoff_created` or `task_retry_scheduled`; capture the manager between HQ and the involved worker desk.
3. `approval-conversation.png`: add a pending governance item; capture manager and human at the strategy table with both speech bubbles.
4. `action-caption.png`: append `agent_capabilities_attached` with `skill_ids`; capture `collecting <skill_id>` mid-transition.
5. `corridor-gantry.png`: default camera framing with readable west-to-east panels and packets flowing only through the furthest reached stage.
6. `reduced-motion.png`: emulate `prefers-reduced-motion: reduce`, reload, and capture static final states with no transient fade/mid-stride pose.

Do not use arbitrary sleeps as proof. Poll the relevant semantic text, manager state, or stable screenshot pixel/diagnostic condition with a bounded timeout.

- [ ] **Step 5: Poll a diagnostics series and record measured maxima**

Read several samples because diagnostic attributes freeze when the render loop idles:

```js
const samples = [];
for (let index = 0; index < 12; index += 1) {
  samples.push(await page.locator('#studio-app').evaluate((node) => ({
    renderer: node.dataset.renderer,
    drawCalls: Number(node.dataset.studioDrawCalls),
    triangles: Number(node.dataset.studioTriangles),
    tier: node.dataset.studioTier,
    rigs: Number(node.dataset.studioActiveRigs),
  })));
  await page.waitForTimeout(250);
}
```

Record maximum draw calls/triangles and observed tier in `verification.md`. Required result: max draw calls `<= 200`, max triangles `<= 200000`, detailed rigs `<= 16`.

- [ ] **Step 6: Visually inspect every PNG**

Open all six images and confirm:

- gantry panels are readable from the default overview and clear the corridor;
- manager body contacts the red chair with knees/arms plausibly seated;
- human contacts the brown chair and faces the room/table correctly;
- bubbles do not overlap important agent faces or the primary studio controls;
- speech, thought, and action styles are visually distinct but restrained;
- reduced motion shows no walking pose or fading caption residue.

If any check fails, return to the responsible implementation task, add a regression assertion when possible, and recapture the affected image.

- [ ] **Step 7: Commit measured evidence**

```bash
git add docs/evidence/studio-interaction-wave/manager-seated.png docs/evidence/studio-interaction-wave/manager-check-in.png docs/evidence/studio-interaction-wave/approval-conversation.png docs/evidence/studio-interaction-wave/action-caption.png docs/evidence/studio-interaction-wave/corridor-gantry.png docs/evidence/studio-interaction-wave/reduced-motion.png docs/evidence/studio-interaction-wave/verification.md
git commit -m "docs(studio): add interaction wave evidence"
```

---

### Task 11: Run every release gate and open the umbrella PR

**Files:**
- Modify only if a gate exposes a defect; place each fix with its regression test in a new focused commit.
- Use: `docs/evidence/studio-interaction-wave/verification.md`

**Interfaces:**
- Consumes: the complete branch and committed evidence.
- Produces: a pushed branch and ready PR against `codex/studio-agent-force` with issue closure and per-task evidence.

- [ ] **Step 1: Run the full test suite and inspect the failure count**

Run: `npm test`

Expected final lines include `# fail 0`. A pass count without this exact zero-failure summary is not sufficient. If the known harness cleanup race appears, rerun the individual file once to classify the environment flake, then rerun the full suite until it reports `# fail 0`.

- [ ] **Step 2: Run all remaining gates separately**

Run each command and require exit code zero:

```bash
npm run lint
npm run typecheck
npm run validate
node scripts/security-audit.mjs
git diff --check
```

Record command, result, and relevant counts in `verification.md`. If updating the evidence file changes the tree, commit only that file:

```bash
git add docs/evidence/studio-interaction-wave/verification.md
git commit -m "docs(studio): record final verification gates"
```

- [ ] **Step 3: Inspect scope and commit history**

Run:

```bash
git status --short
git diff --stat origin/codex/studio-agent-force...HEAD
git log --oneline origin/codex/studio-agent-force..HEAD
```

Expected: clean worktree; only studio runtime, projection, tests, design/plan, and evidence files are present; commits remain logically bisectable.

- [ ] **Step 4: Push the working branch**

Run: `git push -u origin codex/studio-interaction-wave`

Expected: remote branch is created or updated successfully.

- [ ] **Step 5: Open the PR with the required base and evidence**

Create a ready PR using base `codex/studio-agent-force`. The body must contain:

```markdown
## What shipped
- overhead 15-stage corridor gantry with honest packets
- seated manager with delegation and event-driven teammate check-ins
- human approver and projection-driven strategy-table conversation
- bounded speech/thought/action captions with semantic parity

## Verification evidence
| Scenario | Screenshot | Diagnostics |
| --- | --- | --- |
| Manager seated | [PNG](https://raw.githubusercontent.com/richard-devbot/SDLC-rstack/codex/studio-interaction-wave/docs/evidence/studio-interaction-wave/manager-seated.png) | [Recorded samples](https://github.com/richard-devbot/SDLC-rstack/blob/codex/studio-interaction-wave/docs/evidence/studio-interaction-wave/verification.md) |
| Manager check-in | [PNG](https://raw.githubusercontent.com/richard-devbot/SDLC-rstack/codex/studio-interaction-wave/docs/evidence/studio-interaction-wave/manager-check-in.png) | Recorded samples |
| Approval conversation | [PNG](https://raw.githubusercontent.com/richard-devbot/SDLC-rstack/codex/studio-interaction-wave/docs/evidence/studio-interaction-wave/approval-conversation.png) | Recorded samples |
| Session action caption | [PNG](https://raw.githubusercontent.com/richard-devbot/SDLC-rstack/codex/studio-interaction-wave/docs/evidence/studio-interaction-wave/action-caption.png) | Recorded samples |
| Corridor gantry | [PNG](https://raw.githubusercontent.com/richard-devbot/SDLC-rstack/codex/studio-interaction-wave/docs/evidence/studio-interaction-wave/corridor-gantry.png) | Recorded samples |
| Reduced motion | [PNG](https://raw.githubusercontent.com/richard-devbot/SDLC-rstack/codex/studio-interaction-wave/docs/evidence/studio-interaction-wave/reduced-motion.png) | Recorded samples |

## Gates
- `npm test` — `# fail 0`
- `npm run lint` — 0 errors
- `npm run typecheck` — passed
- `npm run validate` — passed
- `node scripts/security-audit.mjs` — passed
- `git diff --check` — passed

## Context
- Closes #385
- Part of #361
- Builds on #377

## Deviations
- None.
```

Replace `None` only when the completed implementation actually deviates, and copy the measured draw-call/triangle/tier maxima from `verification.md` into the prose immediately above the table.

Double-check the PR base before submitting; it must not be `main`.

- [ ] **Step 6: Verify remote issue and PR state**

Run:

```bash
gh issue view 385 --json state,url
gh pr view --json number,url,baseRefName,headRefName,state,isDraft
```

Expected: issue #385 remains open for automatic closure, PR base is `codex/studio-agent-force`, head is `codex/studio-interaction-wave`, and the PR is ready for review.
