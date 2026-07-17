# RStack Agent Force Studio Interaction Wave

RStack developed by Richardson Gunde

Status: Approved for implementation on 2026-07-15.

Tracks GitHub issue #385, epic #361, and umbrella Studio PR #377.

## Decision

The Agent Force Studio will feel like a clean, functioning software company whose
manager, worker agents, validator handoffs, approval conversations, and delivery
pipeline are understandable at a glance. The scene remains an honest projection of
RStack backend facts: lifecycle events may start bounded transitions, current
projection state may hold a character in a waiting or approval state, and no timer
may invent work.

This interaction wave adds four connected capabilities:

1. the canonical fifteen-stage pipeline becomes an overhead roller gantry across the
   central company corridor;
2. the Orchestrator manager sits at the embedded red battlestation chair between
   source-backed patrols and teammate check-ins;
3. a human approver sits at the Governance strategy table and participates in a
   projection-driven approval conversation; and
4. compact speech, thought, and action captions explain real delegation, handoff,
   retry, capability, evidence, waiting, and approval activity.

This specification amends the earlier living-Studio design. Its source-backed text
overlays intentionally supersede the earlier blanket prohibition on canvas text.
The exception is narrow: captions must be derived from sanitized server projection
fields, capped, short-lived where appropriate, mirrored in semantic HTML, and never
used for ambient characters.

## User outcome

From the default overview, a user should be able to understand the company without
learning the renderer:

- the manager has a real home desk and leaves it only for observed responsibilities;
- worker movement has an obvious business purpose such as assignment, handoff,
  evidence delivery, retry, or a manager check-in;
- waiting and approval states identify who is waiting and why;
- the human approval conversation appears only while current governance state needs
  it;
- the fifteen SDLC stages read in canonical west-to-east order without obstructing
  the corridor; and
- quiet backend state produces a quiet office.

## Clean company UI/UX direction

The interaction layer should feel like an operations floor, not a game HUD. It uses
restrained hierarchy and predictable placement:

- architecture and people remain primary; labels and captions are secondary;
- room labels use the existing neutral dark treatment and remain sparse;
- speech bubbles use warm white surfaces with dark text and one restrained speaker
  accent;
- thought bubbles use a dashed or cloud-like outline to distinguish waiting from
  speech;
- action captions use a compact dark strip with one action verb and one subject;
- amber identifies Orchestration, cobalt identifies Validation, mint identifies
  evidence-backed completion, violet identifies capabilities or waiting, and red is
  reserved for failure or required human attention;
- every worker caption is anchored above its owner so delegation and handoff
  responsibility never becomes ambiguous; and
- overlays do not compete with the existing agent status panels. Status panels
  answer “who and where”; captions answer “what is happening now” or “why waiting.”

The copy is plain operational language rather than animation language. Examples are
`collecting security-review`, `handoff → validator`, `delivering evidence`,
`retrying (attempt 2)`, and `Waiting · approval`.

## Source-of-truth architecture

The backend and client keep distinct responsibilities.

### Server projection

`src/observability/dashboard/state/studio.js` continues to sanitize and project run
state. Timeline items will expose only the bounded facts the interaction layer needs,
including sanitized skill IDs, handoff direction or role, evidence reference, and a
safe retry attempt when those values exist in the persisted event. Governance bubble
copy comes from `governance_items`, whose `title` already resolves blocked-gate detail
or approval artifact names.

The client does not infer work, retry count, handoff destination, or approval state
from elapsed time, stage position, or animation progress.

### Transition events

The existing transition scheduler preserves timestamp order and identity
deduplication. `started_at_ms` remains stamped when playback begins. Event-derived
manager patrols and worker captions therefore appear only when a newly observed
lifecycle item enters playback.

### Current projection state

Approval conversation presence and waiting thoughts are level-triggered state, not
one-shot events. They are reconciled from the newest projection on every update and
remain visible only while the corresponding state remains true.

## Manager arbitration

The manager uses one serial arbiter so delegation, check-ins, and Governance cannot
fight over the same transform.

1. An active event-derived manager transition is allowed to finish.
2. When it finishes, the arbiter checks the newest projection rather than the
   projection that existed at transition start.
3. If governance is still pending, the manager walks to the strategy table and
   enters the approval-conversation stance.
4. If governance has cleared, or after it clears, the manager walks back to the
   battlestation and sits.
5. Queued lifecycle events retain their recorded order. Approval state does not
   delete or reorder them.

This matches RStack core semantics: persisted lifecycle events are historical facts,
while the rebuilt projection is current truth. Immediate preemption is rejected
because it visually discards part of a real event. A priority queue is rejected
because it would reorder later lifecycle facts and make the manager harder to reason
about.

## Corridor pipeline roller gantry

The gantry is authored once in `topology.js` and consumed by both office construction
and conveyor rendering.

