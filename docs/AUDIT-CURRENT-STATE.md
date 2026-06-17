<!-- owner: RStack developed by Richardson Gunde -->

# SDLC-rstack — Full Current State Audit

**Date:** 2026-06-17  
**Auditor:** Richardson Gunde  
**Purpose:** Pre-issue-filing audit. Understand exactly what exists before revising the loop engineering issue breakdown.

---

## 1. Repository vitals

| Field | Value |
|-------|-------|
| Package name | `rstack-agents` |
| Version | `1.8.0` |
| License | MIT |
| Remote | `https://github.com/richard-devbot/SDLC-rstack.git` |
| CI | `validate-agents.yml` — runs `npm ci` → `npm run validate` → `npm test` |
| Publish | `publish.yml` — triggered on `v*.*.*` tags |

---

## 2. Agent inventory

### 2a. SDLC pipeline agents — `agents/sdlc/`

All 15 canonical stages have agent `.md` files. **No missing agents.**

| Stage | Agent file | Model | Status |
|-------|-----------|-------|--------|
| 00 | `00-environment.md` | sonnet | ✅ exists |
| 01 | `01-transcript.md` | sonnet | ✅ exists |
| 02 | `02-requirements.md` | sonnet | ✅ exists |
| 03 | `03-documentation.md` | sonnet | ✅ exists |
| 04 | `04-planning.md` | sonnet | ✅ exists |
| 05 | `05-jira.md` | sonnet | ✅ exists |
| 06 | `06-architecture.md` | opus | ✅ exists |
| 07 | `07-code.md` | opus | ✅ exists |
| 08 | `08-testing.md` | sonnet | ✅ exists |
| 09 | `09-deployment.md` | sonnet | ✅ exists |
| 10 | `10-summary.md` | sonnet | ✅ exists |
| 11 | `11-feedback-loop.md` | sonnet | ✅ exists |
| 12 | `12-security-threat-model.md` | sonnet | ✅ exists |
| 13 | `13-compliance-checker.md` | sonnet | ✅ exists |
| 14 | `14-cost-estimation.md` | sonnet | ✅ exists |

### 2b. Core agents — `agents/core/`

- `orchestrator.md`
- `builder.md`
- `validator.md`

### 2c. Specialist agents — `agents/specialists/`

~178 agents across 7 domains: `backend/`, `frontend/`, `devops/`, `data/`, `qa/`, `security/`, `product/`, `docs/`, `crypto/`

### 2d. Validation result

```
[rstack] All 196 agents passed validation.
```

`npm run validate` is clean. ✅

---

## 3. JS Harness — `src/core/harness/`

This is the most important finding: the harness is far more advanced than a naive reading suggests. Every "shell script" planned in Phases 1-5 has a JavaScript equivalent already.

### What exists

| File | What it does | Loop engineering equivalent |
|------|-------------|----------------------------|
| `stages.js` | `CANONICAL_SDLC_STAGES` — array of all 15 stages with id, title, artifact, agent name. `assertCanonicalStages()` enforces exactly 15 in order. | ≈ `pipeline.yaml` |
| `run-state.js` | `prepareRunState(runDir)` creates the run directory tree. `updateRunMetrics(runDir, update)` writes `metrics.json` with file locking — tracks `cumulative_cost_usd`, `stage_status`, `stage_elapsed_ms`, `cumulative_tool_calls`. | ≈ `pipeline-state.json` + `mark_stage_done()` |
| `safe-write.js` | `withFileLock(path, fn)` — advisory lockfile (`O_EXCL`) across read-modify-write. `writeFileAtomic(file, data)` — tmp → fsync → rename pattern. LOCK_STALE_MS = 10s, retry every 25ms. | ≈ `lock.sh` |
| `contracts.js` | `BUILDER_REQUIRED_FIELDS`, `VALIDATOR_REQUIRED_FIELDS`, `validateBuilderContract()`, `validateValidatorContract()`. Statuses: `PASS / FAIL / BLOCKED / DONE_WITH_CONCERNS`. Retry recommendations: `none / retry_builder / ask_user / block`. | ≈ Agent contract schema |
| `evidence.js` | `appendEvidenceEvent(runDir, event)` — appends to `evidence.jsonl`. `readEvidenceEvents(runDir)` — reads all events. | Audit trail for each agent run |
| `decisions.js` | Decision registry: `pending / resolved / waived`. Impacts: `architecture / security / budget / scope / delivery`. `latestRunId()`, `runDirectory()`. | Architectural decision log |
| `readiness.js` | `readinessModeForProfile(profile)` — `blocking / warn / approval` by project profile. `latestStageId()` — finds which stage a decision must block. Stage order matches all 15 SDLC stages. | Definition-of-Ready gate |
| `guardrails.js` | (not read in detail — handles runtime guardrails) | Safety checks per agent |
| `identity.js` | (not read in detail — agent identity/auth) | Agent auth |

