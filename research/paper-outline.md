<!-- owner: RStack developed by Richardson Gunde -->

# RStack Paper Outline

## Working title

**RStack SDLC: A Governed Operating Layer for Productive AI-Assisted Software Development**

## Thesis

RStack improves the practical use of AI coding agents by wrapping them in a governed lifecycle: clarify, plan, specify, approve, build, validate, prepare release evidence, and learn. The research claim is not that AI alone guarantees productivity, but that explicit lifecycle structure, contracts, evidence, approvals, budget envelopes, and observability can make AI-assisted delivery more reliable, auditable, and measurable.

## Abstract draft

AI coding agents can generate software quickly, but unstructured agent use often suffers from ambiguous requirements, weak validation, missing evidence, unclear cost, and poor traceability. RStack SDLC is a framework-independent operating layer that introduces a governed lifecycle for AI-assisted software delivery. It provides project profiles, builder and validator contracts, approval gates, evidence logs, budget envelopes, and a live Business Hub dashboard over a filesystem-backed `.rstack` state contract. This paper describes RStack's architecture, compares it with adjacent AI-SDLC frameworks and reference architectures, and proposes a measurement model for evaluating productivity, quality, governance, and auditability in AI-assisted delivery.

## 1. Introduction

- Growth of AI coding agents.
- Productivity promise vs reliability/trust gap.
- Problem: ad-hoc prompting lacks lifecycle control.
- RStack contribution: business-friendly governed SDLC layer.

## 2. Background and related work

- AI coding tools and agentic workflows.
- Augment Code AI-SDLC reference architecture.
- `ai-sdlc-framework/ai-sdlc` as prior-art governance framework.
- DevOps/DORA delivery-performance research (2025 baseline: AI adoption raises throughput but lowers stability — the throughput-without-stability gap RStack targets; correlational).
- METR productivity caution — framed as the **perception gap** (developers felt faster while measured slower) and delivery *stability*, not the early-2025 19% figure (superseded by the 2026 follow-up: effect indistinguishable from zero; do not overclaim the null).
- NIST AI RMF, NIST SSDF, OWASP LLM Top 10.
- SLSA/DSSE/Sigstore provenance patterns.

## 3. RStack architecture

### 3.1 Package and adapter model

- One npm package: `rstack-agents`.
- Adapters: Pi, Claude Code, Operator, Codex/Gemini/custom via filesystem state contract.
- CLI: init, hub, list, add plugin, notify, validate.

### 3.2 Lifecycle model

```text
clarify → plan → spec → approve → build → validate → release-readiness → learn
```

### 3.3 Canonical SDLC stages

RStack defines 15 stages from environment discovery to cost estimation. These are implemented in `src/core/harness/stages.js` and surfaced in documentation.

### 3.4 Profiles

- `lean-mvp`
- `business-flex`
- `enterprise-webapp`

Profiles configure domains, agents, plugins, dashboard pages, workflow, and budget policy.

### 3.5 Builder/validator contracts

- Builder contract: task, status, summary, files modified, tests run, risks, next steps.
- Validator contract: task, status, checks, issues, retry recommendation.
- Contract v2 supports execution, cost, context, and routing telemetry.

### 3.6 Business Hub

- Multi-project dashboard.
- Run analytics.
- Approval/alert view.
- Agent work view.
- Traceability map.
- Business Flex routing and budget visibility.

## 4. Governance model

Current governance:

- approval queue,
- manager allowlist,
- protected/destructive action guardrails,
- builder/validator contracts,
- evidence JSONL,
- budget policies,
- notifications.

Roadmap governance:

- Decision Queue and DoR gate (#70),
- RStack Spec (#71),
- cross-harness validation (#72),
- attestations (#73),
- drift detection (#74),
- untrusted PR gate (#75),
- RFC process (#76),
- governance packs (#78).

## 5. Measurement model

Measure productivity as a combined score of:

- delivery flow,
- quality and validation,
- traceability,
- governance,
- cost visibility,
- operator intervention.

Candidate metrics are defined in `research/methodology.md`.

## 6. Case study: building RStack with RStack-style governance

Use repository history and roadmap issues to describe development:

- initial package/catalog,
- SDLC pipeline agents,
- Business Hub,
- profiles and budgets,
- builder/validator contracts,
- research-backed roadmap issues #70-#79.

## 7. Prior-art comparison

Compare RStack against:

- Augment Code reference architecture,
- `ai-sdlc-framework/ai-sdlc`,
- general agentic coding frameworks.

Main finding:

> RStack is currently stronger as an approachable business product, while prior-art governance frameworks are stronger on formal specs and attestable gates. The roadmap combines both.

## 8. Threats to validity

- Founder-led self-study.
- Limited external case studies so far.
- Host framework differences.
- Cost estimates may not equal actual provider usage.
- Current validation enforcement depends partly on host sandbox behavior.
- Roadmap items should not be claimed as implemented until merged.

## 9. Future work

- Decision Queue / DoR.
- RStack Spec.
- Cross-harness validation.
- Attestation envelopes.
- Drift detection.
- Untrusted PR gate.
- Governance packs.
- MCP/A2A server.
- External benchmark study.

## 10. Conclusion

RStack's contribution is to make AI-assisted development observable, governable, and measurable. Its current implementation provides the operating layer; the research roadmap turns that operating layer into a formal evidence-backed AI-SDLC platform.

## Appendix A: Bibliography

See `research/bibliography.md`.

## Appendix B: Methodology

See `research/methodology.md`.

## Appendix C: Claims register

See `research/productivity-claims.md`.
