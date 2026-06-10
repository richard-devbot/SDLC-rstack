<!-- owner: RStack developed by Richardson Gunde -->

# RFC-0006: Untrusted PR gate

## Status
Draft

## Context
RStack ships agents, prompts, plugins, and lifecycle code. Changes to these areas can alter agent behavior, governance, or security posture. Public contribution flows need a protected-path gate that distinguishes trusted maintainers from untrusted contributors.

## Decision
Add a GitHub Actions gate that identifies untrusted PRs touching protected paths and requires maintainer approval before dangerous workflows or package validation paths proceed. The gate should be documented as part of RStack governance.

## Alternatives considered
- **Rely only on normal CI:** does not address trust boundary concerns.
- **Block all external PRs:** too hostile to contributors.
- **Manual review with no automation:** easy to miss protected-path changes.

## Research references
- RStack research bibliography: `research/bibliography.md`
- RStack prior-art comparison: `research/prior-art-ai-sdlc-framework.md`
- RStack current-state audit: `research/current-state-audit.md`
- Epic tracker: https://github.com/richard-devbot/SDLC-rstack/issues/79
- Prior-art repo: https://github.com/ai-sdlc-framework/ai-sdlc
- Roadmap issue: https://github.com/richard-devbot/SDLC-rstack/issues/75

## Implementation plan
- Define protected paths.
- Add workflow or script for PR trust classification.
- Add docs for maintainers and contributors.
- Add tests for protected-path matching if script-based.
- Surface the model in RFC/research docs.

## Validation
- CI gate identifies protected-path changes.
- Trusted maintainer paths remain low friction.
- Untrusted PRs receive clear instructions.
- Security baseline remains green.

## Paper angle
Protect sensitive RStack paths in untrusted contributor PRs. This RFC records the rationale before implementation so the RStack paper can cite design intent, accepted tradeoffs, and validation criteria.
