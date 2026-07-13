# Agent Force Living Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the abstract Agent Force Studio geometry with an original CPU-first robot company whose humanoid agents walk, sit, work, validate, wait, hand off tasks, raise alerts, and return evidence only when server-owned lifecycle state supports those actions.

**Architecture:** Keep `state.studio` and its normalized lifecycle timeline authoritative. Add a pure behavior mapper, authored office topology, procedural humanoid rig, transition-only animation controller, and HTML overlay layer; integrate them through the existing reconciler and scene composition root. The semantic DOM remains canonical, while Three.js mirrors the same entities and pauses whenever no camera or source-backed transition requires rendering.

**Tech Stack:** JavaScript ES modules, TypeScript integration surface, Three.js r180 served locally, Node test runner through `tsx`, CSS, existing Business Hub state/WebSocket transport.

## Global Constraints

- Use original procedural Three.js geometry; do not introduce stock artwork, GLTF characters, public CDNs, physics engines, navigation meshes, post-processing chains, or large texture atlases.
- Walking, sitting, typing, carrying, alerts, handoffs, retries, completion, and departure require server-owned projection state or persisted lifecycle events.
- A quiet backend produces a quiet office; subtle servo settling is allowed only for an existing live session and cannot imply work or progress.
- Preserve one Orchestrator HQ, eight mission groupings, exactly fifteen reusable canonical departments, one Skills and Plugin Library, pooled Builder desks, a separate glass Validator Lab, Governance, Dispatch, and an Evidence Vault.
- Cap detailed active-session robots at 16; additional sessions remain available in the semantic view and appear as an aggregate in the scene.
- Keep overview at or below 90 draw calls and 200,000 rendered triangles on the deterministic full-load fixture.
- Target 30 frames per second at default quality and 15 frames per second at low quality; transition update work should stay below 4 ms on the project baseline machine.
- `prefers-reduced-motion` and the Studio motion control must apply final poses immediately without walking, typing, camera flight, object travel, pulsing, or materialization.
- The canvas remains `aria-hidden`; the semantic DOM remains the canonical interaction and reading tree.
- Never expose raw prompts, chain-of-thought, secrets, tokens, environment values, command arguments, or unrestricted filesystem paths.
- Keep all state-changing operations in the existing authenticated and audited cockpit; this Studio remains read-only.
- Every source file retains the owner label `RStack developed by Richardson Gunde`.

## File Structure

### New modules

- `src/observability/dashboard/ui/studio3d/behavior.js` — pure lifecycle-to-robot intent and safe activity-gesture mapping.
- `src/observability/dashboard/ui/studio3d/robot-poses.js` — immutable joint rotations for standing, walking, sitting, working, waiting, handoff, failure, and completion.
- `src/observability/dashboard/ui/studio3d/robot.js` — original procedural humanoid hierarchy, face/status control, and pose application.
- `src/observability/dashboard/ui/studio3d/office.js` — instanced office architecture, desks, chairs, monitors, glass lab, library, Governance, Dispatch, and Vault.
- `src/observability/dashboard/ui/studio3d/animator.js` — waypoint travel, pose blending, task/evidence packets, and transition-only update loop.
- `src/observability/dashboard/ui/studio3d/overlays.js` — projected HTML labels and scoped agent/stage notifications.
- `tests/dashboard-studio-behavior.test.js` — behavior mapping, freeze, deduplication, and aggregation contracts.
- `tests/dashboard-studio-robot.test.js` — rig hierarchy, face state, pose, seat/desk anchor, and pool-reset contracts.
- `tests/dashboard-studio-office.test.js` — office topology, fifteen-stage identity, workstation, and asset-budget contracts.
- `tests/dashboard-studio-animator.test.js` — deterministic routes, reduced motion, event ordering, and transition-only updates.

### Modified modules

- `src/observability/dashboard/ui/studio3d/topology.js` — replace radial slots with authored company-floor anchors and waypoint routes.
- `src/observability/dashboard/ui/studio3d/geometry.js` — replace cylinders/pylons with robot-backed entity handles and a bright precision-workshop material pool.
- `src/observability/dashboard/ui/studio3d/reconciler.js` — preserve stable identity while exposing robot handles and a 16-rig aggregate.
- `src/observability/dashboard/ui/studio3d/transitions.js` — emit explicit robot intents instead of abstract pulse/materialize kinds.
- `src/observability/dashboard/ui/studio3d/scene.js` — compose office, animator, overlays, camera levels, freeze, and diagnostics.
- `src/observability/dashboard/ui/studio3d/dom.js` — expose stage, activity class, capabilities, scoped notification evidence, and selected-agent parity.
- `src/observability/dashboard/ui/studio3d/app.js` — pass overlay root, connection freeze state, and renderer quality behavior.
- `src/observability/dashboard/ui/studio3d/styles.css` — bright office shell, label/alert states, agent inspector, responsive and reduced-motion behavior.
- `src/observability/dashboard/ui/studio3d.js` — add overlay and diagnostics hosts without changing semantic ownership.
- `tests/dashboard-studio-browser-model.test.js` — new module contracts, topology, selection, and diagnostics.
- `tests/dashboard-studio-responsive.test.js` — overlay accessibility, 390 px layout, and reduced-motion checks.
- `tests/dashboard-studio-assets.test.js` — allow-list the new local modules and preserve vendor confinement.

---

### Task 1: Source-backed robot behavior and authored company topology

**Files:**
- Create: `src/observability/dashboard/ui/studio3d/behavior.js`
- Modify: `src/observability/dashboard/ui/studio3d/topology.js`
- Create: `tests/dashboard-studio-behavior.test.js`
- Modify: `tests/dashboard-studio-browser-model.test.js`

**Interfaces:**
- Consumes: `studio.sessions[]`, `studio.timeline[]`, `studio.freshness`, connection state, and canonical mission/department ordering.
- Produces: `behaviorIntent(event) -> { action, sessionId, taskId, stageIds, gesture, notification } | null`, `restingBehavior(session) -> string`, `freezeReason(studio, connectionState) -> string | null`, `STUDIO_TOPOLOGY`, `workstationSlot(session, projection, index)`, and `routePoints(routeName)`.

- [ ] **Step 1: Write failing behavior and topology tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  behaviorIntent,
  freezeReason,
  restingBehavior,
  safeActivityGesture,
} from '../src/observability/dashboard/ui/studio3d/behavior.js';
import {
  STUDIO_TOPOLOGY,
  routePoints,
  workstationSlot,
} from '../src/observability/dashboard/ui/studio3d/topology.js';

test('lifecycle events map to explicit robot actions without inventing work', () => {
  assert.deepEqual(behaviorIntent({
    type: 'agent_session_started', entity_id: 'session-7', task_id: '004-implementation', stage_ids: ['08-implementation'],
  }), {
    action: 'enter', sessionId: 'session-7', taskId: '004-implementation', stageIds: ['08-implementation'],
    gesture: null, notification: null,
  });
  assert.equal(behaviorIntent({ type: 'poll_received', entity_id: 'session-7' }), null);
  assert.equal(behaviorIntent({ type: 'agent_activity', entity_id: 'session-7', activity_class: 'file' }).gesture, 'keyboard');
  assert.equal(behaviorIntent({ type: 'agent_waiting', entity_id: 'session-7', reason_class: 'approval' }).notification, 'approval');
});

test('resting behavior, activity gestures, and freeze are conservative', () => {
  assert.equal(restingBehavior({ role: 'validator', status: 'active' }), 'validating');
  assert.equal(restingBehavior({ role: 'builder', status: 'active' }), 'seated_work');
  assert.equal(restingBehavior({ role: 'builder', status: 'waiting' }), 'waiting');
  assert.equal(safeActivityGesture('unknown-command'), 'status_only');
  assert.equal(freezeReason({ freshness: { state: 'stale' } }, 'live'), 'stale');
  assert.equal(freezeReason({ freshness: { state: 'fresh' } }, 'disconnected'), 'disconnected');
});

test('company topology has fixed facilities, fifteen departments, and authored routes', () => {
  assert.equal(STUDIO_TOPOLOGY.departments.length, 15);
  assert.equal(STUDIO_TOPOLOGY.builderDesks.length, 8);
  assert.equal(STUDIO_TOPOLOGY.validatorDesks.length, 4);
  assert.notDeepEqual(STUDIO_TOPOLOGY.dispatch.position, STUDIO_TOPOLOGY.library.position);
  const slot = workstationSlot({ role: 'validator' }, { sessions: [] }, 0);
  assert.equal(slot.id, 'validator-desk-1');
  assert.deepEqual(routePoints('dispatch_to_library').at(0), STUDIO_TOPOLOGY.dispatch.position);
  assert.deepEqual(routePoints('dispatch_to_library').at(-1), STUDIO_TOPOLOGY.library.entry);
});
```

- [ ] **Step 2: Run the focused test and confirm the missing-module failure**

Run: `npx tsx --test tests/dashboard-studio-behavior.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `studio3d/behavior.js`.

- [ ] **Step 3: Add the pure behavior mapper**