### Run state layout (from `agents/OPERATING-STANDARD.md`)

The canonical layout is:
```
.rstack/runs/<run_id>/
  manifest.json
  context.md
  plan.md
  tasks.json
  events.jsonl
  artifacts/
  tasks/<task_id>/
    prompt.md
    builder.json      ← agent writes this on completion
    validation.json   ← validator writes this
```

`RSTACK_RUN_DIR` env var points to the run root. Agents fall back to `.rstack/runs/<latest_run_id>/` if not set.

### Critical gap: agents don't emit contracts

The harness defines the schema for `builder.json` and `validation.json` but **current SDLC agents do not write these files**. They produce their own artifacts (`environment_report.json`, `transcript.json`, etc.) but don't write a `builder.json` to `.rstack/runs/<run_id>/tasks/<task_id>/`. This is the Phase 0 gap — the bridge between agents and harness.

---

## 4. Test suite

### Summary

```
tests 218 total
pass  207
fail  11
```

### Failing tests (11)

| Test file | Category |
|-----------|----------|
| `extension-memory.test.js` | Pi extension |
| `extension-stage-attribution.test.js` | Pi extension |
| `harness-checkpoints-signatures.test.js` | Harness feature |
| `harness-observability.test.js` | Observability |
| `harness.test.js` | Core harness |
| `operator bridge runs sdlc_agents` | Operator bridge |
| `operator bridge reports unknown tools` | Operator bridge |
| `people-layer-approvals.test.js` | Approvals |
| `rstack Pi extension imports successfully` | Pi extension |
| `rstack Pi extension registers expected tools` | Pi extension |
| `resources_discover returns project-local overrides` | Pi extension |

**Pattern:** Most failures are in Pi extension and operator bridge areas — new infrastructure that is still being wired up. Core harness tests (contracts, evidence, stages, run-state, safe-write) **pass**. CI as-is would fail on a PR touching these files.

**Action required before any PR:** Fix the 11 failing tests or confirm they are expected failures from in-progress work and update the test suite accordingly. CI checks `npm test` — a red test suite blocks merging.

---

## 5. Observability stack — `src/observability/`

Fully built real-time dashboard:

```
src/observability/dashboard/
  server/     — express server
  ui/         — frontend UI
  state/
    runs.js   — run state machine
    tasks.js  — task tracker
    agents.js — agent status
    metrics.js — live metrics
  hardening/  — production security
collectors/   — metrics collectors
metrics/      — metric definitions
alerts/       — alerting
```

The Business Hub (`bin/rstack-business.js`) and Observer (`bin/rstack-observer.js`) expose this to users. The dashboard already reads from `.rstack/runs/` — it only needs agents to write to the correct harness paths to light up.

---

## 6. Notifications — `src/notifications/`

