# CLAUDE.md — SDLC-rstack

<!-- owner: RStack developed by Richardson Gunde -->

RStack is a governed AI-SDLC control plane: a 15-stage pipeline (00-environment → 14-cost-estimation)
with builder/validator contracts, evidence ledgers, approval gates, enforced guardrails, and the
Business Hub observability dashboard (`npm run business`, port 3008). The host framework
(Pi / Claude Code / Operator) executes the agents; RStack owns run state, contracts, and governance.

## Product goals (north star)

1. **Governed loop, enforced in code** — every guardrail, gate, and contract promise in the docs is
   backed by runtime enforcement in `src/core/harness/`, never by prompt text alone.
2. **Client-ready end-user product** — a team can install `rstack-agents`, run `init`, and get a
   working governed pipeline with observable state, without reading the source.
3. **Brownfield first-class** — adopting an existing codebase (reverse-populating stages 00–06 from
   real artifacts) is as supported as greenfield. Tracked by epic #148.
4. **Transparent state** — pipeline state is authoritative, atomic, schema-versioned, and inspectable
   from CLI (`rstack-agents pipeline status`), dashboard, and JSON — never silently degraded.

## Feature ledger — enhancements mapped to goals

Update this table whenever a PR merges. One row per shipped capability; newest first.

| Shipped | Capability | Goal | Refs |
|---------|-----------|------|------|
| 2026-07-06 | **BLE-4 goal loop (core)**: model-free goal evaluator (`goal-check.js` — verifiable criteria evaluated by the harness; judge criteria close via iteration-stamped `goal-verdict.json`, unstamped = stale in loop context), bounded budget-capped `rstack-agents pipeline loop` (default 3 iterations, hard cap 20 no config can exceed, no-progress stop, budget checked pre-iteration), in-lock stage resets that can't launder attempt budgets, five pinned loop events in status/feed, `docs/loop-recipes.md` (recipes tagged with maintenance taxonomy) | 1 | #127 #129, PR #193 |
| 2026-07-06 | **Adopt-aware agents**: run-modes contract (greenfield/brownfield/feature) in OPERATING-STANDARD §8 + SOUL, "Adopted-Run Behavior" in ALL 15 stage agents (detection recipe with `RUN_BASE` fallback, refine-never-regenerate, study-before-modify per Stephens Ch11 p243), markers verified against `harvest.js`; completes the #148 flagship end-to-end | 3 | #183, PRs #192 #189 #190 #191 |
| 2026-07-06 | **Stephens book alignment**: 02-requirements Ch4 quality gates (clear/unambiguous/consistent/prioritized/verifiable, words-to-avoid, FURPS+, five Ws, MoSCoW, changes via Decision Queue); 08-testing five-level taxonomy + black/white/gray-box; 09-deployment deliberate cutover strategy (`cutover` block required) + canonical-then-legacy write path; 10-summary defect analysis from real BLE-3 events + Ishikawa grouping + honest nulls; 11-feedback-loop maintenance taxonomy (perfective/adaptive/corrective/preventive) + bug-swarm rule | 1, 4 | #184 #185 #186 #187, PRs #189 #190 #191 |
| 2026-07-05 | **Brownfield adoption** `rstack-agents adopt`: read-only scanner + evidence-or-skip harvesters for all 15 stages, dry-run plan writes nothing, adoption run is DONE-with-evidence + resumable, specialist gap scan, migration guide packaged; closes flagship epic #148 + #160 | 3 | #148 #160, PR #181 |
| 2026-07-05 | State-of-RStack audit doc: four-discipline cross-verification, trigger×goal loop framework check, Stephens book grounding, full pending map + onboarding for any coding model | 2 | PR #180 |
| 2026-07-05 | Resume-aware runner `rstack-agents pipeline run`: skips DONE work, validates active contracts, re-claims retryable failures via the model-free bridge, stops at every human gate; pure planner shared with `--dry-run` (persists nothing); closes BLE-3 epic #121 | 3, 4 | #124, PR #178 |
| 2026-07-05 | Retry event trace: `{scheduled, exhausted, human_required}` rollup counts, per-stage `retry_state`, refined status-CLI recommendations, attempt-counter trace lines, feed rendering of `task_retry_*` events | 4 | #125, PR #177 |
| 2026-07-05 | Deterministic retry policy: `retry_recommendation` × attempt budgets → atomic in-lock task transitions (FAIL/BLOCKED/NEEDS_CONTEXT) with pinned `retry_decision` event contract | 1 | #123, PR #176 |
| 2026-07-05 | Validator sandbox: validator/reviewer/security contexts hard-blocked from writes/destructive shell/publish/secret paths via Pi tool_call hook (no override path), env-stamped by sdlc_delegate, read-only tool defaults; closes BLE-2 epic #117 | 1 | #119, PR #174 |
| 2026-07-05 | Validator registry: stage-specific validator profiles for 06/07/08/12/13 with priority selection (security first), `.rstack/validators/registry.json` overrides (read_only unclampable), profile recorded in validation.json | 1 | #120, PR #173 |
| 2026-07-05 | "RStack in 5 Minutes" quick-start: bare-terminal tour via the bridge, approval gate as the hero moment; packaged in npm, linked from README + Mintlify | 2 | #158, PR #171 |
| 2026-07-05 | Reference SDLC agents (00/06/07/08/11) normalized to canonical stage paths + Task Contract sections; 07-code plan-task/stage-id conflation fixed; closes BLE-1 epic #112 | 4 | #116, PR #170 |
| 2026-07-04 | Dashboard read-path auth: RSTACK_DASHBOARD_READ_TOKEN(_FILE) gates state/artifact/run-report + WS; foreign Origins always rejected on reads and WS upgrades; tokens session-scoped | 2 | #164, PR #168 (external audit) |
| 2026-07-04 | Release hygiene: evidence ledger lock-serialized, publish workflow gains lint + security-audit parity with CI, README counts honest | 1, 4 | #165 #166, PR #167 (external audit) |
| 2026-07-04 | Loop-engineering UI slice: feed names blocked task + reason, override one-shot explainer on approval cards, Guardrail-blocked signal in Needs Attention, retry-event rendering slot | 2 | #156 (partial), PR #162 |
| 2026-07-04 | Hub hardening: TLS opt-in (fails loudly if half-configured), token-file rotation without restart, timing-safe compare, signing-key fallback warning | 2 | #150, PR #161 |
| 2026-07-04 | Config validation on load: field-level warnings for all `.rstack/*.json`, surfaced in Diagnostics + at hub startup | 4 | #151 |
| 2026-07-04 | Data-integrity collector: corrupt run files recorded per run, Diagnostics panel + "data damaged" run badges | 4 | #82 |
| 2026-07-04 | Schema migration registry (`migrations.js`); manifests stamped `schema_version: 2`, legacy runs migrate on read | 4 | #82 |
| 2026-07-03 | Completeness gate hardened: junk evidence (`[{}]`) rejected, non-array option shapes tolerated | 1 | #154 follow-up |
| 2026-07-03 | Builder contract completeness as shared harness API (`validateBuilderCompleteness`); Pi delegates | 1 | #118, PR #154 |
| 2026-07-03 | `rstack-agents pipeline status` CLI (text + `--json` + `--regenerate`); run-id resolution lifted to `runs.js`; `RSTACK_STATE_DIR` mismatch fixed | 4 | #115, PR #153 |
| 2026-07-03 | Runtime guardrail enforcement: attempt budgets hard-block at claim (task → BLOCKED), one-shot `guardrail-override:<task_id>` approvals (crash-safe, consumed in-lock), telemetry budgets at validate, per-project budgets in `rstack.config.json` | 1 | #149, PR #152 |
| 2026-06-21 | Pipeline state rollup (`pipeline-state.json`, atomic, schema_version 1) | 4 | #113, PR #146 |
| 2026-06-17 | Dashboard freshness indicator; security deps sweep; artifact viewer | 2, 4 | PRs #139, #142, #107 |

