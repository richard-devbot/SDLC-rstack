<!-- owner: RStack developed by Richardson Gunde -->

# RStack Research Methodology

This methodology explains how RStack should be studied and written about. Its purpose is to keep the research paper credible: every productivity, governance, or reliability claim must trace to a source, an implementation artifact, or a measurable experiment.

## Research objective

Study whether RStack improves AI-assisted software delivery by converting ad-hoc agent coding into a governed lifecycle with:

1. front-loaded clarification and decisions,
2. explicit approval gates,
3. builder/validator contracts,
4. structured evidence,
5. budget visibility,
6. Business Hub observability,
7. traceability from requirement to release, and
8. future cross-harness review and attestations.

## Core research question

> Can a governed AI-SDLC operating layer improve the reliability, auditability, and practical productivity of AI coding agents on real software projects?

## Working hypothesis

RStack does not claim that AI coding alone makes development faster. The working hypothesis is narrower and more testable:

> AI-assisted delivery becomes more productive when agent work is constrained by a clear lifecycle, explicit approvals, typed handoffs, validation contracts, traceable evidence, and visible cost/risk signals.

## Scope of the current implementation

The current implementation is best understood as a **business-friendly operating layer** rather than a full formal SDLC standard.

Implemented today:

- single npm package: `rstack-agents`, currently `1.8.0`,
- framework detection and initialization for Pi, Claude Code, Operator, and custom harnesses,
- `.rstack/` state contract,
- three built-in profiles: `business-flex`, `lean-mvp`, `enterprise-webapp`,
- budget policy defaults and task-level budget envelope support,
- 15 canonical SDLC stages,
- builder and validator contracts,
- evidence JSONL support,
- approval queue and approval policy support,
- Business Hub dashboard reading real `.rstack` files,
- traceability, agent work, stage matrix, run analytics, approvals, alerts, Business Flex state,
- notification adapters,
- package validation and CI gates,
- Mintlify docs.

Not fully implemented yet:

- first-class Decision Queue and Definition-of-Ready gate,
- formal RStack Spec v1alpha1 schemas,
- cross-harness validator independence enforcement,
- signed attestation envelopes,
- full traceability drift detector,
- untrusted PR gate,
- RFC/ADR process,
- governance pack installer,
- native MCP/A2A server.

These gaps are now tracked in GitHub issues #70-#79.

## Evidence sources

### Primary sources

Use RStack repo artifacts as first-class evidence:

- `README.md` for product positioning,
- `package.json` for package, scripts, bins, and publish contract,
- `src/core/harness/*` for lifecycle, contracts, evidence, guardrails, and run state,
- `src/core/profiles.js` for profile and budget behavior,
- `src/core/tracker/*` for registry and approvals,
- `src/observability/dashboard/state/*` for Business Hub data model,
- `docs/mintlify/*` for public documentation,
- `tests/*.test.js` for verified behavior,
- GitHub issues #70-#79 for roadmap and design direction,
- GitHub PRs and release commits for development history.

### Prior-art sources

Use external references to locate RStack in the broader AI-SDLC landscape:

- Augment Code AI-SDLC reference architecture,
- `ai-sdlc-framework/ai-sdlc`,
- NIST AI RMF,
- NIST SSDF,
- OWASP LLM Top 10,
- SLSA, DSSE, Sigstore,
- DORA research,
- METR productivity study,
- Stack Overflow Developer Survey.

## Measurement model

RStack should measure productivity as a combination of speed, quality, governance, and rework reduction. Suggested metrics:

### Delivery flow metrics

- time from `sdlc_start` to approved plan,
- time from approved plan to first builder completion,
- time from builder completion to validator result,
- time from validation pass to release-readiness,
- number of blocked approval gates,
- number of human interventions per run.

### Quality and validation metrics

- builder contract pass/fail rate,
- validator contract pass/fail rate,
- retry recommendation frequency,
- test evidence count per task,
- risk count per task,
- ratio of tasks with validator PASS before completion,
- future cross-harness independence pass rate.

### Traceability metrics

- requirements with linked tasks,
- tasks with stage artifacts,
- completed tasks with builder contracts,
- completed tasks with validator contracts,
- evidence events per run,
- future drift findings per run.

### Governance metrics

- approvals requested,
- approvals granted/rejected,
- blocked destructive/release actions,
- budget warning and blocking events,
- policy overrides and waivers.

### Cost metrics

- estimated budget envelope per task,
- actual model/provider cost when available,
- cost variance by stage,
- cost per accepted task,
- cost per validator PASS.

## Study design options

### 1. Internal case study: RStack building RStack

Use the RStack repository as a case study.

Data:

- git commits,
- PRs,
- issues,
- CI results,
- `.rstack` run artifacts where available,
- tests and docs added per release,
- roadmap issues #70-#79.

Use this to describe how RStack evolved from package/catalog to governed business SDLC layer.

### 2. Comparative task study

Run equivalent software tasks under two conditions:

- baseline: agent uses ad-hoc prompts,
- RStack: agent uses RStack lifecycle and contracts.

Measure:

- elapsed time,
- number of follow-up corrections,
- tests added,
- validator findings,
- completeness of docs/evidence,
- human approval points,
- final acceptance rate.

### 3. Prior-art design comparison

Compare RStack to adjacent frameworks using dimensions:

- install simplicity,
- lifecycle structure,
- governance model,
- observability,
- typed handoffs,
- validation independence,
- attestations,
- traceability,
- compliance mapping,
- business-user usability.

## Claims discipline

No paper or documentation claim should be written as fact unless it has one of the following:

1. **Measured evidence** from RStack runs, tests, PRs, or CI.
2. **Source evidence** from standards, reports, or prior art.
3. **Implementation evidence** from code or docs.
4. **Hypothesis label** with a clear experiment plan.

### Allowed wording

- "RStack is designed to reduce ambiguity before agent execution."
- "The current implementation records builder and validator contracts."
- "Future work will test whether Decision Queue and DoR gates reduce rework."
- "METR's study cautions that AI coding tools do not automatically improve productivity on mature repositories."

### Avoid unless measured

- "RStack makes teams 10x faster."
- "RStack eliminates bugs."
- "RStack guarantees compliance."
- "Cross-harness review reduces failures by X%."

## Threats to validity

- RStack is developed by its founder; self-study can introduce confirmation bias.
- Early runs may not represent large enterprise codebases.
- Host frameworks differ in tool enforcement, cost reporting, and model behavior.
- Current cost metrics are estimated unless host/provider usage is reported.
- Validator read-only behavior depends partly on host sandbox enforcement today.
- Business Hub only shows artifacts that agents actually write.
- External prior-art comparisons may change as projects evolve.

## Reproducibility checklist

For every reported case study, capture:

- repo name and commit SHA,
- RStack package version,
- host framework,
- profile used,
- task goal,
- run ID,
- artifacts generated,
- approvals required,
- builder and validator contract status,
- tests run,
- evidence events,
- cost estimate/actual if available,
- final PR/commit/result.

## Immediate #77 output

Issue #77 should add the research folder and initial methodology artifacts. It should not claim final productivity results yet. It should prepare the repo for disciplined research and paper writing.