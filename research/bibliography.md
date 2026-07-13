<!-- owner: RStack developed by Richardson Gunde -->

# RStack Research Bibliography

This bibliography records the sources used to ground the RStack SDLC research narrative. It separates standards, prior-art implementations, empirical productivity evidence, security references, and RStack primary-source artifacts so the paper can cite claims without reconstructing context later.

## Software engineering foundations

### Beginning Software Engineering (Stephens)
- **Reference:** Rod Stephens, *Beginning Software Engineering*, 2nd Edition. Wrox/Wiley, 2022. ISBN 978-1-119-90170-9.
- **Why it matters to RStack:** RStack's canonical SDLC grounding. The 15-stage pipeline's quality gates map directly to the book: requirements quality attributes and MoSCoW prioritization (Ch. 4) in 02-requirements, the five-level testing taxonomy and black/white/gray-box methods in 08-testing, deliberate cutover strategy in 09-deployment, defect analysis in 10-summary, the maintenance taxonomy (perfective/adaptive/corrective/preventive) in 11-feedback-loop, and the study-before-modify principle (Ch. 11) in the brownfield adopted-run contract.
- **RStack connection:** Cited throughout the stage agents; grounds the paper's claim that the pipeline encodes established software-engineering practice rather than ad-hoc agent prompts.

## Standards and governance references

### NIST AI Risk Management Framework
- **Reference:** National Institute of Standards and Technology, *AI Risk Management Framework*.
- **URL:** https://www.nist.gov/itl/ai-risk-management-framework
- **Why it matters to RStack:** RStack's governance model can map Business Hub observability, approvals, validation contracts, and future governance packs to AI risk management practices.
- **RStack connection:** Supports roadmap issues for governance packs, RStack Spec v1alpha1, cross-harness validation, and claims discipline.

### NIST SP 800-218 Secure Software Development Framework
- **Reference:** National Institute of Standards and Technology, *SP 800-218: Secure Software Development Framework (SSDF) Version 1.1*.
- **URL:** https://csrc.nist.gov/pubs/sp/800/218/final
- **Why it matters to RStack:** SSDF states that secure software practices must be added explicitly to SDLC models. RStack's value proposition is exactly this: make approvals, evidence, validator contracts, guardrails, and release readiness explicit in AI-assisted delivery.
- **RStack connection:** Supports evidence, validator contracts, untrusted PR gates, and release-readiness checks.

### ISO/IEC 42001:2023 AI management systems
- **Reference:** International Organization for Standardization, *ISO/IEC 42001:2023 — Information technology — Artificial intelligence — Management system*.
- **URL:** https://www.iso.org/standard/81230.html
- **Why it matters to RStack:** Gives enterprise context for treating AI-assisted development as a governed management system instead of ad-hoc tooling.
- **RStack connection:** Supports profile-based governance levels, enterprise-webapp profile, research claims, and future compliance mapping.

### EU AI Act overview
- **Reference:** EU Artificial Intelligence Act tracker and analysis site.
- **URL:** https://artificialintelligenceact.eu/
- **Why it matters to RStack:** Provides regulatory motivation for traceability, transparency, risk management, and documented oversight in AI workflows.
- **RStack connection:** Supports research-paper framing around governed AI software delivery.

## Secure supply-chain and attestation references

### SLSA Provenance
- **Reference:** Supply-chain Levels for Software Artifacts, *Provenance specification*.
- **URL:** https://slsa.dev/spec/v1.0/provenance
- **Why it matters to RStack:** RStack's future attestation envelope should record where, when, and how an agent-produced artifact was created and validated.
- **RStack connection:** Supports future `rstack-agents attest` and `verify-attestations` work.

### DSSE specification
- **Reference:** Secure Systems Lab, *DSSE: Dead Simple Signing Envelope*.
- **URL:** https://github.com/secure-systems-lab/dsse
- **Why it matters to RStack:** Provides an envelope pattern for signing structured payloads. RStack can adapt this pattern for builder, validator, and release-readiness evidence.
- **RStack connection:** Supports attestation roadmap and paper claims about tamper-evident evidence.

### Sigstore documentation
- **Reference:** Sigstore documentation.
- **URL:** https://docs.sigstore.dev/
- **Why it matters to RStack:** Provides a practical signing/provenance ecosystem that can inform enterprise-mode evidence verification.
- **RStack connection:** Supports optional signed attestation mode beyond local unsigned development mode.

## AI security references

### OWASP Top 10 for Large Language Model Applications
- **Reference:** OWASP Foundation, *Top 10 for Large Language Model Applications*.
- **URL:** https://owasp.org/www-project-top-10-for-large-language-model-applications/
- **Why it matters to RStack:** AI-assisted SDLC systems are exposed to prompt injection, insecure output handling, excessive agency, sensitive information disclosure, and supply-chain risks.
- **RStack connection:** Supports validator restrictions, untrusted PR gates, protected actions, and cross-harness review.

## AI-SDLC prior art

### Augment Code AI SDLC Framework reference architecture
- **Reference:** Augment Code, *AI SDLC Framework: A CTO Reference Architecture*.
- **URL:** https://www.augmentcode.com/guides/ai-sdlc-framework-reference-architecture
- **Verified page title during research:** `AI SDLC Framework: A CTO Reference Architecture | Augment Code`
- **Verified page description during research:** `See how a five-layer AI SDLC framework structures agents, orchestration, observability, and governance so CTOs can scale AI-assisted delivery.`
- **Why it matters to RStack:** Confirms the market pattern that AI-SDLC platforms need layered agents, orchestration, observability, and governance.
- **RStack connection:** RStack already implements a business-facing version through profiles, Business Hub, contracts, approvals, evidence, and adapters.