Pre-2026-06 history lives in CHANGELOG.md (v1.0 → v1.9.0-rc).

## Next steps queue (live — reorder as priorities change)

Work top-down. File a GitHub issue before any branch (Richardson's rule: issues before PRs).

1. **#128** — agent-11 goal contract (`goal_evaluation` in feedback.json feeding the #193
   evaluator as an evidenced verdict writer; folds in the #186 maintenance taxonomy). Last item
   of BLE-4 — closes epic #126. In flight 2026-07-06 (feat/goal-contract-128). Goal 1.
2. **#156 (remainder)** — pipeline next-action on Command Center + schema-version visibility;
   do after the #95 page-module split. Goal 2.
3. **#134–#137** — cost/context/memory (BLE-6), incl. #83 persisted cost metrics. Goal 4.
4. **#130–#133** — BLE-5 remainder: stage checkpoints (#132), approval audit consistency (#133);
   re-scope #131 first — partially superseded by the validator sandbox. Goal 1.
5. **#71** — publish RStack Spec v1alpha1 (JSON schemas + conformance examples). Goals 1, 2.
6. UI backlog #90–#97 (security registry depth, compliance/cost depth, client.js split + a11y,
    E2E tests, dark stages) + #159 parallel benchmark. Goal 2.

UI ↔ backend alignment note (2026-07-04 review): the dashboard approve path writes run-level
`approvals.json` (`appendRunApproval`), so guardrail overrides approved from the Business Hub reach
the claim gate end-to-end — the remaining UI work in #156 is presentational, not plumbing.

