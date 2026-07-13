# Agent Force Studio 3D

RStack developed by Richardson Gunde

Status: Approved for implementation on 2026-07-13

## Outcome

Agent Force Studio becomes the live operational workplace for an RStack delivery run. It shows the Orchestrator delegating bounded work, temporary Builder and Validator sessions appearing on demand, specialist capabilities attaching to those sessions, governed work moving through the canonical SDLC, and evidence returning to the run.

The Studio is a truthful projection of persisted run state and normalized lifecycle events. It must never animate work, agents, gates, or completion that the backend cannot support.

## Product promise

Within one viewport a user can answer:

1. Which project, worktree, and run am I observing?
2. Is the snapshot live, stale, disconnected, or unavailable?
3. What outcome is the Orchestrator currently pursuing?
4. Which mission is active and which canonical departments does it use?
5. Which Builder, Validator, or specialist session exists right now?
6. What is that session doing, waiting for, producing, or handing off?
7. Which guardrail, approval, checkpoint, or failure is stopping progress?
8. What evidence proves that a stage or mission completed?
9. What is the next source-backed action?

## Core truths represented in the space

The scene reflects RStack's actual operating model:

- One permanent Orchestrator HQ. The Orchestrator plans and delegates; it does not pretend to perform Builder work.
- Eight dynamic mission bays matching the Pi integration's delivery missions: product clarification, requirements, architecture, implementation, testing, security review, documentation, and release readiness.
- Fifteen reusable canonical departments matching `CANONICAL_SDLC_STAGES`. Departments can serve more than one mission; they are not duplicated to make a visually convenient conveyor.
- Temporary writable Builder Pods. A pod exists only when a Builder session can be traced to a real task or lifecycle event.
- A physically separate read-only Validator Lab. Its visual boundary communicates the validator sandbox and independent verification contract.
- Specialist guilds representing the repository's specialist pools. A specialist is shown as attached capability or a real delegated session, never as an always-running employee.
- Skills and plugins shown as capability modules attached to a session. They are not rendered as people or claimed as active without backend evidence.
- A Human Governance Deck for approvals, decisions, guardrails, and human-context stops.
- An Evidence and Delivery Vault for checkpoints, artifacts, validation results, stage reports, and handoffs.

## Selected spatial model

Use a hub-and-bays company floor rather than the existing fifteen-station conveyor.

### Orchestrator HQ

The central elevated hub owns the run objective, current next action, delegation queue, and latest orchestration event. It connects to active mission bays with illuminated routes. A route lights only when a source-backed mission, task, or delegation is active.

### Mission ring

Eight bays surround HQ in the order of the delivery lifecycle. Each bay displays:

- mission name and lifecycle state;
- mapped canonical stage IDs;
- active, waiting, blocked, failed, and completed task counts;
- current Builder and Validator sessions;
- strongest source-backed blocker;
- latest artifact or checkpoint;
- provenance and freshness.

A mission bay is quiet when no persisted state or event supports activity. It does not use ambient worker animations to look busy.

### Canonical departments

The fifteen departments form a lower architectural layer beneath the mission bays. Shared departments such as Security Threat Model and Summary remain single places with multiple mission links. Selecting a department reveals every mission and task currently using it.

### Builder Pods

Builder Pods materialize beside the active mission bay. Each pod is keyed by `agent_session_id` or, for legacy runs, a stable task-derived fallback identity explicitly marked as inferred. The pod shows task, sandbox/worktree, harness, model availability, attached specialists, attached skills/plugins, files changed, tests run, and last activity.

### Validator Lab

Validator sessions appear in a glass-walled, disconnected lab reached by a one-way evidence handoff. The scene must not depict a validator editing the Builder workspace. Validation results travel back as evidence objects.

### Governance Deck

Approvals, decisions, guardrails, retry exhaustion, and human-context requests rise to a visible deck above the affected mission. The Studio links to the existing authenticated control surface; it does not add unauthenticated state-changing controls.

### Evidence and Delivery Vault

Artifacts, checkpoints, validation results, attestations, and stage reports enter the vault only when represented in the server projection. Completion animations end at the vault, not at a decorative finish line.

## Visual direction

The floor is a compact premium operations diorama: warm graphite structure, off-white work surfaces, restrained amber orchestration light, and semantic state colors already used by Business Hub. Geometry is deliberately architectural and readable rather than toy-like.

Visual hierarchy:

1. Run identity, source, and freshness in a persistent top rail.
2. Orchestrator HQ and the active mission route.
3. Temporary sessions and their work objects.
4. Governance interrupts.
5. Inspector and event timeline.
6. Background departments and inactive bays.

