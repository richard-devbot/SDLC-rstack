<!-- owner: RStack developed by Richardson Gunde -->

# RFC-0004: Attestation envelope

## Status
Draft

## Context
RStack has evidence JSONL and builder/validator reports, but evidence is not yet packaged into a standard signable envelope. Enterprise users need tamper-evident provenance and audit-friendly evidence bundles.

## Decision
Design a local-first attestation envelope inspired by DSSE/SLSA/Sigstore patterns. Initial implementation can be unsigned but schema-compatible with future signing. Envelopes should reference run ID, task ID, stage, subject artifacts, builder/validator identity, evidence, and verification results.

## Alternatives considered
- **Raw JSONL only:** easy, but hard to verify or cite.
- **Require signing immediately:** too much setup for early users.
- **Adopt DSSE byte-for-byte now:** may overfit before RStack payloads are stable.

## Research references
- RStack research bibliography: `research/bibliography.md`
- RStack prior-art comparison: `research/prior-art-ai-sdlc-framework.md`
- RStack current-state audit: `research/current-state-audit.md`
- Epic tracker: https://github.com/richard-devbot/SDLC-rstack/issues/79
- Prior-art repo: https://github.com/ai-sdlc-framework/ai-sdlc
- Roadmap issue: https://github.com/richard-devbot/SDLC-rstack/issues/73

## Implementation plan
- Define `AttestationEnvelope` schema.
- Add envelope generation for builder/validator/release readiness.
- Add verification helper for local structural checks.
- Add docs explaining unsigned vs signed modes.
- Add future hooks for Sigstore signing.

## Validation
- Envelope schema validation passes.
- Verification fails malformed evidence.
- Package dry-run includes schemas/docs.
- Research paper can cite evidence-envelope semantics without claiming cryptographic signing until implemented.

## Paper angle
Wrap builder, validator, and release evidence in a structured signable envelope. This RFC records the rationale before implementation so the RStack paper can cite design intent, accepted tradeoffs, and validation criteria.
