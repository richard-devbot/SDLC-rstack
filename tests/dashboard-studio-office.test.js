/**
 * Living robot office and truthful occupancy contracts.
 *
 * owner: RStack developed by Richardson Gunde
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
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
  ]) {
    assert.ok(office.object.getObjectByName(name), name);
  }
  assert.ok(office.object.getObjectByName('Builder desk tops') instanceof THREE.InstancedMesh);
  assert.ok(office.object.getObjectByName('Office chairs') instanceof THREE.InstancedMesh);
  assert.ok(office.object.getObjectByName('Office monitors') instanceof THREE.InstancedMesh);

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

test('reconciler caps detailed robots at sixteen and adds one honest aggregate', () => {
  const scene = new THREE.Scene();
  const factory = (_data) => ({
    object: new THREE.Group(),
    update(next) { this.object.userData.data = next; },
    dispose() {},
  });
  const reconciler = createEntityReconciler({
    scene,
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

  assert.equal([...registry.keys()].filter((key) => key.startsWith('session:')).length, 16);
  assert.ok(registry.has('aggregate:overflow-sessions'));
  assert.equal(registry.get('aggregate:overflow-sessions').object.userData.data.count, 2);
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

test('projection assignment never double-books a desk and binds real stage state', () => {
  const pool = createResourcePool();
  const office = createOfficeEnvironment(pool);
  const sessions = [
    ...Array.from({ length: 10 }, (_, index) => ({ id: `builder-${index + 1}`, role: 'builder' })),
    ...Array.from({ length: 6 }, (_, index) => ({ id: `validator-${index + 1}`, role: 'validator' })),
  ];
  const departments = STUDIO_TOPOLOGY.departments.map((slot, index) => ({
    id: `stage-${index + 1}`,
    status: index === 7 ? 'blocked' : 'active',
    slot_id: slot.id,
  }));

  const assigned = assignOfficeProjection(office, { sessions, departments }, pool);
  const occupied = [...office.desks.builder, ...office.desks.validator]
    .map((desk) => desk.occupant)
    .filter(Boolean);
  assert.equal(assigned.size, 12);
  assert.equal(new Set(occupied).size, occupied.length);
  assert.equal(occupied.length, 12);
  const eighthSignal = [...office.stageSignals.values()][7];
  assert.equal(eighthSignal.userData.data, departments[7]);
  assert.deepEqual(eighthSignal.userData.entityRef, { kind: 'department', id: 'stage-8' });
  assert.equal(eighthSignal.material, pool.statusMaterial('blocked'));

  office.dispose();
  pool.dispose();
});