The camera starts in an isometric overview. Focus commands ease to a mission, session, department, gate, or evidence object and always provide a visible Return to overview control. User orbit and zoom remain bounded so the floor cannot be lost.

Typography and detailed facts remain HTML. Three-dimensional labels are short identifiers only. The scene cannot be the sole carrier of state or content.

## Screen composition

### Desktop, 1280px and wider

- Top: run picker, project/worktree identity, connection state, snapshot age, and source.
- Center: the 3D company floor.
- Right: a 360–420px inspector for the selected object.
- Bottom: a collapsible lifecycle timeline with real events and provenance.
- Lower-left: camera, motion, and semantic-view controls.

### Compact desktop and tablet

- Inspector becomes an overlay sheet.
- Timeline collapses to the latest event and active blocker.
- Mission labels reduce detail before geometry is removed.

### Mobile at 390px

- The semantic operational view is the default.
- A lightweight overview canvas is optional when WebGL 2 and motion preferences permit it.
- The inspector is a full-width bottom sheet.
- Missions, sessions, gates, and evidence remain in DOM reading order with no horizontal page overflow.
- All actions and deep links remain available without manipulating a 3D camera.

## Server-owned Studio projection

`buildFullState()` owns a new `studio` projection. `toClientState()` emits a compact, allow-listed form. Browser code translates the projection into geometry and DOM but does not infer delivery semantics from raw tasks or events.

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

### Projection invariants

- `availability` is `available | partial | unavailable | unknown`.
- `freshness` includes `observed_at`, `age_ms`, `state`, and source. It is never synthesized from browser receipt time.
- Every mission references canonical stage IDs; unknown stage IDs are preserved as limitations and not rendered as canonical departments.
- Every conclusion carries project/run scope and a source reference.
- Every session declares identity confidence: `observed | task_derived | unavailable`.
- Unknown and absent data remain unknown or absent; they never become idle, passing, or complete.
- A mission is complete only when the shared backend projection supports completion.
- The Studio next action uses the existing pipeline/readiness decision source rather than recomputing it.
- Raw prompts, secrets, tokens, environment values, and unrestricted filesystem paths never cross the client boundary.

## Normalized agent lifecycle contract

The preferred additive lifecycle events are:

| Event | Meaning | Minimum fields |
| --- | --- | --- |
| `delegation_requested` | Orchestrator requested a bounded worker | run, task, stage, delegation, role, time |
| `agent_session_started` | Runtime process/session was created | delegation, session, role, harness, sandbox, time |
| `agent_session_ready` | Session accepted its task | session, status, time |
| `agent_capabilities_attached` | Specialists, skills, or plugins were attached | session, capability IDs, time |
| `agent_activity` | A safe normalized activity occurred | session, activity class, summary, time |
| `agent_waiting` | Session is waiting for a gate, context, dependency, or resource | session, reason class, source, time |
| `handoff_created` | Work moved between Orchestrator, Builder, Validator, or human | from, to, task, evidence refs, time |
| `artifact_emitted` | Session produced a source-backed artifact | session, artifact ref, artifact class, time |
| `agent_session_completed` | Session finished successfully | session, outcome, evidence refs, time |
| `agent_session_failed` | Session ended in failure | session, failure class, safe summary, time |
| `agent_session_stopped` | Session was stopped or cleaned up | session, reason class, time |

Common fields are `run_id`, `task_id`, `stage_ids`, `delegation_id`, `agent_session_id`, `agent_id`, `role`, `harness`, `model`, `sandbox_id`, `specialist_ids`, `skill_ids`, `plugin_ids`, `timestamp`, `status`, and source reference.

These events are additive. Existing task, approval, guardrail, checkpoint, validation, retry, and observe events remain valid inputs. The projection adapts legacy events conservatively and records its confidence.

### Runtime coverage

- Pi: emit lifecycle events around `runDelegateAgent()` and its isolated subprocess. This is the first full-fidelity adapter.
- Observe/session bridge: map existing `subagent_started`, `subagent_stopped`, `tool_call`, `tool_result`, and context events when a run/task identity is available.
- Tau: show task and stage state, plus an explicit limitation that delegated-session lifecycle is unavailable. Do not fabricate worker sessions.
- Historical runs: adapt from persisted tasks and events with `task_derived` confidence.

## Animation semantics

Motion communicates lifecycle transitions; it is not ambient theater.

