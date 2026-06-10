<!-- owner: RStack developed by Richardson Gunde -->

# RStack Prior-Art Comparison: AI-SDLC Frameworks

This document records the prior-art comparison that led to the research-backed RStack roadmap. It focuses on ideas to adapt, not code to copy.

## Compared systems

### RStack SDLC

- **Repository:** https://github.com/richard-devbot/SDLC-rstack
- **Package:** `rstack-agents@1.8.0`
- **License:** MIT
- **Positioning:** governed AI-SDLC operating layer for any coding framework.
- **Current audited HEAD:** `b559aa4`.
- **Core product loop:** `clarify → plan → spec → approve → build → validate → release-readiness → learn`.

### ai-sdlc-framework/ai-sdlc

- **Repository:** https://github.com/ai-sdlc-framework/ai-sdlc
- **License observed during audit:** Apache-2.0
- **Positioning:** declarative governance framework for AI-augmented software development lifecycles.
- **Observed audited HEAD:** `addbbdd0`.
- **Core idea:** Decision Engine for spec-driven AI workflows.

### Augment Code AI-SDLC reference architecture

- **URL:** https://www.augmentcode.com/guides/ai-sdlc-framework-reference-architecture
- **Observed page description:** a five-layer AI-SDLC framework for agents, orchestration, observability, and governance.
- **Use in this research:** market/architecture reference, not a codebase comparison.

## Objective comparison snapshot

| Dimension | RStack SDLC | ai-sdlc-framework/ai-sdlc |
|---|---|---|
| Primary audience | Business/product teams and agent operators | Framework/spec/governance adopters |
| Packaging | One npm package | Multi-package monorepo |
| Dashboard | Business Hub is central | Dashboard exists, but repo emphasis is spec/orchestration |
| Profiles | `business-flex`, `lean-mvp`, `enterprise-webapp` | Formal resources and policies |
| Formal spec | Not yet formalized as public spec | Strong spec/RFC/schema model |
| Decision gate | Clarify/approve flow exists, but no first-class Decision Queue yet | Strong Decision Engine / Definition-of-Ready framing |
| Builder/validator model | Implemented contracts and validation helpers | Cross-harness review and attestation-heavy direction |
| Evidence | Evidence JSONL and task contracts | DSSE-style attestations and gate workflows |
| Drift detection | Traceability UI exists; drift detector not yet implemented | Backlog/task drift gates exist |
| Untrusted PR handling | Standard CI/security scan | Dedicated untrusted PR gate pattern |
| CI maturity | 4 workflows | Larger workflow/gate surface |
| Business usability | Stronger | More technical/formal |

## Where RStack is already strong

### 1. Business usability

RStack's biggest differentiator is that the user can start with:

```bash
npm install rstack-agents
npx rstack-agents init --profile business-flex
npx rstack-agents hub
```

This is simpler than a multi-package framework adoption. RStack should preserve this advantage.

### 2. Business Hub

Business Hub already derives state from real `.rstack` files and displays:

- projects and runs,
- stage health,
- Business Flex profile state,
- approvals,
- alerts,
- agent work,
- traceability,
- run analytics,
- live feed.

This gives RStack a business/operator experience that formal specs alone do not provide.

### 3. Profiles and budget envelopes

RStack already has profile-specific teams, plugins, dashboard pages, and budgets. This creates a practical product path from lean MVPs to enterprise work.

### 4. Existing lifecycle contract

RStack has 15 canonical stages and records run artifacts under `.rstack/runs/<run-id>/`. This is a strong base for research, traceability, and future conformance.

## Where prior art is stronger

### 1. Formal specification

The `ai-sdlc-framework/ai-sdlc` repo uses formal resource definitions, JSON schemas, and RFCs. RStack needs `spec/` and `research/` artifacts to make its model citable and implementable by others.

### 2. Decision Engine / Definition-of-Ready

RStack has clarify/approve flow, but does not yet have explicit decision objects that block later stages. This is the highest-value concept to adapt.

### 3. Cross-harness review

RStack has builder and validator contracts. It does not yet enforce that the validating harness differs from the builder harness.

### 4. Attestations

RStack has evidence JSONL and contracts but not signed or signable attestation envelopes.

### 5. Drift and untrusted PR gates

RStack has traceability display but not a drift scanner. It has CI/security checks but not a dedicated untrusted contributor protected-path gate.

## Adaptation rules

1. Copy patterns, not files.
2. Preserve RStack's one-package install simplicity.
3. Keep Business Hub as the primary operator experience.
4. Add formalism behind the product rather than forcing all users into heavyweight config.
5. Attribute external ideas and preserve license notices if any exact code is ever reused.

## Resulting roadmap

The prior-art comparison produced these RStack issues:

- #70 — Decision Queue and Definition-of-Ready readiness gate.
- #71 — RStack Spec v1alpha1 with JSON schemas and conformance examples.
- #72 — Cross-harness builder/validator review independence.
- #73 — RStack attestation envelopes for builder, validator, and release evidence.
- #74 — Traceability drift detection.
- #75 — Untrusted contributor PR gate.
- #76 — RFC / Architecture Decision Record process.
- #77 — Research bibliography and methodology appendix.
- #78 — Governance packs and profile-based enforcement levels.
- #79 — Epic tracker.

## Research conclusion

RStack should not become a clone of `ai-sdlc-framework/ai-sdlc`. The stronger product direction is:

> Business-friendly governed AI-SDLC with formal evidence underneath.

That means adopting serious governance mechanics while keeping onboarding, dashboards, and profiles simple for real users.