```js
/** Source-backed robot behavior mapping. owner: RStack developed by Richardson Gunde */
const ACTIONS = Object.freeze({
  delegation_requested: ['delegate', null, null],
  agent_session_started: ['enter', null, null],
  agent_session_ready: ['walk_to_assignment', null, null],
  agent_capabilities_attached: ['collect_capabilities', null, null],
  agent_activity: ['work', null, null],
  agent_waiting: ['wait', null, 'waiting'],
  approval_gate_blocked: ['wait', null, 'approval'],
  dor_gate_blocked: ['wait', null, 'guardrail'],
  guardrail_blocked: ['wait', null, 'guardrail'],
  task_human_context_required: ['wait', null, 'context'],
  task_retry_exhausted: ['fail', null, 'retry_exhausted'],
  task_blocked_by_validator: ['wait', null, 'validation'],
  handoff_created: ['handoff', null, 'handoff'],
  artifact_emitted: ['return_evidence', null, 'evidence'],
  task_retry_scheduled: ['retry', null, 'retry'],
  agent_session_completed: ['complete', null, 'complete'],
  agent_session_failed: ['fail', null, 'failure'],
  agent_session_stopped: ['exit', null, null],
});

const GESTURES = Object.freeze({
  planning: 'monitor_focus', reading: 'monitor_focus', file: 'keyboard', file_edit: 'keyboard',
  tool: 'mouse', tool_call: 'mouse', test: 'validation_monitor', validation: 'validation_monitor',
  artifact: 'output_dock', unknown: 'status_only',
});

export function safeActivityGesture(value) {
  return GESTURES[String(value ?? 'unknown').toLowerCase()] ?? 'status_only';
}

export function behaviorIntent(event) {
  const definition = ACTIONS[event?.type];
  if (!definition) return null;
  return {
    action: definition[0],
    sessionId: event.agent_session_id ?? event.session_id ?? event.entity_id ?? null,
    taskId: event.task_id ?? null,
    stageIds: Array.isArray(event.stage_ids) ? [...event.stage_ids] : [],
    gesture: event.type === 'agent_activity' ? safeActivityGesture(event.activity_class) : definition[1],
    notification: event.reason_class ?? definition[2],
  };
}

export function restingBehavior(session) {
  if (session?.status === 'failed') return 'failed';
  if (session?.status === 'waiting' || session?.status === 'blocked') return 'waiting';
  if (session?.status === 'completed') return 'complete';
  if (session?.status !== 'active') return 'standing';
  return session?.role === 'validator' ? 'validating' : 'seated_work';
}

export function freezeReason(studio, connectionState) {
  if (['disconnected', 'error'].includes(connectionState)) return connectionState;
  if (studio?.freshness?.state === 'stale') return 'stale';
  return null;
}
```

- [ ] **Step 4: Replace radial topology with authored company anchors**

```js
const point = (x, y, z) => Object.freeze([x, y, z]);
const slot = (id, x, y, z, yaw = 0) => Object.freeze({ id, position: point(x, y, z), rotation: point(0, yaw, 0) });
const row = (prefix, count, startX, stepX, z, yaw = 0) => Object.freeze(
  Array.from({ length: count }, (_, index) => slot(`${prefix}-${index + 1}`, startX + index * stepX, 0, z, yaw)),
);

export const STUDIO_TOPOLOGY = Object.freeze({
  orchestrator: slot('orchestrator-hq', 0, 0, -10, 0),
  dispatch: slot('dispatch', -15, 0, 8, Math.PI / 2),
  library: Object.freeze({ ...slot('skills-library', -13, 0, -6, Math.PI / 2), entry: point(-10.5, 0, -6) }),
  governance: Object.freeze({ ...slot('governance-room', 13, 0, -7, -Math.PI / 2), entry: point(10.5, 0, -7) }),
  evidence: Object.freeze({ ...slot('evidence-vault', 14, 0, 7, -Math.PI / 2), entry: point(11.5, 0, 7) }),
  missions: row('mission-board', 8, -10.5, 3, -12.5),
  departments: Object.freeze([
    ...row('department', 8, -10.5, 3, -1.8),
    ...row('department', 7, -9, 3, 1.8, Math.PI),
  ]),
  builderDesks: row('builder-desk', 8, -10.5, 3, 8.5, Math.PI),
  validatorDesks: row('validator-desk', 4, 3.5, 3, 8.5, Math.PI),
  validator: slot('validator-lab', 8, 0, 8.5, Math.PI),
  builderPool: slot('builder-bullpen', -6, 0, 8.5, Math.PI),
  overviewTarget: point(0, 0, 0),
  overviewCamera: point(22, 26, 29),
  routes: Object.freeze({
    dispatch_to_library: Object.freeze([point(-15, 0, 8), point(-12, 0, 5), point(-10.5, 0, -6)]),
    library_to_builder: Object.freeze([point(-10.5, 0, -6), point(-8, 0, 3.8), point(-6, 0, 7)]),
    library_to_validator: Object.freeze([point(-10.5, 0, -6), point(0, 0, 3.8), point(8, 0, 7)]),
    builder_to_validator: Object.freeze([point(-6, 0, 7), point(0, 0, 5.3), point(8, 0, 7)]),
    assignment_to_governance: Object.freeze([point(0, 0, 5.3), point(8, 0, 2), point(10.5, 0, -7)]),
    assignment_to_vault: Object.freeze([point(0, 0, 5.3), point(8, 0, 5.3), point(11.5, 0, 7)]),
  }),
});

export function topologySlot(kind, index = 0) {
  if (kind === 'mission') return STUDIO_TOPOLOGY.missions[index % 8];
  if (kind === 'department') return STUDIO_TOPOLOGY.departments[index % 15];
  return STUDIO_TOPOLOGY[kind] ?? STUDIO_TOPOLOGY.orchestrator;
}

export function workstationSlot(session, projection, index = 0) {
  const collection = session?.role === 'validator' ? STUDIO_TOPOLOGY.validatorDesks : STUDIO_TOPOLOGY.builderDesks;
  return collection[index % collection.length];
}

export function sessionPosition(session, projection, index = 0) {
  return workstationSlot(session, projection, index).position;
}

export function routePoints(name) {
  return STUDIO_TOPOLOGY.routes[name] ?? Object.freeze([]);
}
```

- [ ] **Step 5: Run focused browser-model and behavior tests**

Run: `npx tsx --test tests/dashboard-studio-behavior.test.js tests/dashboard-studio-browser-model.test.js`

Expected: PASS with the topology contract reporting 8 mission groupings and 15 unique departments.

- [ ] **Step 6: Commit the behavior foundation**

```bash
git add src/observability/dashboard/ui/studio3d/behavior.js src/observability/dashboard/ui/studio3d/topology.js tests/dashboard-studio-behavior.test.js tests/dashboard-studio-browser-model.test.js
git commit -m "feat: define living Studio behavior and topology"
```

### Task 2: Original procedural humanoid rig and authored poses

**Files:**
- Create: `src/observability/dashboard/ui/studio3d/robot-poses.js`
- Create: `src/observability/dashboard/ui/studio3d/robot.js`
- Modify: `src/observability/dashboard/ui/studio3d/geometry.js`
- Create: `tests/dashboard-studio-robot.test.js`

**Interfaces:**
- Consumes: shared resource pool geometries/materials and a session `{ role, status, id }`.
- Produces: `ROBOT_POSES`, `createHumanoidRobot(pool, data) -> RobotHandle`, `applyRobotPose(handle, poseName, weight)`, and `setRobotFace(handle, state)`. `RobotHandle` contains `object`, `joints`, `anchors`, `setPose`, `setFace`, `update`, `reset`, and `dispose`.

- [ ] **Step 1: Write failing rig, pose, and workstation-contact tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createResourcePool } from '../src/observability/dashboard/ui/studio3d/geometry.js';
import { createHumanoidRobot } from '../src/observability/dashboard/ui/studio3d/robot.js';
import { ROBOT_POSES } from '../src/observability/dashboard/ui/studio3d/robot-poses.js';

test('humanoid robot exposes the complete articulated hierarchy', () => {
  const pool = createResourcePool();
  const robot = createHumanoidRobot(pool, { id: 'session-1', role: 'builder', status: 'active' });
  for (const name of ['pelvis', 'torso', 'head', 'shoulderLeft', 'elbowLeft', 'wristLeft', 'shoulderRight', 'elbowRight', 'wristRight', 'hipLeft', 'kneeLeft', 'ankleLeft', 'hipRight', 'kneeRight', 'ankleRight']) {
    assert.ok(robot.joints[name] instanceof THREE.Object3D, name);
  }
  assert.equal(robot.object.userData.robotHandle, robot);
  robot.dispose();
  pool.dispose();
});

test('seated and work poses stay finite and use authored contact anchors', () => {
  assert.equal(Object.isFrozen(ROBOT_POSES), true);
  const pool = createResourcePool();
  const robot = createHumanoidRobot(pool, { id: 'session-2', role: 'builder', status: 'active' });
  robot.setPose('seated_work');
  robot.object.updateMatrixWorld(true);
  for (const joint of Object.values(robot.joints)) {
    assert.ok([joint.rotation.x, joint.rotation.y, joint.rotation.z].every(Number.isFinite));
  }
  assert.ok(robot.anchors.seat.position.y < robot.anchors.screenFocus.position.y);
  assert.ok(robot.anchors.keyboard.position.z > robot.anchors.seat.position.z);
  robot.dispose();
  pool.dispose();
});
```

- [ ] **Step 2: Run the rig test and confirm the missing-module failure**

Run: `npx tsx --test tests/dashboard-studio-robot.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `studio3d/robot.js`.