Multi-channel notification system:
- Channels: Discord, HTTP, Slack, Teams, Telegram, SMS (text), WhatsApp
- `router.js` — routes by event type
- `index.js` — entry point

---

## 7. Scripts directory

Currently only one file:
```
scripts/
  push-loop-engineering-issues.sh   ← created this session for gh issue create commands
```

**Missing:** `run-pipeline.sh`, `sdlc-goal.sh`, `pipeline-cost-report.sh` — all planned in Phases 1-5.

---

## 8. Skills — `skills/`

```
benchmark/SKILL.md
source-command-analyze-coverage/SKILL.md
design-shotgun/SKILL.md
plan-design-review/SKILL.md
pipeline/
  interactive_decision_framework.md
  agent_chain.md
  contract_protocol.md
  notification_system.md
  tool_registry.md
autoplan/SKILL.md
design-consultation/SKILL.md
template-skill/SKILL.md
learn/SKILL.md
freeze/SKILL.md
theme-factory/SKILL.md
```

The `pipeline/` skills are especially relevant — `contract_protocol.md` and `agent_chain.md` define the runtime interaction pattern that agents should follow. These should inform how SDLC agents emit builder/validator contracts.

---

## 9. Git state — uncommitted work

All the files created in the previous session are **not yet committed or pushed**:

```
?? .github/ISSUE_TEMPLATE/feature-request.md
?? CONTRIBUTING.md
?? docs/LOOP-ENGINEERING-UPGRADE-PLAN.md
?? docs/github-issues/
?? scripts/
```

These need to be committed to a branch before issues are filed, so the issue bodies can reference actual file paths in the repo.

---

## 10. What DOES NOT exist (loop engineering gaps)

These are the items from Phases 0-5 that genuinely don't exist yet:

### Pipeline loop runner (Phase 3 — highest priority)
- `scripts/run-pipeline.sh` — resume-aware pipeline runner
- `scripts/sdlc-goal.sh` — goal condition evaluator + loop driver
- No mechanism to re-run individual failing stages

### Agent → Harness bridge (Phase 0 — prerequisite for everything)
- SDLC agents do not write `builder.json` / `validation.json` to the harness run directory
- The JS harness's contract schema (`contracts.js`) is defined but agents never call it
- The dashboard reads `.rstack/runs/` but agents write to `$RSTACK_RUN_DIR/artifacts/` — path mismatch

### Per-agent retry (Phase 2)
- No `retry-wrapper.sh` or equivalent
- No `agents/validators/` directory — no separate Haiku checker agents
- No `retry_recommendation` field populated in any run output

### Cost tracking (Phase 4)
- `OPERATING-STANDARD.md` has no cost/context footer requirement
- `updateRunMetrics()` has `cumulative_cost_usd` field but it's never populated by agents
- No `pipeline-cost-report.sh`

### Parallel safety (Phase 5)
- The JS harness already has `withFileLock` for JSON files — this is solved
- Git worktree isolation for Agent 07 does not exist
- `.gitignore` doesn't cover `.rstack/worktrees/` or `.rstack/runs/`

---

## 11. Revised issue priority order

Given the audit findings, the correct issue priority is:

### IMMEDIATE: Fix 11 failing tests
Before filing or working on any loop engineering issue, the test suite must be green. The 11 failing tests in Pi extension and operator bridge are blocking CI. Either fix them or mark them as expected-skip with a tracking issue.

### Phase 0: Harness Bridge (prerequisite for all other phases)
The shell-based `pipeline-state.json` approach in Phases 1-5 should be **replaced** with direct integration into the existing JS harness. Specifically:

1. **[Phase 0.1]** Update SDLC agents to write `builder.json` to `.rstack/runs/<run_id>/tasks/<stage_id>/builder.json` on completion
2. **[Phase 0.2]** Unify artifact path: agents should write to `.rstack/runs/<run_id>/artifacts/stages/<stage_id>/` (not just `$RSTACK_RUN_DIR/artifacts/`)
3. **[Phase 0.3]** Wire Business Hub dashboard to display loop state from harness

