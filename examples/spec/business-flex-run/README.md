# Conformance example: one governed business-flex run

<!-- owner: RStack developed by Richardson Gunde -->

This directory is a complete, secret-free example of the on-disk state one governed
RStack run produces, plus one example resource per Kubernetes-style spec projection.
Every file here validates against the schemas in [`spec/schemas/`](../../../spec/schemas/)
— CI runs `rstack-agents validate --schemas` against this directory on every push.

The run tells a real governance story:

1. **`manifest.json`** — the run started interactive on the business-flex profile and
   finished `DONE` (`schema_version: 2`).
2. **`tasks.json`** — two of the plan's tasks shown: `004-implementation` (stage
   `07-code`) and `005-testing` (stage `08-testing`), both `PASS`, each with routing,
   stage artifacts, and a budget envelope exactly as `sdlc_plan` writes them.
3. **`approvals.json`** — three records showing the two approval flavors:
   - `stage-approval:07-code` **APPROVED** — the #228 blanket per-stage human gate;
   - `guardrail-override:004-implementation` **APPROVED → CONSUMED** — the one-shot
     retry-budget override lifecycle: a human approved one more attempt, the harness
     consumed it inside the claim critical section, and latest-record-wins means the
     spent override can never unblock again.
4. **`decisions.json`** — one resolved Decision Queue item (`DEC-001`), gated before
   `06-architecture`.
5. **`evidence.jsonl`** — the audit ledger lines the validations appended.
6. **`tasks/004-implementation/`** — a passing `builder.json` (with memory summary,
   stage summaries, and telemetry) and its `validation.json` (checks, independence
   verdict, `retry_recommendation: none`).
7. **`attestations/`** — the builder contract wrapped in an unsigned
   `rstack.dev/attestation/v1alpha1` envelope (checksums still detect drift).
8. **`resources/`** — one example per envelope schema (`Run`, `Task`, `Decision`,
   `Gate`, `Profile`, `Project`, `AgentRole`, `Adapter`). These are spec resource
   projections; the raw files above are what RStack actually writes.

Validate it yourself:

```bash
npx rstack-agents validate --schemas
```

See [`spec/rstack-spec.md`](../../../spec/rstack-spec.md) for the normative spec and
[`spec/conformance.md`](../../../spec/conformance.md) for what each conformance level
requires.