- [ ] **Step 3: Add immutable authored poses**

```js
/** Authored humanoid poses. owner: RStack developed by Richardson Gunde */
const rotation = (x = 0, y = 0, z = 0) => Object.freeze([x, y, z]);
const pose = (values) => Object.freeze(values);

export const ROBOT_POSES = Object.freeze({
  standing: pose({ torso: rotation(), head: rotation(), shoulderLeft: rotation(0, 0, 0.08), shoulderRight: rotation(0, 0, -0.08), hipLeft: rotation(), hipRight: rotation(), kneeLeft: rotation(), kneeRight: rotation() }),
  walkA: pose({ shoulderLeft: rotation(-0.48), shoulderRight: rotation(0.48), hipLeft: rotation(0.55), hipRight: rotation(-0.55), kneeLeft: rotation(0.22), kneeRight: rotation(0.7) }),
  walkB: pose({ shoulderLeft: rotation(0.48), shoulderRight: rotation(-0.48), hipLeft: rotation(-0.55), hipRight: rotation(0.55), kneeLeft: rotation(0.7), kneeRight: rotation(0.22) }),
  seated_work: pose({ torso: rotation(-0.08), head: rotation(-0.08), shoulderLeft: rotation(-0.62, 0.12, 0.12), shoulderRight: rotation(-0.62, -0.12, -0.12), elbowLeft: rotation(-1.05), elbowRight: rotation(-1.05), hipLeft: rotation(-1.48), hipRight: rotation(-1.48), kneeLeft: rotation(1.45), kneeRight: rotation(1.45) }),
  validating: pose({ torso: rotation(-0.05), head: rotation(-0.14, 0.18), shoulderLeft: rotation(-0.45), shoulderRight: rotation(-0.8), elbowLeft: rotation(-0.9), elbowRight: rotation(-1.12), hipLeft: rotation(-1.48), hipRight: rotation(-1.48), kneeLeft: rotation(1.45), kneeRight: rotation(1.45) }),
  waiting: pose({ torso: rotation(0, 0.2), head: rotation(0, 0.42), shoulderLeft: rotation(-0.15), shoulderRight: rotation(-0.15), elbowLeft: rotation(-0.45), elbowRight: rotation(-0.45) }),
  handoff: pose({ torso: rotation(-0.06), shoulderLeft: rotation(-0.9, 0.15), shoulderRight: rotation(-0.9, -0.15), elbowLeft: rotation(-0.52), elbowRight: rotation(-0.52) }),
  failed: pose({ torso: rotation(0.12), head: rotation(0.28), shoulderLeft: rotation(0.15), shoulderRight: rotation(0.15) }),
  complete: pose({ torso: rotation(), head: rotation(-0.05), shoulderRight: rotation(-1.1, 0, -0.35), elbowRight: rotation(-0.7) }),
});
```

- [ ] **Step 4: Build the humanoid transform hierarchy and semantic face**

```js
import * as THREE from 'three';
import { ROBOT_POSES } from './robot-poses.js';

const FACE_COLORS = Object.freeze({ neutral: 0x8b96a6, focused: 0xe5b860, attentive: 0x71a7ff, waiting: 0x9e82ed, alert: 0xff5f57, complete: 0x58bd86 });
const part = (geometry, material, scale) => {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.scale.set(...scale);
  return mesh;
};
const joint = (name, parent, position) => {
  const group = new THREE.Group();
  group.name = name;
  group.position.set(...position);
  parent.add(group);
  return group;
};

export function applyRobotPose(handle, poseName, weight = 1) {
  const selected = ROBOT_POSES[poseName] ?? ROBOT_POSES.standing;
  for (const [name, value] of Object.entries(selected)) {
    const target = handle.joints[name];
    if (!target) continue;
    target.rotation.x += (value[0] - target.rotation.x) * weight;
    target.rotation.y += (value[1] - target.rotation.y) * weight;
    target.rotation.z += (value[2] - target.rotation.z) * weight;
  }
  handle.pose = poseName in ROBOT_POSES ? poseName : 'standing';
}

export function setRobotFace(handle, state) {
  handle.face.material.color.setHex(FACE_COLORS[state] ?? FACE_COLORS.neutral);
  handle.face.material.emissive.setHex(FACE_COLORS[state] ?? FACE_COLORS.neutral);
  handle.face.userData.state = state in FACE_COLORS ? state : 'neutral';
}

export function createHumanoidRobot(pool, data = {}) {
  const object = new THREE.Group();
  const joints = {};
  const pelvis = joints.pelvis = joint('pelvis', object, [0, 1.05, 0]);
  const torso = joints.torso = joint('torso', pelvis, [0, 0.55, 0]);
  torso.add(part(pool.geometries.slab, pool.materials.robotShell, [0.48, 0.52, 0.28]));
  const neck = joint('neck', torso, [0, 0.58, 0]);
  const head = joints.head = joint('head', neck, [0, 0.18, 0]);
  head.add(part(pool.geometries.slab, pool.materials.robotShell, [0.38, 0.3, 0.31]));
  const face = part(pool.geometries.slab, pool.materials.robotFace.clone(), [0.28, 0.13, 0.025]);
  face.position.set(0, 0, 0.32); head.add(face);

  const limb = (side, sign) => {
    const shoulder = joints[`shoulder${side}`] = joint(`shoulder${side}`, torso, [0.55 * sign, 0.38, 0]);
    const elbow = joints[`elbow${side}`] = joint(`elbow${side}`, shoulder, [0, -0.52, 0]);
    const wrist = joints[`wrist${side}`] = joint(`wrist${side}`, elbow, [0, -0.46, 0]);
    shoulder.add(part(pool.geometries.cylinder, pool.materials.robotJoint, [0.12, 0.46, 0.12]));
    elbow.add(part(pool.geometries.cylinder, pool.materials.robotShell, [0.1, 0.4, 0.1]));
    wrist.add(part(pool.geometries.sphere, pool.materials.robotJoint, [0.13, 0.13, 0.13]));
    const hip = joints[`hip${side}`] = joint(`hip${side}`, pelvis, [0.24 * sign, -0.04, 0]);
    const knee = joints[`knee${side}`] = joint(`knee${side}`, hip, [0, -0.62, 0]);
    const ankle = joints[`ankle${side}`] = joint(`ankle${side}`, knee, [0, -0.58, 0]);
    hip.add(part(pool.geometries.cylinder, pool.materials.robotShell, [0.15, 0.55, 0.15]));
    knee.add(part(pool.geometries.cylinder, pool.materials.robotJoint, [0.13, 0.5, 0.13]));
    const foot = part(pool.geometries.slab, pool.materials.robotShell, [0.2, 0.1, 0.36]); foot.position.z = 0.16; ankle.add(foot);
  };
  limb('Left', -1); limb('Right', 1);

  const handle = {
    object, joints, face, pose: 'standing',
    anchors: Object.freeze({ seat: new THREE.Object3D(), keyboard: new THREE.Object3D(), screenFocus: new THREE.Object3D(), handoff: new THREE.Object3D() }),
    setPose(name, weight = 1) { applyRobotPose(handle, name, weight); },
    setFace(state) { setRobotFace(handle, state); },
    update(next) { handle.setFace(next.status === 'failed' ? 'alert' : next.status === 'completed' ? 'complete' : next.status === 'waiting' ? 'waiting' : 'focused'); },
    reset() { object.position.set(0, 0, 0); object.rotation.set(0, 0, 0); handle.setPose('standing'); handle.setFace('neutral'); },
    dispose() { face.material.dispose(); object.removeFromParent(); },
  };
  handle.anchors.seat.position.set(0, 0.9, 0.2);
  handle.anchors.keyboard.position.set(0, 1.35, 0.75);
  handle.anchors.screenFocus.position.set(0, 2.0, 1.45);
  handle.anchors.handoff.position.set(0, 1.45, 0.9);
  Object.values(handle.anchors).forEach((anchor) => object.add(anchor));
  object.userData.robotHandle = handle;
  object.userData.role = data.role ?? 'builder';
  object.userData.data = data;
  object.userData.entityRef = { kind: 'session', id: data.id };
  handle.update(data); handle.setPose('standing');
  return handle;
}
```

- [ ] **Step 5: Extend the resource pool with shared robot primitives and materials**

```js
geometries.sphere = new THREE.SphereGeometry(1, 12, 8);
materials.robotShell = material(0xe8e6df, { metalness: 0.35, roughness: 0.48 });
materials.robotJoint = material(0x3d434b, { metalness: 0.55, roughness: 0.42 });
materials.robotFace = material(0x20262d, { metalness: 0.4, roughness: 0.3, emissive: 0x8b96a6, emissiveIntensity: 0.5 });
```

Add `robotFace` to the explicitly cloned/disposed face policy and leave the shared shell/joint materials owned by `createResourcePool().dispose()`.

