# ISO/IEC 42001:2023 → RStack evidence mapping

<!-- owner: RStack developed by Richardson Gunde -->

This pack maps ISO/IEC 42001 AI management system (AIMS) clauses onto the
RStack artifacts that evidence them. It adds no enforcement — it makes the
evidence a governed run already produces citable in an AIMS audit.

| ISO/IEC 42001 clause | What the auditor asks | RStack evidence |
| --- | --- | --- |
| **5 Leadership** — policy, roles, responsibilities | Is there a written AI policy and are roles assigned? | `.rstack/policy.json` (managers, required approvals, review_policy), profile posture in `rstack.config.json`, approval records with named actors |
| **6 Planning** — objectives, risk criteria | Are AI objectives and risk treatments planned before execution? | run `manifest.json` goal, decision queue + `dor-report.json`, budget envelopes in `budget.json`, stage-12 threat model with mitigations |
| **7 Support** — resources, competence, documented information | Is documented information controlled and attributable? | atomic, schema-versioned run artifacts under `.rstack/runs/`, contract identity fields (agent/harness/model), attestation envelopes |
| **8 Operation** — operational planning and control | Is the AI lifecycle actually controlled, not just documented? | stage gates and approvals in `events.jsonl`, guardrail evaluations, validator contracts per task, checkpoint/rollback records |
| **9 Performance evaluation** — monitoring, measurement, audit | Is the system monitored and internally audited? | Business Hub observability state, `rstack-agents drift` reports, `verify-attestations` results, memory diagnostics |
| **10 Improvement** — nonconformity and corrective action | Are failures categorized and corrected? | retry-policy decisions, stage-10 defect analysis (Ishikawa cause buckets), stage-11 maintenance taxonomy (corrective/perfective) |

## Using this in an audit

For each audited run, export `rstack-agents drift <run> --json`,
`rstack-agents verify-attestations <run> --json`, and the run's
`approvals.json` + `events.jsonl` — clauses 8–10 are then evidenced by
machine-checked records instead of interviews.
