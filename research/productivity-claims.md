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
| AI coding tools do not automatically guarantee productivity gains on mature codebases; measured effects with 2025-era agentic tools are statistically indistinguishable from zero. | External evidence | METR early-2025 RCT (19% slowdown, early-2025 tools) plus METR Feb 2026 follow-up (−18% CI −38%…+9% returning; −4% CI −15%…+9% new). Cite both together; never the 19% alone. |
| Developers systematically misperceive AI's effect on their own productivity (forecast +24%, believed +20% while measured slower; >80% self-report gains). | External evidence | METR RCT perception gap; DORA 2025 self-report figures. This is the durable METR finding. |
| AI adoption is now positively related to delivery throughput but still negatively related to delivery stability. | External evidence | DORA 2025 (~5,000 respondents; correlational, not causal). |
| AI-SDLC platforms need agents, orchestration, observability, and governance layers. | External evidence | Augment Code AI-SDLC reference architecture. |
| Secure software development practices need explicit SDLC integration; NIST's SSDF line does not yet cover AI-assisted development of ordinary software. | External evidence | NIST SSDF SP 800-218; SP 800-218A (scope = developing AI models); draft SP 800-218r1. The gap claim is an inference — re-check before publication. |
| AI systems benefit from structured risk management and governance. | External evidence | NIST AI RMF; ISO/IEC 42001; NIST COSAIS (pre-publication). |
| LLM and agentic applications introduce security risks requiring explicit controls, including excessive agency and human-in-the-loop approval. | External evidence | OWASP Top 10 for LLM Applications (2025 edition); OWASP Top 10 for Agentic Applications for 2026 (ASI01–ASI10). |
| Provenance and attestation are established software supply-chain patterns, now extending to source authoring and review. | External evidence | SLSA v1.2 (incl. Source Track), DSSE, in-toto Attestation Framework, Sigstore. |
| Regulatory obligations for AI transparency and documentation are in force in the EU (GPAI since Aug 2025; Art. 50 transparency from Aug 2026), with high-risk system deadlines deferred to Dec 2027 / Aug 2028 by the Digital Omnibus. | External evidence | EU AI Act implementation timeline; Council/Parliament Digital Omnibus adoption (June 2026). |

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
- "AI tools slow developers down by 19%." (Superseded — scope to early-2025 tools and pair with the Feb 2026 follow-up.)
- "AI does not help developers." (METR characterizes its estimates as likely lower bounds; the supported claim is *no reliable measured effect*, plus the perception gap.)
- "Governance produces measured speedups." (Hypothesis — not yet measured in RStack experiments.)

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