<!-- owner: RStack developed by Richardson Gunde -->

# [Epic] Phase 3 — Goal Condition + True Pipeline Loop

**Labels:** `epic`, `enhancement`, `loop-engineering`, `phase-3`  
**Milestone:** Loop Engineering v1

## Why this matters

SDLC-rstack's pipeline runs linearly: 00 → 01 → ... → 11. Agent 11 (feedback-loop) finds CRITICAL issues, produces a remediation plan, and stops. The user must manually decide whether to accept the gaps or re-run specific agents.

A goal-conditioned loop changes this: after Agent 11 runs, the pipeline checks whether the goal (`consistency_score >= 90 AND critical_count == 0`) is met. If not, it automatically re-triggers only the specific failing agents with the remediation context attached — and loops until the goal is met or `max_pipeline_iterations` is reached.

This is the core loop engineering upgrade: turning a one-shot pipeline into a self-correcting feedback loop.

---

## Issues in this Epic

### Issue 3.1 — Add `scripts/sdlc-goal.sh` — goal evaluation and loop runner

**Labels:** `enhancement`, `phase-3`, `infra`

**Problem:** No programmatic pipeline goal. "Done" currently means Agent 11 ran. It should mean "the pipeline output meets a machine-verifiable quality threshold."

**Proposed implementation:**

Create `scripts/sdlc-goal.sh`:

```bash
#!/usr/bin/env bash
# sdlc-goal.sh — run pipeline until goal condition is met
# Reads goal from pipeline.yaml. Evaluates after each full pass.
# Usage: ./scripts/sdlc-goal.sh [--max-iterations N]

set -euo pipefail
source agents/lib/pipeline-state.sh

GOAL=$(python3 -c "import yaml; print(yaml.safe_load(open('pipeline.yaml'))['goal'])")
MAX_ITER=$(python3 -c "import yaml; print(yaml.safe_load(open('pipeline.yaml')).get('max_pipeline_iterations', 3))")

iteration=1
while [ "$iteration" -le "$MAX_ITER" ]; do
  echo ""
  echo "━━━ Pipeline iteration $iteration/$MAX_ITER ━━━"
  
  # Run or resume the pipeline (skip DONE stages)
  ./scripts/run-pipeline.sh
  
  # Evaluate goal condition against feedback-loop output
  REPORT="$RSTACK_RUN_DIR/artifacts/feedback/consistency_report.json"
  if [ ! -f "$REPORT" ]; then
    echo "No consistency report found. Agent 11 may not have completed."
    break
  fi
  
  EVAL=$(python3 - <<'PYEOF'
import json, sys
d = json.load(open(sys.argv[1]))
score = d["summary"]["overall_consistency_score"]
critical = d["summary"]["critical_count"]
status = "PASS" if score >= 90 and critical == 0 else f"FAIL (score={score}, critical={critical})"
print(status)
# Also print which stages need re-run based on CRITICAL issues
if critical > 0:
    affected = set()
    for issue in d["issues"]:
        if issue["severity"] == "CRITICAL" and issue.get("remediation", {}).get("agent_to_rerun"):
            affected.add(issue["remediation"]["agent_to_rerun"])
    if affected:
        print("RERUN_AGENTS:" + ",".join(sorted(affected)))
PYEOF
  "$REPORT")
  
  if echo "$EVAL" | grep -q "^PASS"; then
    echo ""
    echo "Goal achieved on iteration $iteration: $GOAL"
    # Write final status to pipeline-state.json
    python3 -c "
import json
f = '$RSTACK_RUN_DIR/pipeline-state.json'
d = json.load(open(f))
d['pipeline_status'] = 'COMPLETE'
d['goal_achieved_on_iteration'] = $iteration
json.dump(d, open(f, 'w'), indent=2)
"
    exit 0
  fi
  
  echo "Goal not met: $(echo "$EVAL" | head -1)"
  
  # Extract which agents to re-run
  RERUN=$(echo "$EVAL" | grep "^RERUN_AGENTS:" | cut -d: -f2)
  if [ -n "$RERUN" ]; then
    echo "Re-running failing stages: $RERUN"
    # Reset those stages in pipeline-state.json
    python3 - <<PYEOF2
import json
f = '$RSTACK_RUN_DIR/pipeline-state.json'
d = json.load(open(f))
for agent in '$RERUN'.split(','):
    if agent in d['stages']:
        d['stages'][agent]['status'] = 'PENDING'
json.dump(d, open(f, 'w'), indent=2)
PYEOF2
  fi
  
  iteration=$((iteration + 1))
done

echo "Max iterations ($MAX_ITER) reached without achieving goal."
echo "Final score: see $REPORT"
exit 1
```

**Acceptance criteria:**
- [ ] `scripts/sdlc-goal.sh` created and executable
- [ ] Reads `goal` and `max_pipeline_iterations` from `pipeline.yaml`
- [ ] Evaluates `consistency_score >= 90 AND critical_count == 0` after each iteration
- [ ] On goal not met: resets failing agent stages in `pipeline-state.json` and re-runs
- [ ] On goal met: writes `pipeline_status: COMPLETE` and `goal_achieved_on_iteration`
- [ ] Exits 0 on success, exits 1 if max iterations reached
- [ ] Test added in `tests/sdlc-goal.test.js` (mock consistency_report.json)
- [ ] `npm test` passes

---

### Issue 3.2 — Add `scripts/run-pipeline.sh` — resume-aware pipeline runner

**Labels:** `enhancement`, `phase-3`, `infra`

**Problem:** There is no single `run-pipeline.sh` script. The pipeline is triggered through Claude Code agent invocations with no skip-if-done logic at the orchestration level.

