# RStack Harness

<!-- owner: RStack developed by Richardson Gunde -->

The RStack Harness is the reliability layer around the agents, skills, prompts, and plugins in this package. It does not replace agents. It gives them deterministic run state, contract checks, evidence, and guardrails so a task cannot be treated as complete based on prose alone.

## Canonical SDLC stages

The canonical 15-stage SDLC pipeline lives in `src/harness/stages.js`:

```text
00-environment
01-transcript
02-requirements
03-documentation
04-planning
05-jira
06-architecture
07-code
08-testing
09-deployment
10-summary
11-feedback-loop
12-security-threat-model
13-compliance-checker
14-cost-estimation
```

Tests fail if the list is not exactly 15 stages or if the order changes.

## Run folder shape

New runs prepare clean stage folders under:

```text
.rstack/runs/<run_id>/
  artifacts/
    stages/
      00-environment/
      01-transcript/
      ...
      14-cost-estimation/
  tasks/<task_id>/
    prompt.md
    builder.json
    validation.json
  events.jsonl
```

Root artifacts such as `artifacts/requirements.json` remain compatibility outputs. Canonical stage output should go under `artifacts/stages/<stage-id>/` when a stage target is listed in the task prompt.

## Contract checks

Builder contracts are validated by `src/harness/contracts.js` and require:

```text
task_id, agent, status, summary, files_modified, tests_run, risks, next_steps
```

Validator contracts require:

```text
task_id, validator, status, checks, issues, retry_recommendation
```

The Pi extension uses these shared checks in `sdlc_validate`. For PASS and DONE_WITH_CONCERNS builders, `sdlc_validate` also requires meaningful `summary`, non-empty `tests_run`, `memory_summary.work_done`, `memory_summary.evidence`, and one evidence-backed `stage_summaries` entry for each canonical stage target listed in the task prompt.

## Evidence ledger

Raw runtime events are appended to `events.jsonl`. Validator-grounded task evidence is appended to `evidence.jsonl` with:

```json
{"task_id":"004-implementation","kind":"validation","status":"PASS","evidence":"tasks/004-implementation/validation.json"}
```

`src/harness/evidence.js` rejects missing `task_id`, `kind`, `status`, or `evidence` fields.

## Agent episodic memory

Validator-approved tasks are written to an agent/stage scoped episodic memory store by `src/harness/memory.js`.

Default storage is configurable and resolves to:

```text
${RSTACK_HOME:-~/.rstack}/projects/<project-slug>/memory/
  episodes.jsonl
  facts.jsonl
  retractions.jsonl
  retrieval-events.jsonl
```

Override storage without changing code by setting `RSTACK_MEMORY_DIR` or by adding `.rstack/memory-config.json`:

```json
{
  "memory": {
    "backend": "jsonl",
    "retrieval": "lexical",
    "topK": 3,
    "maxInjectedChars": 1800,
    "writePolicy": "validator-approved-only",
    "embeddingProvider": "none"
  }
}
```

Memory is injected into builder prompts only as bounded historical context. It is explicitly non-authoritative and cannot override the current task, user approvals, tool safety, or validator gates.

Every builder prompt asks agents to add compact summary fields to `builder.json`:

```json
{
  "memory_summary": {
    "work_done": "",
    "decisions": [],
    "evidence": [],
    "context_to_keep": [],
    "context_to_drop": [],
    "next_agent_hints": []
  },
  "stage_summaries": [
    {
      "stage_id": "07-code",
      "agent_id": "agent.07-code",
      "work_done": "",
      "evidence": [],
      "context_to_keep": [],
      "context_to_drop": []
    }
  ]
}
```

This is the context-reduction path. Later agents receive durable decisions, evidence, and handoff hints instead of full transcripts or raw logs.

## Guardrails

Guardrail defaults live in `src/harness/guardrails.js`:

- `maxTaskAttempts: 2`
- `maxDestructiveTaskAttempts: 1`
- `maxToolCallsPerTask: 40`
- `maxMessagesPerTask: 25`
- `requireBuilderContract: true`
- `requireValidatorContract: true`
- `requireEvidenceForPass: true`
- `requireUserApprovalForDestructiveActions: true`
- `requireUserApprovalForPublishDeployOrForcePush: true`

The extension includes this summary in generated builder prompts.

## Validation commands

Run these after Harness changes:

```bash
cd /Users/richardsongunde/projects/SDLC-rstack
npm test
npm run validate
```

Also run lint for code-level checks:

```bash
npm run lint
```

## Safety notes

The Harness foundation does not add auth, payment processing, PII storage, public APIs, deploy automation, or npm publishing. Publishing, deployment, force-push, and destructive cleanup still require explicit user approval.