- [ ] **Step 6: Run rig tests and resource cleanup checks**

Run: `npx tsx --test tests/dashboard-studio-robot.test.js tests/dashboard-studio-browser-model.test.js`

Expected: PASS with every named joint, authored pose, contact anchor, and dispose path verified.

- [ ] **Step 7: Commit the humanoid rig**

```bash
git add src/observability/dashboard/ui/studio3d/robot-poses.js src/observability/dashboard/ui/studio3d/robot.js src/observability/dashboard/ui/studio3d/geometry.js tests/dashboard-studio-robot.test.js
git commit -m "feat: add procedural Studio humanoid robots"
```

### Task 3: CPU-first office architecture and truthful occupancy

**Files:**
- Create: `src/observability/dashboard/ui/studio3d/office.js`
- Modify: `src/observability/dashboard/ui/studio3d/geometry.js`
- Modify: `src/observability/dashboard/ui/studio3d/reconciler.js`
- Create: `tests/dashboard-studio-office.test.js`
- Modify: `tests/dashboard-studio-browser-model.test.js`

**Interfaces:**
- Consumes: `STUDIO_TOPOLOGY`, shared resource pool, projection missions/departments/sessions, and `createHumanoidRobot`.
- Produces: `createOfficeEnvironment(pool) -> { object, desks, stageSignals, dispose }`, robot-backed orchestrator/session entity handles, and `desiredEntities(projection)` with `aggregate:overflow-sessions` when sessions exceed 16.

- [ ] **Step 1: Write failing office identity and occupancy tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createResourcePool } from '../src/observability/dashboard/ui/studio3d/geometry.js';
import { createOfficeEnvironment } from '../src/observability/dashboard/ui/studio3d/office.js';

test('office builds every company facility with exactly fifteen stage signals', () => {
  const pool = createResourcePool();
  const office = createOfficeEnvironment(pool);
  assert.ok(office.object instanceof THREE.Group);
  assert.equal(office.stageSignals.size, 15);
  assert.equal(office.desks.builder.length, 8);
  assert.equal(office.desks.validator.length, 4);
  for (const name of ['Orchestrator HQ', 'Skills and Plugin Library', 'Glass Validator Lab', 'Governance Room', 'Dispatch', 'Evidence Vault']) {
    assert.ok(office.object.getObjectByName(name), name);
  }
  office.dispose(); pool.dispose();
});

test('office desks start empty and provide authored seat, keyboard, and screen anchors', () => {
  const pool = createResourcePool();
  const office = createOfficeEnvironment(pool);
  for (const desk of [...office.desks.builder, ...office.desks.validator]) {
    assert.equal(desk.occupant, null);
    assert.ok(desk.seat instanceof THREE.Object3D);
    assert.ok(desk.keyboard instanceof THREE.Object3D);
    assert.ok(desk.screen instanceof THREE.Object3D);
  }
  office.dispose(); pool.dispose();
});
```

- [ ] **Step 2: Run the office test and confirm the missing-module failure**

Run: `npx tsx --test tests/dashboard-studio-office.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `studio3d/office.js`.

- [ ] **Step 3: Implement reusable workstation and facility builders**

Add the office-owned shared materials to `createResourcePool()` before constructing
the environment:

```js
materials.workSurface = material(0xf4f0e7, { metalness: 0.08, roughness: 0.72 });
materials.chair = material(0x7fa9aa, { metalness: 0.18, roughness: 0.62 });
materials.monitor = material(0x22303a, { metalness: 0.38, roughness: 0.32, emissive: 0x2867d6, emissiveIntensity: 0.22 });
materials.library = material(0x7254c7, { metalness: 0.25, roughness: 0.5, emissive: 0x2c1d68, emissiveIntensity: 0.18 });
materials.governanceGlass = new THREE.MeshPhysicalMaterial({ color: 0xf1a7a0, transparent: true, opacity: 0.2, roughness: 0.12, depthWrite: false });
```

```js
import * as THREE from 'three';
import { STUDIO_TOPOLOGY } from './topology.js';

function workstation(pool, slot) {
  const object = new THREE.Group(); object.name = slot.id;
  const desk = new THREE.Mesh(pool.geometries.slab, pool.materials.workSurface); desk.scale.set(1.15, 0.08, 0.62); desk.position.y = 1.35;
  const chair = new THREE.Mesh(pool.geometries.slab, pool.materials.chair); chair.scale.set(0.45, 0.55, 0.42); chair.position.set(0, 0.8, -0.72);
  const monitor = new THREE.Mesh(pool.geometries.slab, pool.materials.monitor); monitor.scale.set(0.58, 0.38, 0.04); monitor.position.set(0, 1.85, 0.35);
  object.add(desk, chair, monitor); object.position.fromArray(slot.position); object.rotation.fromArray(slot.rotation);
  const seat = new THREE.Object3D(); seat.position.set(0, 0.96, -0.48); object.add(seat);
  const keyboard = new THREE.Object3D(); keyboard.position.set(0, 1.45, 0.05); object.add(keyboard);
  const screen = new THREE.Object3D(); screen.position.set(0, 1.88, 0.34); object.add(screen);
  return { id: slot.id, object, seat, keyboard, screen, occupant: null };
}

export function createOfficeEnvironment(pool) {
  const object = new THREE.Group(); object.name = 'Agent Force living company';
  const namedBox = (name, slot, scale, selectedMaterial) => {
    const mesh = new THREE.Mesh(pool.geometries.slab, selectedMaterial); mesh.name = name;
    mesh.scale.set(...scale); mesh.position.fromArray(slot.position); object.add(mesh); return mesh;
  };
  namedBox('Orchestrator HQ', STUDIO_TOPOLOGY.orchestrator, [3.2, 0.2, 2.1], pool.materials.workSurface);
  namedBox('Skills and Plugin Library', STUDIO_TOPOLOGY.library, [2.4, 1.5, 1.4], pool.materials.library);
  namedBox('Glass Validator Lab', STUDIO_TOPOLOGY.validator, [5.4, 1.65, 2.4], pool.materials.glass);
  namedBox('Governance Room', STUDIO_TOPOLOGY.governance, [2.5, 1.4, 1.7], pool.materials.governanceGlass);
  namedBox('Dispatch', STUDIO_TOPOLOGY.dispatch, [1.6, 1.5, 1.6], pool.materials.graphiteLight);
  namedBox('Evidence Vault', STUDIO_TOPOLOGY.evidence, [1.8, 1.35, 1.5], pool.materials.evidence);
  const desks = {
    builder: STUDIO_TOPOLOGY.builderDesks.map((entry) => workstation(pool, entry)),
    validator: STUDIO_TOPOLOGY.validatorDesks.map((entry) => workstation(pool, entry)),
  };
  desks.builder.concat(desks.validator).forEach((entry) => object.add(entry.object));
  const stageSignals = new Map();
  STUDIO_TOPOLOGY.departments.forEach((entry) => {
    const signal = new THREE.Mesh(pool.geometries.slab, pool.materials.statuses.unknown);
    signal.name = entry.id; signal.scale.set(0.7, 0.08, 0.7); signal.position.fromArray(entry.position); object.add(signal);
    stageSignals.set(entry.id, signal);
  });
  return { object, desks, stageSignals, dispose() { object.removeFromParent(); } };
}
```

- [ ] **Step 4: Replace abstract orchestrator/session factories with humanoid handles**

```js
function createRobotEntity(data, slot, pool, kind) {
  const robot = createHumanoidRobot(pool, data);
  robot.object.name = kind === 'orchestrator' ? 'Orchestrator robot' : `${data.role === 'validator' ? 'Validator' : 'Builder'} · ${data.agent_id ?? data.id}`;
  place(robot.object, slot);
  return {
    object: robot.object,
    robot,
    update(next, nextSlot) { place(robot.object, nextSlot); robot.update(next); robot.object.userData.status = next.status ?? 'unknown'; robot.object.userData.data = next; robot.object.userData.role = next.role ?? 'builder'; },
    setPose: (name, weight) => robot.setPose(name, weight),
    setFace: (state) => robot.setFace(state),
    reset: () => robot.reset(),
    dispose: () => robot.dispose(),
  };
}
```

Map `orchestrator` and `session` in `createEntityFactories()` to `createRobotEntity`; keep mission, department, governance, and evidence handles source-backed until Task 5 moves their visuals into the office environment.

- [ ] **Step 5: Add honest overflow aggregation to reconciliation**

```js
const detailedSessions = projection.sessions.slice(-16);
detailedSessions.forEach((data, index) => desired.push({
  kind: 'session', id: data.id, data,
  slot: workstationSlot(data, projection, index),
}));
if (projection.sessions.length > detailedSessions.length) desired.push({
  kind: 'aggregate', id: 'overflow-sessions',
  data: { id: 'overflow-sessions', status: 'active', count: projection.sessions.length - detailedSessions.length },
  slot: topologySlot('dispatch'),
});
```

Add an `aggregate` factory that renders one compact count board and never a fictional robot.