| Source-backed transition | Visual response |
| --- | --- |
| Delegation requested | A bounded work capsule leaves HQ for the mission bay |
| Session started | A temporary Builder Pod or Validator station materializes |
| Capabilities attached | Small labeled modules dock to that session |
| Activity | One restrained pulse on the session and corresponding timeline entry |
| Artifact emitted | A proof object leaves the session for the handoff or vault |
| Waiting/approval/guardrail | Route pauses; the blocking item rises to Governance Deck |
| Retry scheduled | Capsule returns to the same mission with retry count, without resetting history |
| Session completed | Pod powers down after evidence handoff; it does not vanish before the event is inspectable |
| Session failed | Route stops and the safe failure summary becomes the primary inspector state |
| Connection stale/offline | All motion freezes and the last-known timestamp remains visible |

No event means no transition. Periodic polling, WebSocket receipt, and elapsed time alone do not create work animations.

## Scene architecture

Replace the single HTML-string scene implementation with small modules:

- document shell and import map;
- Studio projection view-model validation;
- scene bootstrap and renderer capability detection;
- floor topology and spatial coordinates;
- reusable geometry/material factory;
- entity registry and projection reconciler;
- lifecycle transition scheduler;
- selection, camera, and focus controller;
- synchronized semantic DOM renderer;
- inspector and timeline renderer;
- transport, reconnect, freshness, and snapshot handling;
- performance monitor, context-loss handling, and fallback.

Repeated architecture, work capsules, status lights, and capability modules use instancing where practical. Detailed sessions use pooled object groups. Labels use HTML overlays only for visible/focused objects, while the complete semantic list remains in a separate DOM tree.

## Runtime and asset policy

- Pin Three.js as a runtime dependency and serve an allow-listed local browser build from the Business Hub. The Studio must not depend on a public CDN.
- Use WebGL 2 capability detection. Unsupported or failed contexts open the semantic Studio automatically.
- Use `renderer.setAnimationLoop()` and pause rendering while the page is hidden, the snapshot is stale/disconnected, or reduced-motion mode requests static presentation.
- Dispose geometries, materials, textures, controls, and renderer resources when rebuilding or unloading.
- Handle `webglcontextlost` and `webglcontextrestored`; preserve the server projection and recover the scene without claiming data loss.
- Clamp device pixel ratio and use quality tiers determined by observed frame cost, not device-name guessing.
- Keep shadows sparse and static. Dynamic status lighting uses emissive materials instead of multiple shadow-casting lights.
- Expose renderer draw calls, triangles, and active quality tier only in a diagnostics overlay, never as product KPIs.

## Performance budgets

On the deterministic full-load fixture:

- no more than 90 draw calls in overview at the default quality tier;
- no more than 200,000 rendered triangles in overview;
- first meaningful semantic content before the 3D module finishes loading;
- responsive input while the scene reconciles a new snapshot;
- one active transition scheduler, with redundant snapshots producing no new animation;
- canvas render loop paused when hidden or when semantic-only mode is active;
- automatic reduction of pixel ratio, shadows, and label density when sustained frame cost exceeds budget.

The budgets are verified through renderer diagnostics in browser tests and may be tightened after profiling. They are ceilings, not targets.

## Accessibility and motion

- The semantic DOM is the canonical interaction tree. Canvas objects are mirrors and are hidden from assistive technology.
- Missions, departments, sessions, gates, and evidence are keyboard-selectable from the semantic view.
- Arrow-key spatial navigation is optional; Tab order follows operational reading order.
- Focus in the DOM and selection in the scene stay synchronized.
- State always uses icon and text in addition to color.
- Live-region announcements are limited to new blockers, human actions, session failures, and completed handoffs; routine activity is not announced.
- `prefers-reduced-motion` disables camera flights, pulsing, materialization, and object travel. The final state appears immediately.
- A persistent Reduce motion control can override the system preference for this Studio.
- Focus is returned predictably when the inspector or mobile sheet closes.

## Security, governance, and privacy

- Studio is read-only in this implementation wave.
- State-changing controls remain in the authenticated and audited cockpit flow.
- External dashboard origins and WebSocket access continue to use the existing server hardening and read-token policies.
- WebSocket URLs are built from `location.protocol`, `location.host`, and the current authentication context; no hard-coded localhost socket is allowed.
- Browser-visible data is allow-listed by `toClientState()`.
- Activity summaries use normalized safe classes and server-produced plain language; raw prompts, command arguments, and secret-bearing output are excluded.
- Artifact links use existing safe server routes and run scoping.

## Empty, partial, and failure states

