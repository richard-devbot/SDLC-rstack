# Studio Central Delivery Spine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

RStack developed by Richardson Gunde

**Goal:** Replace the sightline-blocking overhead gantry and black department docks with a compact, backend-honest fifteen-stage floor delivery spine centered between the Builder and Validator teams.

**Architecture:** `topology.js` will own a single immutable `pipelineSpine` contract used by both `office.js` and `scene.js`. The office factory will preserve the existing `stageSignals` map while changing only its physical fixtures; the scene will reuse the same stage interpolation for the legend and honest packets. No server projection formula or lifecycle behavior changes.

**Tech Stack:** JavaScript ES modules, Three.js pooled/instanced geometry, CanvasTexture, Node test runner, Playwright Core with local Chromium.

## Global Constraints

- Preserve `stageSignals.size === 15` and canonical west-to-east department adoption.
- Work state and packet frontier come only from the server projection; no client timer invents work.
- Reduced motion applies the static final state; stale/disconnected state freezes the scene.
- Keep the corridor at `z = -5.5` and handoff route near `z = 2` clear.
- Keep the detailed-rig ceiling at 16, draw-call ceiling at 200, and triangle ceiling at 200,000.
- Use local assets only and keep existing procedural fallbacks.
- Preserve semantic DOM parity and the previously shipped manager, check-in, approval, waiting, and caption behavior.
- Add only explicit paths to Git staging and keep one logical change per commit.

---

## File map

- `src/observability/dashboard/ui/studio3d/topology.js`: authored delivery-spine dimensions and west-to-east stage interpolation.
- `src/observability/dashboard/ui/studio3d/office.js`: compact belt, roller, console, beacon, and adopted `stageSignals` geometry; removal of black work-cell docks.
- `src/observability/dashboard/ui/studio3d/scene.js`: compact stage legend, room label, and honest packet placement.
- `tests/dashboard-studio-office.test.js`: physical placement, canonical adoption, dock removal, and route-clearance contracts.
- `tests/dashboard-studio-browser-model.test.js`: stable source-level scene contracts and performance ceilings.
- `docs/evidence/studio-interaction-wave/`: refreshed screenshots and diagnostic evidence.

---

### Task 1: Author the compact spine topology and physical office fixtures

**Files:**
- Modify: `tests/dashboard-studio-office.test.js`
- Modify: `src/observability/dashboard/ui/studio3d/topology.js`
- Modify: `src/observability/dashboard/ui/studio3d/office.js`

**Interfaces:**
- Consumes: `STUDIO_TOPOLOGY.departments`, `pipelineStageX(index, count)`, `pool.statusMaterial(status)`, and pooled slab/beacon geometry.
- Produces: `STUDIO_TOPOLOGY.pipelineSpine`, `Fifteen-stage delivery spine`, `Pipeline delivery belt`, `Pipeline console frames`, and the unchanged `{ group, stageSignals }` return contract.

- [ ] **Step 1: Replace the gantry assertions with failing delivery-spine assertions**

Update the opening office test so it requires this contract before production code changes:

```js
const spine = office.object.getObjectByName('Fifteen-stage delivery spine');
const stageSignals = [...office.stageSignals.values()];
assert.ok(spine instanceof THREE.Group);
assert.equal(office.object.getObjectByName('Fifteen-stage pipeline gantry'), undefined);
assert.equal(office.object.getObjectByName('Stage work-cell docks'), undefined);
assert.ok(spine.getObjectByName('Pipeline delivery belt') instanceof THREE.InstancedMesh);
assert.ok(spine.getObjectByName('Pipeline console frames') instanceof THREE.InstancedMesh);
assert.ok(stageSignals.every((signal) => signal.position.y <= STUDIO_TOPOLOGY.pipelineSpine.maxHeight));
assert.ok(stageSignals.every((signal) => (
  Math.abs(signal.position.z - STUDIO_TOPOLOGY.pipelineSpine.z)
    <= STUDIO_TOPOLOGY.pipelineSpine.consoleOffsetZ
)));
assert.ok(stageSignals.every((signal, index) => (
  index === 0 || signal.position.x > stageSignals[index - 1].position.x
)));
assert.ok(Math.abs(STUDIO_TOPOLOGY.pipelineSpine.z - STUDIO_TOPOLOGY.corridor.z) >= 3);
assert.ok(STUDIO_TOPOLOGY.routes.builder_to_validator.every((point) => (
  Math.abs(point[2] - STUDIO_TOPOLOGY.pipelineSpine.z) >= 3
)));
```

