<!-- owner: RStack developed by Richardson Gunde -->

# RStack SDLC productivity roadmap

This roadmap aligns RStack with current AI-driven SDLC and spec-driven development guidance from AWS AI-DLC, CircleCI, Martin Fowler/Thoughtworks, and `awslabs/aidlc-workflows`.

## Reference synthesis

- AWS AI-DLC: AI should be a central SDLC collaborator, not only a coding assistant. The lifecycle repeats plan, clarify, human-validate, then execute across inception, construction, and operations. Persistent artifacts in the repo carry context between phases.
- AWS `aidlc-workflows`: practical implementation is rules/steering files plus generated `aidlc-docs/`, inputs, traceability, design review, evaluators, CI/security scanners, and platform-specific setup for Kiro, Amazon Q, Cursor, Cline, Claude Code, GitHub Copilot.
- CircleCI AI SDLC: AI makes work parallel and bidirectional. The bottleneck moves from code generation to validation, review, security, architecture judgment, CI speed, and deployment confidence.
- Martin Fowler on SDD: spec-driven development is still evolving. Treat specs as source-of-truth artifacts, but avoid over-heavy process. Brownfield adoption is harder. Humans must verify and refine each phase, not just steer.
- Ran Isenberg AI-SDLC: production AI adoption needs standardized agent skills, team extension skills, shared prompt libraries, centralized secure tool access, support/incident agents, small PRs, governance, and security from the start.

## Current RStack strengths

- Package-local Pi extension with clean install surface.
- Orchestrator, builder, validator operating model.
- 196 packaged agents, 68 skills, 36 prompts, 72 plugins.
- `.rstack/runs/<run_id>/` state for manifest, plan, tasks, specs, approvals, traceability, builder contracts, validator contracts, memory, and events.
- `sdlc_spec` manages durable spec artifacts; `sdlc_approve` records explicit human validation gates.
- `.rstack/registry/{registry,agents,skills,plugins,routing}.json` is generated on demand for routing visibility.
- `sdlc_delegate` can spawn isolated Pi workers and defaults validator/reviewer/security agents to read-only tools.
- Tests now validate extension registration, harness behavior, agent frontmatter, duplicate names, package assets, and agent references.

## Gaps before claiming production-grade AI-SDLC

### P0: Spec artifacts and traceability — implemented baseline

RStack now creates first-class generated spec files, not only task JSON. Remaining work: enrich traceability with actual file/test evidence from builders and validators.

Recommended package behavior:

```text
.rstack/runs/<run_id>/specs/
  vision.md
  requirements.md
  architecture.md
  task-breakdown.md
  test-strategy.md
  security-review.md
  release-readiness.md
  traceability.json
```

`traceability.json` should map:

```text
requirement -> design decision -> task -> files changed -> tests -> validation evidence
```

### P0: Human validation gates — implemented baseline

RStack now has `sdlc_approve` plus interactive build gating. Remaining work: add richer destructive-action gates and PR/release gate integrations.

- requirements approved
- architecture approved
- task plan approved
- destructive action approved
- release approved

Pi implementation: `sdlc_approve` writes `approvals.json` under the run directory and records approval traceability.

### P0: CI and security validation — implemented baseline

Package-level GitHub Actions now run tests, validation, npm pack dry-run, dependency audit, and secret scan. Remaining work: generated-project checks and PR-size warning.

- secret scan
- dependency audit
- static analysis hooks where possible
- PR-size warning
- test evidence capture
- npm package integrity check

### P1: Team routing registry — implemented baseline

The current registry still infers domains mostly from paths/text, but now emits explicit registry metadata files:

```text
registry/agents.json
registry/skills.json
registry/plugins.json
registry/routing.json
```

Each agent should declare:

```json
{
  "name": "api-builder",
  "team": "builder",
  "domains": ["backend", "api"],
  "defaultTools": ["read", "bash", "edit", "write", "grep", "find", "ls"],
  "requiredSkills": ["security-owasp", "code-review-pr"],
  "recommendedPlugins": ["backend-development"]
}
```

### P1: Evaluation harness — partially implemented

Added `tests/harness.test.js` for deterministic extension-level behavior. Remaining evals:

- can start a run
- can plan a simple feature
- can delegate read-only validation
- blocks validator writes
- produces traceability
- package installs locally with `pi install .`

### P1: Output size and context hygiene

`sdlc_delegate` should summarize subagent output and cap child transcript size. Keep raw worker logs on disk, pass concise summaries to the main model.

### P2: Secure tool broker / MCP broker adapter

RStack should not expose arbitrary organization tools directly. Add optional MCP/tool-broker integration later with policy:

- approved tools only
- least privilege by role
- audit log per tool call
- no secret exfiltration

### P2: Operations and incident phase

Add operational agents and workflows:

- post-deploy canary
- incident summary
- root cause analysis
- rollback plan
- learning capture

## 100% productive definition

Do not claim 100% because AI-SDLC is inherently non-deterministic. Claim "production-ready foundation" when these are true:

- A new user can install with one command.
- The extension loads without TypeScript/runtime errors.
- A run creates durable specs, tasks, and traceability.
- Builders and validators have correct tools by default.
- Human approvals are explicit.
- CI/test/security evidence is captured.
- Package contents are clean and intentional.
- There is an eval suite that proves the above on a toy repo.

## Recommended next build order

1. Add `sdlc_spec` and generated spec files.
2. Add `sdlc_approve` human gate tool.
3. Add `traceability.json` generation and validation.
4. Add explicit `registry/*.json` metadata.
5. Add local install/e2e eval with a toy repo.
6. Add CI workflow for `npm test`, `npm run validate`, `npm pack --dry-run`.
7. Add optional security scans and secret scanning.
