<!-- owner: RStack developed by Richardson Gunde -->

# RFC-0001: RStack Spec v1alpha1

## Status
Draft

## Context
RStack already has `.rstack` run state, lifecycle stages, builder/validator contracts, evidence JSONL, approvals, profiles, and Business Hub state. These artifacts work inside the package, but they are not yet formalized as a public spec. A public spec is needed before external harnesses, research papers, or enterprise adopters can reason about conformance.

## Decision
Adopt a `spec/`-first direction for RStack v1alpha1. The spec should define canonical resources such as Run, Task, StageArtifact, BuilderReport, ValidatorReport, EvidenceEvent, Approval, Decision, Profile, BudgetPolicy, and future AttestationEnvelope. JSON schemas should be versioned and shipped with conformance examples.

## Alternatives considered
- **Do nothing:** keeps RStack fast to evolve, but weakens interoperability and paper credibility.
- **Clone the external AI-SDLC spec:** rejected because RStack should adapt patterns while preserving its Business Hub and npm package identity.
- **Schema only, no narrative spec:** rejected because human-readable semantics matter for research and adoption.

## Research references
- RStack research bibliography: `research/bibliography.md`
- RStack prior-art comparison: `research/prior-art-ai-sdlc-framework.md`
- RStack current-state audit: `research/current-state-audit.md`
- Epic tracker: https://github.com/richard-devbot/SDLC-rstack/issues/79
- Prior-art repo: https://github.com/ai-sdlc-framework/ai-sdlc
- Roadmap issue: https://github.com/richard-devbot/SDLC-rstack/issues/71

## Implementation plan
- Create `spec/rstack-spec.md`.
- Create `spec/schemas/` with versioned JSON schemas.
- Add conformance examples under `spec/examples/`.
- Add tests that validate examples against schemas.
- Link spec docs from Mintlify and README.
- Keep backward compatibility with existing `.rstack` artifacts where feasible.

## Validation
- `npm test` passes.
- Schema example validation passes.
- `npm pack --dry-run --json` includes spec files when package allowlist is updated.
- Business Hub still reads existing run artifacts.
- Paper claims reference a concrete spec version instead of informal implementation notes.

## Paper angle
Define a public RStack specification with JSON schemas and conformance examples. This RFC records the rationale before implementation so the RStack paper can cite design intent, accepted tradeoffs, and validation criteria.