- It spans the central corridor west to east above the spine at `z = -5.5`.
- The lowest structural or panel point is at least `y = 2.6`, leaving all floor-level
  corridor routes clear.
- Fifteen panels follow `STUDIO_TOPOLOGY.departments` in canonical order from west to
  east.
- The existing `stageSignals` map adopts these panels unchanged, preserving one
  visual owner for each department and `stageSignals.size === 15`.
- Panels face south and tilt toward the overview camera at `[17.5, 19.5, 22.5]`.
- Frames and repeated rollers use instanced geometry. The former east-wall support is
  removed completely, leaving the Evidence Vault side clean.
- Conveyor packets travel along the same authored gantry span and stop at the
  furthest reached projected stage.
- Packet flow freezes for reduced motion, stale data, and disconnected transport.

The `15-STAGE PIPELINE` room label moves above the corridor near the gantry rather
than remaining on the east wall.

## Seated manager and battlestation

### Seat anchor

The manager-desk GLB contains the red chair. Its normalized chair mesh bounds are
approximately:

- local chair center: `(0.813, 0.819, 0.732)`;
- practical seat surface: approximately `y = 0.54`;
- station transform: position `(-5.2, 0, -10.4)`, rotation `π/2`.

Applying that transform produces an authored manager seat anchor near
`(-4.56, 0.54, -11.15)`. This derived constant will live with topology and include a
comment documenting the source bounds. Browser verification may make a small
contact correction, but the value must not be guessed without inspecting the model.

### Sitting pose

`locomotion.js` gains `sit()` for supported rigs:

- hips lower relative to captured rest position;
- thighs rotate roughly `-90°`;
- knees rotate roughly `+90°` in each rig’s local convention;
- arms move forward toward the desk; and
- every driven bone starts from its captured rest quaternion, preventing cumulative
  drift.

`assets.js` adds `setMode('sitting')`. It pauses the authored clip and applies
`locomotion.sit()`. Standing and walking continue to use existing behavior.

The default observed/active Orchestrator state is seated at the red chair. A
`delegation_requested` event produces stand → Dispatch round trip → return → sit.
`handoff_created` and `task_retry_scheduled` produce stand → involved session desk
→ face worker → approximately 1.5-second check-in → return → sit. The pause is
part of the event transition duration and does not claim additional work.

The Orchestrator is not treated as a session. Reconciliation and final-state logic
own its resting state explicitly, so `applyRestingStates` cannot overwrite a manager
patrol or pull it away from its chair.

## Human approver and Governance strategy table

The staged `human-approver.glb` is added to the local cast manifest at height `1.66`
with `clipPose: 'standing'`. Parsed nodes show suffixed Mixamo names such as
`mixamorig:Hips_01`, `mixamorig:LeftUpLeg_055`, and
`mixamorig:RightLeg_061`; these match the existing Mixamo family patterns, so a third
rig family is unnecessary.

The separate brown executive chair moves from the battlestation area to the strategy
table at the north side of HQ and faces south toward the room. The human is seated on
that chair with the same locomotion sitting contract. `STATIC_IDLE` remains available
as a safe fallback only if a leg pose cannot be applied after loading.

If the human GLB fails, a simple procedural seated human fixture occupies the same
anchor. The approval conversation still works and the scene never depends on the
asset to expose governance truth.

An approval conversation is active when the newest projection contains one or more
`governance_items`, or when a projected manager/session waiting reason is
`approval`. While active:

- the manager stands at the strategy table facing the human;
- the manager says `Requesting approval · <title or count>`;
- the human says `Reviewing <n> pending approval(s)`; and
- the manager thinks `Awaiting human sign-off`.

When the condition becomes false, the conversation overlays disappear, the manager
returns to the battlestation, and the manager sits. There is no looping conversation
timer.

## Caption model

A small pure module will build bounded overlay descriptors before Three.js rendering.
It owns text selection, singular/plural grammar, truncation, kind, owner identity,
priority, and stable content keys.

### Speech bubbles

- manager: `Requesting approval · <first governance title>` when one useful title is
  available, otherwise the pending count;
- human: `Reviewing 1 pending approval` or `Reviewing n pending approvals`.

### Thought bubbles

- any projected waiting session: `Waiting · <waiting_reason>`;
- manager during approval: `Awaiting human sign-off`.

### Action captions

- capability attachment: `collecting <skill_id>` using the first safe projected
  skill ID for that transition;
- handoff: `handoff → <destination>`;
- artifact event: `delivering evidence`;
- retry: `retrying (attempt <n>)` when the event contains a safe attempt, otherwise
  `retrying`;
- manager check-in travel: `walking to desk`.

Action captions start with their animator transition and remain for about one second
after completion. In reduced motion, the final state is applied immediately and the
caption is removed on the next reconcile without a fade.

## Caption rendering and lifecycle

`scene.js` retains rendering ownership but reuses the existing canvas material
discipline.

