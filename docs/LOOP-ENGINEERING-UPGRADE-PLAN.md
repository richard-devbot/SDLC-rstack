<!-- owner: RStack developed by Richardson Gunde -->

# SDLC-rstack Loop Engineering Upgrade Plan
> Deep analysis: Trinity (Abilityai/trinity) vs SDLC-rstack (richard-devbot/SDLC-rstack)
> Produced: 2026-06-15

---

## Executive Summary

Trinity is a full autonomous agent orchestration **platform** — Docker containers, a real APScheduler microservice with Redis distributed locking, per-execution retry logic, a post-execution validation layer, cost tracking, and health endpoints. SDLC-rstack is a **pipeline of expert agents** — each one deeply instructed, opinionated, and consistent, but manually triggered, single-threaded, and stateless between runs.

The gap is not in agent quality. SDLC-rstack's agent personas are **better engineered** than Trinity's internal dev skills. The gap is entirely in the **loop infrastructure**: what runs the agents, what happens when they fail, how state survives between sessions, and how the pipeline knows when it's actually done.

This document maps every gap, explains the Trinity pattern behind it, and gives you concrete code to add.

---

## Part 1: What Trinity Does That SDLC-rstack Lacks

### 1.1 — Real Scheduler with Missed-Run Recovery

**Trinity:** `src/scheduler/service.py` runs APScheduler inside a standalone Docker container. On startup it calls `fire_missed_schedules()` — any cron that fired while the container was down gets executed immediately. Every execution is recorded to SQLite with `ExecutionStatus` (RUNNING / SUCCESS / FAILED / CANCELLED / SKIPPED / PENDING_RETRY).

**SDLC-rstack:** No scheduler. Agents run when the user types a command. If a session dies mid-pipeline, the only recovery is the "Context Recovery" section inside each agent — helpful, but manual.

**What to copy:** A lightweight `pipeline-state.json` written after every stage, plus a `00-bootstrap.sh` that reads it on startup and skips already-completed stages. Trinity's on-startup replay logic is 30 lines of Python; the SDLC equivalent is 20 lines of bash.

---

### 1.2 — Per-Execution Retry with Delay

**Trinity:** `models.py` defines `max_retries: int = 0` and `retry_delay_seconds: int = 60` on every Schedule. `service.py` tracks `attempt_number` and `retry_of_execution_id`. When an agent execution returns a non-success status it automatically schedules a retry after the delay, up to `max_retries` times.

**SDLC-rstack:** Zero retry logic. If Agent 06 (architecture) fails, the pipeline stops. The user has to manually re-trigger it, lose the context, and hope the agent handles its own Context Recovery.

**What to copy:** Every agent's Completion Protocol already has `BLOCKED | NEEDS_CONTEXT`. Wire that exit status into a retry wrapper:

```bash
# agents/lib/retry-wrapper.sh
MAX_RETRIES=${MAX_RETRIES:-3}
RETRY_DELAY=${RETRY_DELAY:-30}
attempt=1
while [ $attempt -le $MAX_RETRIES ]; do
  STATUS=$(run_agent "$AGENT_FILE")
  if echo "$STATUS" | grep -q "^STATUS: DONE"; then break; fi
  if echo "$STATUS" | grep -q "^STATUS: BLOCKED"; then
    echo "Attempt $attempt/$MAX_RETRIES failed. Retrying in ${RETRY_DELAY}s..."
    sleep $RETRY_DELAY
    attempt=$((attempt + 1))
  else
    break  # NEEDS_CONTEXT = human decision needed, don't retry
  fi
done
```

---

### 1.3 — Distributed Locking for Parallel Runs

**Trinity:** `src/scheduler/locking.py` — Redis-backed distributed lock manager. Every schedule execution acquires `schedule_lock:{schedule_id}` before running. Prevents two parallel triggers from double-executing the same agent. Heartbeats every 30s confirm the lock holder is still alive; stale locks are reclaimed.

**SDLC-rstack:** No locking. Running `sdlc-parallel` from two terminals simultaneously will have agents write to the same artifact files at the same time, silently corrupting the pipeline state.

**What to copy:** File-based locking is sufficient for local use:

