/**
 * Source-backed Agent Force workforce animation contracts.
 *
 * owner: RStack developed by Richardson Gunde
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
  createAgentAnimator,
  sampleWaypointRoute,
} from '../src/observability/dashboard/ui/studio3d/animator.js';
import { ROBOT_PELVIS_HEIGHT } from '../src/observability/dashboard/ui/studio3d/robot.js';
import { STUDIO_TOPOLOGY } from '../src/observability/dashboard/ui/studio3d/topology.js';

function agentHarness({ role = 'builder' } = {}) {
  const object = new THREE.Group();
  object.userData.role = role;
  const poses = [];
  const faces = [];
  return {
    handle: {
      object,
      setPose: (name) => poses.push(name),
      setFace: (name) => faces.push(name),
    },
    poses,
    faces,
  };
}

function workstationAt(x, y, z) {
  return {
    seat: { getWorldPosition: (out) => out.set(x, y, z) },
    handoff: { getWorldPosition: (out) => out.set(x, 0, z - 1) },
  };
}

function managerHarness() {
  const object = new THREE.Group();
  object.position.fromArray(STUDIO_TOPOLOGY.managerSeat.position);
  const modes = [];
  return {
    handle: {
      object,
      seatedAtOrigin: true,
      setPose: (name) => modes.push(name),
      setWalking: () => modes.push('walking'),
    },
    modes,
  };
}

test('waypoint sampling follows distance and ends exactly on authored anchors', () => {
  const points = [[0, 0, 0], [2, 0, 0], [2, 0, 3]];
  assert.deepEqual(sampleWaypointRoute(points, 0), [0, 0, 0]);
  assert.deepEqual(sampleWaypointRoute(points, 0.5), [2, 0, 0.5]);
  assert.deepEqual(sampleWaypointRoute(points, 1), [2, 0, 3]);
  assert.deepEqual(sampleWaypointRoute([], 0.4), [0, 0, 0]);
  assert.ok(sampleWaypointRoute(points, Number.NaN).every(Number.isFinite));
});

test('reduced motion applies final workstation state without active updates', () => {
  const { handle, poses } = agentHarness();
  const animator = createAgentAnimator({
    getHandle: () => handle,
    getWorkstation: () => workstationAt(4, 0, 7),
    createPacket: () => new THREE.Object3D(),
    scene: new THREE.Scene(),
  });
  animator.setMotion('reduced');
  assert.equal(animator.play({
    intent: { action: 'work', sessionId: 'session-1', gesture: 'keyboard' },
    event: {},
    duration_ms: 0,
  }), true);
  assert.equal(animator.activeCount(), 0);
  // Seated origin drops so the pelvis lands on the seat anchor.
  assert.deepEqual(handle.object.position.toArray(), [4, 0 - ROBOT_PELVIS_HEIGHT, 7]);
  assert.equal(poses.at(-1), 'seated_work');
});

test('full motion walks only while a source transition is active and then seats', () => {
  const { handle, poses } = agentHarness({ role: 'validator' });
  const animator = createAgentAnimator({
    getHandle: () => handle,
    getWorkstation: () => workstationAt(6, 0, 8),
    createPacket: () => new THREE.Object3D(),
    scene: new THREE.Scene(),
  });
  animator.play({
    intent: { action: 'walk_to_assignment', sessionId: 'validator-1' },
    event: {},
    duration_ms: 1300,
    started_at_ms: 0,
  });
  assert.equal(animator.update(650), true);
  assert.match(poses.at(-1), /^walk[AB]$/);
  assert.equal(animator.update(1300), false);
  assert.deepEqual(handle.object.position.toArray(), [6, 0 - ROBOT_PELVIS_HEIGHT, 8]);
  assert.equal(poses.at(-1), 'validating');
  assert.equal(animator.activeCount(), 0);
});

test('freeze preserves the exact frame and resume completes pending work', () => {
  const { handle } = agentHarness();
  const animator = createAgentAnimator({
    getHandle: () => handle,
    getWorkstation: () => workstationAt(3, 0, 9),
    createPacket: () => new THREE.Object3D(),
    scene: new THREE.Scene(),
  });
  animator.play({
    intent: { action: 'retry', sessionId: 'session-1' },
    event: {},
    duration_ms: 1200,
    started_at_ms: 0,
  });
  animator.update(400);
  const frozenPosition = handle.object.position.clone();
  animator.freeze();
  assert.equal(animator.update(1000), false);
  assert.deepEqual(handle.object.position.toArray(), frozenPosition.toArray());
  animator.resume();
  assert.equal(animator.update(1200), false);
  assert.deepEqual(handle.object.position.toArray(), [3, 0 - ROBOT_PELVIS_HEIGHT, 9]);
});

test('timestamped freeze and resume preserve remaining transition progress', () => {
  const { handle } = agentHarness();
  const animator = createAgentAnimator({
    getHandle: () => handle,
    getWorkstation: () => workstationAt(3, 0, 9),
    scene: new THREE.Scene(),
  });
  animator.play({
    intent: { action: 'retry', sessionId: 'session-1' },
    event: {},
    duration_ms: 1200,
    started_at_ms: 1_000,
  });
  animator.update(1_500);
  const pausedPosition = handle.object.position.clone();

  animator.freeze(1_500);
  animator.update(5_000);
  assert.ok(handle.object.position.equals(pausedPosition));
  animator.resume(5_000);
  animator.update(5_250);
  assert.ok(!handle.object.position.equals(pausedPosition));
  assert.equal(animator.activeCount(), 1);
  animator.update(5_700);
  assert.equal(animator.activeCount(), 0);
});

test('delegation and evidence packets are transient and cleared from the scene', () => {
  const scene = new THREE.Scene();
  const packets = [];
  const animator = createAgentAnimator({
    getHandle: () => null,
    getWorkstation: () => null,
    createPacket: (kind) => {
      const packet = new THREE.Object3D();
      packet.userData.kind = kind;
      packets.push(packet);
      return packet;
    },
    scene,
  });
  assert.equal(animator.play({
    intent: { action: 'delegate', sessionId: null },
    event: {},
    duration_ms: 700,
    started_at_ms: 0,
  }), true);
  assert.equal(packets[0].userData.kind, 'task');
  assert.equal(packets[0].parent, scene);
  animator.update(700);
  assert.equal(packets[0].parent, null);
  assert.equal(animator.activeCount(), 0);
});

test('manager checks in at the involved desk, dwells, returns, and sits', () => {
  const { handle: manager, modes } = managerHarness();
  const callbacks = [];
  const animator = createAgentAnimator({
    getOrchestrator: () => manager,
    getWorkstation: () => workstationAt(6, 0, 8),
    onTransitionStart: (transition) => callbacks.push(`start:${transition.intent.action}`),
    onTransitionComplete: (transition) => callbacks.push(`complete:${transition.intent.action}`),
    scene: new THREE.Scene(),
  });

  assert.equal(animator.play({
    id: 'handoff-1:manager',
    intent: { action: 'manager_check_in', sessionId: 'session-a' },
    event: { type: 'handoff_created', agent_session_id: 'session-a' },
    duration_ms: 4_500,
    started_at_ms: 0,
  }), true);
  animator.update(750);
  assert.equal(modes.at(-1), 'walking');
  assert.notDeepEqual(manager.object.position.toArray(), STUDIO_TOPOLOGY.managerSeat.position);

  animator.update(2_250);
  assert.equal(modes.at(-1), 'standing');
  assert.deepEqual(manager.object.position.toArray(), [6, 0, 7]);
  assert.ok(Math.abs(manager.object.rotation.y) < 0.01);

  assert.equal(animator.update(4_500), false);
  assert.equal(modes.at(-1), 'sitting');
  assert.deepEqual(manager.object.position.toArray(), STUDIO_TOPOLOGY.managerSeat.position);
  assert.deepEqual(callbacks, ['start:manager_check_in', 'complete:manager_check_in']);
});

test('delegation returns the manager to the authored seat in sitting mode', () => {
  const { handle: manager, modes } = managerHarness();
  const animator = createAgentAnimator({
    getOrchestrator: () => manager,
    createPacket: () => new THREE.Object3D(),
    scene: new THREE.Scene(),
  });

  animator.play({
    id: 'delegate-1',
    intent: { action: 'delegate', sessionId: null },
    event: { type: 'delegation_requested' },
    duration_ms: 700,
    started_at_ms: 0,
  });
  animator.update(2_600);

  assert.deepEqual(manager.object.position.toArray(), STUDIO_TOPOLOGY.managerSeat.position);
  assert.equal(manager.object.rotation.y, STUDIO_TOPOLOGY.managerSeat.rotationY);
  assert.equal(modes.at(-1), 'sitting');
});

test('approval projection walks the manager to the strategy table and back', () => {
  const { handle: manager, modes } = managerHarness();
  const animator = createAgentAnimator({
    getOrchestrator: () => manager,
    scene: new THREE.Scene(),
  });
  const summary = { pending_count: 1, artifact: 'Release plan' };

  assert.equal(animator.managerState(), 'seated');
  animator.reconcileManager({ approvalActive: true, approvalSummary: summary }, 0);
  assert.equal(animator.managerState(), 'approval-walk');
  animator.update(2_200);
  assert.equal(animator.managerState(), 'approval');
  assert.deepEqual(manager.object.position.toArray(), STUDIO_TOPOLOGY.strategyApproval.managerStand);
  assert.equal(manager.object.rotation.y, STUDIO_TOPOLOGY.strategyApproval.managerRotationY);
  assert.equal(modes.at(-1), 'standing');

  animator.reconcileManager({ approvalActive: false, approvalSummary: null }, 2_300);
  assert.equal(animator.managerState(), 'approval-return');
  animator.update(4_500);
  assert.equal(animator.managerState(), 'seated');
  assert.deepEqual(manager.object.position.toArray(), STUDIO_TOPOLOGY.managerSeat.position);
  assert.equal(modes.at(-1), 'sitting');
});

test('latest approval state wins only after real manager work finishes', () => {
  const { handle: manager } = managerHarness();
  const animator = createAgentAnimator({
    getOrchestrator: () => manager,
    createPacket: () => new THREE.Object3D(),
    scene: new THREE.Scene(),
  });
  const summary = { pending_count: 1, artifact: 'Release plan' };

  animator.play({
    id: 'delegate-1',
    intent: { action: 'delegate' },
    event: { type: 'delegation_requested' },
    duration_ms: 700,
    started_at_ms: 0,
  });
  animator.reconcileManager({ approvalActive: true, approvalSummary: summary }, 100);
  assert.equal(animator.managerState(), 'event');
  animator.reconcileManager({ approvalActive: false, approvalSummary: null }, 1_000);
  animator.update(2_600);
  assert.equal(animator.managerState(), 'seated');

  animator.play({
    id: 'delegate-2',
    intent: { action: 'delegate' },
    event: { type: 'delegation_requested' },
    duration_ms: 700,
    started_at_ms: 3_000,
  });
  animator.reconcileManager({ approvalActive: true, approvalSummary: summary }, 3_100);
  animator.update(5_600);
  assert.equal(animator.managerState(), 'approval-walk');
  animator.update(7_800);
  assert.equal(animator.managerState(), 'approval');
});

test('reduced motion applies approval final states without active travel', () => {
  const { handle: manager, modes } = managerHarness();
  const animator = createAgentAnimator({
    getOrchestrator: () => manager,
    scene: new THREE.Scene(),
  });
  animator.setMotion('reduced');

  animator.reconcileManager({
    approvalActive: true,
    approvalSummary: { pending_count: 1, artifact: 'Release plan' },
  }, 0);
  assert.equal(animator.activeCount(), 0);
  assert.equal(animator.managerState(), 'approval');
  assert.deepEqual(manager.object.position.toArray(), STUDIO_TOPOLOGY.strategyApproval.managerStand);
  assert.equal(modes.at(-1), 'standing');

  animator.reconcileManager({ approvalActive: false, approvalSummary: null }, 100);
  assert.equal(animator.managerState(), 'seated');
  assert.deepEqual(manager.object.position.toArray(), STUDIO_TOPOLOGY.managerSeat.position);
  assert.equal(modes.at(-1), 'sitting');
});
