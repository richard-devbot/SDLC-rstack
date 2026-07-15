/**
 * Seated locomotion contracts for the local Studio cast.
 *
 * owner: RStack developed by Richardson Gunde
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { createLocomotion } from '../src/observability/dashboard/ui/studio3d/locomotion.js';

function rig(names) {
  const root = new THREE.Group();
  const bones = Object.fromEntries(Object.entries(names).map(([key, name]) => {
    const bone = new THREE.Bone();
    bone.name = name;
    root.add(bone);
    return [key, bone];
  }));
  bones.hips.position.y = 1.1;
  return { root, ...bones };
}

function mixamoManagerRig() {
  return rig({
    hips: 'mixamorig:Hips_07',
    spine: 'mixamorig:Spine_08',
    leftUpLeg: 'mixamorig:LeftUpLeg_055',
    rightUpLeg: 'mixamorig:RightUpLeg_060',
    leftLeg: 'mixamorig:LeftLeg_056',
    rightLeg: 'mixamorig:RightLeg_061',
    leftArm: 'mixamorig:LeftArm_027',
    rightArm: 'mixamorig:RightArm_036',
  });
}

function humanApproverRig() {
  return rig({
    hips: 'mixamorig:Hips_01',
    spine: 'mixamorig:Spine_02',
    leftUpLeg: 'mixamorig:LeftUpLeg_055',
    rightUpLeg: 'mixamorig:RightUpLeg_060',
    leftLeg: 'mixamorig:LeftLeg_056',
    rightLeg: 'mixamorig:RightLeg_061',
    leftArm: 'mixamorig:LeftArm_027',
    rightArm: 'mixamorig:RightArm_036',
  });
}

function lowPolyWorkerRig() {
  return rig({
    hips: 'base_01',
    spine: 'Torso1_02',
    leftUpLeg: 'Thigh.L',
    rightUpLeg: 'Thigh.R',
    leftLeg: 'Calf.L',
    rightLeg: 'Calf.R',
    leftArm: 'Shoulder.L',
    rightArm: 'Shoulder.R',
  });
}

test('sit lowers hips and bends legs and arms for every Studio rig family', () => {
  for (const candidate of [mixamoManagerRig(), humanApproverRig(), lowPolyWorkerRig()]) {
    const locomotion = createLocomotion(candidate.root);
    const hipY = candidate.hips.position.y;

    locomotion.sit();

    assert.ok(candidate.hips.position.y < hipY, `${locomotion.family} lowers hips`);
    assert.ok(Math.abs(candidate.leftUpLeg.rotation.x) > 1.2, `${locomotion.family} bends thighs`);
    assert.ok(Math.abs(candidate.leftLeg.rotation.x) > 1.2, `${locomotion.family} bends knees`);
    assert.ok(Math.abs(candidate.leftArm.rotation.x) > 0.25, `${locomotion.family} reaches forward`);
  }
});

test('sit and stand always restore captured rest transforms without drift', () => {
  const candidate = humanApproverRig();
  const locomotion = createLocomotion(candidate.root);
  const hipY = candidate.hips.position.y;
  const rest = candidate.leftUpLeg.quaternion.clone();

  locomotion.sit();
  const firstSit = candidate.leftUpLeg.quaternion.clone();
  locomotion.stand();
  locomotion.sit();

  assert.ok(candidate.leftUpLeg.quaternion.equals(firstSit));
  locomotion.stand();
  assert.ok(candidate.leftUpLeg.quaternion.equals(rest));
  assert.equal(candidate.hips.position.y, hipY);
});