```js
function createAggregate(data, slot, pool) {
  const object = new THREE.Group(); object.name = 'Additional observed sessions';
  const board = new THREE.Mesh(pool.geometries.slab, pool.materials.graphiteLight);
  board.scale.set(1.1, 0.65, 0.08); board.position.y = 1.1; object.add(board); place(object, slot);
  return {
    object,
    update(next, nextSlot) { place(object, nextSlot); object.userData.data = next; object.userData.count = next.count; },
    dispose() { object.removeFromParent(); },
  };
}
```

Register `aggregate: (data, slot) => createAggregate(data, slot, pool)` in
`createEntityFactories()`.

Replace the abstract capsule export with a task/evidence packet factory used by the
animator:

```js
export function createWorkPacket(pool, kind = 'task') {
  const mesh = new THREE.Mesh(pool.geometries.slab, kind === 'artifact' ? pool.materials.evidence : pool.materials.amber);
  mesh.name = `${kind} work packet`; mesh.scale.set(0.22, 0.16, 0.28);
  mesh.userData.kind = kind; return mesh;
}
```

- [ ] **Step 6: Run office, rig, reconciliation, and topology tests**

Run: `npx tsx --test tests/dashboard-studio-office.test.js tests/dashboard-studio-robot.test.js tests/dashboard-studio-browser-model.test.js`

Expected: PASS with empty desks, 16 detailed sessions, one overflow aggregate, and no synthetic worker.

- [ ] **Step 7: Commit the living company environment**

```bash
git add src/observability/dashboard/ui/studio3d/office.js src/observability/dashboard/ui/studio3d/geometry.js src/observability/dashboard/ui/studio3d/reconciler.js tests/dashboard-studio-office.test.js tests/dashboard-studio-browser-model.test.js
git commit -m "feat: build the Agent Force office environment"
```

### Task 4: Waypoint walking, seating, work, handoff, and evidence animation

**Files:**
- Create: `src/observability/dashboard/ui/studio3d/animator.js`
- Modify: `src/observability/dashboard/ui/studio3d/transitions.js`
- Create: `tests/dashboard-studio-animator.test.js`
- Modify: `tests/dashboard-studio-browser-model.test.js`

**Interfaces:**
- Consumes: `behaviorIntent(event)`, entity handles from the reconciler, authored route points, office workstation anchors, and packet factory.
- Produces: `sampleWaypointRoute(points, progress)`, `createAgentAnimator({ getHandle, getWorkstation, createPacket, scene }) -> { play, update, setMotion, freeze, resume, clear, activeCount }`, and scheduler transitions carrying `{ intent, event, duration_ms }`.

- [ ] **Step 1: Write failing deterministic motion tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createAgentAnimator, sampleWaypointRoute } from '../src/observability/dashboard/ui/studio3d/animator.js';

test('waypoint sampling is deterministic and ends exactly on its authored anchor', () => {
  const points = [[0, 0, 0], [2, 0, 0], [2, 0, 3]];
  assert.deepEqual(sampleWaypointRoute(points, 0), [0, 0, 0]);
  assert.deepEqual(sampleWaypointRoute(points, 1), [2, 0, 3]);
  assert.ok(sampleWaypointRoute(points, 0.5).every(Number.isFinite));
});

test('reduced motion applies final pose and position without active updates', () => {
  const object = new THREE.Group();
  const calls = [];
  const handle = { object, setPose: (name) => calls.push(name), setFace: () => {} };
  const animator = createAgentAnimator({ getHandle: () => handle, getWorkstation: () => ({ seat: { getWorldPosition: (out) => out.set(4, 0, 7) } }), createPacket: () => new THREE.Object3D(), scene: new THREE.Scene() });
  animator.setMotion('reduced');
  animator.play({ intent: { action: 'work', sessionId: 'session-1', gesture: 'keyboard' }, event: {}, duration_ms: 0 });
  assert.equal(animator.activeCount(), 0);
  assert.deepEqual(object.position.toArray(), [4, 0, 7]);
  assert.equal(calls.at(-1), 'seated_work');
});
```

- [ ] **Step 2: Run the animator test and confirm the missing-module failure**

Run: `npx tsx --test tests/dashboard-studio-animator.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `studio3d/animator.js`.

- [ ] **Step 3: Implement deterministic waypoint sampling**

```js
export function sampleWaypointRoute(points, progress) {
  if (!points?.length) return [0, 0, 0];
  if (points.length === 1 || progress <= 0) return [...points[0]];
  if (progress >= 1) return [...points.at(-1)];
  const lengths = points.slice(1).map((point, index) => Math.hypot(point[0] - points[index][0], point[1] - points[index][1], point[2] - points[index][2]));
  const total = lengths.reduce((sum, value) => sum + value, 0);
  let remaining = progress * total;
  for (let index = 0; index < lengths.length; index += 1) {
    if (remaining > lengths[index]) { remaining -= lengths[index]; continue; }
    const ratio = lengths[index] === 0 ? 1 : remaining / lengths[index];
    return points[index].map((value, axis) => value + (points[index + 1][axis] - value) * ratio);
  }
  return [...points.at(-1)];
}
```

- [ ] **Step 4: Implement transition-only agent animation**

```js
import * as THREE from 'three';
import { routePoints, STUDIO_TOPOLOGY } from './topology.js';

const ACTION_DURATION = Object.freeze({ enter: 1200, collect_capabilities: 1500, walk_to_assignment: 1300, work: 650, handoff: 1400, wait: 900, retry: 1200, return_evidence: 1300, complete: 700, fail: 500, exit: 1100, delegate: 700 });

export function createAgentAnimator({ getHandle, getWorkstation, createPacket, scene }) {
  const active = [];
  let reduced = false;
  let frozen = false;

  function finalState(intent, handle) {
    if (!handle) return;
    const workstation = getWorkstation(intent.sessionId);
    if (['work', 'walk_to_assignment'].includes(intent.action) && workstation) {
      handle.object.position.copy(workstation.seat.getWorldPosition(new THREE.Vector3()));
      handle.setPose(handle.object.userData.role === 'validator' ? 'validating' : 'seated_work');
    } else if (intent.action === 'enter') { handle.object.position.fromArray(STUDIO_TOPOLOGY.dispatch.position); handle.setPose('standing'); }
    else if (intent.action === 'collect_capabilities') { handle.object.position.fromArray(STUDIO_TOPOLOGY.library.entry); handle.setPose('standing'); }
    else if (intent.action === 'retry' && workstation) { handle.object.position.copy(workstation.seat.getWorldPosition(new THREE.Vector3())); handle.setPose('seated_work'); }
    else if (intent.action === 'wait') { handle.object.position.fromArray(STUDIO_TOPOLOGY.governance.entry); handle.setPose('waiting'); }
    else if (intent.action === 'handoff') { handle.object.position.fromArray(STUDIO_TOPOLOGY.validator.position); handle.setPose('handoff'); }
    else if (intent.action === 'return_evidence') handle.setPose('handoff');
    else if (intent.action === 'fail') handle.setPose('failed');
    else if (intent.action === 'complete') handle.setPose('complete');
    else if (intent.action === 'exit') { handle.object.position.fromArray(STUDIO_TOPOLOGY.dispatch.position); handle.setPose('standing'); }
    else handle.setPose('standing');
  }

  function targetFor(intent, handle) {
    const workstation = getWorkstation(intent.sessionId);
    if (['work', 'walk_to_assignment', 'retry'].includes(intent.action) && workstation) return workstation.seat.getWorldPosition(new THREE.Vector3()).toArray();
    if (intent.action === 'collect_capabilities') return [...STUDIO_TOPOLOGY.library.entry];
    if (intent.action === 'handoff') return [...STUDIO_TOPOLOGY.validator.position];
    if (intent.action === 'wait') return [...STUDIO_TOPOLOGY.governance.entry];
    if (intent.action === 'return_evidence') return [...STUDIO_TOPOLOGY.evidence.entry];
    if (intent.action === 'exit') return [...STUDIO_TOPOLOGY.dispatch.position];
    return handle ? handle.object.position.toArray() : [...STUDIO_TOPOLOGY.dispatch.position];
  }

  function movementRoute(intent, handle) {
    if (intent.action === 'enter') return [[-18, 0, 8], [...STUDIO_TOPOLOGY.dispatch.position]];
    const named = intent.action === 'collect_capabilities' ? 'dispatch_to_library'
      : intent.action === 'handoff' ? 'builder_to_validator'
        : intent.action === 'wait' ? 'assignment_to_governance'
          : intent.action === 'return_evidence' ? 'assignment_to_vault' : null;
    if (named) return [...routePoints(named)];
    if (!handle) return [[...STUDIO_TOPOLOGY.orchestrator.position], [...STUDIO_TOPOLOGY.dispatch.position]];
    const from = handle.object.position.toArray();
    const to = targetFor(intent, handle);
    return [from, [from[0], 0, 5.3], [to[0], 0, 5.3], to];
  }

  function play(transition) {
    const handle = getHandle(transition.intent.sessionId);
    if (!handle && transition.intent.action !== 'delegate') return false;
    if (reduced || transition.duration_ms === 0) { if (handle) finalState(transition.intent, handle); return true; }
    const route = movementRoute(transition.intent, handle);
    const packetKind = transition.intent.action === 'return_evidence' ? 'artifact'
      : ['delegate', 'handoff'].includes(transition.intent.action) ? 'task' : null;
    const packet = packetKind ? createPacket(packetKind) : null;
    if (packet) scene.add(packet);
    active.push({ ...transition, handle, packet, route, startedAt: transition.started_at_ms, duration: ACTION_DURATION[transition.intent.action] ?? transition.duration_ms });
    return true;
  }

  function update(now) {
    if (frozen) return false;
    for (let index = active.length - 1; index >= 0; index -= 1) {
      const item = active[index];
      const progress = Math.min(1, Math.max(0, (now - item.startedAt) / item.duration));
      const routePosition = sampleWaypointRoute(item.route, progress);
      if (item.route.length && item.handle && !['delegate', 'return_evidence'].includes(item.intent.action)) {
        item.handle.object.position.fromArray(routePosition);
        item.handle.setPose(progress % 0.5 < 0.25 ? 'walkA' : 'walkB', 0.45);
      } else if (item.handle) item.handle.setPose(item.intent.gesture === 'keyboard' ? 'seated_work' : item.intent.action === 'fail' ? 'failed' : 'standing', 0.35);
      if (item.packet) item.packet.position.fromArray(routePosition).add(new THREE.Vector3(0, 1.35, 0));
      if (progress < 1) continue;
      if (item.handle) finalState(item.intent, item.handle);
      if (item.packet) item.packet.removeFromParent();
      active.splice(index, 1);
    }
    return active.length > 0;
  }

  return {
    play, update,
    setMotion(mode) { reduced = mode === 'reduced'; if (reduced) { active.splice(0).forEach((item) => { finalState(item.intent, item.handle); item.packet?.removeFromParent(); }); } },
    freeze() { frozen = true; }, resume() { frozen = false; }, clear() { active.splice(0).forEach((item) => item.packet?.removeFromParent()); }, activeCount: () => active.length,
  };
}
```

