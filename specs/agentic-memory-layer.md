# Agentic Memory Layer for SDLC-rstack
**Status:** Research spec — not yet implemented  
**Created:** 2026-05-18  
**Sources:** See citations at bottom  
**Owner:** RStack developed by Richardson Gunde

---

## The problem this solves

The rstack harness proves what happened inside a single run via `evidence.jsonl` and `builder.json` contracts. But it has no memory of what happened across runs, across sessions, or across branches. Every `sdlc_start` is a blank slate.

The consequence: agents repeat the same mistakes, rediscover the same patterns, and cannot improve from past SDLC runs. The harness enforces process correctness. It does not enforce learning.

---

## The four memory types and where rstack currently sits

From the research, four memory types map cleanly to rstack's existing components:

| Memory type | What it stores | Current rstack state | Gap |
|---|---|---|---|
| **In-context (working)** | Active run state, spec-anchor.md, loaded agent content | `.rstack/runs/<id>/` + spec-anchor.md (added PR #1) | Mostly covered. Sliding window still a risk on large codebases. |
| **Episodic** | Past task outcomes, what worked, what failed | `evidence.jsonl` per run (added PR #1) | Per-run only. Not queryable across runs. Not surfaced to agents before they start a task. |
| **External (semantic)** | Cross-session facts, user preferences, project patterns | `/Users/richardsongunde/.claude/projects/.../memory/*.md` flat files | No vector search. No decay. No importance filtering. Grows without curation. |
| **Semantic/parametric** | World knowledge baked into Claude | Claude's weights | Not addressable — Claude's cutoff is fixed. Use external retrieval for anything time-sensitive or project-specific. |
| **Procedural** | How to do things: agent prompts, skills, plugin commands | `agents/`, `skills/`, `plugins/` | Well-designed. The agent prompts ARE the procedural memory. |

The two real gaps are **episodic** (cross-run) and **external** (persistent facts with retrieval).

---

## The agent memory loop

Per @techwith_ram's breakdown, memory operations bookend every LLM call:

```
[User request / task trigger]
        │
        ▼
1. RETRIEVE — query external + episodic memory
        │      "find past episodes similar to this task"
        │      "recall relevant project facts"
        ▼
2. INJECT — build context = system prompt + retrieved memories + spec-anchor
        │
        ▼
3. LLM CALL — model reasons over injected context
        │
        ▼
4. WRITE — store new memories, log episode outcome
        │
        ▼
[Output + builder.json contract]
```

**Current rstack harness:** steps 2–4 exist (load agent + plugin content, LLM call, evidence.jsonl write). Step 1 is missing. Agents start without querying what happened in prior similar runs.

---

## What to build: three additions in priority order

### Addition 1 — Cross-run episodic store (P0)

**What:** A queryable log of past SDLC task outcomes, surfaced to agents as "prior similar episodes" before they start work.

**Pattern (from @techwith_ram EpisodicLogger):**

```json
{
  "episode_id": "ep_2026-05-18_004-implementation",
  "run_id": "2026-05-18T02-40-18-409Z-...",
  "branch": "feat/harness-foundation",
  "stage": "004-implementation",
  "task_description": "Implement harness reliability layer",
  "approach": "contracts.js + evidence.js + guardrails.js + stages.js + run-state.js",
  "outcome": "PASS",
  "duration_ms": 82400,
  "files_modified": ["src/harness/contracts.js", "..."],
  "tests_run": ["npm test"],
  "quality_score": 0.95,
  "notes": "Qodo caught schema collision in evidence.jsonl — evidence.jsonl vs events.jsonl. Fix: separate files.",
  "embedding": [...]
}
```

**Storage:** Start simple — append to `~/.rstack/projects/<slug>/episodes.jsonl`. No vector DB needed initially; use `rstack-learnings-search` pattern that already exists in the harness. Upgrade to ChromaDB or pgvector when episode count exceeds ~500.

**Retrieval injection point in extension:** In `builderPrompt()` (rstack-sdlc.ts:524), after loading specialist context, retrieve top-3 similar episodes and inject:

```typescript
const episodes = await recallSimilarEpisodes(task.description, 3);
if (episodes.length) {
  prompt += `\n\n## Prior similar episodes\n${episodes.map(e =>
    `- [${e.outcome}] ${e.stage}: ${e.notes}`
  ).join('\n')}`;
}
```

**Write point:** At the end of `sdlc_validate`, when status is confirmed, append to the episodic store. The harness already has the builder.json data needed to populate the episode record.

**Why this matters:** The Qodo bug (evidence.jsonl schema collision) would have appeared as a prior episode note — "watch for schema collision when two writers share events.jsonl." Future implementations get that lesson without repeating the discovery.

---

### Addition 2 — Memory importance scoring + decay (P1)

**Current problem:** The rstack memory system (`MEMORY.md` + `memory/*.md`) is additive only. Once written, memories never decay or get filtered. The signal-to-noise ratio drops over time.

