<!-- owner: RStack developed by Richardson Gunde -->

# Loop Recipes

A loop is a **trigger** (manual | scheduled | action) plus a **goal** (verifiable | judge). RStack's
bounded goal loop (`rstack-agents pipeline loop`, see `docs/HARNESS.md` → "Goal loop") supplies the
governed engine; a recipe is just a goal definition JSON plus the trigger that starts it.

Each recipe below is tagged with its **Stephens Ch11 maintenance category** (perfective / adaptive /
corrective / preventive) — the same taxonomy agent 11-feedback-loop uses to classify post-delivery
work — so a loop run and the feedback artifact it consumes speak the same language.

## ⚠️ Loops are expensive — read this first

Every iteration re-runs real agents against real stages: tokens, tool calls, and wall-clock time,
multiplied by the iteration count. The loop engine brakes for you — **3 iterations by default, a
hard cap of 20 that no config can exceed, a no-progress stop, and the `.rstack/budget.json`
`run_budget_usd` cap** — but a recipe should still be scoped so that a *single* iteration is cheap:

- Prefer **verifiable criteria** (file exists, command exits 0, metric threshold) over judge
  criteria — they cost nothing to evaluate.
- Give every criterion `rerun_stages` so a RETRY resets only the stages that matter, never the
  whole pipeline.
- Set `run_budget_usd` in `.rstack/budget.json` before scheduling any unattended loop. An
  unattended loop without a cost cap is a bug, not a recipe.
- Start with `--dry-run`: it evaluates the goal, prints the decision, and persists nothing.

The harness never calls a model. Judge-kind criteria close through a `goal-verdict.json` written by
a host framework or a human between iterations; the loop stops (`ASK_USER`) until the verdict
exists.

---

## Recipe 1 — Overnight docs sweep

**Maintenance category: preventive/perfective** — keeping documentation aligned with shipped code
improves the product without changing behavior, and heads off future defect-inducing confusion.

- **Trigger:** scheduled — the host framework's cron/automation invokes the CLI nightly. RStack
  deliberately ships no scheduler; hosts own scheduling.
- **Goal:** verifiable — stage 03 artifacts exist and the docs check command passes.
- **Stages rerun on failure:** `03-documentation` only.

`docs-sweep.goal.json`:

```json
{
  "schema_version": 1,
  "goal_id": "docs-sweep",
  "description": "Documentation exists, builds, and matches the shipped code.",
  "min_score": 100,
  "criteria": [
    { "id": "docs-artifact", "kind": "file_exists", "run_relative": true,
      "path": "artifacts/stages/03-documentation/documentation.json",
      "rerun_stages": ["03-documentation"] },
    { "id": "docs-lint", "kind": "command", "command": "npm run docs:check",
      "expect_exit_code": 0, "timeout_ms": 180000,
      "rerun_stages": ["03-documentation"] }
  ]
}
```

Cron line (host-side; every night at 02:00, capped at 2 iterations):

```bash
0 2 * * * cd /path/to/project && npx rstack-agents pipeline loop \
  --goal docs-sweep.goal.json --max-iterations 2 --json >> .rstack/loop-cron.log 2>&1
```

Non-zero exit means the goal is unmet or a human gate was hit — page on it, don't retry harder.
Replace `npm run docs:check` with whatever the *project's* CLAUDE.md declares as its docs check —
recipes never hardcode framework commands.

---

## Recipe 2 — Production error sweep

**Maintenance category: corrective** — this IS the corrective-maintenance loop: real defects in,
fixes and regression evidence out, feeding stage 11 exactly as Stephens Ch11 prescribes.

- **Trigger:** action — fired when the error tracker crosses a threshold (webhook → CI job →
  `pipeline loop`), or manually after an incident.
- **Goal:** mixed — the test suite must pass (verifiable) and the feedback artifact must report no
  critical issues (metric threshold against agent 11's structured output).
- **Stages rerun on failure:** `07-code`, `08-testing`, then `11-feedback-loop` re-analyzes.

`error-sweep.goal.json`:

```json
{
  "schema_version": 1,
  "goal_id": "error-sweep",
  "description": "Reported production errors are fixed with regression evidence and no critical feedback issues remain.",
  "min_score": 100,
  "criteria": [
    { "id": "tests-green", "kind": "command", "command": "npm test",
      "expect_exit_code": 0, "rerun_stages": ["07-code", "08-testing"] },
    { "id": "no-criticals", "kind": "metric_threshold", "source": "feedback",
      "metric": "summary.critical_count", "operator": "==", "value": 0,
      "rerun_stages": ["11-feedback-loop"] }
  ]
}
```

If the feedback artifact is missing, the evaluator returns a clear non-pass that recommends
rerunning `11-feedback-loop` — it never guesses. Critical issues carrying a
`remediation.agent_to_rerun` map to a stage reset automatically; criticals with no remediation path
stop the loop as `BLOCK` for a human.

---

## Recipe 3 — Architecture satisfaction

**Maintenance category: preventive** — reviewing the design against requirements before more code
lands reduces future corrective work; nothing user-visible changes.

- **Trigger:** manual — run after `06-architecture` completes, or after requirements change.
- **Goal:** judge — "is this design satisfying?" is not machine-verifiable, so it closes through
  the model-free verdict protocol: the loop stops at `ASK_USER` until a host framework (running its
  own reviewer model) or a human writes `goal-verdict.json` into the run directory.
- **Stages rerun on a FAIL verdict:** whatever the verdict names, defaulting to `06-architecture`.

`arch-satisfaction.goal.json`:

```json
{
  "schema_version": 1,
  "goal_id": "arch-satisfaction",
  "description": "The system design satisfies the requirements and the reviewer signs off.",
  "criteria": [
    { "id": "design-artifact", "kind": "file_exists", "run_relative": true,
      "path": "artifacts/stages/06-architecture/system_design.json",
      "rerun_stages": ["06-architecture"] },
    { "id": "design-review", "kind": "judge",
      "question": "Does system_design.json cover every FR with an endpoint or table, name the rejected alternative for the stack choice, and include non-empty security controls?",
      "rerun_stages": ["06-architecture"] }
  ]
}
```

The reviewer answers by writing `.rstack/runs/<run_id>/goal-verdict.json`:

```json
{
  "criterion_id": "design-review",
  "verdict": "FAIL",
  "judge": "host-framework:reviewer",
  "reasoning": "FR-003 has no endpoint; security controls section is empty.",
  "recommended_rerun_stages": ["06-architecture"],
  "iteration": 1
}
```

Then run `pipeline loop` again: the harness consumes the verdict (a verdict whose `iteration` is
older than the current one is stale and ignored), resets the named stages, and re-evaluates after
the next pass. A verdict with `"recommendation": "block"` stops the loop for a human instead of
retrying. The judge's *reasoning* lives in the verdict file; the harness itself never calls a
model and never parses prose.

---

## Writing your own recipe

1. Pick the trigger (you, cron, CI) and the maintenance category — if you cannot name what kind of
   maintenance the loop performs, it probably should not loop.
2. Express the goal as criteria: prefer `file_exists` / `command` / `metric_threshold`; reach for
   `judge` only when a machine genuinely cannot verify it.
3. Put `rerun_stages` on every criterion; a RETRY with nothing to rerun stops as `no_progress`.
4. Cap it: `--max-iterations`, `.rstack/rstack.config.json` `loop.maxIterations`, and
   `.rstack/budget.json` `run_budget_usd`.
5. Dry-run first, then run attended once, then schedule.
