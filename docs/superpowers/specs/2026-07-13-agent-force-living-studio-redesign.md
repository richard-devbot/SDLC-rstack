# Agent Force Living Studio Redesign

RStack developed by Richardson Gunde

Status: Approved for implementation on 2026-07-13

## Decision

Agent Force Studio will be a CPU-first, readable, stylized robot company rendered
with local Three.js assets. It will show articulated humanoid robots walking through
an office, collecting attached capabilities, sitting at desks, working at screens,
handing tasks to other agents, waiting for human decisions, validating inside a
separate lab, and returning evidence to the Orchestrator.

The office is a projection of the runtime, not an activity simulation. Robots,
movement, work, alerts, handoffs, and completion must be supported by the server-owned
Studio projection or persisted lifecycle events. A quiet backend produces a quiet
office.

This specification supersedes the visual model and animation semantics in
`2026-07-13-agent-force-studio-3d-design.md`. It preserves that specification's
server projection, normalized lifecycle contract, provenance, privacy, semantic DOM,
and governance boundaries.

## User outcome

The Studio should feel like a functioning AI software company while letting a user
answer, without guessing:

1. What goal is the Orchestrator pursuing?
2. Which mission and canonical SDLC stage are active?
3. Which real agent session is working, validating, waiting, blocked, or complete?
4. Which skills, plugins, or specialists were attached to that session?
5. What safe activity is the agent currently performing?
6. Where is work being handed off and what evidence travels with it?
7. Which approval, guardrail, retry, or failure needs human attention?
8. How fresh is the observation and which run, project, and worktree does it belong to?

## Approved visual direction

Use a bright precision-workshop aesthetic rather than a dark network diagram or a
photorealistic metaverse.

- Architecture: warm off-white surfaces, graphite structure, glass partitions, and
  restrained plants and office objects.
- Robots: original rounded humanoid forms with graphite joints, pale shells,
  expressive face displays, and a small semantic chest light.
- Orchestration: amber.
- Validation: cobalt blue.
- Completed and source-verified work: mint.
- Human action, failure, or policy block: red.
- Capabilities and task objects: violet and amber, with short HTML labels.

The supplied stock images are visual references for humanoid proportion, expressive
faces, articulated limbs, seated posture, and robot-to-workstation interaction. Their
artwork, poses, watermarks, characters, and composition must not be copied. All Studio
geometry and motion are original.

Realism comes from proportions, contact, posture, timing, and readable behavior—not
from high polygon counts, large textures, or downloaded character models.

## Company floor

The scene uses one continuous company floor and one bounded camera system. Overview,
mission focus, and agent-desk focus are camera states within the same world, avoiding
multiple heavy scene loads.

### Orchestrator HQ

The top-center office contains the goal table and the permanent Orchestrator robot.
The table shows the selected goal, run state, and current next action. The Orchestrator
does not type as a Builder. It receives a goal, delegates a bounded task, monitors
handoffs, raises governance items, and receives final evidence.

### Dispatch entrance

Observed sessions enter through a dispatch lift or doorway. A robot is allocated from
the scene pool when `agent_session_started` becomes visible. The entrance never emits
decorative workers.

### Skills and Plugin Library

The left-side library contains instanced shelves and labeled capability blocks. An
agent visits it only when `agent_capabilities_attached` reports skills, plugins, or
specialists. Capability blocks dock to the robot or its task carrier. Attachments are
visually distinct from worker sessions and do not become people.

### Fifteen-stage delivery rail

The center of the company contains fifteen reusable department stations matching
`CANONICAL_SDLC_STAGES`. A station can be empty, available, active, waiting, blocked,
failed, or complete. Shared departments remain single places even when used by
multiple missions.

The eight delivery missions remain the product-level grouping supplied by the Studio
projection. The selected mission illuminates only its mapped stage stations; the
scene must not duplicate the fifteen departments to create eight independent
pipelines.

An empty station means no observed occupant. It must not be labeled idle or passing.

### Builder Bullpen

