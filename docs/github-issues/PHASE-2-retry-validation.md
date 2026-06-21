<!-- owner: RStack developed by Richardson Gunde -->

# [Epic] Phase 2 — Per-Agent Retry + Maker/Checker Validation

**Labels:** `epic`, `enhancement`, `loop-engineering`, `phase-2`  
**Milestone:** Loop Engineering v1

## Why this matters

SDLC-rstack has a robust 4-state Completion Protocol (`DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT`) but nothing acts on it programmatically. When an agent returns `BLOCKED`, the pipeline stops. There's also no second opinion on agent output — the architecture agent grades its own work, which means missed decisions ship downstream to code, testing, and deployment.

This phase wires the Completion Protocol into retry logic and adds a lightweight Haiku-powered validator after each critical stage.

---

## Issues in this Epic

### Issue 2.1 — Add `agents/lib/retry-wrapper.sh`

**Labels:** `enhancement`, `phase-2`, `infra`

**Problem:** No retry logic. `BLOCKED` from any agent terminates the pipeline. Users must manually re-trigger.

**Proposed implementation:**

Create `agents/lib/retry-wrapper.sh`:

```bash
#!/usr/bin/env bash
# retry-wrapper.sh — reads agent exit status from pipeline-state.json
# and re-triggers up to MAX_RETRIES times on BLOCKED.
# NEEDS_CONTEXT exits immediately (human decision required).
# Usage: ./agents/lib/retry-wrapper.sh <agent-id> <agent-file>

set -euo pipefail
source agents/lib/pipeline-state.sh

AGENT_ID="$1"
AGENT_FILE="$2"
MAX_RETRIES="${MAX_RETRIES:-$(python3 -c "
import yaml,sys
d=yaml.safe_load(open('pipeline.yaml'))
for s in d['stages'] + d.get('optional_stages',[]):
    if s['id'] == '$AGENT_ID':
        print(s.get('max_retries', 1))
        sys.exit(0)
print(1)
")}"
RETRY_DELAY="${RETRY_DELAY:-30}"

attempt=1
while [ "$attempt" -le "$MAX_RETRIES" ]; do
  mark_stage_in_progress "$AGENT_ID"
  
  # Run agent; capture last STATUS: line from its output
  AGENT_OUTPUT=$(claude -p "$AGENT_FILE" 2>&1)
  EXIT_STATUS=$(echo "$AGENT_OUTPUT" | grep -oP 'STATUS: \K(DONE|DONE_WITH_CONCERNS|BLOCKED|NEEDS_CONTEXT)' | tail -1 || echo "UNKNOWN")
  
  case "$EXIT_STATUS" in
    DONE|DONE_WITH_CONCERNS)
      mark_stage_done "$AGENT_ID" 0 0 0
      echo "[$AGENT_ID] Completed with status: $EXIT_STATUS"
      exit 0
      ;;
    NEEDS_CONTEXT)
      mark_stage_failed "$AGENT_ID" "NEEDS_CONTEXT — human input required" "$attempt"
      echo "[$AGENT_ID] Human input required. Pipeline paused."
      exit 2
      ;;
    BLOCKED)
      mark_stage_failed "$AGENT_ID" "BLOCKED on attempt $attempt" "$attempt"
      if [ "$attempt" -lt "$MAX_RETRIES" ]; then
        echo "[$AGENT_ID] Attempt $attempt/$MAX_RETRIES failed (BLOCKED). Retrying in ${RETRY_DELAY}s..."
        sleep "$RETRY_DELAY"
        attempt=$((attempt + 1))
      else
        echo "[$AGENT_ID] All $MAX_RETRIES attempts exhausted. Escalating."
        exit 1
      fi
      ;;
    *)
      mark_stage_failed "$AGENT_ID" "Unknown exit status: $EXIT_STATUS" "$attempt"
      echo "[$AGENT_ID] Unrecognized status '$EXIT_STATUS'. Treating as failure."
      exit 1
      ;;
  esac
done
```

**Acceptance criteria:**
- [ ] `agents/lib/retry-wrapper.sh` created and executable
- [ ] Reads `max_retries` from `pipeline.yaml` for the given agent ID
- [ ] `DONE` and `DONE_WITH_CONCERNS` both mark stage as done and exit 0
- [ ] `BLOCKED` retries up to `max_retries` times with `RETRY_DELAY` sleep
- [ ] `NEEDS_CONTEXT` exits immediately with code 2 (not retried)
- [ ] Updates `pipeline-state.json` on each attempt via `pipeline-state.sh`
- [ ] Test added in `tests/retry-wrapper.test.js`
- [ ] `npm test` passes

---

### Issue 2.2 — Create `agents/validators/` directory with 3 stage validators

**Labels:** `enhancement`, `phase-2`, `agent-new`

**Problem:** The same model that produces architecture, code, and tests also evaluates whether they're complete. Self-grading agents miss systematic gaps — requirements silently dropped, endpoints defined but never generated, test coverage numbers inflated.

**Proposed implementation:**

Create `agents/validators/` directory with three validator agents, each using the `haiku` model for speed and cost efficiency:

**`agents/validators/06a-architecture-validator.md`**
- Model: `haiku`
- Reads: `$RSTACK_RUN_DIR/artifacts/architecture/system_design.json` + `$RSTACK_RUN_DIR/artifacts/requirements/requirement_spec.json`
- Checks:
  1. Every `FR-XXX` has at least one API endpoint or DB table
  2. Tech stack decision includes alternatives rejected and why
  3. Security controls section is non-empty
  4. All external integrations have documented auth patterns
  5. No `"TODO"` or `"TBD"` strings in the JSON values
