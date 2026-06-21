<!-- owner: RStack developed by Richardson Gunde -->

# [Epic] Phase 0 — Harness ↔ Loop Runner Bridge

**Labels:** `epic`, `enhancement`, `loop-engineering`, `phase-0`  
**Milestone:** Loop Engineering v1  
**Depends on:** nothing (start here)  
**Blocks:** Phase 1–5 (all phases assume unified run state)

## Why this matters

SDLC-rstack already ships a production harness layer (`src/core/harness/`) with builder/validator contracts, `retry_recommendation`, guardrails (`maxTaskAttempts: 2`), evidence JSONL, and canonical stage definitions in `stages.js`. The Business Hub dashboard already reads `validation.json`, cost telemetry, and goal fields from `.rstack/runs/<run_id>/`.

**The gap:** the SDLC markdown agent pipeline (`agents/sdlc/*.md`) runs manually via Claude Code `/sdlc-start` and does not write to the harness run folder shape. Phase 1–5 propose `pipeline-state.json` and bash wrappers — without bridging, we risk **two parallel state systems** that drift apart.

This phase unifies them: one run ledger, one contract path, one dashboard view.

---

## Issues in this Epic

### Issue 0.1 — Align `pipeline-state.json` schema with harness run manifest

**Labels:** `enhancement`, `phase-0`, `infra`, `data-durability`

**Problem:** The harness uses `.rstack/runs/<run_id>/` with `tasks/<task_id>/builder.json`, `validation.json`, and `events.jsonl`. The proposed `pipeline-state.json` lives at `$RSTACK_RUN_DIR/pipeline-state.json` with a different schema. Dashboard code in `src/observability/dashboard/state/` won't see loop-engineering state without a bridge.

**Proposed implementation:**

1. Define `pipeline-state.json` as a **rollup index** that mirrors harness stage status, not a competing ledger:
   - Location: `.rstack/runs/<run_id>/pipeline-state.json`
   - Each stage entry links to `tasks/<task_id>/builder.json` and `validation.json`
   - Reuse stage IDs from `src/core/harness/stages.js` (single source of truth)

2. Add `src/core/harness/pipeline-state.js` (Node, not bash) with:
   - `initPipelineState(runId, goal)` — seeds from `CANONICAL_SDLC_STAGES`
   - `syncFromHarnessTask(runId, taskId, builder, validator)` — updates stage row
   - `getStageStatus(runId, stageId)` — returns PENDING | IN_PROGRESS | DONE | FAILED

3. Bash wrapper `agents/lib/pipeline-state.sh` delegates to `node -e "import(...)"` or a thin CLI (`bin/rstack-pipeline-state.js`)

**Acceptance criteria:**
- [ ] `pipeline-state.json` lives under `.rstack/runs/<run_id>/`, not legacy `$RSTACK_RUN_DIR/`
- [ ] Stage IDs match `CANONICAL_SDLC_STAGES` exactly (test enforced)
- [ ] `syncFromHarnessTask` updates stage row when builder/validator contracts are written
- [ ] `npm test` passes (add `tests/pipeline-state.test.js`)

**Reference:** Trinity stores execution state in SQLite + exposes via API. SDLC-rstack already has filesystem state — extend it, don't duplicate.

---

### Issue 0.2 — Wire SDLC agents to emit harness builder/validator contracts

**Labels:** `enhancement`, `phase-0`, `agent-update`

**Problem:** SDLC agents use a prose Completion Protocol (`STATUS: DONE | BLOCKED | ...`) but the harness expects structured `builder.json` and `validation.json` per `docs/HARNESS.md`. Retry logic in Phase 2 cannot act on `retry_recommendation` until agents write validator contracts.

**Proposed implementation:**

1. Update `agents/OPERATING-STANDARD.md` to require every SDLC agent to write:
   - `.rstack/runs/<run_id>/tasks/<stage-id>/builder.json` (builder contract)
   - Optional: trigger a Haiku validator that writes `validation.json`

2. Map Completion Protocol → builder contract status:
   | Agent STATUS | builder.json status |
   |---|---|
   | DONE | PASS |
   | DONE_WITH_CONCERNS | DONE_WITH_CONCERNS |
   | BLOCKED | BLOCKED |
   | NEEDS_CONTEXT | BLOCKED (with `next_steps` explaining what context is needed) |

3. Update Agent 00-environment to create the harness run folder shape (already documented in HARNESS.md)

**Acceptance criteria:**
- [ ] `agents/OPERATING-STANDARD.md` documents builder.json write requirement
- [ ] Agents 00, 06, 07, 11 updated as reference implementations
- [ ] `npm run validate` passes
- [ ] Existing harness contract tests still pass

**Reference:** Trinity VALIDATE-001 runs a separate validation task after primary execution. SDLC-rstack harness already defines validator contracts — wire agents to use them.

---

### Issue 0.3 — Expose loop state in Business Hub dashboard

**Labels:** `enhancement`, `phase-0`, `business-hub`, `ui-improvements`

**Problem:** After Phase 1–3, `pipeline-status.sh` prints CLI output but the dashboard won't show loop iteration count, goal status, or per-stage retry attempts unless we wire `pipeline-state.json` into existing dashboard state loaders.

**Proposed implementation:**

1. Extend `src/observability/dashboard/state/runs.js` to read `pipeline-state.json`
2. Add to run detail view:
   - `pipeline_status` (IN_PROGRESS | COMPLETE | FAILED)
   - `goal_achieved_on_iteration` (if set)
   - Per-stage: `attempts`, `validation_status`, `cost_usd`, `context_pct`
3. Surface in Command Center rollup: "Loop iteration 2/3 — consistency 74% (goal: 90%)"

**Acceptance criteria:**
- [ ] Dashboard reads `pipeline-state.json` when present
- [ ] Stage matrix shows validation_status and attempt count
- [ ] No regression when `pipeline-state.json` is absent (backward compat)
- [ ] `npm test` passes

---

## Definition of Done for Phase 0

- [ ] All 3 issues merged to `main`
- [ ] Single run folder shape: harness artifacts + pipeline-state rollup
- [ ] At least 4 agents write builder.json contracts
- [ ] Dashboard shows loop state for test run
- [ ] `npm test` and `npm run validate` pass

**Estimated effort:** 1 day  
**Must complete before:** Phase 1 (pipeline-state.sh should call Node module, not invent parallel schema)