The lower-left workspace contains reusable desks, ergonomic office chairs, monitors,
keyboards, mice, and task docks. A Builder walks to its assigned desk, turns toward
the chair, sits, and begins a safe activity animation only when supported by an
active session and activity event.

### Glass Validator Lab

The lower-right lab is physically separated with a glass boundary. Validator robots
receive one-way task and evidence handoffs, sit at lab workstations, and return
validation results. They never walk into or edit the Builder workspace. This visual
boundary mirrors the read-only validator sandbox contract.

### Governance Room

The upper-right room contains approvals, guardrails, decisions, retry exhaustion,
human-context requests, and audited recovery links. A waiting robot faces or walks to
the Governance Room only when the projection contains a matching governance item.
The Studio remains read-only; state-changing controls stay in the authenticated and
audited cockpit.

### Evidence and Delivery Vault

Artifacts, checkpoints, validation reports, attestations, and completed stage evidence
travel to a source-linked vault. Completion is not shown until the evidence handoff is
persisted and inspectable.

## Procedural humanoid robot

Robots are constructed from shared low-poly Three.js primitives and original
materials. No GLTF character or skeletal-animation package is required for the first
production version.

### Transform hierarchy

Each detailed robot uses a reusable `THREE.Group` hierarchy:

```text
agentRoot
  pelvis
    torso
      chestLight
      neck
        head
          faceDisplay
      shoulderLeft -> elbowLeft -> wristLeft -> handLeft
      shoulderRight -> elbowRight -> wristRight -> handRight
    hipLeft -> kneeLeft -> ankleLeft -> footLeft
    hipRight -> kneeRight -> ankleRight -> footRight
```

Rounded boxes, capsules, cylinders, and low-segment spheres provide a friendly,
recognizably humanoid silhouette. Joints are explicit pivots so walking, sitting,
typing, pointing, carrying, and handoff poses can be blended without per-frame
geometry changes.

### Face and status

The face is a small emissive display with simple original eye shapes. Expressions are
restrained and semantic:

- neutral: observed session with no current transition;
- focused: active work;
- attentive: receiving a goal or handoff;
- waiting: approval, dependency, or context required;
- alert: failure or policy block;
- complete: evidence-backed terminal success.

The face never shows prompts, chain-of-thought, secrets, or unbounded output. Detailed
facts remain in HTML overlays and the inspector.

### Office interaction

The robot proportions and workstation coordinates share an authored measurement
contract. Seat height, desk height, monitor angle, keyboard reach, foot placement, and
hip-to-knee distance are defined once. This prevents robots from hovering over chairs,
passing through desks, or typing above the keyboard.

The seated pose bends the hips and knees, lowers the pelvis to the seat anchor, places
feet below the desk, turns the head toward the monitor, and rests hands near keyboard
and mouse anchors. The chair is not parented to the robot and does not move unless a
future source-backed interaction requires it.

## Behavior state machine

Every visible agent has one authoritative behavior state derived from the Studio
projection and normalized lifecycle events.

```text
absent
  -> entering
  -> receiving_goal
  -> collecting_capabilities (optional)
  -> walking_to_assignment
  -> seated_work | validating
  -> handing_off | waiting | failed
  -> seated_work | validating (retry/resume)
  -> returning_evidence
  -> complete
  -> exiting
```

Animation completion does not change backend state. If a new event arrives while an
animation runs, the scheduler moves to the newest supported state through the shortest
valid transition and preserves the event in the timeline.

### Event-to-behavior contract