- [ ] **Step 2: Run the office test and verify RED**

Run: `node --test tests/dashboard-studio-office.test.js`

Expected: FAIL because `pipelineSpine` and `Fifteen-stage delivery spine` do not exist and the old dock mesh is still present.

- [ ] **Step 3: Replace `pipelineGantry` with the authored floor contract**

In `topology.js`, define the immutable contract and keep `pipelineStageX` as the only interpolation function:

```js
pipelineSpine: Object.freeze({
  startX: -14.4,
  endX: 14.4,
  z: -1.5,
  beltY: 0.16,
  beltWidth: 0.5,
  consoleOffsetZ: 0.72,
  panelY: 0.98,
  maxHeight: 1.35,
}),
```

Update `pipelineStageX` to read `STUDIO_TOPOLOGY.pipelineSpine`. Keep the fifteen department IDs and their order unchanged.

- [ ] **Step 4: Rebuild `createPipelineWall` as the delivery-spine factory**

Keep the function's return signature to avoid changing its consumer. Build one instanced belt/roller mesh and one instanced console-frame mesh. Alternate consoles around the belt while every signal advances west-to-east:

```js
const spine = STUDIO_TOPOLOGY.pipelineSpine;
group.name = 'Fifteen-stage delivery spine';
const belt = new THREE.InstancedMesh(pool.geometries.slab, pool.materials.graphite, beltSegments.length);
belt.name = 'Pipeline delivery belt';
group.add(writeSegments(belt, beltSegments));

STUDIO_TOPOLOGY.departments.forEach((slot, index) => {
  const x = pipelineStageX(index, count);
  const side = index % 2 === 0 ? -1 : 1;
  const z = spine.z + side * spine.consoleOffsetZ;
  const panel = new THREE.Mesh(pool.geometries.slab, pool.statusMaterial('unknown'));
  panel.name = `Stage signal · ${slot.id}`;
  panel.scale.set(0.72, 0.34, 0.055);
  panel.position.set(x, spine.panelY, z);
  group.add(panel);
  stageSignals.set(slot.id, panel);
});
```

Rename comments and mesh names from gantry language to delivery-spine language. Delete `createStageCells` and remove `cells.docks` from `createOfficeEnvironment`.

- [ ] **Step 5: Run the office test and verify GREEN**

Run: `node --test tests/dashboard-studio-office.test.js`

Expected: every office test passes, including 15 canonical adopted fixtures, low console height, dock removal, and route separation.

- [ ] **Step 6: Commit the physical delivery spine**

```bash
git add tests/dashboard-studio-office.test.js src/observability/dashboard/ui/studio3d/topology.js src/observability/dashboard/ui/studio3d/office.js
git commit -m "feat(studio): replace gantry with delivery spine"
```

---

### Task 2: Move canonical labels and honest packets onto the spine

**Files:**
- Modify: `tests/dashboard-studio-browser-model.test.js`
- Modify: `src/observability/dashboard/ui/studio3d/scene.js`

**Interfaces:**
- Consumes: `STUDIO_TOPOLOGY.pipelineSpine`, `pipelineStageX(index)`, `projection.departments`, and `motionMode`.
- Produces: `Delivery spine stage legend`, `paintPipelineLegend()`, and packet transforms on the belt surface.

- [ ] **Step 1: Write failing scene-contract assertions**

Replace the gantry source pins with delivery-spine pins:

```js
assert.match(sceneSource, /Delivery spine stage legend/);
assert.match(sceneSource, /paintPipelineLegend\(\)/);
assert.match(sceneSource, /pipelineSpine/);
assert.doesNotMatch(sceneSource, /pipelineGantry|Gantry stage legend|paintGantryLegend/);
```

Keep the existing `DRAW_CALL_CEILING = 200` and `TRIANGLE_CEILING = 200_000` assertions unchanged.

- [ ] **Step 2: Run the browser-model test and verify RED**

Run: `node --test tests/dashboard-studio-browser-model.test.js`

Expected: FAIL because the scene still creates a gantry legend and reads `pipelineGantry`.

- [ ] **Step 3: Reposition and rename the shared stage legend**

Change the room label to `15-STAGE DELIVERY PIPELINE` near the center of the floor spine. Rename the legend state and painter, then place its single canvas texture just above/behind the belt so all fifteen numbered canonical labels align with their physical consoles:

