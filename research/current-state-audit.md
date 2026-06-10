<!-- owner: RStack developed by Richardson Gunde -->

# RStack Current-State Audit

This audit captures where RStack stood immediately before starting issue #77. It is intentionally detailed because it will become source material for the research paper and for the next implementation slices.

## Audit metadata

- **Repository:** `richard-devbot/SDLC-rstack`
- **Branch audited:** `main`
- **HEAD audited:** `b559aa4` — `CodeRabbit Generated Unit Tests: Add generated unit tests (#69)`
- **Package:** `rstack-agents@1.8.0`
- **Issue driving this work:** #77 — research bibliography and methodology appendix
- **Epic:** #79 — research-backed RStack AI-SDLC roadmap

## Executive summary

RStack currently stands as a working, packaged AI-SDLC operating layer with a strong business/product surface:

- one-package npm installation,
- host-framework initialization,
- `.rstack` state contract,
- built-in business profiles,
- budget policy support,
- 15 canonical SDLC stages,
- builder/validator contracts,
- evidence event logging,
- approval queue and manager policy,
- Business Hub observability,
- Mintlify documentation,
- a large agent/skill/plugin catalog.

The strongest current product claim is:

> RStack gives AI coding agents a repeatable, observable, governed SDLC lifecycle instead of ad-hoc prompting.

The strongest research gap is:

> RStack needs a disciplined bibliography, methodology, claims register, and prior-art comparison before it can credibly claim productivity improvements.

## Current implementation map

### Package layer

`package.json` defines:

- package name: `rstack-agents`,
- version: `1.8.0`,
- CLI bins: `rstack-agents`, `rstack-observer`, `rstack-operator-bridge`, `rstack-business`,
- scripts: test, validate, lint, prepublishOnly, business hub,
- package files: `bin/`, `src/`, `extensions/`, `agents/`, `skills/`, `prompts/`, `plugins/`, selected docs, `operator.json`, `README.md`.

### CLI layer

`bin/rstack-agents.js` currently supports:

- `list agents|skills|plugins`,
- `add plugin <name>`,
- `init`,
- `hub`,
- `notify`,
- `validate`.

CLI gaps relative to roadmap:

- no `decisions`,
- no `dor`,
- no `drift`,
- no `attest`,
- no `verify-attestations`,
- no `packs` command,
- no research helper command.

### Init and adapter layer

`src/integrations/init.js` detects or configures:

- Pi,
- Claude Code,
- Operator,
- custom harnesses.

It writes `.rstack/rstack.config.json`, `.rstack/budget.json`, framework-specific guidance, and Business Hub auto-launch hooks where possible. It is explicitly non-destructive and avoids overwriting user files.

### Profile layer

`src/core/profiles.js` defines:

- `business-flex`,
- `lean-mvp`,
- `enterprise-webapp`.

Each profile configures domains, agents, plugins, workflow, dashboard pages, stage order, and budget policy.

Profile gaps:

- profiles do not yet map to governance packs,
- profile enforcement is mostly advisory/configuration-driven,
- physical pack pruning is not implemented,
- enterprise hard gates are not implemented yet.

### SDLC runtime layer

`src/core/harness/stages.js` defines 15 canonical stages. `src/core/harness/run-state.js` prepares run folders and supports stage checkpoints and rollback.

Runtime gaps:

- no first-class readiness gate,
- no decisions artifact,
- no formal schema validation for every run artifact,
- rollback is stage-artifact based rather than full Git/worktree orchestration.

### Contract and evidence layer

`src/core/harness/contracts.js` validates builder and validator contracts.

`src/core/harness/evidence.js` writes evidence events to JSONL.

Contract/evidence gaps:

- no schema files for public spec yet,
- no harness/model fields required yet,
- no cross-harness independence check,
- no signed or signable attestation envelope,
- validator read-only enforcement depends on host behavior.

### Approval/governance layer

`src/core/tracker/approvals.js` implements:

- approval queue IDs,
- safe run ID validation,
- artifact name safety,
- manager allowlist policy,
- queue and run-level approval writes,
- dashboard approval resolution.

Governance gaps:

- approval gates exist, but DoR/readiness gate does not,
- no waiver/decision object model,
- no governance pack mapping,
- no NIST/ISO/EU AI Act control mapping yet.

### Business Hub layer

`src/observability/dashboard/state/index.js` composes dashboard state from real `.rstack` files.

State modules provide:

- run loading,
- activity timeline,
- stage matrix,
- agent work,
- traceability,
- project summaries,
- approvals,
- alerts,
- people/presence,
- Business Flex state,
- diagnostics.

Business Hub gaps:

- no Decision Queue panel,
- no DoR panel,
- no attestation timeline,
- no drift findings panel,
- no review-independence status,
- no research/claims dashboard.

### Documentation layer

Mintlify docs currently cover:

- introduction,
- quickstart,
- installation,
- first run,
- governance model,
- Business Flex profiles,
- builder/validator sandbox,
- Business Hub,
- approvals,
- webhooks,
- concepts,
- adapters,
- SDLC pipeline,
- reference pages,
- loopholes/roadmap.

Documentation gaps:

- no `research/` docs before #77,
- no paper outline,
- no bibliography,
- no methodology,
- no claims discipline page,
- no prior-art comparison page.

## Roadmap dependency analysis

#77 should happen before the other research-backed roadmap items because it provides the evidence discipline for all later work.

Recommended order:

1. **#77 Research bibliography/methodology** — establishes claims discipline.
2. **#76 RFC/ADR process** — records design decisions before implementing major features.
3. **#70 Decision Queue / DoR** — first major reliability feature.
4. **#71 RStack Spec** — formalizes artifacts once DoR/decisions are designed.
5. **#72 Cross-harness validation** — strengthens validator trust.
6. **#73 Attestations** — wraps contracts/evidence in verifiable envelopes.
7. **#74 Drift detection** — turns traceability UI into a gate/checker.
8. **#75 Untrusted PR gate** — hardens public contribution flow.
9. **#78 Governance packs** — packages governance maturity levels for users.

## What we are implementing in #77

Issue #77 is not a runtime feature. It is a research foundation slice.

Concrete outputs:

```text
research/
  bibliography.md
  methodology.md
  prior-art-ai-sdlc-framework.md
  productivity-claims.md
  rstack-design-history.md
  paper-outline.md
  current-state-audit.md
```

Documentation links:

- README link to research folder,
- Mintlify research page,
- Mintlify navigation entry.

Validation:

- `npm test`,
- `npm run lint`,
- `npm run validate`,
- `git diff --check`.

## Paper-safe current conclusion

The current implementation supports this claim:

> RStack implements a governed AI-SDLC operating layer with lifecycle stages, profiles, approvals, builder/validator contracts, evidence logging, budget envelopes, adapter setup, and Business Hub observability.

The current implementation does **not yet** support this as a measured fact:

> RStack improves productivity by a quantified percentage.

The correct research framing is:

> RStack creates the structure needed to measure and improve AI-assisted delivery productivity. Future studies should compare governed RStack runs against ad-hoc agent workflows using explicit metrics.