```bash
# agents/lib/lock.sh
LOCK_DIR="${RSTACK_RUN_DIR}/.locks"
mkdir -p "$LOCK_DIR"

acquire_lock() {
  local agent=$1
  local lockfile="$LOCK_DIR/${agent}.lock"
  if mkdir "$lockfile" 2>/dev/null; then
    echo $$ > "$lockfile/pid"
    return 0
  fi
  # Check if holder is still alive
  local pid=$(cat "$lockfile/pid" 2>/dev/null)
  if [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null; then
    rm -rf "$lockfile"
    acquire_lock "$agent"  # Retry after stale lock removal
    return $?
  fi
  return 1  # Locked by live process
}

release_lock() { rm -rf "$LOCK_DIR/${1}.lock"; }
```

---

### 1.4 — Post-Execution Validation (Maker/Checker Split)

**Trinity:** `models.py` defines `validation_enabled: bool`, `validation_prompt: Optional[str]`, and `validation_timeout_seconds: int` on every Schedule. After the primary agent finishes, a **separate validation task** runs with a custom auditor prompt. The validator's result is stored as `business_status` (pending_validation / validated / failed_validation). A different, often faster model grades the work.

This is exactly what Addy Osmani described: "The model that wrote the code is way too nice grading its own homework. A second agent with different instructions and sometimes a different model catches the stuff the first one talked itself into."

**SDLC-rstack:** Agent 11 (feedback-loop) does cross-contract consistency checking but only runs **once at the very end**. There's no per-stage validation. An architecture agent that produces a technically correct JSON but architecturally wrong design passes through with no check until stage 11.

**What to copy:** Add a validator stub after each critical stage (06-architecture, 07-code, 08-testing):

```markdown
---
name: 06a-architecture-validator
description: |
  Haiku-speed validator for 06-architecture output. Checks system_design.json
  for completeness before code generation begins. (sdlc-validator)
model: haiku
tools:
  - Read
---
Read $RSTACK_RUN_DIR/artifacts/architecture/system_design.json.

Grade on these criteria (yes/no for each):
1. Every FR-XXX from requirement_spec.json has at least one API endpoint or DB table
2. Tech stack decision includes the alternative considered and why it was rejected
3. Security controls section is non-empty
4. All external integrations have documented auth patterns

Output:
- VALIDATED: all 4 criteria pass → proceed to 07-code
- VALIDATION_FAILED: list which criteria failed → re-trigger 06-architecture with specific feedback
```

Using Haiku for validation is fast and cheap. The primary agent (Opus for architecture) does the heavy work; Haiku just reads and checks.

---

### 1.5 — Verifiable Goal Condition (`/goal` Pattern)

**Trinity / Claude Code:** `claude -p "/goal all tests pass and lint is clean"` runs until a condition is provably true. After every turn, a separate fast model checks whether the goal was met. Not the same model that did the work.

**SDLC-rstack:** No goal condition. The pipeline "completes" when Agent 11 finishes, but there's no automated check of whether the output actually meets the user's success criteria.

**What to copy:** A goal-checking wrapper for the full pipeline:

```bash
#!/bin/bash
# sdlc-goal: run pipeline until a verifiable condition holds
# Usage: sdlc-goal "consistency_score >= 90 AND no CRITICAL issues"

GOAL="$1"
MAX_ITERATIONS=${MAX_ITERATIONS:-5}
iteration=0

while [ $iteration -lt $MAX_ITERATIONS ]; do
  ./scripts/run-pipeline.sh
  
  # Check goal using a fast model
  SCORE=$(cat $RSTACK_RUN_DIR/artifacts/feedback/consistency_report.json | python3 -c "
import json,sys
d=json.load(sys.stdin)
score=d['summary']['overall_consistency_score']
critical=d['summary']['critical_count']
print('PASS' if score >= 90 and critical == 0 else f'FAIL score={score} critical={critical}')
")
  
  if echo "$SCORE" | grep -q "^PASS"; then
    echo "Goal achieved: $SCORE"
    break
  fi
  
  echo "Goal not yet met ($SCORE). Iteration $((iteration+1))/$MAX_ITERATIONS. Retrying failing stages..."
  iteration=$((iteration + 1))
done
```

---

### 1.6 — Pipeline State as Persistent Memory

**Trinity:** Agents publish `~/.trinity/pipelines/<id>.yaml` (definition) and `~/.trinity/pipeline-state/<id>/<instance>.json` (live state). Trinity exposes these via MCP tools. The state survives restarts; Trinity reads it to show pipeline progress in the UI.

**SDLC-rstack:** The `$RSTACK_RUN_DIR/artifacts/` directory holds artifact JSON, but there's no single pipeline state file that tracks which stages ran, which succeeded, which failed, and what the overall run metadata is. Context Recovery inside each agent is ad hoc — each agent individually checks for its own output.

