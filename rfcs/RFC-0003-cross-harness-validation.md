<!-- owner: RStack developed by Richardson Gunde -->

# RFC-0003: Cross-harness validation

## Status
Draft

## Context
RStack already separates builder and validator contracts, but the current contract does not require that validation be performed by an independent harness, model, or runtime. Cross-harness validation helps reduce correlated failure and rubber-stamp validation.

## Decision
Add optional-to-strict review independence metadata to builder and validator reports. Enterprise profiles should be able to require validator harness/model identity to differ from builder identity for protected stages.

## Alternatives considered
- **Trust same-harness validation:** simpler but weaker for high-stakes changes.
- **Always require a different vendor:** too rigid and may increase cost.
- **Manual reviewer only:** useful, but not enough for automated RStack evidence.

## Research references
- RStack research bibliography: `research/bibliography.md`
- RStack prior-art comparison: `research/prior-art-ai-sdlc-framework.md`
- RStack current-state audit: `research/current-state-audit.md`
- Epic tracker: https://github.com/richard-devbot/SDLC-rstack/issues/79
- Prior-art repo: https://github.com/ai-sdlc-framework/ai-sdlc
- Roadmap issue: https://github.com/richard-devbot/SDLC-rstack/issues/72

## Implementation plan
- Extend contract metadata with harness/model identity.
- Add independence check helper.
- Add profile policy fields for `review_independence`.
- Surface independence status in Business Hub.
- Add tests for pass/fail independence combinations.

## Validation
- Contract tests cover missing, equal, and independent harness identities.
- Enterprise profile can require independence.
- Business Hub displays review independence status.
- Validation failure messages are actionable.

## Paper angle
Require validator independence from the builder harness for higher-trust workflows. This RFC records the rationale before implementation so the RStack paper can cite design intent, accepted tradeoffs, and validation criteria.
