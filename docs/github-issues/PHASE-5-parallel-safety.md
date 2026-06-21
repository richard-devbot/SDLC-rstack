<!-- owner: RStack developed by Richardson Gunde -->

# [Epic] Phase 5 — Parallel Safety & Worktree Isolation

**Labels:** `epic`, `enhancement`, `loop-engineering`, `phase-5`  
**Milestone:** Loop Engineering v1

## Why this matters

`sdlc-parallel` can trigger multiple agents simultaneously, but they all share the same `$RSTACK_RUN_DIR/artifacts/` directory. Two agents writing to the same JSON file at the same time silently corrupts the artifact. The code agent (07) in particular generates large amounts of code that contaminates the working directory of other agents running in parallel.

This phase adds file-based locking for parallel mode and isolated git worktrees for the code agent.

---

## Issues in this Epic

### Issue 5.1 — Add `agents/lib/lock.sh` — file-based lock manager

**Labels:** `enhancement`, `phase-5`, `infra`

**Problem:** No locking mechanism. Parallel agent runs race to write the same artifact files.

**Proposed implementation:**

Create `agents/lib/lock.sh` — POSIX-compatible file-based locks using `mkdir` atomicity:

```bash
#!/usr/bin/env bash
# lock.sh — File-based lock manager for parallel agent safety
# Uses mkdir atomicity (POSIX-guaranteed) — no Redis, no external deps.
# Usage: source agents/lib/lock.sh

LOCK_DIR="${RSTACK_RUN_DIR}/.locks"
mkdir -p "$LOCK_DIR"

# acquire_lock <lock_name> [timeout_seconds=30]
# Returns 0 on success, 1 on timeout
acquire_lock() {
  local name="$1"
  local timeout="${2:-30}"
  local lockdir="$LOCK_DIR/${name}.lock"
  local elapsed=0

  while ! mkdir "$lockdir" 2>/dev/null; do
    # Check if lock holder is still alive
    local pid_file="$lockdir/pid"
    if [ -f "$pid_file" ]; then
      local holder_pid
      holder_pid=$(cat "$pid_file" 2>/dev/null || echo "")
      if [ -n "$holder_pid" ] && ! kill -0 "$holder_pid" 2>/dev/null; then
        # Stale lock — holder process dead
        rm -rf "$lockdir"
        continue
      fi
    fi

    if [ "$elapsed" -ge "$timeout" ]; then
      echo "[lock] Timeout waiting for lock: $name (held by PID ${holder_pid:-unknown})" >&2
      return 1
    fi

    sleep 1
    elapsed=$((elapsed + 1))
  done

  echo $$ > "$lockdir/pid"
  echo "[lock] Acquired: $name (PID $$)"
  return 0
}

# release_lock <lock_name>
release_lock() {
  local name="$1"
  local lockdir="$LOCK_DIR/${name}.lock"
  rm -rf "$lockdir"
  echo "[lock] Released: $name"
}

# with_lock <lock_name> <command...>
# Acquires lock, runs command, releases on exit (even on error)
with_lock() {
  local name="$1"
  shift
  acquire_lock "$name" || return 1
  trap "release_lock '$name'" EXIT ERR INT TERM
  "$@"
  local rc=$?
  release_lock "$name"
  trap - EXIT ERR INT TERM
  return $rc
}
```

Locks are named after the artifact directory they protect:
- `artifacts/architecture` — acquired by Agent 06
- `artifacts/code` — acquired by Agent 07
- `pipeline-state` — acquired by any agent writing to `pipeline-state.json`

**Acceptance criteria:**
- [ ] `agents/lib/lock.sh` created with `acquire_lock`, `release_lock`, `with_lock`
- [ ] Stale lock detection: if holder PID is dead, lock is reclaimed
- [ ] Timeout configurable (default 30s)
- [ ] Lock names map to artifact directories, not agent names
- [ ] Test added in `tests/lock.test.js`
- [ ] `npm test` passes

---

### Issue 5.2 — Integrate locking into parallel pipeline mode

**Labels:** `enhancement`, `phase-5`, `infra`

**Problem:** `retry-wrapper.sh` and `run-pipeline.sh` don't acquire locks before writing to shared artifact directories.

**Proposed implementation:**

Update `agents/lib/retry-wrapper.sh` to source `lock.sh` and wrap agent execution:

```bash
source agents/lib/lock.sh

# Determine which artifact directory this stage writes to
ARTIFACT_LOCK=$(python3 -c "
import yaml
d = yaml.safe_load(open('pipeline.yaml'))
lock_map = {
    '00-environment': 'artifacts',
    '06-architecture': 'artifacts/architecture',
    '07-code': 'artifacts/code',
    '08-testing': 'artifacts/qa',
    '11-feedback-loop': 'artifacts/feedback',
}
print(lock_map.get('$AGENT_ID', 'artifacts'))
")

# Acquire lock before running agent
if ! acquire_lock "$ARTIFACT_LOCK" 60; then
  echo "[$AGENT_ID] Could not acquire lock for $ARTIFACT_LOCK. Another agent is running."
  exit 1
fi
trap "release_lock '$ARTIFACT_LOCK'" EXIT

# ... rest of retry wrapper
```

