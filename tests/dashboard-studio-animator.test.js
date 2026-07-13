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
