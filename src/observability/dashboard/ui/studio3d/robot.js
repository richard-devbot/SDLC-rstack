/**
 * Original CPU-first procedural humanoid robot for Agent Force Studio.
 *
 * owner: RStack developed by Richardson Gunde
 */
import * as THREE from 'three';
import { ROBOT_POSES } from './robot-poses.js';

const FACE_COLORS = Object.freeze({
  neutral: 0x8b96a6,
  focused: 0xe5b860,
  attentive: 0x71a7ff,
  waiting: 0x9e82ed,
  alert: 0xff5f57,
  complete: 0x58bd86,
});

const STATUS_FACES = Object.freeze({
  queued: 'neutral',
  starting: 'attentive',
  active: 'focused',
  waiting: 'waiting',
  blocked: 'alert',
  failed: 'alert',
  completed: 'complete',
  stopped: 'neutral',
  unknown: 'neutral',
});

function mesh(geometry, material, scale, position = [0, 0, 0], name = '') {
  const object = new THREE.Mesh(geometry, material);
  object.scale.set(...scale);
  object.position.set(...position);
  object.name = name;
  return object;
}

function pivot(name, parent, position) {
  const object = new THREE.Group();
  object.name = name;
  object.position.set(...position);
  parent.add(object);
  return object;
}

export function applyRobotPose(handle, poseName, weight = 1) {
  const selectedName = Object.hasOwn(ROBOT_POSES, poseName) ? poseName : 'standing';
  const selected = ROBOT_POSES[selectedName];
  const amount = THREE.MathUtils.clamp(Number(weight) || 0, 0, 1);
  for (const [name, value] of Object.entries(selected)) {
    const target = handle.joints[name];
    if (!target) continue;
    target.rotation.x = THREE.MathUtils.lerp(target.rotation.x, value[0], amount);
    target.rotation.y = THREE.MathUtils.lerp(target.rotation.y, value[1], amount);
    target.rotation.z = THREE.MathUtils.lerp(target.rotation.z, value[2], amount);
  }
  handle.pose = selectedName;
}

export function setRobotFace(handle, state) {
  const selected = Object.hasOwn(FACE_COLORS, state) ? state : 'neutral';
  const color = FACE_COLORS[selected];
  handle.faceMaterial.color.setHex(color);
  handle.faceMaterial.emissive.setHex(color);
  handle.faceDisplay.userData.state = selected;
  handle.faceState = selected;
}

function createArm(side, sign, torso, joints, pool) {
  const shoulder = joints[`shoulder${side}`] = pivot(`shoulder${side}`, torso, [0.53 * sign, 0.34, 0]);
  shoulder.add(mesh(pool.geometries.sphere, pool.materials.robotJoint, [0.14, 0.14, 0.14], [0, 0, 0], `shoulderShell${side}`));
  shoulder.add(mesh(pool.geometries.cylinder, pool.materials.robotShell, [0.11, 0.38, 0.11], [0, -0.25, 0], `upperArm${side}`));

  const elbow = joints[`elbow${side}`] = pivot(`elbow${side}`, shoulder, [0, -0.5, 0]);
  elbow.add(mesh(pool.geometries.sphere, pool.materials.robotJoint, [0.13, 0.13, 0.13], [0, 0, 0], `elbowShell${side}`));
  elbow.add(mesh(pool.geometries.cylinder, pool.materials.robotShell, [0.095, 0.34, 0.095], [0, -0.23, 0], `forearm${side}`));

  const wrist = joints[`wrist${side}`] = pivot(`wrist${side}`, elbow, [0, -0.46, 0]);
  wrist.add(mesh(pool.geometries.sphere, pool.materials.robotJoint, [0.1, 0.1, 0.1], [0, 0, 0], `wristShell${side}`));
  const hand = joints[`hand${side}`] = pivot(`hand${side}`, wrist, [0, -0.12, 0.02]);
  hand.add(mesh(pool.geometries.slab, pool.materials.robotShell, [0.13, 0.17, 0.08], [0, -0.07, 0.04], `handShell${side}`));
}

function createLeg(side, sign, pelvis, joints, pool) {
  const hip = joints[`hip${side}`] = pivot(`hip${side}`, pelvis, [0.23 * sign, -0.06, 0]);
  hip.add(mesh(pool.geometries.sphere, pool.materials.robotJoint, [0.16, 0.16, 0.16], [0, 0, 0], `hipShell${side}`));
  hip.add(mesh(pool.geometries.cylinder, pool.materials.robotShell, [0.15, 0.48, 0.15], [0, -0.32, 0], `thigh${side}`));

  const knee = joints[`knee${side}`] = pivot(`knee${side}`, hip, [0, -0.64, 0]);
  knee.add(mesh(pool.geometries.sphere, pool.materials.robotJoint, [0.145, 0.145, 0.145], [0, 0, 0], `kneeShell${side}`));
  knee.add(mesh(pool.geometries.cylinder, pool.materials.robotShell, [0.13, 0.44, 0.13], [0, -0.3, 0], `shin${side}`));

  const ankle = joints[`ankle${side}`] = pivot(`ankle${side}`, knee, [0, -0.6, 0]);
  ankle.add(mesh(pool.geometries.sphere, pool.materials.robotJoint, [0.11, 0.11, 0.11], [0, 0, 0], `ankleShell${side}`));
  const foot = joints[`foot${side}`] = pivot(`foot${side}`, ankle, [0, -0.1, 0.12]);
  foot.add(mesh(pool.geometries.slab, pool.materials.robotShell, [0.19, 0.1, 0.34], [0, -0.02, 0.13], `footShell${side}`));
}