- [ ] **Step 5: Change transition scheduling from abstract kinds to behavior intents**

```js
import { behaviorIntent } from './behavior.js';

const EVENT_DURATIONS = Object.freeze({
  delegation_requested: 700, agent_session_started: 1200, agent_session_ready: 1300,
  agent_capabilities_attached: 1500, agent_activity: 650, agent_waiting: 900,
  approval_gate_blocked: 900, dor_gate_blocked: 900, guardrail_blocked: 900,
  task_human_context_required: 900, task_retry_exhausted: 500,
  task_blocked_by_validator: 900, handoff_created: 1400, artifact_emitted: 1300,
  task_retry_scheduled: 1200, agent_session_completed: 700,
  agent_session_failed: 500, agent_session_stopped: 1100,
});
```

Inside `ingest`, discard events whose `behaviorIntent(item)` is null and enqueue `{ id, intent, duration_ms, event }`. Preserve existing event identity, persisted seen-order limit, historical priming, pause reasons, and reduced-motion zero-duration behavior.

- [ ] **Step 6: Run animator and transition deduplication tests**

Run: `npx tsx --test tests/dashboard-studio-animator.test.js tests/dashboard-studio-browser-model.test.js tests/dashboard-studio-behavior.test.js`

Expected: PASS with deterministic final anchors, zero active reduced-motion transitions, and one execution for each unseen event identity.

- [ ] **Step 7: Commit the workforce animation engine**

```bash
git add src/observability/dashboard/ui/studio3d/animator.js src/observability/dashboard/ui/studio3d/transitions.js tests/dashboard-studio-animator.test.js tests/dashboard-studio-browser-model.test.js
git commit -m "feat: animate source-backed Studio workforce"
```

### Task 5: Integrate the office, workforce, quality loop, and camera levels

**Files:**
- Modify: `src/observability/dashboard/ui/studio3d/scene.js`
- Modify: `src/observability/dashboard/ui/studio3d/reconciler.js`
- Modify: `src/observability/dashboard/ui/studio3d/geometry.js`
- Modify: `tests/dashboard-studio-browser-model.test.js`
- Modify: `tests/dashboard-studio-office.test.js`
- Modify: `tests/dashboard-studio-animator.test.js`

**Interfaces:**
- Consumes: office environment, robot entity handles, behavior transitions, animator, projection, selection callback, motion and connection freeze state.
- Produces: `createStudioScene(...).focus(ref, level)`, diagnostics `{ qualityTier, drawCalls, triangles, activeRigs, activeTransitions, transitionCostMs }`, and final source-backed poses after every reconciliation.

- [ ] **Step 1: Add failing scene contract tests**

```js
test('scene exposes company focus levels and workforce diagnostics', () => {
  const source = readFileSync(join(process.cwd(), 'src/observability/dashboard/ui/studio3d/scene.js'), 'utf8');
  for (const name of ['reconcile', 'select', 'focus', 'setMotion', 'diagnostics', 'pause', 'resume', 'destroy']) assert.match(source, new RegExp(`${name}\\b`));
  for (const field of ['activeRigs', 'activeTransitions', 'transitionCostMs']) assert.match(source, new RegExp(field));
  assert.match(source, /createOfficeEnvironment/);
  assert.match(source, /createAgentAnimator/);
  assert.doesNotMatch(source, /pulseEntity|moveCapsule/);
});
```

- [ ] **Step 2: Run the focused test and confirm the old abstract runtime fails it**

Run: `npx tsx --test tests/dashboard-studio-browser-model.test.js`

Expected: FAIL because `focus`, `activeRigs`, `activeTransitions`, `transitionCostMs`, and the new composition imports are absent.

- [ ] **Step 3: Compose the office and animator in `createStudioScene`**

```js
const office = createOfficeEnvironment(pool);
scene.add(office.object);
const workstationBySession = new Map();
const animator = createAgentAnimator({
  scene,
  getHandle: (sessionId) => reconciler.get({ kind: 'session', id: sessionId }),
  getWorkstation: (sessionId) => workstationBySession.get(sessionId) ?? null,
  createPacket: (kind) => createWorkPacket(pool, kind),
});
const transitions = createTransitionScheduler({ apply: (transition) => animator.play(transition), storage: transitionStorage });
```

During reconciliation, assign each detailed session to the role-correct desk, set `desk.occupant`, populate `workstationBySession`, update the exact fifteen stage signals from `projection.departments`, and clear prior occupants before applying the next snapshot.

```js
function assignWorkstations(projection) {
  workstationBySession.clear();
  office.desks.builder.concat(office.desks.validator).forEach((desk) => { desk.occupant = null; });
  let builderIndex = 0; let validatorIndex = 0;
  projection.sessions.slice(-16).forEach((session) => {
    const desks = session.role === 'validator' ? office.desks.validator : office.desks.builder;
    const index = session.role === 'validator' ? validatorIndex++ : builderIndex++;
    const desk = desks[index % desks.length]; desk.occupant = session.id; workstationBySession.set(session.id, desk);
  });
  projection.departments.forEach((department, index) => {
    const signal = [...office.stageSignals.values()][index];
    if (!signal) return;
    signal.material = pool.statusMaterial(department.status);
    signal.userData.data = department;
    signal.userData.entityRef = { kind: 'department', id: department.id };
  });
}
```

- [ ] **Step 4: Replace the continuous abstract transition update with transition-only workforce updates**

```js
let transitionCostMs = 0;
let controlsActive = false;
controls.addEventListener('start', () => { controlsActive = true; startLoop(); });
controls.addEventListener('end', () => { controlsActive = false; });
function renderFrame(now) {
  if (destroyed || pauseReasons.size) return;
  transitions.tick(now);
  const started = performance.now();
  const workforceActive = animator.update(now);
  transitionCostMs = performance.now() - started;
  updateCameraTween(now);
  controls.update();
  renderer.render(scene, camera);
  samplePerformance(now);
  if (!workforceActive && !cameraTween && !controlsActive) renderer.setAnimationLoop(null);
}
```

Use `controls` change/start/end events to restart while the camera is manipulated. Restart when reconciliation queues a transition, selection starts a camera tween, motion changes, context restores, or transport resumes.

- [ ] **Step 5: Add company, mission, and agent-desk camera levels**

```js
function focus(ref, level = 'agent') {
  if (level === 'company' || !ref) return focusObject(office.object, { overview: true });
  const handle = reconciler.get(ref);
  if (!handle) return false;
  const target = new THREE.Box3().setFromObject(handle.object).getCenter(new THREE.Vector3());
  const offset = level === 'mission' ? new THREE.Vector3(8.5, 8, 10.5) : new THREE.Vector3(3.8, 3.1, 5.2);
  moveCameraTo(target.clone().add(offset), target);
  return true;
}
```

Make `select(ref, { level = ref.kind === 'session' ? 'agent' : 'mission' })` call `focus`; keep `{ overview: true }` as a compatibility alias for company focus.

- [ ] **Step 6: Extend diagnostics and freeze behavior**

```js
function diagnostics() {
  return {
    qualityTier,
    drawCalls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
    geometries: renderer.info.memory.geometries,
    textures: renderer.info.memory.textures,
    activeRigs: reconciler.entries().filter(([entry]) => entry.startsWith('session:')).length,
    activeTransitions: animator.activeCount(),
    transitionCostMs,
  };
}
```