External audit reconciliation (identity.md, 2026-07-04): all 5 confirmed-new findings fixed same
day (#164–#166 + README + localStorage); remainder were already fixed by this session's merges,
already tracked (BLE phases, #73, #83, #159), or false alarms (.DS_Store untracked). Strategic
read: hardening is now DONE for the current stage — reputation comes from adoption, so #158
(quick-start) and #148 (brownfield adopt) outrank further internal robustness work.

Declined / out of scope (do not re-open without new context):
- Runtime tool-call interception in the harness — host frameworks execute tools; strongest available
  enforcement is validate-time telemetry checks + host-side hooks (#131 tracks host classification).

## Maintenance protocol (for Claude)

- **After every merged PR**: add a Feature-ledger row (date, capability, goal number, refs) and
  remove/reorder the Next-steps entry it closes. Keep both lists honest — this file is the
  single at-a-glance answer to "where are we and what's next".
- **After every merged PR (memory graph)**: sync the MAIN working tree to main (`git pull` at
  /Users/richardsongunde/projects/SDLC-rstack — it goes stale; a stale tree caused the identity.md
  audit drift) and re-index: `codebase-memory-mcp cli index_repository
  '{"repo_path": "/Users/richardsongunde/projects/SDLC-rstack"}'`. When an architecture decision
  changes, update the stored ADRs via `manage_adr`. Graph UI: http://localhost:9749/.
- **After every review cycle**: record genuinely declined findings under "Declined / out of scope"
  with the rationale, so future sessions don't re-litigate them.
- **At ship time**: CHANGELOG.md gets the user-facing entry (branch-scoped version bump per the
  workspace rules); this file tracks the engineering view. Don't duplicate CHANGELOG content here.
- **Verification gates before any PR**: `npm test`, `npm run lint`, `npm run validate`,
  `node scripts/security-audit.mjs`, `git diff --check`. All must pass.
- **Commit style**: bisected — one logical change per commit; mechanical refactors separate from
  features; tests land with the change they verify.
- Deeper technical reference: `docs/HARNESS.md` (run state, contracts, guardrails),
  `agents/OPERATING-STANDARD.md` (agent behavior), `docs/LOOP-ENGINEERING-UPGRADE-PLAN.md` (BLE roadmap).
