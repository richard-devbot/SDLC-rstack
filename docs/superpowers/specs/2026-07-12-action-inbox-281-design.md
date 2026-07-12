# Normalized Action Inbox (#281)

RStack developed by Richardson Gunde

## Outcome

Action Inbox is the single scoped queue for human attention across approvals, decisions, guardrails, failed validations, exhausted retries, alerts, configuration problems, and audit-invalid records. Overview and later Operations consume the same normalized list and count.

## Contract

Each action contains `id`, `type`, `severity`, `blocking`, `title`, `consequence`, `nextStep`, scope (`projectId`, `projectRoot`, `runId`, `stageId`, `taskId`), owner/audience, lifecycle timestamps, normalized `status`, source metadata, `allowedActions`, audit metadata, freshness, and availability.

Status is one of `open | claimed | approved | rejected | consumed | resolved | expired`. Availability is `available | stale | invalid | unavailable`. Unknown source values remain explicit.

## Producers

- queue/run approvals, preserving lifecycle verbatim;
- pending architecture/product decisions;
- blocked approval gates;
- failed or guardrail-blocked tasks and validations;
- pipeline retry exhaustion, with a state-derived safety net deduped against #274 queue entries;
- critical/warning alerts;
- configuration diagnostics;
- `approval_audit_failed` records, visible as invalid rather than silently dropped.

## Ordering and deduplication

Canonical identity is source kind + record ID/path + canonical scope. Exact source duplicates group into one action with `signals[]`. Ordering is blocking first, severity (`critical`, `high`, `medium`, `low`), then oldest unresolved item, then stable ID.

## Authority

The projection never invents a mutation. `allowedActions` is copied only from server-declared records. Existing approval cards remain the authenticated/audited mutation surface until #285 introduces a broader action-discovery contract. Inbox primary actions therefore route to safe existing pages or protected server-declared actions.

Stale, invalid, or unavailable records expose no mutations and explain why. “Needs me” is hidden unless authenticated identity is explicitly present.

## UX

The Decisions destination becomes Action Inbox with filters for All, Blocking, Approvals, Decisions, Failures, and Resolved. Each card leads with consequence and next step, then scope/owner/age/source. Technical detail remains expandable/secondary. Overview uses the same first open action and action count.

At 390px filters scroll inside their own labeled row, cards stack, source paths wrap, and no core action causes page-level overflow.

## Verification

Fixtures cover every producer, ordering, dedupe, lifecycle, stale/invalid fail-closed behavior, missing identity, cross-project isolation, and empty state. Existing approval authentication/audit/security tests remain unchanged and pass.
