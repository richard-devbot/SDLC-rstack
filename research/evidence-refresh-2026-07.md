<!-- owner: RStack developed by Richardson Gunde -->

# Evidence Refresh — July 2026

This document records the July 2026 research refresh for the RStack paper and roadmap (epic #79). It updates the evidence base seeded in 2025 with what has materially changed, so that `bibliography.md`, `productivity-claims.md`, `paper-outline.md`, and `methodology.md` stay honest.

**Method.** A deep-research pass (2026-07-12) decomposed the question into 5 angles, fetched 25 sources, extracted 123 claims, and adversarially verified the top 25 against primary sources — 25 confirmed, 0 refuted (each claim 3-0 across independent verifiers). A follow-up inline pass (2026-07-13) covered the two areas the first pass left unverified: EU AI Act implementation status and agent-interoperability specs, checked directly against primary sources.

## Headline changes since the 2025 evidence base

### 1. METR: the "19% slowdown" is superseded — the perception gap is the durable finding

- Original RCT (July 2025): experienced open-source developers took **19% longer** with early-2025 AI tools; they forecast +24% and, even after being slowed, believed AI sped them up by ~20%. Setting was deliberately hard for AI (16 experienced devs, mature 1M+ LOC repos they knew well). Source: https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/ (page now carries an out-of-date banner).
- Follow-up (Feb 2026, newer agentic tools incl. Claude Code): returning developers **−18% (CI −38%…+9%)**, newly recruited **−4% (CI −15%…+9%)** — effects statistically indistinguishable from zero. METR itself flags selection bias and is redesigning the experiment. Source: https://metr.org/blog/2026-02-24-uplift-update/
- **Rule for the paper:** never cite the 19% figure unqualified. Scope it to early-2025 tools and pair it with the 2026 follow-up. Do not overclaim the null as "AI does not help" — METR characterizes both estimates as likely lower bounds. The claim that survives is the **perception gap**: self-reported AI productivity is unreliable, so governance needs measured evidence (attestations, traceability), not developer perception.

### 2. DORA 2025: throughput up, stability still down — the strongest support for the thesis

- DORA 2025 (~5,000 respondents, Sept 2025): AI adoption now has a **positive** relationship with software delivery throughput (a reversal of 2024) but **continues to have a negative relationship with delivery stability**. 90% of respondents use AI at work; more than 80% believe it increased their productivity (self-reported — echoing the METR perception gap against measured nulls). Sources: https://dora.dev/dora-report-2025/ ; https://cloud.google.com/blog/products/ai-machine-learning/announcing-the-2025-dora-report
- **Implication:** throughput-without-stability is precisely the failure mode a governed operating loop (validator contracts, DoR gates, drift detection) targets. Note DORA is correlational survey research, not causal.

### 3. SLSA v1.2: normative Source Track

- SLSA v1.2 approved 2025-11-12, announced 2025-11-24 — now the current version. Major addition: a **Source Track** (L1–L4: identity, revision provenance, enforced branch controls, two-party trusted review) extending SLSA beyond build provenance to how source is authored, reviewed, and managed. Sources: https://slsa.dev/blog/2025/11/announce-slsa-v1.2 ; https://slsa.dev/spec/v1.2/source-requirements
- **Implication:** RStack's untrusted-contributor PR gate (#75) and cross-harness review independence (#72) are the same mechanism class; references should move past v1.0. The AI-relevance framing is ours, not SLSA's — do not attribute it to SLSA.

### 4. OWASP: Agentic Top 10 published; LLM Top 10 2025 is current

- **OWASP Top 10 for Agentic Applications for 2026** published 2025-12-09 (ASI01–ASI10: goal hijack, tool misuse, identity/privilege abuse, agentic supply chain, unexpected code execution, memory poisoning, insecure inter-agent communication, cascading agent failures). Source: https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/
- LLM Top 10 (2025 edition, released Nov 2024, still current): adds LLM07 System Prompt Leakage and LLM08 Vector and Embedding Weaknesses; retains LLM06 Excessive Agency (human-in-the-loop guidance that validates RStack's enforcement ladders and DoR gates). Now maintained under the OWASP GenAI Security Project. Source: https://genai.owasp.org/llm-top-10/
- **Implication:** an OWASP ASI mapping pack is a natural third compliance pack beside NIST AI RMF and ISO 42001 (parked in #79).

### 5. in-toto / DSSE: RStack's envelope choice validated, but the conformance bar moved

- The in-toto Attestation Framework v1 RECOMMENDS DSSE v1.0 (pinned v1.0.2) as the envelope — validating RStack's DSSE-style design. Full conformance requires `payloadType: application/vnd.in-toto[.<predicate>]+json` and a base64-encoded JSON Statement payload. The envelope spec kept moving after mid-2025: Aug 2025 (predicate-type media types) and Mar 2026 (ITE-5: multi-signature support mandated, payloadType must be signed, signatures field formalized). Source: https://github.com/in-toto/attestation/blob/main/spec/v1/envelope.md
- **Implication:** #73 envelopes are DSSE-style but not in-toto-conformant; upgrading is a grounded roadmap candidate (parked in #79). Track the spec — it is living text.

### 6. NIST: the AI-assisted-SDLC gap is confirmed open, and contested

- SP 800-218A (final July 2024, unchanged since) covers secure development **of** generative AI models — its audience is AI model/system producers, not teams using AI to build ordinary software. Source: https://csrc.nist.gov/pubs/sp/800/218/a/final
- Draft SP 800-218r1 (SSDF v1.2) published 2025-12-17, comment period closed 2026-01-30; mid-2026 commentary is calling for AI-generated-code verification requirements. Source: https://csrc.nist.gov/pubs/sp/800/218/r1/ipd
- COSAIS (Control Overlays for Securing AI Systems, SP 800-53-based) launched mid-2025 with a planned **multi-agent AI systems** overlay; still pre-publication as of Jan 2026, drafts (NISTIR 8605 family) reportedly ~Q3 FY26. Source: https://csrc.nist.gov/Projects/cosais/faqs
- **Implication:** the governance space RStack targets remains largely unaddressed by NIST's SSDF line — that is the gap the paper should claim, carefully, as an inference. Watch for SSDF v1.2 final and COSAIS drafts before publishing.

### 7. EU AI Act: Digital Omnibus adopted — high-risk deadlines moved, GPAI and transparency did not

(Inline verification, 2026-07-13.)

- In force: prohibited-practice rules (Feb 2025) and **GPAI model obligations (since 2025-08-02)**; Commission enforcement powers for GPAI begin 2026-08-02. Article 50 transparency obligations take effect 2026-08-02 as scheduled. Source: https://artificialintelligenceact.eu/implementation-timeline/
- The **Digital Omnibus on AI** was politically agreed 2026-05-07 and formally adopted (Parliament 2026-06-16, Council 2026-06-29): stand-alone Annex III high-risk obligations deferred to **2027-12-02**; AI embedded in Annex I regulated products to **2028-08-02**. New prohibitions (AI-generated NCII/CSAM) take effect 2026-12-02. Sources: https://www.consilium.europa.eu/en/press/press-releases/2026/05/07/artificial-intelligence-council-and-parliament-agree-to-simplify-and-streamline-rules/ ; https://www.gibsondunn.com/eu-ai-act-omnibus-agreement-postponed-high-risk-deadlines-and-other-key-changes/
- **Implication:** regulatory pressure on software-engineering tooling is real but the high-risk compliance cliff moved out ~16 months. RStack's evidence/attestation model maps most credibly to GPAI transparency and technical-documentation duties now, and Annex III documentation later.

### 8. Agent interoperability: MCP goes stateless, A2A reaches 1.0 under the Linux Foundation

(Inline verification, 2026-07-13.)

- **MCP 2026-07-28 spec revision** (release candidate locked 2026-05-21; final targeted 2026-07-28): stateless core (no `initialize` handshake, no `Mcp-Session-Id`), a formal Extensions framework (MCP Apps, Tasks), authorization hardening (OAuth 2.0/OIDC alignment), and a 12-month deprecation policy. Breaking changes vs 2025-11-25. Source: https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/
- **A2A** (Linux Foundation, originally Google): v1.0 first stable spec; 150+ supporting organizations (from 50+ in Apr 2025); production deployments across supply chain, financial services, insurance, IT ops; embedded in Azure AI Foundry, Copilot Studio, Amazon Bedrock AgentCore. Source: https://www.linuxfoundation.org/press/a2a-protocol-surpasses-150-organizations-lands-in-major-cloud-platforms-and-sees-enterprise-production-use-in-first-year
- **Implication:** the roadmap's MCP/A2A server item should target the stateless 2026-07-28 MCP revision, and the paper's related-work section should note that agent-interop standardization matured while agent-*governance* standardization (RStack's layer) is still forming.

## Thesis check

The epic's thesis — "RStack converts unstructured AI coding into a governed operating loop" — is **strengthened** by the 2026 evidence:

1. The METR perception gap plus DORA's 80% self-reported gains vs measured nulls show that perceived productivity is unreliable → measured evidence (contracts, attestations, traceability) is the right basis.
2. DORA 2025's throughput-up/stability-down finding is exactly the failure mode a governed loop addresses.
3. Standards momentum (SLSA Source Track, OWASP agentic risks, COSAIS multi-agent overlays, in-toto tightening) is converging on the mechanism classes RStack already implements.

What the evidence does **not** support: any claim that governance produces measured speedups. That remains a hypothesis (see `productivity-claims.md`).

## Remaining gaps

- **ISO/IEC 42001 certification uptake** — no verified claims yet; needs a focused pass before the paper cites adoption numbers.
- **Augment Code AI-SDLC guide (June 2026 refresh)** — single-source, unverified; the five-layer-stack description in `bibliography.md` should not be extended without re-verification.
- **NIST watch items:** SSDF v1.2 final (SP 800-218r1) and COSAIS NISTIR 8605 drafts could land any time and partially close the claimed gap — re-check before submission.
