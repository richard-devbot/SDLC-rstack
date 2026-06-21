<!-- owner: RStack developed by Richardson Gunde -->

# Backend Loop Engineering v1 - GitHub Issue Pack

This directory contains the backend-first loop engineering issue pack for SDLC-rstack.

The active filing set is under:

```text
docs/github-issues/backend-loop-engineering-v1/
```

Older `PHASE-*` files are retained as historical analysis from the first Claude-generated pass. Do not file those older shell-first issues directly. The current issue pack uses Node-native harness modules first and treats shell wrappers as optional thin adapters later.

## Summary

| Epic | Title | Issues | Primary backend outcome |
| --- | --- | ---: | --- |
| 0 | Control Plane Inventory | 2 | Every runnable backend surface is visible |
| 1 | Harness State Spine | 3 | Regenerable `pipeline-state.json` rollup and CLI status |
| 2 | Builder / Validator Contracts | 3 | Machine-checkable work and validator sandbox policy |
| 3 | Retry + Recovery Loop | 3 | Deterministic retry/recovery transitions and trace events |
| 4 | Goal Loop | 3 | Structured goal evaluation and bounded loop runner |
| 5 | Guardrails, Approvals, Checkpoints | 3 | Stronger safety gates and rollback support |
| 6 | Cost, Context, Memory | 3 | Bounded telemetry and trusted memory policy |

Total: **7 epics, 20 implementation issues**.

## Active Issue Files

### Epic 0 - Control Plane Inventory

- `backend-loop-engineering-v1/00-epic-control-plane-inventory.md`
- `backend-loop-engineering-v1/00-01-inventory-runtime-surfaces.md`
- `backend-loop-engineering-v1/00-02-document-runtime-differences.md`

### Epic 1 - Harness State Spine

- `backend-loop-engineering-v1/01-epic-harness-state-spine.md`
- `backend-loop-engineering-v1/01-01-add-pipeline-state-rollup.md`
- `backend-loop-engineering-v1/01-02-add-pipeline-status-cli.md`
- `backend-loop-engineering-v1/01-03-normalize-sdlc-agent-paths.md`

### Epic 2 - Builder / Validator Contracts

- `backend-loop-engineering-v1/02-epic-builder-validator-contracts.md`
- `backend-loop-engineering-v1/02-01-enforce-builder-contract-completeness.md`
- `backend-loop-engineering-v1/02-02-add-validator-sandbox-policy.md`
- `backend-loop-engineering-v1/02-03-add-validator-registry.md`

### Epic 3 - Retry + Recovery Loop

- `backend-loop-engineering-v1/03-epic-retry-recovery-loop.md`
- `backend-loop-engineering-v1/03-01-add-retry-policy-module.md`
- `backend-loop-engineering-v1/03-02-add-resume-aware-runner.md`
- `backend-loop-engineering-v1/03-03-add-retry-event-trace.md`

### Epic 4 - Goal Loop

- `backend-loop-engineering-v1/04-epic-goal-loop.md`
- `backend-loop-engineering-v1/04-01-add-goal-evaluator.md`
- `backend-loop-engineering-v1/04-02-update-agent-11-goal-contract.md`
- `backend-loop-engineering-v1/04-03-add-bounded-loop-runner.md`

### Epic 5 - Guardrails, Approvals, Checkpoints

- `backend-loop-engineering-v1/05-epic-guardrails-approvals-checkpoints.md`
- `backend-loop-engineering-v1/05-01-strengthen-destructive-gates.md`
- `backend-loop-engineering-v1/05-02-checkpoint-critical-stages.md`
- `backend-loop-engineering-v1/05-03-add-approval-audit-consistency.md`

### Epic 6 - Cost, Context, Memory

- `backend-loop-engineering-v1/06-epic-cost-context-memory.md`
- `backend-loop-engineering-v1/06-01-populate-cost-context-fields.md`
- `backend-loop-engineering-v1/06-02-add-context-pressure-warnings.md`
- `backend-loop-engineering-v1/06-03-tighten-memory-write-policy.md`

## Filing Issues

Use the helper script:

```bash
./scripts/push-loop-engineering-issues.sh --dry-run
./scripts/push-loop-engineering-issues.sh --apply
```

The script files **Backend Loop Engineering v1** issues from the active backend pack only. It checks for existing issues by title before creating new ones.

## Implementation Policy

Use external projects only as pattern references:

- Durable execution records
- Bounded retries
- Maker/checker validation
- Human approval gates
- Checkpoints and rollback
- Traceable guardrail events
- Cost/context observability
- Trusted memory policy

Do not copy external source code. Each issue states: implement original SDLC-rstack code using existing harness primitives.

## Verification Expectations

Before filing or merging implementation work:

- [ ] `npm run validate`
- [ ] `npm run lint`
- [ ] Relevant unit tests for changed harness modules
- [ ] Contract/reference checks for edited docs or agents

