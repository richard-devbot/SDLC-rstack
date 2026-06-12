<!-- owner: RStack developed by Richardson Gunde -->

# RFC-0002: Decision Queue and readiness gate

## Status
Draft

## Context
RStack currently supports clarify, plan, spec, approval, build, validate, and release-readiness stages. Approval gates exist, but there is no first-class Decision Queue that captures unresolved product/architecture/security decisions and blocks build until ready.

## Decision
Add decision objects under `.rstack/runs/<run-id>/decisions/` and expose them in Business Hub. The Definition-of-Ready gate should block build when required decisions are unresolved or when required approval evidence is missing.

## Alternatives considered
- **Use free-text planning docs only:** insufficient for gating and metrics.
- **Make every question a blocking approval:** too heavy for lean profiles.
- **Adopt a heavy workflow engine:** rejected to preserve RStack's simple package install.

## Research references
- RStack research bibliography: `research/bibliography.md`
- RStack prior-art comparison: `research/prior-art-ai-sdlc-framework.md`
- RStack current-state audit: `research/current-state-audit.md`
- Epic tracker: https://github.com/richard-devbot/SDLC-rstack/issues/79
- Prior-art repo: https://github.com/ai-sdlc-framework/ai-sdlc
- Roadmap issue: https://github.com/richard-devbot/SDLC-rstack/issues/70

## Implementation plan
- Define decision object shape.
- Add decision creation/resolution helpers.
- Add DoR validation command or harness stage check.
- Add Business Hub Decision Queue panel.
- Add profile-specific strictness.
- Add tests for blocked/unblocked runs.

## Validation
- Tests prove unresolved required decisions block build.
- Tests prove optional decisions do not block lean workflows.
- Business Hub displays pending decisions from real `.rstack` state.
- Research metrics can count decisions captured before build.

## Paper angle
Introduce first-class decisions and a Definition-of-Ready gate before build work proceeds. This RFC records the rationale before implementation so the RStack paper can cite design intent, accepted tradeoffs, and validation criteria.