- Output: `VALIDATED` (all pass) or `VALIDATION_FAILED: <list of criteria that failed>`
- On `VALIDATION_FAILED`: writes failure reasons to `$RSTACK_RUN_DIR/artifacts/architecture/validation_failures.json` for the retry to consume as added context

**`agents/validators/07a-code-validator.md`**
- Model: `haiku`
- Reads: `$RSTACK_RUN_DIR/artifacts/code/code_output.json` + `system_design.json`
- Checks:
  1. Every API endpoint in `system_design.json` has a corresponding route in `code_output.json`
  2. Every DB table has a corresponding migration file reference
  3. Auth middleware referenced in architecture appears in generated code
  4. No routes with empty handler bodies (placeholder functions)
- Output: `VALIDATED` or `VALIDATION_FAILED: <criteria>`

**`agents/validators/08a-testing-validator.md`**
- Model: `haiku`
- Reads: `$RSTACK_RUN_DIR/artifacts/qa/qa_results.json` + `requirement_spec.json`
- Checks:
  1. Test coverage % ≥ 70 (as stated in qa_results)
  2. Every `FR-XXX` has at least one test case ID
  3. Security test cases exist (auth, input validation)
  4. No test cases with `"status": "TODO"`
- Output: `VALIDATED` or `VALIDATION_FAILED: <criteria>`

Each validator frontmatter:
```yaml
---
name: 06a-architecture-validator
description: |
  Post-stage validator for 06-architecture output. Haiku-speed check that
  system_design.json is complete before code generation begins. (sdlc-validator)
model: haiku
tools:
  - Read
  - Bash
color: yellow
owner: RStack developed by Richardson Gunde
---
```

**Acceptance criteria:**
- [ ] All 3 validator agents created in `agents/validators/`
- [ ] Each uses `model: haiku` (cheap, fast — not for heavy reasoning)
- [ ] Each produces exactly `VALIDATED` or `VALIDATION_FAILED: <reasons>` as its final line
- [ ] `npm run validate` passes on all 3 new agent files (frontmatter valid)
- [ ] `npm test` passes
- [ ] `agents/validators/` added to `package.json` `files` array so validators are published

---

### Issue 2.3 — Wire validators into `pipeline.yaml` and retry wrapper

**Labels:** `enhancement`, `phase-2`, `infra`

**Problem:** Validators exist but nothing calls them. Retry wrapper doesn't know to run the validator after the primary agent succeeds.

**Proposed implementation:**

Update `agents/lib/retry-wrapper.sh` to check for a `validator` field in `pipeline.yaml`:

```bash
# After primary agent returns DONE / DONE_WITH_CONCERNS:
VALIDATOR=$(python3 -c "
import yaml
d=yaml.safe_load(open('pipeline.yaml'))
for s in d['stages']:
    if s['id'] == '$AGENT_ID':
        print(s.get('validator',''))
        break
")

if [ -n "$VALIDATOR" ]; then
  echo "[$AGENT_ID] Running validator: $VALIDATOR"
  VAL_OUTPUT=$(claude -p "$VALIDATOR" 2>&1)
  if echo "$VAL_OUTPUT" | grep -q "^VALIDATED"; then
    echo "[$AGENT_ID] Validator passed."
    mark_stage_done "$AGENT_ID" ...
    exit 0
  else
    # Validation failed — feed failures back into next retry as context
    FAILURES=$(echo "$VAL_OUTPUT" | grep "^VALIDATION_FAILED")
    echo "[$AGENT_ID] Validator failed: $FAILURES"
    echo "Retry $attempt will include validation feedback..."
    # The retry will re-run the primary agent; the validation_failures.json
    # written by the validator gives the primary agent specific fix targets
    attempt=$((attempt + 1))
    continue
  fi
fi
```

**Acceptance criteria:**
- [ ] When validator returns `VALIDATION_FAILED`, primary agent is re-triggered (up to `max_retries`)
- [ ] Validation failures from `validation_failures.json` appear in the retry context
- [ ] When validator returns `VALIDATED`, stage is marked DONE in `pipeline-state.json`
- [ ] If primary agent succeeds but validator fails on final attempt: stage marked `DONE_WITH_CONCERNS` in pipeline-state, warning printed
- [ ] `npm test` passes

---

### Issue 2.4 — Add validation status to `pipeline-state.json` schema

**Labels:** `enhancement`, `phase-2`, `infra`

**Problem:** `pipeline-state.json` has no field to track whether a stage passed validation or skipped it.

**Proposed implementation:**

Extend stage record in `pipeline-state.json`:
```json
{
  "status": "DONE",
  "validation_status": "VALIDATED | VALIDATION_FAILED | SKIPPED | PENDING",
  "validation_failures": [],
  "validation_attempts": 1
}
```

Update `mark_stage_done()` in `pipeline-state.sh` to accept and write `validation_status`.

**Acceptance criteria:**
- [ ] `pipeline-state.sh mark_stage_done` accepts `validation_status` param
- [ ] `pipeline-status.sh` displays validation status alongside stage status
- [ ] Existing tests updated to cover new field
- [ ] `npm test` passes

---

## Definition of Done for Phase 2

- [ ] All 4 issues merged to `main` with no merge conflicts
- [ ] `agents/validators/` contains 3 working validator agents
- [ ] `retry-wrapper.sh` correctly retries on BLOCKED and feeds validator failures as context
- [ ] `npm test` passes on `main`
- [ ] `npm run validate` passes on `main`
- [ ] `agents/validators/` included in `package.json` `files` array

**Estimated effort:** 2 days  
**Copyright note:** The maker/checker pattern is a fundamental AI safety and quality assurance concept documented in numerous research papers and AI engineering blog posts. The validator agent prompt structure, the `VALIDATION_FAILED: <reasons>` output format, and the retry feedback loop are original to SDLC-rstack. No code was copied from any external project.