| Source-backed event or projection change | Robot behavior |
| --- | --- |
| Goal becomes active | Orchestrator faces the goal table; goal token illuminates |
| `delegation_requested` | Orchestrator points to the destination and releases a bounded task object |
| `agent_session_started` | A pooled robot enters through Dispatch |
| `agent_session_ready` | Robot acknowledges the task and reserves its destination route |
| `agent_capabilities_attached` | Robot walks to the library and collects matching capability blocks |
| `agent_activity` | Assigned robot sits and performs the safe activity-class gesture |
| `handoff_created` | Robot stands and transfers a task object to the recipient or handoff dock |
| `artifact_emitted` | Source-linked evidence object leaves the workstation |
| `agent_waiting` or governance item | Robot stops work, turns toward Governance, and shows a scoped alert |
| Retry scheduled | Robot returns to the same assignment with visible retry count; history remains |
| Validator session starts | Validator enters the glass lab and receives the handoff at its boundary |
| `agent_session_failed` | Work stops; face and workstation use failure state; safe summary becomes primary |
| `agent_session_completed` | Robot returns evidence before showing complete state |
| `agent_session_stopped` | Robot exits only after the terminal event remains inspectable |
| Snapshot stale or transport disconnected | Travel and work motion freeze; last observed time stays visible |

No event means no work transition. Polling, WebSocket receipt, elapsed time, and a
random timer must never trigger delegation, walking, typing, handoffs, alerts, or
completion.

### Safe activity gestures

The server emits normalized activity classes, not raw commands. The renderer maps
them conservatively:

- planning or reading: head and monitor focus, no keyboard claim;
- file activity: brief keyboard gesture;
- tool activity: mouse or secondary-screen gesture;
- test or validation activity: monitor focus with validator indicator;
- artifact activity: evidence object appears at the output dock;
- unknown activity: status pulse and timeline entry without a fabricated gesture.

Subtle servo settling, eye movement, or posture correction is allowed only for an
existing live session. It must not imply typing, progress, completion, or autonomous
work.

## Walking, routing, and handoffs

The company uses authored waypoint lanes between Dispatch, HQ, Library, stage
stations, Builder desks, Validator boundary, Governance, and the Evidence Vault.
Full navigation mesh or physics simulation is unnecessary.

- Routes are reserved by the transition scheduler.
- Robots use deterministic lane offsets to avoid exact overlap.
- Walking uses procedural alternating hip, knee, shoulder, and foot motion.
- Turns are eased at waypoint boundaries.
- Arrival snaps to authored workstation anchors after a short blend, preventing
  accumulated floating-point drift.
- When many sessions transition together, departures are staggered without changing
  their recorded timestamps or order in the timeline.
- Handoff objects move between named anchors and carry task, stage, and evidence IDs
  only through safe HTML details.

No collision or path outcome is treated as runtime truth.

## Notifications and human attention

Alerts are placed above the exact affected robot, stage, or Governance item. They are
also present in the synchronized HTML Action/Inspector surface.

Notification classes are:

- approval required;
- guardrail or policy block;
- missing context or dependency;
- retry scheduled or retry exhausted;
- validation failure;
- session failure;
- handoff completed;
- evidence delivered.

Routine typing or activity events do not create toast spam or screen-reader
announcements. New blockers, human actions, failures, and evidence-backed completion
may create restrained notifications. Every notification includes source, scope, and
timestamp in its detail view.

## Selection and navigation

The Studio has three camera levels:

1. Company overview: full operational floor and strongest next action.
2. Mission focus: mapped stages, active agents, blockers, and handoffs for one mission.
3. Agent desk: close view of a selected robot and workstation, with the inspector open.

Clicking or keyboard-selecting a robot opens:

- agent and session identity with confidence;
- role, harness, sandbox, project, worktree, run, mission, task, and stage;
- attached skills, plugins, and specialists;
- current safe activity and last observed timestamp;
- waiting, retry, failure, or governance reason;
- artifacts, validation, and evidence links;
- projection source and limitations.

The camera always exposes Return to overview. Canvas objects mirror the semantic DOM;
the canvas is not the accessibility tree.

## CPU-first renderer contract

The Studio must remain useful on an integrated-GPU or CPU-constrained machine.

- Shared geometries and materials across all robots.
- Furniture, stage stations, shelves, capability blocks, and repeated architecture
  use instancing where practical.
- Robot groups are pooled and reset instead of recreated during snapshot updates.
- At most 16 detailed active-session robots are shown simultaneously. Additional
  sessions remain fully available in the semantic view and appear as an aggregated
  queue until focused.