- Materials are cached by a content/style key.
- Every reconcile marks active cache entries as used.
- Unused texture maps and materials are disposed before cache removal.
- Removed owner sprites are detached and disposed.
- Sprites use `depthTest: false`, do not set an `interactive` flag, and never enter
  raycast selection.
- No more than eight overlays render concurrently.
- Approval speech and active-transition captions outrank waiting thoughts.
- Within equal priority, the most recent item wins; distance to the current camera is
  the stable tie-breaker.
- Text is painted through Canvas APIs only. Values are converted to text and
  truncated; HTML is never parsed or injected.

The cap controls both visual noise and draw calls. With the staged human rig and all
eight overlays present, the scene must remain within 200 draw calls and 200,000
triangles.

## Semantic parity

The semantic DOM exposes every durable fact communicated by a bubble:

- waiting session rows include `Waiting · <waiting_reason>`;
- the Orchestrator section includes the pending approval count and first safe title;
- the existing timeline continues to expose capability, handoff, evidence, and retry
  events; and
- the inspector may repeat the same projected fields but must not invent different
  wording or state.

The canvas is supplementary. A screen-reader or no-WebGL user receives the same
waiting and approval facts.

## Failure, freshness, and reduced motion

- Model failures keep procedural geometry at the same authored anchors.
- Missing optional caption fields use honest generic wording and never synthesize an
  identifier or retry number.
- A missing involved session desk prevents the manager check-in walk; the lifecycle
  event remains in the timeline and the manager returns to the seated resting state.
- Stale or disconnected transport pauses manager, workers, packets, ambience, fades,
  and queue playback.
- Reduced motion applies final positions and poses directly, freezes conveyor flow,
  freezes allowed ambience, avoids caption fades, and removes transient captions on
  the next reconcile.
- New detailed rigs remain subject to the sixteen-rig ceiling. The fixed manager and
  human approver consume two slots, leaving at most fourteen simultaneously detailed
  session rigs; further sessions remain aggregated.

## Testing and evidence

Each logical change lands with the test that verifies it.

### Unit coverage

- office tests pin gantry span, minimum clearance, west-to-east canonical order,
  `stageSignals` adoption, and absence of the east-wall pipeline support;
- locomotion tests pin the sitting family, hip lowering, thigh/knee/arm changes, and
  restoration to captured rest before repeated poses;
- projection tests pin the sanitized caption facts passed through timeline items;
- behavior/animator tests pin manager check-in intents, serial arbitration,
  approval-walk state changes, final seated state, and reduced-motion outcomes;
- caption-builder tests pin approval grammar, title/count fallback, waiting reason,
  skill/handoff/evidence/retry copy, text truncation, priority, and the eight-item cap;
- DOM tests pin waiting and approval semantic parity; and
- asset/server tests pin the human manifest and fail-closed static allowlist entry.

### Browser proof

A scratch run is rendered with local Chromium and SwiftShader. Lifecycle events are
appended only after the page loads so transitions start on arrival. Evidence captures:

1. manager seated at the embedded red battlestation chair;
2. manager mid-walk to a teammate;
3. approval conversation with both speech bubbles;
4. a session action caption during a live transition;
5. corridor gantry with readable stage panels and honest flowing packets; and
6. reduced-motion final states.

Diagnostics are polled over a series rather than sampled once. The PR records draw
calls, triangles, quality tier, renderer state, screenshot paths, and any deviation
from this specification.

### Required gates

Before the PR, the branch must show:

- `npm test` with `# fail 0`;
- `npm run lint` with zero errors;
- `npm run typecheck`;
- `npm run validate`;
- `node scripts/security-audit.mjs`;
- `git diff --check`; and
- measured full-scene diagnostics within 200 draw calls and 200,000 triangles unless
  a measured, commented, and reviewed exception is unavoidable.

## Commit and PR boundaries

Implementation uses small bisected commits:

1. approved design and implementation plan;
2. gantry topology, office geometry, conveyor alignment, and tests;
3. sitting locomotion, cast mode, manager resting state, and tests;
4. manager event check-ins and projection-driven approval arbitration with tests;
5. human approver placement, fallback, allowlist, and tests;
6. projected caption facts, pure caption builders, and tests;
7. sprite rendering, semantic parity, reduced-motion cleanup, and tests; and
8. browser evidence and verification documentation if repository policy keeps those
   artifacts in the branch.

The pull request targets `codex/studio-agent-force`, closes issue #385, links epic
#361 and PR #377, and includes per-task verification evidence.

## Out of scope

- No autonomous manager schedule or decorative meeting loop.
- No chat transcript, chain-of-thought, prompt content, or raw command output.
- No approval action is performed from the 3D canvas.
- No navigation mesh or physics engine.
- No CDN, remote model, or new runtime dependency.
- No change to the sixteen-detailed-rig overflow policy.