**What to copy:** Add `pipeline-state.json` as the spine of every run:

```json
{
  "run_id": "run_20260615_143022",
  "started_at": "2026-06-15T14:30:22Z",
  "goal": "consistent, complete SDLC output for <project>",
  "stages": {
    "00-environment":  {"status": "DONE",   "completed_at": "2026-06-15T14:30:45Z", "duration_s": 23},
    "01-transcript":   {"status": "DONE",   "completed_at": "2026-06-15T14:32:10Z", "duration_s": 85},
    "02-requirements": {"status": "DONE",   "completed_at": "2026-06-15T14:36:44Z", "duration_s": 274},
    "06-architecture": {"status": "FAILED", "attempts": 2,  "last_error": "BLOCKED: missing DB schema"},
    "07-code":         {"status": "PENDING"},
    "11-feedback-loop":{"status": "PENDING"}
  },
  "consistency_score": null,
  "pipeline_status": "IN_PROGRESS"
}
```

Every agent writes its own status to this file on completion. The bootstrap reads it to decide what to skip.

---

### 1.7 — Cost and Context Tracking

**Trinity:** Every `ScheduleExecution` records `cost: Optional[float]`, `context_used: Optional[int]`, `context_max: Optional[int]`, `context_percent: float`, and `tool_calls_json`. This surfaces in the UI. Trinity alerts when context approaches limits (EXEC-023: `--resume` on session ID when context is full).

**SDLC-rstack:** No cost or context tracking. You don't know if Agent 06 (Opus) consumed 80% of its context window and is starting to hallucinate architecture decisions. You don't know the total cost of a full pipeline run.

**What to copy:** Each agent's Quality Self-Check already has the right instinct. Add a structured cost footer to every agent's Completion Protocol:

```markdown
## Cost Footer (append to every STATUS: DONE output)

METRICS:
  Context: ~{estimated_tokens} tokens / 200k max ({pct}%)
  Estimated cost: ~${usd}
  Tool calls: {n}
  Duration: {seconds}s

Write to pipeline-state.json:
  stages["XX-name"]["context_pct"] = {pct}
  stages["XX-name"]["cost_usd"] = {usd}
```

---

### 1.8 — Agent-Defined Pipeline Schema (`template.yaml` equivalent)

**Trinity:** Every agent ships a `template.yaml` defining its resource requirements, capabilities, and metadata. Trinity reads this to provision the Docker container correctly. It's the contract between the agent and the platform.

**SDLC-rstack:** Agent YAML frontmatter (`name`, `description`, `model`, `tools`, `color`, `owner`) is used by Claude Code but there's no machine-readable pipeline definition that an orchestrator can parse to build a DAG.

**What to copy:** Add a `pipeline.yaml` at the SDLC root:

```yaml
# pipeline.yaml — machine-readable SDLC pipeline definition
version: "2.0"
name: sdlc-rstack
stages:
  - id: "00-environment"
    agent: agents/sdlc/00-environment.md
    model: sonnet
    required: true
    max_retries: 1

  - id: "01-transcript"
    agent: agents/sdlc/01-transcript.md
    model: sonnet
    depends_on: ["00-environment"]
    max_retries: 2

  - id: "06-architecture"
    agent: agents/sdlc/06-architecture.md
    model: opus
    depends_on: ["05-jira"]
    max_retries: 2
    validator: agents/validators/06a-architecture-validator.md

  - id: "11-feedback-loop"
    agent: agents/sdlc/11-feedback-loop.md
    model: sonnet
    depends_on: ["10-summary"]
    goal_check: "summary.overall_consistency_score >= 90 AND summary.critical_count == 0"

goal: "pipeline_status == COMPLETE AND consistency_score >= 90"
max_pipeline_iterations: 3
```

This is the config that a future loop runner reads. You don't need Trinity's full platform to benefit from this — even a 50-line Python script can parse it and decide what to run next.

---

## Part 2: What SDLC-rstack Does Better Than Trinity

Be honest: these are genuine strengths to protect and not accidentally destroy when upgrading.

**Agent personas are much richer.** Every SDLC agent has a named voice, a career backstory explaining *why* they make the decisions they make, explicit stakes, and a before-starting reflection prompt. Trinity's internal dev skills are competent instructions; SDLC-rstack's agents are genuinely opinionated experts. Keep this.

