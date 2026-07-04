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

1. **#116** — normalize SDLC markdown agents to harness paths (closes BLE-1 epic #112). Goal 4.
2. **#119 / #120** — validator sandbox policy + validator registry (closes BLE-2 epic #117). Goal 1.
3. **#123 / #124 / #125** — retry policy, resume-aware runner, retry trace (BLE-3 epic #121);
   prerequisite for brownfield feature mode. Goal 3.
4. **#148** — brownfield `adopt` command: `--dry-run` stage-population plan, evidence harvesters,
   migration guide. Goal 3 (flagship gap for client use). Include #160 (specialist gap scan).
5. **#158** — quick-start guide "RStack in 5 minutes" (recovered stabilization draft). Goal 2.
6. **#156 (remainder)** — pipeline next-action on Command Center + schema-version visibility;
   do after the #95 page-module split. Goal 2.
7. **#126–#129** — goal loop (BLE-4). Goal 1.
8. **#134–#137** — cost/context/memory (BLE-6), incl. #83 persisted cost metrics. Goal 4.
9. **#71** — publish RStack Spec v1alpha1 (JSON schemas + conformance examples). Goals 1, 2.
10. UI backlog #90–#97 (security registry depth, compliance/cost depth, client.js split + a11y,
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
