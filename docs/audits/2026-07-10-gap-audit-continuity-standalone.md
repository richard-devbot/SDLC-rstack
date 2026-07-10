<!-- owner: RStack developed by Richardson Gunde -->

# Gap Audit — Dashboard, Loop, Context, Sandboxes, Prompt Surface, Session Continuity, and the Standalone Question

**Date:** 2026-07-10
**Prepared by:** Claude (five parallel deep-code audits; source only, no test-suite reliance)
**Trigger:** Richardson + Jeomon's questions: (a) why doesn't "please continue" resume a governed run in a fresh session, (b) should RStack become standalone software instead of a plugin for coding harnesses?

---

## 0. The one-paragraph verdict

RStack's governance core (contracts, approvals, guard, evidence, state, Business Hub) is real, host-independent, and healthy. The two biggest product gaps share one root cause: **RStack does not own the execution loop.** That is why a broken session loses the pipeline ("please continue" fails — the injected context is information, not instruction), and it is exactly what Jeomon's standalone proposal would fix structurally. Short term: make resumption agent-driven (small, ~3-file change). Long term: build the standalone executor on top of the existing bridge — the audit found the harness is already ~95% of a standalone app.

---

## 1. Session continuity + slash commands (P0 — the "please continue" failure)

### What exists
- `rstack-agents context` (src/commands/context.js) fires on SessionStart/UserPromptSubmit and injects ≤1KB:
  `"RStack governed run active: <id> (current stage: <stage>). Blockers: N pending approvals, M open decisions. Route multi-step work through the RStack orchestrator (agents/core/orchestrator.md); inspect state with rstack-agents pipeline status."`
- Statusline shows run/stage/approvals — display-only.
- `rstack-agents pipeline status --json` and `pipeline run --run-id <id>` exist and are fully agent-callable via Bash.
- Stage agents (02, 07, …) have per-stage "Context Recovery" sections.

### Why "please continue" fails
1. The injected packet answers "where am I?" but never "what do I do now?" — no resume command, no task id, no imperative.
2. `/sdlc-resume` is documented in `.claude/rstack-sdlc.md` but no skill/command implements it in this repo.
3. `agents/core/orchestrator.md` has no Session Resume section — a fresh invocation restarts rather than resumes.
4. Slash commands are human-typed prompt templates; nothing translates "an active incomplete run exists" into an automatic agent action.

### Key insight (answers Richardson's slash-command question)
Slash commands and agent-driven behavior are not different capabilities — a slash command is just a prompt the human injects manually. Everything `/sdlc-start` / `/sdlc-resume` do is already reachable by the agent itself (read orchestrator.md, run `rstack-agents pipeline run`). The missing piece is the **trigger**: hooks are the agent-driven equivalent of slash commands, and today our hook injects a status line instead of an order.

### Fix (small, high leverage)
1. **context.js**: when the active run is incomplete, emit an imperative packet with machine-readable resume coordinates:
   `RESUME: run "rstack-agents pipeline run --run-id <id> --max-steps 5" or read agents/core/orchestrator.md and resume at stage <stage>. Do NOT restart the pipeline or regenerate completed stages.`
2. **orchestrator.md**: add a "Session Resume" contract (detect active run → recover stage artifacts → advance → never regenerate DONE stages).
3. **Ship `/sdlc-resume` as a real skill** wrapping `pipeline run` (works for humans AND is invokable by the agent).
4. E2E verification: kill a run mid-stage-07 → new session → "please continue" → run resumes at the right stage.

---

## 2. Builder / validator sandboxes (P1 — honesty gap)

### Enforcement matrix (as found in code)

| Mechanism | Pi | Claude Code | Tau | Operator |
|---|---|---|---|---|
| Destructive-action gate (guard, exit 2) | ✓ | ✓ | ✓ (manual wire) | ✓ (manual wire) |
| Validator sandbox (read-only) | ✓ (env stamped by sdlc_delegate) | ✗ **nothing sets RSTACK_VALIDATOR_CONTEXT on subagents** | ✗ | ✗ |
| Attempt budgets (claim-time block) | ✓ | ✗ | ✗ | ✗ |
| Telemetry budgets (validate-time) | ✓ | ✗ | ✗ | ✗ |
| tdd/plan/scope gates (opt-in) | ✓ | ✓ | ✗ | ✗ |