Also update `pipeline-state.sh` write functions to use `with_lock "pipeline-state"`.

**Acceptance criteria:**
- [ ] Every `mark_stage_*` call in `pipeline-state.sh` acquires `pipeline-state` lock
- [ ] Agents with shared artifact directories cannot run simultaneously
- [ ] Agents with independent artifact directories CAN run simultaneously (no unnecessary blocking)
- [ ] `npm test` passes

---

### Issue 5.3 — Add git worktree isolation for Agent 07 (code generation)

**Labels:** `enhancement`, `phase-5`, `agent-update`

**Problem:** Agent 07 (code generation) writes generated source files directly to the working directory. This means generated code is mixed with the SDLC framework's own files, creating noise in `git status` and risking accidental commits of generated code to the framework repo.

**Proposed implementation:**

Update Agent 07's workflow to use a git worktree for code generation:

```bash
# Before generating code
WORKTREE_DIR=".rstack/worktrees/code-$(date +%s)"
mkdir -p .rstack/worktrees/
git worktree add "$WORKTREE_DIR" -b "rstack/generated-code-$(date +%Y%m%d)" HEAD 2>/dev/null || {
  # If git worktree not available (shallow clone, etc.), use temp dir
  WORKTREE_DIR=$(mktemp -d)
  echo "Warning: git worktrees unavailable, using temp dir: $WORKTREE_DIR"
}
export CODE_OUTPUT_DIR="$WORKTREE_DIR"
```

All generated files go into `$CODE_OUTPUT_DIR`. After generation, a summary of generated files is written to `$RSTACK_RUN_DIR/artifacts/code/code_output.json` (not the files themselves).

The worktree is cleaned up on agent completion.

**Acceptance criteria:**
- [ ] Agent 07 uses `$CODE_OUTPUT_DIR` for all file writes
- [ ] Worktree created with branch `rstack/generated-code-YYYYMMDD`
- [ ] Graceful fallback to `mktemp -d` if `git worktree` fails
- [ ] Worktree removed on agent completion (both DONE and FAILED)
- [ ] Generated code path referenced in `code_output.json`
- [ ] `.rstack/worktrees/` added to `.gitignore`
- [ ] `npm run validate` passes
- [ ] `npm test` passes

---

### Issue 5.4 — Update `.gitignore` and `package.json` for new runtime directories

**Labels:** `enhancement`, `phase-5`, `housekeeping`

**Problem:** New directories created by Phases 1-5 (`agents/lib/`, `agents/validators/`, `scripts/`, `.rstack/`, `docs/github-issues/`) need to be properly handled in `.gitignore` and `package.json` `files`.

**Proposed changes:**

`.gitignore` additions:
```
# Loop engineering runtime
.rstack/worktrees/
.rstack/runs/
*.lock/
```

`package.json` `files` additions:
```json
"files": [
  "bin/",
  "src/",
  "extensions/",
  "agents/",
  "skills/",
  "prompts/",
  "plugins/",
  "scripts/",
  "docs/public/",
  "docs/HARNESS.md",
  "docs/mintlify/docs.json",
  "docs/mintlify/reference/decision-readiness.mdx",
  "research/",
  "rfcs/",
  "operator.json",
  "pipeline.yaml",
  "README.md"
]
```

Note: `docs/github-issues/` is intentionally NOT in `files` — it's development planning documentation, not published npm content.

**Acceptance criteria:**
- [ ] `.gitignore` updated with runtime directories
- [ ] `package.json` `files` includes `scripts/` and `pipeline.yaml`
- [ ] `npm pack --dry-run` shows all loop engineering scripts included
- [ ] No new unintended files in the pack output
- [ ] `npm test` passes

---

## Definition of Done for Phase 5

- [ ] All 4 issues merged to `main` with no merge conflicts
- [ ] `agents/lib/lock.sh` protects all shared artifact writes
- [ ] Agent 07 generates code in isolated worktree
- [ ] `.gitignore` updated, no runtime dirs committed accidentally
- [ ] `npm pack --dry-run` output is clean
- [ ] `npm test` passes on `main`

**Estimated effort:** 0.5 days  
**Copyright note:** File-based locking via `mkdir` atomicity is a decades-old POSIX pattern documented in the GNU Bash manual and countless Unix programming references. Git worktrees are a native Git feature. All implementation code in this phase is original to SDLC-rstack.
