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
  approval_walk: 2200,
  approval_return: 2200,
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
  'approval_walk',
  'approval_return',
]);

/** Milliseconds per locomotion stride while a cast body walks a route. */
const STRIDE_MS = 420;
const MANAGER_CHECK_IN_DURATION_MS = 4_500;
/** The Skills Library is a longer round trip than a desk check-in. */
const MANAGER_SKILL_RUN_DURATION_MS = 6_000;
const APPROVAL_TRAVEL_MS = 2_200;
const MANAGER_EVENT_ACTIONS = new Set(['delegate', 'manager_check_in', 'manager_skill_run']);
/** Manager actions that walk out, dwell, and walk back on authored routes. */
const MANAGER_ROUND_TRIPS = new Set(['manager_check_in', 'manager_skill_run']);

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
  onTransitionStart = () => {},
  onTransitionComplete = () => {},
} = {}) {
  const active = [];
  const managerQueue = [];
  let managerItem = null;
  let managerStateValue = 'seated';
  let desiredApproval = { active: false, summary: null };
  let reduced = false;
  let frozen = false;
  let frozenAt = null;

  function workstationFor(intent) {
    return getWorkstation(intent.sessionId);
  }

  function applyManagerSeat(handle) {
    if (!handle) return;
    const [x, y, z] = STUDIO_TOPOLOGY.managerSeat.position;
    handle.object.position.set(x, handle.seatedAtOrigin ? 0 : y - ROBOT_PELVIS_HEIGHT, z);
    handle.object.rotation.set(0, STUDIO_TOPOLOGY.managerSeat.rotationY, 0);
    handle.setPose('sitting');
    managerStateValue = 'seated';
  }

  function applyManagerApproval(handle) {
    if (!handle) return;
    handle.object.position.fromArray(STUDIO_TOPOLOGY.strategyApproval.managerStand);
    handle.object.rotation.set(0, STUDIO_TOPOLOGY.strategyApproval.managerRotationY, 0);
    handle.setPose('standing');
    managerStateValue = 'approval';
  }

  function finalState(intent, handle) {
    if (!handle) return;
    if (MANAGER_EVENT_ACTIONS.has(intent.action)) {
      applyManagerSeat(handle);
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
      const from = [handle.object.position.x, 0, handle.object.position.z];
      const [seatX, , seatZ] = STUDIO_TOPOLOGY.managerSeat.position;
      const seat = [seatX, 0, seatZ];
      const out = corridorRoute(from, STUDIO_TOPOLOGY.dispatch.position);
      const back = corridorRoute(STUDIO_TOPOLOGY.dispatch.position, seat);
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

  function facePoint(handle, point) {
    if (!handle || !point) return;
    const dx = point[0] - handle.object.position.x;
    const dz = point[2] - handle.object.position.z;
    if (Math.hypot(dx, dz) > 0.002) handle.object.rotation.y = Math.atan2(dx, dz);
  }

  function moveWalkingHandle(handle, routePosition, elapsed) {
    if (!handle) return;
    facePoint(handle, routePosition);
    handle.object.position.fromArray(routePosition);
    if (handle.setWalking) handle.setWalking(elapsed / STRIDE_MS);
    else handle.setPose(elapsed % (STRIDE_MS * 0.5) < STRIDE_MS * 0.25 ? 'walkA' : 'walkB', 0.45);
  }

  function managerCheckInRoutes(intent, handle) {
    const workstation = workstationFor(intent);
    const deskAnchor = worldPosition(workstation?.handoff ?? workstation?.seat);
    if (!deskAnchor) return null;
    deskAnchor.y = 0;
    const start = [handle.object.position.x, 0, handle.object.position.z];
    const [seatX, , seatZ] = STUDIO_TOPOLOGY.managerSeat.position;
    const seat = [seatX, 0, seatZ];
    const desk = deskAnchor.toArray();
    return {
      outbound: corridorRoute(start, desk).map((point) => [...point]),
      inbound: corridorRoute(desk, seat).map((point) => [...point]),
      desk,
      worker: worldPosition(workstation?.seat)?.toArray() ?? desk,
    };
  }

  // Skill run: the orchestrator walks to the Skills Library door, dwells at
  // the shelves, and returns to the HQ seat. Same walk/dwell/return shape as
  // a desk check-in, aimed at the library instead of a workstation.
  function managerSkillRunRoutes(handle) {
    const start = [handle.object.position.x, 0, handle.object.position.z];
    const [seatX, , seatZ] = STUDIO_TOPOLOGY.managerSeat.position;
    const seat = [seatX, 0, seatZ];
    const [doorX, , doorZ] = STUDIO_TOPOLOGY.library.entry;
    const door = [doorX, 0, doorZ];
    const [shelfX, , shelfZ] = STUDIO_TOPOLOGY.library.position;
    return {
      outbound: corridorRoute(start, door).map((point) => [...point]),
      inbound: corridorRoute(door, seat).map((point) => [...point]),
      desk: door,
      worker: [shelfX, 0, shelfZ],
    };
  }

  function applyManagerCheckIn(item, progress, now) {
    const outboundEnd = 1 / 3;
    const dwellEnd = 2 / 3;
    if (progress < outboundEnd) {
      moveWalkingHandle(
        item.handle,
        sampleWaypointRoute(item.managerRoutes.outbound, progress / outboundEnd),
        now - item.startedAt,
      );
      return;
    }
    if (progress < dwellEnd) {
      item.handle.object.position.fromArray(item.managerRoutes.desk);
      facePoint(item.handle, item.managerRoutes.worker);
      item.handle.setPose('standing');
      return;
    }
    moveWalkingHandle(
      item.handle,
      sampleWaypointRoute(item.managerRoutes.inbound, (progress - dwellEnd) / (1 - dwellEnd)),
      now - item.startedAt,
    );
  }

  function removePacket(item) {
    item.packet?.removeFromParent();
  }

  function startApprovalTransition(action, now) {
    if (managerItem || managerQueue.length) return false;
    const handle = getOrchestrator();
    if (!handle) return false;
    const destination = action === 'approval_walk'
      ? STUDIO_TOPOLOGY.strategyApproval.managerStand
      : STUDIO_TOPOLOGY.managerSeat.position;
    const from = [handle.object.position.x, 0, handle.object.position.z];
    const to = [destination[0], 0, destination[2]];
    managerStateValue = action === 'approval_walk' ? 'approval-walk' : 'approval-return';
    managerItem = {
      id: `manager:${action}`,
      intent: { action, sessionId: null },
      event: null,
      handle,
      packet: null,
      route: corridorRoute(from, to).map((point) => [...point]),
      managerRoutes: null,
      startedAt: now,
      duration: APPROVAL_TRAVEL_MS,
      internal: true,
    };
    return true;
  }

  function settleManagerProjectionState(now) {
    if (managerItem || managerQueue.length || managerStateValue === 'event') return false;
    if (desiredApproval.active && managerStateValue === 'seated') {
      return startApprovalTransition('approval_walk', now);
    }
    if (!desiredApproval.active && managerStateValue === 'approval') {
      return startApprovalTransition('approval_return', now);
    }
    return false;
  }

  function startTransition(transition, startedAt = Number(transition?.started_at_ms) || 0) {
    const intent = transition?.intent;
    if (!intent) return false;
    const managerAction = MANAGER_EVENT_ACTIONS.has(intent.action);
    const handle = managerAction
      ? getOrchestrator()
      : getHandle(intent.sessionId);
    if (!handle && intent.action !== 'delegate') return false;
    const playback = { ...transition, started_at_ms: startedAt };
    onTransitionStart(playback);
    if (managerAction) managerStateValue = 'event';
    if (reduced || transition.duration_ms === 0) {
      finalState(intent, handle);
      onTransitionComplete(playback, { reducedMotion: reduced });
      return true;
    }
    const route = movementRoute(intent, handle);
    const managerRoutes = intent.action === 'manager_check_in'
      ? managerCheckInRoutes(intent, handle)
      : intent.action === 'manager_skill_run'
        ? managerSkillRunRoutes(handle)
        : null;
    if (MANAGER_ROUND_TRIPS.has(intent.action) && !managerRoutes) {
      applyManagerSeat(handle);
      onTransitionComplete(playback, { reducedMotion: false });
      return true;
    }
    const packetKind = intent.action === 'return_evidence' ? 'artifact'
      : ['delegate', 'handoff'].includes(intent.action) ? 'task' : null;
    const packet = packetKind ? createPacket(packetKind) : null;
    if (packet) scene?.add(packet);
    const item = {
      ...playback,
      handle,
      packet,
      route,
      managerRoutes,
      startedAt,
      // The orchestrator's delegation round trip earns a longer walk.
      duration: intent.action === 'manager_check_in'
        ? MANAGER_CHECK_IN_DURATION_MS
        : intent.action === 'manager_skill_run'
          ? MANAGER_SKILL_RUN_DURATION_MS
        : intent.action === 'delegate' && handle ? 2600
        : ACTION_DURATION[intent.action] ?? Math.max(1, transition.duration_ms),
    };
    if (managerAction) managerItem = item;
    else active.push(item);
    return true;
  }

  function play(transition) {
    const intent = transition?.intent;
    if (!intent) return false;
    if (MANAGER_EVENT_ACTIONS.has(intent.action) && managerItem) {
      managerQueue.push(transition);
      return true;
    }
    return startTransition(transition);
  }

  function animateItem(item, now) {
    const progress = clampedProgress((now - item.startedAt) / item.duration);
    const routePosition = sampleWaypointRoute(item.route, progress);
    if (MANAGER_ROUND_TRIPS.has(item.intent.action)) {
      applyManagerCheckIn(item, progress, now);
    } else if (item.handle && WALKING_ACTIONS.has(item.intent.action)) {
      moveWalkingHandle(item.handle, routePosition, now - item.startedAt);
    } else if (item.handle) {
      const pose = item.intent.gesture === 'validation_monitor' ? 'validating'
        : item.intent.gesture === 'keyboard' ? 'seated_work'
          : item.intent.action === 'fail' ? 'failed' : 'standing';
      item.handle.setPose(pose, 0.35);
    }
    if (item.packet) item.packet.position.fromArray(routePosition).add(new THREE.Vector3(0, 1.35, 0));
    return progress >= 1;
  }

  function completeItem(item, reducedMotion = false) {
    if (item.intent.action === 'approval_walk') applyManagerApproval(item.handle);
    else if (item.intent.action === 'approval_return') applyManagerSeat(item.handle);
    else finalState(item.intent, item.handle);
    removePacket(item);
    if (!item.internal) onTransitionComplete(item, { reducedMotion });
  }

  function update(now) {
    if (frozen) return false;
    for (let index = active.length - 1; index >= 0; index -= 1) {
      const item = active[index];
      if (!animateItem(item, now)) continue;
      completeItem(item);
      active.splice(index, 1);
    }
    if (managerItem && animateItem(managerItem, now)) {
      const completed = managerItem;
      managerItem = null;
      completeItem(completed);
      const next = managerQueue.shift();
      if (next) startTransition(next, now);
      else settleManagerProjectionState(now);
    }
    return active.length > 0 || Boolean(managerItem);
  }

  function setMotion(mode) {
    reduced = mode === 'reduced';
    if (!reduced) return;
    active.splice(0).forEach((item) => {
      completeItem(item, true);
    });
    if (managerItem) {
      completeItem(managerItem, true);
      managerItem = null;
    }
    while (managerQueue.length) startTransition(managerQueue.shift());
    if (desiredApproval.active) applyManagerApproval(getOrchestrator());
    else applyManagerSeat(getOrchestrator());
  }

  function reconcileManager({ approvalActive = false, approvalSummary = null } = {}, now = 0) {
    desiredApproval = {
      active: Boolean(approvalActive),
      summary: approvalSummary,
    };
    if (reduced) {
      if (desiredApproval.active) applyManagerApproval(getOrchestrator());
      else applyManagerSeat(getOrchestrator());
      return true;
    }
    return settleManagerProjectionState(now);
  }

  function clear() {
    active.splice(0).forEach(removePacket);
    removePacket(managerItem ?? {});
    managerItem = null;
    managerQueue.length = 0;
    managerStateValue = 'seated';
    desiredApproval = { active: false, summary: null };
    frozen = false;
    frozenAt = null;
  }

  function freeze(now = null) {
    if (frozen) return;
    frozen = true;
    frozenAt = Number.isFinite(now) ? now : null;
  }

  function resume(now = null) {
    if (!frozen) return;
    if (frozenAt !== null && Number.isFinite(now)) {
      const pausedFor = Math.max(0, now - frozenAt);
      active.forEach((item) => { item.startedAt += pausedFor; });
      if (managerItem) managerItem.startedAt += pausedFor;
    }
    frozen = false;
    frozenAt = null;
  }

  return {
    play,
    update,
    setMotion,
    freeze,
    resume,
    clear,
    reconcileManager,
    managerState: () => managerStateValue,
    managerAction: () => managerItem?.intent?.action ?? null,
    isSessionActive: (sessionId) => active.some((item) => item.intent.sessionId === sessionId),
    activeCount: () => active.length + (managerItem ? 1 : 0),
  };
}