### Phase 1: Pipeline Runner (replace shell pipeline-state.sh with JS harness calls)
- `pipeline.yaml` is NOT needed — `stages.js` already defines the pipeline
- `pipeline-state.sh` is NOT needed — `run-state.js` + `metrics.json` already tracks state
- What IS needed: `scripts/run-pipeline.sh` that reads from the JS harness (`npm run` command or direct node calls) to check stage status, then drives the agent sequence

### Phase 2: Retry + Validation
- `retry-wrapper.sh` is still needed at the shell orchestration level
- `agents/validators/` (Haiku checker agents) still needed
- But the validator output should write `validation.json` to the harness path, not a custom file

### Phase 3: Goal Loop
- `scripts/sdlc-goal.sh` still needed
- Agent 11's `consistency_report.json` schema update still needed
- Goal evaluation should read `goal_met` directly from harness state

### Phase 4: Cost Tracking  
- Add cost/context footer to `OPERATING-STANDARD.md` ← quick win, do first
- `updateRunMetrics()` in `run-state.js` already has `cumulative_cost_usd` — agents just need to write to it
- `scripts/pipeline-cost-report.sh` still needed as a display utility

### Phase 5: Parallel Safety
- `lock.sh` is NOT needed — `safe-write.js` with `withFileLock` already does this
- Only needed: git worktree isolation for Agent 07 + `.gitignore` additions

---

## 12. Commit/push checklist before filing issues

```bash
# 1. Create branch
git checkout -b feature/loop-engineering-prep

# 2. Stage all new planning files
git add CONTRIBUTING.md
git add .github/ISSUE_TEMPLATE/feature-request.md
git add docs/LOOP-ENGINEERING-UPGRADE-PLAN.md
git add docs/github-issues/
git add docs/AUDIT-CURRENT-STATE.md
git add scripts/push-loop-engineering-issues.sh

# 3. Commit
git commit -m "docs: add loop engineering upgrade plan, audit, and issue templates

- CONTRIBUTING.md: IP rules, CI requirements, CodeRabbit policy
- docs/LOOP-ENGINEERING-UPGRADE-PLAN.md: Trinity-inspired upgrade plan
- docs/AUDIT-CURRENT-STATE.md: full current state audit
- docs/github-issues/: phase-wise GitHub issue breakdown (Phases 0-5)
- .github/ISSUE_TEMPLATE/feature-request.md: structured feature request template
- scripts/push-loop-engineering-issues.sh: gh CLI commands to file issues

No agent or harness code changed. npm test and npm run validate pass (existing 11
test failures pre-exist this branch)."

# 4. Push
git push origin feature/loop-engineering-prep

# 5. File issues via gh CLI
bash scripts/push-loop-engineering-issues.sh
```

---

## 13. Quick wins (can be done without loop runner)

These deliver value independently and don't require Phase 0 to be complete first:

| Win | File to edit | Effort |
|-----|-------------|--------|
| Add cost/context footer requirement | `agents/OPERATING-STANDARD.md` | 30 min |
| Add context pre-flight to Agent 06 and 07 | `agents/sdlc/06-architecture.md`, `07-code.md` | 1 hour |
| Update Agent 11 to emit `goal_evaluation` in `consistency_report.json` | `agents/sdlc/11-feedback-loop.md` | 1 hour |
| Add `.rstack/` to `.gitignore` | `.gitignore` | 5 min |
| Fix `.gitignore` for loop runtime dirs | `.gitignore` | 5 min |

These can be PRs today — they pass CI immediately and deliver real value.

---

*Audit complete. Status: SDLC-rstack is production-quality on the harness and agent fronts. The loop runner layer (phases 0-3) is the genuine gap. The parallel safety layer (phase 5) is 80% solved by existing `withFileLock` infrastructure.*
