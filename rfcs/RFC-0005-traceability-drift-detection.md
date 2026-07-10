<!-- owner: RStack developed by Richardson Gunde -->

# RFC-0005: Traceability drift detection

## Status
Draft

## Context
Business Hub already has traceability state, but RStack does not yet enforce traceability completeness or detect drift. AI-assisted development can produce code that no longer maps cleanly to requirements or documentation.

## Decision
Add a drift detector that scans requirement artifacts, task records, stage artifacts, evidence events, and docs references. The detector should produce findings with severity, missing links, stale references, and recommended remediation.

## Alternatives considered
- **Dashboard-only traceability:** informative but not enforceable.
- **Require perfect traceability in every profile:** too heavy for lean MVPs.
- **Use external ALM only:** weakens RStack's self-contained package story.

## Research references
- RStack research bibliography: `research/bibliography.md`
- RStack prior-art comparison: `research/prior-art-ai-sdlc-framework.md`
- RStack current-state audit: `research/current-state-audit.md`
- Epic tracker: https://github.com/richard-devbot/SDLC-rstack/issues/79
- Prior-art repo: https://github.com/ai-sdlc-framework/ai-sdlc
- Roadmap issue: https://github.com/richard-devbot/SDLC-rstack/issues/74

## Implementation plan
- Define traceability link model.
- Add drift scanner.
- Add Business Hub drift findings panel.
- Add profile thresholds.
- Add CI/release-readiness integration for strict profiles.

## Validation
- Tests cover missing requirement links, stale docs references, and clean runs.
- Business Hub reads drift findings from `.rstack` state.
- Strict profile can fail release readiness on high-severity drift.
- Research metrics can measure evidence completeness.

## Paper angle
Detect drift from requirements to tasks to evidence to docs. This RFC records the rationale before implementation so the RStack paper can cite design intent, accepted tradeoffs, and validation criteria.