**Standardized AskUserQuestion format.** Every agent follows the same 4-part structure (Re-ground / Simplify / Recommend / Options with effort estimates). Trinity has no equivalent cross-agent UX standard. Keep this.

**Completion Protocol taxonomy.** `DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT` is a brilliant 4-state protocol. Trinity agents just succeed or fail. This taxonomy maps cleanly onto retry logic: DONE = success, DONE_WITH_CONCERNS = success with warning, BLOCKED = retry, NEEDS_CONTEXT = human escalation. Lean into it.

**Operational self-improvement.** `rstack memory append` after every run is a genuine learning loop. Trinity has no equivalent. This is the SDLC-rstack superpower — agents that get smarter about your specific environment over time.

**Escalation rules.** "After 3 failed attempts at any detection step: STOP" is explicit and good. Trinity doesn't have per-agent escalation thresholds; it just retries up to max_retries and logs. Keep and extend the escalation rules.

**Quality self-check before DONE.** Each agent has a checklist it must verify before claiming DONE. This is better than Trinity's external validation because the agent itself can catch obvious self-errors before an external validator even runs.

---

## Part 3: Concrete Upgrade Roadmap

Priority order: high-impact, low-effort first.

### Sprint 1 — Pipeline State & Recovery (1 day)

**Task 1.1:** Create `agents/lib/pipeline-state.sh`
```bash
#!/bin/bash
# pipeline-state.sh — read/write helpers for pipeline-state.json

PIPELINE_STATE="${RSTACK_RUN_DIR}/pipeline-state.json"

stage_status() { python3 -c "import json,sys; d=json.load(open('$PIPELINE_STATE')); print(d['stages'].get('$1',{}).get('status','PENDING'))" 2>/dev/null || echo "PENDING"; }

mark_stage_done() {
  local stage=$1 duration=$2 cost=$3 context=$4
  python3 - <<EOF
import json,datetime
f='$PIPELINE_STATE'
d=json.load(open(f))
d['stages']['$stage']={'status':'DONE','completed_at':datetime.datetime.utcnow().isoformat()+'Z','duration_s':$duration,'cost_usd':$cost,'context_pct':$context}
json.dump(d,open(f,'w'),indent=2)
EOF
}

mark_stage_failed() {
  # similar, sets status=FAILED, increments attempts
}
```

**Task 1.2:** Add pipeline-state.json initialization to 00-environment.md:
- Check if file exists and `pipeline_status != COMPLETE`
- If exists: print which stages ran, ask user to resume or restart
- If new: initialize with all stages as PENDING

**Task 1.3:** Add to EVERY agent's Context Recovery section:
```bash
STAGE_STATUS=$(pipeline-state.sh stage_status "NN-agentname")
if [ "$STAGE_STATUS" = "DONE" ]; then
  echo "Stage already DONE. Skipping. Use --force to re-run."
  exit 0
fi
```

---

### Sprint 2 — Retry Wrapper + Validation (2 days)

**Task 2.1:** Create `agents/lib/retry-wrapper.sh` (see code in 1.2 above)

**Task 2.2:** Create `agents/validators/` directory with one validator per critical stage:
- `06a-architecture-validator.md` (Haiku model, checks system_design.json completeness)
- `07a-code-validator.md` (Haiku model, checks code_output.json for missing routes)
- `08a-testing-validator.md` (Haiku model, checks qa_results.json coverage %)

**Task 2.3:** Update `pipeline.yaml` to reference validators:
- After each primary agent completes, auto-trigger its validator
- Validator FAIL → primary agent re-runs with validator feedback appended as context
- Validator PASS → advance to next stage

**Task 2.4:** Add `validation_prompt` field to agent frontmatter:
```yaml
---
name: 06-architecture
validator: agents/validators/06a-architecture-validator.md
max_retries: 2
---
```

---

### Sprint 3 — Goal Checker + Loop Termination (1 day)

**Task 3.1:** Create `scripts/sdlc-goal.sh` (see code in 1.5 above)

**Task 3.2:** Add goal condition to `pipeline.yaml`:
```yaml
goal: "pipeline_status == COMPLETE AND consistency_score >= 90"
max_pipeline_iterations: 3
```

**Task 3.3:** Wire the feedback-loop agent (11) output directly into the goal check:
- After agent 11 runs, parse `consistency_report.json`
- If `critical_count > 0` AND `iteration < max_pipeline_iterations`:
  - Extract specific failed FRs/stages from remediation plan
  - Re-run only those specific agents with the failures as added context
  - Increment iteration counter
