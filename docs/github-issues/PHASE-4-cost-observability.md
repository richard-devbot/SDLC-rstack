<!-- owner: RStack developed by Richardson Gunde -->

# [Epic] Phase 4 — Cost Tracking & Pipeline Observability

**Labels:** `epic`, `enhancement`, `loop-engineering`, `phase-4`  
**Milestone:** Loop Engineering v1

## Why this matters

When running a full SDLC pipeline with Opus agents at stages 06 and 07, costs can be significant. With the Phase 3 loop runner potentially running up to 3 iterations, a blind pipeline could easily run $30+ without the user knowing. Context windows at 80%+ degrade quality without warning.

This phase adds per-stage cost and context tracking, a running total in the status display, and context warnings in agents that use large models.

---

## Issues in this Epic

### Issue 4.1 — Add cost/context footer standard to `agents/OPERATING-STANDARD.md`

**Labels:** `enhancement`, `phase-4`, `documentation`

**Problem:** `agents/OPERATING-STANDARD.md` defines the Operating Standard all agents follow but has no guidance on reporting cost or context usage at completion.

**Proposed implementation:**

Add to `agents/OPERATING-STANDARD.md` a new section: **Cost and Context Footer**

```markdown
## Cost and Context Footer

Every agent MUST append the following block immediately before its Completion Protocol STATUS line:

\`\`\`
METRICS:
  Context: ~{estimated_tokens} tokens used / {model_limit}k max ({pct}%)
  Estimated cost: ~${usd} (model: {model_name})
  Tool calls: {n}
  Duration: {seconds}s
\`\`\`

Estimation guidance:
- Tokens: count words in your response × 1.3 for a rough token estimate
- Cost (Sonnet): ~$3/M input + $15/M output tokens
- Cost (Opus): ~$15/M input + $75/M output tokens
- Cost (Haiku): ~$0.25/M input + $1.25/M output tokens

The pipeline-state.sh helper reads this block from stdout and writes it to pipeline-state.json automatically.
Only skip if running as a quick one-shot standalone invocation (not inside a pipeline run).
```

**Acceptance criteria:**
- [ ] `agents/OPERATING-STANDARD.md` has new Cost and Context Footer section
- [ ] Footer format documented with estimation formulas for all 3 models
- [ ] `npm run validate` passes
- [ ] `npm test` passes

---

### Issue 4.2 — Parse cost footer in `pipeline-state.sh`

**Labels:** `enhancement`, `phase-4`, `infra`

**Problem:** Agents write the cost footer to stdout but nothing reads it. The pipeline-state has `cost_usd` and `context_pct` fields but they're never populated.

**Proposed implementation:**

Update `mark_stage_done()` in `agents/lib/pipeline-state.sh` to parse the METRICS block from agent stdout:

```bash
mark_stage_done() {
  local stage_id="$1"
  local agent_output="$2"  # full stdout of the agent run
  local duration_s="$3"
  
  # Parse METRICS block from agent output
  local context_pct cost_usd tool_calls
  context_pct=$(echo "$agent_output" | grep -oP 'Context:.*?\((\d+)%\)' | grep -oP '\d+(?=%)' | head -1 || echo "0")
  cost_usd=$(echo "$agent_output" | grep -oP 'Estimated cost: ~\$\K[0-9.]+' | head -1 || echo "0")
  tool_calls=$(echo "$agent_output" | grep -oP 'Tool calls: \K\d+' | head -1 || echo "0")
  
  python3 - <<PYEOF
import json, datetime
f = '$RSTACK_RUN_DIR/pipeline-state.json'
d = json.load(open(f))
d['stages']['$stage_id'].update({
    'status': 'DONE',
    'completed_at': datetime.datetime.utcnow().isoformat() + 'Z',
    'duration_s': $duration_s,
    'cost_usd': float('${cost_usd}'),
    'context_pct': int('${context_pct}'),
    'tool_calls': int('${tool_calls}')
})
json.dump(d, open(f, 'w'), indent=2)
PYEOF
}
```

Also add `get_total_cost()` function that sums `cost_usd` across all DONE stages.

**Acceptance criteria:**
- [ ] `mark_stage_done` parses METRICS block from agent stdout
- [ ] `cost_usd`, `context_pct`, `tool_calls` written to `pipeline-state.json`
- [ ] `get_total_cost()` returns sum of all stage costs
- [ ] `pipeline-status.sh` displays cost and context% per stage and running total
- [ ] `npm test` passes (update pipeline-state test to verify cost parsing)