- Only robots in an active transition update joint transforms. Stable seated or
  waiting poses do not run full animation work.
- Default quality targets 30 frames per second; low quality targets 15 frames per
  second with direct transition stepping.
- Device pixel ratio is clamped and reduced from measured frame cost.
- One sun light and one ambient/hemisphere light; only the focused robot may receive a
  dynamic contact shadow at higher quality.
- Static office shadows use baked-looking receiver planes or inexpensive blobs.
- Face and status lights use emissive materials, not additional scene lights.
- Labels are HTML overlays only for selected, blocked, and transitioning objects.
- The render loop pauses when hidden, semantic-only, stale/disconnected, or idle with
  no camera/transition work.
- No physics engine, crowd simulation, navigation mesh, post-processing chain, public
  CDN, or large texture atlas.

### Performance ceilings

On the deterministic full-load fixture:

- no more than 90 draw calls in overview;
- no more than 200,000 rendered triangles;
- no more than 16 detailed robot rigs;
- transition update work should remain below 4 ms at the default quality tier on the
  project baseline machine;
- repeated identical snapshots schedule zero additional animations;
- semantic content renders before the Three.js module is ready;
- input and selection remain responsive while a snapshot reconciles.

Diagnostics expose draw calls, triangles, active rigs, active transitions, frame cost,
and quality tier only in a developer overlay.

## Server and client responsibility

The existing server-owned `studio` projection remains authoritative:

```text
studio
  schema_version
  generated_at
  availability
  freshness
  scope
  orchestrator
  missions[]
  departments[]
  sessions[]
  capability_attachments[]
  work_objects[]
  governance_items[]
  evidence_items[]
  timeline[]
  limitations[]
```

The browser may choose geometry, route interpolation, animation duration, camera
position, and visual quality. It may not infer a session, activity, stage outcome,
gate, retry, artifact, handoff, or completion from visual state.

The transition scheduler deduplicates by stable event or work-object identity and
stores the last rendered sequence. Reconnects and repeated snapshots update final
poses without replaying old activity as new work.

## Reduced motion and fallback

`prefers-reduced-motion` and the Studio Reduce motion control disable camera flights,
walking cycles, typing gestures, object travel, pulsing, and materialization. The
correct final pose and inspector state appear immediately.

When WebGL 2 is unavailable, context restoration fails, or semantic-only mode is
selected, the DOM Studio presents the same missions, fifteen departments, sessions,
capabilities, governance items, evidence, freshness, and links. Mobile defaults to
this semantic operational view, with the lightweight canvas offered only when safe.

## Privacy and security

- Use the allow-listed `toClientState()` projection only.
- Never render raw prompts, chain-of-thought, secrets, tokens, environment values,
  command arguments, or unrestricted filesystem paths.
- Use safe normalized summaries and source-linked artifacts.
- Build WebSocket URLs from the current protocol, host, and authentication context.
- Keep the Studio read-only in this implementation wave.
- Route run, approval, retry, recovery, and rollback actions through the existing
  authenticated and audited cockpit.

## Testing strategy

### Pure behavior tests

- lifecycle event to behavior-state mapping;
- invalid transition recovery through the shortest supported path;
- duplicate event and repeated snapshot deduplication;
- out-of-order event reconciliation;
- activity-class to safe gesture mapping;
- stale/disconnected freeze behavior;
- reduced-motion direct state application;
- pooled robot identity reset;
- sixteen-rig aggregation boundary.

### Geometry and authored-anchor tests

- transform hierarchy contains every required joint and semantic anchor;
- standing, walking, seated, typing, handoff, waiting, failure, and completion poses
  produce finite transforms;
- seated pelvis, feet, hands, monitor gaze, and chair/desk anchors remain within
  authored tolerances;
- route endpoints match Dispatch, Library, HQ, workstations, Validator boundary,
  Governance, and Vault anchors;
- object pooling does not leak labels, status, capabilities, or selection.