**Proposed implementation:**

Create `scripts/run-pipeline.sh`:

```bash
#!/usr/bin/env bash
# run-pipeline.sh — executes stages from pipeline.yaml in dependency order.
# Reads pipeline-state.json and skips stages that are already DONE.
# Usage: ./scripts/run-pipeline.sh [--stage <stage_id>] [--force]

set -euo pipefail
source agents/lib/pipeline-state.sh

FORCE="${FORCE:-false}"
TARGET_STAGE="${1:-}"

# Topological sort of stages by depends_on
ORDERED_STAGES=$(python3 - <<'PYEOF'
import yaml, sys
d = yaml.safe_load(open('pipeline.yaml'))
stages = {s['id']: s for s in d['stages']}
# Simple topological sort
visited, order = set(), []
def visit(sid):
    if sid in visited: return
    visited.add(sid)
    for dep in stages.get(sid, {}).get('depends_on', []):
        visit(dep)
    order.append(sid)
for sid in stages:
    visit(sid)
print('\n'.join(order))
PYEOF
)

for STAGE_ID in $ORDERED_STAGES; do
  # Skip if target stage specified and not reached yet
  if [ -n "$TARGET_STAGE" ] && [ "$STAGE_ID" != "$TARGET_STAGE" ]; then
    continue
  fi
  
  STATUS=$(stage_status "$STAGE_ID")
  if [ "$STATUS" = "DONE" ] && [ "$FORCE" != "true" ]; then
    echo "[$STAGE_ID] Already DONE — skipping"
    continue
  fi
  
  AGENT_FILE=$(python3 -c "
import yaml
d=yaml.safe_load(open('pipeline.yaml'))
for s in d['stages']:
    if s['id'] == '$STAGE_ID':
        print(s['agent'])
        break
")
  
  echo "[$STAGE_ID] Running: $AGENT_FILE"
  ./agents/lib/retry-wrapper.sh "$STAGE_ID" "$AGENT_FILE"
  
  # Stop if goal was reached (target stage done)
  if [ -n "$TARGET_STAGE" ] && [ "$STAGE_ID" = "$TARGET_STAGE" ]; then
    break
  fi
done
```

**Acceptance criteria:**
- [ ] `scripts/run-pipeline.sh` created and executable
- [ ] Reads stage order from `pipeline.yaml` via topological sort
- [ ] Skips stages with status `DONE` in `pipeline-state.json` (unless `--force`)
- [ ] Calls `retry-wrapper.sh` for each stage
- [ ] `--stage <id>` flag runs only from that stage forward
- [ ] `npm test` passes

---

### Issue 3.3 — Update Agent 11 (feedback-loop) to write goal-check output

**Labels:** `enhancement`, `phase-3`, `agent-update`

**Problem:** Agent 11's `consistency_report.json` has the data needed for goal evaluation but doesn't explicitly write `goal_met: true/false` or list `agents_to_rerun`. The goal checker script has to reparse it.

**Proposed implementation:**

Add to Agent 11's output JSON contract (`consistency_report.json`):
```json
{
  "goal_evaluation": {
    "goal": "consistency_score >= 90 AND critical_count == 0",
    "goal_met": false,
    "current_score": 74,
    "threshold_score": 90,
    "critical_count": 3,
    "agents_to_rerun": ["06-architecture", "07-code"],
    "iteration_recommendation": "Re-run architecture and code agents with CRITICAL issue context attached"
  }
}
```

Update Agent 11's output task to populate `goal_evaluation` after computing the consistency score.

**Acceptance criteria:**
- [ ] `consistency_report.json` schema updated to include `goal_evaluation`
- [ ] Agent 11 populates `goal_met: true` when `score >= 90 AND critical_count == 0`
- [ ] `agents_to_rerun` contains only the agents whose artifacts have CRITICAL issues
- [ ] `npm run validate` passes
- [ ] `npm test` passes (update test fixture if needed)

---

### Issue 3.4 — Add `--goal` flag to `sdlc-start` command

**Labels:** `enhancement`, `phase-3`, `dx`

**Problem:** The goal loop is hidden in `scripts/sdlc-goal.sh`. It should be the default way to run the full pipeline.

**Proposed implementation:**

Update the SDLC plugin's start command to support:
```
sdlc-start --goal "consistency_score >= 90 AND critical_count == 0" --max-iterations 3
```

When `--goal` is passed, `sdlc-start` delegates to `scripts/sdlc-goal.sh` instead of a single linear pass.

Without `--goal`, behavior is unchanged (single pass, no loop).

**Acceptance criteria:**
- [ ] `sdlc-start --goal` triggers goal-conditioned loop
- [ ] `sdlc-start` without `--goal` is unchanged (no regression)
- [ ] Help text for `--goal` flag is clear and accurate
- [ ] `npm test` passes

---

## Definition of Done for Phase 3

- [ ] All 4 issues merged to `main` with no merge conflicts
- [ ] `scripts/sdlc-goal.sh` runs, evaluates goal, and loops correctly
- [ ] `scripts/run-pipeline.sh` respects `pipeline-state.json` and skips DONE stages
- [ ] Agent 11 produces `goal_evaluation` in `consistency_report.json`
- [ ] `npm test` passes on `main`
- [ ] `npm run validate` passes on `main`

**Estimated effort:** 1 day  
**Copyright note:** Goal-conditioned loop termination is a fundamental concept in control theory and reinforcement learning. The specific implementation — parsing `consistency_report.json`, resetting stage status in `pipeline-state.json`, and iterating — is original to SDLC-rstack. No code from any external project was copied or adapted.
