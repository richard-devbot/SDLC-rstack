# SDLC-rstack Pipeline Improvement Analysis
Generated: 2026-05-18 | Branch: feat/harness-foundation

## Sources audited

| Source | Key signal |
|---|---|
| AWS re:Invent DVT214 — AI-Driven Software Development (1471 transcript segments) | 100+ company consultations; context window is the #1 reliability variable; agents fail by assuming state that isn't there |
| AWS re:Invent DEV314 — Spec-Driven Development with Kiro (1225 transcript segments) | Specs as context anchors survive window resets; steering documents always in context; 7/10 MVP because spec missed one integration |
| CircleCI AI SDLC blog | Infrastructure must match AI velocity; close feedback loops via MCP; risk-based code review |
| Agent prompt audit — all 15 SDLC agents + sample of specialist agents | Findings below |
| prompt-engineering references/anti-patterns.md | 10 anti-pattern catalogue used as checklist |

---

## What already works well — don't break it

### SDLC pipeline agents (00–14)
All 15 have:
- `## Voice` with real failure story, concrete stakes, "before starting" instruction
- `## Context Recovery` bash block to resume from existing artifacts
- Completion Protocol: `STATUS: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT`
- Harness contract awareness (5–26 references per agent)
- `owner: RStack developed by Richardson Gunde` branding
- Correct YAML tool lists (not comma-separated — anti-pattern #2 avoided)

### Core agents (orchestrator, builder, validator)
Strong. Orchestrator explicitly says "you do not write code." Builder and validator have clear separation. Voices match their operational reality.

### Specialist agents (~177 files sampled)
- 118–124 lines each (not as thin as feared)
- All have `## Voice`, `## When To Use`, `## Skills Access`, `## Workflow`, `## Completion Protocol`, `## AskUserQuestion Format`
- Completion Protocol is present and correct in every sampled agent
- Escalation policy (3 attempts, then STOP) is universal

---

## Findings — what to improve

### Finding 1 — Context window has no explicit budget guidance (HIGH)

**Source:** AWS AIDLC video (direct quote from transcript): *"The context window is a variable we do not fully control."* Kiro's entire design is built around managing it.

**Current state:** SDLC agents have `Context Recovery` (bash to read existing artifacts) but no forward-looking budget check. An agent that starts a 10-file implementation without checking context depth will hit compaction mid-task, lose state, and either stall or produce incomplete output.

**Anti-pattern matched:** Not in the original 10, but a direct failure mode from both videos.

**Concrete gap:** None of the 15 SDLC agents or any specialist agent has a statement like "if this task would require reading more than X files, stop and break it into sub-tasks." The harness has `checkGuardrails(maxSteps, maxMessages)` but agents don't surface that check to the model.

**Fix:** Add a `## Context Budget` section after `## Voice` in all SDLC agents. Template:

```markdown
## Context Budget
Stage N of 15. Prior stages have consumed context. Apply these limits:
- Read at most 8 source files before producing your output artifact.
- If the task requires more than 8 files, produce a DONE_WITH_CONCERNS artifact covering what you analyzed and list the skipped items explicitly.
- After context compaction, your artifacts survive. Your in-memory state does not. Write to disk early and often.
- If you detect you have already written a partial artifact for this stage, read it first and continue from that point — do not restart.
```

---

### Finding 2 — No spec-anchor document across SDLC stages (HIGH)

**Source:** Kiro's core insight. Their `requirements.md → design.md → tasks.md` chain acts as a "steering document" — always readable even after context reset. When Richardson said the agent missed the Claude AI integration and scored 7/10, the cause was: the spec didn't make that integration explicit enough for the agent to find when its context was full.

**Current state:** Each SDLC stage writes its own artifact (`environment_report.json`, `requirements.json`, `architecture.md`, etc.) but there is no lightweight consolidated orientation document that a late-stage agent can read in <200 tokens to understand the whole project.

**Gap in action:** `07-code.md` reads `system_design.json` but system_design.json can be large. When context is 70% full, the agent reads a truncated version and may miss critical constraints.

**Fix:** Add a step to `03-documentation.md` (or a new micro-stage after requirements) to write `spec-anchor.md` — a 20–30 line file that distills the entire run context:

```markdown
# RStack Run Spec Anchor
Run: [run_id]
Goal: [one sentence from product-brief.md]
Stack: [from environment_report.json]
Core requirements (top 5): [from requirements.json]
Key architecture decisions (top 3): [from architecture.md]
Out of scope: [from requirements.json]
Current stage: [updated by each agent as it runs]
Stage status: 00=PASS 01=PASS 02=PASS 03=IN_PROGRESS ...
```

Every agent starting after stage 03 reads this file in 5 lines of bash instead of reading 3 large JSON files. This is direct implementation of the Kiro steering document pattern.

---

### Finding 3 — Stage artifact paths are split between legacy and canonical (MEDIUM)

**Source:** Harness PR (feat/harness-foundation) introduced `artifacts/stages/<stage-id>/` as canonical. Extension now generates `stage_artifacts` per task.

**Current state:** SDLC agents reference both:
- Legacy: `$RSTACK_RUN_DIR/artifacts/` (still the primary path in most agents)
- Canonical: `.rstack/runs/<id>/artifacts/stages/<stage-id>/` (from new harness)

**Example from `07-code.md`:** The Context Recovery section uses `$RSTACK_RUN_DIR/artifacts/` which is an environment variable that may not be set in all harness modes (Claude Code, Pi with different env, Codex).

**Fix:** All SDLC agents' Context Recovery sections should use the hardcoded relative path pattern that the harness writes to, with the env var as a fallback:

```bash
# Canonical (harness-written)
RUN_BASE=$(ls -td .rstack/runs/*/ 2>/dev/null | head -1)
ls "${RUN_BASE}artifacts/stages/" 2>/dev/null
# Legacy fallback
ls "${RSTACK_RUN_DIR:-/dev/null}/artifacts/" 2>/dev/null
```

---

### Finding 4 — `07-code.md` skills loading anti-pattern (MEDIUM)

**Source:** `prompt-engineering/references/anti-patterns.md` #4 — Shell Variable State Between Bash Blocks.

**Current state in `07-code.md`:**
```bash
cat skills/investigate/SKILL.md | head -20   # for debugging patterns
cat skills/careful/SKILL.md | head -20        # if creating/deleting files
```

`head -20` reads only the frontmatter + first section of a skill. The preamble and workflow are not at the top of most skills. This gives Claude a misleading fragment — the skill name but not the workflow.

**Fix:** Remove the inline skill-loading bash from agent bodies. Instead, list skill triggers in prose:

```markdown
## Skills to load before generating code
- If debugging a broken build: invoke the `investigate` skill — trigger: "debug this"
- Before any file deletion or overwrite: invoke the `careful` skill
- Before writing a PR: invoke the `ship` skill
```

The Claude Code runtime will resolve these via the Skill tool. No bash needed.

---

### Finding 5 — Specialist Voice sections are thin (MEDIUM)

**Source:** Prompt audit + anti-patterns.md #8 ("You Are A Senior" opening).

**Current state:** Specialist `## Voice` sections are 3–4 sentences. Example from `api-builder.md`:

```
Direct, concrete. Name the framework, the endpoint, the file.
Show actual code — not 'you should implement X.' State trade-offs with real numbers.

**Stakes:** This code serves real users in production. Bugs cause data loss, security vulnerabilities, or downtime.

**Before starting:** Read the relevant skill file and existing code before writing a single line. Identify the edge case most likely to cause a production bug.
```

Compare to `07-code.md` which has a full paragraph failure story: *"You have reviewed too many AI-generated codebases that look complete but fall apart the moment you try to start them — placeholder // TODO: implement this in auth middleware..."*

**Impact:** The SDLC pipeline agents behave significantly better than specialists because their Voice sections give the model a concrete persona anchored in real failure. The specialists get the generic "direct and concrete" instruction but no actual personality.

**Fix:** Each specialist agent's `## Voice` needs one concrete failure scenario (3–5 sentences) specific to its domain. This is the pattern that makes `06-architecture.md` strong:

```markdown
## Voice
You are a staff API engineer who has inherited a codebase where "the API" means a 
2000-line Express file with 47 endpoints, no versioning, no input validation, and 
three different authentication patterns depending on when the endpoint was written. 
You know what a real production API looks like and you know what a first draft that 
ships to prod by accident looks like. You do not write the second kind.

**Stakes:** Every endpoint you write becomes a contract. Other services, mobile apps, 
and third-party integrations depend on it not changing. Write it right the first time.

**Before starting:** Read the OpenAPI spec or requirements first. Name the one endpoint 
that has the highest security surface (user data, payment, auth). Start there.
```

---

### Finding 6 — Specialists have no harness contract awareness (LOW-MEDIUM)

**Source:** Harness PR adds `validateBuilderContract` as the gate for all task completion.

**Current state:** Specialists write their output and stop. They have `## Completion Protocol` but do not know to write a `builder.json` contract to the harness ledger path.

**Why it matters:** When a specialist is invoked as a subagent via `sdlc_delegate`, the harness expects a `builder.json` at `task.output_dir/builder.json`. Specialists currently don't produce this, so any delegated specialist task will show FAIL in the harness (no builder.json = contract_exists check fails).

**Fix:** Add a brief `## Harness Contract` section to all specialist agents that are used via `sdlc_delegate`:

```markdown
## Harness Contract
If invoked via sdlc_delegate or as part of a harness run, write this before exiting:
```json
{
  "task_id": "[the task id from the task description]",
  "agent": "[your name]",
  "status": "PASS|FAIL|BLOCKED|DONE_WITH_CONCERNS",
  "summary": "[1-2 sentences of what you did]",
  "files_modified": [],
  "tests_run": [],
  "risks": [],
  "next_steps": []
}
```
Write to: `.rstack/runs/[run_id]/tasks/[task_id]/builder.json`
```

---

### Finding 7 — No MCP feedback loop in stage 11 (LOW)

**Source:** CircleCI blog: *"Close feedback loops via MCP protocols."*

**Current state:** `11-feedback-loop.md` collects feedback through a questionnaire-style approach but doesn't surface the harness evidence ledger (`evidence.jsonl`) as structured feedback data.

**Fix:** Stage 11 should read `evidence.jsonl` from the run and include it in the feedback report:

```bash
# Read all harness evidence events from this run
cat .rstack/runs/*/evidence.jsonl 2>/dev/null | python3 -c "
import sys, json
events = [json.loads(l) for l in sys.stdin if l.strip()]
fails = [e for e in events if e.get('status') == 'FAIL']
print(f'{len(events)} evidence events, {len(fails)} failures')
for f in fails[:5]: print(f['task_id'], f['kind'], f.get('evidence',''))
"
```

This closes the loop from CircleCI's recommendation: the harness proof-of-work becomes the feedback source.

---

## Anti-pattern scorecard — full audit

| Anti-pattern | SDLC Agents | Specialists |
|---|---|---|
| #1 Knowledge dump (bullet-point lists instead of workflow) | ✓ Clean | ✓ Clean |
| #2 Comma-separated tools in YAML | ✓ Clean | ✓ Clean |
| #3 Quoted description instead of block scalar | ✓ Clean | ✓ Clean |
| #4 Shell variable state between bash blocks | ⚠ `07-code.md` skill loading | n/a |
| #5 Missing Completion Protocol | ✓ All present | ✓ All present |
| #6 Wrong model for task | ✓ opus for arch/code, sonnet for others | ✓ sonnet across board |
| #7 Missing `color:` | ✓ All set | ✓ All set |
| #8 "You are a senior..." opening | ✓ None use this | ✓ None use this |
| #9 No `## When To Use` | ✓ All SDLC agents have it | ✓ All have it |
| #10 Deeply nested bash logic | ✓ English conditionals used | ✓ English conditionals used |
| NEW: No context budget guidance | ❌ Missing all 15 | ❌ Missing all |
| NEW: No spec-anchor document | ❌ No inter-stage orientation doc | n/a |
| NEW: Stale stage artifact paths | ⚠ Mixed legacy + canonical | n/a |
| NEW: Specialists lack harness contract | n/a | ❌ Missing |

---

## Prioritized implementation backlog

### P0 — Do this sprint (directly improves harness reliability)

| ID | Change | Files | Effort |
|---|---|---|---|
| CTX-1 | Add `## Context Budget` section to all 15 SDLC agents | agents/sdlc/*.md | 15 edits × 5 min |
| CTX-2 | Standardize Context Recovery to use canonical harness paths with legacy fallback | agents/sdlc/*.md | 15 edits × 5 min |
| SPEC-1 | Add spec-anchor.md writing step to `03-documentation.md` | agents/sdlc/03-documentation.md | 1 edit, 20 min |
| SKILL-1 | Remove `| head -20` bash skill-loading from `07-code.md`, replace with prose triggers | agents/sdlc/07-code.md | 1 edit, 10 min |

### P1 — Next sprint (improves specialist quality)

| ID | Change | Files | Effort |
|---|---|---|---|
| VOC-1 | Rewrite `## Voice` sections in top-20 most-used specialists with concrete failure stories | agents/specialists/**/*.md | 20 edits × 15 min |
| HARNESS-1 | Add `## Harness Contract` section to all specialists that appear in `sdlc_delegate` routes | agents/specialists/**/*.md | ~30 edits × 5 min |

### P2 — Architecture cycle (requires planning)

| ID | Change | Effort |
|---|---|---|
| FEED-1 | Update `11-feedback-loop.md` to read `evidence.jsonl` from harness | 1 edit, 30 min |
| SPEC-2 | Add spec-anchor.md reader to `04-planning.md` through `14-cost-estimation.md` | 11 edits |
| CTX-3 | Add context budget check to specialist agents | ~80 edits |

---

## Context window — the engineering principle to build on

The Kiro video makes this concrete. The job-seeker app demo failed to integrate Claude because:
1. The spec said "AI integration" without naming which model or which API
2. By the time the agent reached that task, context was full
3. It implemented a stub instead of the real integration

The principle for rstack: **anything a late-stage agent needs to know must be in a short-form artifact that can be read in <5 lines of bash and <200 tokens of context.** The `spec-anchor.md` pattern solves this. The harness already enforces artifacts at every stage — the missing piece is a single consolidated orientation file that any agent can read to re-establish context without loading 5 JSON files.

This is the highest-leverage improvement in this analysis.