- If goal met: write `pipeline_status: COMPLETE` to pipeline-state.json

This turns the pipeline from a linear one-shot into a genuine loop that retries until it's actually good.

---

### Sprint 4 — Cost Tracking + Observability (1 day)

**Task 4.1:** Add cost footer template to `agents/OPERATING-STANDARD.md`:
- Every agent appends estimated cost/context to pipeline-state.json at completion
- Running total displayed in 10-summary output

**Task 4.2:** Add a `scripts/pipeline-status.sh` command:
```bash
$ ./scripts/pipeline-status.sh
SDLC Pipeline: run_20260615_143022
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✓ 00-environment   23s    $0.02   ctx: 8%
✓ 01-transcript    85s    $0.18   ctx: 22%
✓ 02-requirements 274s   $0.89   ctx: 67%
✗ 06-architecture  FAILED (attempt 1/2)
  07-code          PENDING
  08-testing       PENDING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Total so far: $1.09 | Consistency: —
```

**Task 4.3:** Add context warning to 06-architecture.md and 07-code.md:
```bash
# Check context usage before starting heavy work
CONTEXT_PCT=$(estimate_context_pct)
if [ "$CONTEXT_PCT" -gt 70 ]; then
  echo "WARNING: Context at ${CONTEXT_PCT}%. Consider compacting before proceeding."
  # Log to pipeline-state.json
fi
```

---

### Sprint 5 — File-Based Locking for Parallel Mode (0.5 days)

**Task 5.1:** Create `agents/lib/lock.sh` (see code in 1.3 above)

**Task 5.2:** Update `sdlc-parallel` to acquire locks before spawning agents:
```bash
# Only agents with no shared artifact dependencies can run in parallel
# Acquire locks per output artifact, not per agent
acquire_lock "artifacts/requirements" || wait_for_lock "artifacts/requirements"
```

**Task 5.3:** Add worktree isolation for code agent (07-code):
```bash
# 07-code runs in an isolated git worktree
git worktree add .rstack/worktrees/code-$(date +%s) HEAD
cd .rstack/worktrees/code-$(date +%s)
# run code agent here
# merge back on success
```

---

## Part 4: The Three Things NOT to Copy from Trinity

**1. Docker container per agent.** Trinity needs this because it runs real autonomous agents continuously in production. SDLC-rstack runs one pipeline at a time per user. Docker overhead is not worth it.

**2. Redis distributed locking.** Overkill for local use. File-based locking (Sprint 4 above) handles the parallel mode edge cases at zero infrastructure cost.

**3. Agent-defined pipeline publishing to `~/.trinity/`.** Trinity needs this because a fleet of agents coordinate across a shared platform. SDLC-rstack's `pipeline-state.json` in the run directory serves the same purpose without requiring a platform.

The principle: copy the *pattern*, not the *implementation*. Trinity's retry pattern → bash retry wrapper. Trinity's distributed locking → file locking. Trinity's pipeline state → JSON file in run dir. Same loop engineering concepts, appropriate scale.

---

## Summary Table

| Gap | Trinity Pattern | SDLC-rstack Fix | Sprint |
|-----|----------------|-----------------|--------|
| No pipeline state | `~/.trinity/pipeline-state/<id>.json` | `pipeline-state.json` per run | 1 |
| No restart recovery | `fire_missed_schedules()` on startup | Check stage status in bootstrap | 1 |
| No retry on failure | `max_retries`, `retry_delay_seconds` | `retry-wrapper.sh` | 2 |
| No maker/checker split | `VALIDATE-001` — separate Haiku validator | `validators/` dir, Haiku model | 2 |
| No goal condition | `/goal` — Haiku grades after each turn | `sdlc-goal.sh` + goal in pipeline.yaml | 3 |
| No loop termination | max_retries + execution status | `max_pipeline_iterations` + goal check | 3 |
| No cost tracking | `cost`, `context_used` on execution | Cost footer in OPERATING-STANDARD | 4 |
| No parallel safety | Redis distributed locks | File-based `lock.sh` | 5 |
| No pipeline schema | `template.yaml` per agent | `pipeline.yaml` at root | 1 |

---

## The One-Line Summary

Trinity turns a one-shot pipeline into a loop by adding: **state** (what ran), **goals** (what done means), **retries** (what to do on failure), **validation** (a second model that grades the first), and **cost awareness** (so the loop doesn't run forever). None of these require Trinity's full platform. All five can be implemented in SDLC-rstack as bash scripts and markdown additions in under a week.
