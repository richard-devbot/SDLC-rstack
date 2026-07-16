/**
 * Authored humanoid poses for Agent Force Studio.
 *
 * owner: RStack developed by Richardson Gunde
 */
export const ROBOT_JOINT_NAMES = Object.freeze([
  'pelvis',
  'torso',
  'neck',
  'head',
  'shoulderLeft',
  'elbowLeft',
  'wristLeft',
  'handLeft',
  'shoulderRight',
  'elbowRight',
  'wristRight',
  'handRight',
  'hipLeft',
  'kneeLeft',
  'ankleLeft',
  'footLeft',
  'hipRight',
  'kneeRight',
  'ankleRight',
  'footRight',
]);

function rotation(x = 0, y = 0, z = 0) {
  return Object.freeze([x, y, z]);
}

function pose(overrides = {}) {
  return Object.freeze(Object.fromEntries(ROBOT_JOINT_NAMES.map((name) => [
    name,
    overrides[name] ?? rotation(),
  ])));
}

export const ROBOT_POSES = Object.freeze({
  standing: pose({
    shoulderLeft: rotation(0, 0, 0.08),
    shoulderRight: rotation(0, 0, -0.08),
  }),
  walkA: pose({
    torso: rotation(0, 0.05),
    shoulderLeft: rotation(-0.48, 0, 0.08),
    shoulderRight: rotation(0.48, 0, -0.08),
    hipLeft: rotation(0.55),
    hipRight: rotation(-0.55),
    kneeLeft: rotation(0.22),
    kneeRight: rotation(0.7),
    ankleLeft: rotation(-0.12),
    ankleRight: rotation(-0.28),
  }),
  walkB: pose({
    torso: rotation(0, -0.05),
    shoulderLeft: rotation(0.48, 0, 0.08),
    shoulderRight: rotation(-0.48, 0, -0.08),
    hipLeft: rotation(-0.55),
    hipRight: rotation(0.55),
    kneeLeft: rotation(0.7),
    kneeRight: rotation(0.22),
    ankleLeft: rotation(-0.28),
    ankleRight: rotation(-0.12),
  }),
  seated_work: pose({
    torso: rotation(-0.08),
    head: rotation(-0.08),
    shoulderLeft: rotation(-0.62, 0.12, 0.12),
    shoulderRight: rotation(-0.62, -0.12, -0.12),
    elbowLeft: rotation(-1.05),
    elbowRight: rotation(-1.05),
    wristLeft: rotation(0.18),
    wristRight: rotation(0.18),
    hipLeft: rotation(-1.48),
    hipRight: rotation(-1.48),
    kneeLeft: rotation(1.45),
    kneeRight: rotation(1.45),
    ankleLeft: rotation(0.08),
    ankleRight: rotation(0.08),
  }),
  validating: pose({
    torso: rotation(-0.05, 0.08),
    head: rotation(-0.14, 0.18),
    shoulderLeft: rotation(-0.45, 0.08, 0.08),
    shoulderRight: rotation(-0.8, -0.08, -0.08),
    elbowLeft: rotation(-0.9),
    elbowRight: rotation(-1.12),
    wristLeft: rotation(0.1),
    wristRight: rotation(0.22),
    hipLeft: rotation(-1.48),
    hipRight: rotation(-1.48),
    kneeLeft: rotation(1.45),
    kneeRight: rotation(1.45),
    ankleLeft: rotation(0.08),
    ankleRight: rotation(0.08),
  }),
  waiting: pose({
    torso: rotation(0, 0.2),
    head: rotation(0, 0.42),
    shoulderLeft: rotation(-0.15, 0, 0.08),
    shoulderRight: rotation(-0.15, 0, -0.08),
    elbowLeft: rotation(-0.45),
    elbowRight: rotation(-0.45),
  }),
  handoff: pose({
    torso: rotation(-0.06),
    head: rotation(-0.04),
    shoulderLeft: rotation(-0.9, 0.15, 0.08),
    shoulderRight: rotation(-0.9, -0.15, -0.08),
    elbowLeft: rotation(-0.52),
    elbowRight: rotation(-0.52),
    wristLeft: rotation(0.1),
    wristRight: rotation(0.1),
  }),
  failed: pose({
    torso: rotation(0.12),
    head: rotation(0.28),
    shoulderLeft: rotation(0.15, 0, 0.14),
    shoulderRight: rotation(0.15, 0, -0.14),
  }),
  complete: pose({
    head: rotation(-0.05),
    shoulderLeft: rotation(0, 0, 0.08),
    shoulderRight: rotation(-1.1, 0, -0.35),
    elbowRight: rotation(-0.7),
  }),
});
