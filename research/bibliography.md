<!-- owner: RStack developed by Richardson Gunde -->

# RStack Research Bibliography

This bibliography records the sources used to ground the RStack SDLC research narrative. It separates standards, prior-art implementations, empirical productivity evidence, security references, and RStack primary-source artifacts so the paper can cite claims without reconstructing context later.

> **Refreshed 2026-07:** entries updated against a verified research pass (see `research/evidence-refresh-2026-07.md`). Key deltas: METR's 19% figure is superseded by the Feb 2026 follow-up, DORA 2025 replaces 2024 as the primary delivery-evidence source, SLSA moved to v1.2 with a Source Track, OWASP published an Agentic Top 10, the EU AI Act Digital Omnibus moved the high-risk deadlines, and agent-interop specs (MCP, A2A) matured.

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

### EU AI Act implementation status (incl. Digital Omnibus, mid-2026)
- **Reference:** EU Artificial Intelligence Act tracker; Council of the EU press release on the Digital Omnibus on AI.
- **URLs:** https://artificialintelligenceact.eu/implementation-timeline/ ; https://www.consilium.europa.eu/en/press/press-releases/2026/05/07/artificial-intelligence-council-and-parliament-agree-to-simplify-and-streamline-rules/
- **Status as of July 2026 (verified 2026-07-13):** GPAI model obligations in force since 2025-08-02 (Commission enforcement powers from 2026-08-02); Article 50 transparency obligations effective 2026-08-02 as scheduled. The Digital Omnibus on AI (politically agreed 2026-05-07; Parliament 2026-06-16, Council 2026-06-29) defers stand-alone Annex III high-risk obligations to 2027-12-02 and Annex I embedded-product obligations to 2028-08-02.
- **Why it matters to RStack:** Regulatory motivation for traceability, transparency, and documented oversight is real, but the high-risk compliance cliff moved out ~16 months; the near-term mapping targets are GPAI transparency and technical-documentation duties.
- **RStack connection:** Supports research-paper framing around governed AI software delivery; evidence/attestation model as technical-documentation substrate.

### NIST SP 800-218A (SSDF Community Profile for AI) and COSAIS
- **Reference:** NIST SP 800-218A, *Secure Software Development Practices for Generative AI and Dual-Use Foundation Models* (final, July 2024); draft SP 800-218r1 (SSDF v1.2, Dec 2025); NIST COSAIS project.
- **URLs:** https://csrc.nist.gov/pubs/sp/800/218/a/final ; https://csrc.nist.gov/pubs/sp/800/218/r1/ipd ; https://csrc.nist.gov/Projects/cosais/faqs
- **Why it matters to RStack:** SP 800-218A's audience is producers of AI models/systems — not teams using AI to build ordinary software — so NIST's SSDF line leaves the AI-assisted-SDLC governance space largely unaddressed (an inference, not a NIST statement). Draft SSDF v1.2 and the planned COSAIS control overlays (including a multi-agent AI systems overlay, drafts ~Q3 FY26) are the items most likely to close or reshape that gap.
- **RStack connection:** Grounds the paper's gap claim; COSAIS multi-agent overlay is a future compliance-pack mapping target. Re-check both before submission.

## Secure supply-chain and attestation references

### SLSA v1.2 (Provenance and Source Track)
- **Reference:** Supply-chain Levels for Software Artifacts, v1.2 (approved 2025-11-12, announced 2025-11-24 — current version).
- **URLs:** https://slsa.dev/spec/v1.2/whats-new ; https://slsa.dev/spec/v1.2/source-requirements ; https://slsa.dev/blog/2025/11/announce-slsa-v1.2
- **Why it matters to RStack:** Beyond build provenance, v1.2 adds a normative Source Track (L1–L4: identity, revision provenance, enforced branch controls, two-party trusted review) — the same mechanism class as RStack's untrusted-contributor PR gate and cross-harness review independence. (The AI-relevance framing is ours; SLSA's announcement does not mention AI.)
- **RStack connection:** Supports `rstack-agents attest` / `verify-attestations`; Source Track alignment for #75/#72 is a grounded roadmap candidate (parked in #79).

### in-toto Attestation Framework
- **Reference:** in-toto Attestation Framework v1, envelope specification (living text; last material changes Aug 2025 and Mar 2026 / ITE-5).
- **URL:** https://github.com/in-toto/attestation/blob/main/spec/v1/envelope.md
- **Why it matters to RStack:** The framework RECOMMENDS DSSE v1.0 as the envelope — validating RStack's DSSE-style design — but full conformance requires `payloadType: application/vnd.in-toto[.<predicate>]+json`, a base64-encoded JSON Statement payload, and (per ITE-5, Mar 2026) multi-signature support with a signed payloadType.
- **RStack connection:** Upgrading #73 envelopes from "DSSE-style" to in-toto-conformant attestations is a grounded roadmap candidate (parked in #79). Track the spec; it is not frozen.

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

### OWASP Top 10 for LLM Applications (2025 edition)
- **Reference:** OWASP GenAI Security Project, *Top 10 for LLM Applications 2025* (released Nov 2024; current as of July 2026).
- **URL:** https://genai.owasp.org/llm-top-10/
- **Why it matters to RStack:** The 2025 edition adds LLM07 System Prompt Leakage and LLM08 Vector and Embedding Weaknesses, and retains LLM06 Excessive Agency — whose root causes (excessive functionality, permissions, autonomy) and human-in-the-loop guidance directly validate RStack's enforcement ladders and Definition-of-Ready gates.
- **RStack connection:** Supports validator restrictions, untrusted PR gates, protected actions, and cross-harness review.