### ai-sdlc-framework/ai-sdlc
- **Reference:** `ai-sdlc-framework/ai-sdlc`, public GitHub repository.
- **URL:** https://github.com/ai-sdlc-framework/ai-sdlc
- **Observed repo description:** `Declarative governance framework for AI-augmented software development lifecycles`
- **Observed license:** Apache-2.0
- **Observed comparison snapshot:** 3,819 tracked files, strong formal spec/RFC/gate orientation, 38 workflow files, and extensive TypeScript implementation.
- **Why it matters to RStack:** Provides prior-art patterns worth adapting: Decision Engine, Definition-of-Ready gates, declarative resources, cross-harness review, attestations, drift detection, and untrusted PR gates.
- **RStack connection:** RStack should copy patterns, not exact code, preserving its simpler one-package Business Hub product direction.

## Productivity and delivery research

### METR experienced open-source developer productivity study (early-2025 RCT + 2026 follow-up)
- **Reference (original):** METR, *Measuring the Impact of Early-2025 AI on Experienced Open-Source Developer Productivity* (Jul 10, 2025).
- **URL:** https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/
- **Verified page description during research:** `We conduct a randomized controlled trial to understand how early-2025 AI tools affect the productivity of experienced open-source developers working on their own repositories. Surprisingly, we find that when developers use AI tools, they take 19% longer...` The page now carries an out-of-date banner pointing to the follow-up.
- **Reference (follow-up):** METR, *Uplift update* (Feb 24, 2026) — https://metr.org/blog/2026-02-24-uplift-update/. With newer agentic tools (Claude Code / Codex era) the measured effect is **statistically indistinguishable from zero**: returning developers −18% (95% CI −38%…+9%), newly-recruited −4% (CI −15%…+9%). METR flags the data as an unreliable signal (selection bias) and is redesigning the experiment; it characterizes both estimates as likely lower bounds.
- **Scope discipline:** the **19% slowdown figure is specific to the early-2025 tools in the original RCT** and must never be cited unqualified — always pair it with the 2026 update. The durable, tool-independent finding is the **perception gap**: developers believed AI made them ~20% faster while the measurement showed them slower. "No measured effect" must not be reported as "AI does not help."
- **Why it matters to RStack:** Caution against assuming AI coding tools automatically improve productivity in mature codebases, and direct evidence that self-reported speed is unreliable — RStack's claim is that governance and structure reduce ambiguity and rework and make delivery *measurable*, not that AI alone guarantees speed.
- **RStack connection:** Supports the paper problem statement and claims discipline (the perception gap motivates observable, evidence-backed state over self-report).

### Google DORA reports (2025 baseline; 2024 for the reversal)
- **Reference (current baseline):** Google Cloud DORA, *State of DevOps Report 2025* (Sept 2025, ~5,000 respondents).
- **URL:** https://dora.dev/dora-report-2025/
- **Verified findings during research:** AI adoption now shows a **positive** relationship with software-delivery *throughput* — a reversal of the 2024 finding — but **remains negatively associated with delivery *stability***; ~90% of respondents use AI and >80% self-report productivity gains. Findings are survey **correlations, not causal**.
- **Why it matters to RStack:** The strongest current empirical support for the RStack thesis — throughput-without-stability is precisely the failure mode a governed loop (approval gates, validation, evidence) targets.
- **Reference (prior year, for the reversal):** Google Cloud DORA, *Accelerate State of DevOps Report 2024* — https://dora.dev/research/2024/. Retained only to document that the AI↔throughput relationship *reversed* between 2024 and 2025; cite 2025 as the delivery baseline.
- **RStack connection:** Supports metrics such as cycle time, validation pass rate, deployment confidence, and reliability — and the throughput/stability split RStack governance is designed to reconcile.

### Stack Overflow Developer Survey AI section
- **Reference:** Stack Overflow Developer Survey 2024, AI section.
- **URL:** https://survey.stackoverflow.co/2024/ai
- **Why it matters to RStack:** Provides broader developer sentiment and adoption context for AI tools.
- **RStack connection:** Supports background section on trust gaps and need for validation/observability.

## RStack primary sources

### RStack SDLC repository
- **Reference:** `richard-devbot/SDLC-rstack`.
- **URL:** https://github.com/richard-devbot/SDLC-rstack
- **Current audited HEAD:** main as of 2026-07-07 (v2.0.0 release: governed loop enforced in code — PRs #230–#234; 756 tests).
- **Current package:** `rstack-agents@2.0.0`.
- **Why it matters:** Primary source for architecture, implementation, tests, docs, and development history.

### RStack README
- **Reference:** `README.md`.
- **Key claim:** RStack is a governed AI-SDLC operating layer for any coding framework.
- **Lifecycle:** `clarify → plan → spec → approve → build → validate → release-readiness → learn`.

### RStack Mintlify documentation
- **Reference:** `docs/mintlify/`.
- **Why it matters:** Public documentation for installation, Business Hub, profiles, builder/validator sandboxing, adapters, and the SDLC pipeline.

### RStack issue roadmap
- **Reference:** GitHub issues #70-#79.
- **Why it matters:** Primary-source roadmap for the research-backed evolution from package to platform.