### Projection and UI contract tests

- session identity and confidence remain source-backed;
- exactly fifteen canonical department stations are rendered from canonical IDs;
- mission filtering preserves shared departments;
- empty desks do not claim idle or passing;
- notifications include scope, source, and timestamp;
- selected robot and semantic DOM expose equivalent facts;
- canvas is hidden from assistive technology;
- no public CDN, hard-coded localhost WebSocket, raw prompt, or unsafe path;
- WebGL fallback, context loss, reduced motion, and 390 px layout remain functional.

### Browser verification

- Orchestrator delegates a task to a newly entering agent;
- agent collects attached skills and sits at the correct desk;
- active work animates only after the fixture emits activity;
- task handoff reaches the glass Validator Lab;
- approval makes the correct robot wait and raises Governance attention;
- retry resumes the same session without erasing history;
- evidence returns before completion is displayed;
- stale and disconnected fixtures freeze motion honestly;
- desktop, constrained CPU/quality tier, reduced motion, keyboard-only, and mobile
  semantic modes;
- draw-call, triangle, active-rig, and transition-cost ceilings.

## Implementation slices

1. Preserve the server projection and replace abstract scene assumptions with the
   living-company view model and behavior reducer.
2. Build the original procedural humanoid rig, authored poses, face states, and
   workstation measurement contract with focused tests.
3. Build the company architecture, fifteen-stage rail, library, Builder Bullpen,
   Validator Lab, Governance Room, Vault, and dispatch waypoints.
4. Add pooling, assignment, walking, sitting, safe work gestures, handoffs, waiting,
   evidence return, and terminal behavior.
5. Synchronize selection, camera levels, inspector, semantic DOM, timeline, and
   notifications.
6. Add quality tiers, transition-only updates, reduced motion, stale/disconnected
   freeze, context recovery, and semantic fallback.
7. Verify deterministic fixtures, browser behavior, performance ceilings, accessibility,
   lint, typecheck, repository validation, and the full test suite.

## Acceptance criteria

- The default Studio reads as a functioning robot software company rather than an
  abstract topology map.
- Robots have expressive heads, articulated limbs, believable walking, authored
  seated posture, workstation interaction, and readable handoffs.
- Orchestrator delegation, capability collection, work, validation, waiting, retries,
  alerts, evidence, completion, and departure are driven only by source-backed state.
- The scene contains one Orchestrator HQ, one Skills Library, fifteen canonical
  departments, pooled Builder workstations, a separate Validator Lab, Governance, and
  an Evidence Vault.
- Empty desks and stages remain honestly empty.
- Clicking a robot exposes complete safe runtime scope and provenance.
- The Studio remains responsive within the CPU-first performance ceilings and pauses
  unnecessary render and animation work.
- Reduced-motion and semantic-only users receive the same operational facts and links.
- No stock artwork, external character model, public CDN, private prompt, secret, or
  unaudited control is introduced.

## Non-goals

- Photorealistic humanoids or high-resolution character textures.
- Free-roaming game controls, physics, collision simulation, or a general metaverse.
- Random background workers, decorative typing, fictional notifications, or simulated
  intelligence.
- Exposing thought content, prompts, terminal streams, secrets, or sensitive paths.
- Replacing Run Workspace, Evidence Center, Action Inbox, or authenticated cockpit
  controls.
- Fabricating delegated-session lifecycle for runtimes that do not emit it.

## References

- Truth and projection baseline:
  `docs/superpowers/specs/2026-07-13-agent-force-studio-3d-design.md`
- Existing proof of concept: `assets/rstack-workspace-v8.html`
- Current Studio UI: `src/observability/dashboard/ui/studio3d.js`
- Studio projection: `src/observability/dashboard/state/studio.js`
- Client allow-list: `src/observability/dashboard/state/client-state.js`
- Canonical stages: `src/core/harness/stages.js`
- Delegated runtime: `src/integrations/pi/rstack-sdlc.ts`
- Product program: GitHub issues #33, #96, and #273
