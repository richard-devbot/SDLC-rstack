# Unified Run Workspace (#280)

RStack developed by Richardson Gunde

## Outcome

Run Workspace is the single end-user surface for following one scoped run from goal to proof. It combines Summary, Work, Timeline, Artifacts, and Metrics without changing the run scope or forcing users to learn six implementation-oriented pages.

## Route

Canonical route: `#page=run-workspace&run=<opaque-scope-key>&section=<section>`.

Sections are `summary`, `work`, `timeline`, `artifacts`, and `metrics`. Missing/invalid sections fall back to Summary. Section changes use browser history; refresh, back, and forward retain the opaque run scope and section.

Legacy pages (`projects`, `workflow`, `run-analytics`, `studio`, `agent-work`, `run-report`) remain registered and directly reachable. They are removed from the primary Runs submenu only after parity assertions prove their data remains reachable in Run Workspace.

## Shared projection

`runWorkspace` is built in the dashboard state layer and contains:

- canonical run/project/worktree identity and availability;
- goal, manifest state, server readiness, focused stage proof, and pipeline next action;
- tasks with agent, validation, retry/risk/proof metadata;
- timeline and readable activity events;
- artifact index, recent evidence, stage reports, and safe source paths;
- duration, cost, tokens, per-stage drivers, checkpoint/retry history, and `metricsSource` provenance;
- explicit availability for every section.

The projection translates existing state only. It does not calculate readiness, estimate missing spend, infer proof completion, or bypass the protected `/api/artifact` and `/api/run-report` endpoints.

## Layout

The header is a persistent run passport: goal, state, canonical project/worktree, run ID, freshness, and next action. Beneath it, an accessible segmented control changes sections without losing scope.

- Summary: outcome, compact Proof Rail, current stage/task, next action.
- Work: task/agent cards, validation, retries, decisions, and risks.
- Timeline: ordered timezone-aware events with type filters.
- Artifacts: safe artifact/evidence cards with missing, denied, and unreadable states delegated to the existing preview.
- Metrics: duration, cost, tokens, provenance, per-stage drivers, and recovery history.

At 390px the passport stacks, section controls scroll within their own labeled region, Proof Rail is vertical, and core content never forces page-level horizontal scrolling.

## Truth and safety rules

- Missing or deleted run shows an unavailable state and a route back to Runs.
- Legacy/partial data names unavailable sections rather than rendering empty success.
- Artifact links use recorded paths and the existing authenticated safe preview.
- Metrics show `persisted`, `events-derived`, or `unavailable`; zero is shown only when it is a recorded value.
- Stale state remains visible but is labeled; no mutation is added by #280.
- State uses text/icons in addition to color and every section is keyboard reachable.

## Verification

Fixtures cover active, completed, blocked, failed, stale, legacy/partial, and deleted/unavailable runs. Tests cover route/history retention, old-page parity, source paths, artifact security regressions, keyboard semantics, and 390px layout. Full lint, typecheck, test, and validation gates apply.
