<!-- owner: RStack developed by Richardson Gunde -->

# RStack RFC / ADR Registry

RStack uses RFCs as lightweight Architecture Decision Records (ADRs). The goal is not bureaucracy; the goal is traceable, citable design history for a research-backed AI-SDLC platform.

RFCs are required when a change affects one or more of:

- public lifecycle semantics,
- `.rstack` state shape,
- builder/validator contract fields,
- Business Hub governance behavior,
- package or adapter compatibility,
- security, compliance, or evidence guarantees,
- research claims or paper methodology.

Small bug fixes, copy edits, and implementation-only refactors do not need an RFC unless they change a documented decision.

## Lifecycle states

Every RFC must include exactly one `## Status` section whose first non-empty line is one of:

| Status | Meaning |
|---|---|
| `Draft` | Proposed direction; implementation should not claim stability yet. |
| `Accepted` | Direction approved for implementation; details may still evolve. |
| `Implemented` | Code/docs shipped and validated. |
| `Superseded` | Replaced by a later RFC; link to the replacement. |

## File naming

RFC filenames must use this format:

```text
RFC-000N-short-kebab-title.md
```

Examples:

- `RFC-0001-rstack-spec-v1alpha1.md`
- `RFC-0002-decision-queue-and-readiness-gate.md`

Numbers are append-only. Do not renumber accepted or implemented RFCs.

## Required sections

Use [`TEMPLATE.md`](TEMPLATE.md). The CI validator checks that each RFC has the required sections:

1. `# RFC-000N: Title`
2. `## Status`
3. `## Context`
4. `## Decision`
5. `## Alternatives considered`
6. `## Research references`
7. `## Implementation plan`
8. `## Validation`

## Current registry

| RFC | Status | Roadmap issue | Purpose |
|---|---|---:|---|
| [RFC-0001: RStack Spec v1alpha1](RFC-0001-rstack-spec-v1alpha1.md) | Draft | [#71](https://github.com/richard-devbot/SDLC-rstack/issues/71) | Define public schemas and conformance examples for RStack artifacts. |
| [RFC-0002: Decision Queue and readiness gate](RFC-0002-decision-queue-and-readiness-gate.md) | Draft | [#70](https://github.com/richard-devbot/SDLC-rstack/issues/70) | Introduce decision objects and Definition-of-Ready enforcement. |
| [RFC-0003: Cross-harness validation](RFC-0003-cross-harness-validation.md) | Draft | [#72](https://github.com/richard-devbot/SDLC-rstack/issues/72) | Require independent builder/validator harness evidence. |
| [RFC-0004: Attestation envelope](RFC-0004-attestation-envelope.md) | Draft | [#73](https://github.com/richard-devbot/SDLC-rstack/issues/73) | Wrap builder, validator, and release evidence in a signable envelope. |
| [RFC-0005: Traceability drift detection](RFC-0005-traceability-drift-detection.md) | Draft | [#74](https://github.com/richard-devbot/SDLC-rstack/issues/74) | Detect drift across requirements, tasks, evidence, and docs. |
| [RFC-0006: Untrusted PR gate](RFC-0006-untrusted-pr-gate.md) | Draft | [#75](https://github.com/richard-devbot/SDLC-rstack/issues/75) | Add protected-path handling for untrusted contributor PRs. |

## How to update an RFC

1. Start an issue or PR that explains the proposed change.
2. Add or edit an RFC on a branch.
3. Link the RFC to research references and implementation issues.
4. Run `npm test` so `tests/validate-rfcs.test.js` validates filenames, statuses, and required sections.
5. Wait for CI and CodeRabbit review.
6. Merge only after human approval.

## Research-paper value

The RFC registry is primary-source evidence for the RStack paper. It shows that the platform evolves through explicit design decisions grounded in prior art, standards, implementation constraints, and measurable validation plans.
