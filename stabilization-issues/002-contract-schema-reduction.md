# 002 – Minimal Contract Schema
**Disadvantage**: Contract fatigue – oversized JSON files.
**Proposed remediation**
- Define a new schema (remove optional `stage_summaries` unless needed).
- Update every existing `builder.json` via `committing‑work`.
- Add a CI check that validates the schema on every commit.
**Web‑research needed**
- "JSON schema minimalism for CI pipelines"
- "How to enforce contract validation in CI"
**Acceptance criteria**
- All `builder.json` files contain only: `task_id`, `agent`, `status`, `summary`, `files_modified`, `tests_run`, `memory_summary`, `cost`.
- CI fails if extra fields appear.