```js
const pipelineLegend = new THREE.Mesh(pool.geometries.slab, pool.materials.graphite);
pipelineLegend.name = 'Delivery spine stage legend';
pipelineLegend.position.set(0, STUDIO_TOPOLOGY.pipelineSpine.panelY + 0.42, STUDIO_TOPOLOGY.pipelineSpine.z - 0.58);
pipelineLegend.scale.set(14.45, 0.34, 0.035);
scene.add(pipelineLegend);
```

Keep the existing sanitized canvas text formula—two-digit stage number plus at most fourteen title characters—and retain explicit texture/material disposal.

- [ ] **Step 4: Move packets to the belt surface**

Change only the geometry source for the existing honest conveyor:

```js
const CONVEYOR = Object.freeze({
  startX: STUDIO_TOPOLOGY.pipelineSpine.startX,
  y: STUDIO_TOPOLOGY.pipelineSpine.beltY + 0.16,
  z: STUDIO_TOPOLOGY.pipelineSpine.z,
  packets: 6,
});
```

Preserve the current furthest-non-unknown calculation, `pipelineStageX(reached)`, reduced-motion static placement, stale/disconnected pause behavior, and pooled instancing.

- [ ] **Step 5: Run focused scene tests and verify GREEN**

Run: `node --test tests/dashboard-studio-browser-model.test.js tests/dashboard-studio-office.test.js`

Expected: both suites pass and no gantry source pin remains.

- [ ] **Step 6: Commit the legend and packet move**

```bash
git add tests/dashboard-studio-browser-model.test.js src/observability/dashboard/ui/studio3d/scene.js
git commit -m "feat(studio): show progress on central spine"
```

---

### Task 3: Tune the live overview and refresh evidence

**Files:**
- Modify: `docs/evidence/studio-interaction-wave/README.md`
- Replace: relevant PNG files in `docs/evidence/studio-interaction-wave/`

**Interfaces:**
- Consumes: the scratch projection/event shapes already used by the interaction-wave browser harness.
- Produces: default-camera, live-packet, handoff/check-in, and reduced-motion proof plus measured diagnostics.

- [ ] **Step 1: Start the local evidence run and inspect the default overview**

Run the dashboard on an available local port with `RSTACK_NO_BROWSER=1` and the scratch registry. Open `/studio3d`, wait for `#studio-app[data-renderer="three"]`, and poll the `data-studio-*` diagnostics across multiple samples.

Expected: all fifteen numbered labels and status fixtures are visible; the manager/HQ remains unobstructed; no browser console or page errors appear.

- [ ] **Step 2: Make bounded visual corrections if the browser exposes a collision**

Only adjust `pipelineSpine` dimensions or the label/console transforms already covered by Tasks 1–2. Re-run both focused tests after each correction. Do not change routes, projection formulas, or lifecycle behavior.

- [ ] **Step 3: Capture the required evidence states**

Capture from the default camera:

```text
pipeline-default.png       manager seated, 15 stages readable, HQ unobstructed
pipeline-live.png          source-backed packets flowing to reached frontier
manager-checkin.png        manager/session route remains visually clear
approval-conversation.png  existing approval dialogue remains unobstructed
reduced-motion.png         static final progress with no ambient motion
```

Append lifecycle events only after the page loads when recording live transitions.

- [ ] **Step 4: Record diagnostics and run all mandatory gates**

Run exactly:

```bash
npm test
npm run lint
npm run typecheck
npm run validate
node scripts/security-audit.mjs
git diff --check
```

Expected: `npm test` reports `# fail 0`; lint reports zero errors; remaining commands exit zero; the measured full scene remains at or below 200 draw calls and 200,000 triangles.

- [ ] **Step 5: Commit refreshed proof**

```bash
git add docs/evidence/studio-interaction-wave/README.md docs/evidence/studio-interaction-wave/pipeline-default.png docs/evidence/studio-interaction-wave/pipeline-live.png docs/evidence/studio-interaction-wave/manager-checkin.png docs/evidence/studio-interaction-wave/approval-conversation.png docs/evidence/studio-interaction-wave/reduced-motion.png
git commit -m "docs(studio): refresh central pipeline proof"
```

- [ ] **Step 6: Publish the branch and open the PR**

Push `codex/studio-interaction-wave` and create a ready PR with base `codex/studio-agent-force`. The PR body must include `Closes #385`, links to epic #361 and PR #377, what shipped, screenshot paths, per-state diagnostics, complete gate outputs, and any measured deviation from this plan.