`pause(reason)` must freeze animator and scheduler; `resume(reason)` must resume both only after the matching pause reason is removed. `destroy()` must clear the animator, dispose office-owned resources, reset desk occupancy, and preserve existing WebGL context cleanup.

- [ ] **Step 7: Run Studio runtime tests**

Run: `npx tsx --test tests/dashboard-studio-browser-model.test.js tests/dashboard-studio-office.test.js tests/dashboard-studio-animator.test.js tests/dashboard-studio-assets.test.js`

Expected: PASS with no `pulseEntity` or `moveCapsule` source contract, stable cleanup, and local-only assets.

- [ ] **Step 8: Commit the integrated living scene**

```bash
git add src/observability/dashboard/ui/studio3d/scene.js src/observability/dashboard/ui/studio3d/reconciler.js src/observability/dashboard/ui/studio3d/geometry.js tests/dashboard-studio-browser-model.test.js tests/dashboard-studio-office.test.js tests/dashboard-studio-animator.test.js
git commit -m "feat: integrate the living Agent Force scene"
```

### Task 6: Agent labels, alerts, inspector parity, and responsive office styling

**Files:**
- Create: `src/observability/dashboard/ui/studio3d/overlays.js`
- Modify: `src/observability/dashboard/ui/studio3d.js`
- Modify: `src/observability/dashboard/ui/studio3d/dom.js`
- Modify: `src/observability/dashboard/ui/studio3d/app.js`
- Modify: `src/observability/dashboard/ui/studio3d/scene.js`
- Modify: `src/observability/dashboard/ui/studio3d/styles.css`
- Modify: `tests/dashboard-studio-browser-model.test.js`
- Modify: `tests/dashboard-studio-responsive.test.js`

**Interfaces:**
- Consumes: reconciler entity handles, camera, current projection, selection state, behavior notification classes, and semantic inspector.
- Produces: `createStudioOverlays(root, { onSelect }) -> { reconcile, update, select, clear }`, scoped alert labels, selected-agent activity details, and synchronized company/mission/agent navigation.

- [ ] **Step 1: Write failing overlay and semantic-parity contracts**

```js
test('Studio shell provides a non-semantic canvas overlay host', () => {
  const html = studio3dHtml();
  assert.match(html, /<div id="studio-overlays" class="studio-overlays" aria-hidden="true"><\/div>/);
  assert.match(html, /<button id="studio-overview"/);
  assert.doesNotMatch(html, /innerHTML\s*=/);
});

test('session inspector exposes stage, safe activity class, capabilities, source, and time', () => {
  const source = readFileSync(DOM_PATH, 'utf8');
  for (const field of ['stage_ids', 'activity_class', 'skill_ids', 'plugin_ids', 'specialist_ids', 'source', 'last_activity_at']) assert.match(source, new RegExp(field));
});
```

- [ ] **Step 2: Run browser-model and responsive tests and confirm missing contracts**

Run: `npx tsx --test tests/dashboard-studio-browser-model.test.js tests/dashboard-studio-responsive.test.js`

Expected: FAIL because the overlay host and selected-session stage/activity fields are absent.

- [ ] **Step 3: Add the overlay host and create projected labels safely**

```html
<div id="studio-overlays" class="studio-overlays" aria-hidden="true"></div>
```

```js
import * as THREE from 'three';

const HIGH_VALUE = new Set(['waiting', 'blocked', 'failed', 'starting', 'active']);
export function createStudioOverlays(root, { onSelect = () => {} } = {}) {
  const labels = new Map();
  function reconcile(projection, entries) {
    const desired = new Set();
    for (const [key, handle] of entries) {
      const data = handle.object.userData.data;
      if (!data || (key.startsWith('session:') && !HIGH_VALUE.has(data.status))) continue;
      desired.add(key);
      let label = labels.get(key);
      if (!label) {
        label = root.ownerDocument.createElement('div'); label.className = 'studio-world-label';
        label.addEventListener('click', () => onSelect(handle.object.userData.entityRef)); root.append(label); labels.set(key, label);
      }
      label.replaceChildren();
      const title = root.ownerDocument.createElement('strong'); title.textContent = data.agent_id ?? data.title ?? data.id;
      const detail = root.ownerDocument.createElement('span'); detail.textContent = data.waiting_reason ?? data.activity ?? data.status ?? 'Observed';
      label.append(title, detail); label.dataset.state = data.status ?? 'unknown';
    }
    for (const [key, label] of labels) if (!desired.has(key)) { label.remove(); labels.delete(key); }
  }
  function update(camera, entries, viewport) {
    for (const [key, handle] of entries) {
      const label = labels.get(key); if (!label) continue;
      const point = handle.object.getWorldPosition(new THREE.Vector3()); point.y += 2.8; point.project(camera);
      label.style.transform = `translate(${(point.x * 0.5 + 0.5) * viewport.width}px, ${(-point.y * 0.5 + 0.5) * viewport.height}px)`;
      label.hidden = point.z < -1 || point.z > 1;
    }
  }
  return { reconcile, update, select(ref) { for (const label of labels.values()) label.dataset.selected = 'false'; const target = labels.get(`${ref.kind}:${ref.id}`); if (target) target.dataset.selected = 'true'; }, clear() { labels.forEach((label) => label.remove()); labels.clear(); } };
}
```

- [ ] **Step 4: Expand the safe session inspector**

```js
facts.append(
  fact(doc, 'Stages', entity.stage_ids?.length ? entity.stage_ids.join(', ') : 'Unavailable'),
  fact(doc, 'Activity class', entity.activity_class ? statusLabel(entity.activity_class) : 'Unavailable'),
  fact(doc, 'Last activity', entity.last_activity_at),
);
```

Keep capability lists inserted through `textContent`. For governance and failure notifications, include source and timestamp facts already supplied by the projection. Add `artifact_emitted` and `agent_session_completed` to the announced set; keep `agent_activity` excluded.

- [ ] **Step 5: Integrate overlay projection and selection with the scene**

Create overlays in `app.js` from `#studio-overlays`, pass the element into `createStudioScene`, call `overlays.reconcile(projection, reconciler.entries())` after entity reconciliation, `overlays.update(camera, reconciler.entries(), canvas.getBoundingClientRect())` only while rendering, and `overlays.clear()` on destroy. Overlay clicks must call the existing DOM `select(ref)` path.

- [ ] **Step 6: Apply the bright precision-workshop styles and responsive label rules**

```css
:root{--studio-bg:#eeece5;--studio-surface:#fffdf8;--studio-ink:#20242a;--studio-muted:#68707a;--studio-amber:#d98719;--studio-blue:#2867d6;--studio-mint:#2f8f74;--studio-red:#c9473b;--studio-violet:#7254c7}
.studio-scene-shell{background:linear-gradient(145deg,#fffefb,#e9e7df);border-color:#d5d3cc}
.studio-overlays{position:absolute;inset:0;overflow:hidden;pointer-events:none}
.studio-world-label{position:absolute;left:0;top:0;min-width:9rem;max-width:15rem;padding:.55rem .65rem;border:1px solid #d7d4cc;border-left:3px solid var(--studio-amber);border-radius:.55rem;background:rgba(255,253,248,.94);color:var(--studio-ink);box-shadow:0 .5rem 1.2rem rgba(32,36,42,.12);pointer-events:auto;text-align:left;transform-origin:left bottom}
.studio-world-label strong,.studio-world-label span{display:block}.studio-world-label span{margin-top:.2rem;color:var(--studio-muted);font-size:.72rem}
.studio-world-label[data-state="waiting"],.studio-world-label[data-state="blocked"],.studio-world-label[data-state="failed"]{border-left-color:var(--studio-red)}
.studio-world-label[data-selected="true"]{outline:3px solid rgba(217,135,25,.3)}
@media(max-width:600px){.studio-overlays{display:none}.studio-scene-shell{min-height:12rem}}
@media(prefers-reduced-motion:reduce){.studio-world-label{transition:none}}
```

Keep existing 44 px touch targets, focus-visible rules, semantic-only mode, no horizontal overflow, and inspector bottom-sheet behavior at 390 px.

- [ ] **Step 7: Run semantic, responsive, and browser-model tests**

Run: `npx tsx --test tests/dashboard-studio-browser-model.test.js tests/dashboard-studio-responsive.test.js tests/dashboard-studio-352.test.js`

Expected: PASS with overlay host hidden from accessibility, safe text insertion, high-value announcements only, and mobile semantic parity.

- [ ] **Step 8: Commit the agent-level UX**

```bash
git add src/observability/dashboard/ui/studio3d/overlays.js src/observability/dashboard/ui/studio3d.js src/observability/dashboard/ui/studio3d/dom.js src/observability/dashboard/ui/studio3d/app.js src/observability/dashboard/ui/studio3d/scene.js src/observability/dashboard/ui/studio3d/styles.css tests/dashboard-studio-browser-model.test.js tests/dashboard-studio-responsive.test.js
git commit -m "feat: add Studio agent focus and alerts"
```

### Task 7: Performance ceilings, fallbacks, asset allow-list, and end-to-end verification