### OWASP Top 10 for Agentic Applications for 2026
- **Reference:** OWASP GenAI Security Project, *Top 10 for Agentic Applications for 2026* (published 2025-12-09; peer-reviewed flagship).
- **URL:** https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/
- **Why it matters to RStack:** ASI01–ASI10 (goal hijack, tool misuse, identity/privilege abuse, agentic supply chain, unexpected code execution, memory poisoning, insecure inter-agent communication, cascading agent failures) map onto the multi-agent coding threat surface RStack governs — though the list does not name coding agents or builder/validator roles specifically.
- **RStack connection:** An ASI mapping pack is a natural third compliance pack beside NIST AI RMF and ISO 42001 (parked in #79).

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

### METR experienced open-source developer productivity study (early-2025 RCT)
- **Reference:** METR, *Measuring the Impact of Early-2025 AI on Experienced Open-Source Developer Productivity* (July 2025).
- **URL:** https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/
- **Key findings:** With early-2025 AI tools, 16 experienced developers took 19% longer on real issues in mature repos (1M+ LOC average) — while forecasting a 24% speedup and, even after being slowed, believing AI had sped them up by ~20%. The setting was deliberately hard for AI; METR cautions the slowdown may not generalize. The page now carries an out-of-date banner.
- **Citation rule:** Never cite the 19% figure unqualified — scope it to early-2025 tools and pair it with the Feb 2026 follow-up (below). The durable finding is the **perception gap**: self-reported AI productivity is unreliable.
- **RStack connection:** Supports the paper problem statement and claims discipline — governance needs measured evidence, not developer perception.

### METR follow-up uplift update (Feb 2026)
- **Reference:** METR, *Uplift study update* (2026-02-24; follow-up launched Aug 2025 with newer agentic tools including Claude Code).
- **URL:** https://metr.org/blog/2026-02-24-uplift-update/
- **Key findings:** Returning developers −18% (CI −38%…+9%); newly recruited developers −4% (CI −15%…+9%) — effects statistically indistinguishable from zero. METR deems this data an unreliable signal (selection bias) and is redesigning the experiment; it characterizes both estimates as likely lower bounds on true AI speedup.
- **Why it matters to RStack:** No credible evidence of a large measured speedup exists, but "no measured effect" must not be overclaimed as "AI does not help."
- **RStack connection:** Cite alongside the 2025 RCT; lean on the perception gap and DORA stability findings, not the 19% number.

### Google DORA 2024 report
- **Reference:** Google Cloud DORA, *Accelerate State of DevOps Report 2024*.
- **URL:** https://dora.dev/research/2024/
- **Why it matters to RStack:** Historical baseline: 2024 found AI adoption negatively related to both throughput and stability — reversed on throughput in 2025.
- **RStack connection:** Supports metrics such as cycle time, validation pass rate, deployment confidence, and reliability.

### Google DORA 2025 report
- **Reference:** Google Cloud DORA, *State of AI-Assisted Software Development 2025* (~5,000 respondents, published Sept 2025; latest as of July 2026).
- **URLs:** https://dora.dev/dora-report-2025/ ; https://cloud.google.com/blog/products/ai-machine-learning/announcing-the-2025-dora-report
- **Key findings:** AI adoption now has a **positive** relationship with software delivery throughput (a reversal of 2024) but **continues to have a negative relationship with delivery stability**. 90% of respondents use AI at work; more than 80% believe it increased their productivity (self-reported).
- **Why it matters to RStack:** The strongest empirical support for RStack's positioning — throughput gains without stability discipline is precisely the failure mode a governed operating loop targets; the 80% belief figure against METR's measured null echoes the perception gap. Correlational survey research, not causal.
- **RStack connection:** Primary delivery-performance citation for the paper thesis.

### Stack Overflow Developer Survey AI section
- **Reference:** Stack Overflow Developer Survey 2024, AI section.
- **URL:** https://survey.stackoverflow.co/2024/ai
- **Why it matters to RStack:** Provides broader developer sentiment and adoption context for AI tools.
- **RStack connection:** Supports background section on trust gaps and need for validation/observability.

## Agent interoperability references

### Model Context Protocol 2026-07-28 specification revision
- **Reference:** MCP blog, *The 2026-07-28 Specification Release Candidate* (RC locked 2026-05-21; final targeted 2026-07-28).
- **URL:** https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/
- **Key changes:** Stateless core (no `initialize` handshake or `Mcp-Session-Id` header — any request can land on any server instance), formal Extensions framework with governance (MCP Apps, Tasks), OAuth 2.0/OIDC authorization hardening, and a 12-month deprecation policy (Roots, Sampling, Logging deprecated). Breaking changes vs the 2025-11-25 revision.
- **RStack connection:** The roadmap's MCP/A2A server item should target this stateless revision.

### A2A protocol v1.0 under the Linux Foundation
- **Reference:** Linux Foundation press release (2026-04-09): A2A surpasses 150 organizations, lands in major cloud platforms.
- **URL:** https://www.linuxfoundation.org/press/a2a-protocol-surpasses-150-organizations-lands-in-major-cloud-platforms-and-sees-enterprise-production-use-in-first-year
- **Key facts:** v1.0 is the first stable specification; 150+ supporting organizations (from 50+ in Apr 2025); production deployments in supply chain, financial services, insurance, and IT operations; embedded in Azure AI Foundry, Copilot Studio, and Amazon Bedrock AgentCore Runtime.
- **RStack connection:** Agent-*interop* standardization has matured while agent-*governance* standardization (RStack's layer) is still forming — a positioning point for the paper.

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
