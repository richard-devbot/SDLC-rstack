/**
 * Transition-only humanoid workforce animation for Agent Force Studio.
 *
 * No timer invents activity. The animator moves a robot or packet only while
 * consuming an allow-listed, server-owned lifecycle intent.
 *
 * owner: RStack developed by Richardson Gunde
 */
import * as THREE from 'three';
import { ROBOT_PELVIS_HEIGHT } from './robot.js';
import { corridorRoute, routePoints, STUDIO_TOPOLOGY } from './topology.js';

const ACTION_DURATION = Object.freeze({
  enter: 1200,
  collect_capabilities: 1500,
  walk_to_assignment: 1300,
  work: 650,
  handoff: 1400,
  wait: 900,
  retry: 1200,
  return_evidence: 1300,
  complete: 700,
  fail: 500,
  exit: 1100,
  delegate: 700,
});

const WALKING_ACTIONS = new Set([
  'enter',
  'collect_capabilities',
  'walk_to_assignment',
  'handoff',
  'wait',
  'retry',
  'exit',
  // The orchestrator walks the delegation to Dispatch and back.
  'delegate',
]);

/** Milliseconds per locomotion stride while a cast body walks a route. */
const STRIDE_MS = 420;

function clampedProgress(value) {
  const numeric = Number(value);
  return THREE.MathUtils.clamp(Number.isFinite(numeric) ? numeric : 0, 0, 1);
}

export function sampleWaypointRoute(points, progress) {
  if (!points?.length) return [0, 0, 0];
  const amount = clampedProgress(progress);
  if (points.length === 1 || amount <= 0) return [...points[0]];
  if (amount >= 1) return [...points.at(-1)];
  const lengths = points.slice(1).map((point, index) => Math.hypot(
    point[0] - points[index][0],
    point[1] - points[index][1],
    point[2] - points[index][2],
  ));
  const total = lengths.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return [...points.at(-1)];
  let remaining = amount * total;
  for (let index = 0; index < lengths.length; index += 1) {
    if (remaining > lengths[index]) {
      remaining -= lengths[index];
      continue;
    }
    const ratio = lengths[index] === 0 ? 1 : remaining / lengths[index];
    return points[index].map((value, axis) => (
      value + (points[index + 1][axis] - value) * ratio
    ));
  }
  return [...points.at(-1)];
}

function worldPosition(anchor) {
  return anchor?.getWorldPosition?.(new THREE.Vector3()) ?? null;
}

