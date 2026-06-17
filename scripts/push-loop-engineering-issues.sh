#!/usr/bin/env bash
# Create Backend Loop Engineering v1 GitHub issues from docs/github-issues.
set -euo pipefail

REPO="${RSTACK_GITHUB_REPO:-richard-devbot/SDLC-rstack}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ISSUE_ROOT="$ROOT/docs/github-issues/backend-loop-engineering-v1"
MILESTONE="Backend Loop Engineering v1"
APPLY=0

usage() {
  cat <<'USAGE'
Usage:
  scripts/push-loop-engineering-issues.sh --dry-run
  scripts/push-loop-engineering-issues.sh --apply

Environment:
  RSTACK_GITHUB_REPO=owner/repo  Override target repository.

The script is idempotent by title: existing open or closed issues are skipped.
USAGE
}

case "${1:---dry-run}" in
  --dry-run) APPLY=0 ;;
  --apply) APPLY=1 ;;
  -h|--help) usage; exit 0 ;;
  *) usage; exit 2 ;;
esac

need_file() {
  if [[ ! -f "$1" ]]; then
    echo "Missing issue body file: $1" >&2
    exit 1
  fi
}

run() {
  if [[ "$APPLY" -eq 1 ]]; then
    "$@"
  else
    printf '[dry-run]'
    printf ' %q' "$@"
    printf '\n'
  fi
}

create_label() {
  local name="$1" color="$2" desc="$3"
  if [[ "$APPLY" -eq 1 ]]; then
    gh label create "$name" --color "$color" --description "$desc" --repo "$REPO" 2>/dev/null || true
  else
    echo "[dry-run] ensure label: $name"
  fi
}

ensure_milestone() {
  if [[ "$APPLY" -eq 0 ]]; then
    echo "[dry-run] ensure milestone: $MILESTONE"
    return
  fi

  local number
  number="$(gh api "repos/$REPO/milestones" --jq ".[] | select(.title==\"$MILESTONE\") | .number" | head -1)"
  if [[ -z "$number" ]]; then
    gh api "repos/$REPO/milestones" -f title="$MILESTONE" -f description="Backend-first loop engineering upgrade for SDLC-rstack" >/dev/null
  fi
}

issue_exists() {
  local title="$1"
  [[ "$APPLY" -eq 1 ]] || return 1
  local existing
  existing="$(gh issue list --repo "$REPO" --state all --search "$title in:title" --json title --jq ".[] | select(.title==\"$title\") | .title" | head -1)"
  [[ -n "$existing" ]]
}

create_issue() {
  local title="$1" labels="$2" body_file="$3"
  need_file "$body_file"

  if issue_exists "$title"; then
    echo "Skipping existing issue: $title"
    return
  fi

  local args=(issue create --repo "$REPO" --title "$title" --milestone "$MILESTONE" --body-file "$body_file")
  IFS=',' read -ra label_arr <<< "$labels"
  for label in "${label_arr[@]}"; do
    args+=(--label "$label")
  done
  run gh "${args[@]}"
}

echo "Target repo: $REPO"
echo "Mode: $([[ "$APPLY" -eq 1 ]] && echo apply || echo dry-run)"
echo

echo "Ensuring labels..."
create_label "epic" "7057ff" "Multi-issue epic"
create_label "loop-engineering" "0075ca" "Loop engineering upgrade project"
create_label "backend-looping" "0e8a16" "Backend loop engineering work"
create_label "control-plane" "5319e7" "Runtime inventory and control plane"
create_label "harness" "1d76db" "Harness and run-state work"
create_label "contracts" "fbca04" "Builder and validator contract work"
create_label "retry-recovery" "d93f0b" "Retry and recovery logic"
create_label "goal-loop" "c2e0c6" "Goal evaluation and bounded loop runner"
create_label "guardrails" "b60205" "Safety gates and guardrails"
create_label "cost-context-memory" "bfdadc" "Cost, context, and memory controls"
create_label "documentation" "0075ca" "Documentation"
create_label "cli" "1d76db" "Command-line tooling"
create_label "agent-update" "0e8a16" "Agent prompt updates"
create_label "testing" "f9d0c4" "Tests required"

echo
echo "Ensuring milestone..."
ensure_milestone

echo
echo "Creating issues..."
create_issue "[Epic] Backend Loop Engineering 0 - Control Plane Inventory" "epic,loop-engineering,backend-looping,control-plane" "$ISSUE_ROOT/00-epic-control-plane-inventory.md"
create_issue "[BLE-0.1] Inventory Pi tools, CLI commands, hooks, agents, skills, plugins, and prompts" "loop-engineering,backend-looping,control-plane,cli,testing" "$ISSUE_ROOT/00-01-inventory-runtime-surfaces.md"
create_issue "[BLE-0.2] Document runtime differences: Pi vs Claude Code vs CLI" "loop-engineering,backend-looping,control-plane,documentation" "$ISSUE_ROOT/00-02-document-runtime-differences.md"

