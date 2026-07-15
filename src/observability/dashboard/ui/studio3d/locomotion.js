/**
 * Procedural locomotion for the GLB cast.
 *
 * The Richardson-supplied models ship with one clip each (idle / typing) and
 * no Walk cycle, so walking is synthesized here: named skeleton bones swing
 * around their rest pose while the animator moves the body along authored
 * corridor routes. When regenerated models arrive with real Walk clips this
 * module becomes obsolete per-model — clip playback simply wins.
 *
 * owner: RStack developed by Richardson Gunde
 */
import * as THREE from 'three';

/**
 * Known rig families. `detect` picks the family from any bone name; each
 * bone pattern must match exactly one bone. Signs flip per-family when a
 * rig's local axes disagree with the default swing direction.
 */
const RIG_FAMILIES = [
  {
    id: 'mixamo',
    detect: /^mixamorig:Hips/,
    bones: {
      hips: /^mixamorig:Hips_/,
      spine: /^mixamorig:Spine_/,
      thighL: /^mixamorig:LeftUpLeg/,
      thighR: /^mixamorig:RightUpLeg/,
      kneeL: /^mixamorig:LeftLeg_/,
      kneeR: /^mixamorig:RightLeg_/,
      armL: /^mixamorig:LeftArm_/,
      armR: /^mixamorig:RightArm_/,
    },
    thighSwing: 0.5,
    kneeBend: 0.8,
    armSwing: 0.3,
    sit: Object.freeze({
      hipsDrop: 0.42,
      thighPitch: -Math.PI / 2,
      kneePitch: Math.PI / 2,
      armPitch: -0.48,
    }),
  },
  {
    id: 'lowpoly-worker',
    detect: /^Thigh\.L/,
    bones: {
      hips: /^base_/,
      spine: /^Torso1_/,
      thighL: /^Thigh\.L/,
      thighR: /^Thigh\.R/,
      kneeL: /^Calf\.L/,
      kneeR: /^Calf\.R/,
      armL: /^Shoulder\.L/,
      armR: /^Shoulder\.R/,
    },
    thighSwing: 0.5,
    kneeBend: 0.8,
    armSwing: 0.25,
    sit: Object.freeze({
      hipsDrop: 0.34,
      thighPitch: -Math.PI / 2,
      kneePitch: Math.PI / 2,
      armPitch: -0.42,
    }),
  },
];

/**
 * Build a locomotion driver for a cloned cast body, or null when no known
 * rig is present (callers fall back to whole-body motion only).
 */
export function createLocomotion(object) {
  const bones = [];
  object.traverse((child) => {
    if (child.isBone) bones.push(child);
  });
  if (!bones.length) return null;
  const family = RIG_FAMILIES.find((spec) => bones.some((bone) => spec.detect.test(bone.name)));
  if (!family) return null;

  const rig = {};
  const rest = new Map();
  for (const [key, pattern] of Object.entries(family.bones)) {
    const bone = bones.find((candidate) => pattern.test(candidate.name)) ?? null;
    rig[key] = bone;
    if (bone) rest.set(bone, { quaternion: bone.quaternion.clone(), position: bone.position.clone() });
  }
  if (!rig.thighL || !rig.thighR) return null;

  const spin = new THREE.Quaternion();
  const AXIS_X = new THREE.Vector3(1, 0, 0);
  const pose = (key, angle) => {
    const bone = rig[key];
    if (!bone) return;
    bone.quaternion.copy(rest.get(bone).quaternion)
      .multiply(spin.setFromAxisAngle(AXIS_X, angle));
  };

  return {
    family: family.id,
    /** phase advances 1.0 per full stride. */
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
    /** Seat the rig around captured rest transforms without cumulative drift. */
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
    /** Return every driven bone to its rest pose. */
    stand() {
      for (const key of Object.keys(rig)) pose(key, 0);
      if (rig.hips) rig.hips.position.copy(rest.get(rig.hips).position);
    },
  };
}