export function createAgentAnimator({
  getHandle = () => null,
  getOrchestrator = () => null,
  getWorkstation = () => null,
  createPacket = () => null,
  scene,
} = {}) {
  const active = [];
  let reduced = false;
  let frozen = false;

  function workstationFor(intent) {
    return getWorkstation(intent.sessionId);
  }

  function finalState(intent, handle) {
    if (!handle) return;
    if (intent.action === 'delegate') {
      // The orchestrator ends every delegation back at HQ.
      handle.object.position.fromArray(STUDIO_TOPOLOGY.orchestrator.position);
      handle.object.rotation.set(0, 0, 0);
      handle.setPose('standing');
      return;
    }
    const workstation = workstationFor(intent);
    const seat = worldPosition(workstation?.seat);
    if (['work', 'walk_to_assignment', 'retry'].includes(intent.action) && seat) {
      const validating = handle.object.userData.role === 'validator';
      if (handle.seatedAtOrigin) {
        // Cast bodies sit via their own clip, authored at the desk origin.
        handle.object.position.copy(workstation.object.position);
        handle.object.rotation.copy(workstation.object.rotation);
      } else {
        // Drop the origin so the seated pelvis lands on the chair anchor.
        handle.object.position.set(seat.x, seat.y - ROBOT_PELVIS_HEIGHT, seat.z);
      }
      handle.setPose(validating ? 'validating' : 'seated_work');
      handle.setFace?.('focused');
    } else if (intent.action === 'enter') {
      handle.object.position.fromArray(STUDIO_TOPOLOGY.dispatch.position);
      handle.setPose('standing');
    } else if (intent.action === 'collect_capabilities') {
      handle.object.position.fromArray(STUDIO_TOPOLOGY.library.entry);
      handle.setPose('standing');
      handle.setFace?.('attentive');
    } else if (intent.action === 'wait') {
      handle.object.position.fromArray(STUDIO_TOPOLOGY.governance.entry);
      handle.setPose('waiting');
      handle.setFace?.('waiting');
    } else if (intent.action === 'handoff') {
      handle.object.position.fromArray(STUDIO_TOPOLOGY.handoffDock);
      handle.setPose('handoff');
      handle.setFace?.('attentive');
    } else if (intent.action === 'return_evidence') {
      handle.setPose('handoff');
      handle.setFace?.('complete');
    } else if (intent.action === 'fail') {
      handle.setPose('failed');
      handle.setFace?.('alert');
    } else if (intent.action === 'complete') {
      handle.setPose('complete');
      handle.setFace?.('complete');
    } else if (intent.action === 'exit') {
      handle.object.position.fromArray(STUDIO_TOPOLOGY.dispatch.position);
      handle.setPose('standing');
    } else {
      handle.setPose('standing');
    }
  }

  function targetFor(intent, handle) {
    const seat = worldPosition(workstationFor(intent)?.seat);
    // Walk at floor height; the final seated state applies the pelvis drop.
    if (['work', 'walk_to_assignment', 'retry'].includes(intent.action) && seat) return [seat.x, 0, seat.z];
    if (intent.action === 'collect_capabilities') return [...STUDIO_TOPOLOGY.library.entry];
    if (intent.action === 'handoff') return [...STUDIO_TOPOLOGY.handoffDock];
    if (intent.action === 'wait') return [...STUDIO_TOPOLOGY.governance.entry];
    if (intent.action === 'return_evidence') return [...STUDIO_TOPOLOGY.evidence.entry];
    if (intent.action === 'exit' || intent.action === 'enter') return [...STUDIO_TOPOLOGY.dispatch.position];
    return handle?.object.position.toArray() ?? [...STUDIO_TOPOLOGY.dispatch.position];
  }

  function movementRoute(intent, handle) {
    // Entering robots walk in through the west reception opening.
    if (intent.action === 'enter') return [[-21, 0, 10], [...STUDIO_TOPOLOGY.dispatch.position]];
    if (intent.action === 'delegate' && handle) {
      // Orchestrator round trip: HQ → Dispatch → HQ.
      const out = corridorRoute(STUDIO_TOPOLOGY.orchestrator.position, STUDIO_TOPOLOGY.dispatch.position);
      const back = corridorRoute(STUDIO_TOPOLOGY.dispatch.position, STUDIO_TOPOLOGY.orchestrator.position);
      return [...out, ...back.slice(1)].map((waypoint) => [...waypoint]);
    }
    const routeName = intent.action === 'collect_capabilities' ? 'dispatch_to_library'
      : intent.action === 'handoff' ? 'builder_to_validator'
        : intent.action === 'wait' ? 'assignment_to_governance'
          : intent.action === 'return_evidence' ? 'assignment_to_vault' : null;
    if (routeName) return [...routePoints(routeName)];
    if (!handle) return [[...STUDIO_TOPOLOGY.orchestrator.position], [...STUDIO_TOPOLOGY.dispatch.position]];
    const from = handle.object.position.toArray();
    const to = targetFor(intent, handle);
    // Everything else threads its room door and the corridor.
    return corridorRoute(from, to).map((waypoint) => [...waypoint]);
  }

  function removePacket(item) {
    item.packet?.removeFromParent();
  }

  function play(transition) {
    const intent = transition?.intent;
    if (!intent) return false;
    const handle = intent.action === 'delegate'
      ? getOrchestrator()
      : getHandle(intent.sessionId);
    if (!handle && intent.action !== 'delegate') return false;
    if (reduced || transition.duration_ms === 0) {
      finalState(intent, handle);
      return true;
    }
    const route = movementRoute(intent, handle);
    const packetKind = intent.action === 'return_evidence' ? 'artifact'
      : ['delegate', 'handoff'].includes(intent.action) ? 'task' : null;
    const packet = packetKind ? createPacket(packetKind) : null;
    if (packet) scene?.add(packet);
    active.push({
      ...transition,
      handle,
      packet,
      route,
      startedAt: Number(transition.started_at_ms) || 0,
      // The orchestrator's delegation round trip earns a longer walk.
      duration: intent.action === 'delegate' && handle
        ? 2600
        : ACTION_DURATION[intent.action] ?? Math.max(1, transition.duration_ms),
    });
    return true;
  }

  function update(now) {
    if (frozen) return false;
    for (let index = active.length - 1; index >= 0; index -= 1) {
      const item = active[index];
      const progress = clampedProgress((now - item.startedAt) / item.duration);
      const routePosition = sampleWaypointRoute(item.route, progress);
      if (item.handle && WALKING_ACTIONS.has(item.intent.action)) {
        const heading = item.handle.object.position;
        const dx = routePosition[0] - heading.x;
        const dz = routePosition[2] - heading.z;
        if (Math.hypot(dx, dz) > 0.002) item.handle.object.rotation.y = Math.atan2(dx, dz);
        item.handle.object.position.fromArray(routePosition);
        if (item.handle.setWalking) item.handle.setWalking((now - item.startedAt) / STRIDE_MS);
        else item.handle.setPose(progress % 0.5 < 0.25 ? 'walkA' : 'walkB', 0.45);
      } else if (item.handle) {
        const pose = item.intent.gesture === 'validation_monitor' ? 'validating'
          : item.intent.gesture === 'keyboard' ? 'seated_work'
            : item.intent.action === 'fail' ? 'failed' : 'standing';
        item.handle.setPose(pose, 0.35);
      }
      if (item.packet) item.packet.position.fromArray(routePosition).add(new THREE.Vector3(0, 1.35, 0));
      if (progress < 1) continue;
      finalState(item.intent, item.handle);
      removePacket(item);
      active.splice(index, 1);
    }
    return active.length > 0;
  }

  function setMotion(mode) {
    reduced = mode === 'reduced';
    if (!reduced) return;
    active.splice(0).forEach((item) => {
      finalState(item.intent, item.handle);
      removePacket(item);
    });
  }

  function clear() {
    active.splice(0).forEach(removePacket);
  }

  return {
    play,
    update,
    setMotion,
    freeze() { frozen = true; },
    resume() { frozen = false; },
    clear,
    activeCount: () => active.length,
  };
}