**Files:**
- Modify: `src/observability/dashboard/ui/studio3d/scene.js`
- Modify: `src/observability/dashboard/ui/studio3d/app.js`
- Modify: `src/observability/dashboard/server.js`
- Modify: `tests/dashboard-studio-assets.test.js`
- Modify: `tests/dashboard-studio-browser-model.test.js`
- Modify: `tests/dashboard-studio-responsive.test.js`
- Modify: `tests/dashboard-studio-projection.test.js`
- Modify: `docs/superpowers/specs/2026-07-13-agent-force-living-studio-redesign.md`

**Interfaces:**
- Consumes: renderer diagnostics, browser connection state, reduced-motion state, semantic fallback, and deterministic Studio fixtures.
- Produces: enforced diagnostics ceilings, allow-listed module delivery, paused idle loop, documented verification evidence, and a release-ready feature branch.

- [ ] **Step 1: Add failing asset and performance-source contracts**

```js
test('Studio serves every living-company module from the local allow-list', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'rstack-studio-living-assets-'));
  const server = await startServer(projectRoot);
  try {
    for (const asset of ['behavior.js', 'robot-poses.js', 'robot.js', 'office.js', 'animator.js', 'overlays.js']) {
      const response = await fetch(`${server.baseUrl}/studio3d/assets/${asset}`);
      assert.equal(response.status, 200, asset);
      assert.match(response.headers.get('content-type'), /javascript/);
    }
  } finally {
    server.stop(); rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('renderer source enforces CPU-first ceilings and idle pause', () => {
  const source = readFileSync(SCENE_PATH, 'utf8');
  assert.match(source, /MAX_DETAILED_RIGS\s*=\s*16/);
  assert.match(source, /DRAW_CALL_CEILING\s*=\s*90/);
  assert.match(source, /TRIANGLE_CEILING\s*=\s*200_000/);
  assert.match(source, /transitionCostMs/);
  assert.match(source, /setAnimationLoop\(null\)/);
});
```

- [ ] **Step 2: Run focused tests and confirm new module allow-list failures**

Run: `npx tsx --test tests/dashboard-studio-assets.test.js tests/dashboard-studio-browser-model.test.js`

Expected: FAIL for at least one unserved new module or missing ceiling constant.

- [ ] **Step 3: Add new modules to the exact server allow-list**

```js
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
  ['/studio3d/assets/behavior.js', { path: join(DASHBOARD_DIR, 'ui/studio3d/behavior.js'), type: 'text/javascript; charset=utf-8' }],
  ['/studio3d/assets/robot-poses.js', { path: join(DASHBOARD_DIR, 'ui/studio3d/robot-poses.js'), type: 'text/javascript; charset=utf-8' }],
  ['/studio3d/assets/robot.js', { path: join(DASHBOARD_DIR, 'ui/studio3d/robot.js'), type: 'text/javascript; charset=utf-8' }],
  ['/studio3d/assets/office.js', { path: join(DASHBOARD_DIR, 'ui/studio3d/office.js'), type: 'text/javascript; charset=utf-8' }],
  ['/studio3d/assets/animator.js', { path: join(DASHBOARD_DIR, 'ui/studio3d/animator.js'), type: 'text/javascript; charset=utf-8' }],
  ['/studio3d/assets/overlays.js', { path: join(DASHBOARD_DIR, 'ui/studio3d/overlays.js'), type: 'text/javascript; charset=utf-8' }],
  ['/studio3d/assets/styles.css', { path: join(DASHBOARD_DIR, 'ui/studio3d/styles.css'), type: 'text/css; charset=utf-8' }],
  ['/studio3d/vendor/three.module.js', { path: join(PACKAGE_ROOT, 'node_modules/three/build/three.module.js'), type: 'text/javascript; charset=utf-8', immutable: true }],
  ['/studio3d/vendor/three.core.js', { path: join(PACKAGE_ROOT, 'node_modules/three/build/three.core.js'), type: 'text/javascript; charset=utf-8', immutable: true }],
  ['/studio3d/vendor/controls/OrbitControls.js', { path: join(PACKAGE_ROOT, 'node_modules/three/examples/jsm/controls/OrbitControls.js'), type: 'text/javascript; charset=utf-8', immutable: true }],
]);
```

Preserve the existing normalized-path containment check and 404 response for names outside this set.

- [ ] **Step 4: Enforce measured quality ceilings without turning diagnostics into product KPIs**

```js
const MAX_DETAILED_RIGS = 16;
const DRAW_CALL_CEILING = 90;
const TRIANGLE_CEILING = 200_000;

function enforceQualityCeilings(now) {
  const overGeometryBudget = renderer.info.render.calls > DRAW_CALL_CEILING || renderer.info.render.triangles > TRIANGLE_CEILING;
  const overCpuBudget = transitionCostMs > 4;
  if (!overGeometryBudget && !overCpuBudget) return;
  const index = QUALITY_ORDER.indexOf(qualityTier);
  if (index < QUALITY_ORDER.length - 1 && now - lastTierChange >= 2_000) {
    applyQuality(QUALITY_ORDER[index + 1]);
    lastTierChange = now;
  }
}
```

Call this after rendering and performance sampling. In low quality, set robot motion sampling to 15 fps, disable shadows, hide non-selected/non-blocked overlays, and preserve final source-backed states.

- [ ] **Step 5: Verify stale, disconnected, hidden, reduced-motion, context-loss, and semantic-only paths**

Run: `npx tsx --test tests/dashboard-studio-browser-model.test.js tests/dashboard-studio-responsive.test.js tests/dashboard-studio-projection.test.js`

Expected: PASS with stale/disconnected freeze, hidden-page pause, direct reduced-motion state, context fallback, and unchanged server projection truth.

- [ ] **Step 6: Run the complete focused Studio suite**

Run: `npx tsx --test tests/agent-lifecycle.test.js tests/dashboard-studio-352.test.js tests/dashboard-studio-assets.test.js tests/dashboard-studio-behavior.test.js tests/dashboard-studio-robot.test.js tests/dashboard-studio-office.test.js tests/dashboard-studio-animator.test.js tests/dashboard-studio-browser-model.test.js tests/dashboard-studio-projection.test.js tests/dashboard-studio-responsive.test.js`

Expected: all focused tests PASS with zero failed tests.

- [ ] **Step 7: Run static and repository verification**

Run: `npm run lint && npm run typecheck && npm run validate`

Expected: all commands exit 0. Existing lint warnings may remain only if their count and locations are unchanged from the branch baseline.

- [ ] **Step 8: Run the complete test suite**

Run: `npm test`

Expected: all tests PASS with zero failed tests.

- [ ] **Step 9: Run browser verification against deterministic fixtures**

Run the Business Hub locally, then verify at desktop width and 390 px:

```text
1. Empty fixture: no robot occupies an empty desk or claims idle work.
2. Delegation fixture: Orchestrator points; one observed session enters from Dispatch.
3. Capability fixture: the same robot visits the Library before its assignment.
4. Activity fixture: Builder sits with feet below the desk and hands at keyboard/mouse anchors.
5. Validation fixture: task crosses the glass boundary; Validator remains inside the lab.
6. Approval fixture: affected robot stops and its scoped Governance alert is selected.
7. Retry fixture: the same session resumes and the timeline retains prior attempts.
8. Completion fixture: evidence reaches the Vault before completion pose.
9. Stale/disconnected fixture: movement freezes and last observed time remains visible.
10. Reduced-motion fixture: correct final states appear without travel, typing, pulse, or camera flight.
11. Keyboard-only fixture: semantic selection opens and closes the inspector with focus restoration.
12. Mobile fixture: semantic facts and links remain complete with no horizontal overflow.
```

Capture renderer diagnostics on the full-load fixture and require `drawCalls <= 90`, `triangles <= 200000`, `activeRigs <= 16`, and stable `activeTransitions === 0` after transitions finish.

- [ ] **Step 10: Record verification evidence in the approved specification**

Append a `## Verification record` section containing the tested commit, focused-suite result, lint/typecheck/validate result, full-suite result, desktop/mobile browser scenarios, and measured renderer diagnostics. Do not mark a check successful without command or browser evidence from this branch.

- [ ] **Step 11: Commit final hardening and verification**

```bash
git add src/observability/dashboard/ui/studio3d/scene.js src/observability/dashboard/ui/studio3d/app.js src/observability/dashboard/server.js tests/dashboard-studio-assets.test.js tests/dashboard-studio-browser-model.test.js tests/dashboard-studio-responsive.test.js tests/dashboard-studio-projection.test.js docs/superpowers/specs/2026-07-13-agent-force-living-studio-redesign.md
git commit -m "test: verify the living Agent Force Studio"
```

## Completion gate

Before publishing or claiming completion:

- Confirm `git status --short` is clean.
- Confirm every new robot action can be traced to `state.studio` or an allow-listed timeline event.
- Confirm no stock reference artwork or third-party character asset entered the repository.
- Confirm the Studio remains read-only and same-origin.
- Confirm semantic-only and reduced-motion modes expose the same operational truth.
- Use `superpowers:verification-before-completion` before the final completion claim.
- Use `superpowers:requesting-code-review` before opening a ready-for-review pull request.
