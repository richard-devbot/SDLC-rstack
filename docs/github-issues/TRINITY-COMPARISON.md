<!-- owner: RStack developed by Richardson Gunde -->

# Trinity vs SDLC-rstack — Loop Engineering Deep Analysis

> Reference repos: [Abilityai/trinity](https://github.com/Abilityai/trinity) · [richard-devbot/SDLC-rstack](https://github.com/richard-devbot/SDLC-rstack)  
> Produced: 2026-06-15

---

## TL;DR

| Dimension | Trinity | SDLC-rstack today | Gap severity |
|-----------|---------|-------------------|--------------|
| **What it is** | 24/7 autonomous agent platform (Docker, Redis, APScheduler) | Expert-agent SDLC pipeline (Claude Code, markdown agents) | Different scale — don't copy infra |
| **Scheduler** | APScheduler + missed-run recovery + cron | Manual `/sdlc-start` | **High** |
| **Retry** | `max_retries`, `retry_delay_seconds`, `PENDING_RETRY` status | Harness has `maxTaskAttempts: 2` but agents don't use it | **High** |
| **Validation** | VALIDATE-001: separate post-execution auditor | Harness has validator contracts; Agent 11 only at end | **High** |
| **Goal loop** | `/goal` pattern — run until condition true | No programmatic goal termination | **High** |
| **State** | SQLite executions + `~/.trinity/pipeline-state/` | `.rstack/runs/<id>/` harness + no pipeline rollup | **Medium** (partially built) |
| **Cost/context** | Per-execution `cost`, `context_percent`, `--resume` | Contract v2 fields exist; not populated by agents | **Medium** |
| **Locking** | Redis distributed locks + heartbeats | `safe-write.js` has stale-lock takeover | **Low** (local only) |
| **Agent quality** | Competent dev skills | Rich personas, AskUserQuestion, Completion Protocol | **SDLC wins** |
| **Memory** | Platform memory via agents | `rstack memory append` episodic learning | **SDLC wins** |

**The one-line fix:** Copy Trinity's *patterns* (state, goals, retries, validation, cost) into SDLC-rstack's existing harness — not Trinity's Docker/Redis platform.

---

## How Trinity Implements Loop Engineering

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Trinity Platform                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐ │
│  │ APScheduler  │→ │ Agent Client │→ │ Validation    │ │
│  │ (service.py) │  │ (execute)    │  │ Task (Haiku)  │ │
│  └──────┬───────┘  └──────────────┘  └───────────────┘ │
│         │                                               │
│  ┌──────▼───────┐  ┌──────────────┐  ┌───────────────┐ │
│  │ SQLite       │  │ Redis Locks  │  │ Cost/Context  │ │
│  │ Executions   │  │ (locking.py) │  │ Metrics       │ │
│  └──────────────┘  └──────────────┘  └───────────────┘ │
└─────────────────────────────────────────────────────────┘
```

### Key files (Trinity)

| File | Pattern | What it does |
|------|---------|--------------|
| `src/scheduler/models.py` | RETRY-001 | `max_retries`, `retry_delay_seconds`, `attempt_number`, `retry_of_execution_id` |
| `src/scheduler/models.py` | VALIDATE-001 | `validation_enabled`, `validation_prompt`, `business_status` |
| `src/scheduler/service.py` | Scheduler | `fire_missed_schedules()` on startup, execution lifecycle |
| `src/scheduler/locking.py` | Concurrency | Redis lock `schedule_lock:{id}`, 30s heartbeats, stale reclaim |
| `template.yaml` | Agent contract | Resource requirements, capabilities per agent |

### Execution lifecycle (Trinity)

1. Cron fires → acquire Redis lock
2. Execute agent task → record `RUNNING` in SQLite
3. On failure → if `attempt_number < max_retries`, schedule `PENDING_RETRY` after delay
4. On success + `validation_enabled` → spawn validation task with separate prompt/model
5. Record `cost`, `context_used`, `context_percent`, `tool_calls_json`
6. Release lock

---

## How SDLC-rstack Implements Loop Engineering Today

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│  SDLC-rstack (current)                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐ │
│  │ Claude Code  │→ │ SDLC Agents  │→ │ Artifacts     │ │
│  │ /sdlc-start  │  │ (markdown)   │  │ (JSON files)  │ │
│  └──────────────┘  └──────────────┘  └───────────────┘ │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐ │
│  │ Harness      │  │ Business Hub │  │ Episodic      │ │
│  │ (contracts)  │  │ Dashboard    │  │ Memory        │ │
│  └──────────────┘  └──────────────┘  └───────────────┘ │
│         ↑ NOT WIRED to SDLC agents yet                 │
└─────────────────────────────────────────────────────────┘
```

### What already exists (underused)

| Component | Location | Capability |
|-----------|----------|------------|
| Builder contract | `src/core/harness/contracts.js` | `status`, `files_modified`, `cost`, `context` telemetry |
| Validator contract | same | `retry_recommendation`: `none \| retry_builder \| ask_user \| block` |
| Guardrails | `src/core/harness/guardrails.js` | `maxTaskAttempts: 2`, tool limits |
| Canonical stages | `src/core/harness/stages.js` | 15 stages with artifact paths |
| Evidence ledger | `src/core/harness/evidence.js` | `events.jsonl`, `evidence.jsonl` |
| Safe write locks | `src/core/harness/safe-write.js` | Stale lock takeover for concurrent writes |
| Feedback agent | `agents/sdlc/11-feedback-loop.md` | Cross-contract consistency, CRITICAL stops pipeline |
| Completion Protocol | all agents | `DONE \| DONE_WITH_CONCERNS \| BLOCKED \| NEEDS_CONTEXT` |

### The disconnect

The harness layer was built for Pi extension / Business Hub workflows. The SDLC markdown agents run via Claude Code and write to legacy `$RSTACK_RUN_DIR/artifacts/` with prose STATUS lines. **Two state systems, one product.**

Phase 0 (harness bridge) fixes this before Phases 1–5 add more bash wrappers.

---

## What to Copy from Trinity

| Trinity pattern | SDLC-rstack adaptation | Phase |
|-----------------|------------------------|-------|
| Execution state DB | `pipeline-state.json` rollup in `.rstack/runs/<id>/` | 0, 1 |
| `fire_missed_schedules()` | Resume from `pipeline-state.json` on restart | 1 |
| RETRY-001 | `retry-wrapper.sh` + `BLOCKED` → retry | 2 |
| VALIDATE-001 | Haiku validators after stages 06, 07, 08 | 2 |
| `/goal` condition | `sdlc-goal.sh` + Agent 11 `goal_evaluation` | 3 |
| Cost/context metrics | Cost footer in OPERATING-STANDARD | 4 |
| Redis locks | File-based `lock.sh` (local scale) | 5 |
| `template.yaml` | `pipeline.yaml` DAG definition | 1 |

## What NOT to Copy

1. **Docker per agent** — SDLC runs one pipeline per user session
2. **Redis** — file locks + `safe-write.js` suffice locally
3. **APScheduler microservice** — bash/Node runner triggered by `/sdlc-start` is enough
4. **Trinity's agent personas** — SDLC agents are richer; keep them

## What SDLC-rstack Does Better (protect these)

1. **Agent personas** — named voices, stakes, before-starting reflection
2. **AskUserQuestion standard** — 4-part structure across all agents
3. **Completion Protocol taxonomy** — maps cleanly to retry (BLOCKED) vs escalate (NEEDS_CONTEXT)
4. **Episodic memory** — `rstack memory append` learns per-project
5. **Agent 11 feedback loop** — end-to-end traceability scoring (Trinity has no equivalent)
6. **Escalation rules** — "3 failed attempts → STOP" is explicit

---

## Recommended implementation order

```
Phase 0 (harness bridge) ──→ Phase 1 (state + pipeline.yaml)
         │                            │
         └──────────────────→ Phase 2 (retry + validators)
                                      │
                              Phase 3 (goal loop)
                                      │
                              Phase 4 (cost observability)
                                      │
                              Phase 5 (parallel safety)
```

**Start Phase 0 immediately.** Without it, Phase 1 creates a second state file the dashboard can't see.

---

## Issue index

See `docs/github-issues/README.md` for all 23 issues across 6 phases.
