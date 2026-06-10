<!-- owner: RStack developed by Richardson Gunde -->

# RStack Design History

This document records the current known development state of RStack so the research paper has a primary-source narrative. It should be updated after major roadmap milestones.

## Current audited state

- **Repository:** `richard-devbot/SDLC-rstack`
- **Audited branch:** `main`
- **Audited HEAD:** `b559aa4` — `CodeRabbit Generated Unit Tests: Add generated unit tests (#69)`
- **Package:** `rstack-agents@1.8.0`
- **License:** MIT
- **Primary interface:** npm package plus CLI and Business Hub
- **Docs:** Mintlify documentation under `docs/mintlify`

## Product position

RStack is a governed AI-SDLC operating layer for any coding framework. It sits above Pi, Claude Code, Operator, Codex-style CLIs, Gemini-style CLIs, or a custom harness and provides:

- lifecycle structure,
- approvals,
- builder/validator contracts,
- evidence,
- memory,
- budget envelopes,
- Business Hub observability.

The current lifecycle is:

```text
clarify → plan → spec → approve → build → validate → release-readiness → learn
```

## Implementation layers

The source layout currently communicates the platform shape:

```text
src/core/harness/   — core SDLC runtime: stages, contracts, evidence, guardrails, run-state
src/core/tracker/   — project registry and approval queue
src/memory/         — episodic memory and diagnostics
src/notifications/  — Slack, Discord, Teams, Telegram, WhatsApp, HTTP routing
src/observability/  — collectors, Business Hub dashboard, metrics, alerts
src/hooks/          — auto-launch helpers
src/commands/       — CLI commands
src/integrations/   — Pi and Operator adapters plus init logic
```

## Package and catalog inventory

At the audit point, the tracked repository contained:

- 1,693 tracked files,
- 195 agent markdown files,
- 156 packaged skills,
- 72 plugin manifests,
- 28 JavaScript test files,
- 35 Mintlify MDX docs pages,
- 4 GitHub workflow files.

This confirms RStack is both a software package and a reusable catalog of SDLC assets.

## Key implemented capabilities

### One-package install

Users install and initialize with:

```bash
npm install rstack-agents
npx rstack-agents init --profile business-flex
```

### Framework detection and init

`src/integrations/init.js` detects or configures:

- Pi,
- Claude Code,
- Operator,
- custom harnesses.

It creates `.rstack/`, writes profile and budget policy files, registers the project for Business Hub, and avoids overwriting existing user files.

### Profiles

`src/core/profiles.js` defines:

- `business-flex`,
- `lean-mvp`,
- `enterprise-webapp`.

Profiles control domains, enabled agents, enabled plugins, workflow, dashboard pages, stage order, and budget defaults.

### Canonical stages

`src/core/harness/stages.js` defines 15 stages:

1. Environment
2. Transcript
3. Requirements
4. Documentation
5. Planning
6. Jira
7. Architecture
8. Code
9. Testing
10. Deployment
11. Summary
12. Feedback loop
13. Security threat model
14. Compliance checker
15. Cost estimation

### Contracts

`src/core/harness/contracts.js` validates builder and validator contracts. Builder contracts capture status, summary, modified files, tests run, risks, and next steps. Validator contracts capture checks, issues, and retry recommendation.

### Evidence

`src/core/harness/evidence.js` validates and appends evidence events to `evidence.jsonl`.

### Guardrails

`src/core/harness/guardrails.js` defines default max attempts, max tool calls, required contracts, required evidence, and approval requirements for destructive/publish/force-push actions.

### Approval model

`src/core/tracker/approvals.js` implements approval queue handling, safe run ID validation, manager allowlist checks, and run-level approval writes.

### Business Hub state model

`src/observability/dashboard/state/index.js` composes the Business Hub state from real project roots and `.rstack` files. It builds runs, approvals, alerts, traceability, stage matrix, agent work, projects, trends, people, Business Flex state, and diagnostics.

## Current gaps

RStack's current implementation is strong enough to support a research paper but should not overstate future features. These are not complete yet:

- Decision Queue / Definition-of-Ready gate,
- formal RStack Spec and schemas,
- cross-harness review enforcement,
- attestation envelopes,
- drift detector,
- untrusted PR gate,
- RFC/ADR process,
- governance packs,
- native MCP/A2A server,
- actual provider cost ingestion across hosts.

## Why #77 comes first

Issue #77 creates the research substrate before implementing more roadmap features. This is necessary because future claims about productivity and governance need:

- bibliography,
- methodology,
- prior-art comparison,
- productivity claims register,
- paper outline,
- claims discipline.

Without #77, later features risk becoming a list of product tasks instead of a research-backed development program.