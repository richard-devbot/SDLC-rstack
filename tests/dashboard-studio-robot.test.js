/**
 * Procedural humanoid robot contracts for Agent Force Studio.
 *
 * owner: RStack developed by Richardson Gunde
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { createResourcePool } from '../src/observability/dashboard/ui/studio3d/geometry.js';
import {
  createHumanoidRobot,
  createRobotFleetRenderer,
} from '../src/observability/dashboard/ui/studio3d/robot.js';
import {
  ROBOT_JOINT_NAMES,
  ROBOT_POSES,
} from '../src/observability/dashboard/ui/studio3d/robot-poses.js';

test('humanoid robot exposes the complete articulated hierarchy', () => {
  const pool = createResourcePool();
  const robot = createHumanoidRobot(pool, {
    id: 'session-1',
    agent_id: 'agent.07-code',
    role: 'builder',
    status: 'active',
  });

  assert.ok(robot.object instanceof THREE.Group);
  assert.equal(robot.object.userData.robotHandle, robot);
  assert.equal(robot.object.userData.entityRef.id, 'session-1');
  for (const name of ROBOT_JOINT_NAMES) {
    assert.ok(robot.joints[name] instanceof THREE.Object3D, name);
  }
  assert.ok(robot.object.getObjectByName('faceDisplay'));
  assert.ok(robot.object.getObjectByName('chestLight'));
  assert.ok(robot.object.getObjectByName('eyeLeft'));
  assert.ok(robot.object.getObjectByName('eyeRight'));

  robot.dispose();
  pool.dispose();
});

test('every authored pose is immutable and produces finite joint transforms', () => {
  assert.equal(Object.isFrozen(ROBOT_POSES), true);
  const pool = createResourcePool();
  const robot = createHumanoidRobot(pool, { id: 'session-2', role: 'builder', status: 'starting' });

  for (const poseName of Object.keys(ROBOT_POSES)) {
    assert.equal(Object.isFrozen(ROBOT_POSES[poseName]), true, poseName);
    robot.setPose(poseName);
    assert.equal(robot.pose, poseName);
    for (const joint of Object.values(robot.joints)) {
      assert.ok([joint.rotation.x, joint.rotation.y, joint.rotation.z].every(Number.isFinite), `${poseName}:${joint.name}`);
    }
  }

  robot.dispose();
  pool.dispose();
});

test('seated work and validation poses use authored workstation contact anchors', () => {
  const pool = createResourcePool();
  const robot = createHumanoidRobot(pool, { id: 'session-3', role: 'validator', status: 'active' });

  robot.setPose('seated_work');
  assert.ok(robot.joints.hipLeft.rotation.x < -1.2);
  assert.ok(robot.joints.hipRight.rotation.x < -1.2);
  assert.ok(robot.joints.kneeLeft.rotation.x > 1.2);
  assert.ok(robot.joints.kneeRight.rotation.x > 1.2);
  assert.ok(robot.anchors.seat.position.y < robot.anchors.keyboard.position.y);
  assert.ok(robot.anchors.keyboard.position.z < robot.anchors.screenFocus.position.z);
  assert.ok(robot.anchors.handoff.position.y > robot.anchors.seat.position.y);

  robot.setPose('validating');
  assert.notEqual(robot.joints.head.rotation.y, 0);

  robot.dispose();
  pool.dispose();
});

test('face expressions are semantic, per-robot, and conservative', () => {
  const pool = createResourcePool();
  const builder = createHumanoidRobot(pool, { id: 'session-a', role: 'builder', status: 'active' });
  const validator = createHumanoidRobot(pool, { id: 'session-b', role: 'validator', status: 'waiting' });

  assert.notEqual(builder.faceMaterial, validator.faceMaterial);
  assert.equal(builder.faceState, 'focused');
  assert.equal(validator.faceState, 'waiting');
  builder.setFace('complete');
  assert.equal(builder.faceState, 'complete');
  builder.setFace('not-a-state');
  assert.equal(builder.faceState, 'neutral');
  assert.equal(validator.faceState, 'waiting');

  builder.dispose();
  validator.dispose();
  pool.dispose();
});

test('reset removes prior session pose and status before reuse', () => {
  const pool = createResourcePool();
  const robot = createHumanoidRobot(pool, { id: 'session-old', role: 'builder', status: 'failed' });
  robot.object.position.set(8, 3, -4);
  robot.object.rotation.y = 1.2;
  robot.setPose('failed');

  robot.reset();

  assert.deepEqual(robot.object.position.toArray(), [0, 0, 0]);
  assert.deepEqual(robot.object.rotation.toArray().slice(0, 3), [0, 0, 0]);
  assert.equal(robot.pose, 'standing');
  assert.equal(robot.faceState, 'neutral');
  assert.equal(robot.object.userData.status, 'unknown');
  assert.equal(robot.object.userData.data, null);

  robot.dispose();
  assert.equal(robot.object.parent, null);
  pool.dispose();
});

test('fleet renderer batches seventeen articulated robots into at most eight draws', () => {
  const pool = createResourcePool();
  const handles = Array.from({ length: 17 }, (_, index) => createHumanoidRobot(pool, {
    id: `robot-${index + 1}`,
    kind: index === 0 ? 'orchestrator' : 'session',
    role: index === 0 ? 'orchestrator' : index % 4 === 0 ? 'validator' : 'builder',
    status: 'active',
  }));
  const entries = handles.map((robot, index) => [
    `${index === 0 ? 'orchestrator' : 'session'}:robot-${index + 1}`,
    { object: robot.object, robot },
  ]);
  const fleet = createRobotFleetRenderer(pool);
  fleet.reconcile(entries);
  fleet.update();

  assert.ok(fleet.object instanceof THREE.Group);
  assert.ok(fleet.object.children.length <= 8);
  assert.ok(fleet.object.children.every((child) => child instanceof THREE.InstancedMesh));
  assert.ok(fleet.object.children.every((child) => child.count > 0));
  assert.ok(handles.every((robot) => {
    let hidden = true;
    robot.object.traverse((object) => { if (object.isMesh && object.visible) hidden = false; });
    return hidden;
  }));
  assert.deepEqual(fleet.object.children[0].userData.entityRefs[0], { kind: 'orchestrator', id: 'robot-1' });

  fleet.dispose();
  handles.forEach((robot) => robot.dispose());
  pool.dispose();
});

test('fleet reconciliation restores robots that leave the active batch', () => {
  const pool = createResourcePool();
  const first = createHumanoidRobot(pool, { id: 'robot-first', kind: 'session', status: 'active' });
  const second = createHumanoidRobot(pool, { id: 'robot-second', kind: 'session', status: 'active' });
  const fleet = createRobotFleetRenderer(pool, { maxRobots: 1 });

  fleet.reconcile([['session:robot-first', { object: first.object, robot: first }]]);
  fleet.reconcile([['session:robot-second', { object: second.object, robot: second }]]);

  const visibleMeshes = (robot) => {
    let count = 0;
    robot.object.traverse((object) => { if (object.isMesh && object.visible) count += 1; });
    return count;
  };
  assert.ok(visibleMeshes(first) > 0);
  assert.equal(visibleMeshes(second), 0);

  fleet.dispose();
  first.dispose();
  second.dispose();
  pool.dispose();
});
