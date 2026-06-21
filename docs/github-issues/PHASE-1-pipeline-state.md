<!-- owner: RStack developed by Richardson Gunde -->

# [Epic] Phase 1 — Pipeline State & Restart Recovery

**Labels:** `epic`, `enhancement`, `loop-engineering`, `phase-1`  
**Milestone:** Loop Engineering v1

## Why this matters

Every SDLC-rstack run is stateless between sessions. If Claude Code context runs out at stage 06 (architecture), the only recovery is reading each agent's own Context Recovery section — manual, inconsistent, and fragile. There is no single source of truth for "what ran, what passed, what failed."

This phase adds `pipeline-state.json` as the authoritative run ledger and a bootstrap check so resumed sessions skip already-complete stages automatically.

---

## Issues in this Epic

### Issue 1.1 — Add `pipeline.yaml` — machine-readable pipeline definition

**Labels:** `enhancement`, `phase-1`, `infra`

**Problem:** There is no machine-readable definition of the SDLC pipeline. Each agent knows its own role but nothing knows the full DAG — which agents exist, what order they run, what their retry limits are, or which ones have validators.

**Proposed implementation:**

Create `/pipeline.yaml` at the repo root:

```yaml
version: "2.0"
name: sdlc-rstack
stages:
  - id: "00-environment"
    agent: agents/sdlc/00-environment.md
    model: sonnet
    required: true
    max_retries: 1
    timeout_minutes: 5

  - id: "01-transcript"
    agent: agents/sdlc/01-transcript.md
    model: sonnet
    depends_on: ["00-environment"]
    max_retries: 2
    timeout_minutes: 10

  - id: "02-requirements"
    agent: agents/sdlc/02-requirements.md
    model: sonnet
    depends_on: ["01-transcript"]
    max_retries: 2
    timeout_minutes: 15

  - id: "03-documentation"
    agent: agents/sdlc/03-documentation.md
    model: sonnet
    depends_on: ["02-requirements"]
    max_retries: 1
    timeout_minutes: 10

  - id: "04-planning"
    agent: agents/sdlc/04-planning.md
    model: sonnet
    depends_on: ["02-requirements"]
    max_retries: 1
    timeout_minutes: 10

  - id: "05-jira"
    agent: agents/sdlc/05-jira.md
    model: sonnet
    depends_on: ["04-planning"]
    max_retries: 2
    timeout_minutes: 15

  - id: "06-architecture"
    agent: agents/sdlc/06-architecture.md
    model: opus
    depends_on: ["05-jira"]
    max_retries: 2
    timeout_minutes: 30
    validator: agents/validators/06a-architecture-validator.md

  - id: "07-code"
    agent: agents/sdlc/07-code.md
    model: opus
    depends_on: ["06-architecture"]
    max_retries: 2
    timeout_minutes: 45
    validator: agents/validators/07a-code-validator.md

  - id: "08-testing"
    agent: agents/sdlc/08-testing.md
    model: sonnet
    depends_on: ["07-code"]
    max_retries: 2
    timeout_minutes: 20
    validator: agents/validators/08a-testing-validator.md

  - id: "09-deployment"
    agent: agents/sdlc/09-deployment.md
    model: sonnet
    depends_on: ["07-code", "08-testing"]
    max_retries: 1
    timeout_minutes: 20

  - id: "10-summary"
    agent: agents/sdlc/10-summary.md
    model: sonnet
    depends_on: ["09-deployment"]
    max_retries: 1
    timeout_minutes: 10

  - id: "11-feedback-loop"
    agent: agents/sdlc/11-feedback-loop.md
    model: sonnet
    depends_on: ["10-summary"]
    max_retries: 1
    timeout_minutes: 15
    goal_check: "summary.overall_consistency_score >= 90 AND summary.critical_count == 0"

optional_stages:
  - id: "12-security-threat-model"
    agent: agents/sdlc/12-security-threat-model.md
    model: opus
    depends_on: ["06-architecture"]
    max_retries: 1

  - id: "13-compliance-checker"
    agent: agents/sdlc/13-compliance-checker.md
    model: sonnet
    depends_on: ["07-code"]
    max_retries: 1

  - id: "14-cost-estimation"
    agent: agents/sdlc/14-cost-estimation.md
    model: sonnet
    depends_on: ["06-architecture"]
    max_retries: 1

goal: "pipeline_status == COMPLETE AND consistency_score >= 90"
max_pipeline_iterations: 3
```

**Acceptance criteria:**
- [ ] `pipeline.yaml` exists at repo root
- [ ] All 15 SDLC agents are listed with correct `depends_on` relationships
- [ ] `npm run validate` still passes (validator must not crash on new file)
- [ ] `npm test` passes
- [ ] File is valid YAML (no parse errors)

**Design notes:** Pattern concept from agent orchestration frameworks (DAG-based dependency tracking). All YAML content is original — no copied code.

---

### Issue 1.2 — Add `agents/lib/pipeline-state.sh` — run ledger helpers

**Labels:** `enhancement`, `phase-1`, `infra`

**Problem:** When a pipeline session restarts, each agent runs its own ad hoc check for its artifact (`ls $RSTACK_RUN_DIR/artifacts/system_design.json`). There is no unified state that the bootstrap or orchestrator can query.

