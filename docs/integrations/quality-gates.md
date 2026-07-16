# Quality gates — opt-in spec-first / test-first discipline

<!-- owner: RStack developed by Richardson Gunde -->

RStack ships three **opt-in** quality-gate presets you can wire into your host's
PreToolUse hook. They enforce spec-first, test-first, and in-scope discipline
right at the terminal — complementing the harness's Definition-of-Ready checks
and Decision Queue, not replacing them.

They are **off by default**, and deliberately so: they are *opinionated*. Turn on
only the ones your team wants.

> These are a separate layer from `rstack-agents guard`. `guard` is always-on
> safety (destructive-action gate + validator sandbox — see
> [wire-your-own-harness.md](wire-your-own-harness.md)). `gate` is opt-in
> discipline. `guard` always runs first; gates run after it.

## The three presets

| Preset | What it checks | Verdict |
|---|---|---|
| `plan-gate` | Editing a source file with **no recent spec** (`.spec.md` modified in the last 14 days) **and** no active RStack run+plan | **Warns** on stderr, allows the edit (exit 0) |
| `tdd-gate` | Writing/editing **production code** with **no matching test file** | **Blocks** the edit (exit 2) — overridable |
| `scope-guard` | Modifying a file **outside the active spec's declared scope** (its "Files to create/modify" list) | **Warns** on stderr, allows the edit (exit 0) |

**Only `tdd-gate` ever blocks.** `plan-gate` and `scope-guard` are pure nudges.

### tdd-gate: what counts as "production code"

`tdd-gate` fires only on source files (`.ts .tsx .js .jsx .py .go .rs .java .cs
.rb .php .kt .swift ...`) that are **not** themselves:

- test files — `Foo.test.ts`, `foo.spec.ts`, `FooTest.cs`, `foo_test.go`, `test_foo.py`, `BarSpec.kt`
- config / type-decl — `*.config.ts`, `*.d.ts`, `tsconfig*`, `Program.cs`, `appsettings*`
- migrations / DTOs — anything matching `*migration*`, `*.dto.*`, `*DTO*`
- files under `test/ tests/ __tests__/ spec/ fixtures/ mocks/ stubs/ migrations/ seeds/ config/ scripts/ infra/ deploy/`
- non-source files — `.md .json .yaml` etc.

For a production file `Foo.ext`, it looks for a matching test named
`Foo.test.*`, `Foo.spec.*`, `FooTest.*`, `FooTests.*`, `Foo_test.*`, or
`test_Foo.*` — first in the file's own directory and nearby test dirs, then via a
bounded project-wide walk. If none is found, the edit is blocked with a
"write the test first" reason.

## How to enable

### Claude Code

```bash
# short names
rstack-agents init --framework claude-code --gates plan,tdd,scope
# or full names — either works
rstack-agents init --framework claude-code --gates plan-gate,tdd-gate,scope-guard
```

This appends the chosen gate hooks to `.claude/settings.json`'s `PreToolUse`
array **after** the guard hook (guard always stays first). With no `--gates`, the
installed hooks are byte-identical to the default — gates are never added
unless you ask.

The choice is also recorded in `.rstack/rstack.config.json` under `hooks.gates`.

To wire gates by hand, add entries after the guard hook:

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Bash|Write|Edit", "hooks": [{ "type": "command", "command": "npx --yes rstack-agents guard --context builder" }] },
      { "matcher": "Write|Edit|MultiEdit", "hooks": [{ "type": "command", "command": "npx --yes rstack-agents gate tdd-gate" }] }
    ]
  }
}
```

### Tau

Set the `quality_gates` extension setting (or the `RSTACK_TAU_GATES` env) — a
comma string or list of preset names:

```json
{ "extensions": { "list": [{ "path": ".../tau/rstack_sdlc.py",
  "settings": { "quality_gates": "plan,tdd,scope" } }] } }
```

The adapter runs the gates on the shadowed `write`/`edit` tools after guard,
inside the same `execute()` (see [tau.md](tau.md) — enforcement shadows the
built-ins rather than using Tau's documented but non-functional `tool_call`
hook). Off unless configured.

### Operator / custom harnesses

Any harness with a tool-call hook can pipe the pending call's JSON to
`rstack-agents gate <name>` and treat the exit code as the verdict (exit 0 =
allow, exit 2 = block, stderr = reason) — the same contract as `guard`. See
[wire-your-own-harness.md](wire-your-own-harness.md) for the paste-in prompt;
substitute `gate tdd-gate` for `guard` (and run it after guard).

## Overriding tdd-gate

`tdd-gate` is the only gate that blocks, and it is **always overridable** — it is
never a dead-end:

1. **Per-call env override** — the fast escape hatch:

   ```bash
   RSTACK_ALLOW_NO_TESTS=1   # allow this production edit without a test
   ```

2. **Audited approval** — the governed path. Set the active task
   (`RSTACK_TASK_ID` / `--task`) and approve one of:

   - `no-tests:<taskId>` — a purpose-built override, or
   - `guardrail-override:<taskId>` — the generic one-shot override

   via `sdlc_approve` or the Business Hub. These go through RStack's audited
   approval trust path (run-bound, replay-rejected), the same as every other
   governed override.

## Verifying

```bash
rstack-agents doctor --framework claude-code
```

reports which gates are wired under `claude-code quality gates`. This is
**informational only** — never a FAIL and never a WARN, because gates are opt-in.

## Tradeoffs (read before enabling)

- **These are opinionated.** `tdd-gate` in particular enforces test-first, which
  is a deliberate friction. It's off by default for that reason. If your team
  doesn't practice TDD, leave it off — `plan-gate`/`scope-guard` (warn-only) are
  gentler starting points.
- **Heuristics, not proof.** The gates classify by filename/path and search for
  a *matching* test file — they do not run tests or check coverage. A test that
  exists but is empty still satisfies `tdd-gate`. They are guardrails against the
  common failure mode (shipping code with no test at all), not a correctness
  oracle.
- **False-block bias is toward allowing.** Every ambiguous or unclassifiable
  case fails **open** (allows). The skip list is broad on purpose so that
  legitimate non-code edits (config, docs, migrations, DTOs, infra) are never
  blocked. If you hit a false block, `RSTACK_ALLOW_NO_TESTS=1` clears it
  instantly.
- **Fast + self-contained.** Each gate does bounded local disk reads only, no
  network, and never throws — a gate can't hang or crash your session.