create_issue "[Epic] Backend Loop Engineering 1 - Harness State Spine" "epic,loop-engineering,backend-looping,harness" "$ISSUE_ROOT/01-epic-harness-state-spine.md"
create_issue "[BLE-1.1] Add Node-native pipeline-state rollup" "loop-engineering,backend-looping,harness,testing" "$ISSUE_ROOT/01-01-add-pipeline-state-rollup.md"
create_issue "[BLE-1.2] Add rstack-agents pipeline status" "loop-engineering,backend-looping,harness,cli,testing" "$ISSUE_ROOT/01-02-add-pipeline-status-cli.md"
create_issue "[BLE-1.3] Normalize SDLC markdown agents to harness paths" "loop-engineering,backend-looping,harness,agent-update,documentation" "$ISSUE_ROOT/01-03-normalize-sdlc-agent-paths.md"

create_issue "[Epic] Backend Loop Engineering 2 - Builder / Validator Contracts" "epic,loop-engineering,backend-looping,contracts" "$ISSUE_ROOT/02-epic-builder-validator-contracts.md"
create_issue "[BLE-2.1] Enforce builder contract completeness" "loop-engineering,backend-looping,contracts,testing" "$ISSUE_ROOT/02-01-enforce-builder-contract-completeness.md"
create_issue "[BLE-2.2] Add validator sandbox policy" "loop-engineering,backend-looping,contracts,guardrails,testing" "$ISSUE_ROOT/02-02-add-validator-sandbox-policy.md"
create_issue "[BLE-2.3] Add validator registry" "loop-engineering,backend-looping,contracts,testing" "$ISSUE_ROOT/02-03-add-validator-registry.md"

create_issue "[Epic] Backend Loop Engineering 3 - Retry + Recovery Loop" "epic,loop-engineering,backend-looping,retry-recovery" "$ISSUE_ROOT/03-epic-retry-recovery-loop.md"
create_issue "[BLE-3.1] Add retry policy module" "loop-engineering,backend-looping,retry-recovery,testing" "$ISSUE_ROOT/03-01-add-retry-policy-module.md"
create_issue "[BLE-3.2] Add resume-aware runner command" "loop-engineering,backend-looping,retry-recovery,cli,testing" "$ISSUE_ROOT/03-02-add-resume-aware-runner.md"
create_issue "[BLE-3.3] Add retry event trace" "loop-engineering,backend-looping,retry-recovery,harness,testing" "$ISSUE_ROOT/03-03-add-retry-event-trace.md"

create_issue "[Epic] Backend Loop Engineering 4 - Goal Loop" "epic,loop-engineering,backend-looping,goal-loop" "$ISSUE_ROOT/04-epic-goal-loop.md"
create_issue "[BLE-4.1] Add goal evaluator" "loop-engineering,backend-looping,goal-loop,testing" "$ISSUE_ROOT/04-01-add-goal-evaluator.md"
create_issue "[BLE-4.2] Update Agent 11 goal contract" "loop-engineering,backend-looping,goal-loop,agent-update,documentation" "$ISSUE_ROOT/04-02-update-agent-11-goal-contract.md"
create_issue "[BLE-4.3] Add bounded loop runner" "loop-engineering,backend-looping,goal-loop,cli,testing" "$ISSUE_ROOT/04-03-add-bounded-loop-runner.md"

create_issue "[Epic] Backend Loop Engineering 5 - Guardrails, Approvals, Checkpoints" "epic,loop-engineering,backend-looping,guardrails" "$ISSUE_ROOT/05-epic-guardrails-approvals-checkpoints.md"
create_issue "[BLE-5.1] Strengthen destructive-action gate coverage" "loop-engineering,backend-looping,guardrails,testing" "$ISSUE_ROOT/05-01-strengthen-destructive-gates.md"
create_issue "[BLE-5.2] Checkpoint before and after critical stages" "loop-engineering,backend-looping,guardrails,harness,testing" "$ISSUE_ROOT/05-02-checkpoint-critical-stages.md"
create_issue "[BLE-5.3] Add approval audit consistency checks" "loop-engineering,backend-looping,guardrails,testing" "$ISSUE_ROOT/05-03-add-approval-audit-consistency.md"

create_issue "[Epic] Backend Loop Engineering 6 - Cost, Context, Memory" "epic,loop-engineering,backend-looping,cost-context-memory" "$ISSUE_ROOT/06-epic-cost-context-memory.md"
create_issue "[BLE-6.1] Populate cost/context fields from builder contracts" "loop-engineering,backend-looping,cost-context-memory,testing" "$ISSUE_ROOT/06-01-populate-cost-context-fields.md"
create_issue "[BLE-6.2] Add context pressure warnings" "loop-engineering,backend-looping,cost-context-memory,testing" "$ISSUE_ROOT/06-02-add-context-pressure-warnings.md"
create_issue "[BLE-6.3] Tighten memory write policy" "loop-engineering,backend-looping,cost-context-memory,testing" "$ISSUE_ROOT/06-03-tighten-memory-write-policy.md"

echo
if [[ "$APPLY" -eq 1 ]]; then
  echo "Done. Backend Loop Engineering v1 issues are filed."
else
  echo "Dry run complete. Re-run with --apply to create GitHub issues."
fi

