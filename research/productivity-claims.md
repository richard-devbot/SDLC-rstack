<!-- owner: RStack developed by Richardson Gunde -->

# RStack Productivity Claims Register

This register keeps RStack's research claims honest. It separates implemented facts, externally sourced claims, hypotheses, and future measurements.

## Claim categories

- **Implemented fact:** directly visible in RStack code, docs, tests, or package metadata.
- **External evidence:** supported by a cited study, standard, report, or prior-art project.
- **Hypothesis:** plausible but not yet measured in RStack experiments.
- **Future claim:** should not be stated publicly until a metric or study supports it.

## Implemented facts

| Claim | Status | Evidence |
|---|---|---|
| RStack provides a governed AI-SDLC lifecycle. | Implemented fact | `README.md`; `docs/mintlify/introduction.mdx`; lifecycle text. |
| RStack ships as one npm package. | Implemented fact | `package.json` name `rstack-agents`, version `1.8.0`. |
| RStack supports Pi, Claude Code, Operator, and custom harness setup paths. | Implemented fact | `src/integrations/init.js`; README Framework support table. |
| RStack creates `.rstack/` project state and run directories. | Implemented fact | `src/integrations/init.js`; `src/core/harness/run-state.js`. |
| RStack defines 15 canonical SDLC stages. | Implemented fact | `src/core/harness/stages.js`. |
| RStack has builder and validator contract validation helpers. | Implemented fact | `src/core/harness/contracts.js`; `tests/harness-contracts.test.js`. |
| RStack records evidence events in JSONL. | Implemented fact | `src/core/harness/evidence.js`; `tests/harness-evidence.test.js`. |
| RStack has profile-based routing/budget concepts. | Implemented fact | `src/core/profiles.js`; `tests/profiles.test.js`; Business Flex docs. |
| Business Hub reads real `.rstack` files instead of fake demo state. | Implemented fact | `src/observability/dashboard/state/*`; README Business Hub section. |
| RStack has approval queue and manager allowlist support. | Implemented fact | `src/core/tracker/approvals.js`; approval security tests. |

## Externally grounded claims

| Claim | Status | Evidence |
|---|---|---|
| AI coding tools do not automatically guarantee productivity gains on mature codebases. | External evidence | METR experienced OSS developer RCT (early-2025) + Feb-2026 follow-up: the early-2025 study measured a 19% *slowdown*; the 2026 follow-up with agentic tools found an effect statistically indistinguishable from zero (returning −18%, CI −38%…+9%). |
| Developers systematically misjudge their own AI speed-up (they felt ~20% faster while measured slower) — self-report is an unreliable productivity signal. | External evidence | METR early-2025 RCT + 2026 follow-up (the **perception gap** is the durable, tool-independent finding). |
| AI adoption is now positively associated with delivery *throughput* but remains negatively associated with delivery *stability*. | External evidence | DORA *State of DevOps Report 2025* (~5,000 respondents; correlational, not causal). This throughput-without-stability split is the failure mode a governed loop targets. |
| AI-SDLC platforms need agents, orchestration, observability, and governance layers. | External evidence | Augment Code AI-SDLC reference architecture. |
| Secure software development practices need explicit SDLC integration. | External evidence | NIST SSDF SP 800-218. |
| AI systems benefit from structured risk management and governance. | External evidence | NIST AI RMF; ISO/IEC 42001. |
| LLM applications introduce security risks requiring explicit controls. | External evidence | OWASP Top 10 for LLM Applications. |
| Provenance and attestation are established software supply-chain patterns. | External evidence | SLSA, DSSE, Sigstore. |

## Citation discipline (METR / DORA)

These rules are binding for the paper and any public claim:

- **Never cite the METR "19% slowdown" figure unqualified.** It is specific to the *early-2025* tools in the original RCT. Always pair it with the [Feb-2026 follow-up](https://metr.org/blog/2026-02-24-uplift-update/), whose newer-tool estimate is statistically indistinguishable from zero. Prefer the **perception gap** as the durable citation — it does not decay with tool generation.
- **Do not overclaim the null.** METR characterizes both estimates as likely lower bounds and flags the follow-up data as an unreliable signal (selection bias); it is redesigning the experiment. "No measured effect" must never be reported as "AI does not help."
- **Cite DORA 2025 as the delivery baseline**, not 2024 — the AI↔throughput relationship *reversed* between them. Keep DORA framed as **survey correlation, not causation** (no causal language).

## Hypotheses to test

| Hypothesis | Measurement plan | Current status |
|---|---|---|
| Front-loaded decisions reduce agent rework. | Compare tasks with/without Decision Queue; count retries, clarification interruptions, and validator failures. | Future: #70. |
| Builder/validator contracts improve handoff quality. | Track contract completeness and validator findings over repeated runs. | Partially measurable today. |
| Business Hub improves operator situational awareness. | Measure time to identify blocked runs, missing evidence, or pending approvals with/without dashboard. | Future study needed. |
| Cross-harness validation catches issues same-harness validation misses. | Run equivalent validation with same harness and cross harness; compare unique findings. | Future: #72. |
| Attestation envelopes improve audit readiness. | Count time/evidence needed to reconstruct run provenance before/after attestations. | Future: #73. |
| Drift detection improves long-run traceability. | Count stale references and missing evidence before/after drift gate. | Future: #74. |
| Profile-based governance reduces setup burden. | Compare setup steps and config changes for lean/business/enterprise scenarios. | Partially measurable today. |

## Claims not yet allowed

Do not state these as facts until measured:

- "RStack makes development 10x faster."
- "RStack eliminates bugs."
- "RStack guarantees compliance."
- "Cross-harness validation always improves quality."
- "RStack reduces costs by a fixed percentage."
- "RStack is enterprise-compliant out of the box."

## Paper-safe wording

Use careful language:

- RStack is **designed to** reduce ambiguity before agent execution.
- RStack **records** builder/validator/evidence artifacts that can support auditability.
- RStack **provides a structure for measuring** AI-assisted delivery outcomes.
- RStack's roadmap **adapts governance patterns** from prior-art AI-SDLC frameworks.
- Future experiments should test whether these controls reduce rework, failures, and operator intervention.

## Metrics to collect in future runs

- run count by profile,
- task count by stage,
- approvals requested/granted/rejected,
- builder PASS/FAIL/BLOCKED counts,
- validator PASS/FAIL counts,
- retry recommendations,
- evidence events per completed task,
- estimated vs actual cost,
- elapsed time by stage,
- drift findings,
- release-readiness blockers,
- PR review/CI failures after RStack validation.

## Current claim summary

The strongest current claim is:

> RStack implements a structured, observable AI-SDLC operating layer with profiles, approvals, builder/validator contracts, evidence, budgets, and a Business Hub.

The strongest future research claim to test is:

> That structure reduces ambiguity, rework, and missing evidence compared with ad-hoc AI coding workflows.