### Findings
- **Validator sandbox is Pi-only in practice.** `src/core/harness/validator-sandbox.js` is solid (denied tools + 6 command rule families, no override path), but on Claude Code no code ever stamps `RSTACK_VALIDATOR_CONTEXT=1` when validator subagents are spawned — they fall through to builder context, gaining `RSTACK_ALLOW_DESTRUCTIVE` and approval paths. `docs/integrations/claude-code.md` describes the sandbox early on without caveat; the Pi-only note only appears at line ~129.
- Attempt/telemetry budgets run only through the Pi claim/validate path; on bridge harnesses a builder can re-claim indefinitely (only destructive actions are gated).
- Guard itself is well built: fail-open only for unclassifiable input (with raw-bash sniffing), fail-closed for destructive-with-unresolvable-state; approval audit rejects cross-run replay.
- `doctor` does not verify quality-gate wiring when `--gates` was used.

### Fix
1. Stamp validator context on Claude Code (wire it into the validator subagent spawn path / document a mandatory env in the delegate recipe) — or state loudly in docs that validator read-only is Pi-only.
2. Extend guard to consult attempt budgets (it already resolves run + task; the claim-gate logic is importable).
3. Add doctor checks: validator stamping present, gates wired as requested.

---

## 3. Loop mechanism (healthy core, delegation gaps)

### What's real (enforced in code)
- `pipeline loop` is a deterministic, model-free state machine: iteration bounds (default 3, hard cap 20 unoverridable), no-progress fingerprint stop, budget cap from `.rstack/budget.json`, in-lock stage resets that never launder attempt budgets, five pinned loop events.
- Human gates always propagate: pending_approval, ask_user, blocked_retry_policy, missing_contract. The loop can never overcome a gate.
- Goal evaluation is model-free; judge criteria close only through `goal-verdict.json` or evidence-gated agent-11 `goal_evaluation`.

### Gaps
1. **Execution is delegated**: `sdlc_build_next` prepares packets; a host must run the agent. Unattended multi-iteration loops are practical only on Pi; elsewhere the loop needs external cron + a host to execute stages.
2. **No scheduler** (by design — but relevant to the standalone question).
3. **Judge criteria are human-blocked** with no auto-retry of stage 11.
4. **Memory is never injected by the loop** — `recallEpisodes`/`formatEpisodesForPrompt` exist but pipeline-loop never calls them, so loop-run builders don't see prior episodes.

---

## 4. Context management (solid foundation, display-only ceiling)

### Real
- Episode memory with enforced write policy (`evaluateWritePolicy` overrides caller trust flags; PASS-trust gated on signature+evidence+quality integrity), lexical+entity recall with decay, protected-tail pruning, dedup compaction.
- Context-pressure classifier (detect-only, configurable thresholds) → `context_pressure_warning` events + pipeline-state rollup.
- PreCompact → `context_preserved` observe event.

### Gaps
1. **Context injection is display-only** (the §1 continuity gap).
2. **PreCompact records that compaction happened, not what was lost** — no working-state snapshot, no restore on SessionStart.
3. No pruning/action on pressure warnings (honest, but a natural next step).
4. Semantic (vector) retrieval, importance-threshold writes, semantic dedup: spec'd in docs/internal-specs/agentic-memory-layer.md, not in code.
5. Loop ↔ memory disconnection (see §3.4).

---

## 5. Business Hub dashboard (rich state layer, UI coverage lags)