- No project/run: show the company map in semantic form with “No run selected”; do not populate workers.
- Run with no lifecycle coverage: show mission/task truth and an explicit lifecycle limitation.
- No active work: use “No active session observed,” not “Everyone idle.”
- Stale snapshot: freeze transitions, retain last-known data, show age and source.
- Disconnected transport: show reconnect state and retain the last server-observed timestamp.
- WebGL unavailable: semantic Studio becomes primary with no loss of facts or links.
- Context loss: show a non-blocking recovery banner; if restoration fails, switch to semantic Studio.
- Malformed Studio projection: fail closed to semantic error state and preserve the rest of Business Hub.
- Unknown stage or capability: list it under limitations; never silently map it to a known department.

## Testing strategy

### Projection tests

- no-data, partial, active Builder, active Validator, approval-blocked, retrying, failed, completed, stale, and mixed-harness fixtures;
- exact eight-mission and fifteen-department mapping;
- shared departments remain single entities;
- legacy-event confidence and limitation behavior;
- client allow-list and secret/path redaction;
- deterministic ordering and stable identities;
- next-action parity with the existing pipeline/readiness projection.

### Lifecycle tests

- Pi delegation emits ordered start, capability, handoff/artifact, completion/failure, and stop events;
- subprocess failure and timeout still produce terminal lifecycle events;
- validator role retains read-only tool policy;
- adapters do not create sessions from unrelated tool events;
- duplicate/replayed events do not duplicate Studio entities or transitions.

### UI contract tests

- Studio HTML uses local assets and same-origin `ws:`/`wss:` transport;
- no hard-coded localhost WebSocket or public CDN;
- canvas is not the accessibility tree;
- semantic controls and inspector labels exist;
- reduced-motion, WebGL fallback, and context-loss states exist;
- 390px layout has no horizontal page overflow.

### Browser verification

- desktop overview, selected mission, active delegation, governance blocker, and completed evidence handoff;
- mobile semantic view and inspector sheet at 390px;
- keyboard-only selection and focus return;
- reduced motion;
- stale and disconnected transport;
- WebGL capability failure and forced context loss;
- draw-call/triangle ceilings on the deterministic full-load fixture;
- WebSocket over both HTTP and HTTPS-compatible URL construction.

## Delivery sequence

1. Introduce the pure Studio projection and client allow-list with fixtures.
2. Add normalized lifecycle helpers and the Pi delegation adapter.
3. Replace the monolithic Studio shell with local assets and modular browser code.
4. Build the company floor, entity reconciler, inspector, timeline, and semantic view.
5. Add source-driven transitions, Governance Deck, and Evidence Vault.
6. Add responsive, reduced-motion, performance, context-loss, and transport hardening.
7. Run full regression and browser verification before publishing the PR.

## Acceptance criteria

- The Studio renders one Orchestrator HQ, eight mission bays, and fifteen reusable canonical departments from the server projection.
- Builder and Validator sessions appear only from source-backed task/lifecycle state and declare identity confidence.
- Pi delegation produces normalized lifecycle events without changing the existing orchestration result contract.
- Specialist, skill, and plugin attachments are distinguishable from worker sessions.
- Work-object motion occurs only for unseen source-backed transitions.
- Gates, retries, failures, checkpoints, artifacts, and human actions are inspectable with scope, source, and timestamp.
- A synchronized semantic view provides the same operational facts and links without WebGL.
- The Studio works at desktop and 390px, with keyboard access and reduced motion.
- Three.js loads locally; WebSocket construction works for the current host and protocol.
- Stale, disconnected, unsupported, and malformed states fail honestly.
- Focused tests, lint, typecheck, repository validation, the complete test suite, and browser verification pass.

## Non-goals

- Simulating agent intelligence or rendering thought content.
- Showing private prompts, chain-of-thought, secrets, or unrestricted terminal output.
- Treating skills/plugins as autonomous employees.
- Creating a general-purpose metaverse or free-roaming game.
- Replacing Run Workspace, Evidence Center, Action Inbox, or authenticated cockpit controls.
- Inventing real-time lifecycle for runtimes that do not emit it.
- Adding unauthenticated run, approval, retry, recovery, or rollback actions.

## References

- Existing proof of concept: `assets/rstack-workspace-v8.html`
- Current route: `src/observability/dashboard/ui/studio3d.js`
- Projection boundary: `src/observability/dashboard/state/index.js` and `client-state.js`
- Canonical stages: `src/core/harness/stages.js`
- Delegated runtime: `src/integrations/pi/rstack-sdlc.ts`
- Product program: GitHub issues #33, #96, and #273
- 3D inspiration: Claw3D and The Delegation, used only as interaction references
- Three.js primitives: InstancedMesh, LOD, WebGL capability checks, and WebGLRenderer diagnostics/context handling