**Pattern (from @techwith_ram memory management section):**

**Importance scoring at write time** — before writing a memory, score it:

```python
# Heuristic version (no LLM call needed):
def importance_score(memory_type, content):
    # Corrections and bugs found = high importance
    if memory_type == "feedback" and any(w in content.lower() for w in ["wrong", "broke", "failed", "don't", "never"]):
        return 0.9
    # Preferences explicitly stated = high
    if "always" in content.lower() or "never" in content.lower():
        return 0.85
    # Generic patterns = medium
    if memory_type == "project":
        return 0.6
    return 0.4  # low — probably don't save
```

Only write if score >= 0.5. This filters transient observations that would just add noise.

**Time-based decay** (Park et al., Generative Agents, 2023):

```python
import math
from datetime import datetime

def memory_score(relevance, importance, created_at, decay_factor=0.995):
    hours_old = (datetime.utcnow() - created_at).total_seconds() / 3600
    recency = math.pow(decay_factor, hours_old)
    return relevance * 0.4 + importance * 0.3 + recency * 0.3
```

At `decay_factor=0.995`, a memory loses half its recency score in ~139 hours (~6 days). Still relevant for 30+ days if importance is high.

**Periodic consolidation** — run monthly:
- Find memory pairs with cosine similarity >= 0.92
- Merge into single canonical entry
- Keeps the memory store from accumulating contradictory or redundant entries

**Implementation for rstack:** The existing `~/.rstack/projects/<slug>/learnings.jsonl` format can add `importance` and `created_at` fields. The `rstack-learnings-search` binary already scores results — extend it to apply decay scoring.

---

### Addition 3 — SAGE integration as optional governed memory (P2)

**What SAGE adds that the above cannot:** BFT-consensus validation of every memory write, RBAC clearance levels for multi-agent networks, and the PreCompact Claude Code hook.

**The PreCompact hook is the most immediately valuable piece:**

```bash
# .claude/hooks/PreCompact — fires before context compaction
# SAGE ships this ready-made; it captures working state to the SAGE node
# Result: agents can recall "what was I doing before compaction"
# automatically, without spec-anchor.md needing to be manually written
```

