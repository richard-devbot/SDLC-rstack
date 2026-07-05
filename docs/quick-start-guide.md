<!-- owner: RStack developed by Richardson Gunde -->

# RStack in 5 Minutes

From empty terminal to a governed SDLC run with a live dashboard — one goal,
one approval, one validated task. No prior RStack knowledge assumed.

## What you need

- **Node.js 18+** and **git** (`node --version`, `git --version`)
- Any project directory (a fresh `mkdir demo && cd demo && git init` is fine)
- Optional but recommended: an AI coding framework — [Pi](integrations/pi.md),
  [Claude Code](integrations/claude-code.md), or
  [Operator](integrations/operator.md). **Not required for this guide** —
  everything below runs from a bare terminal through the bridge.

## Minute 1 — install and initialize

```bash
cd your-project
npm install rstack-agents
npx rstack-agents init --profile business-flex
```

`init` detects your framework (or falls back to `custom`), creates `.rstack/`
(run state, budget policy, registry), scaffolds bootstrap files, and **never
overwrites existing files**. An existing codebase is adopted, not reset.

## Minute 2 — start a governed run

Every RStack tool is callable from the terminal via the bridge — the same
harness your framework would drive:

```bash
alias rstack-tool="RSTACK_PROJECT_ROOT=\"\$(pwd)\" npx tsx node_modules/rstack-agents/bin/rstack-operator-bridge.ts"

rstack-tool sdlc_start '{"goal":"Build a health-check API endpoint"}'
rstack-tool sdlc_plan '{}'
```

You now have a run under `.rstack/runs/<run_id>/` with a task plan, budget
envelopes, and specs — and nothing has executed yet, because…

## Minute 3 — hit the approval gate (this is the point)

```bash
rstack-tool sdlc_build_next '{}'
```

This **blocks**: `Approval gate blocked … Missing approval(s): plan.md`.
RStack never builds without a human sign-off on the plan. Approve it:

```bash
rstack-tool sdlc_approve '{"artifact":"plan.md","status":"APPROVED","comments":"Plan looks right"}'
rstack-tool sdlc_build_next '{}'
```

Now you get a **builder task packet** — the prompt your coding agent (or you)
executes. It specifies the canonical output paths and the `builder.json`
contract the work must produce.

## Minute 4 — watch it live

```bash
npx rstack-agents hub          # Business Hub on http://localhost:3008
npx rstack-agents pipeline status   # same truth, in the terminal
```

The Hub shows your run on the Command Center, the approval you just granted
under Approvals, and the 15-stage Workflow Map. `pipeline status` prints the
stage counts, blockers, and **one recommended next action** — CI-friendly with
`--json`.

## Minute 5 — validate with evidence

After the builder task's work exists (for a first tour, write the
`builder.json` the packet asks for with a short summary and evidence):

```bash
rstack-tool sdlc_validate '{}'
```

Validation checks the contract — evidence, tests run, memory summaries,
per-stage summaries — and stamps PASS or FAIL with a retry recommendation.
FAIL twice and the guardrail gate hard-blocks the task until a human approves
a one-shot `guardrail-override`. That's the governed loop: **clarify → plan →
approve → build → validate → evidence**.

## Where to go next

| You want | Go to |
|---|---|
| Your framework driving this instead of the bridge | [mintlify/getting-started/install-your-framework.mdx](mintlify/getting-started/install-your-framework.mdx) |
| Lighter/heavier governance | `npx rstack-agents init --profile lean-mvp` or `enterprise-webapp` |
| The full harness contract (state layout, builder/validator schemas, guardrails) | [HARNESS.md](HARNESS.md) |
| Decision queue + Definition-of-Ready gates | `npx rstack-agents decisions --help`, `npx rstack-agents dor --help` |
| Adopting a large existing codebase | `npx rstack-agents adopt --dry-run` — see the [brownfield guide](brownfield-adoption.md) |

**Troubleshooting:** `npx rstack-agents pipeline status --regenerate` rebuilds
run state from artifacts; the Diagnostics page in the Hub lists damaged files
and invalid config values with the exact field named.
