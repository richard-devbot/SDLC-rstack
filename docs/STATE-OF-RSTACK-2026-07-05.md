<!-- owner: RStack developed by Richardson Gunde -->

# State of RStack — Complete Audit (2026-07-05)

**Audience:** Richardson, and any coding model/agent joining this project. This document is
self-contained: read it top to bottom and you know what RStack is, what is proven to work, what is
pending, and exactly where to start. Companion files: `CLAUDE.md` (live ledger + queue),
`docs/HARNESS.md` (technical contracts), `docs/quick-start-guide.md` (5-minute tour),
`agents/OPERATING-STANDARD.md` (agent behavior rules).

**Verification state at audit time:** 416/416 tests, `npm run lint` clean, 196 agents validated,
security-audit baseline clean. BLE epics 1, 2, and 3 closed. External audit (identity.md) fully
reconciled — all confirmed findings fixed.

---

## 1. Cross-verification: the four engineering disciplines

Richardson's question: are loop engineering, harness engineering, context engineering, and prompt
engineering genuinely fitted into RStack? Verdict per discipline, with code evidence:

### 1.1 Harness engineering — **DONE (strongest discipline)**

| Capability | Evidence | Enforced in code? |
|---|---|---|
| Atomic, crash-safe state (locks + tmp+fsync+rename) | `src/core/harness/safe-write.js`, incl. evidence ledger (#166) | Yes |
| Builder/validator contracts + completeness gate | `src/core/harness/contracts.js` (`validateBuilderCompleteness`) | Yes — PASS requires evidence, memory summaries, stage summaries |
| Guardrail budgets hard-block at claim; one-shot `guardrail-override` | `src/core/harness/guardrails.js` + Pi claim gate (PR #152) | Yes — task → BLOCKED, override consumed in-lock |
| Validator sandbox (read-only validators, no override path) | `src/core/harness/validator-sandbox.js` + `tool_call` hook (PR #174) | Yes |
| Validator registry (stage-specific profiles, security-first priority) | `src/core/harness/validator-registry.js` (PR #173) | Yes — `read_only` unclampable |
| Schema versioning + migration registry | `src/core/harness/migrations.js` (manifest v2) | Yes |
| Data-integrity + config validation surfaced, never silent | `state/files.js` tracked readers, `config-validation.js` (#82/#151) | Yes |
| Approval gates + DoR gates + audit trail | `tracker/approvals.js`, `readiness.js`, dashboard audit JSONL | Yes |

### 1.2 Loop engineering — **CORE DONE; goal loop pending (BLE-4)**

Using the trigger × goal framework (see §2): the retry/recovery loop is complete and deterministic.
`classifyRetryDecision` (`src/core/harness/retry-policy.js`) drives atomic task transitions;
`rstack-agents pipeline run` (`src/commands/pipeline-run.js`) resumes any interrupted run, skips
DONE work, re-claims retryable failures via model-free bridge calls, and stops at every human gate.
Every transition is observable (trace, status CLI, feed, rollup `retry_state`).

**Missing:** the *goal-conditioned* loop — "keep working until goal met" (BLE-4, #126–#129: goal
evaluator, agent-11 goal contract, bounded loop runner). `pipeline run` stops when the plan is
done; it cannot yet loop against a quality/goal condition. This is the `/goal` capability from the
loop-library framing and the highest-leverage remaining loop work.

### 1.3 Context engineering — **SUBSTANTIALLY DONE; pressure controls pending (BLE-6)**

- `memory_summary` / `stage_summaries` contract fields are the context-reduction path: later agents
  receive durable decisions + evidence pointers instead of transcripts (enforced for passing
  builders since #118/#154).
- Episodic memory with validator-approved-only write policy, sanitization (secret + prompt-injection
  patterns), decay/compaction, bounded injection (`src/memory/index.js`).
- Spec anchor + Context Recovery sections in agents; canonical stage paths keep artifact context
  addressable (#116).
- Development-side: `codebase-memory-mcp` knowledge graph (28.8k nodes) + stored ADRs give any
  agent structural memory of this codebase itself.

**Missing:** context *pressure* instrumentation — #135 (populate cost/context fields from builder
contracts), #136 (context pressure warnings), #137 (tighten memory write policy). Until #135 lands,
`context_tokens_used` in the rollup is normally null.

### 1.4 Prompt engineering — **DONE at reference quality; breadth unmeasured**

- The 15 SDLC agents follow a disciplined template: Voice (persona + stakes), Context Recovery,
  stepwise Workflow with runnable blocks, Task Contract with compact JSON examples, Quality
  Self-Check, Operational Self-Improvement, AskUserQuestion format, Completion Protocol with
  escalation. Five reference agents (00/06/07/08/11) were re-normalized in #116.
- Builder prompts embed the operating standard, guardrail summary, routed specialists, and recalled
  memory — prompt content is *assembled by the harness*, not hand-maintained per run.
- Platform-agnostic rule (workspace CLAUDE.md): skills never hardcode framework commands.

**Caveat (honest):** the other 190+ specialist agents and 68 skills have never been systematically
quality-audited; #160 (gap scan) covers coverage but not prompt quality. Acceptable risk for now —
specialists are invoked *by* stage agents, which carry the contracts.

---

## 2. Loop framework check (trigger × goal)

Framework: a loop = **trigger** (manual | scheduled | action) + **goal** (verifiable | LLM-as-judge).

| Dimension | RStack today | Gap / where it lands |
|---|---|---|
| Manual trigger | ✅ `rstack-agents pipeline run`, `sdlc_*` tools, bridge CLI | — |
| Scheduled trigger | ⚠️ Prompt-level only (`HEARTBEAT.md` guidance; host frameworks' cron/automations can invoke the bridge) | A documented cron recipe belongs in the loop-recipes doc (see below); no runtime scheduler needed — hosts own scheduling |
| Action trigger (PR opened, etc.) | ❌ Not built | Roadmap #75 (PR gate) is adjacent; CI can call `pipeline run --json` today — recipe-able |
| Verifiable goal | ✅ This is RStack's DNA: contracts, evidence, budgets, stop conditions, non-zero exits for CI | — |
| LLM-as-judge goal | ❌ Pending — BLE-4 goal evaluator (#127) + bounded loop runner (#129, budget-capped per the "loops are expensive" caveat) | Next backend epic after #148 |

**Loop-library ideas → RStack mapping** (candidate recipes once BLE-4 lands; each is
trigger + goal + budget cap): overnight docs sweep ≈ stage 03 + goal evaluator; production error
sweep ≈ the *maintenance loop* the Stephens book says we're thinnest on (feeds stage 11);
architecture-satisfaction ≈ stage 06 + judge; full product evaluation ≈ stage 08 + scenario rubric.
RStack's differentiator vs. raw loops: every iteration passes through contracts, budgets, and
approval gates — a loop that can't silently burn tokens or push to prod. **Action taken:** these
are recorded here rather than as issues; file recipes as part of BLE-4 (#129) acceptance.

---

## 3. Grounding against *Beginning Software Engineering* (Stephens, Wiley 2015)

Richardson designated this book as the canonical description of how software work is done
(local PDF + chapter map stored in agent memory). Mapping validates the 15-stage model:

| Stephens | RStack stage(s) | Fit |
|---|---|---|
| Ch2 Document management | Evidence ledger + 03-documentation | ✅ |
| Ch3 Project management (PERT/Gantt, risk, estimation) | 04-planning, 05-jira | ✅ (risk lives in contracts' `risks[]`) |
| Ch4 Requirement gathering (clear/unambiguous/**verifiable**, FURPS+, five Ws) | 01-transcript, 02-requirements | ✅ — "verifiable requirements" is literally the evidence-contract philosophy |
| Ch5/6 High/low-level design | 06-architecture | ✅ |
| Ch7/8/9 Development/Testing/Deployment | 07/08/09 | ✅ |
| Ch10 **Metrics** | Business Hub + 14-cost | ⚠️ weakest fit — #83/#135 cost persistence still open |
| Ch11 **Maintenance** | 11-feedback-loop | ⚠️ thinnest stage — no post-deployment error-sweep loop yet (pairs with BLE-4 recipes) |
| Wrap-up | 10-summary | ✅ |
| Part II process models (predictive/iterative/RAD-agile) | Profiles: enterprise-webapp / business-flex / lean-mvp | ✅ conceptual match |

**Takeaways for the roadmap:** (1) brownfield `adopt` (#148) should harvest per Stephens'
categories — requirements from docs/issues, HLD from architecture inference, tests as the Ch8
baseline; (2) Metrics (Ch10) and Maintenance (Ch11) are the two book-visible gaps → BLE-6 and the
error-sweep loop recipe respectively.

---

## 4. Shipped inventory (condensed — full ledger in CLAUDE.md)

**23 PRs merged, 20 issues closed across 2026-07-02 → 07-05.** Highlights by goal:

- **Goal 1 (governed loop in code):** runtime guardrail budgets + one-shot overrides (#149);
  contract completeness API (#118); validator sandbox (#119) + registry (#120); deterministic retry
  policy (#123). Epics BLE-1/2/3 closed.
- **Goal 2 (client-ready):** quick-start guide (#158); hub TLS/token rotation (#150); read-path
  auth (#164); loop-engineering UI slice (#156 partial).
- **Goal 3 (brownfield):** resume-aware runner (#124) — the prerequisite. Epic #148 unblocked.
- **Goal 4 (transparent state):** pipeline-state rollup (#113) + status CLI (#115); schema
  migrations + integrity surfacing (#82); config validation (#151); retry trace (#125); agent path
  normalization (#116).
- **Trust/security (external-audit driven):** evidence-ledger locking (#166), publish-workflow
  parity (#165), honest README, session-scoped tokens.
- **Infrastructure:** `codebase-memory-mcp` v0.8.1 installed; repo indexed (28.8k nodes / 36.9k
  edges); 2 ADRs stored (control-plane architecture; retry loop). Graph UI: http://localhost:9749/.

---

## 5. Pending — every open issue, grouped and prioritized

**Next up (queue order, from CLAUDE.md):**

| # | Item | Goal | Notes |
|---|---|---|---|
| 148 | **Brownfield `adopt` epic** — dry-run population plan, evidence harvesters, migration guide (+#160 gap scan) | 3 | START HERE — flagship; all prerequisites shipped |
| 156 | UI remainder: pipeline next-action on Command Center, schema-version visibility | 2 | after #95 split |
| 126–129 | **BLE-4 goal loop**: evaluator, agent-11 goal contract, bounded runner | 1 | = the LLM-as-judge loop capability (§2); include loop recipes in #129 |
| 134–137 | BLE-6 cost/context/memory (+#83 cost persistence) | 4 | closes the Stephens Ch10 metrics gap |
| 130–133 | BLE-5 remainder: destructive-gate coverage (#131), stage checkpoints (#132), approval audit consistency (#133) | 1 | #131 partially superseded by validator sandbox — re-scope before starting |
| 71 | RStack Spec v1alpha1 (JSON schemas + conformance) | 1,2 | makes the project citable |

**UI backlog (goal 2):** #90 requirements/traceability page, #91 security threat registry,
#92 compliance+cost pages, #93 release-readiness gate, #94 executive rollup, #95 client.js
modularization + a11y (do before deep UI work), #96 E2E tests, #97 dark stages, #33 umbrella.

**Governance roadmap (research-backed, goal 1):** #72 cross-harness review independence,
#73 attestation envelopes (also: make `RSTACK_SIGNING_KEY` mandatory in enterprise profile),
#74 traceability drift, #75 untrusted-PR gate, #78 governance packs, #79 umbrella.

**DX/perf:** #159 parallel benchmark, #160 specialist gap scan (fold into #148).

**Declined (do not reopen without new context):** runtime tool-call interception in the harness —
host frameworks execute tools; validate-time telemetry + host hooks is the enforcement ceiling.

---

## 6. Where to start next (the plan)

1. **#148 brownfield `adopt`** — sketch: `rstack-agents adopt --dry-run` prints a stage-population
   plan (what would be harvested per stage, per Stephens categories §3); harvesters populate
   `artifacts/stages/00..06` + baseline 08/09 with evidence-pointer artifacts and mark stages
   DONE-with-evidence; `pipeline run` then resumes at real work. Include #160's specialist gap scan
   in the repo scanner. Never overwrite; adoption is additive and reviewable.
2. **BLE-4 goal loop** (#126–#129) — after #148; budget-capped bounded runner + goal evaluator,
   shipping 3–4 loop recipes (docs sweep, error sweep, architecture satisfaction) as acceptance.
3. **BLE-6 / #83** — cost/context persistence (Metrics gap).
4. **#71 spec** — publish v1alpha1 once adopt + goal loop stabilize the surface.

## 7. Onboarding for any coding model/agent

1. Read `CLAUDE.md` (root) — goals, ledger, live queue, maintenance protocol. It is authoritative.
2. Read `docs/HARNESS.md` — run-state layout, contracts, guardrails, retry policy, runner.
3. Query the knowledge graph before exploring code: `codebase-memory-mcp cli search_graph
   '{"project":"Users-richardsongunde-projects-SDLC-rstack","query":"..."}'` (or the MCP tools);
   read the stored ADRs via `manage_adr(mode='list')`.
4. **Protocols (non-negotiable):** GitHub issue before any branch; bisected commits; verification
   gates before any PR (`npm test`, `npm run lint`, `npm run validate`,
   `node scripts/security-audit.mjs`, `git diff --check`); PR bodies carry the owner comment; fix
   or explicitly decline every reviewer finding; after merge — update the CLAUDE.md ledger/queue,
   `git pull` the main working tree, re-index the graph.
5. Transparency first: if something can't handle a condition, say so before shipping it. Honest
   `DONE_WITH_CONCERNS` beats a wrong `DONE`.
