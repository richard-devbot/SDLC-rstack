<!-- owner: RStack developed by Richardson Gunde -->

# Brownfield Adoption — I Have an Existing App, Where Do I Start?

Greenfield runs start from a goal. Your codebase started years ago — it already has requirements
(in the docs), an architecture (in the code), tests, and a deploy pipeline. Adoption harvests that
reality into a pipeline run so RStack governs your *next* change instead of pretending the first
fifteen stages never happened.

## The 3 commands

```bash
cd your-existing-project
npm install rstack-agents && npx rstack-agents init   # once, never overwrites
npx rstack-agents adopt --dry-run                     # see the plan first
npx rstack-agents adopt --goal "Adopt billing-service"
```

`--dry-run` prints exactly what would be harvested per stage and writes **nothing**. The live run
creates one new run under `.rstack/runs/adopt-<timestamp>/` — existing runs and files are never
touched.

## What gets harvested (evidence or skip — never fabrication)

| Stage | Harvested from | If missing |
|---|---|---|
| 00-environment | Manifest files (package.json, go.mod, pyproject.toml, …) | Baseline report |
| 02-requirements | README + docs/ recorded as the requirements baseline | Skipped — surfaced as a gap |
| 03-documentation | Existing docs indexed | Skipped |
| 06-architecture | Tech stack from manifests + repo structure | Skipped |
| 07-code | The existing codebase IS the baseline | Skipped |
| 08-testing | Test dirs/configs/command — **detected, not executed**; the artifact says so | Skipped — a missing test suite is a finding, not a secret |
| 09-deployment | CI pipelines + Docker/IaC configs | Skipped |

Always skipped, with the reason stated in the plan: 01-transcript (no meeting produced your legacy
code), 04-planning / 05-jira / 14-cost (those belong to new work), 10-summary / 11-feedback (they
describe completed pipeline work), and **12-security / 13-compliance — governance posture must be
asserted deliberately by a human-reviewed run, never inferred**.

Every harvested stage is marked DONE-with-evidence: the stage artifact carries `source:
"brownfield-adoption"` plus pointers to the real files it came from, and each harvest lands in the
run's evidence ledger. The adoption also writes `artifacts/adoption_report.json` with the full plan
and any **specialist gaps** — stacks detected in your repo with no matching agent in the catalog.

## What happens next

```bash
npx rstack-agents pipeline status     # harvested stages PASS, the rest PENDING
```

The adopted baseline is *complete* — `pipeline run` will tell you so. Real work starts when you add
it: start a run with a concrete goal (`sdlc_start` / `sdlc_plan` from your framework, or the bridge
per the [quick-start](quick-start-guide.md)). Spec only the change you're making — the baseline
artifacts give every downstream agent the context of what already exists.

**Brownfield ground rules for agents working an adopted codebase** (put these in your project's
agent instructions): prefer the smallest possible fix; don't refactor adjacent code; respect
existing API contracts and behavior tests might not cover; stop and escalate rather than guess.

## Honest limits (current version)

- Requirements/architecture baselines are **pointers to your real files**, not synthesized specs —
  refine 06-architecture deliberately before large changes.
- The 08-testing baseline records that tests exist; run them yourself before trusting it.
- Adoption is per-project-root; monorepo sub-package adoption is not yet special-cased.