---

### Issue 4.3 — Add context warning to Opus model agents (06, 07)

**Labels:** `enhancement`, `phase-4`, `agent-update`

**Problem:** Opus agents at stages 06 (architecture) and 07 (code) have 200k context windows but SDLC pipelines accumulate significant context from reading all upstream artifacts. At 70%+ context, the quality of Opus reasoning degrades.

**Proposed implementation:**

Add to `06-architecture.md` and `07-code.md`, in the **Workflow** section before Step 1:

```markdown
**Pre-flight: Check context headroom**
Before reading input artifacts, estimate current context usage:
- If you estimate you've consumed > 60% of your context window already:
  - Print: `CONTEXT WARNING: ~{pct}% context used before reading inputs.`
  - Log to pipeline-state: `mark_stage_context_warning "$STAGE_ID" "$pct"`
  - Continue (don't stop), but be more concise in your outputs
- If > 80%: include in your METRICS block and output `DONE_WITH_CONCERNS` instead of `DONE`
  - Reason: "High context usage may have impacted decision quality at this stage"
```

Also add to Quality Self-Check for both agents:
```
- Is context usage below 80%? If not, flag DONE_WITH_CONCERNS with context warning.
```

**Acceptance criteria:**
- [ ] `06-architecture.md` has context pre-flight check
- [ ] `07-code.md` has context pre-flight check
- [ ] Context warning appears in METRICS block when > 60%
- [ ] `DONE_WITH_CONCERNS` used when > 80% context
- [ ] `npm run validate` passes (frontmatter unchanged)
- [ ] `npm test` passes

---

### Issue 4.4 — Add `scripts/pipeline-cost-report.sh` — full cost summary

**Labels:** `enhancement`, `phase-4`, `dx`

**Problem:** No way to see the total cost of a pipeline run in a readable format.

**Proposed implementation:**

Create `scripts/pipeline-cost-report.sh`:

```
$ ./scripts/pipeline-cost-report.sh

SDLC-rstack Cost Report — run_20260615_143022
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Stage                  Model    Duration    Cost       Context
────────────────────────────────────────────────────────────
00-environment         sonnet   23s         $0.02       8%
01-transcript          sonnet   85s         $0.18      22%
02-requirements        sonnet  274s         $0.89      67%
03-documentation       sonnet  120s         $0.44      31%
04-planning            sonnet   95s         $0.36      28%
05-jira               sonnet  180s         $0.62      45%
06-architecture        opus    843s         $4.21      72%  ⚠
  06a-validator        haiku    12s         $0.01       3%
07-code                opus   1847s         $9.14      78%  ⚠
  07a-validator        haiku    18s         $0.01       4%
08-testing             sonnet  312s         $1.12      52%
  08a-validator        haiku    14s         $0.01       4%
09-deployment          sonnet  245s         $0.88      41%
10-summary             sonnet  178s         $0.64      38%
11-feedback-loop       sonnet  298s         $1.07      55%
────────────────────────────────────────────────────────────
TOTAL                          4,344s      $19.60
Pipeline iterations:   1
Goal achieved:         YES (score: 94/100)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠ = context > 70% — quality may be affected
```

**Acceptance criteria:**
- [ ] `scripts/pipeline-cost-report.sh` created and executable
- [ ] Reads all cost/context data from `pipeline-state.json`
- [ ] Shows per-stage and total cost, duration, context%
- [ ] Highlights stages with context > 70%
- [ ] Shows iteration count and whether goal was achieved
- [ ] `npm test` passes

---

## Definition of Done for Phase 4

- [ ] All 4 issues merged to `main` with no merge conflicts
- [ ] Cost footer documented in `OPERATING-STANDARD.md`
- [ ] Cost parsed and stored in `pipeline-state.json`
- [ ] Context warnings in Opus agents (06, 07)
- [ ] `pipeline-cost-report.sh` produces readable cost table
- [ ] `npm test` passes on `main`

**Estimated effort:** 1 day  
**Copyright note:** Cost estimation formulas are based on publicly available Anthropic pricing pages. Context window percentages are derived from Claude model specifications. All implementation code is original to SDLC-rstack.