**Proposed implementation:**

Create `agents/lib/pipeline-state.sh` with POSIX-compatible read/write helpers:

- `init_pipeline_state(run_id, goal)` — create `pipeline-state.json` if none exists
- `stage_status(stage_id)` — returns PENDING / IN_PROGRESS / DONE / FAILED / SKIPPED
- `mark_stage_in_progress(stage_id)` — updates status + timestamps attempts counter
- `mark_stage_done(stage_id, duration_s, cost_usd, context_pct)` — writes success record
- `mark_stage_failed(stage_id, error, attempts)` — increments attempt count
- `pipeline_summary()` — prints formatted status table to stdout

The `pipeline-state.json` schema:
```json
{
  "run_id": "run_YYYYMMDD_HHMMSS",
  "started_at": "ISO8601",
  "goal": "...",
  "pipeline_status": "IN_PROGRESS | COMPLETE | FAILED",
  "consistency_score": null,
  "stages": {
    "00-environment": {
      "status": "DONE",
      "started_at": "ISO8601",
      "completed_at": "ISO8601",
      "duration_s": 23,
      "attempts": 1,
      "cost_usd": 0.02,
      "context_pct": 8
    }
  }
}
```

**Acceptance criteria:**
- [ ] `agents/lib/pipeline-state.sh` created
- [ ] `init_pipeline_state` creates valid JSON on first call, is idempotent on subsequent calls
- [ ] `stage_status` returns correct value for each state
- [ ] `mark_stage_done` updates the JSON correctly (verified by a test in `tests/`)
- [ ] `pipeline_summary` outputs a readable table without crashing when stages are missing
- [ ] `npm test` passes (add a test case in `tests/pipeline-state.test.js`)

---

### Issue 1.3 — Update `00-environment.md` to initialize and resume from pipeline-state

**Labels:** `enhancement`, `phase-1`, `agent-update`

**Problem:** Agent 00 is the entry point but has no concept of a pipeline state file. On restart it always re-runs environment detection even if the pipeline was already in progress.

**Proposed implementation:**

Add to `00-environment.md` Context Recovery section:

```bash
# Check for existing pipeline state
PIPELINE_STATE="${RSTACK_RUN_DIR}/pipeline-state.json"
if [ -f "$PIPELINE_STATE" ]; then
  PIPELINE_STATUS=$(python3 -c "import json; d=json.load(open('$PIPELINE_STATE')); print(d.get('pipeline_status','UNKNOWN'))")
  echo "Existing pipeline found: $PIPELINE_STATUS"
  # List completed stages
  python3 -c "
import json
d=json.load(open('$PIPELINE_STATE'))
for k,v in d['stages'].items():
    if v['status'] == 'DONE':
        print(f'  ✓ {k} ({v[\"duration_s\"]}s)')
    elif v['status'] == 'FAILED':
        print(f'  ✗ {k} (attempts: {v[\"attempts\"]})')
"
fi
```

If `pipeline_status == COMPLETE`, ask the user whether to start a new run or inspect the completed one.
If `IN_PROGRESS`, list which stages are DONE and which are pending, and initialize only missing stages.

**Acceptance criteria:**
- [ ] `00-environment.md` calls `pipeline-state.sh init_pipeline_state` at start
- [ ] On restart with existing `pipeline-state.json`, it prints completed stages and asks to resume or restart
- [ ] `npm run validate` passes (frontmatter unchanged)
- [ ] `npm test` passes

---

### Issue 1.4 — Add `scripts/pipeline-status.sh` — status display command

**Labels:** `enhancement`, `phase-1`, `dx`

**Problem:** No way to check pipeline progress without opening individual artifact files.

**Proposed implementation:**

Create `scripts/pipeline-status.sh`:

```
$ ./scripts/pipeline-status.sh
SDLC Pipeline: run_20260615_143022
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✓ 00-environment    23s    $0.02   ctx:  8%
✓ 01-transcript     85s    $0.18   ctx: 22%
✓ 02-requirements  274s    $0.89   ctx: 67%
⟳ 06-architecture   IN_PROGRESS (attempt 1/2)
  07-code           PENDING
  08-testing        PENDING
  11-feedback-loop  PENDING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Total cost so far: $1.09 | Consistency: —
```

**Acceptance criteria:**
- [ ] Script exists and is executable (`chmod +x`)
- [ ] Reads from `$RSTACK_RUN_DIR/pipeline-state.json`
- [ ] Shows all 15 stages with status, duration, cost (if available), and context%
- [ ] Exits 0 if pipeline is healthy, exits 1 if any FAILED stages
- [ ] `npm test` passes

---

## Definition of Done for Phase 1

- [ ] All 4 issues above merged to `main` with no merge conflicts
- [ ] `npm test` passes on `main`
- [ ] `npm run validate` passes on `main`
- [ ] `pipeline.yaml` committed and readable
- [ ] `agents/lib/pipeline-state.sh` committed and tested
- [ ] Zero ESLint errors introduced

**Estimated effort:** 1 day  
**Copyright note:** All code is original to SDLC-rstack. The `pipeline-state.json` schema and helper pattern is a common agentic systems concept (equivalent patterns exist in CI/CD systems like CircleCI's workflow state, GitHub Actions' job context, etc.). No code from any external project was copied.