Architecture is healthy: 21 modular pages (#95 closed cleanly), zero-dep client (~3.9k lines), WS-first with REST fallback + ETag, strong POST auth (token, rate limit, CSRF, audit), freshness indicator honest.

### State exists but is NOT rendered (Tier 1 — data fully computed, zero UI)
| Signal | Where it lives | Page that should show it |
|---|---|---|
| Per-stage cost USD + tokens | metrics.json → projected to client already | Cost & Budget, Run Analytics (both have TODOs) |
| Loop iteration progress (n/total) | pipeline-state goal_loop rollup | Command Center |
| Goal criteria detail (met/failing/rerun stages) | goal_evaluated events | Command Center / Run Report |
| Context-pressure breakdown by source | pipeline-state context_pressure.by_source | Alerts & Guardrails |
| Daily/monthly budget caps | budget.json (already read) | Cost & Budget |

### Tier 2 (partial)
Checkpoint restore UI (#203), retry decision history, memory episode browser + trust audit (#213), per-tool-call harness source labels (#251 residual).

### Interactivity ceiling (by design, but revisit under the standalone lens)
Dashboard can approve/reject/decide/env-write; it cannot start/resume/loop/rollback/checkpoint-restore a run — all CLI-only. If RStack trends standalone, the Hub becomes the natural cockpit and needs run-control endpoints (with the same approval-token discipline).

---

## 6. Prompt / agent / skill surface

- 198 agents (3 core + 15 SDLC + ~177 specialists across 8 domains), 68 skills, 72 plugin domains. Core and stage agents follow a consistent structure (Operating Standard pointer, workflow steps, output contracts, quality self-check).
- Contract promises checked against harness enforcement: builder/validator contracts, adopted-run refine-never-regenerate, and validator read-only (on Pi) are all backed by code. Low drift overall.
- Inconsistencies: "Adopted-Run Behavior" and "Context Recovery" sections are not uniformly present across all 15 stage agents; Task Contract blocks are implicit in some agents.
- `/sdlc-resume` documented but unimplemented (§1).

---

## 7. The standalone question (Jeomon's proposal)

### Findings
- **No code in this repo calls an LLM.** Runtime deps are utilities + Pi SDK types; the bridge (`bin/rstack-bridge.ts`) loads the Pi adapter against a **mock Pi** and runs all 18 sdlc_* tools in its own subprocess — standing proof the tool surface works with no host harness.
- Host-independent already: the entire harness core (~20 modules), state contracts (.rstack/), memory, evidence, CLI verbs, and the Business Hub.
- Missing for standalone: (1) an executor — an LLM tool-use loop; (2) native file-edit/bash tool implementations routed through `guard`; (3) model/API-key config (`.rstack/executor.json`); (4) optionally a terminal REPL/TUI.

### Shortest credible path
Embed the **Claude Agent SDK** as the executor behind the existing bridge tool surface: `rstack run "<goal>"` instantiates the SDK loop, registers the 18 sdlc_* tools + guarded file/bash tools, and drives the pipeline itself. Harness unchanged; bridge-conformance tests keep passing. Rough shape: executor (2 wks) → terminal UI/approval prompts (2 wks) → model config (1 wk) → docs/polish (1 wk).

### Strategic framing
Jeomon's standalone ask and Richardson's continuity complaint are the **same root cause**: RStack governs but does not execute. Standalone mode is the structural fix (RStack owns the loop, so "resume" is just re-entering our own state machine — sessions, scheduling, and loop execution all become first-class). It also does NOT abandon the harness-plugin story: standalone is simply a fifth adapter where the executor is ours. Recommendation: RFC + spike issue now, build after the P0/P1 fixes land.

---

## 8. Proposed plan (for Richardson to green-light; issues before branches)

| # | Item | Goal | Size |
|---|---|---|---|
| P0-1 | Agent-driven session resume: imperative context packet + resumeCommand, orchestrator Session Resume section, real `/sdlc-resume` skill, e2e break/continue test | 2, 4 | S–M |
| P1-1 | Validator-context stamping on Claude Code (+ Tau/Operator) or loud doc caveat; doctor check | 1 | S |
| P1-2 | Guard consults attempt budgets on bridge harnesses | 1 | M |
| P1-3 | Dashboard "render the state" wave: per-stage cost/tokens, loop progress, goal criteria, pressure breakdown, daily/monthly caps (folds into #156/#90–#97) | 2 | M |
| P2-1 | Standalone executor RFC + spike: `rstack run <goal>` embedding Claude Agent SDK behind the bridge surface | 2 | RFC:S, build:L |
| P2-2 | Loop ↔ memory: inject recalled episodes into builder packets; PreCompact working-state snapshot + SessionStart restore | 1, 4 | M |
| P2-3 | Hub run-control endpoints (resume/loop/checkpoint-restore) behind approval token — prerequisite-aligned with P2-1 cockpit vision | 2 | M |

Existing queue items #222 (validator required_checks), #228, #229 remain valid and slot between P1 and P2.