**When to add SAGE:**
- Solo use (Richardson only): personal mode works, single CometBFT node in-process. Worth installing as a companion to get PreCompact.
- Multi-agent parallel builds (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`): high value. Agents share a BFT-validated memory space instead of reading each other's flat files.
- Client/enterprise delivery: SAGE's governance engine (on-chain proposals + voting) provides the audit trail that answers "why did the agent make this architectural decision."

**How to wire it to the rstack harness:**

The harness already writes `evidence.jsonl`. Add an optional SAGE write alongside:

```typescript
// In appendEvidenceEvent (src/harness/evidence.js)
export async function appendEvidenceEvent(runDir, event) {
  // ... existing validation + write to evidence.jsonl ...
  
  // Optional: mirror to SAGE if configured
  if (process.env.SAGE_ENDPOINT) {
    await sageWrite(event).catch(() => {}); // non-blocking, never breaks harness
  }
}
```

This keeps SAGE fully optional — the harness works without it, and SAGE adds governed persistence on top.

---

## Retrieval design is 80% of the problem

@techwith_ram's key insight: "Good memory architecture is 20% storage and 80% retrieval design."

The retrieval failure mode: if you don't retrieve the right memories, the agent behaves as if they don't exist. The three retrieval strategies in order of quality:

| Strategy | How | Use for |
|---|---|---|
| Exact lookup | SQL / key-value by stage ID, branch, date | Structured agent state, run manifests |
| BM25 full-text | Match keywords in episode descriptions | Finding task descriptions with specific terms |
| Vector semantic | Cosine similarity on embeddings | "Find past tasks semantically similar to this one" |

For rstack episodes, hybrid retrieval (BM25 + vector via RRF, same pattern SAGE uses) beats either alone. The task description "implement harness contracts" and "add builder validation layer" are semantically similar but share no keywords.

**Minimum viable retrieval for rstack today (no vector DB):**

```bash
# In rstack-sdlc.ts, before building the builder prompt:
grep -i "$(echo '$TASK_DESC' | tr ' ' '|')" ~/.rstack/projects/$SLUG/episodes.jsonl \
  | tail -3 \
  | python3 -c "import sys,json; [print(json.loads(l)['notes']) for l in sys.stdin]"
```

Text grep is enough for < 500 episodes. Upgrade to semantic search when it stops finding relevant results.

---

## The procedural memory is already the best part

The agent `.md` files ARE procedural memory — they encode how to do things. The Kiro research and the Medium post both confirm this is the right pattern: behavioral patterns encoded in system prompts.

The spec-anchor.md pattern (added in PR #1) extends this: it creates a lightweight working-memory document that any agent can read to re-establish context after compaction.

**Do not over-engineer procedural memory.** The agent prompts work. The focus for improvement is episodic (cross-run learning) and the retrieval step (inject episodes before LLM call).

---

## Stability-plasticity and memory governance

From the SSGM framework paper (arXiv:2603.11768): uncontrolled memory updates introduce three risks:

| Risk | Description | rstack exposure |
|---|---|---|
| **Semantic drift** | Repeated summarization distorts facts | Low — rstack memories are written once, rarely updated |
| **Procedural drift** | Agent reinforces suboptimal workflows | Medium — if episode scores are wrong, future agents learn wrong patterns |
| **Hallucination injection** | Model fills memory gaps with invented facts | Low — rstack memories come from code execution, not model inference |

**Mitigation for rstack:** Episode records are written from `builder.json` data (files modified, tests run, status) — ground truth from the tool layer, not model prose. Quality scores come from the validator contract, not self-assessment. This gives rstack's episodic memory better data quality than most systems described in the research.

The one risk to watch: `notes` field in episodes. If agents write their own notes, drift can occur. Keep notes short and factual ("Qodo flagged schema collision in events.jsonl"). Avoid interpretive prose.

---

## Implementation order

| Phase | What | Effort | Value |
|---|---|---|---|
| **Now** | Add `importance` + `created_at` to `rstack-learnings-log` schema | 30 min | Enables future decay without breaking anything |
| **Sprint 1** | Write episodes to `episodes.jsonl` at end of `sdlc_validate` | 2 hours | Cross-run learning starts accumulating |
| **Sprint 1** | Inject top-3 similar episodes into `builderPrompt()` via grep | 1 hour | Agents see prior outcomes before starting work |
| **Sprint 2** | Add time-decay scoring to `rstack-learnings-search` | 2 hours | Old memories stop cluttering retrieval |
| **Sprint 2** | Install SAGE personally, connect PreCompact hook | 30 min | Automated context recovery before compaction |
| **Sprint 3** | Hybrid BM25+vector retrieval for episodes | 4 hours | Better retrieval when episode count > 200 |
| **Sprint 3** | Optional SAGE write in `appendEvidenceEvent` | 1 hour | Governed cross-session memory for multi-agent runs |

---

## Citations

1. **@techwith_ram X post** — "Agentic Memory: A Detailed Breakdown." Covers four memory types, sliding window strategies, MemoryStore/EpisodicLogger/MemoryAugmentedAgent code patterns, decay formula, importance scoring, and consolidation. [https://x.com/techwith_ram/status/2037499938574110770]

2. **@honeyricky1m3 Medium post** — "Giving Your AI a Mind: Exploring Memory Frameworks for Agentic Language Models." Four-memory cognitive architecture, layered system prompt reconstruction, reflection-driven episodic encoding, hybrid BM25+semantic retrieval. [https://medium.com/@honeyricky1m3/giving-your-ai-a-mind-exploring-memory-frameworks-for-agentic-language-models-c92af355df06]

3. **SAGE (l33tdawg/sage)** — "(S)AGE: Sovereign Agent Governed Experience." BFT-consensus-validated memory, branch-aware tagging, Claude Code hooks (PreCompact/SessionStart/SessionEnd), RBAC clearance levels, hybrid recall (BM25+vector RRF), LongMemEval-S R@5=0.9053. [https://github.com/l33tdawg/sage]

4. **Zenodo 18855836** — Kannabhiran, Dhillon Andrew. "(S)AGE: Sovereign Agent Governed Experience" — academic paper describing SAGE architecture. BFT consensus, proof-of-experience weighted validation, PostgreSQL+pgvector. Apache 2.0. [https://zenodo.org/records/18855836]

5. **arXiv:2603.11768** — "Governing Evolving Memory in LLM Agents: Risks, Mechanisms, and the Stability and Safety Governed Memory (SSGM) Framework." Identifies semantic drift, procedural drift, and hallucination injection as the three memory governance failure modes. Memory evolution must be decoupled from memory governance. [https://arxiv.org/html/2603.11768v1]

6. **Park et al., 2023** — "Generative Agents: Interactive Simulacra of Human Behavior." Source of the recency decay formula: `score = relevance×0.4 + importance×0.3 + recency×0.3`, with `recency = decay_factor^hours_old`. [https://arxiv.org/abs/2304.03442]

7. **CircleCI AI SDLC blog** — "AI-Driven SDLC." Context window problem, infrastructure must match AI velocity, feedback loops via MCP, risk-based code review redesign. [https://circleci.com/blog/ai-sdlc/]

8. **mem0.ai — State of AI Agent Memory 2026** — Benchmark comparisons (LongMemEval, LoCoMo), memory architecture patterns in production, gap analysis between curated and uncurated systems. [https://mem0.ai/blog/state-of-ai-agent-memory-2026]
