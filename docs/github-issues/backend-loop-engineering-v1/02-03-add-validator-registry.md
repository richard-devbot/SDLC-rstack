<!-- owner: RStack developed by Richardson Gunde -->

# [BLE-2.3] Add validator registry

## Summary

Add a registry mapping critical SDLC stages to validator agents and validator check profiles.

## Motivation

Generic validation catches missing contracts, but architecture, code, testing, security, and compliance need stage-specific checks. A registry lets `sdlc_validate` select the right checker without hardcoding all logic into one tool.

## Proposed Implementation

- Add a registry file or module such as `src/core/harness/validator-registry.js`.
- Map critical stages:
  - `06-architecture`
  - `07-code`
  - `08-testing`
  - `12-security-threat-model`
  - `13-compliance-checker`
- Each registry entry includes:
  - `stage_id`
  - validator id/name
  - default model/policy hint
  - read-only requirement
  - required checks
  - output contract fields
- Allow project-local overrides under `.rstack/validators/` or registry config.
- Have `sdlc_validate` include selected validator profile in validation output.

## Acceptance Criteria

- [ ] `sdlc_validate` can select a validator profile from stage targets.
- [ ] Critical stages have default registry entries.
- [ ] Project-local overrides are supported or clearly deferred with TODO-free docs.
- [ ] Validation output records which validator profile ran.

## Test Plan

- [ ] Unit tests for registry lookup by stage id.
- [ ] Unit tests for unknown stage fallback.
- [ ] Integration-style test that validation includes profile metadata.

## Out Of Scope

- No separate model invocation required in this issue.
- No full validator agent prompt authoring.

## Prior Art / Pattern Notes

Use maker/checker routing as a pattern reference. Implement original SDLC-rstack registry logic using local stage and registry primitives.

