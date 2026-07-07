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
| 2026-07-07 | **Universal enforcement guard**: `rstack-agents guard` — framework-neutral gate any host hook can call (stdin Claude Code PreToolUse JSON or flags; exit 0 allow / exit 2 block), reusing the harness classifier + validator sandbox + #133 audited per-task approvals (zero duplicated logic); `RSTACK_VALIDATOR_CONTEXT=1` beats `--context builder` (no flag escape), destructive-with-unresolvable-task fails CLOSED, raw text sniffed as bash before the fail-open path; `init --framework claude-code` installs the PreToolUse hook idempotently; `docs/integrations/wire-your-own-harness.md` paste-in prompt for codex/gemini/custom. **Claude Code is now enforced, not template-only.** Adversarial review: 0 findings | 1, 2 | #227, PR #234 |
| 2026-07-07 | **Docs truth & discovery**: real counts everywhere (68 skills — a stray untracked `skills/logs` dir had inflated local counts; 723 tests; 196 agents per validate), complete README CLI table (14 commands + 2 bins), "Govern an existing codebase" section, roadmap rewritten shipped-vs-future, "any framework" reworded to verified enforcement tiers, mintlify (61 files) + loop-recipes ship in tarball (10.1→6.6MB), new `reference/pipeline.mdx` | 2 | #223, PR #233 |
| 2026-07-07 | **Governance enforcement closeout**: destructive-action gate wired into the live Pi `tool_call` hook (centralized classifier + audited `destructive-action:<taskId>` approvals, fails closed, blocked-event ledger write failures logged not swallowed); context-pressure classified at prompt-assembly (`phase:"pre_execution"`) before model spend; honest validator-profile delegation record naming the owning specialist + delegated required_checks (first slice of #222 — real PASS/FAIL evaluation stays open, semantic = #72) | 1 | #210 #212 #222(partial), PR #230 |
| 2026-07-07 | **Agent-prompt / harness sync**: builder.md documents the cost/context/execution/routing telemetry blocks (routing honestly marked recorded-not-extracted) + the destructive-approval NEEDS_CONTEXT path; validator.md points at registry profiles as guidance (enforcement = #222/#72); 11-feedback-loop over-stamp rejection rule + canonical paths | 1, 4 | #226, PR #232 |
| 2026-07-07 | **Repo hygiene**: `specs/` → `docs/internal-specs/` (history-following, still unshipped); untracked `identity.md` → `docs/audits/`, stale `outputs/`/`logs/`/`skills/logs` archived out of tree | 4 | #224, PR #231 |
| 2026-07-06 | **Context pressure warnings**: detect-only classifier (`context-pressure.js`) with configurable thresholds (builder prompt / memory block / artifact + stage summaries / token ratio) validated per #151, pinned `context_pressure_warning` event (`source` field; emits ONLY what the code actually does — no `memory_pruned` claim without pruning), best-effort at validate (a throw can never fail validation), `context_pressure` rollup in pipeline-state + status CLI; closes BLE-6 — **epics #130 + #134 both closed: backend loop-engineering program (BLE-1→6) fully shipped** | 4 | #136, PR #211 (pre-execution wiring → #212) |
| 2026-07-06 | **Destructive-action classifier**: centralized `classifyDestructiveAction` (broad-delete, git-force, publish, deploy, secret-write, protected-config-write, db-destroy incl. ORM/CLI forms) — single in-repo source of truth for builder + validator contexts, obfuscation-tested (env-prefix, /bin/rm, --force-with-lease…), no false positives on safe commands; `evaluateDestructiveAction` requires an audited `destructive-action:<taskId>` approval via the #133 path (cross-run replay rejected). Validator sandbox keeps its stricter deny-outright policy (documented divergence) | 1 | #131, PR #209 (enforcement wiring + sandbox convergence → #210) |
| 2026-07-06 | **Parallel-execution benchmark**: `bench-parallel.mjs` + `parallel-benchmark.js` — SEQ vs PAR timing for data-independent stage groups (default 12/13/14), evidence gate `parallel_groups.enabled` only at ≥40% measured improvement (fails safe to disabled on any bad input), real data-independence detection, 6-stage cap rejects loudly, honest mock-vs-real labeling in the run artifact the Hub indexes; runner stays sequential — execution wiring is #208 | 2, 4 | #159, PR #207 |
| 2026-07-06 | **Memory write policy enforced in code**: `evaluateWritePolicy` is the single write decision — `appendEpisode` overwrites caller `trusted` flags (launder-via-flag defended), non-PASS episodes skipped under `validator-approved-only` / written `trusted:false` under `validation-attempts`, PASS-trust gated on signature + evidence + quality-score integrity, retracted/untrusted episodes never reach the prompt, `episode_memory_skipped_untrusted` event | 1, 4 | #137, PR #206 (observability nit → #213) |
| 2026-07-06 | **Goal gate fails closed on unreadable state**: corrupt/unreadable `events.jsonl` on a recipe-driven run now returns `goal_activity_indeterminate` FAIL instead of silently disarming the stage-11 gate; goal-activity permanence documented | 1, 4 | #200, PR #205 |
| 2026-07-06 | **Cost/token telemetry persisted** (P0): builder-contract `cost`/`context`/`execution` extracted at validate into `metrics.json` — `cumulative_tokens {input,output,total}`, per-stage `stage_cost_usd`/`stage_tokens`, `cumulative_tool_calls`; increments are idempotency-keyed on builder-contract content hash (retries/loop iterations can't double-count, so the loop budget cap enforces on real spend), `metrics_write_failed` drift event with event-recompute fallback, mid-run upgrade seeds from history, read path prefers persisted totals; docs schema in HARNESS.md | 4 | #83 #135, PR #199 (adversarial review: F1 blocking + 3 fixed pre-merge) |
| 2026-07-06 | **Approval audit consistency**: approval records are a trust boundary — `validateApprovalRecord`/`auditRunApprovals`/`trustedApprovedArtifacts` audit before trusting (safe run/artifact, exact-casing status, actor, timestamp, dashboard token evidence, run binding, replay + append-only ordering); malformed **latest** record poisons its artifact (no fallback), both unblock gates (guardrail-override + required-approval) unified on ONE audit path, `approval_audit_failed` events, fail-loud write boundary | 1 | #133, PR #202 (review: replay-drift MEDIUM fixed pre-merge) |
| 2026-07-06 | **Critical-stage checkpoints**: pre/post restore points for 06/07/08/09/12 (configurable), sha-256 integrity manifests (corrupt checkpoint → `CORRUPT`, fails closed — no best-effort lies), restorability verified on disk, wired into claim/validate/rollback, composes with BLE-4 loop stage resets (reset changes task status, never checkpoint state) | 1 | #132, PR #201 (hardening → #203) |
| 2026-07-06 | **Goal contract runtime-enforced**: `validateStageGoalEvaluation` wired into `sdlc_validate` — a goal-driven run FAILS validation (into validation.json + the retry policy) when agent-11's `goal_evaluation` is missing/malformed; no enforcement without an active goal; stage targeting reuses the rollup's `taskStageIds` so gate and loop reset can't disagree | 1 | #196, PR #198 (review MERGE; corruption edge → #200) |
| 2026-07-06 | **Agent-11 goal contract**: `goal_evaluation` in feedback.json feeds the goal evaluator as an evidenced judge-verdict writer — explicit human/host verdicts always consumed first (id-less shorthand included), agent stamps ahead of the current iteration rejected, evidence must resolve to a real file inside runDir/projectRoot (existence-not-relevance documented honestly), conflicting duplicate criteria consumed by neither, agent rerun recommendations UNION the recipe's stages so the loop self-sustains; closes BLE-4 — **all six BLE epics done** | 1 | #128 #126, PR #195 (adversarial review: 5 findings fixed pre-merge, runtime wiring → #196) |
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

**Backend closeout COMPLETE (2026-07-06):** waves 1+2 shipped — #196, #132, #133, #83, #135,
#137, #159, #131, #136, #200 (PRs #198/#201/#202/#199/#206/#207/#209/#211/#205). Epics #130
(BLE-5) and #134 (BLE-6) closed; the backend loop-engineering program (BLE-1→6) is fully shipped.

**v2.0.0 waves A+B COMPLETE (2026-07-07):** PRs #230/#231/#232/#233/#234 merged (issues
#223/#224/#226/#227 closed; #210/#212 closed; #225 closed INVALID — `managers` +
`enforce_in_express` are live gates, do not re-file). Main green: 756 tests. Framework story
is now "enforced on Pi, Operator, Claude Code (guard hook); guided self-wiring elsewhere".

1. **v2.0.0 Wave C (release mechanics)** — bump package.json+lock to 2.0.0, README badge,
   CHANGELOG 2.0.0 entry (user-facing, 1.8.0 → 2.0.0), then Richardson pushes the v2.0.0 tag
   (publish.yml runs gates + npm publish). Goals 1, 2.
2. **#222 (remainder)** — mechanical PASS/FAIL evaluation of validator required_checks
   (files_modified_exist, tests_run_evidence, builder_contract_complete, no_placeholder_stubs);
   semantic checks stay under epic #72. Goal 1.
3. **2.1.x governance batch**: #228 (required_stage_approvals + every-stage flag — top
   enterprise ask), #229 (exposure CLI verbs: pipeline rollback / checkpoint status / config
   validate / approvals audit / memory inspect), #208 (parallel-group execution), #203
   (atomic checkpoint restore), #213 (memory skip-event observability). Goals 1, 2, 4.
4. **#156 (remainder)** — pipeline next-action on Command Center + schema-version visibility;
   after the #95 page-module split. Goal 2.
5. **#71** — publish RStack Spec v1alpha1 (JSON schemas + conformance examples). Goals 1, 2.
6. UI backlog #90–#97 (security registry depth, compliance/cost depth, client.js split + a11y,
    E2E tests, dark stages). Goal 2.
7. Roadmap/governance research epics #72–#79 (validator independence #72 is referenced by the
   08-testing agent text; attestation #73; traceability drift #74). Research-scale. Goals 1, 2.

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
