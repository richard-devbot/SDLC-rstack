# Contributing to SDLC-rstack

SDLC-rstack is an original agentic SDLC framework developed by Richardson Gunde. This document explains how to contribute, how we handle intellectual property, and what every PR must pass before merging.

---

## Quick start

```bash
git clone https://github.com/richard-devbot/SDLC-rstack.git
cd SDLC-rstack
npm ci
npm test          # must pass before you commit
npm run validate  # must pass before you commit
```

---

## Branching and merging rules

- `main` is the stable branch. Never push directly to `main`.
- Create feature branches from `main`: `feature/<short-description>` or `fix/<short-description>`
- Keep branches short-lived. Merge within the sprint they were created in.
- Rebase onto `main` before opening a PR — never merge `main` into your feature branch.
  ```bash
  git fetch origin
  git rebase origin/main
  ```
- Delete branches after merging. Keep the remote clean.

**No merge conflicts on `main`.** If your PR has conflicts, resolve them on the feature branch before requesting review.

---

## CI checks — every PR must pass all of these

The `validate-agents` workflow runs on every push or PR touching `agents/`, `skills/`, `plugins/`, `src/`, or `tests/`:

| Check | Command | What it validates |
|-------|---------|-------------------|
| Unit tests | `npm test` | All tests in `tests/*.test.js` |
| Agent validation | `npm run validate` | All agent frontmatter: `name`, `description`, valid `^[a-z][a-z0-9-]*$` format |
| Lint (local only) | `npm run lint` | ESLint on `src/`, `bin/`, `tests/` |
| Pack dry-run (release only) | `npm pack --dry-run` | Verifies `package.json` files array is correct |

**Do not open a PR if `npm test` or `npm run validate` fails locally.** Fix it first.

If you add a new agent, run `npm run validate` and confirm the agent appears in the validation output before committing.

---

## Intellectual property rules

SDLC-rstack is built by studying patterns from across the AI engineering field — research papers, open source projects, blog posts, and documentation. We learn from these and implement our own original versions.

### What this means in practice

**Allowed:**
- Reading open source code to understand a pattern or algorithm
- Implementing the same concept from scratch in our own code
- Citing where you learned about a concept in issue or PR descriptions
- Using publicly available formulas (e.g., token cost rates from Anthropic's pricing page)

**Not allowed:**
- Copying code from another project, even open source, into this repo
- Adapting another project's code with minor variable renames
- Translating code from one language to another and claiming it as original

**For every PR that implements a pattern inspired by another project:**

Add a `Design notes / prior art` section to the PR description:
```
## Design notes / prior art
The retry-with-delay pattern is documented in:
- POSIX signal handling manuals
- Various CI/CD retry implementations
All code in this PR is written from scratch for SDLC-rstack.
```

You do not need to cite prior art for fundamental programming constructs (loops, conditionals, JSON parsing).

### What we're building vs. what we're referencing

We have studied the Trinity project (github.com/Abilityai/trinity) to understand loop engineering patterns. Specifically:

| What we studied in Trinity | What we built in SDLC-rstack |
|---------------------------|------------------------------|
| Scheduler with APScheduler + Redis locking | `pipeline-state.json` + file-based locking (no Redis required) |
| Per-execution retry with `max_retries` | `retry-wrapper.sh` with Completion Protocol integration |
| Post-execution validation with separate model | `agents/validators/` using Haiku model |
| Agent-defined pipeline state files | `pipeline-state.json` per run in `$RSTACK_RUN_DIR` |
| `/goal` pattern — loop until condition met | `scripts/sdlc-goal.sh` + goal field in `pipeline.yaml` |

All SDLC-rstack code is original. We used Trinity's public documentation and architecture to understand the concepts; we did not copy, adapt, or translate any of their code.

---

## Adding or modifying agents

Every agent file must have valid YAML frontmatter:

```yaml
---
name: my-agent-name          # lowercase, hyphens only: ^[a-z][a-z0-9-]*$
description: |               # multiline OK, required
  What this agent does. (sdlc) or (sdlc-validator) tag at the end.
model: sonnet                 # sonnet | opus | haiku
tools:                        # list only what the agent actually uses
  - Bash
  - Read
  - Write
color: blue                   # any color name
owner: RStack developed by Richardson Gunde
---
```

Agent names must be unique across all `agents/` subdirectories. Run `npm run validate` to confirm.

When modifying an existing agent:
- Do not change the `name` field (it's a published identifier)
- Do not remove existing output artifact paths from the Workflow section
- Do add to the Context Recovery section if the agent now writes new artifacts
- Do update the Quality Self-Check if acceptance criteria changed

---

## Adding tests

Tests live in `tests/*.test.js` and use Node's built-in test runner (`node --test`).

For every new shell helper in `agents/lib/` or `scripts/`, add a corresponding test that:
1. Creates a temp `$RSTACK_RUN_DIR`
2. Calls the helper function
3. Asserts the output or file state

Example: `tests/pipeline-state.test.js`

---

## PR checklist

Before requesting review, confirm:

- [ ] `npm test` passes locally
- [ ] `npm run validate` passes locally
- [ ] Branch is rebased onto latest `main` — zero merge conflicts
- [ ] PR description has **Description**, **Type of change**, **Testing done**, **Agent validation checklist** (if agents changed)
- [ ] New `agents/lib/` or `scripts/` files are executable (`chmod +x`)
- [ ] New agent files added to correct directory and included in `package.json` `files` if needed
- [ ] No credentials, internal URLs, or PII in any committed file
- [ ] If inspired by an external project: prior art cited in PR description

---

## CodeRabbit review comments

SDLC-rstack uses CodeRabbit for automated PR review. When CodeRabbit leaves a comment:

1. Read it carefully. Most comments are correct and worth acting on.
2. If you agree: fix it in the same branch before merging. Don't leave "will fix in follow-up" unless the follow-up issue is filed immediately.
3. If you disagree: reply with a clear technical reason. Don't dismiss without explanation.
4. If a comment reveals a systemic issue (not just in this PR): file a separate issue before merging.

**Never merge a PR with unresolved CodeRabbit comments that have no explicit acknowledgment or response.**

---

## Release process

Releases are automated via the `publish` workflow on tag push:

```bash
# Bump version in package.json
npm version patch   # or minor, major
git push --follow-tags
```

The workflow runs `npm test`, `npm run validate`, `npm pack --dry-run`, then publishes to npm.

Before tagging a release:
- All issues in the milestone must be closed
- `CHANGELOG.md` updated (if applicable)
- `main` is green on CI

---

*SDLC-rstack is MIT licensed. Contributions are assumed to be under the same license unless explicitly stated.*