export function createHumanoidRobot(pool, data = {}) {
  const object = new THREE.Group();
  object.name = `${data.role === 'validator' ? 'Validator' : 'Builder'} robot · ${data.agent_id ?? data.id ?? 'unassigned'}`;
  const joints = {};

  const pelvis = joints.pelvis = pivot('pelvis', object, [0, 1.34, 0]);
  pelvis.add(mesh(pool.geometries.slab, pool.materials.robotJoint, [0.35, 0.22, 0.24], [0, 0.03, 0], 'pelvisShell'));
  const torso = joints.torso = pivot('torso', pelvis, [0, 0.48, 0]);
  torso.add(mesh(pool.geometries.slab, pool.materials.robotShell, [0.47, 0.5, 0.27], [0, 0.2, 0], 'torsoShell'));
  const roleBand = mesh(
    pool.geometries.slab,
    data.role === 'validator' ? pool.materials.validator : pool.materials.amber,
    [0.35, 0.055, 0.285],
    [0, 0.22, 0],
    'roleBand',
  );
  torso.add(roleBand);

  const neck = joints.neck = pivot('neck', torso, [0, 0.76, 0]);
  neck.add(mesh(pool.geometries.cylinder, pool.materials.robotJoint, [0.12, 0.16, 0.12], [0, 0.06, 0], 'neckShell'));
  const head = joints.head = pivot('head', neck, [0, 0.28, 0]);
  head.add(mesh(pool.geometries.slab, pool.materials.robotShell, [0.39, 0.31, 0.31], [0, 0.04, 0], 'headShell'));
  const faceDisplay = new THREE.Group();
  faceDisplay.name = 'faceDisplay';
  faceDisplay.position.set(0, 0.04, 0.32);
  const screen = mesh(pool.geometries.slab, pool.materials.robotScreen, [0.29, 0.17, 0.025], [0, 0, 0], 'faceScreen');
  faceDisplay.add(screen);

  const faceMaterial = pool.materials.robotFace.clone();
  const eyeLeft = mesh(pool.geometries.sphere, faceMaterial, [0.055, 0.042, 0.018], [-0.1, 0.015, 0.035], 'eyeLeft');
  const eyeRight = mesh(pool.geometries.sphere, faceMaterial, [0.055, 0.042, 0.018], [0.1, 0.015, 0.035], 'eyeRight');
  faceDisplay.add(eyeLeft, eyeRight);
  head.add(faceDisplay);

  const chestLight = mesh(pool.geometries.sphere, faceMaterial, [0.075, 0.075, 0.035], [0, 0.26, 0.29], 'chestLight');
  torso.add(chestLight);
  createArm('Left', -1, torso, joints, pool);
  createArm('Right', 1, torso, joints, pool);
  createLeg('Left', -1, pelvis, joints, pool);
  createLeg('Right', 1, pelvis, joints, pool);

  const anchors = {
    seat: pivot('seatAnchor', object, [0, 0.92, 0.2]),
    keyboard: pivot('keyboardAnchor', object, [0, 1.36, 0.76]),
    screenFocus: pivot('screenFocusAnchor', object, [0, 2.02, 1.46]),
    handoff: pivot('handoffAnchor', object, [0, 1.46, 0.92]),
  };

  const handle = {
    object,
    joints,
    anchors: Object.freeze(anchors),
    faceDisplay,
    faceMaterial,
    faceState: 'neutral',
    pose: 'standing',
    setPose(name, weight = 1) {
      applyRobotPose(handle, name, weight);
    },
    setFace(state) {
      setRobotFace(handle, state);
    },
    update(next = {}) {
      object.userData.data = next;
      object.userData.status = next.status ?? 'unknown';
      object.userData.role = next.role ?? 'builder';
      object.userData.entityRef = { kind: next.kind ?? 'session', id: next.id ?? null };
      roleBand.material = next.role === 'validator' ? pool.materials.validator : pool.materials.amber;
      handle.setFace(STATUS_FACES[next.status] ?? 'neutral');
    },
    reset() {
      object.position.set(0, 0, 0);
      object.rotation.set(0, 0, 0);
      object.scale.set(1, 1, 1);
      handle.setPose('standing');
      handle.setFace('neutral');
      object.userData.data = null;
      object.userData.status = 'unknown';
      object.userData.role = 'builder';
      object.userData.entityRef = { kind: 'session', id: null };
    },
    dispose() {
      faceMaterial.dispose();
      object.removeFromParent();
    },
  };

  object.userData.robotHandle = handle;
  handle.update(data);
  handle.setPose('standing');
  return handle;
}
