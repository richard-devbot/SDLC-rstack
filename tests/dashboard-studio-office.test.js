/**
 * Living robot office and truthful occupancy contracts.
 *
 * owner: RStack developed by Richardson Gunde
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
  createProceduralHumanApprover,
  createEntityFactories,
  createResourcePool,
  createWorkPacket,
} from '../src/observability/dashboard/ui/studio3d/geometry.js';
import {
  assignOfficeProjection,
  createOfficeEnvironment,
} from '../src/observability/dashboard/ui/studio3d/office.js';
import { createEntityReconciler } from '../src/observability/dashboard/ui/studio3d/reconciler.js';
import { STUDIO_TOPOLOGY } from '../src/observability/dashboard/ui/studio3d/topology.js';

test('office builds every company facility with exactly fifteen stage signals', () => {
  const pool = createResourcePool();
  const office = createOfficeEnvironment(pool);

  assert.ok(office.object instanceof THREE.Group);
  assert.equal(office.stageSignals.size, 15);
  const gantry = office.object.getObjectByName('Fifteen-stage pipeline gantry');
  const stageSignals = [...office.stageSignals.values()];
  assert.ok(gantry instanceof THREE.Group);
  assert.equal(office.object.getObjectByName('Fifteen-stage pipeline wall'), undefined);
  assert.deepEqual(
    [...office.stageSignals.keys()],
    STUDIO_TOPOLOGY.departments.map((department) => department.id),
  );
  assert.ok(stageSignals.every((signal) => signal.position.y >= 2.6));
  assert.ok(stageSignals.every((signal) => (
    Math.abs(signal.position.z - STUDIO_TOPOLOGY.corridor.z) < 0.8
  )));
  assert.ok(stageSignals.every((signal, index) => (
    index === 0 || signal.position.x > stageSignals[index - 1].position.x
  )));
  assert.ok(Object.values(STUDIO_TOPOLOGY.routes).flat().every((point) => (
    point[1] < STUDIO_TOPOLOGY.pipelineGantry.minClearanceY
  )));
  assert.equal(office.missionBoards.size, 8);
  assert.equal(office.desks.builder.length, 8);
  assert.equal(office.desks.validator.length, 4);
  for (const name of [
    'Orchestrator HQ',
    'Skills and Plugin Library',
    'Glass Validator Lab',
    'Governance Room',
    'Dispatch',
    'Evidence Vault',
    'Builder workstations',
    'Validator workstations',
    'Mission boards',
    'Goal token',
    'Governance beacon',
    'Vault status light',
  ]) {
    assert.ok(office.object.getObjectByName(name), name);
  }
  // The cutaway architecture is real: walls, glass, room finishes, plants,
  // casework, and the stage work-cell rail — all instanced.
  for (const name of [
    'Office walls',
    'Glass partitions',
    'Room floor finishes',
    'Plant pots',
    'Plant foliage',
    'Office casework',
    'Library capability stock',
    'Stage work-cell docks',
  ]) {
    assert.ok(office.object.getObjectByName(name) instanceof THREE.InstancedMesh, name);
  }
  assert.ok(office.object.getObjectByName('Builder desk tops') instanceof THREE.InstancedMesh);
  assert.ok(office.object.getObjectByName('Office chairs') instanceof THREE.InstancedMesh);
  assert.ok(office.object.getObjectByName('Office monitors') instanceof THREE.InstancedMesh);
  // Attention fixtures stay dark until the projection adopts them.
  assert.equal(office.governanceBeacon.visible, false);
  assert.equal(office.vaultLight.visible, false);

  office.dispose();
  assert.equal(office.object.parent, null);
  pool.dispose();
});

test('office desks start empty and expose authored work-contact anchors', () => {
  const pool = createResourcePool();
  const office = createOfficeEnvironment(pool);

  for (const desk of [...office.desks.builder, ...office.desks.validator]) {
    assert.equal(desk.occupant, null);
    assert.ok(desk.object instanceof THREE.Object3D);
    assert.ok(desk.seat instanceof THREE.Object3D);
    assert.ok(desk.keyboard instanceof THREE.Object3D);
    assert.ok(desk.screen instanceof THREE.Object3D);
    assert.ok(desk.handoff instanceof THREE.Object3D);
    assert.ok(desk.seat.position.y < desk.keyboard.position.y);
    assert.ok(desk.keyboard.position.z < desk.screen.position.z);
  }

  office.dispose();
  pool.dispose();
});

test('company topology authors the manager seat and south-facing approval table', () => {
  assert.deepEqual(STUDIO_TOPOLOGY.managerSeat.position, [-4.56, 0.54, -11.15]);
  assert.equal(STUDIO_TOPOLOGY.managerSeat.rotationY, Math.PI / 2);
  assert.deepEqual(STUDIO_TOPOLOGY.strategyApproval.chairPosition, [-2, 0, -10.72]);
  assert.equal(STUDIO_TOPOLOGY.strategyApproval.chairRotationY, Math.PI);
  assert.deepEqual(STUDIO_TOPOLOGY.strategyApproval.humanSeat, [-2, 0.54, -10.72]);
  assert.deepEqual(STUDIO_TOPOLOGY.strategyApproval.managerStand, [-2, 0, -9.55]);
  assert.equal(STUDIO_TOPOLOGY.strategyApproval.managerRotationY, 0);
});

test('human approver has a pooled procedural seated fallback', () => {
  const pool = createResourcePool();
  const human = createProceduralHumanApprover(pool);

  assert.ok(human.object instanceof THREE.Group);
  assert.equal(human.object.name, 'Human approver fallback');
  assert.ok(human.object.children.length >= 6);
  human.setMode('sitting');
  assert.equal(human.object.userData.mode, 'sitting');

  human.dispose();
  pool.dispose();
});

test('entity factories produce humanoid Orchestrator and session handles', () => {
  const pool = createResourcePool();
  const factories = createEntityFactories(pool);
  const orchestrator = factories.orchestrator(
    { id: 'orchestrator-hq', role: 'orchestrator', status: 'active' },
    STUDIO_TOPOLOGY.orchestrator,
  );
  const session = factories.session(
    { id: 'session-1', agent_id: 'agent.07-code', role: 'builder', status: 'active' },
    STUDIO_TOPOLOGY.builderDesks[0],
  );

  assert.ok(orchestrator.robot);
  assert.ok(session.robot);
  assert.ok(orchestrator.object.getObjectByName('faceDisplay'));
  assert.ok(session.object.getObjectByName('handLeft'));
  assert.equal(orchestrator.object.userData.entityRef.kind, 'orchestrator');
  assert.equal(session.object.userData.entityRef.kind, 'session');

  orchestrator.dispose();
  session.dispose();
  pool.dispose();
});

test('reconciler reserves two fixed cast slots and aggregates beyond fourteen sessions', () => {
  const scene = new THREE.Scene();
  const factory = (_data) => ({
    object: new THREE.Group(),
    update(next) { this.object.userData.data = next; },
    dispose() {},
  });
  const reconciler = createEntityReconciler({
    scene,
    maxDetailedSessions: 14,
    factories: {
      orchestrator: factory,
      mission: factory,
      department: factory,
      session: factory,
      aggregate: factory,
    },
  });
  const sessions = Array.from({ length: 18 }, (_, index) => ({
    id: `session-${index + 1}`,
    role: index % 5 === 0 ? 'validator' : 'builder',
    status: 'active',
  }));

  const registry = reconciler.apply({
    orchestrator: { id: 'orchestrator-hq', status: 'active' },
    missions: [],
    departments: [],
    sessions,
    governance_items: [],
    evidence_items: [],
  });

  assert.equal([...registry.keys()].filter((key) => key.startsWith('session:')).length, 14);
  assert.ok(registry.has('aggregate:overflow-sessions'));
  assert.equal(registry.get('aggregate:overflow-sessions').object.userData.data.count, 4);
  assert.equal(registry.has('session:session-1'), false);
  assert.equal(registry.has('session:session-18'), true);
  reconciler.clear();
});

test('work packets distinguish task and evidence without external assets', () => {
  const pool = createResourcePool();
  const task = createWorkPacket(pool, 'task');
  const artifact = createWorkPacket(pool, 'artifact');
  assert.equal(task.userData.kind, 'task');
  assert.equal(artifact.userData.kind, 'artifact');
  assert.notEqual(task.material, artifact.material);
  pool.dispose();
});

test('projection assignment never double-books a desk and lights the goal token', () => {
  const pool = createResourcePool();
  const office = createOfficeEnvironment(pool);
  const sessions = [
    ...Array.from({ length: 10 }, (_, index) => ({ id: `builder-${index + 1}`, role: 'builder' })),
    ...Array.from({ length: 6 }, (_, index) => ({ id: `validator-${index + 1}`, role: 'validator' })),
  ];

  const assigned = assignOfficeProjection(office, {
    sessions,
    orchestrator: { id: 'orchestrator-hq', status: 'active' },
  }, pool, 14);
  const occupied = [...office.desks.builder, ...office.desks.validator]
    .map((desk) => desk.occupant)
    .filter(Boolean);
  assert.equal(assigned.size, 12);
  assert.equal(new Set(occupied).size, occupied.length);
  assert.equal(occupied.length, 12);
  assert.equal(assigned.has('builder-1'), false);
  assert.equal(assigned.has('builder-3'), true);
  assert.equal(office.goalToken.material, pool.statusMaterial('active'));

  office.dispose();
  pool.dispose();
});

test('entity factories adopt office fixtures as the single visual status owner', () => {
  const pool = createResourcePool();
  const office = createOfficeEnvironment(pool);
  const factories = createEntityFactories(pool, office);
  const departmentSlot = STUDIO_TOPOLOGY.departments[7];
  const missionSlot = STUDIO_TOPOLOGY.missions[2];

  const department = factories.department({ id: 'stage-8', status: 'blocked' }, departmentSlot);
  department.update({ id: 'stage-8', status: 'blocked' }, departmentSlot);
  assert.equal(department.object, office.stageSignals.get(departmentSlot.id));
  assert.equal(department.object.material, pool.statusMaterial('blocked'));
  assert.equal(department.object.userData.data.id, 'stage-8');

  const mission = factories.mission({ id: 'mission-3', status: 'active' }, missionSlot);
  mission.update({ id: 'mission-3', status: 'active' }, missionSlot);
  assert.equal(mission.object, office.missionBoards.get(missionSlot.id));
  assert.equal(mission.object.material, pool.statusMaterial('active'));

  // Governance and evidence fixtures illuminate only while adopted.
  const governance = factories.governance({ id: 'governance-deck', status: 'blocked' }, STUDIO_TOPOLOGY.governance);
  governance.update({ id: 'governance-deck', status: 'blocked' }, STUDIO_TOPOLOGY.governance);
  assert.equal(governance.object, office.governanceBeacon);
  assert.equal(governance.object.visible, true);
  governance.dispose();
  assert.equal(governance.object.visible, false);

  // Without an office the factories still produce honest status markers.
  const bare = createEntityFactories(pool);
  const marker = bare.department({ id: 'stage-1', status: 'active' }, departmentSlot);
  assert.notEqual(marker.object, office.stageSignals.get(departmentSlot.id));
  assert.equal(marker.object.material, pool.statusMaterial('active'));

  office.dispose();
  pool.dispose();
});
